const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/collector/controller.js');
const S = require('../extension/state.js'), H = require('../extension/history.js');
const P = require('../extension/protocol.js'), F = require('./fixtures.js');
const opening = (source = 'live', more = {}) => ({ ...P.decodeEvent('ActionNewRound', F.liveRound(), 'live'), source, step: 0, ...more });
const make = options => C.create({ state: S, history: H, clock: () => 1700000000000, id: () => 'test', hash: async () => 'hash', ...options });
const send = (c, event) => c.receive({ type: 'event', payload: event });
const end = c => send(c, { source: 'live', kind: 'NoTile', step: 1, scores: [25000,25000,25000,25000] });

test('real in-page reconnect restores missed actions without inventing interrupted matches', async () => {
  const fixture = require('./fixtures/live-reconnect-2026-11-06.json');
  let sequence = 0, matchId = null, disconnects = 0;
  const c = make({ id: () => `live-fixture-${++sequence}` });
  for (const message of fixture.messages) {
    c.receive(message);
    const view = c.getView();
    if (message.type === 'event' && message.payload.kind === 'NewRound') {
      if (matchId === null) matchId = view.contextIdentity.matchId;
      assert.equal(view.contextIdentity.matchId, matchId);
    }
    if (message.type === 'connection' && message.payload.state === 'closed' && [5,6].includes(message.payload.socketId)) {
      disconnects++;
      assert.equal(view.live.complete, false);
      assert.equal(view.live.availableActions, null);
    }
  }
  const view = c.getView(), s = view.live;
  assert.equal(disconnects, 2);
  assert.equal(s.selfSeat, 0); assert.equal(s.lastStep, 9);
  assert.equal(s.complete, true); assert.deepEqual(s.warnings, []);
  assert.equal(s.remaining, 65); assert.deepEqual(s.doras, ['2p']);
  assert.deepEqual(s.selfHand.slice().sort(), ['9p','2s','4m','5p','5z','8p','2z','8p','3p','0p','8p','2p','5s','5m'].sort());
  assert.deepEqual(s.players.map(p => p.discards.map(d => d.tile)), [['1m'],['6m'],['2z'],['9s']]);
  assert.deepEqual(s.turnProgress.bySeat, [2,2,2,2]);
  assert.deepEqual(s.availableActions, { seat: 0, lastStep: 9, types: [1] });
  assert.deepEqual(view.historyMatches, []);
  await c.flush();
});

test('restored MJStart with a different opening does not merge unrelated matches', async () => {
  let sequence = 0;
  const c = make({ id: () => `different-opening-${++sequence}` });
  send(c, { kind: 'MJStart', source: 'live', step: 0 });
  send(c, opening('live', { step: 1 }));
  const original = c.getView().contextIdentity.matchId;
  send(c, { kind: 'MJStart', source: 'live', step: 0, restored: true });
  send(c, opening('live', { step: 1, restored: true, doras: ['1z'] }));
  assert.notEqual(c.getView().contextIdentity.matchId, original);
  assert.equal(c.getView().historyMatches.length, 1);
  assert.equal(c.getView().historyMatches[0].rounds[0].snapshot.result.kind, 'Interrupted');
  await c.flush();
});

test('new socket recovery ignores old socket actions and late close', async () => {
  const c = make();
  send(c, opening('live', { socketId: 1 }));
  c.receive({ type: 'connection', payload: { socketId: 1, state: 'closed' } });
  send(c, opening('live', { socketId: 2 }));
  const recovered = c.getView().live;
  send(c, { source: 'live', kind: 'DiscardTile', seat: 1, tile: '7m', step: 9, socketId: 1 });
  c.receive({ type: 'connection', payload: { socketId: 1, state: 'closed' } });
  assert.deepEqual(c.getView().live, recovered);
  send(c, { source: 'live', kind: 'DealTile', seat: 1, tile: '1m', step: 1, socketId: 3 });
  assert.equal(c.getView().live.complete, false);
  assert.equal(c.getView().live.availableActions, null);
  await c.flush();
});

test('collection failures invalidate turns until the next observed opening', async () => {
  for (const [message, reason] of [
    [{ type: 'diagnostic', payload: { stage: '动作解码' } }, 'collection_error'],
    [{ type: 'connection', payload: { socketId: 1, state: 'closed' } }, 'disconnected'],
    [{ type: 'event', payload: { source: 'live', kind: 'DiscardTile', seat: 99, step: 1 } }, 'invalid_event']
  ]) {
    const c = make(); send(c, opening());
    assert.equal(c.getView().live.turnProgress.status, 'known');
    c.receive(message);
    assert.equal(c.getView().live.turnProgress.reason, reason);
    assert.deepEqual(c.getView().live.turnProgress.bySeat, [null,null,null,null]);
    send(c, opening('live', { round: 1 }));
    assert.equal(c.getView().live.turnProgress.status, 'known');
    await c.flush();
  }
});

test('replay cursor rebuilds turn progress without affecting live collection', async () => {
  const c = make(); send(c, opening());
  const records = [opening('replay', { recordIndex: 0 }),
    { source: 'replay', kind: 'DiscardTile', seat: 2, tile: '1p', recordIndex: 1 },
    { source: 'replay', kind: 'DealTile', seat: 1, tile: '2p', recordIndex: 3 }];
  c.receive({ type: 'replay', payload: { records } });
  c.next(); assert.deepEqual(c.getView().state.turnProgress.bySeat, [1,1,2,1]);
  c.next(); assert.equal(c.getView().state.turnProgress.reason, 'event_gap');
  c.previous(); assert.equal(c.getView().state.turnProgress.status, 'known');
  c.roundStart(); assert.deepEqual(c.getView().state.turnProgress.bySeat, [1,1,1,1]);
  c.setMode('live'); assert.deepEqual(c.getView().state.turnProgress.bySeat, [1,1,1,1]);
  await c.flush();
});

test('replay revision tracks replacement even at identical lengths, independently of cursor', async () => {
  const c = make();
  assert.equal(c.getView().replayRevision, 0);
  const load = round => c.receive({ type: 'replay', payload: { records: [opening('replay', { round })] } });
  load(0); assert.equal(c.getView().replayRevision, 1);
  c.setCursor(0); c.setCursor(1); c.setMode('live'); c.setMode('replay');
  assert.equal(c.getView().replayRevision, 1);
  load(1); assert.equal(c.getView().replayRevision, 2);
  assert.equal(c.getView().recordCount, 1);
  await c.flush();
});

test('analysis identity distinguishes repeated live openings and only the replay prefix selects round start', async () => {
  const c = make(); send(c, opening());
  const first = c.getView().contextIdentity;
  send(c, { source: 'live', kind: 'DealTile', seat: 1, tile: '2p', step: 1 });
  assert.deepEqual(c.getView().contextIdentity, first);
  send(c, opening()); assert.notEqual(c.getView().contextIdentity.roundStartId, first.roundStartId);
  const records = [opening('replay', { recordIndex: 0 }),
    { source: 'replay', kind: 'DiscardTile', seat: 2, tile: '1p', recordIndex: 1 }, opening('replay', { recordIndex: 2, round: 1 })];
  c.receive({ type: 'replay', payload: { records } });
  const before = c.getView().contextIdentity;
  assert.equal(before.roundStartId, '0'); c.setCursor(2);
  assert.deepEqual(c.getView().contextIdentity, before);
  c.setCursor(3); assert.equal(c.getView().contextIdentity.roundStartId, '2');
  c.setCursor(1); assert.deepEqual(c.getView().contextIdentity, before);
  c.receive({ type: 'replay', payload: { records } });
  assert.notEqual(c.getView().contextIdentity.matchId, before.matchId);
  await c.flush();
});

test('pure controller keeps live and replay state independent and cursor excludes future draws', async () => {
  const c = make();
  send(c, opening()); c.setSelfSeat(1);
  const hand = ['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','2p','3p','4p'];
  c.receive({ type: 'replay', payload: { records: [opening('replay', { hands: [hand, hand, hand, hand] }),
    { source: 'replay', kind: 'DealTile', seat: 0, tile: '5p', step: 1 }] } });
  c.setSelfSeat(0);
  assert.equal(c.getView().cursor, 1);
  assert.equal(c.getView().state.players[0].hand.length, 13);
  c.next(); assert.equal(c.getView().state.players[0].hand.length, 14);
  c.previous(); assert.equal(c.getView().state.players[0].hand.length, 13);
  c.setMode('live'); assert.equal(c.getView().state.selfSeat, 1);
  c.setMode('replay'); assert.equal(c.getView().state.selfSeat, 0);
  c.setCursor(999); assert.equal(c.getView().cursor, 2);
  c.roundStart(); assert.equal(c.getView().cursor, 1);
  await c.flush();
});

test('history view stays fixed while new live rounds continue collecting and export is detached', async () => {
  const c = make(); send(c, opening()); end(c); await c.flush();
  const m = c.getView().historyMatches[0]; c.viewRound(m.id, m.rounds[0].key);
  const viewed = c.getView().state;
  send(c, opening('live', { round: 1 }));
  assert.deepEqual(c.getView().state, viewed);
  assert.equal(c.getView().live.round.index, 1);
  const data = c.exportData(); data.state.players[0].discards.push({ tile: '9s' });
  data.historyMatches.length = 0; data.events.length = 0;
  assert.equal(c.getView().historyMatches.length, 1);
  assert.deepEqual(c.getView().state, viewed);
  c.returnToCurrent(); assert.equal(c.getView().state.round.index, 1);
});

test('async history loading preserves newly collected rounds and serializes all writes', async () => {
  let releaseLoad, releaseFirst, active = 0, maxActive = 0;
  const saved = [];
  const c = make({ storage: { load: () => new Promise(resolve => { releaseLoad = resolve; }),
    async save(match) { active++; maxActive = Math.max(maxActive, active); saved.push(match);
      if (saved.length === 1) await new Promise(resolve => { releaseFirst = resolve; }); active--; }
  } });
  send(c, opening()); end(c);
  assert.equal(saved.length, 0);
  releaseLoad([]); await c.ready; await Promise.resolve();
  send(c, opening('live', { round: 1 })); end(c);
  assert.equal(saved.length, 1); releaseFirst(); await c.flush();
  assert.equal(maxActive, 1); assert.equal(saved.at(-1).rounds.length, 2);
  assert.equal(c.getView().historyMatches[0].rounds.length, 2);
});

test('storage errors remain visible and unsubscribed views receive no updates', async () => {
  const c = make({ storage: { load: async () => [], save: async () => { throw new Error('disk full'); } } });
  await c.ready;
  let count = 0; const release = c.subscribe(() => { count++; c.getView().live.phase = 'corrupted'; });
  send(c, opening()); assert.equal(count, 1); assert.equal(c.getView().live.phase, 'playing');
  release(); end(c); await c.flush(); assert.equal(count, 1);
  assert.match(c.getView().historyWarning, /保存失败/);
});


test('maximum replay remains outside display views and notifications do not copy it', async () => {
  const c = make();
  const events = [opening('replay'), ...Array.from({ length: 24999 }, (_, i) => ({ source: 'replay', kind: 'Unsupported', step: i + 1 }))];
  c.receive({ type: 'replay', payload: { records: events } }); await c.flush();
  let notifications = 0, largeCopies = 0;
  const stringify = JSON.stringify;
  JSON.stringify = function(value, ...args) {
    if (value?.records?.length === 25000 || value?.replayRecords?.length === 25000) largeCopies++;
    return stringify.call(JSON, value, ...args);
  };
  try {
    const release = c.subscribe((...args) => { assert.equal(args.length, 0); notifications++; });
    for (let i = 0; i < 20; i++) c.receive({ type: 'status', payload: { incoming: i } });
    const view = c.getView();
    assert.equal(view.recordCount, 25000); assert.equal(view.records, undefined);
    assert.ok(view.recentEvents.length <= 8);
    assert.equal(largeCopies, 0); assert.equal(notifications, 20);
    // Full records are still available explicitly for an export.
    assert.equal(c.exportData().replayRecords.length, 25000); assert.equal(largeCopies, 1);
    release();
  } finally { JSON.stringify = stringify; }
});

test('real message blackhole rebuilds dropped actions against the upstream oracle', async () => {
  const fixture = require('./fixtures/live-network-blackhole-2026-11-09.json');
  const all = [...fixture.messages, ...fixture.oracleMessages].sort((a, b) => a.at.localeCompare(b.at));
  const keyFor = event => JSON.stringify([event.wind, event.round, event.honba, event.scores, event.hand, event.doras]);
  let oracleSequence = 0, openingKey = '';
  const oracle = make({ id: () => 'oracle-' + ++oracleSequence });
  const states = new Map(); await oracle.ready;
  for (const message of all) {
    const event = message.payload;
    if (message.type === 'event' && event.kind === 'NewRound') openingKey = keyFor(event);
    oracle.receive(message);
    if (message.type !== 'event') continue;
    const key = openingKey + ':' + event.step;
    if (!states.has(key)) states.set(key, structuredClone(oracle.getView().live));
  }
  let sequence = 0, batch = null, compared = 0, matchId = null, recovered = false;
  const c = make({ id: () => 'blackhole-' + ++sequence });
  const batches = []; openingKey = ''; await c.ready;
  assert.equal(fixture.oracleMessages.length, 97);
  const outageStart = Date.parse(fixture.outage.start), outageEnd = outageStart + fixture.outage.durationMs;
  assert.equal(fixture.messages.some(m => m.type === 'event' && Date.parse(m.at) >= outageStart && Date.parse(m.at) < outageEnd), false);
  for (const message of fixture.messages) {
    const event = message.payload;
    if (message.type === 'event' && event.kind === 'NewRound') openingKey = keyFor(event);
    c.receive(message);
    if (message.type !== 'event') continue;
    const view = c.getView();
    if (event.kind === 'NewRound') {
      if (matchId === null) matchId = view.contextIdentity.matchId;
      assert.equal(view.contextIdentity.matchId, matchId);
      if (event.restored) recovered = true;
    }
    if (event.restored) {
      if (!batch || batch.socketId !== event.socketId || event.kind === 'NewRound') {
        batch = { socketId: event.socketId, count: 0, lastStep: null }; batches.push(batch);
      }
      batch.count++; batch.lastStep = event.step;
      assert.deepEqual(view.live, states.get(openingKey + ':' + event.step), 'restored state differs from upstream oracle at step ' + event.step);
      compared++;
    } else batch = null;
    if (recovered && event.kind !== 'Seat') {
      assert.equal(view.live.complete, true);
      assert.deepEqual(view.live.warnings, []);
    }
  }
  await c.flush(); await oracle.flush();
  assert.deepEqual(batches, [{ socketId: 4, count: 85, lastStep: 84 }, { socketId: 8, count: 130, lastStep: 129 }]);
  assert.equal(compared, 215);
  const view = c.getView();
  assert.deepEqual(view.live, oracle.getView().live);
  assert.equal(view.live.selfSeat, 3);
  assert.deepEqual(view.live.scores, [28000, 25000, 24000, 21000]);
  assert.equal(view.historyMatches.length, 1);
  assert.equal(view.historyMatches[0].closed, false);
  assert.equal(view.historyMatches[0].rounds.length, 2);
  assert.equal(view.historyWarning, '');
});

test('game-only blackhole detects a missing draw and repairs the same connection before play continues', async () => {
  const fixture = require('./fixtures/live-game-blackhole-2026-11-09.json');
  const all = [...fixture.messages, ...fixture.oracleMessages].sort((a, b) => a.at.localeCompare(b.at));
  let oracleSequence = 0, sequence = 0;
  const oracle = make({ id: () => 'upstream-' + ++oracleSequence });
  const c = make({ id: () => 'delivered-' + ++sequence });
  await Promise.all([oracle.ready, c.ready]);
  const states = new Map();
  for (const message of all) {
    oracle.receive(message);
    if (message.type === 'event' && !message.payload.restored) states.set(message.payload.step, structuredClone(oracle.getView().live));
  }
  assert.deepEqual(fixture.oracleMessages.map(m => [m.payload.kind, m.payload.step]), [['DealTile', 17]]);
  let gapDetected = false, recovered = false, restored = 0;
  for (const message of fixture.messages) {
    c.receive(message);
    if (message.type !== 'event') continue;
    const event = message.payload, view = c.getView();
    if (!event.restored && event.step === 18) {
      assert.equal(view.live.complete, false); gapDetected = true;
    }
    if (event.restored) {
      assert.equal(event.socketId, 4);
      assert.deepEqual(view.live, states.get(event.step), 'recovered step differs from upstream: ' + event.step);
      restored++; if (event.kind === 'NewRound') recovered = true;
    }
    if (recovered && event.kind !== 'MJStart') {
      assert.equal(view.live.complete, true); assert.deepEqual(view.live.warnings, []);
    }
  }
  await Promise.all([oracle.flush(), c.flush()]);
  assert.equal(gapDetected, true); assert.equal(restored, 24);
  assert.deepEqual(c.getView().live, oracle.getView().live);
  assert.equal(c.getView().live.selfSeat, 0);
  assert.equal(c.getView().live.lastStep, 31);
  assert.equal(c.getView().historyMatches.length, 0);
});
