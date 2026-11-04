'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), Module = require('node:module');
const installationModule = require('../agent/model-installation.cjs');
const sampleRequest = require('../agent/mortal-sample.cjs').sampleRequest;
const identity = { model: 'akagi-v3-native', runtime: 'fixture-build', checkpoint: 'fixture-checkpoint', sourceCommit: 'fixture-commit' };
async function fixture(t, { action, wrongIdentity = false, startFailure = false } = {}) {
  let closed = 0, warmed = 0, python = 0;
  const stages = [];
  const runner = { ready: true, pid: 123, async start() { if (startFailure) throw Object.assign(new Error('NATIVE_START_FAILED'), { code: 'NATIVE_START_FAILED' }); return wrongIdentity ? { ...identity, runtime: 'other-build' } : identity; },
    async infer(request) { warmed++; const drawn = request.events.at(-1); return { action: action || { type: 'dahai', actor: request.seat, pai: drawn.pai, tsumogiri: true }, identity }; }, async close() { closed++; } };
  const originalLoad = Module._load;
  t.mock.method(Module, '_load', function(name, parent, ...rest) {
    if (name === './akagi-native-local.cjs') return { runtimeConfig: () => ({ command: 'fixture', args: [], identity }), sampleRequest };
    if (name === './akagi-native-process.cjs') return { createAkagiNativeRunner: () => runner };
    return originalLoad.call(this, name, parent, ...rest);
  });
  t.mock.method(installationModule, 'verifyOwned', async () => {});
  delete require.cache[require.resolve('../agent/model-manager.cjs')];
  const { startBridge } = require('../agent/model-manager.cjs');
  const installation = { root: 'fixture', modelDir: () => 'model', runtimeDir: () => 'native-runtime', pythonFor() { python++; throw new Error('must not prepare Python'); }, async verifyRuntime() {} };
  return { start: () => startBridge(installation, 'akagi-v3-native', new AbortController().signal, { onStage: stage => stages.push(stage) }), stages, counts: () => ({ closed, warmed, python }) };
}
test('native manager checks real sample action and identity before listening on its fixed port (mock worker)', async t => {
  const f = await fixture(t), service = await f.start(); t.after(() => service.close());
  assert.equal(service.url, 'http://127.0.0.1:17345/analyze');
  assert.deepEqual(f.stages, ['verify-model', 'verify-runtime', 'load-model', 'warmup', 'listen']);
  assert.deepEqual(f.counts(), { closed: 0, warmed: 1, python: 0 });
  assert.equal(service.ready, true);
});
for (const options of [{ wrongIdentity: true }, { action: { type: 'none' } }, { action: { type: 'dahai', actor: 3, pai: '1m' } }, { startFailure: true }]) test('native manager rejects failed warmup and cleans its worker before opening HTTP: ' + JSON.stringify(options), async t => {
  const f = await fixture(t, options);
  await assert.rejects(f.start(), /ENGINE_IDENTITY_MISMATCH|REAL_INFERENCE_INVALID_ACTION|NATIVE_START_FAILED/);
  assert.equal(f.counts().closed, 1); assert.equal(f.counts().python, 0);
  assert.ok(!f.stages.includes('listen'));
});
test('native occupied port cleans the already warmed worker and leaves the existing listener intact', async t => {
  const listener = http.createServer(); await new Promise(resolve => listener.listen(17345, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const f = await fixture(t);
  await assert.rejects(f.start(), { code: 'EADDRINUSE' });
  assert.equal(f.counts().closed, 1); assert.equal(f.counts().warmed, 1);
  assert.equal(listener.listening, true);
});
