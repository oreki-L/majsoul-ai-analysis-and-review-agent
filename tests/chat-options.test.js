'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const flush = () => new Promise(resolve => setImmediate(resolve));
const trusted = { isTrusted: true, preventDefault() {} };
const target = { id: 'target-1', version: 2, name: '合成测试群', kind: 'feishu', origin: 'https://open.feishu.cn', enabled: true, hasPermission: true };
const share = { draftId: 'share-1', preview: { scope: 'retained-decisions', roundCount: 3, decisionCount: 8, topics: ['strategy', 'PRIVATE_TOPIC'], account: 'PRIVATE_ACCOUNT' } };
let html;
test.before(async () => {
  const { checkProfiles } = await import('../scripts/build-extensions.mjs');
  html = checkProfiles().find(profile => profile.name === 'chat').generated['options.html'];
});

test('chat panel actions are not duplicated by rerenders and reject synthetic clicks', async () => {
  const messages = [], buttons = [];
  const context = vm.createContext({ chrome: { runtime: { sendMessage: async message => { messages.push(message); return { ok: true }; } } } });
  vm.runInContext(fs.readFileSync(require.resolve('../extension/chat/panel.js'), 'utf8'), context);
  const anchor = { ownerDocument: { createElement: () => ({ isConnected: true }) }, after: button => buttons.push(button) };
  const report = assert.fail;
  context.majsoulAddon.settingsActions(anchor, report);
  context.majsoulAddon.settingsActions(anchor, report);
  assert.equal(buttons.length, 1);
  await buttons[0].onclick({ isTrusted: false });
  assert.equal(messages.length, 0);
  await buttons[0].onclick(trusted);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'chat:offer-match-source');
});

function fixture(initial = {}, openTab = true) {
  class Element {
    children = [];
    dataset = {};
    listeners = {};
    value = '';
    textContent = '';
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    get firstChild() { return this.children[0]; }
    get text() { return this.textContent + this.children.map(node => typeof node === 'string' ? node : node.text).join(''); }
    focus() {}
    addEventListener(type, handler) { this.listeners[type] = handler; }
    setAttribute() {}
    removeAttribute() {}
  }
  const elements = new Map(Array.from(html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g), ([tag, id]) => {
    const node = new Element();
    node.hidden = /\bhidden\b/.test(tag);
    return [id, node];
  }));
  const messages = [], requests = [], dialogs = [];
  const state = { enabled: true, share: null, destinations: [target], deliveries: [], ...initial };
  const behavior = { allowPermission: true, confirm: true, nextError: null };
  const context = {
    URL,
    document: { getElementById: id => elements.get(id), createElement: () => new Element() },
    window: { addEventListener() {}, confirm: message => { dialogs.push(message); return behavior.confirm; } },
    chrome: {
      permissions: { request: async value => { requests.push(structuredClone(value)); return behavior.allowPermission; } },
      runtime: { sendMessage: async input => {
        const message = structuredClone(input);
        messages.push(message);
        if (message.type === 'chat:status') return { ok: true, ...structuredClone(state) };
        if (behavior.nextError) return { ok: false, ...behavior.nextError };
        if (message.type === 'chat:confirm-share' || message.type === 'chat:discard-share') state.share = null;
        if (message.type === 'chat:subscribe-match') state.matchPush = { offerId: null, destinationId: message.destinationId };
        if (message.type === 'chat:unsubscribe-match') state.matchPush = { offerId: null, destinationId: null };
        if (message.type === 'chat:configure') state.enabled = message.enabled;
        if (message.type === 'chat:test') state.deliveries.push({ id: 'test-1', destinationId: target.id, destinationVersion: target.version, status: 'pending', type: 'app.majsoul.integration.test.v1' });
        if (message.type === 'chat:clear') state.deliveries = [];
        if (message.type === 'chat:remove-target') state.destinations = state.destinations.filter(item => item.id !== message.id);
        return { ok: true };
      } }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/chat/options.js'), 'utf8'), context);
  if (openTab) elements.get('navChannels').listeners.click();
  const get = id => elements.get('channel' + id);
  const find = (list, label) => get(list).children.flatMap(row => row.children.flatMap(node => node.children || [])).find(node => node.textContent === label);
  return { get, find, messages, requests, dialogs, state, behavior };
}

test('plain options opens a pending preview, asks for an explicit target, and confirms only that draft and version', async () => {
  const page = fixture({ share }, false); await flush();
  assert.equal(page.get('Settings').hidden, false);
  assert.match(page.get('Preview').textContent, /3 个有记录小局 · 8 个分析决策\n主题：攻守与风险/);
  assert.doesNotMatch(page.get('Preview').textContent, /PRIVATE/);
  assert.equal(page.get('Confirm').disabled, true);
  page.get('Recipient').value = target.id;
  page.get('Recipient').onchange();
  assert.equal(page.get('Confirm').disabled, false);
  await page.get('Confirm').onclick({ isTrusted: false });
  assert.equal(page.messages.some(message => message.type === 'chat:confirm-share'), false);
  await page.get('Confirm').onclick(trusted);
  assert.deepEqual(page.messages.find(message => message.type === 'chat:confirm-share'), {
    type: 'chat:confirm-share', draftId: share.draftId, destinationId: target.id, destinationVersion: target.version
  });
  assert.equal(page.get('Share').hidden, true);
  assert.match(page.get('Status').textContent, /加入投递队列/);
});

test('refresh invalidates the selected target when the destination version changes', async () => {
  const page = fixture({ share }); await flush();
  page.get('Recipient').value = target.id;
  page.state.destinations = [{ ...target, version: target.version + 1 }];
  await page.get('Refresh').onclick(trusted);
  assert.equal(page.get('Recipient').value, '');
  assert.equal(page.get('Confirm').disabled, true);
  await page.get('Discard').onclick(trusted);
  assert.deepEqual(page.messages.find(message => message.type === 'chat:discard-share'), { type: 'chat:discard-share', draftId: share.draftId });
});

test('match push opens the settings offer and requires trusted confirmation of a freshly selected target', async () => {
  const offerId = 'game-offer';
  const page = fixture({ matchPush: { offerId } }, false); await flush();
  assert.equal(page.get('Settings').hidden, false);
  assert.equal(page.get('MatchOffer').hidden, false);
  assert.equal(page.get('MatchConfirm').disabled, true);
  assert.match(page.get('MatchState').textContent, /终局点数/);
  const select = () => {
    page.get('MatchRecipient').value = target.id;
    page.get('MatchRecipient').onchange();
  };
  select();
  const version = target.version + 1;
  page.state.destinations = [{ ...target, version }];
  await page.get('Refresh').onclick(trusted);
  assert.equal(page.get('MatchRecipient').value, '');
  assert.equal(page.get('MatchConfirm').disabled, true);
  select();
  await page.get('MatchConfirm').onclick({ isTrusted: false });
  assert.equal(page.messages.some(message => message.type === 'chat:subscribe-match'), false);
  await page.get('MatchConfirm').onclick(trusted);
  assert.deepEqual(page.messages.find(message => message.type === 'chat:subscribe-match'), {
    type: 'chat:subscribe-match', offerId, destinationId: target.id, destinationVersion: version
  });
  assert.equal(page.get('MatchOffer').hidden, true);
  assert.match(page.get('MatchState').textContent, /已绑定「合成测试群」/);
  await page.get('MatchStop').onclick(trusted);
  assert.equal(page.get('MatchStop').hidden, true);
});

test('edit leaves credentials blank and asks for only the HTTPS host when replacing the endpoint', async () => {
  const page = fixture({ destinations: [{ ...target, url: 'SHOULD_NOT_READ_BACK', secret: 'SHOULD_NOT_READ_BACK' }] }); await flush();
  assert.doesNotMatch(page.get('Targets').text, /SHOULD_NOT_READ_BACK/);
  page.find('Targets', '编辑').onclick(trusted);
  assert.equal(page.get('Url').value, '');
  assert.equal(page.get('Secret').value, '');
  await page.get('Target').onsubmit(trusted);
  assert.equal(page.requests.length, 0);
  assert.deepEqual(page.messages.find(message => message.type === 'chat:save-target').target, { id: target.id, kind: target.kind, name: target.name });
  page.find('Targets', '编辑').onclick(trusted);
  page.get('Url').value = 'https://wrong.invalid/synthetic-hook';
  await page.get('Target').onsubmit(trusted);
  assert.equal(page.requests.length, 0);
  assert.match(page.get('Status').textContent, /飞书群自定义机器人/);
  const url = 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture';
  page.get('Url').value = url;
  page.behavior.allowPermission = false;
  await page.get('Target').onsubmit(trusted);
  assert.equal(page.messages.filter(message => message.type === 'chat:save-target').length, 1);
  assert.doesNotMatch(page.get('Status').textContent, /fixture/);
  page.behavior.allowPermission = true;
  await page.get('Target').onsubmit(trusted);
  assert.deepEqual(page.requests, [{ origins: ['https://open.feishu.cn/*'] }, { origins: ['https://open.feishu.cn/*'] }]);
  assert.deepEqual(page.messages.findLast(message => message.type === 'chat:save-target').target, { id: target.id, kind: target.kind, name: target.name, url, secret: '' });
  assert.equal(page.get('Url').value, '');
});

test('shows distinct outcomes and warns before retrying an unknown delivery', async () => {
  const page = fixture({ deliveries: ['pending', 'accepted', 'failed', 'unknown', 'expired'].map(status => ({
    id: status, status, destinationId: target.id, destinationVersion: target.version, retryable: status === 'unknown'
  })) }); await flush();
  for (const label of ['待发送', '平台已受理', '投递失败', '结果不明', '已过期']) assert.ok(page.get('Deliveries').text.includes(label));
  page.behavior.confirm = false;
  await page.find('Deliveries', '重试').onclick(trusted);
  assert.match(page.dialogs[0], /重复消息/);
  assert.equal(page.messages.some(message => message.type === 'chat:retry'), false);
  page.behavior.confirm = true;
  await page.find('Deliveries', '重试').onclick(trusted);
  assert.deepEqual(page.messages.find(message => message.type === 'chat:retry'), { type: 'chat:retry', id: 'unknown' });
});

test('disabled sending blocks test while explicit actions configure, test, clear and remove', async () => {
  const page = fixture({ enabled: false }); await flush();
  assert.equal(page.find('Targets', '发送测试').disabled, true);
  await page.get('Enabled').onchange({ isTrusted: true, target: { checked: true } });
  await page.find('Targets', '发送测试').onclick(trusted);
  assert.match(page.get('Deliveries').text, /测试消息待发送/);
  await page.get('Clear').onclick(trusted);
  await page.find('Targets', '删除').onclick(trusted);
  assert.deepEqual(page.messages.filter(message => message.type !== 'chat:status'), [
    { type: 'chat:configure', enabled: true }, { type: 'chat:test', id: target.id }, { type: 'chat:clear' }, { type: 'chat:remove-target', id: target.id }
  ]);
});
