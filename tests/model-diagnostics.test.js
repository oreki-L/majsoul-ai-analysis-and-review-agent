const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../extension/model-diagnostics.js');
const config = { endpoint: 'http://127.0.0.1:3425/prefix/v1', model: 'provider/model', apiKey: 'PRIVATE_KEY', maxTokens: 8192 };
const response = value => new Response(JSON.stringify(value));
const tool = (change = {}) => ({ choices: [{ message: { tool_calls: [{ type: 'function', id: 'echo-1', function: { name: 'diagnostic_echo', arguments: '{"value":"ping"}', ...change } }], reasoning_content: 'PRIVATE_REASONING' } }] });
const final = value => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
const message = (type = 'model:diagnose', extra = {}) => ({ type, requestId: 'test-1', config, ...extra });
function fixture(results, options = {}) {
  const calls = [], grants = [];
  const worker = D.create({ permissions: { contains: async value => { grants.push(value); return options.permission !== false; } },
    fetchModel: async (url, init) => { calls.push({ url, init }); const result = results.shift(); if (result instanceof Error) throw result; return response(result); }, ...options });
  return { ...worker, calls, grants };
}
test('diagnostic reuses transport for exactly two artificial tool/final turns without history', async () => {
  const w = fixture([tool(), final({ ok: true, echo: 'pong' })]);
  const result = await w.run(message('model:diagnose', { snapshot: 'PRIVATE_HAND', history: 'PRIVATE_HISTORY' }));
  assert.equal(result.ok, true); assert.deepEqual(result.checks, { connection: true, tools: true, json: true });
  assert.equal(w.calls.length, 2);
  assert.deepEqual(w.grants, [{ origins: ['http://127.0.0.1/*'] }]);
  for (const { url, init } of w.calls) {
    assert.equal(url, 'http://127.0.0.1:3425/prefix/v1/chat/completions');
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const body = JSON.parse(init.body); assert.equal(body.stream, false); assert.equal(body.max_tokens, 1024);
    assert.equal(body.model, config.model); assert.doesNotMatch(init.body, /PRIVATE_HAND|PRIVATE_HISTORY/);
  }
  const second = JSON.parse(w.calls[1].init.body);
  assert.equal(second.tools, undefined); assert.equal(second.messages[2].reasoning_content, 'PRIVATE_REASONING');
  assert.deepEqual(second.messages[3], { role: 'tool', tool_call_id: 'echo-1', content: '{"value":"pong"}' });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test('permission denial and invalid config prevent any network access', async () => {
  const w = fixture([], { permission: false }); assert.equal((await w.run(message())).code, 'PERMISSION'); assert.equal(w.calls.length, 0);
  for (const invalid of [{ endpoint: 'http://remote.invalid' }, { endpoint: config.endpoint, apiKey: {} }]) {
    assert.equal((await w.run(message('model:diagnose', { config: invalid }))).code, 'INVALID');
  }
  assert.equal((await w.run(message('model:diagnose', { requestId: '<bad>' }))).code, 'INVALID');
});
test('strict function arguments and final minimal JSON are required', async () => {
  for (const bad of [tool({ name: 'delete_files' }), tool({ arguments: '{"value":"ping","extra":true}' }), final({ ok: true, echo: 'pong' })]) {
    const w = fixture([bad]); assert.equal((await w.run(message())).code, 'TOOLS'); assert.equal(w.calls.length, 1);
  }
  for (const value of [{ ok: true }, { ok: true, echo: 'pong', extra: 'PRIVATE' }, { ok: false, echo: 'pong' }]) {
    const w = fixture([tool(), final(value)]); assert.equal((await w.run(message())).code, 'JSON');
  }
});
test('upstream response bodies, network errors and malformed output never leak', async () => {
  for (const options of [
    { fetchModel: async () => { throw new Error('PRIVATE_KEY upstream URL'); } },
    { fetchModel: async () => new Response('PRIVATE_KEY', { status: 401 }) },
    { fetchModel: async () => new Response('PRIVATE_KEY') },
    { fetchModel: async () => new Response('a'.repeat(256 * 1024 + 1)) }
  ]) {
    const w = fixture([], options), result = await w.run(message());
    assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_KEY|upstream URL/);
  }
});
test('discovery preserves base/port, sanitizes and caps returned fields', async () => {
  const w = fixture([{ name: 'Magpie', version: '0.1.2183', secret: 'PRIVATE' }, { data: [{ id: 'a', apiKey: 'PRIVATE' }, { id: 'a' }, { id: '\ninvalid' }, ...Array.from({ length: 250 }, (_, i) => ({ id: 'model/' + i }))] }]);
  assert.deepEqual((await w.run(message('model:discover', { action: 'hello' }))).hello, { service: 'magpie', version: '0.1.2183' });
  assert.equal(w.calls[0].url, 'http://127.0.0.1:3425/api/hello');
  const result = await w.run(message('model:discover', { action: 'models' }));
  assert.equal(w.calls[1].url, 'http://127.0.0.1:3425/prefix/v1/models');
  assert.equal(result.models.length, 200); assert.deepEqual(result.models[0], { id: 'a' }); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  const unknown = fixture([{ name: 'other' }, { models: ['cc-switch'] }]);
  assert.equal((await unknown.run(message('model:discover', { action: 'hello' }))).code, 'IDENTITY');
  assert.equal((await unknown.run(message('model:discover', { action: 'models' }))).code, 'RESPONSE');
});
test('cancellation covers preflight, prevents stale continuation and enforces single request', async () => {
  let grant;
  const w = fixture([], { permissions: { contains: () => new Promise(resolve => { grant = resolve; }) } });
  const running = w.run(message());
  assert.equal((await w.run(message('model:diagnose', { requestId: 'other' }))).code, 'BUSY');
  assert.equal(w.cancel('other'), false); assert.equal(w.cancel('test-1'), true);
  assert.equal((await running).code, 'CANCELLED'); grant(true); await Promise.resolve(); assert.equal(w.calls.length, 0);
});
test('timeout completes even when transport ignores abort', async () => {
  const w = fixture([], { timeoutMs: 5, fetchModel: () => new Promise(() => {}) });
  assert.equal((await w.run(message())).code, 'TIMEOUT'); assert.equal(w.cancel(), false);
});


test('HTTP errors distinguish authentication and model problems without returning server content', async () => {
  for (const [status, code] of [[401, 'AUTH'], [403, 'AUTH'], [404, 'MODEL'], [422, 'MODEL'], [503, 'HTTP']]) {
    const w = fixture([], { fetchModel: async () => new Response('PRIVATE_KEY upstream secret', { status }) });
    const result = await w.run(message()); assert.equal(result.code, code); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|upstream/);
  }
});

test('model display names remain bounded optional labels and IDs remain exact', async () => {
  const w = fixture([{ data: [{ id: 'provider/model', display_name: 'Fixed model' }, { id: ' route group ', display_name: 'bad\nname' }] }]);
  const result = await w.run(message('model:discover', { action: 'models' }));
  assert.deepEqual(result.models, [{ id: 'provider/model', name: 'Fixed model' }, { id: ' route group ' }]);
});

test('CC Switch Codex discovery is explicit and preserves slug IDs without inferring standard schemas', async () => {
  const payload = { models: [{ slug: 'ccs-mock/vendor/model', display_name: 'Mock', private: 'PRIVATE' }, { slug: 'ccs-mock/vendor/model' }, { slug: 'bad\nmodel' }] };
  const w = fixture([payload, payload, { data: [{ id: 'standard' }] }, { models: [] }, { models: [{ id: 'wrong-schema' }] }]);
  const cc = () => message('model:discover', { action: 'cc-switch-models' });
  const result = await w.run(cc()); assert.deepEqual(result.models, [{ id: 'ccs-mock/vendor/model', name: 'Mock' }]);
  assert.equal(w.calls[0].url, 'http://127.0.0.1:3425/prefix/v1/models');
  assert.equal(w.calls[0].init.headers.Authorization, 'Bearer PRIVATE_KEY');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  assert.equal((await w.run(message('model:discover', { action: 'models' }))).code, 'RESPONSE');
  assert.equal((await w.run(cc())).code, 'RESPONSE');
  assert.deepEqual((await w.run(cc())).models, []);
  assert.equal((await w.run(cc())).code, 'RESPONSE');
});

test('CC Switch directory bounds, errors and aborts use the common discovery limits', async () => {
  const cc = () => message('model:discover', { action: 'cc-switch-models', config: { ...config, apiKey: '' } });
  const w = fixture([{ models: Array.from({ length: 1100 }, (_, i) => ({ slug: 'ccs-mock/model-' + i })) }, { models: [{ slug: 'x'.repeat(201) }] }, { models: [], data: [] }]);
  assert.equal((await w.run(cc())).models.length, 200); assert.equal(w.calls[0].init.headers.Authorization, undefined);
  assert.equal((await w.run(cc())).code, 'RESPONSE'); assert.equal((await w.run(cc())).code, 'RESPONSE');
  for (const [status, code] of [[401, 'AUTH'], [404, 'MODEL']]) {
    assert.equal((await fixture([], { fetchModel: async () => new Response('PRIVATE', { status }) }).run(cc())).code, code);
  }
  assert.equal((await fixture([], { fetchModel: async () => new Response('x'.repeat(256 * 1024 + 1)) }).run(cc())).code, 'RESPONSE');
  const slow = fixture([], { fetchModel: () => new Promise(() => {}) });
  const running = slow.run(cc()); await Promise.resolve(); slow.cancel('test-1'); assert.equal((await running).code, 'CANCELLED');
});
