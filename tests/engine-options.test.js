'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Endpoint = require('../extension/adapters/engine-endpoint.js');
const ChatEndpoint = require('../extension/adapters/model-endpoint.js');

async function settings(initial = {}, { permission = true, beforeSet, clearResult = { ok: true }, usageResult, modelResult } = {}) {
  const data = structuredClone(initial), calls = [], elements = new Map(), downloads = [];
  for (const id of ['profilesPanel', 'profile', 'profileName', 'newProfile', 'magpiePreset', 'ccSwitchPreset', 'loadCcSwitchModels', 'deleteProfile', 'discoveredModels', 'diagnosticStatus', 'diagnose', 'cancelDiagnostic', 'magpieHello', 'loadModels', 'status', 'provider', 'providerHint', 'engineSetup', 'engineGuide', 'enabled', 'endpoint', 'endpointHint', 'model', 'key', 'keyLabel', 'chatOptions', 'thinking', 'thinkingHint', 'maxTokens', 'priceCurrency', 'priceInput', 'priceOutput', 'priceCacheRead', 'priceCacheWrite', 'config', 'disable', 'clear', 'clearAgentData', 'exportUsage']) elements.set(id, { value: '', checked: false, textContent: '', children: [], replaceChildren() { this.children = []; }, appendChild(item) { this.children.push(item); } });
  const local = {
    get: async keys => { calls.push(['get']); return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, structuredClone(data[key])])); },
    set: async value => { const copied = structuredClone(value); calls.push(['set']); if (beforeSet) await beforeSet(copied); Object.assign(data, copied); },
    remove: async keys => { calls.push(['remove']); for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
  const context = vm.createContext({ Blob, setTimeout, structuredClone, URL: {
    createObjectURL(blob) { downloads.push({ blob }); return 'blob:usage-' + downloads.length; },
    revokeObjectURL(url) { calls.push(['revoke', url]); }
  }, document: { getElementById: id => elements.get(id), body: { appendChild() {} }, createElement(tag) {
    if (tag === 'option') return { value: '', textContent: '' };
    assert.equal(tag, 'a'); return { click() { Object.assign(downloads.at(-1), { href: this.href, filename: this.download }); calls.push(['download']); }, remove() {} };
  } }, chrome: { storage: { local }, runtime: { sendMessage: async message => {
    calls.push(['message', structuredClone(message)]);
    if (message.type.startsWith('model:')) return typeof modelResult === 'function' ? modelResult(message) : modelResult || clearResult;
    if (message.type === 'agent:usage') return usageResult || { ok: true, records: structuredClone(data.agentRunsV1 || []) };
    if (clearResult.ok) { delete data.agentRoundContextV1; delete data.agentRunsV1; }
    return clearResult;
  } }, permissions: { request: async value => { calls.push(['permission', value]); return permission; } } }, MJModelConfigStore: require('../extension/model-config-store.js'), MJModelProfiles: require('../extension/model-profiles.js'), MJModelEndpoint: ChatEndpoint, MJEngineEndpoint: Endpoint });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/options.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const el = id => elements.get(id);
  return { data, calls, downloads, el, select(provider) { el('provider').value = provider; el('provider').onchange(); }, submit() { return el('config').onsubmit({ preventDefault() {} }); } };
}

test('mjai endpoint is strictly local HTTP analyze and exposes host-only permissions', () => {
  for (const value of ['http://127.0.0.1:17341/analyze', 'http://localhost:8080/analyze']) {
    assert.equal(Endpoint.endpoint(value).href, value);
  }
  assert.equal(Endpoint.permissionOrigin('http://localhost:17341/analyze'), 'http://localhost/*');
  for (const value of ['https://localhost/analyze', 'http://example.com/analyze', 'http://127.0.0.2/analyze', 'http://127.1/analyze', 'http://localhost/chat/completions', 'http://localhost/analyze/', 'http://localhost/analyze?token=x', 'http://localhost/analyze?', 'http://localhost/analyze#', 'http://user:password@localhost/analyze', 'http://localhost/a/../analyze']) assert.throws(() => Endpoint.endpoint(value), value);
});

test('settings default to disabled chat and old configurations remain chat only', async () => {
  const empty = await settings();
  assert.equal(empty.el('provider').value, 'chat'); assert.equal(empty.el('enabled').checked, false);
  assert.equal(empty.el('engineSetup').hidden, true);
  assert.equal(empty.el('key').value, ''); assert.equal(empty.calls.some(c => c[0] === 'set'), false);
  const legacy = await settings({ modelConfig: { enabled: true, endpoint: 'https://example.com/v1/chat/completions', model: 'old-model', apiKey: 'CHAT_SECRET' } });
  assert.equal(legacy.el('provider').value, 'chat'); assert.equal(legacy.el('key').value, 'CHAT_SECRET');
  legacy.select('mjai');
  assert.equal(legacy.el('engineSetup').hidden, false);
  assert.equal(legacy.el('engineGuide').href, 'https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/blob/main/docs/MJAI.md');
  assert.equal(legacy.el('enabled').checked, false); assert.equal(legacy.el('key').value, '');
  assert.equal(legacy.el('endpoint').value, 'http://127.0.0.1:17341/analyze');
  assert.equal(legacy.el('model').value, 'mjai'); assert.equal(legacy.el('model').readOnly, true);
  assert.match(legacy.el('providerHint').textContent, /手动启动/); assert.match(legacy.el('providerHint').textContent, /不捆绑权重/);
  legacy.el('key').value = 'ENGINE_SECRET'; legacy.select('chat');
  assert.equal(legacy.el('engineSetup').hidden, true);
  assert.equal(legacy.el('key').value, 'CHAT_SECRET');
  legacy.select('mjai'); assert.equal(legacy.el('key').value, 'ENGINE_SECRET');
});

test('chat settings save and display the resolved request URL from a base URL', async () => {
  const page = await settings();
  page.el('endpoint').value = 'https://api.deepseek.com'; page.el('model').value = 'deepseek-flash';
  await page.submit();
  assert.equal(page.data.modelConfig.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(page.data.analysisProviders.chat.endpoint, page.data.modelConfig.endpoint);
  assert.equal(page.el('endpoint').value, page.data.modelConfig.endpoint);
  assert.deepEqual(Array.from(page.calls.find(call => call[0] === 'permission')[1].origins), ['https://api.deepseek.com/*']);
});

test('mjai token is required and permission runs before asynchronous storage', async () => {
  const page = await settings(); page.select('mjai');
  await page.submit(); assert.match(page.el('status').textContent, /Bearer Token/);
  assert.equal(page.calls.some(c => c[0] === 'permission'), false); assert.equal('modelConfig' in page.data, false);
  page.el('key').value = 'ENGINE_SECRET'; page.el('enabled').checked = true;
  const before = page.calls.length, pending = page.submit();
  assert.equal(page.calls[before][0], 'permission');
  assert.deepEqual(JSON.parse(JSON.stringify(page.calls[before][1])), { origins: ['http://127.0.0.1/*'] });
  await pending;
  assert.deepEqual(page.data.modelConfig, { provider: 'mjai', enabled: true, endpoint: 'http://127.0.0.1:17341/analyze', model: 'mjai', apiKey: 'ENGINE_SECRET' });
  assert.equal(page.data.analysisProviders.mjai.apiKey, 'ENGINE_SECRET');
});

test('thinking defaults off, follows mode defaults and preserves custom output limits across providers and reload', async () => {
  const page = await settings({ modelConfig: { enabled: true, endpoint: 'https://api.deepseek.com', model: 'deepseek-flash' } });
  assert.equal(page.el('thinking').checked, false); assert.equal(page.el('thinking').disabled, false);
  assert.equal(Number(page.el('maxTokens').value), 8192);
  page.el('thinking').checked = true; page.el('thinking').onchange();
  assert.equal(Number(page.el('maxTokens').value), 32768);
  page.el('maxTokens').value = '16000';
  page.el('thinking').checked = false; page.el('thinking').onchange();
  assert.equal(Number(page.el('maxTokens').value), 16000);
  page.el('thinking').checked = true; page.el('thinking').onchange();
  page.select('mjai'); assert.equal(page.el('chatOptions').hidden, true); assert.equal(page.el('maxTokens').disabled, true);
  page.select('chat'); assert.equal(page.el('thinking').checked, true);
  await page.submit();
  assert.equal(page.data.modelConfig.thinking, true); assert.equal(page.data.modelConfig.maxTokens, 16000);
  const reloaded = await settings(page.data);
  assert.equal(reloaded.el('thinking').checked, true); assert.equal(Number(reloaded.el('maxTokens').value), 16000);
});

test('invalid output limits save nothing and unsupported services cannot enable thinking', async () => {
  const page = await settings();
  page.el('endpoint').value = 'https://provider.example/v1'; page.el('model').value = 'chat'; page.el('endpoint').oninput();
  assert.equal(page.el('thinking').disabled, true);
  for (const value of ['', '0', '1.5', '393217', 'NaN']) {
    page.el('maxTokens').value = value; await page.submit();
    assert.match(page.el('status').textContent, /输出上限/);
    assert.equal('modelConfig' in page.data, false);
  }
  page.el('maxTokens').value = '12000'; page.el('thinking').checked = true;
  await page.submit(); assert.equal(page.data.modelConfig.thinking, false);
});

test('settings preserve per-provider secrets across reload and clear both providers', async () => {
  const page = await settings({ modelConfig: { provider: 'chat', enabled: false, endpoint: 'https://example.com/v1/chat/completions', model: 'chat-id', apiKey: 'CHAT_SECRET' } });
  page.select('mjai'); page.el('key').value = 'ENGINE_SECRET'; await page.submit();
  assert.equal(page.data.analysisProviders.chat.apiKey, 'CHAT_SECRET');
  const reloaded = await settings(page.data); assert.equal(reloaded.el('key').value, 'ENGINE_SECRET');
  reloaded.select('chat'); assert.equal(reloaded.el('key').value, 'CHAT_SECRET');
  await reloaded.submit(); assert.equal(reloaded.data.modelConfig.provider, 'chat'); assert.equal(reloaded.data.modelConfig.apiKey, 'CHAT_SECRET');
  await reloaded.el('clear').onclick();
  assert.equal('modelConfig' in reloaded.data, false); assert.equal('analysisProviders' in reloaded.data, false);
  assert.equal(reloaded.el('provider').value, 'chat'); assert.equal(reloaded.el('enabled').checked, false);
  reloaded.select('mjai'); assert.equal(reloaded.el('key').value, ''); reloaded.select('chat'); assert.equal(reloaded.el('key').value, '');
});

test('permission denial saves nothing, chat validation is preserved, disable closes stored providers', async () => {
  const denied = await settings({}, { permission: false }); denied.select('mjai'); denied.el('key').value = 'ENGINE'; await denied.submit();
  assert.match(denied.el('status').textContent, /未授予/); assert.equal('modelConfig' in denied.data, false);
  const page = await settings(); page.el('endpoint').value = 'http://example.com/v1/chat/completions'; page.el('model').value = 'chat'; await page.submit();
  assert.equal(page.calls.some(c => c[0] === 'permission'), false);
  page.el('endpoint').value = 'https://example.com/v1/chat/completions'; page.el('enabled').checked = true; await page.submit();
  assert.equal(page.data.modelConfig.provider, 'chat'); assert.equal(page.data.modelConfig.apiKey, '');
  page.select('mjai'); page.el('key').value = 'ENGINE'; page.el('enabled').checked = true; await page.submit();
  await page.el('disable').onclick();
  assert.equal(page.data.modelConfig.enabled, false); assert.equal(page.data.analysisProviders.chat.enabled, false); assert.equal(page.data.analysisProviders.mjai.enabled, false);
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const savedChat = () => ({ modelConfig: { provider: 'chat', enabled: true, endpoint: 'https://example.com/v1/chat/completions', model: 'chat', apiKey: 'EXISTING_SECRET' } });

test('disable and clear invalidate saves waiting for permission without restoring captured keys or enabled state', async () => {
  for (const action of ['disable', 'clear']) {
    const permission = deferred();
    const page = await settings(savedChat(), { permission: permission.promise });
    page.el('key').value = 'PENDING_SECRET'; page.el('enabled').checked = true;
    const saving = page.submit();
    assert.equal(page.calls.at(-1)[0], 'permission');
    await page.el(action).onclick();
    const status = page.el('status').textContent, writes = page.calls.filter(c => c[0] === 'set').length;
    permission.resolve(true); await saving;
    assert.equal(page.calls.filter(c => c[0] === 'set').length, writes);
    assert.equal(page.el('status').textContent, status);
    assert.equal(page.el('enabled').checked, false);
    assert.equal(JSON.stringify(page.data).includes('PENDING_SECRET'), false);
    if (action === 'disable') { assert.equal(page.data.modelConfig.enabled, false); assert.equal(page.data.modelConfig.apiKey, 'EXISTING_SECRET'); }
    else { assert.equal('modelConfig' in page.data, false); assert.equal('analysisProviders' in page.data, false); assert.equal(page.el('key').value, ''); }
  }
});

test('disable and clear serialize after an already-started save storage write', async () => {
  for (const action of ['disable', 'clear']) {
    const storage = deferred(), started = deferred(); let writes = 0;
    const page = await settings(savedChat(), { beforeSet: async () => { if (++writes === 1) { started.resolve(); await storage.promise; } } });
    page.el('key').value = 'NEW_SECRET'; page.el('enabled').checked = true;
    const saving = page.submit(); await started.promise;
    const stopping = page.el(action).onclick();
    await new Promise(resolve => setImmediate(resolve));
    // Neither disable's write nor clear's removal may overtake the in-flight save.
    assert.equal(writes, 1); assert.equal(page.calls.some(c => c[0] === 'remove'), false);
    storage.resolve(); await Promise.all([saving, stopping]);
    assert.equal(page.el('enabled').checked, false);
    if (action === 'disable') { assert.equal(page.data.modelConfig.enabled, false); assert.match(page.el('status').textContent, /已关闭/); }
    else {
      assert.equal('modelConfig' in page.data, false); assert.equal('analysisProviders' in page.data, false);
      assert.equal(page.el('key').value, ''); assert.match(page.el('status').textContent, /已清除/);
      page.select('mjai'); assert.equal(page.el('key').value, ''); page.select('chat'); assert.equal(page.el('key').value, '');
    }
  }
});

test('chat always saves round and enabled tools while optional prices remain unknown', async () => {
  const previous = savedChat(); Object.assign(previous.modelConfig, { contextMode: 'snapshot', toolCalling: false });
  const page = await settings(previous);
  assert.equal(page.el('priceCurrency').value, ''); assert.equal(page.el('priceInput').value, '');
  await page.submit();
  assert.equal(page.data.modelConfig.contextMode, 'round'); assert.equal(page.data.modelConfig.toolCalling, true);
  assert.deepEqual(page.data.modelConfig.pricing, { currency: null, input: null, output: null, cacheRead: null, cacheWrite: null });
});

test('chat context, tools and prices survive provider drafts, save and reload while mjai stays unchanged', async () => {
  const page = await settings(savedChat());
  page.el('priceCurrency').value = ' CNY '; page.el('priceInput').value = '2'; page.el('priceOutput').value = '8.5';
  page.el('priceCacheRead').value = '0';
  page.select('mjai');
  assert.equal(page.el('priceInput').disabled, true);
  page.el('key').value = 'ENGINE'; await page.submit();
  assert.deepEqual(page.data.modelConfig, { provider: 'mjai', enabled: false, endpoint: 'http://127.0.0.1:17341/analyze', model: 'mjai', apiKey: 'ENGINE' });
  const page2 = await settings(page.data); page2.select('chat');
  assert.equal(page2.el('priceInput').disabled, false); assert.equal(page2.el('priceInput').value, '2');
  await page2.submit();
  assert.deepEqual(page2.data.modelConfig.pricing, { currency: 'CNY', input: 2, output: 8.5, cacheRead: 0, cacheWrite: null });
  assert.deepEqual(page2.data.analysisProviders.chat.pricing, page2.data.modelConfig.pricing);
  const reloaded = await settings(page2.data);
  assert.equal(reloaded.el('priceOutput').value, '8.5'); assert.equal(reloaded.el('priceCacheWrite').value, '');
});

test('invalid prices are rejected before permission while blank and zero prices are valid', async () => {
  const page = await settings(savedChat());
  for (const value of ['-1', 'NaN', 'Infinity', 'invalid']) {
    page.el('priceInput').value = value;
    const before = page.calls.length;
    await page.submit();
    assert.match(page.el('status').textContent, /非负数字/);
    assert.equal(page.calls.slice(before).some(call => call[0] === 'permission'), false);
    assert.equal(page.data.modelConfig.pricing, undefined);
  }
  page.el('priceInput').value = '0'; await page.submit();
  assert.equal(page.data.modelConfig.pricing.input, 0); assert.equal(page.data.modelConfig.pricing.currency, null);
});

test('clear data uses the trusted options message, keeps settings and clears both stored session keys', async () => {
  const initial = { ...savedChat(), agentRoundContextV1: { PRIVATE: 'hand' }, agentRunsV1: [{ usage: 'tokens' }] };
  const page = await settings(initial);
  await page.el('clearAgentData').onclick();
  assert.deepEqual(page.calls.find(call => call[0] === 'message')[1], { type: 'agent:clear-data' });
  assert.deepEqual(page.data.modelConfig, initial.modelConfig);
  assert.equal('agentRoundContextV1' in page.data, false); assert.equal('agentRunsV1' in page.data, false);
  assert.match(page.el('status').textContent, /已清除本地会话和运行用量/);
  assert.equal(page.el('clearAgentData').disabled, false);
  const failed = await settings(initial, { clearResult: { ok: false, error: '暂时无法清除。' } });
  await failed.el('clearAgentData').onclick();
  assert.match(failed.el('status').textContent, /暂时无法清除/);
  assert.equal('agentRunsV1' in failed.data, true);
  await failed.el('clear').onclick();
  assert.equal('modelConfig' in failed.data, false); assert.equal('agentRoundContextV1' in failed.data, false); assert.equal('agentRunsV1' in failed.data, false);
});

test('usage export downloads local numeric records with snapshot/round metadata and revokes its URL', async () => {
  const records = ['snapshot', 'round'].map((mode, index) => ({ at: 1700000000000 + index, status: 'completed', mode, lane: 'manual-review',
    elapsedMs: 100, calls: 1, usage: { inputTokens: 100 + index, outputTokens: 20, cacheReadTokens: index ? 80 : null },
    cost: { currency: 'USD', totalCost: null } }));
  const initial = { ...savedChat(), agentRunsV1: records, agentRoundContextV1: { prompt: 'PRIVATE_PROMPT' } };
  const page = await settings(initial);
  await page.el('exportUsage').onclick();
  assert.deepEqual(page.calls.find(call => call[0] === 'message')[1], { type: 'agent:usage' });
  assert.equal(page.downloads.length, 1);
  const download = page.downloads[0], text = await download.blob.text(), exported = JSON.parse(text);
  assert.equal(exported.format, 'mj-agent-usage-v1'); assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
  assert.deepEqual(exported.records, records);
  assert.equal(download.blob.type, 'application/json;charset=utf-8');
  assert.match(download.filename, /^mahjong-usage-.*\.json$/);
  assert.doesNotMatch(text, /EXISTING_SECRET|PRIVATE_PROMPT|example\.com|apiKey/);
  assert.deepEqual(page.data, initial);
  assert.equal(page.el('exportUsage').disabled, false); assert.match(page.el('status').textContent, /已导出 2 条/);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(page.calls.find(call => call[0] === 'revoke'), ['revoke', download.href]);
});

test('empty usage can be exported and failed usage reads never download', async () => {
  const empty = await settings(); await empty.el('exportUsage').onclick();
  assert.deepEqual(JSON.parse(await empty.downloads[0].blob.text()).records, []);
  for (const usageResult of [{ ok: false, error: '无法读取用量。' }, { ok: true, records: null }]) {
    const page = await settings({}, { usageResult }); await page.el('exportUsage').onclick();
    assert.equal(page.downloads.length, 0); assert.equal(page.el('exportUsage').disabled, false);
    assert.match(page.el('status').textContent, /读取用量/);
  }
});


test('named profiles preserve direct and Magpie settings and selecting never enables analysis', async () => {
  const page = await settings(savedChat());
  page.el('magpiePreset').onclick();
  assert.equal(page.el('endpoint').value, 'http://127.0.0.1:3425/v1');
  assert.equal(page.el('key').value, 'magpie-majsoul-agent');
  assert.equal(page.el('enabled').checked, false);
  page.el('model').value = 'provider/model'; await page.submit();
  assert.equal(page.data.modelConfig.model, 'provider/model');
  assert.equal(page.data.modelConfig.enabled, false);
  assert.equal(page.data.llmProfilesV1.profiles.length, 2);
  const direct = page.data.llmProfilesV1.profiles.find(p => p.config.apiKey === 'EXISTING_SECRET');
  page.el('profile').value = direct.id; page.el('profile').onchange();
  assert.equal(page.el('enabled').checked, false); assert.equal(page.el('key').value, 'EXISTING_SECRET');
  await page.submit();
  assert.equal(page.data.modelConfig.enabled, false); assert.equal(page.data.modelConfig.model, 'chat');
  const reload = await settings(page.data); assert.equal(reload.el('key').value, 'EXISTING_SECRET');
  await reload.el('clear').onclick(); assert.equal('llmProfilesV1' in reload.data, false);
});

test('model discovery requests permission and does not alter a manually entered model or saved configuration', async () => {
  const page = await settings(savedChat(), { clearResult: { ok: true, models: [{ id: 'group/name', name: 'Group' }] } });
  const initial = structuredClone(page.data);
  await page.el('loadModels').onclick();
  assert.equal(page.el('model').value, 'chat'); assert.deepEqual(page.data, initial);
  assert.equal(page.el('discoveredModels').children[1].value, 'group/name');
  page.el('discoveredModels').value = 'group/name'; page.el('discoveredModels').onchange();
  assert.equal(page.el('model').value, 'group/name');
  const denied = await settings(savedChat(), { permission: false });
  await denied.el('diagnose').onclick();
  assert.equal(denied.calls.some(c => c[0] === 'message'), false);
  assert.match(denied.el('diagnosticStatus').textContent, /未授予/);
});


test('failed and stale model discovery preserve hand input and previous directory', async () => {
  const pending = deferred(); let index = 0;
  const page = await settings(savedChat(), { modelResult: message => {
    if (message.type === 'model:cancel') return { ok: true };
    return ++index === 1 ? { ok: true, models: [{ id: 'saved/model' }] } : index === 2 ? { ok: false, error: '服务不可达。' } : pending.promise;
  } });
  await page.el('loadModels').onclick();
  await page.el('loadModels').onclick();
  assert.equal(page.el('discoveredModels').children[1].value, 'saved/model');
  assert.equal(page.el('model').value, 'chat');
  const loading = page.el('loadModels').onclick();
  await new Promise(resolve => setImmediate(resolve));
  page.el('model').value = 'manual/group'; page.el('model').oninput();
  pending.resolve({ ok: true, models: [{ id: 'stale/model' }] }); await loading;
  assert.equal(page.el('discoveredModels').children[1].value, 'saved/model');
  assert.equal(page.el('model').value, 'manual/group');
  assert.equal(page.el('diagnosticStatus').textContent, '');
});

test('saving switched named profile preserves mjai credentials and permission denial leaves active config intact', async () => {
  const initial = { ...savedChat(), analysisProviders: { mjai: { provider: 'mjai', enabled: true, endpoint: 'http://localhost:17341/analyze', model: 'mjai', apiKey: 'ENGINE_PRIVATE' } } };
  const page = await settings(initial, { permission: false });
  page.el('magpiePreset').onclick(); page.el('model').value = 'route/group'; await page.submit();
  assert.deepEqual(page.data, initial); assert.equal(page.el('enabled').checked, false);
  assert.equal(page.el('key').value, 'magpie-majsoul-agent');
  const allowed = await settings(initial); allowed.el('magpiePreset').onclick(); allowed.el('model').value = 'route/group'; await allowed.submit();
  assert.deepEqual(allowed.data.analysisProviders.mjai, initial.analysisProviders.mjai);
  assert.equal(allowed.data.modelConfig.enabled, false);
});


test('discovered model IDs including route group whitespace are saved without rewriting', async () => {
  const page = await settings(savedChat(), { modelResult: { ok: true, models: [{ id: ' route group ' }] } });
  await page.el('loadModels').onclick();
  page.el('discoveredModels').value = ' route group '; page.el('discoveredModels').onchange(); await page.submit();
  assert.equal(page.data.modelConfig.model, ' route group ');
});


// This fixture calls property handlers directly: it does not implement native
// DOM select behavior or automatic input/change bubbling. Actual options.html
// browser QA is recorded in docs/MODEL_CONFIGURATION.md; explicit parent calls
// here exercise its guard order.
test('model directory is scoped to profile, normalized endpoint and effective Bearer credential', async () => {
  const page = await settings(savedChat(), { modelResult: { ok: true, models: [{ id: 'old-provider/model' }] } });
  const load = () => page.el('loadModels').onclick();
  const input = id => { page.el(id).oninput?.(); page.el('config').oninput(); };
  const empty = () => { assert.equal(page.el('discoveredModels').disabled, true); assert.equal(page.el('discoveredModels').children.length, 1); };
  await load();
  // Base and full Chat Completions URLs identify the same service.
  page.el('endpoint').value = 'https://example.com/v1'; input('endpoint');
  assert.equal(page.el('discoveredModels').children[1].value, 'old-provider/model');
  page.el('key').value = 'different-token'; input('key'); empty(); assert.equal(page.el('model').value, 'chat');
  await load(); page.el('endpoint').value = 'https://second.invalid/v1'; input('endpoint'); empty();
  await load();
  const directId = page.el('profile').value;
  page.el('magpiePreset').onclick(); empty(); assert.equal(page.el('model').value, '');
  await load();
  page.el('profile').value = directId; page.el('config').oninput(); page.el('profile').onchange(); empty();
  await load(); page.el('deleteProfile').onclick(); empty();
  await load(); await page.el('clear').onclick(); empty();
});

test('directory selection refuses a previous identity and late responses never restore it', async () => {
  const pending = deferred(); let count = 0;
  const page = await settings(savedChat(), { modelResult: message => message.type === 'model:cancel' ? { ok: true } : ++count === 1 ? { ok: true, models: [{ id: 'old-provider/model' }] } : pending.promise });
  await page.el('loadModels').onclick();
  const loading = page.el('loadModels').onclick(); await new Promise(resolve => setImmediate(resolve));
  // Guard against changed field values even before an input event is delivered.
  page.el('key').value = 'another-token'; page.el('discoveredModels').value = 'old-provider/model'; page.el('discoveredModels').onchange();
  assert.equal(page.el('model').value, 'chat'); assert.equal(page.el('discoveredModels').disabled, true);
  pending.resolve({ ok: true, models: [{ id: 'stale/model' }] }); await loading;
  assert.equal(page.el('discoveredModels').children.length, 1);
});

test('invalid profile names block provider and profile changes without losing drafts or throwing', async () => {
  for (const name of ['', 'Magpie']) {
    const page = await settings(savedChat());
    page.el('magpiePreset').onclick();
    const magpie = page.el('profile').value;
    page.el('profile').value = 'profile-1'; page.el('profile').onchange();
    page.el('profileName').value = name; page.el('model').value = 'unsaved/model'; page.el('key').value = 'UNSAVED_TOKEN';
    page.el('provider').value = 'mjai';
    assert.doesNotThrow(() => page.el('provider').onchange());
    assert.equal(page.el('provider').value, 'chat'); assert.equal(page.el('profilesPanel').hidden, false);
    assert.equal(page.el('profileName').value, name); assert.equal(page.el('model').value, 'unsaved/model'); assert.equal(page.el('key').value, 'UNSAVED_TOKEN');
    assert.match(page.el('status').textContent, /配置名称/);
    page.el('profile').value = magpie; assert.doesNotThrow(() => page.el('profile').onchange());
    assert.equal(page.el('profile').value, 'profile-1'); assert.equal(page.el('profileName').value, name);
    page.el('profileName').value = 'Valid name'; await page.submit();
    assert.equal(page.data.modelConfig.provider, 'chat'); assert.equal(page.data.modelConfig.model, 'unsaved/model');
  }
});

test('CC Switch preset stays optional, preserves existing credentials and uses explicit Codex discovery', async () => {
  let result = { ok: true, models: [{ id: 'ccs-mock/vendor/model', name: 'Mock' }] };
  const page = await settings(savedChat(), { modelResult: () => result });
  page.el('ccSwitchPreset').onclick();
  assert.equal(page.el('endpoint').value, 'http://127.0.0.1:15721/v1');
  assert.equal(page.el('key').value, ''); assert.equal(page.el('enabled').checked, false);
  page.el('endpoint').value = 'http://localhost:17899/v1'; page.el('model').value = 'manual/model';
  await page.el('loadCcSwitchModels').onclick();
  assert.equal(page.calls.find(c => c[0] === 'message')[1].action, 'cc-switch-models');
  assert.equal(page.el('model').value, 'manual/model');
  result = { ok: false, error: '目录格式错误。' }; await page.el('loadCcSwitchModels').onclick();
  assert.equal(page.el('discoveredModels').children[1].value, 'ccs-mock/vendor/model');
  page.el('discoveredModels').value = 'ccs-mock/vendor/model'; page.el('discoveredModels').onchange(); await page.submit();
  assert.equal(page.data.modelConfig.model, 'ccs-mock/vendor/model');
  assert.equal(page.data.modelConfig.endpoint, 'http://localhost:17899/v1/chat/completions');
  assert.equal(page.data.llmProfilesV1.profiles[0].config.apiKey, 'EXISTING_SECRET');
  result = { ok: true, models: [] }; await page.el('loadCcSwitchModels').onclick();
  assert.match(page.el('diagnosticStatus').textContent, /空目录/);
  assert.equal(page.el('model').value, 'ccs-mock/vendor/model');
  page.el('key').value = 'changed'; page.el('key').oninput();
  assert.equal(page.el('discoveredModels').disabled, true);
});

test('late CC Switch directory results and cancellation cannot cross profiles', async () => {
  const pending = deferred();
  const page = await settings(savedChat(), { modelResult: m => m.type === 'model:cancel' ? { ok: true } : pending.promise });
  const loading = page.el('loadCcSwitchModels').onclick(); await new Promise(resolve => setImmediate(resolve));
  page.el('ccSwitchPreset').onclick();
  pending.resolve({ ok: true, models: [{ id: 'ccs-old/model' }] }); await loading;
  assert.equal(page.el('discoveredModels').disabled, true); assert.equal(page.el('model').value, '');
  assert.equal(page.calls.some(c => c[0] === 'message' && c[1].type === 'model:cancel'), true);
});
