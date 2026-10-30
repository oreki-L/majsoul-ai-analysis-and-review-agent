'use strict';
importScripts('contracts/snapshot.js', 'adapters/model-endpoint.js', 'adapters/engine-endpoint.js', 'adapters/mjai.js', 'mahjong-analysis.js', 'analysis.js');
importScripts('harness.js', 'agent.js');
importScripts('pi-runtime.js', 'round-context.js', 'model-usage.js', 'model-session-transport.js', 'agent-run-store.js');
importScripts('model-diagnostics.js');
importScripts('contracts/engine-result.js', 'engine-agent.js');
importScripts('history.js', 'history-storage.js', 'decision-discussions.js');
importScripts('user-memory.js', 'user-memory-agent.js', 'user-memory-worker.js');
importScripts('model-analysis-worker.js');
let analysisWorker;
const modelDiagnostics = MJModelDiagnostics.create({ permissions: chrome.permissions, fetchModel: (...args) => fetch(...args) });
chrome.permissions.onRemoved?.addListener(() => modelDiagnostics.cancel());
const discussions = MJDecisionDiscussions.create({ storage: chrome.storage.local });
const discussionReady = discussions.recover().catch(() => {});
const memoryWorker = MJUserMemoryWorker.create({ storage: chrome.storage.local, permissions: chrome.permissions,
  fetchModel: (...args) => fetch(...args), busy: () => analysisWorker?.busy() || false, runtime: MJPiRuntime, readJson: MJModelAnalysisWorker.readJson });
// Worker startup is a recovery opportunity, not a promise of background execution.
const roundContexts = MJRoundContext.createStore({ storage: chrome.storage.local });
const runStore = MJRunStore.create({ storage: chrome.storage.local });
analysisWorker = MJModelAnalysisWorker.create({ storage: chrome.storage.local, permissions: chrome.permissions,
  fetchModel: (...args) => fetch(...args), runtime: MJPiRuntime, roundContexts, runStore, discussions, discussionReady, memoryWorker });
memoryWorker.pump();
async function clearAgentData(clearRuns = true) {
  modelDiagnostics.cancel();
  await analysisWorker.invalidate(clearRuns);
}
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.modelConfig || changes.llmProfilesV1 || changes.analysisProviders)) modelDiagnostics.cancel();
  if (area !== 'local' || !changes.modelConfig) return;
  analysisWorker.cancelAll();
  // Content scripts cannot observe changes to TRUSTED_CONTEXTS storage.
  // Send only an invalidation signal; credentials stay in the worker.
  memoryWorker.cancel();
  return Promise.allSettled([clearAgentData(false), memoryWorker.store.invalidate()]).then(notifyModelConfigChanged);
});
async function notifyModelConfigChanged() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://game.maj-soul.com/*' });
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
      chrome.tabs.sendMessage(tab.id, { type: 'model:config-changed' }, { frameId: 0 })));
  } catch (_) { /* Tabs may close or unload while the configuration is saved. */ }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const game = sender.tab && sender.frameId === 0 && sender.url?.startsWith('https://game.maj-soul.com/');
  const optionsPage = sender.url === chrome.runtime.getURL?.('options.html');
  if (optionsPage && ['model:diagnose', 'model:discover'].includes(message?.type)) {
    modelDiagnostics.run(message).then(respond); return true;
  }
  if (optionsPage && message?.type === 'model:cancel') {
    const valid = typeof message.requestId === 'string' && /^[\w-]{1,100}$/.test(message.requestId);
    respond({ ok: valid, cancelled: valid && modelDiagnostics.cancel(message.requestId) }); return;
  }
  if (message?.type === 'memory:status' && (game || optionsPage)) {
    memoryWorker.store.status().then(value => respond(game ? { enabled: value.enabled, generation: value.generation } : { ok: true, ...value })).catch(() => respond({ ok: false })); return true;
  }
  if (message?.type === 'memory:evidence' && game) {
    if (!Number.isSafeInteger(message.evidence?.generation)) { respond({ ok: false }); return; }
    memoryWorker.store.ingest(message.evidence).then(value => { respond({ ok: true, ...value }); memoryWorker.pump(); }).catch(() => respond({ ok: false })); return true;
  }
  if (message?.type === 'memory:round-start' && game) {
    const identity = message.identity || {};
    memoryWorker.store.pin(`${sender.tab.id}:${identity.matchId}:${identity.roundStartId}`).then(() => respond({ ok: true })).catch(() => respond({ ok: false })); return true;
  }
  if (['memory:configure', 'memory:edit', 'memory:clear'].includes(message?.type) && optionsPage) {
    memoryWorker.cancel();
    const operation = message.type === 'memory:clear' ? memoryWorker.store.clear()
      : message.type === 'memory:configure' ? memoryWorker.store.configure(message.enabled) : memoryWorker.store.edit(message.edit || {});
    Promise.all([operation, clearAgentData(false)]).then(([value]) => { respond({ ok: true, ...value }); notifyModelConfigChanged(); }).catch(() => respond({ ok: false, error: '记忆更新失败，请重试。' })); return true;
  }
  if (message?.type === 'agent:usage'  && sender.url === chrome.runtime.getURL?.('options.html')) {
    runStore.list().then(records => respond({ ok: true, records })).catch(() => respond({ ok: false, error: '读取用量记录失败。' })); return true;
  }
  if (message?.type === 'agent:clear-data' && !sender.tab?.url?.startsWith('https://game.maj-soul.com/') && sender.url === chrome.runtime.getURL?.('options.html')) {
    clearAgentData().then(() => respond({ ok: true })).catch(() => respond({ ok: false, error: '清除本地记录失败，请重试。' })); return true;
  }
  if (message?.type?.startsWith('discussion:') && game) {
    (async () => {
      await discussionReady;
      switch (message.type) {
        case 'discussion:list': return { ok: true, records: await discussions.list() };
        case 'discussion:save': return { ok: true, record: await discussions.save(message.record) };
        case 'discussion:patch': return { ok: true, record: await discussions.patch(message.id, message.patch || {}) };
        case 'discussion:ask': return { ok: true, record: await discussions.ask(message.id, message.question, message.token) };
      }
      throw new Error('未知讨论操作。');
    })().then(respond).catch(e => respond({ ok: false, error: e.message })); return true;
  }
  if (message?.type === 'model:settings' && game) { chrome.runtime.openOptionsPage(); respond({ ok: true }); return; }
  if (message?.type === 'model:preferences' && game) {
    const p = message.preferences || {}, preferences = {};
    for (const key of ['danger', 'efficiency', 'strategy', 'automatic', 'useModel']) preferences[key] = p[key] === true;
    for (const [key, min, max, fallback] of [['modelFromTurn', 1, 18, 1], ['interval', 1, 60, 8], ['limit', 1, 100, 20]]) preferences[key] = Number.isFinite(p[key]) ? Math.min(max, Math.max(min, Math.trunc(p[key]))) : fallback;
    chrome.storage.local.set({ analysisPreferences: preferences }).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
    return true;
  }
  if (message?.type === 'model:status' && game) {
    chrome.storage.local.get(['modelConfig', 'analysisPreferences']).then(({ modelConfig: c, analysisPreferences }) => respond({ preferences: analysisPreferences, enabled: !!c?.enabled, model: c?.model || '', provider: c?.provider === 'mjai' ? 'mjai' : 'chat' })).catch(() => respond({ enabled: false, provider: 'chat' })); return true;
  }
  if (message?.type === 'model:cancel' && game) { analysisWorker.cancel(sender.tab.id); respond({ ok: true }); return; }
  if (message?.type === 'model:prepare' && game) {
    analysisWorker.prepare(message).then(respond);
    return true;
  }
  if (message?.type !== 'model:analyze' || !game) return;
  analysisWorker.analyze(message, sender.tab.id).then(respond);
  return true;
});
