'use strict';
// Local HTTP contract fixture only. This is not a running CC Switch process.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const D = require('../extension/model-diagnostics.js');

test('loopback contract fixture discovers Codex slugs and completes the common non-streaming tool/JSON diagnostic', async t => {
  const received = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null; received.push({ path: req.url, method: req.method, auth: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ models: [{ slug: 'ccs-fixture/vendor/model', display_name: 'Artificial fixture' }] }));
    if (req.url !== '/v1/chat/completions') { res.statusCode = 404; return res.end('{}'); }
    res.end(JSON.stringify({ choices: [{ message: body.tools ? { tool_calls: [{ id: 'fixture-call', type: 'function', function: { name: 'diagnostic_echo', arguments: '{"value":"ping"}' } }] } : { content: '{"ok":true,"echo":"pong"}' } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const config = { provider: 'chat', endpoint: 'http://127.0.0.1:' + server.address().port + '/v1', model: 'ccs-fixture/vendor/model', apiKey: '', maxTokens: 8192 };
  const worker = D.create({ permissions: { contains: async ({ origins }) => { assert.deepEqual(origins, ['http://127.0.0.1/*']); return true; } }, fetchModel: fetch });
  const directory = await worker.run({ type: 'model:discover', action: 'cc-switch-models', requestId: 'fixture-models', config });
  assert.deepEqual(directory.models, [{ id: config.model, name: 'Artificial fixture' }]);
  const diagnostic = await worker.run({ type: 'model:diagnose', requestId: 'fixture-tools', config });
  assert.equal(diagnostic.ok, true); assert.equal(received.length, 3);
  assert.deepEqual(received.map(r => r.path), ['/v1/models', '/v1/chat/completions', '/v1/chat/completions']);
  assert.ok(received.every(r => r.auth === undefined));
  for (const { body } of received.slice(1)) { assert.equal(body.stream, false); assert.equal(body.model, config.model); }
  assert.deepEqual(received[2].body.messages.at(-1), { role: 'tool', tool_call_id: 'fixture-call', content: '{"value":"pong"}' });
});
