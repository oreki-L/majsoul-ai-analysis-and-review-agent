'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const UI = require('../agent/model-manager-ui/app.js');
const source = fs.readFileSync(require.resolve('../agent/model-manager-ui/app.js'), 'utf8');
const blank = () => ({ format: 'local-model-manager-v1', models: [], operation: null, bridge: { state: 'stopped', profile: null, url: null, token: null } });
function page(respond = () => ({ ok: true, json: async () => blank() })) {
  const nodes = new Map(), requests = [], timers = [];
  function node(tag = 'div') { return { tag, value: '', hidden: false, disabled: false, children: [], className: '', textContent: '', classList: { toggle() {} }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, setAttribute() {}, addEventListener(name, fn) { this['on' + name] = fn; } }; }
  for (const id of ['message', 'workspace', 'connection', 'disconnect', 'runningState', 'stop', 'analysisConfig', 'analysisEndpoint', 'analysisToken', 'dataDirectory', 'directorySummary', 'models', 'runtimes', 'refresh', 'connectForm', 'connect', 'managementToken', 'copyEndpoint', 'copyToken']) nodes.set(id, node());
  nodes.get('workspace').hidden = true;
  const context = vm.createContext({ URL, document: { getElementById: id => nodes.get(id), createElement: node }, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, addEventListener() {}, fetch: async (url, options) => { requests.push({ url, options }); return respond(url, options); }, navigator: { clipboard: { writeText: async () => {} } } });
  vm.runInContext(source, context);
  return { requests, nodes, timers, el: id => nodes.get(id), async connect(token) { nodes.get('managementToken').value = token; nodes.get('connectForm').onsubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); } };
}
test('zero models and pending entries are valid; no model can start without verified installation', () => {
  assert.deepEqual(UI.actions({ id: 'pending', installable: false, installed: false }, blank()), { install: false, remove: false, start: false, running: false });
  assert.equal(UI.actions({ id: 'v4', installable: true, installed: false }, blank()).start, false);
  assert.equal(UI.actions({ id: 'v4', installable: true, installed: true, state: 'invalid' }, blank()).start, false);
  const running = { ...blank(), bridge: { state: 'running', profile: 'v4' } };
  assert.equal(UI.actions({ id: 'v4', installable: true, installed: true }, running).remove, false);
  assert.equal(UI.actions({ id: 'v2', installable: true, installed: true }, running).start, true);
  assert.equal(UI.actions({ id: 'v2', installable: true, installed: true }, { ...running, operation: { state: 'running' } }).start, false);
});
test('page never contacts manager before explicit connection; token is only sent in Authorization', async () => {
  const p = page(); assert.equal(p.requests.length, 0);
  await p.connect('MANAGEMENT_SECRET');
  assert.equal(p.requests.length, 1); assert.equal(p.requests[0].url, '/api/status');
  assert.equal(p.requests[0].options.headers.Authorization, 'Bearer MANAGEMENT_SECRET');
  assert.equal(p.el('managementToken').value, ''); assert.equal(p.el('workspace').hidden, false);
  assert.match(p.el('directorySummary').textContent, /已安装 0 个/);
  p.el('disconnect').onclick(); assert.equal(p.el('workspace').hidden, true); assert.equal(p.el('analysisToken').value, '');
});
test('analysis credential is separate, disappears after stopping, and installation does not imply success', async () => {
  let state = { ...blank(), models: [{ id: 'v4', name: 'test', installable: true, installed: true, state: 'running' }], bridge: { state: 'running', profile: 'v4', url: 'http://127.0.0.1:17342/analyze', token: 'ANALYSIS_SECRET' } };
  const p = page((url, options) => { if (options.method === 'POST') state = { ...state, operation: { profile: 'v4', action: 'stop', state: 'running' }, bridge: { state: 'stopping' } }; return { ok: true, json: async () => state }; });
  await p.connect('MANAGEMENT_SECRET'); assert.equal(p.el('analysisToken').value, 'ANALYSIS_SECRET');
  await p.el('stop').onclick();
  assert.equal(p.requests[1].url, '/api/stop'); assert.equal(p.requests[1].options.body, '{}');
  assert.equal(p.el('analysisToken').value, ''); assert.equal(p.el('analysisConfig').hidden, true);
  assert.match(p.el('message').textContent, /等待状态更新/); assert.doesNotMatch(p.el('message').textContent, /已完成/);
});
test('failed API operation reports failure without changing local installation state', async () => {
  const state = { ...blank(), models: [{ id: 'v4', name: 'test', installable: true, installed: false, state: 'not-installed' }] };
  const p = page((url, options) => options.method === 'POST' ? { ok: false, json: async () => ({ error: 'DOWNLOAD_HASH_MISMATCH' }) } : { ok: true, json: async () => state });
  await p.connect('M'); const card = p.el('models').children[0], buttons = card.children.at(-1);
  await buttons.children[0].onclick(); assert.match(p.el('message').textContent, /DOWNLOAD_HASH_MISMATCH/);
  assert.equal(p.el('models').children[0].children.at(-1).children[1].disabled, true);
});
test('untrusted catalog links never use script or plain HTTP URLs', () => {
  assert.equal(UI.safeLink('javascript:alert(1)'), null); assert.equal(UI.safeLink('http://example.com'), null);
  assert.equal(UI.safeLink('https://huggingface.co/a/b'), 'https://huggingface.co/a/b'); assert.equal(UI.size(null), '大小待确认');
});
