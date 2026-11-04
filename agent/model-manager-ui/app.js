(function (root) {
  'use strict';
  const states = { 'not-installed': '未安装', installed: '已安装', invalid: '安装校验未通过', installing: '正在安装', removing: '正在删除', starting: '正在启动', running: '运行中', error: '操作失败', stopped: '未运行', stopping: '正在停止' };
  const verificationLabels = { 'verified-experimental': '限定人工局面已验证，实验接入', verified: '已通过目录指定验证', unverified: '待验证，不可运行', pending: '待验证，不可运行' };
  const stageLabels = { 'verify-model': '正在校验模型文件', 'verify-runtime': '正在校验完整运行环境（首次可能较慢）', 'load-model': '正在加载模型', warmup: '正在检查模型推理', listen: '正在开启分析接口' };
  function size(bytes) { return Number.isFinite(bytes) ? (bytes / 1048576).toFixed(1) + ' MiB' : '大小待确认'; }
  function actions(model, snapshot, sending = false) {
    const busy = sending || snapshot.operation?.state === 'running' || ['starting', 'stopping'].includes(snapshot.bridge?.state);
    const running = snapshot.bridge?.state === 'running' && snapshot.bridge.profile === model.id;
    return { install: !busy && model.installable === true && !model.installed, remove: !busy && model.installed === true && !running,
      start: !busy && model.installed === true && model.installable === true && !running && model.state !== 'invalid', running };
  }
  function safeLink(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch (_) { return null; } }
  const api = { actions, size, safeLink };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  const $ = id => document.getElementById(id);
  let sessionConnected = false;
  let managementToken = '', snapshot = null, timer = null, sending = false, generation = 0, modelView = null;
  function message(value, error = false) { $('message').textContent = value; $('message').classList.toggle('error', error); }
  function el(tag, value, className) { const node = document.createElement(tag); if (value != null) node.textContent = value; if (className) node.className = className; return node; }
  function detail(list, key, value) { list.append(el('dt', key), el('dd', value || '未提供')); }
  async function request(path, method = 'GET', body = {}) {
    const response = await fetch(path, { method, headers: { ...(managementToken ? { Authorization: 'Bearer ' + managementToken } : {}), 'X-Manager-Request': '1', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    let data; try { data = await response.json(); } catch (_) { throw new Error('管理服务返回了无法识别的响应。'); }
    if (!response.ok) throw new Error('操作未完成：' + (data.error || 'HTTP ' + response.status));
    if (data.format !== 'local-model-manager-v1' || !Array.isArray(data.models)) throw new Error('管理服务协议不匹配，请核对项目版本。');
    return data;
  }
  function render() {
    if (!snapshot) return;
    $('access').hidden = true;
    $('workspace').hidden = false; $('connection').textContent = '已连接'; $('disconnect').hidden = false;
    const pairing = $('pairing'); pairing.replaceChildren();
    for (const pair of snapshot.pairing || []) {
      const row = el('p', '扩展 ' + pair.origin + ' 请求连接 ' + pair.profile + '。');
      const approve = el('button', '允许连接当前模型'); approve.type = 'button';
      approve.disabled = snapshot.bridge?.state !== 'running' || snapshot.bridge.profile !== pair.profile;
      approve.onclick = () => mutate('/api/pair/approve', { id: pair.id }); row.append(approve); pairing.append(row);
    }
    const bridge = snapshot.bridge || { state: 'stopped' }, active = snapshot.models.find(model => model.id === bridge.profile);
    $('runningState').textContent = (states[bridge.state] || bridge.state) + (bridge.profile ? '：' + (active?.name || bridge.profile) : '');
    $('stop').disabled = sending || !['running', 'error'].includes(bridge.state) || snapshot.operation?.state === 'running';
    const configVisible = bridge.state === 'running' && typeof bridge.url === 'string' && typeof bridge.token === 'string';
    $('analysisConfig').hidden = !configVisible;
    $('analysisEndpoint').value = configVisible ? bridge.url : ''; $('analysisToken').value = configVisible ? bridge.token : '';
    $('dataDirectory').textContent = snapshot.dataDir || snapshot.root || snapshot.directory || '服务未提供目录';
    $('directorySummary').textContent = '已安装 ' + snapshot.models.filter(model => model.installed).length + ' 个，共 ' + snapshot.models.length + ' 个模型';
    const nextModelView = JSON.stringify([snapshot.models, snapshot.operation, bridge, sending]);
    if (nextModelView !== modelView) {
    modelView = nextModelView;
    const models = $('models'); models.replaceChildren();
    for (const model of snapshot.models) {
      const controls = actions(model, snapshot, sending), card = el('article', null, 'model' + (controls.running ? ' active' : ''));
      card.append(el('h3', model.name || model.id));
      card.append(el('span', model.installable === false && !model.installed ? '待验证，不可运行' : states[model.state] || model.state || '状态未知', 'badge' + (controls.running ? ' running' : model.error ? ' error' : '')));
      card.append(el('p', size(model.weightBytes ?? model.bytes ?? model.weight?.bytes) + (model.scope ? ' · ' + model.scope : ''), 'model-size'));
      const details = el('details'), summary = el('summary', '来源与使用说明'), meta = el('dl'); details.append(summary);
      const url = safeLink(model.sourceUrl || model.source?.url || model.source || model.url);
      meta.append(el('dt', '来源')); const source = el('dd');
      if (url) { const a = el('a', model.sourceName || new URL(url).hostname); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; source.append(a); } else source.textContent = '来源待确认'; meta.append(source);
      detail(meta, '许可', typeof model.license === 'string' ? model.license : model.license?.name);
      detail(meta, '运行环境', (model.runtimeKind === 'native' ? 'Native · ' : model.runtimeKind === 'python' ? 'Python · ' : '') + (model.runtimeFamily || model.runtimeId || '待确认'));
      const weight = model.assets?.find(asset => asset.role === 'weight' || asset.role === 'model');
      if (weight) detail(meta, '权重文件', weight.name || weight.path);
      detail(meta, '环境共享', model.sharedRuntimeVerified ? '已验证共享；删除范围见安装说明' : '独立管理；未确认共享环境');
      detail(meta, '兼容验证', verificationLabels[model.verification || model.status] || model.verification || '待验证，不可运行');
      details.append(meta);
      if (model.reason) details.append(el('p', model.reason, 'hint'));
      if (model.id === 'voidshine-298k') details.append(el('p', '作者不推荐排位。', 'hint'));
      card.append(details);
      if (model.error) card.append(el('p', '失败：' + model.error, 'model-error'));
      const operation = snapshot.operation;
      if (operation?.state === 'running' && operation.profile === model.id) {
        const progress = el('progress'); progress.className = 'progress'; progress.max = 100;
        if (Number.isFinite(operation.progress?.percent ?? operation.progress)) progress.value = operation.progress?.percent ?? operation.progress;
        progress.setAttribute('aria-label', '安装或操作进度'); card.append(progress);
        const bytes = operation.progress?.downloadedBytes ?? operation.downloadedBytes, total = operation.progress?.totalBytes ?? operation.totalBytes;
        card.append(el('p', stageLabels[operation.stage] || (bytes != null ? '已下载 ' + size(bytes) + (total ? ' / ' + size(total) : '') : '操作进行中；进度由服务回报。'), 'hint'));
      }
      const buttons = el('div', null, 'actions');
      for (const [action, text, enabled] of [['install', '安装', controls.install], ['start', controls.running ? '正在使用' : bridge.state === 'running' ? '切换并启动' : '启动分析', controls.start], ['remove', '删除', controls.remove]]) {
        const button = el('button', text, action === 'remove' ? 'danger' : action === 'install' ? 'secondary' : ''); button.type = 'button'; button.disabled = !enabled;
        button.addEventListener('click', () => mutate('/api/models/' + encodeURIComponent(model.id) + '/' + action)); buttons.append(button);
      }
      card.append(buttons); models.append(card);
    }
    }
    const runtimes = $('runtimes'); runtimes.replaceChildren();
    if (Array.isArray(snapshot.runtimes)) for (const runtime of snapshot.runtimes) runtimes.append(el('p', (runtime.name || runtime.id) + '：' + (states[runtime.state] || runtime.state || (runtime.installed ? '已安装' : '未安装')) + (runtime.models ? '；使用模型：' + runtime.models.join('、') : ''), 'runtime'));
    $('refresh').disabled = sending;
  }
  function schedule() { clearTimeout(timer); if (managementToken || sessionConnected) timer = setTimeout(refresh, 1500); }
  async function refresh() {
    const current = generation;
    try { const next = await request('/api/status'); if (current !== generation) return; snapshot = next; render();
      if (next.operation?.state === 'failed') message('操作失败：' + (next.operation.error || '请查看管理终端。'), true);
      else if (next.operation?.state === 'running') message(stageLabels[next.operation.stage] || '正在处理操作；等待服务确认完成。');
      else if (next.bridge?.error) message('分析服务失败：' + next.bridge.error, true);
      else message(next.operation?.state === 'succeeded' ? '操作已完成，当前状态已更新。' : '已读取本机状态。');
      schedule();
    } catch (error) { if (current !== generation) return; disconnect(); message(error.message + ' 会话过期时，请关闭管理终端并重新双击运行包。', true); }
  }
  async function mutate(path, body = {}) {
    if (sending) return; sending = true; clearTimeout(timer); render(); message('已发送操作，等待服务确认。'); const current = generation;
    try { const next = await request(path, 'POST', body); if (current !== generation) return; snapshot = next; message(next.operation?.state === 'failed' ? '操作失败：' + next.operation.error : '服务已受理，等待状态更新。', next.operation?.state === 'failed'); }
    catch (error) { if (current === generation) message(error.message, true); }
    finally { if (current === generation) { sending = false; render(); schedule(); } }
  }
  function disconnect() {
    ++generation; sessionConnected = false; managementToken = '';
    $('access').hidden = false; snapshot = null; sending = false; modelView = null; clearTimeout(timer);
    $('workspace').hidden = true; $('models').replaceChildren(); $('analysisEndpoint').value = ''; $('analysisToken').value = ''; $('analysisConfig').hidden = true;
    $('managementToken').value = ''; $('disconnect').hidden = true; $('connection').textContent = '未连接'; $('connect').disabled = false;
  }
  // Capture before clearing the input; keep credentials out of URLs and persistent storage.
  $('connectForm').onsubmit = event => { event.preventDefault(); const token = $('managementToken').value.trim(); if (!token) return; disconnect(); managementToken = token; $('connect').disabled = true; message('正在连接本机管理服务。'); refresh(); };
  $('disconnect').onclick = () => { disconnect(); message('已断开管理连接。分析服务的启停以终端状态为准。'); };
  $('refresh').onclick = () => { clearTimeout(timer); refresh(); };
  $('stop').onclick = () => mutate('/api/stop');
  for (const [buttonId, inputId] of [['copyEndpoint', 'analysisEndpoint'], ['copyToken', 'analysisToken']]) $(buttonId).onclick = async () => {
    try { if (!$('analysisConfig').hidden && $(inputId).value) { await navigator.clipboard.writeText($(inputId).value); message(buttonId === 'copyToken' ? '已复制分析 Token。' : '已复制分析接口。'); } }
    catch (_) { message('浏览器未允许复制，请选择字段内容后手动复制。', true); }
  };
  async function resume() {
    const ticket = new URLSearchParams(root.location.hash.slice(1)).get('ticket');
    root.history.replaceState(null, '', root.location.pathname);
    try {
      if (ticket) {
        const response = await fetch('/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Manager-Request': '1' }, body: JSON.stringify({ ticket }), credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
        if (!response.ok) throw new Error('启动链接已过期或已使用，请重新打开运行包。');
      }
      sessionConnected = true; await refresh();
    } catch (error) { disconnect(); message(error.message, true); }
  }
  if (root.location) resume();
  root.addEventListener('pagehide', disconnect);
})(globalThis);
