const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHmac } = require('node:crypto');
const { once } = require('node:events');
const { existsSync } = require('node:fs');
const { mkdtemp, readFile, realpath, rm } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { normalizeDestination } = require('../extension/chat/delivery.js');

const target = { id: 'bot', version: 1, kind: 'webhook', name: 'test', enabled: true,
  url: 'https://example.invalid/hook?token=fixture-url-token', secret: 'fixture-signing-key' };
const feishu = { ...target, kind: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture-token' };
const time = '2026-11-18T09:24:00Z';
const envelope = { specversion: '1.0', id: 'fixture-event', source: 'urn:majsoul-agent:installation:fixture',
  type: 'app.majsoul.review.summary.shared.v1', time, datacontenttype: 'application/json',
  data: { roundCount: 3, decisionCount: 8, scope: 'retained-decisions', topics: ['efficiency'] } };

test('validates destination credentials, URL schemes and the exact Feishu bot endpoint', () => {
  assert.deepEqual(normalizeDestination(target), target);
  assert.equal(normalizeDestination({ ...target, enabled: undefined }).enabled, false);
  assert.equal(normalizeDestination({ ...target, secret: '' }), null);
  assert.equal(normalizeDestination({ ...feishu, secret: '' }).url, feishu.url);
  for (const url of ['http://example.invalid', 'https:///example.invalid', 'https://user:password@example.invalid/',
    'https://@example.invalid/', 'https://example.invalid/#', 'https://example.invalid\\@another.invalid/', 'https://*.invalid/']) {
    assert.equal(normalizeDestination({ ...target, url }), null, url);
  }
  for (const url of [feishu.url + '?extra', feishu.url.replace('.cn', '.cn.example.invalid'),
    feishu.url.replace('.cn', '.cn:444'), feishu.url.replace('/hook/', '/other/')]) {
    assert.equal(normalizeDestination({ ...feishu, url }), null, url);
  }
});

function browserExecutable() {
  if (process.env.MJ_TEST_CHROME) return process.env.MJ_TEST_CHROME;
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
    for (const suffix of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
      const file = join(base, suffix);
      if (existsSync(file)) return file;
    }
  }
  const candidates = process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  return candidates.find(file => spawnSync(file, ['--version'], { timeout: 3000 }).status === 0);
}

async function polling(get) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await get().catch(() => null);
    if (result) return result;
    await sleep(100);
  }
  throw new Error('Chromium DevTools did not become ready');
}

async function browserRunner(browser, suite) {
  const temp = await realpath(tmpdir());
  const profile = await mkdtemp(join(temp, 'mj-chat-chromium-'));
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Offline chat tests</title>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const flags = ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url];
  if (process.getuid?.() === 0) flags.push('--no-sandbox');
  const child = spawn(browser, flags, { stdio: 'ignore', windowsHide: true });
  const stopped = once(child, 'exit').catch(() => {});
  let socket;
  suite.after(async () => {
    socket?.close();
    child.kill();
    await stopped;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    const resolved = await realpath(profile);
    assert.equal(dirname(resolved), temp);
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const [port] = (await polling(() => readFile(join(profile, 'DevToolsActivePort'), 'utf8'))).split(/\r?\n/);
  const tab = await polling(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
    .find(item => item.type === 'page' && item.url === url));
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  function evaluate(expression) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener('message', receive);
        reject(new Error('Chromium test timed out'));
      }, 15000);
      function receive(message) {
        const result = JSON.parse(message.data);
        if (result.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener('message', receive);
        const error = result.error?.message || result.result?.exceptionDetails?.exception?.description;
        if (error) reject(new Error(error));
        else resolve(result.result.result.value);
      }
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  }
  await polling(() => evaluate(`location.href === ${JSON.stringify(url)} && isSecureContext && document.title === 'Offline chat tests'`));
  await evaluate(await readFile(require.resolve('../extension/chat/delivery.js'), 'utf8'));
  await evaluate(await readFile(require.resolve('../extension/postgame-review.js'), 'utf8'));
  await evaluate(await readFile(require.resolve('../extension/chat/integrations.js'), 'utf8'));
  return async (fn, input) => evaluate(`(${fixture})(${JSON.stringify({ target, feishu, envelope, input })}, ${fn})`);
}

async function fixture({ target, feishu, envelope, input }, run) {
  let now = Date.parse(envelope.time);
  let route = target;
  let allowed = true;
  let respond = () => new Response(null, { status: 204 });
  const calls = [];
  const given = {
    clock: () => now,
    resolveDestination: id => ({ ...route, id }),
    hasPermission: url => allowed && url === route.url,
    fetchRequest: (url, options) => {
      calls.push({ url, ...options, signal: undefined });
      return respond(url, options);
    },
  };
  const store = MJChatDelivery.create(given);
  const refs = [{ id: target.id, version: target.version }];
  await store.clear();
  return run({ store, given, refs, target, feishu, envelope, calls, input,
    advance: delta => { now += delta; }, route: value => { route = value; }, permission: value => { allowed = value; },
    respond: value => { respond = value; }, clock: given.clock });
}

const browser = browserExecutable();
test('chat delivery with Chromium IndexedDB and Web Crypto', { skip: !browser && 'Set MJ_TEST_CHROME to run browser storage tests' }, async suite => {
  const run = await browserRunner(browser, suite);

  for (const operation of ['edit', 'remove', 'revoke', 'revoke-active', 'clear', 'disable', 'stale-before-dispatch']) {
    await suite.test(`chat integration isolates ${operation} while two targets are queued`, async () => {
      const result = await run(async ({ store, target, feishu, envelope, clock, advance, input: operation }) => {
        const first = { ...feishu, id: 'first' }, second = { ...target, id: 'second' };
        const unaffected = { ...first, id: 'unaffected', url: first.url + '-other' };
        const unrelated = ['edit', 'remove', 'revoke'].includes(operation);
        let settings = { enabled: true, destinations: unrelated ? [first, second, unaffected] : [first, second], source: envelope.source, draft: null };
        const granted = new Set(['https://open.feishu.cn/*', 'https://example.invalid/*']);
        const calls = [];
        let release, entered, onRemoved, firstSignal, holdPermission;
        const waiting = new Promise(resolve => { entered = resolve; });
        const hold = new Promise(resolve => { release = resolve; });
        let permissionChecks = 0;
        const app = MJChatIntegrations.create({ clock, runtime: {}, discussions: {}, deliveryApi: MJChatDelivery,
          storage: { get: async () => ({ chatIntegrationsV1: settings }), set: async values => { settings = values.chatIntegrationsV1; } },
          permissions: {
            onRemoved: { addListener: listener => { onRemoved = listener; } },
            contains: async ({ origins: [origin] }) => {
              if (operation === 'stale-before-dispatch' && origin === 'https://open.feishu.cn/*' && ++permissionChecks === 2) {
                holdPermission = true;
                entered();
                await hold;
              }
              return granted.has(origin);
            },
          },
          fetchRequest: async (url, { signal }) => {
            calls.push(url);
            if (url === unaffected.url) return Response.json({ code: 0 });
            if (url !== first.url) return new Response(null, { status: 204 });
            firstSignal = signal;
            entered();
            await Promise.race([hold, new Promise((resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            })]);
            return Response.json({ code: 0 });
          },
        });
        await store.enqueue({ event: envelope, destinations: [{ id: first.id, version: first.version }] });
        advance(1);
        await store.enqueue({ event: { ...envelope, id: 'next-target' }, destinations: [{ id: second.id, version: second.version }] });
        advance(1);
        if (unrelated) await store.enqueue({ event: { ...envelope, id: 'unaffected-target' }, destinations: [{ id: unaffected.id, version: unaffected.version }] });
        const pumping = app.ready();
        await waiting;
        const rpc = (type, data) => app.handle({ type: 'chat:' + type, ...data }, { optionsPage: true });
        let updated;
        if (operation === 'edit') updated = await rpc('save-target', { target: { id: second.id, kind: second.kind, name: 'Changed' } });
        if (operation === 'remove') updated = await rpc('remove-target', { id: second.id });
        if (operation === 'clear') updated = await rpc('clear');
        if (operation === 'disable') updated = await rpc('configure', { enabled: false });
        if (operation === 'stale-before-dispatch') updated = await rpc('remove-target', { id: first.id });
        if (operation === 'revoke' || operation === 'revoke-active') {
          const origin = operation === 'revoke' ? 'https://example.invalid/*' : 'https://open.feishu.cn/*';
          granted.delete(origin);
          onRemoved({ origins: [origin] });
          await Promise.resolve();
          await Promise.resolve();
        }
        const aborted = firstSignal?.aborted;
        release();
        await pumping;
        return { updated, aborted, calls, holdPermission, rows: await store.list() };
      }, operation);
      if (result.updated) assert.equal(result.updated.ok, true);
      const first = result.rows.find(row => row.destinationId === 'first');
      const second = result.rows.find(row => row.destinationId === 'second');
      if (['clear', 'disable'].includes(operation)) {
        assert.equal(result.aborted, true);
        assert.deepEqual(result.rows, []);
        assert.deepEqual(result.calls, [feishu.url]);
      } else if (operation === 'revoke-active' || operation === 'stale-before-dispatch') {
        assert.equal(second.status, 'accepted');
        assert.equal(second.attempts, 1);
        if (operation === 'revoke-active') {
          assert.equal(result.aborted, true);
          assert.equal(first.status, 'unknown');
          assert.deepEqual(result.calls, [feishu.url, target.url]);
        } else {
          assert.equal(result.holdPermission, true);
          assert.equal(first.status, 'failed');
          assert.equal(first.errorCode, 'destination_changed');
          assert.equal(first.attempts, 0);
          assert.deepEqual(result.calls, [target.url]);
        }
      } else {
        assert.equal(result.aborted, false);
        assert.equal(first.status, 'accepted');
        assert.equal(first.attempts, 1);
        assert.equal(second.status, 'failed');
        assert.equal(second.errorCode, operation === 'revoke' ? 'permission_denied' : 'destination_changed');
        assert.equal(second.attempts, 0);
        const unaffected = result.rows.find(row => row.destinationId === 'unaffected');
        assert.equal(unaffected.status, 'accepted');
        assert.equal(unaffected.attempts, 1);
        assert.deepEqual(result.calls, [feishu.url, feishu.url + '-other']);
      }
    });
  }

  await suite.test('atomic multi-target rollback, concurrent dedup and restart', async () => {
    const result = await run(async ({ store, given, refs, envelope, calls }) => {
      const other = MJChatDelivery.create(given);
      const both = refs.concat({ id: 'second', version: 1 }, refs);
      const uuid = crypto.randomUUID;
      crypto.randomUUID = () => 'forced-duplicate-key';
      const rollback = await store.enqueue({ event: envelope, destinations: both });
      crypto.randomUUID = uuid;
      const empty = await store.list();
      const changed = { ...envelope, data: { ...envelope.data, decisionCount: 9 } };
      const queued = await Promise.all([
        store.enqueue({ event: changed, destinations: both }), other.enqueue({ event: changed, destinations: both }),
      ]);
      const conflict = await store.enqueue({ event: envelope, destinations: refs });
      const pumped = await Promise.all([other.pump(), store.pump()]);
      return { rollback, empty, queued, conflict, pumped, sent: calls.length, list: await store.list() };
    });
    assert.equal(result.rollback.code, 'storage_unavailable');
    assert.deepEqual(result.empty, []);
    assert.equal(result.queued[0].deliveries.length, 2);
    assert.deepEqual(result.queued[0].deliveries, result.queued[1].deliveries);
    assert.equal(result.conflict.code, 'event_conflict');
    assert.equal(result.sent, 2);
    assert.equal(result.pumped.reduce((total, value) => total + value.processed, 0), 2);
    assert.ok(result.list.every(row => row.status === 'accepted'));
  });

  await suite.test('structured CloudEvents, exact-body HMAC, HTTP classes and no secret leakage', async () => {
    const result = await run(async ({ store, refs, envelope, calls, respond, advance, clock }) => {
      await store.enqueue({ event: { ...envelope, subject: 'private subject',
        data: { ...envelope.data, raw: 'private details' } }, destinations: refs });
      respond(() => new Response('fixture-signing-key', { status: 429, headers: { 'Retry-After': '120' } }));
      const start = clock();
      await store.pump();
      const first = (await store.list())[0];
      const due = await store.nextDue();
      advance(119000);
      const early = await store.pump();
      advance(1000);
      respond(() => new Response(null, { status: 307, headers: { Location: 'https://redirect.invalid/' } }));
      await store.pump();
      return { calls, start, first, due, early, last: (await store.list())[0] };
    });
    assert.equal(result.due, result.start + 120000);
    assert.equal(result.early.processed, 0);
    assert.equal(result.first.errorCode, 'rate_limited');
    assert.equal(result.last.errorCode, 'redirect_rejected');
    assert.equal(result.last.attempts, 2);
    for (const call of result.calls) {
      assert.equal(call.method, 'POST');
      assert.equal(call.redirect, 'manual');
      assert.equal(call.credentials, 'omit');
      assert.equal(call.referrerPolicy, 'no-referrer');
      assert.equal(call.headers['Content-Type'], 'application/cloudevents+json');
      assert.deepEqual(JSON.parse(call.body), envelope);
      const value = createHmac('sha256', target.secret).update(`${call.headers['X-MJ-Timestamp']}.${call.body}`).digest('hex');
      assert.equal(call.headers['X-MJ-Signature'], `sha256=${value}`);
    }
    assert.notEqual(result.calls[0].headers['X-MJ-Timestamp'], result.calls[1].headers['X-MJ-Timestamp']);
    assert.doesNotMatch(JSON.stringify([result.first, result.last]), /example\.invalid|fixture-signing-key|fixture-url-token|roundCount|fixture-event/);
  });

  await suite.test('Feishu signing, absent confirmation requires manual retry, and business rejection', async () => {
    const result = await run(async ({ store, refs, envelope, feishu, calls, respond, route, advance }) => {
      route(feishu);
      await store.enqueue({ event: envelope, destinations: refs });
      respond(() => { throw new Error('fixture leak: ' + feishu.url); });
      await store.pump();
      const unknown = (await store.list())[0];
      advance(60 * 60000);
      await store.pump();
      const unchanged = calls.length;
      const retry = await store.retry(unknown.deliveryId);
      respond(() => Response.json({ code: 19021, msg: 'fixture leak' }));
      await store.pump();
      const rejected = (await store.list())[0];
      route({ ...feishu, secret: '' });
      await store.retry(rejected.deliveryId);
      respond(() => Response.json({ code: 0, StatusCode: 0 }));
      await store.pump();
      return { calls, unchanged, unknown, retry, rejected, accepted: (await store.list())[0], due: await store.nextDue() };
    });
    assert.equal(result.unknown.status, 'unknown');
    assert.equal(result.unchanged, 1);
    assert.equal(result.retry.delivery.status, 'pending');
    assert.equal(result.rejected.errorCode, 'platform_rejected');
    assert.equal(result.accepted.status, 'accepted');
    assert.equal(result.due, null);
    const body = JSON.parse(result.calls[0].body);
    assert.equal(body.msg_type, 'text');
    assert.match(body.content.text, /3 小局，8 条决策/);
    assert.match(body.content.text, /牌效率/);
    assert.equal(body.sign, createHmac('sha256', `${body.timestamp}\n${feishu.secret}`).update('').digest('base64'));
    assert.equal(JSON.parse(result.calls[2].body).sign, undefined);
    assert.doesNotMatch(JSON.stringify([result.unknown, result.retry, result.rejected]), /fixture leak|fixture-token|fixture-signing-key/);
  });

  await suite.test('match settlement requires a subscription scope and formats only allowed fields for Feishu', async () => {
    const result = await run(async ({ store, given, refs, envelope, feishu, route, respond, calls }) => {
      route(feishu);
      respond(() => Response.json({ code: 0 }));
      const scopes = [];
      const inbox = MJChatDelivery.create({ ...given, authorizeDispatch: (destination, signal, send, scope) => {
        scopes.push(scope);
        return scope === 'active' ? send(signal) : { status: 'failed', code: 'destination_changed' };
      } });
      const event = { ...envelope, type: 'app.majsoul.match.completed.v1', data: {
        playerCount: 3, roundCount: 5, endReason: 'exhaustive_draw', finalScores: [36000, 35000, 34000], account: 'PRIVATE'
      } };
      const scoped = scope => [{ ...refs[0], scope }];
      const missingScope = await store.enqueue({ event, destinations: refs });
      const invalidReason = await store.enqueue({ event: { ...event, data: { ...event.data, endReason: ['win'] } }, destinations: scoped('active') });
      await store.enqueue({ event: { ...event, id: 'old-subscription' }, destinations: scoped('old') });
      await store.enqueue({ event, destinations: scoped('active') });
      await inbox.pump();
      return { missingScope, invalidReason, scopes, calls, rows: await store.list() };
    });
    assert.equal(result.missingScope.code, 'invalid_destination');
    assert.equal(result.invalidReason.ok, false);
    assert.deepEqual(result.scopes.sort(), ['active', 'old']);
    assert.equal(result.rows.find(row => row.scope === 'old').errorCode, 'destination_changed');
    assert.equal(result.rows.find(row => row.scope === 'active').status, 'accepted');
    assert.equal(result.calls.length, 1);
    assert.equal(JSON.parse(result.calls[0].body).content.text,
      '雀魂整场结算：3 人麻将，记录 5 小局，荒牌流局结束\n终局点数（按座位顺序）：36000 / 35000 / 34000');
  });

  await suite.test('recover expired leases without duplicate Feishu sends or stale writes', async () => {
    const result = await run(async ({ store, given, refs, envelope, target, feishu, route, respond, advance, calls }) => {
      const other = MJChatDelivery.create(given);
      const results = [];
      for (const destination of [target, feishu]) {
        await store.clear();
        const before = calls.length;
        route(destination);
        let release;
        let started;
        const entered = new Promise(resolve => { started = resolve; });
        respond(() => new Promise(resolve => { release = resolve; started(); }));
        await store.enqueue({ event: envelope, destinations: refs });
        const original = store.pump();
        await entered;
        const same = await other.pump();
        const leaseDue = await other.nextDue();
        advance(60001);
        await other.pump();
        const recovered = (await other.list())[0];
        advance(30000);
        respond(() => destination.kind === 'feishu' ? Response.json({ code: 0 }) : new Response(null, { status: 204 }));
        await other.pump();
        release(Response.json({ code: 0 }));
        await original;
        results.push({ same, leaseDue, recovered, final: (await store.list())[0], sends: calls.length - before });
      }
      return results;
    });
    assert.ok(result.every(item => item.same.processed === 0 && Number.isFinite(item.leaseDue)));
    assert.equal(result[0].recovered.status, 'pending');
    assert.equal(result[0].final.status, 'accepted');
    assert.equal(result[0].sends, 2);
    assert.equal(result[1].recovered.status, 'unknown');
    assert.equal(result[1].final.status, 'unknown');
    assert.equal(result[1].sends, 1);
  });

  await suite.test('stop automated retries at five and never retry ambiguous Feishu HTTP or JSON', async () => {
    const result = await run(async ({ store, refs, envelope, feishu, route, respond, advance, calls, clock }) => {
      respond(() => new Response(null, { status: 503 }));
      await store.enqueue({ event: envelope, destinations: refs });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await store.pump();
        const next = await store.nextDue();
        if (next !== null) advance(next - clock());
      }
      const exhausted = (await store.list())[0];
      const finalDue = await store.nextDue();
      route(feishu);
      await store.enqueue({ event: { ...envelope, id: 'feishu-http' }, destinations: refs });
      await store.pump();
      respond(() => Response.json({ unexpected: true }));
      await store.enqueue({ event: { ...envelope, id: 'feishu-json' }, destinations: refs });
      await store.pump();
      advance(3600000);
      const pump = await store.pump();
      return { exhausted, finalDue, pump, calls: calls.length, unknown: (await store.list()).filter(row => row.status === 'unknown') };
    });
    assert.equal(result.exhausted.attempts, 5);
    assert.equal(result.exhausted.status, 'failed');
    assert.equal(result.finalDue, null);
    assert.equal(result.pump.processed, 0);
    assert.equal(result.calls, 7);
    assert.equal(result.unknown.length, 2);
  });

  await suite.test('recheck permission and version, enforce capacity and prune expired data', async () => {
    const result = await run(async ({ store, refs, envelope, route, target, permission, advance, calls }) => {
      const make = id => ({ event: { ...envelope, id }, destinations: refs });
      await store.enqueue(make('permission'));
      permission(false);
      await store.pump();
      const denied = (await store.list())[0];
      permission(true);
      route({ ...target, version: 2 });
      await store.retry(denied.id);
      await store.pump();
      const changed = (await store.list())[0];
      const destinations = Array.from({ length: 200 }, (unused, index) => ({ id: `target-${index}`, version: 1 }));
      const fullBatch = await store.enqueue({ ...make('atomic-full'), destinations });
      const size = (await store.list()).length;
      const filled = await store.enqueue({ ...make('capacity'), destinations: destinations.slice(1) });
      await store.enqueue({ ...make('capacity'), destinations: destinations.slice(1) });
      const full = await store.enqueue(make('over-capacity'));
      advance(24 * 60 * 60000);
      const expired = (await store.list()).filter(row => row.status === 'expired').length;
      const due = await store.nextDue();
      advance(6 * 24 * 60 * 60000);
      const pruned = await store.list();
      const fresh = await store.enqueue(make('capacity'));
      const cleared = await store.clear();
      return { denied, changed, fullBatch, size, count: filled.deliveries.length, full, expired, due, pruned,
        fresh, cleared, calls: calls.length, empty: await store.list() };
    });
    assert.equal(result.denied.errorCode, 'permission_denied');
    assert.equal(result.changed.errorCode, 'destination_changed');
    assert.equal(result.calls, 0);
    assert.equal(result.fullBatch.code, 'queue_full');
    assert.equal(result.size, 1);
    assert.equal(result.count, 199);
    assert.equal(result.full.code, 'queue_full');
    assert.equal(result.expired, 199);
    assert.equal(result.due, null);
    assert.deepEqual(result.pruned, []);
    assert.equal(result.fresh.ok, true);
    assert.equal(result.cleared.cleared, 1);
    assert.deepEqual(result.empty, []);
  });
});
