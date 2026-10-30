'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../extension/model-config-store.js');
const Profiles = require('../extension/model-profiles.js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(initial = {}, beforeSet) {
  const data = structuredClone(initial), writes = [];
  const store = Store.create({ storage: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, structuredClone(data[k])])); },
    async set(value) { writes.push(value); if (beforeSet) await beforeSet(value); Object.assign(data, structuredClone(value)); },
    async remove(keys) { keys.forEach(k => delete data[k]); }
  } });
  return { store, data, writes };
}
test('store migrates divergent legacy slots without writing and preserves provider extensions on save', async () => {
  const current = { model: 'direct', endpoint: 'https://direct.example', apiKey: 'fixture', enabled: true, custom: { a: 1 } };
  const compatibility = { model: 'magpie', endpoint: 'http://127.0.0.1:3425/v1', apiKey: 'local-app' };
  const engine = { provider: 'mjai', apiKey: 'engine-fixture', extension: 7 };
  const { store, data, writes } = setup({ modelConfig: current, analysisProviders: { chat: compatibility, mjai: engine }, unrelated: 'keep' });
  const loaded = await store.load();
  assert.equal(writes.length, 0); assert.equal(loaded.profiles.profiles.length, 2);
  assert.deepEqual(loaded.profiles.profiles.map(p => p.config.model).sort(), ['direct', 'magpie']);
  await store.save({ ...loaded, config: { ...loaded.drafts.chat, provider: 'chat' } });
  assert.equal(writes.length, 1); assert.equal(data.analysisProviders.mjai.apiKey, engine.apiKey); assert.equal(data.analysisProviders.mjai.extension, 7);
  assert.deepEqual(data.modelConfig.custom, { a: 1 }); assert.equal(data.unrelated, 'keep');
});
test('store destructive operations cancel queued saves and overwrite writes already started', async () => {
  for (const action of ['disable', 'clear']) {
    const gate = deferred(), started = deferred();
    const { store, data } = setup({ unrelated: 'keep', roundHistoryV1: [1], userMemoryV1: { fixture: true } }, async value => {
      if (value.modelConfig?.enabled) { started.resolve(); await gate.promise; }
    });
    const config = { provider: 'chat', enabled: true, model: 'fixture' }, profiles = Profiles.migrate({ modelConfig: config }), drafts = { chat: config };
    const saving = store.save({ config, profiles, drafts }); await started.promise;
    const queued = store.save({ config, profiles, drafts });
    const destructive = action === 'clear' ? store.clear() : store.disable({ profiles, drafts });
    gate.resolve(); await Promise.all([saving, queued, destructive]);
    assert.equal(action === 'clear' ? data.modelConfig : data.modelConfig.enabled, action === 'clear' ? undefined : false);
    assert.equal(data.unrelated, 'keep'); assert.deepEqual(data.roundHistoryV1, [1]); assert.deepEqual(data.userMemoryV1, { fixture: true });
    if (action === 'disable') { assert.equal(data.analysisProviders.chat.enabled, false); assert.equal(data.llmProfilesV1.profiles[0].config.enabled, false); }
    else assert.equal(data.llmProfilesV1, undefined);
  }
});
