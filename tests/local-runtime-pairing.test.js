'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createManager } = require('../agent/model-manager.cjs');
const origin = 'chrome-extension://' + 'a'.repeat(32), other = 'chrome-extension://' + 'b'.repeat(32), nonce = 'c'.repeat(64);
async function fixture(t) {
  let clock = 1000, serial = 0;
  const manager = await createManager({ port: 0, accessOptions: { now: () => clock }, installation: { root: 'fake', sourceFor: () => ({}), inspect: async () => ({ installed: true, state: 'installed' }) }, bridgeFactory: async (_, id) => ({ url: `http://127.0.0.1:${id === 'akagi-v2' ? 17341 : 17342}/analyze`, token: 'engine-analysis-token-' + (++serial), close: async () => {} }) });
  t.after(() => manager.close());
  const base = 'http://127.0.0.1:' + manager.server.address().port;
  function req(url, body, headers = {}, method = body === undefined ? 'GET' : 'POST') {
    return new Promise((resolve, reject) => {
      const request = http.request(base + url, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }, res => { let text = ''; res.on('data', x => { text += x; }); res.on('end', () => { let value; try { value = JSON.parse(text); } catch { value = text; } resolve({ code: res.statusCode, value, headers: res.headers }); }); });
      request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const management = { Authorization: 'Bearer ' + manager.token };
  async function action(url) { const result = await req(url, {}, management); assert.equal(result.code, 202); while (manager.status().operation.state === 'running') await new Promise(r => setImmediate(r)); }
  const pairHeaders = { Origin: origin, 'X-Local-Pair': '1' };
  const pair = async () => (await req('/pair/request', { nonce, profile: 'voidshine-298k' }, pairHeaders)).value.id;
  const approve = id => req('/api/pair/approve', { id }, management);
  return { manager, req, base, management, action, pairHeaders, pair, approve, advance: ms => { clock += ms; } };
}

test('launch ticket is one use, bounded and yields a refreshable HttpOnly session with CSRF enforcement', async t => {
  const f = await fixture(t);
  const launch = new URL(f.manager.launchUrl()); const ticket = new URLSearchParams(launch.hash.slice(1)).get('ticket');
  assert.equal(launch.search, ''); assert.notEqual(ticket, f.manager.token);
  assert.equal((await f.req('/session', { ticket }, { Origin: 'https://evil.invalid', 'X-Manager-Request': '1' })).code, 403);
  const response = await f.req('/session', { ticket }, { Origin: f.base, 'X-Manager-Request': '1' }); assert.equal(response.code, 200);
  const cookie = response.headers['set-cookie'][0]; assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\//); assert.doesNotMatch(cookie, /Max-Age|Expires/);
  assert.equal((await f.req('/session', { ticket }, { Origin: f.base, 'X-Manager-Request': '1' })).code, 401);
  assert.equal((await f.req('/api/status', undefined, { Cookie: cookie.split(';')[0] })).code, 200);
  assert.equal((await f.req('/api/stop', {}, { Cookie: cookie.split(';')[0] })).code, 401);
  assert.equal((await f.req('/api/stop', {}, { Cookie: cookie.split(';')[0], Origin: f.base, 'X-Manager-Request': '1' })).code, 202);
  f.advance(8 * 3600000); assert.equal((await f.req('/api/status', undefined, { Cookie: cookie.split(';')[0] })).code, 401);
  const expiredTicket = new URLSearchParams(new URL(f.manager.launchUrl()).hash.slice(1)).get('ticket'); f.advance(60000);
  assert.equal((await f.req('/session', { ticket: expiredTicket }, { Origin: f.base, 'X-Manager-Request': '1' })).code, 401);
});

test('pairing rejects web CSRF, rebinding, absent origin and wrong extension; approval returns analysis only once', async t => {
  const f = await fixture(t), body = { nonce, profile: 'voidshine-298k' };
  assert.equal((await f.req('/api/status')).code, 401);
  for (const headers of [{}, { Origin: 'https://evil.invalid' }, { ...f.pairHeaders, Host: 'evil.invalid' }, { ...f.pairHeaders, 'X-Local-Pair': '' }]) assert.equal((await f.req('/pair/request', body, headers)).code, 403);
  const id = await f.pair(); assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal((await f.req('/pair/request', body, f.pairHeaders)).value.error, 'PAIR_REPLAY');
  assert.equal((await f.req('/pair/claim', { id, nonce }, { ...f.pairHeaders, Origin: other })).code, 400);
  assert.equal((await f.req('/pair/claim', { id, nonce: 'f'.repeat(64) }, f.pairHeaders)).code, 400);
  assert.equal((await f.req('/pair/claim', { id, nonce }, f.pairHeaders)).value.pending, true);
  assert.equal((await f.approve(id)).code, 400);
  await f.action('/api/models/voidshine-298k/start'); assert.equal((await f.approve(id)).code, 200);
  const claim = await f.req('/pair/claim', { id, nonce }, f.pairHeaders);
  assert.equal(claim.headers['access-control-allow-origin'], origin);
  assert.deepEqual(Object.keys(claim.value).sort(), ['apiKey', 'endpoint', 'format', 'profile']);
  assert.equal(claim.value.apiKey, 'engine-analysis-token-1'); assert.notEqual(claim.value.apiKey, f.manager.token);
  assert.equal((await f.req('/pair/claim', { id, nonce }, f.pairHeaders)).code, 400);
});

test('expired, switched and restarted models cannot satisfy an old approval', async t => {
  for (const change of ['expire', 'switch', 'restart']) {
    const f = await fixture(t); await f.action('/api/models/voidshine-298k/start');
    const id = await f.pair(); await f.approve(id);
    if (change === 'expire') f.advance(120000);
    else if (change === 'switch') await f.action('/api/models/akagi-v2/start');
    else await f.action('/api/models/voidshine-298k/start');
    assert.equal((await f.req('/pair/claim', { id, nonce }, f.pairHeaders)).code, 400);
  }
});

test('pair preflights are restricted and pending requests expire within bounded capacity', async t => {
  const f = await fixture(t);
  const preflight = { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-local-pair' };
  const accepted = await f.req('/pair/request', undefined, preflight, 'OPTIONS'); assert.equal(accepted.code, 204);
  assert.equal(accepted.headers['access-control-allow-origin'], origin);
  assert.equal((await f.req('/pair/request', undefined, { ...preflight, 'Access-Control-Request-Headers': 'authorization' }, 'OPTIONS')).code, 403);
  assert.equal((await f.req('/pair/request', undefined, { ...preflight, 'Access-Control-Request-Method': 'GET' }, 'OPTIONS')).code, 403);
  for (let n = 0; n < 16; n++) assert.equal((await f.req('/pair/request', { nonce: n.toString(16).padStart(64, '0'), profile: 'voidshine-298k' }, f.pairHeaders)).code, 200);
  assert.equal((await f.req('/pair/request', { nonce: 'f'.repeat(64), profile: 'voidshine-298k' }, f.pairHeaders)).value.error, 'PAIR_LIMIT');
  f.advance(120000); assert.equal(f.manager.status().pairing.length, 0); assert.ok(await f.pair());
});

test('extension pairing transport completes an actual HTTP handshake and validates fixed model identity', async t => {
  const f = await fixture(t), Pairing = require('../extension/local-runtime-pairing.js');
  await f.action('/api/models/voidshine-298k/start');
  let approval, sent = [];
  const result = await Pairing.connect('voidshine-298k', {
    crypto: require('node:crypto').webcrypto,
    fetcher: async (url, options) => { sent.push({ url, options }); return fetch(url.replace('http://127.0.0.1:17343', f.base), { ...options, headers: { ...options.headers, Origin: origin } }); },
    notify() { approval = f.approve(f.manager.status().pairing[0].id); },
    wait: () => new Promise(r => setImmediate(r))
  });
  assert.equal((await approval).code, 200); assert.equal(result.profile, 'voidshine-298k');
  assert.equal(sent[0].options.credentials, 'omit');
  assert.equal(sent.every(s => s.options.headers.Authorization === undefined && !s.url.includes('token')), true);
  const state = { drafts: { chat: { apiKey: 'CHAT_PRESERVED' } }, engineProfiles: { activeId: 'akagi-v2', profiles: [{ id: 'akagi-v2', config: { apiKey: 'V2_PRESERVED' } }, { id: 'voidshine-298k', config: { enabled: true } }] } };
  const updated = Pairing.apply(state, result, 'voidshine-298k');
  assert.equal(updated.drafts.mjai.enabled, false); assert.equal(updated.drafts.chat.apiKey, 'CHAT_PRESERVED');
  assert.equal(updated.engineProfiles.profiles[0].config.apiKey, 'V2_PRESERVED');
  assert.equal(state.engineProfiles.activeId, 'akagi-v2');
  for (const bad of [{ ...result, profile: 'akagi-v2' }, { ...result, endpoint: 'https://evil.invalid/analyze' }, { ...result, format: 'local-model-manager-v1' }, { ...result, apiKey: 'x\r\ny' }]) assert.throws(() => Pairing.apply(state, bad, 'voidshine-298k'));
});

test('first launch browser failure closes the newly listening manager before returning the error', async () => {
  const { main } = require('../agent/model-manager.cjs');
  let manager;
  await assert.rejects(main(['--open', '--port', '0'], {
    managerFactory: async options => {
      manager = await createManager({ ...options, installation: { root: 'fake', sourceFor: () => ({}), inspect: async () => ({ installed: false, state: 'not-installed' }) } });
      return manager;
    },
    opener: async () => { throw Object.assign(new Error('BROWSER_OPEN_FAILED'), { code: 'BROWSER_OPEN_FAILED' }); }
  }), /BROWSER_OPEN_FAILED/);
  assert.equal(manager.server.listening, false);
});
