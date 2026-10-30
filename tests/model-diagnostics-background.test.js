const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function worker() {
  let listener, changed, removed, requests = 0;
  const storage = {}, context = vm.createContext({ URL, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, setTimeout, clearTimeout, performance,
    chrome: { storage: { local: { setAccessLevel() {}, get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in storage).map(key => [key, structuredClone(storage[key])])),
      set: async value => Object.assign(storage, value) }, onChanged: { addListener: fn => { changed = fn; } } },
      permissions: { contains: async () => true, onRemoved: { addListener: fn => { removed = fn; } } }, tabs: { query: async () => [], sendMessage: async () => {} },
      runtime: { id: 'diagnostic-test', getURL: name => 'chrome-extension://diagnostic-test/' + name, onMessage: { addListener: fn => { listener = fn; } } } },
    fetch: () => { requests++; return new Promise(() => {}); } });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(require.resolve('../extension/background.js'), 'utf8'), context);
  const options = { id: 'diagnostic-test', url: 'chrome-extension://diagnostic-test/options.html' };
  const call = (message, sender = options) => new Promise(resolve => {
    let answered = false;
    const waiting = listener(message, sender, value => { answered = true; resolve(structuredClone(value)); });
    if (waiting !== true && !answered) resolve(undefined);
  });
  return { call, changed: (...args) => changed(...args), removed: (...args) => removed(...args), options, get requests() { return requests; } };
}
const message = { type: 'model:diagnose', requestId: 'manual-1', config: { endpoint: 'http://localhost:3425/v1', model: 'fake' } };
test('only exact extension options page can start diagnostics or discovery', async () => {
  const w = worker();
  for (const sender of [
    { id: 'foreign', url: w.options.url },
    { id: w.options.id, tab: { id: 1 }, frameId: 0, url: 'https://game.maj-soul.com/1/' },
    { id: w.options.id, url: w.options.url + '?other' },
    { id: w.options.id, url: 'chrome-extension://diagnostic-test/history.html' }
  ]) {
    assert.equal(await w.call(message, sender), undefined);
    assert.equal(await w.call({ ...message, type: 'model:discover', action: 'models' }, sender), undefined);
  }
  assert.equal(w.requests, 0);
});
test('options cancellation targets request id and configuration changes cancel diagnostics', async () => {
  const w = worker();
  const pending = w.call(message); await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.requests, 1);
  assert.deepEqual(await w.call({ type: 'model:cancel', requestId: 'wrong' }), { ok: true, cancelled: false });
  assert.deepEqual(await w.call({ type: 'model:cancel', requestId: message.requestId }), { ok: true, cancelled: true });
  assert.equal((await pending).code, 'CANCELLED');
  const next = w.call({ ...message, requestId: 'manual-2' }); await new Promise(resolve => setImmediate(resolve));
  await w.changed({ modelConfig: { newValue: {} } }, 'local');
  assert.equal((await next).code, 'CANCELLED');
  assert.deepEqual(await w.call({ type: 'model:cancel' }), { ok: false, cancelled: false });
});
test('revoked permissions and saved profile changes cancel pending operations', async () => {
  const w = worker();
  for (const cancel of [() => w.removed({ origins: ['http://localhost/*'] }), () => w.changed({ llmProfilesV1: { newValue: {} } }, 'local')]) {
    const pending = w.call({ ...message, type: 'model:discover', action: 'models' });
    await new Promise(resolve => setImmediate(resolve)); cancel();
    assert.equal((await pending).code, 'CANCELLED');
  }
});
