'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function independentWorker() {
  const context = vm.createContext({ AbortController, setTimeout, clearTimeout, TextDecoder, Uint8Array,
    MJAnalysis: require('../extension/analysis.js') });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/model-analysis-worker.js'), 'utf8'), context);
  return context.MJModelAnalysisWorker;
}
test('analysis service can be injected without Chrome, background listeners, DOM or networking', async () => {
  const api = independentWorker(), reads = [], calls = { cancel: 0, pump: 0, reset: 0, runs: 0, discussions: 0 }, writes = [];
  const service = api.create({ storage: { get: () => new Promise(resolve => reads.push(resolve)), set: async v => writes.push(v) },
    permissions: { contains() { throw Error('must not reach permissions'); } }, fetchModel() { throw Error('must not reach network'); }, runtime: {},
    roundContexts: { reset: async () => { calls.reset++; } }, runStore: { clear: async () => { calls.runs++; } },
    discussions: { clear: async () => { calls.discussions++; } }, discussionReady: Promise.resolve(),
    memoryWorker: { cancel: () => { calls.cancel++; }, pump: () => { calls.pump++; } } });
  const first = service.analyze({}, 1), second = service.analyze({}, 2);
  assert.equal(service.busy(), true); assert.equal(reads.length, 2);
  const duplicate = await service.analyze({}, 1); assert.match(duplicate.error, /已有分析/);
  service.cancel(1); reads[0]({ modelConfig: { enabled: true } });
  assert.match((await first).error, /取消/); assert.equal(service.busy(), true);
  reads[1]({}); assert.match((await second).error, /开启模型/); assert.equal(service.busy(), false);
  assert.equal(calls.cancel, 2); assert.equal(calls.pump, 2);
  await service.invalidate(false); assert.equal(calls.reset, 1); assert.equal(calls.runs, 0); assert.equal(calls.discussions, 0);
  await service.invalidate(); assert.equal(calls.reset, 2); assert.equal(calls.runs, 1); assert.equal(calls.discussions, 1);
  assert.equal(writes.length, 2); assert.notEqual(writes[0].agentConfigRevision, writes[1].agentConfigRevision);
  assert.equal((await service.prepare({ snapshot: null })).ok, false);
});
