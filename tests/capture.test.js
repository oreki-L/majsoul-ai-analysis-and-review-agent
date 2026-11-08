const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const F = require('./fixtures.js'), P = require('../extension/protocol.js');
const makeController = () => require('../extension/collector/controller').create({
  state: require('../extension/state'), history: require('../extension/history') });
function harness() {
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.listeners = new Map(); this.sent = []; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
    send(data) { if (data === 'throw') throw new Error('native error'); this.sent.push(data); }
  }
  class XHR { open() {} send() {} addEventListener() {} }
  const messages = [], requests = [], timers = [];
  const context = { TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, Map, Set, WeakMap, URL, Request, Blob, XMLHttpRequest: XHR,
    WebSocket: Socket, location: { href: 'https://game.maj-soul.com/1/', origin: 'https://game.maj-soul.com' },
    setTimeout: fn => { timers.push(fn); return timers.length; }, addEventListener() {},
    postMessage: message => messages.push(message),
    fetch: (...args) => { requests.push(args); return Promise.resolve({ marker: 'native', url: String(args[0]), headers: new Headers() }); } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync('extension/protocol.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('extension/capture.js', 'utf8'), context);
  return { context, Socket, messages, requests, timers };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const action = (step, name, body, masked = false) => F.cat(F.n(1, step), F.t(2, name), F.b(3, masked ? P.unmask(body) : body));
const restoreResponse = actions => F.b(4, F.cat(...actions.map(a => F.b(2, a))));

test('authGame resolves nondealer seat without exporting account, token or session', async () => {
  const h = harness(), socket = new h.context.WebSocket('wss://route-1.maj-soul.com/gateway');
  socket.send(F.frame(2, '.lq.FastTest.authGame', F.cat(F.n(1, 987654), F.t(2, 'SECRET_TOKEN'), F.t(4, 'SECRET_SESSION')), 4));
  socket.emit('message', { data: F.frame(3, '', F.packed(3, [100001, 100002, 987654, 100004]), 4) });
  socket.emit('message', { data: F.frame(1, '.lq.ActionPrototype', action(0, 'ActionNewRound', F.cat(F.strings(4, F.hand), F.packed(6, [25000,25000,25000,25000])), true)) });
  await flush();
  const c = makeController();
  for (const m of h.messages) c.receive(m);
  assert.equal(c.getView().live.selfSeat, 2);
  assert.equal(c.getView().live.complete, true);
  assert.doesNotMatch(JSON.stringify(h.messages), /987654|100001|SECRET_/);
  await c.flush();
});

test('enter/sync restoration decodes plain bodies, preserves order and deduplicates incremental actions', async () => {
  for (const method of ['enterGame', 'syncGame']) {
    const h = harness(), socket = new h.context.WebSocket('wss://route-1.maj-soul.com/gateway');
    const opening = action(0, 'ActionNewRound', F.liveRound());
    const draw = action(1, 'ActionDealTile', F.cat(F.n(1, 1), F.t(2, '1m'), F.n(3, 68)));
    socket.send(F.frame(2, '.lq.FastTest.' + method, [], 3));
    socket.emit('message', { data: F.frame(3, '', restoreResponse([opening, draw]), 3) });
    socket.send(F.frame(2, '.lq.FastTest.syncGame', [], 4));
    socket.emit('message', { data: F.frame(3, '', restoreResponse([draw]), 4) });
    await flush();
    const events = h.messages.filter(m => m.type === 'event');
    assert.deepEqual(events.map(m => m.payload.encoding), ['plain', 'plain', 'plain']);
    assert.ok(events.every(m => m.payload.restored === true));
    const c = makeController();
    for (const m of h.messages) c.receive(m);
    assert.equal(c.getView().live.selfHand.length, 14);
    assert.equal(c.getView().live.lastStep, 1);
    assert.equal(c.getView().live.complete, true);
    await c.flush();
  }
});

test('snapshot-only recovery remains incomplete and malformed restore publishes no partial opening', async () => {
  for (const body of [F.b(4, F.cat(F.b(1, F.n(1, 0)), F.b(2, action(5, 'ActionDealTile', F.n(1, 1))))),
    restoreResponse([action(0, 'ActionNewRound', F.liveRound()), F.cat(F.n(1, 1), F.t(2, 'ActionDealTile'), F.b(3, [255]))])]) {
    const h = harness(), socket = new h.context.WebSocket('wss://route-1.maj-soul.com/gateway');
    socket.send(F.frame(2, '.lq.FastTest.syncGame', [], 1));
    socket.emit('message', { data: F.frame(3, '', body, 1) }); await flush();
    const c = makeController();
    for (const m of h.messages) c.receive(m);
    assert.equal(c.getView().live.complete, false);
    assert.equal(h.messages.some(m => m.type === 'event' && m.payload.kind === 'NewRound'), false);
    await c.flush();
  }
});

test('close follows queued Blob action so delayed decoding cannot resurrect a complete connection', async () => {
  const h = harness(), socket = new h.context.WebSocket('wss://route-1.maj-soul.com/gateway');
  socket.emit('message', { data: new Blob([F.frame(1, '.lq.ActionPrototype', action(0, 'ActionNewRound', F.liveRound(), true))]) });
  socket.emit('close'); await flush(); await flush();
  assert.equal(h.messages.filter(m => ['event', 'connection'].includes(m.type)).at(-1).payload.state, 'closed');
  const c = makeController();
  for (const m of h.messages) c.receive(m);
  assert.equal(c.getView().live.complete, false);
  assert.equal(c.getView().live.turnProgress.reason, 'disconnected');
  await c.flush();
});
test('wrapper preserves WebSocket instance, constants, send payload and native exceptions', () => {
  const h = harness(), socket = new h.context.WebSocket('wss://route-1.maj-soul.com/gateway');
  assert.ok(socket instanceof h.Socket); assert.ok(socket instanceof h.context.WebSocket);
  assert.equal(h.context.WebSocket.OPEN, 1);
  const frame = F.frame(2, '.lq.Lobby.heatbeat', []); socket.send(frame);
  assert.equal(socket.sent[0], frame); assert.throws(() => socket.send('throw'), /native error/);
});
test('login secrets and unrelated traffic are never emitted, only normalized action fields', async () => {
  const h = harness(), socket = new h.context.WebSocket('wss://route-1.maj-soul.com/gateway');
  socket.send(F.frame(2, '.lq.Lobby.login', F.t(2, 'PRIVATE_TOKEN'), 1));
  socket.emit('message', { data: F.frame(3, '', F.t(1, 'PRIVATE_ACCOUNT'), 1) });
  const action = F.cat(F.n(1, 0), F.t(2, 'ActionNewRound'), F.b(3, P.unmask(F.liveRound())));
  socket.emit('message', { data: F.frame(1, '.lq.ActionPrototype', action) });
  await flush();
  const serialized = JSON.stringify(h.messages);
  assert.equal(serialized.includes('PRIVATE_'), false); assert.equal(serialized.includes('Lobby.login'), false);
  const events = h.messages.filter(m => m.type === 'event'); assert.equal(events.length, 1); assert.equal(events[0].payload.kind, 'NewRound');
});
test('Blob arrivals preserve event order and request IDs are isolated per socket', async () => {
  const h = harness();
  const a = new h.context.WebSocket('wss://route-1.maj-soul.com/gateway');
  const b = new h.context.WebSocket('wss://route-2.maj-soul.com/gateway');
  a.send(F.frame(2, '.lq.Lobby.fetchGameRecord', [], 9));
  b.send(F.frame(2, '.lq.Lobby.login', [], 9));
  const record = F.wrap('.lq.GameDetailRecords', F.b(1, F.wrap('.lq.RecordNewRound', F.replayRound())));
  b.emit('message', { data: F.frame(3, '', F.b(4, record), 9) });
  a.emit('message', { data: new Blob([F.frame(3, '', F.b(4, record), 9)]) });
  await flush(); await flush();
  assert.equal(h.messages.filter(m => m.type === 'replay').length, 1);
  assert.equal(h.requests.length, 0);
});
test('unrelated sockets and native fetch result are untouched', async () => {
  const h = harness(), socket = new h.context.WebSocket('wss://example.com/gateway');
  assert.equal(socket.listeners.size, 0);
  const result = await h.context.fetch('https://game.maj-soul.com/asset.bin');
  assert.equal(result.marker, 'native'); assert.equal(h.requests.length, 1);
});
