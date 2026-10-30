'use strict';
const $ = id => document.getElementById(id);
const status = text => { $('status').textContent = text; };
const providerOf = c => c?.provider === 'mjai' ? 'mjai' : 'chat';
let currentProvider = 'chat', drafts = {}, profiles;
let diagnosticGeneration = 0, diagnosticRequestId = null;
// This identity stays in page memory only: never persist or display credentials.
let modelDirectoryIdentity = null;
function directoryIdentity() {
  let address = $('endpoint').value.trim();
  try { address = MJModelEndpoint.endpoint(address).href; } catch (_) { /* Invalid drafts must also invalidate an old directory. */ }
  return JSON.stringify([currentProvider, profiles?.activeId, address, $('key').value.trim()]);
}
function syncModelDirectory() {
  if (modelDirectoryIdentity !== null && modelDirectoryIdentity === directoryIdentity()) return;
  modelDirectoryIdentity = null;
  const select = $('discoveredModels'); select.replaceChildren(); select.disabled = true;
  const option = document.createElement('option'); option.value = ''; option.textContent = '请为当前配置加载模型（也可手填）'; select.appendChild(option); select.value = '';
}
function cancelDiagnostic() {
  diagnosticGeneration++;
  if (diagnosticRequestId) chrome.runtime.sendMessage({ type: 'model:cancel', requestId: diagnosticRequestId }).catch(() => {});
  diagnosticRequestId = null;
  $('diagnosticStatus').textContent = '';
}
function renderProfiles() {
  const select = $('profile'); select.replaceChildren();
  for (const item of profiles.profiles) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; select.appendChild(option); }
  select.value = profiles.activeId; $('profileName').value = MJModelProfiles.active(profiles).name;
}
function captureProfile() {
  if (currentProvider === 'chat') profiles = MJModelProfiles.upsert(profiles, { id: profiles.activeId, name: $('profileName').value, config: { ...MJModelProfiles.active(profiles).config, ...fields('chat') } });
}

const configStore = MJModelConfigStore.create({ storage: chrome.storage.local, clearAgentData: () => chrome.runtime?.sendMessage?.({ type: 'agent:clear-data' }) });
const defaults = MJModelConfigStore.defaults;
const priceFields = { input: 'priceInput', output: 'priceOutput', cacheRead: 'priceCacheRead', cacheWrite: 'priceCacheWrite' };
function pricingFields() {
  return { currency: $('priceCurrency').value.trim() || null,
    ...Object.fromEntries(Object.entries(priceFields).map(([key, id]) => [key, $(id).value.trim() === '' ? null : Number($(id).value)])) };
}
function fields(provider) { return { provider, enabled: $('enabled').checked, endpoint: $('endpoint').value.trim(), model: provider === 'mjai' ? 'mjai' : $('model').value, apiKey: $('key').value.trim(),
  ...(provider === 'chat' ? { thinking: !$('thinking').disabled && $('thinking').checked, maxTokens: Number($('maxTokens').value),
    contextMode: 'round', toolCalling: true, pricing: pricingFields() } : {}) }; }
function updateThinking() {
  const supported = currentProvider === 'chat' && MJModelEndpoint.supportsThinking($('endpoint').value.trim(), $('model').value.trim());
  $('thinking').disabled = !supported;
  $('thinkingHint').textContent = supported ? '默认关闭；开启后可能增加耗时和费用。' : '思考开关仅支持 DeepSeek 官方接口；经网关不会发送关闭思考参数，请在网关设置，并确认输出上限。';
}
function show(provider) {
  const c = drafts[provider] || defaults(provider), engine = provider === 'mjai';
  currentProvider = provider;
  $('profilesPanel').hidden = engine;
  $('engineSetup').hidden = !engine;
  $('engineGuide').href = 'https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/blob/main/docs/MJAI.md';
  $('provider').value = provider; $('enabled').checked = !!c.enabled;
  $('endpoint').value = c.endpoint || ''; $('endpoint').placeholder = engine ? 'http://127.0.0.1:17341/analyze' : 'https://api.openai.com/v1';
  $('endpointHint').textContent = engine ? '仅支持 localhost / 127.0.0.1 的 HTTP /analyze 接口。' : '自动补全 /chat/completions，也可填写完整接口地址。';
  $('model').value = engine ? 'mjai' : c.model || ''; $('model').readOnly = engine;
  $('chatOptions').hidden = engine; $('maxTokens').disabled = engine;
  for (const id of ['priceCurrency', ...Object.values(priceFields)]) $(id).disabled = engine;
  $('thinking').checked = c.thinking === true;
  $('maxTokens').value = Number.isInteger(c.maxTokens) && c.maxTokens >= 1 && c.maxTokens <= 393216 ? c.maxTokens : MJModelEndpoint.defaultMaxTokens(c.thinking === true);
  $('priceCurrency').value = typeof c.pricing?.currency === 'string' ? c.pricing.currency : '';
  for (const [key, id] of Object.entries(priceFields)) $(id).value = typeof c.pricing?.[key] === 'number' ? String(c.pricing[key]) : '';
  updateThinking();
  $('key').value = c.apiKey || ''; $('key').required = engine;
  $('key').placeholder = engine ? '填写本地服务的 Token' : '填写密钥；无密钥的本地服务可留空';
  $('keyLabel').textContent = engine ? 'Bearer Token' : 'API Key';
  $('providerHint').textContent = engine ? '需手动启动桥接服务并自备模型，不捆绑权重。仅支持无副露四麻。' : '';
  syncModelDirectory();
}
async function load(generation = configStore.generation) {
  const state = await configStore.load();
  if (generation !== configStore.generation) return;
  ({ profiles, drafts } = state); renderProfiles(); show(state.provider);
}
load().catch(() => status('读取设置失败，请重新打开设置页。'));
$('provider').onchange = () => {
  cancelDiagnostic(); configStore.invalidate();
  try {
    captureProfile(); drafts[currentProvider] = fields(currentProvider);
    const next = $('provider').value === 'mjai' ? 'mjai' : 'chat';
    drafts[next] = { ...(drafts[next] || defaults(next)), enabled: false }; show(next); status('');
  } catch (error) { $('provider').value = currentProvider; status(error.message); }
};
for (const id of ['endpoint', 'model', 'key', 'maxTokens', 'thinking']) $(id).oninput = () => { cancelDiagnostic(); configStore.invalidate(); syncModelDirectory(); updateThinking(); };
$('thinking').onchange = () => {
  const previousDefault = MJModelEndpoint.defaultMaxTokens(!$('thinking').checked);
  if (Number($('maxTokens').value) === previousDefault) $('maxTokens').value = MJModelEndpoint.defaultMaxTokens($('thinking').checked);
};
$('config').onsubmit = async event => {
  event.preventDefault();
  cancelDiagnostic();
  const generation = configStore.invalidate();
  try {
    const c = fields(currentProvider), adapter = c.provider === 'mjai' ? MJEngineEndpoint : MJModelEndpoint;
    const url = adapter.endpoint(c.endpoint);
    if (c.provider === 'chat') {
      MJModelEndpoint.outputOptions(c);
      if (Object.keys(priceFields).some(key => c.pricing[key] !== null && (!Number.isFinite(c.pricing[key]) || c.pricing[key] < 0))) throw new Error('每百万 token 的价格须为非负数字；未知价格请留空。');
      if (c.pricing.currency !== null && c.pricing.currency.length > 16) throw new Error('币种名称不能超过 16 个字符。');
    }
    if (!c.model.trim()) throw new Error('请填写模型名称。');
    if (c.provider === 'mjai' && !c.apiKey) throw new Error('请填写本地桥接服务的 Bearer Token。');
    if (c.provider === 'chat') MJModelProfiles.validateName($('profileName').value);
    // Request inside the submit gesture, before any asynchronous storage work.
    const allowed = await chrome.permissions.request({ origins: [adapter.permissionOrigin(url.href)] });
    if (generation !== configStore.generation) return;
    if (!allowed) throw new Error('未授予接口访问权限，设置尚未保存。');
    c.endpoint = url.href;
    if (c.provider === 'chat') profiles = MJModelProfiles.upsert(profiles, { id: profiles.activeId, name: $('profileName').value, config: { ...MJModelProfiles.active(profiles).config, ...c } });
    const providers = await configStore.save({ config: c, profiles, drafts }, generation);
    if (providers && generation === configStore.generation) drafts = providers;
    if (generation === configStore.generation) {
      if (currentProvider === c.provider) $('endpoint').value = c.endpoint;
      if (c.provider === 'chat') renderProfiles();
      status('已保存。在牌局面板开启“调用模型”即可使用。');
    }
  } catch (error) { if (generation === configStore.generation) status(error.message); }
};
$('disable').onclick = async () => {
  let generation;
  cancelDiagnostic();
  profiles = { ...(profiles || MJModelProfiles.migrate({})), profiles: (profiles || MJModelProfiles.migrate({})).profiles.map(item => ({ ...item, config: { ...item.config, enabled: false } })) };
  for (const provider of ['chat', 'mjai']) if (drafts[provider]) drafts[provider].enabled = false;
  $('enabled').checked = false;
  try {
    const pending = configStore.disable({ drafts, profiles }); generation = configStore.generation; await pending;
    if (generation === configStore.generation) status('模型分析已关闭，正在进行的请求将取消。');
  } catch (_) { if (generation === configStore.generation) status('关闭失败，请重试。'); }
};
$('clear').onclick = async () => {
  let generation;
  cancelDiagnostic();
  profiles = MJModelProfiles.migrate({}); renderProfiles();
  drafts = {}; show('chat');
  try {
    const pending = configStore.clear(); generation = configStore.generation; await pending;
    if (generation === configStore.generation) status('已清除所有服务配置、密钥、本地会话和运行用量。');
  } catch (_) { if (generation === configStore.generation) status('清除失败，请重试。'); }
};
$('clearAgentData').onclick = async () => {
  const button = $('clearAgentData'); button.disabled = true;
  try {
    const result = await configStore.enqueue(() => chrome.runtime.sendMessage({ type: 'agent:clear-data' }));
    if (result?.ok === false) throw new Error(result.error || '清除失败，请重试。');
    status('已清除本地会话和运行用量。');
  } catch (error) { status(error.message || '清除失败，请重试。'); }
  finally { button.disabled = false; }
};
$('exportUsage').onclick = async () => {
  const button = $('exportUsage'); button.disabled = true;
  try {
    const response = await configStore.enqueue(() => chrome.runtime.sendMessage({ type: 'agent:usage' }));
    if (response?.ok !== true || !Array.isArray(response.records)) throw new Error(response?.error || '读取用量记录失败，请重试。');
    const now = new Date().toISOString();
    const blob = new Blob([JSON.stringify({ format: 'mj-agent-usage-v1', exportedAt: now, records: response.records }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    try {
      link.href = url; link.download = 'mahjong-usage-' + now.replace(/[:.]/g, '-') + '.json';
      link.hidden = true; document.body.appendChild(link); link.click();
    } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    status('已导出 ' + response.records.length + ' 条本地用量记录。');
  } catch (error) { status(error.message || '导出失败，请重试。'); }
  finally { button.disabled = false; }
};

// Profile edits remain local until the user saves. Never enable on selection.
$('profile').onchange = () => {
  const id = $('profile').value;
  try { captureProfile(); profiles = MJModelProfiles.select(profiles, id); cancelDiagnostic(); configStore.invalidate();
    drafts.chat = { ...defaults('chat'), ...MJModelProfiles.active(profiles).config, enabled: false }; renderProfiles(); show('chat'); status('已选择配置；保存后应用，分析保持关闭。');
  } catch (error) { $('profile').value = profiles.activeId; status(error.message); }
};
function newProfile(magpie) {
  try { captureProfile(); let name = magpie ? 'Magpie' : '新直连配置', suffix = 2;
    const base = name; while (profiles.profiles.some(item => item.name === name)) name = base + ' ' + suffix++;
    const config = { ...defaults('chat'), ...(magpie ? { endpoint: 'http://127.0.0.1:3425/v1', apiKey: 'magpie-majsoul-agent' } : {}) };
    profiles = MJModelProfiles.upsert(profiles, { name, config }); cancelDiagnostic(); configStore.invalidate();
    drafts.chat = config; renderProfiles(); show('chat'); status('新配置尚未保存；分析保持关闭。');
  } catch (error) { status(error.message); }
}
$('newProfile').onclick = () => newProfile(false);
$('magpiePreset').onclick = () => newProfile(true);
$('deleteProfile').onclick = () => {
  try { profiles = MJModelProfiles.remove(profiles, profiles.activeId); cancelDiagnostic(); configStore.invalidate();
    drafts.chat = { ...defaults('chat'), ...MJModelProfiles.active(profiles).config, enabled: false }; renderProfiles(); show('chat'); status('删除尚未保存；保存后应用。');
  } catch (error) { status(error.message); }
};
$('discoveredModels').onchange = () => { if (modelDirectoryIdentity !== directoryIdentity()) { syncModelDirectory(); return; } if ($('discoveredModels').value) { $('model').value = $('discoveredModels').value; cancelDiagnostic(); configStore.invalidate(); updateThinking(); } };
async function modelOperation(action) {
  cancelDiagnostic();
  syncModelDirectory();
  const generation = diagnosticGeneration, c = fields('chat'), requestIdentity = directoryIdentity();
  try {
    const url = MJModelEndpoint.endpoint(c.endpoint); MJModelEndpoint.outputOptions(c);
    if (action === 'diagnose' && !c.model) throw new Error('请先填写模型名称。');
    const allowed = await chrome.permissions.request({ origins: [MJModelEndpoint.permissionOrigin(url.href)] });
    if (generation !== diagnosticGeneration || requestIdentity !== directoryIdentity()) return;
    if (!allowed) { $('diagnosticStatus').textContent = '未授予接口访问权限，未发送请求。'; return; }
    diagnosticRequestId = 'options-' + Date.now() + '-' + generation;
    $('diagnosticStatus').textContent = action === 'diagnose' ? '正在发送人工测试请求（可能收费）…' : '正在请求服务…';
    const response = await chrome.runtime.sendMessage({ type: action === 'diagnose' ? 'model:diagnose' : 'model:discover', config: c, requestId: diagnosticRequestId, ...(action !== 'diagnose' ? { action } : {}) });
    if (generation !== diagnosticGeneration || requestIdentity !== directoryIdentity()) return;
    if (!response?.ok) { $('diagnosticStatus').textContent = response?.error || '后台请求失败，请重试。'; return; }
    if (action === 'models') {
      modelDirectoryIdentity = requestIdentity;
      const select = $('discoveredModels'); select.replaceChildren(); select.disabled = false;
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = '请选择（不自动覆盖手填模型）'; select.appendChild(empty);
      for (const model of response.models) { const option = document.createElement('option'); option.value = model.id; option.textContent = model.name ? model.name + ' — ' + model.id : model.id; select.appendChild(option); }
      $('diagnosticStatus').textContent = '已加载 ' + response.models.length + ' 个模型；工具能力仍需单独测试。';
    } else $('diagnosticStatus').textContent = action === 'hello' ? '已识别 Magpie；未验证模型能力。' : '接口、固定工具往返和最终 JSON 最小合同通过；不代表麻将分析或真实网关全面兼容。';
  } catch (_) { if (generation === diagnosticGeneration) $('diagnosticStatus').textContent = '请求未完成，请检查地址、权限和后台服务。'; }
  finally { if (generation === diagnosticGeneration) diagnosticRequestId = null; }
}
$('diagnose').onclick = () => modelOperation('diagnose');
$('magpieHello').onclick = () => modelOperation('hello');
$('loadModels').onclick = () => modelOperation('models');
$('cancelDiagnostic').onclick = () => { cancelDiagnostic(); $('diagnosticStatus').textContent = '测试已取消。'; };

$('config').oninput = () => { cancelDiagnostic(); configStore.invalidate(); syncModelDirectory(); };
