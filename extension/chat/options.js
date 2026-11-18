(function () {
  'use strict';
  const get = id => document.getElementById('channel' + id);
  const navigation = ['navChat', 'navEngine', 'navChannels'].map(id => document.getElementById(id));
  const kindNames = new Map([['webhook', '通用 HTTPS Webhook'], ['feishu', '飞书群自定义机器人']]);
  const states = new Map([['pending', '待发送'], ['sending', '正在投递'], ['accepted', '平台已受理'], ['failed', '投递失败'], ['unknown', '结果不明'], ['expired', '已过期']]);
  const topics = new Map([['strategy', '攻守与风险'], ['efficiency', '牌效率'], ['calls', '鸣牌与立直局面'], ['questions', '用户疑问']]);
  const errors = new Map([['permission', '目标主机权限未授予或已撤销。'], ['invalid', '目标配置无效。请检查渠道、HTTPS 地址、签名密钥或目标数量。'], ['changed', '草稿或目标已变化，请重新核对预览并选择目标。'], ['unavailable', '这条投递已无法重试。'], ['disabled', '请先开启发送。'], ['queue_full', '投递队列已满，请清除不再需要的投递记录后重试。']]);
  const deliveryReasons = new Map([['destination_changed', '目标已更改或删除'], ['permission_denied', '未授予主机权限'], ['rate_limited', '平台限流'], ['platform_rejected', '平台拒绝'], ['http_rejected', '接收端拒绝请求'], ['redirect_rejected', '接收端返回重定向']]);
  let state = null, editor = null, busy = false, seenDraftId = null, seenOfferId = null;
  const say = text => { get('Status').textContent = text; };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function action(label, handler, disabled = false) {
    const button = element('button', label);
    button.type = 'button';
    button.disabled = disabled;
    button.onclick = event => { if (event.isTrusted && !busy && !get('Settings').hidden) return handler(); };
    return button;
  }
  async function rpc(type, fields = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'chat:' + type, ...fields }).catch(() => null);
    if (!response?.ok) throw new Error(errors.get(response?.code) || '聊天分享操作未完成，请刷新状态后再试。');
    return response;
  }
  async function refresh() {
    try {
      const response = await rpc('status');
      const previous = state;
      state = response;
      render(previous);
    } catch (_) {
      state = null;
      get('Share').hidden = true;
      get('MatchOffer').hidden = true;
      get('MatchStop').hidden = true;
      get('MatchState').textContent = '暂时无法读取订阅状态。';
      get('Preview').textContent = '';
      get('Unavailable').hidden = false;
      throw new Error('无法读取聊天分享设置，请重新读取。');
    }
  }
  async function run(operation, message = '') {
    if (busy || get('Settings').hidden) return;
    busy = true;
    get('Controls').disabled = true;
    get('Reload').disabled = true;
    say('');
    try {
      await operation();
      say(message);
    } catch (error) { say(error.message); }
    finally {
      busy = false;
      get('Reload').disabled = false;
      get('Controls').disabled = !state;
      get('Enabled').checked = state?.enabled === true;
    }
  }
  function mutate(type, fields, message) {
    return run(async () => {
      try { await rpc(type, fields); }
      finally { await refresh(); }
    }, message);
  }
  function setEditor(target) {
    editor = target;
    get('Target').hidden = !target;
    get('Url').value = '';
    get('Secret').value = '';
    if (!target) return;
    const editing = !!target.id;
    get('EditorTitle').textContent = editing ? '编辑目标' : '添加目标';
    get('Kind').value = target.kind || 'webhook';
    get('Kind').disabled = editing;
    get('Name').value = target.name || '';
    get('Url').required = !editing;
    get('UrlHint').textContent = editing ? '留空保留原地址。更换地址不会沿用原密钥。' : '填入完整 HTTPS 地址。保存后不再显示。';
    updateSecretHint();
    get('Name').focus();
  }
  function updateSecretHint() {
    const changingAddress = !editor?.id || !!get('Url').value.trim();
    const webhook = get('Kind').value === 'webhook';
    get('Secret').required = changingAddress && webhook;
    get('SecretHint').textContent = changingAddress
      ? (webhook ? '为该地址填写独立签名密钥。' : '机器人未启用签名时留空。')
      : '留空保留原密钥。如需移除飞书签名密钥，请删除目标后重新添加。';
  }
  function permissionFor(value, kind) {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error('请填写有效的 HTTPS 地址。'); }
    if (!/^https:\/\/[^/\\?#]+/i.test(value) || /[\\\s\x00-\x1f]/.test(value) || url.protocol !== 'https:' ||
      url.username || url.password || url.href.includes('#') || url.hostname.includes('*') || value.slice(8).split(/[/?#]/, 1)[0].includes('@')) {
      throw new Error('只允许不含用户名、密码和片段的 HTTPS 地址。');
    }
    if (kind === 'feishu' && (url.origin !== 'https://open.feishu.cn' || url.href.includes('?') || !/^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname))) {
      throw new Error('请填写飞书群自定义机器人的 Webhook 地址。');
    }
    return `https://${url.hostname}/*`;
  }
  async function requestPermission(url, kind) {
    const origin = permissionFor(url, kind);
    const allowed = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!allowed) throw new Error('未授予目标主机权限。');
  }
  function row(container, title, detail, buttons) {
    const entry = element('div', '', 'channel-row');
    const info = element('div');
    const caption = element('p', '', 'hint');
    caption.append(detail);
    info.append(element('p', title), caption);
    const actions = element('div', '', 'actions compact');
    actions.append(...buttons);
    entry.append(info, actions);
    container.append(entry);
  }
  const destinationLabel = destination => `${destination.name}（${kindNames.get(destination.kind)}${destination.origin ? ' · ' + destination.origin : ''}）`;
  const targets = value => (value?.destinations || []).filter(item => kindNames.has(item.kind));
  const usable = destination => destination?.enabled === true && destination.hasPermission === true;
  const selectedTarget = () => targets(state).find(item => item.id === get('Recipient').value && usable(item));
  function updateConfirmation() {
    get('Confirm').disabled = state?.enabled !== true || !selectedTarget();
  }
  const matchTarget = () => targets(state).find(item => item.id === get('MatchRecipient').value && usable(item));
  function updateMatchConfirmation() {
    get('MatchConfirm').disabled = state?.enabled !== true || !state.matchPush?.offerId || !matchTarget();
  }
  function renderMatchPush(previous, destinations) {
    const match = state.matchPush || {}, recipient = get('MatchRecipient');
    const old = targets(previous).find(item => item.id === recipient.value);
    const active = destinations.find(item => item.id === match.destinationId);
    get('MatchOffer').hidden = !match.offerId;
    get('MatchStop').hidden = !active;
    if (match.offerId && !get('Settings').hidden) seenOfferId = match.offerId;
    const availability = active ? `已绑定「${active.name}」${usable(active) ? '' : '，目标主机未授权'}。刷新或更换游戏标签后需重新绑定。`
      : '未开启。可在游戏面板的「分析设置」绑定当前标签页。';
    get('MatchState').textContent = [availability, match.offerId && '仅发送绑定后完整采集的整场结算：人数、小局数、结束方式及可核实的终局点数。',
      match.pending && `等待入队 ${match.pending} 条。`, match.missed && `未能入队 ${match.missed} 条。`].filter(Boolean).join(' ');
    recipient.replaceChildren(element('option', '请选择发送目标'));
    recipient.firstChild.value = '';
    for (const destination of destinations.filter(usable)) {
      const option = element('option', destinationLabel(destination));
      option.value = destination.id;
      recipient.append(option);
    }
    recipient.value = previous?.matchPush?.offerId === match.offerId &&
      destinations.some(item => item.id === old?.id && item.version === old.version && usable(item)) ? old.id : '';
    updateMatchConfirmation();
  }
  function formatPreview(preview) {
    if (preview?.scope !== 'retained-decisions' || !Number.isSafeInteger(preview.roundCount) || preview.roundCount < 1 ||
      !Number.isSafeInteger(preview.decisionCount) || preview.decisionCount < 1 || !Array.isArray(preview.topics)) return '';
    const labels = [...new Set(preview.topics.map(topic => topics.get(topic)).filter(Boolean))];
    return `雀魂赛后摘要（仅留存分析样本）\n${preview.roundCount} 个有记录小局 · ${preview.decisionCount} 个分析决策\n主题：${labels.join('、') || '暂无'}`;
  }
  function render(previous) {
    const destinations = targets(state);
    const deliveries = state.deliveries || [];
    renderMatchPush(previous, destinations);
    const recipient = get('Recipient');
    const selected = targets(previous).find(item => item.id === recipient.value);
    const share = state.share;
    get('Unavailable').hidden = true;
    const preview = share?.draftId ? formatPreview(share.preview) : '';
    get('Share').hidden = !preview;
    get('Preview').textContent = preview;
    if (preview && !get('Settings').hidden) seenDraftId = share.draftId;
    recipient.replaceChildren(element('option', '请选择发送目标'));
    recipient.firstChild.value = '';
    for (const destination of destinations) {
      const option = element('option', destinationLabel(destination));
      option.value = destination.id;
      option.disabled = !usable(destination);
      recipient.append(option);
    }
    recipient.value = previous?.share?.draftId === share?.draftId && formatPreview(previous?.share?.preview) === preview &&
      destinations.some(item => item.id === selected?.id && item.version === selected.version && usable(item)) ? selected.id : '';
    get('ShareHint').textContent = !state.enabled ? '开启发送后才能确认。' : !destinations.length ? '添加目标后才能确认。'
      : !destinations.some(usable) ? '先为目标授予主机权限。' : '仅发送上方摘要，不发送原始牌局或分析文本。';
    updateConfirmation();
    const targetList = get('Targets'), deliveryList = get('Deliveries');
    targetList.replaceChildren();
    deliveryList.replaceChildren();
    if (!destinations.length) targetList.append(element('p', '还没有发送目标。', 'hint'));
    for (const destination of destinations) {
      const authorize = destination.origin && !destination.hasPermission ? [action('授权主机', () => run(async () => {
        await requestPermission(destination.origin);
        await refresh();
      }, '已授予主机权限。'))] : [];
      row(targetList, destination.name, [kindNames.get(destination.kind), destination.origin, !destination.hasPermission && '未授权'].filter(Boolean).join(' · '), [
        ...authorize,
        action('发送测试', () => mutate('test', { id: destination.id }, '已提交测试，请查看投递状态。'), !state.enabled || !usable(destination)),
        action('编辑', () => setEditor(destination)),
        action('删除', () => window.confirm(`删除「${destination.name}」？此目标的待发消息将无法投递。`) && mutate('remove-target', { id: destination.id }, '已删除目标。'))
      ]);
    }
    if (!deliveries.length) deliveryList.append(element('p', '暂无投递记录。', 'hint'));
    get('Clear').disabled = !deliveries.length && !state.matchPush?.pending && !state.matchPush?.missed;
    for (const delivery of deliveries) {
      const destination = destinations.find(item => item.id === delivery.destinationId);
      const reason = deliveryReasons.get(delivery.errorCode);
      const label = element('span', `${states.get(delivery.status) || '结果不明'}${reason ? ' · ' + reason : ''}`, 'channel-state');
      label.dataset.state = delivery.status;
      const retry = delivery.retryable === true;
      const buttons = retry ? [action('重试', () => {
        if (delivery.status === 'unknown' && !window.confirm('上一次可能已经送达，重试可能发送重复消息。仍然重试？')) return;
        return mutate('retry', { id: delivery.id }, '已提交重试，请查看投递状态。');
      }, !state.enabled || !usable(destination))] : [];
      const operation = delivery.type === 'app.majsoul.integration.test.v1' ? '测试消息'
        : delivery.type === 'app.majsoul.match.completed.v1' ? '整场结算' : '整盘摘要';
      const destinationName = !destination ? '已删除的目标' : destination.version === delivery.destinationVersion ? destination.name : `旧版目标（当前名称：${destination.name}）`;
      const timestamp = Number.isSafeInteger(delivery.createdAt) ? new Date(delivery.createdAt).toLocaleString('zh-CN') : '';
      row(deliveryList, [destinationName, operation, timestamp].filter(Boolean).join(' · '), label, buttons);
    }
  }
  get('Enabled').onchange = event => {
    if (!event.isTrusted) return;
    const enabled = event.target.checked;
    if (!enabled && !window.confirm('关闭发送并清除待发消息、投递记录和分享草稿？已发出的消息无法撤回。')) {
      event.target.checked = state?.enabled === true;
      return;
    }
    return mutate('configure', { enabled }, enabled ? '已开启发送。' : '已关闭发送。');
  };
  get('Add').onclick = event => { if (event.isTrusted) setEditor({}); };
  get('CancelEdit').onclick = event => { if (event.isTrusted) setEditor(null); };
  get('Kind').onchange = updateSecretHint;
  get('Url').oninput = updateSecretHint;
  get('Target').onsubmit = event => {
    event.preventDefault();
    if (!event.isTrusted || !editor) return;
    return run(async () => {
      const { id } = editor;
      const kind = get('Kind').value, name = get('Name').value.trim();
      const url = get('Url').value.trim(), secret = get('Secret').value.trim();
      if (!kindNames.has(kind) || !name || (!id && !url)) throw new Error('请填写目标名称和地址。');
      if (url && !secret && kind === 'webhook') throw new Error('请为该地址填写签名密钥。');
      if (url) await requestPermission(url, kind);
      await rpc('save-target', { target: { ...(id ? { id } : {}), kind, name, ...(url ? { url } : {}), ...(secret || url ? { secret } : {}) } });
      setEditor(null);
      await refresh();
    }, '已保存目标。');
  };
  get('Recipient').onchange = updateConfirmation;
  get('MatchRecipient').onchange = updateMatchConfirmation;
  get('MatchConfirm').onclick = event => {
    const target = matchTarget(), offerId = state?.matchPush?.offerId;
    if (!event.isTrusted || !offerId || !target || get('MatchOffer').hidden) return;
    return mutate('subscribe-match', { offerId, destinationId: target.id, destinationVersion: target.version }, '已开启整场结算推送。');
  };
  get('MatchStop').onclick = event => {
    if (event.isTrusted && !get('MatchStop').hidden) return mutate('unsubscribe-match', {}, '已关闭整场结算推送。');
  };
  get('Confirm').onclick = event => {
    const destination = selectedTarget();
    if (!event.isTrusted || get('Share').hidden || !state?.enabled || !state.share?.draftId || !destination) return;
    return mutate('confirm-share', { draftId: state.share.draftId, destinationId: destination.id, destinationVersion: destination.version }, '已加入投递队列，请查看投递状态。');
  };
  get('Discard').onclick = event => {
    if (event.isTrusted && state?.share?.draftId) return mutate('discard-share', { draftId: state.share.draftId }, '已丢弃草稿。');
  };
  get('Refresh').onclick = get('Reload').onclick = event => { if (event.isTrusted) return run(refresh); };
  get('Clear').onclick = event => {
    if (event.isTrusted && window.confirm('清除本机投递记录、待发消息及分享草稿？已经发出的消息无法撤回。')) return mutate('clear', {}, '已清除投递记录。');
  };
  function showChannels(activeTab) {
    const channels = activeTab === navigation[2];
    get('Settings').hidden = !channels;
    document.getElementById('modelSettings').hidden = channels;
    for (const tab of navigation) {
      if (tab === activeTab) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    if (!channels) { setEditor(null); return; }
    get('Title').focus();
    return run(refresh);
  }
  for (const tab of navigation) tab.addEventListener('click', () => showChannels(tab));
  window.addEventListener('focus', () => {
    if (!get('Settings').hidden) run(refresh);
    else checkShare();
  });
  async function checkShare() {
    try {
      const { share, matchPush } = await rpc('status');
      if (get('Settings').hidden && ((share?.draftId && share.draftId !== seenDraftId && formatPreview(share.preview)) ||
          (matchPush?.offerId && matchPush.offerId !== seenOfferId))) showChannels(navigation[2]);
    }
    catch (_) {}
  }
  checkShare();
})();
