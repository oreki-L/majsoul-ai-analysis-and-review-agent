const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../extension/analysis.js');
const S = require('../extension/state.js');
const C = require('../extension/collector/snapshot-adapter.js');
const E = require('../extension/adapters/model-endpoint.js');
function state(source = 'replay') {
  const s = S.initial(source, 1); Object.assign(s, { round: { wind: 0, index: 0 }, scores: [25000, 25000, 25000, 25000], phase: 'playing', selfHand: ['1m', '0p'] });
  s.players.forEach((p, i) => { p.hand = [i + 1 + 's']; p.discards = [{ tile: i + 1 + 'p', tsumogiri: true }]; });
  s.account = 'PRIVATE'; s.players[0].token = 'SECRET'; return s;
}

const scope = { game: true, hand: true, rivers: 'all' };
const original = { model: 'original-mock', result: { task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: null, reasons: ['ORIGINAL_DECISION'] }, limitations: [] } };
async function save(w, position) {
  const snapshot = C.snapshot(state('live'), scope); snapshot.lastStep = position;
  const response = await w.call({ type: 'discussion:save', record: { snapshot, context: { identity: { matchId: 'acceptance', roundStartId: 'r' }, position }, type: 'combined', analysis: original } });
  assert.equal(response.ok, true); return response.record;
}
async function ask(w, record, question, token, selection = scope) {
  assert.equal((await w.call({ type: 'discussion:ask', id: record.id, question, token })).ok, true);
  return w.call({ type: 'model:analyze', provider: 'chat', discussionId: record.id, discussionToken: token, question, selection });
}
test('acceptance: historical model requests reject revoked scopes before any HTTP request', async () => {
  for (const selection of [undefined, { ...scope, hand: false }, { ...scope, game: false }, { ...scope, rivers: 'self' }, { ...scope, rivers: 'none' }]) {
    const w = worker(), record = await save(w, 1);
    await w.call({ type: 'discussion:ask', id: record.id, question: 'why', token: 'q' });
    const response = await w.call({ type: 'model:analyze', provider: 'chat', discussionId: record.id, discussionToken: 'q', question: 'why', selection });
    assert.equal(response.ok, false); assert.match(response.error, /授权/); assert.equal(w.requests.length, 0);
  }
});
test('acceptance: more than twelve decisions retain complete isolated chat in actual model prompt', async () => {
  const w = worker(), first = await save(w, 1);
  assert.equal((await ask(w, first, 'FIRST_PRIVATE_QUESTION', 'q1')).ok, true);
  for (let i = 2; i <= 15; i++) {
    const other = await save(w, i);
    assert.equal((await ask(w, other, 'OTHER_DECISION_'+i, 'q'+i)).ok, true);
  }
  assert.equal((await ask(w, first, 'CONTINUE_OLD_DECISION', 'q16')).ok, true);
  const request = JSON.parse(w.requests.at(-1).options.body);
  const prompt = JSON.stringify(request.messages);
  assert.match(prompt, /FIRST_PRIVATE_QUESTION/); assert.match(prompt, /ORIGINAL_DECISION/); assert.match(prompt, /CONTINUE_OLD_DECISION/);
  assert.doesNotMatch(prompt, /OTHER_DECISION_/);
  const list = await w.call({ type: 'discussion:list' });
  assert.equal(list.records.find(r => r.id === first.id).chat.length, 2);
});
test('acceptance: cancelled late worker answer preserves the original and does not reopen a removed card', async () => {
  const w = worker({ wait: true }), record = await save(w, 1);
  const pending = ask(w, record, 'cancel this question', 'cancel-q');
  for (let i = 0; i < 20 && !w.requests.length; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.requests.length, 1);
  await w.call({ type: 'discussion:patch', id: record.id, patch: { panel: false } });
  await w.call({ type: 'model:cancel' });
  assert.equal((await pending).ok, false);
  const loaded = (await w.call({ type: 'discussion:list' })).records.find(r => r.id === record.id);
  assert.equal(loaded.panel, false); assert.equal(loaded.chat[0].status, 'failed');
  assert.equal(loaded.analysis.result.decision.reasons[0], 'ORIGINAL_DECISION');
});
function worker(overrides = {}) {
  let listener, changed, requests = [], accessLevel, aborted = false, nextTimer = 0;
  const timers = new Map();
  const notifications = [], tabQueries = [];
  const config = { enabled: true, model: 'mock-model', endpoint: 'https://provider.example/v1/chat/completions', apiKey: 'test-key', ...overrides.config };
  const storage = { modelConfig: config };
  const context = vm.createContext({ URL, TextEncoder, TextDecoder, Uint8Array, AbortController, DOMException, structuredClone, performance,
    setTimeout: overrides.manualTimer ? (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; } : setTimeout,
    clearTimeout: overrides.manualTimer ? id => { timers.delete(id); } : clearTimeout,
    chrome: { storage: { local: { setAccessLevel: value => { accessLevel = value; },
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in storage).map(key => [key, structuredClone(storage[key])])),
      set: async value => { Object.assign(storage, structuredClone(value)); } }, onChanged: { addListener: fn => { changed = fn; } } },
      tabs: { query: async query => { tabQueries.push(query); return [{ id: 7 }, { id: 8 }]; },
        sendMessage: async (...args) => { notifications.push(args); if (args[0] === 8) throw new Error('Tab closed'); } },
      permissions: { contains: async () => overrides.permission !== false },
      runtime: { id: 'extension-id', getURL: path => 'chrome-extension://extension-id/' + path, openOptionsPage() {}, onMessage: { addListener: fn => { listener = fn; } } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (overrides.wait) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('abort', 'AbortError')); }));
      if (overrides.networkError) throw new TypeError('network');
      return new Response(overrides.raw ?? JSON.stringify(overrides.body ?? { choices: [{ message: { content: JSON.stringify({ task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: null, reasons: ['数据不足，无法建议弃牌。'] }, limitations: ['测试手牌数量不完整。'] }) } }] }), { status: overrides.status || 200 });
    } });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(require.resolve('../extension/background.js'), 'utf8'), context);
  const sender = { id: 'extension-id', tab: { id: 7 }, frameId: 0, url: 'https://game.maj-soul.com/1/' };
  const call = (message, from = sender) => new Promise(resolve => { if (listener(message, from, value => resolve(structuredClone(value))) !== true) resolve(undefined); });
  const analyze = (task = 'both', selection = { game: true, hand: true, rivers: 'all' }) => call({ type: 'model:analyze', task, snapshot: C.snapshot(state('live'), selection) });
  return { call, analyze, requests, notifications, tabQueries, expire: () => {
    // Browser timers fire in deadline order, with registration order breaking ties.
    const [id, timer] = [...timers].sort((a, b) => a[1].delay - b[1].delay)[0];
    timers.delete(id); timer.fn();
  }, changed: (...args) => changed(...args), sender, accessLevel, get aborted() { return aborted; } };
}
