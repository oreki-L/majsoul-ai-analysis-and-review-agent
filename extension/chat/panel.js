(function (root) {
  'use strict';
  const busy = new Set();
  const actions = new WeakMap();
  function action(anchor, label, message, report, failure) {
    if (!anchor) return;
    let button = actions.get(anchor);
    if (!button) {
      button = anchor.ownerDocument.createElement('button');
      button.type = 'button';
      button.textContent = label;
      actions.set(anchor, button);
      anchor.after(button);
    }
    button.onclick = async event => {
      if (!event.isTrusted || !button.isConnected || busy.has(message.type)) return;
      busy.add(message.type);
      button.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage(message).catch(() => null);
        if (!response?.ok && button.isConnected) report(response?.code === 'disabled'
          ? '请先在扩展设置的“聊天分享”中开启发送。' : failure(response));
      } finally {
        busy.delete(message.type);
        button.disabled = false;
      }
    };
  }
  root.majsoulAddon = Object.freeze({
    reviewActions(anchor, groupKey, report) {
      action(anchor, '分享摘要…', { type: 'chat:prepare-share', groupKey }, report, response => response?.code === 'unavailable'
        ? '没有可核实的赛后摘要。仅支持已结算对局或已导入的离线复盘。' : '无法打开分享预览，请重试。');
    },
    settingsActions(anchor, report) {
      action(anchor, '绑定结算推送…', { type: 'chat:offer-match-source' }, report, () => '无法绑定当前标签页，请重试。');
    },
  });
})(globalThis);
