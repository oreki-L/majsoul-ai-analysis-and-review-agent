'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Agent = require('../extension/agent.js');
const A = require('../extension/analysis.js');
const C = require('../extension/contracts/snapshot.js');
const { fixture } = require('../agent/eval.cjs');
const parse = m => JSON.parse(m.content.split('\n')[1]);
async function capture(snapshot, { task = 'combined', lane = 'live', question = '', context = {} } = {}) {
  let sent;
  const session = { baseline: { snapshot: fixture('999m123p123s111z2z'), position: 0, origin: 'round-start' },
    checkpoint: { position: snapshot.lastStep }, lane, timeline: [], ...context };
  const before = JSON.stringify(session);
  await Agent.run({ snapshot, task, question, contextPolicy: 'live-ned', sessionContext: session,
    transport: async () => { throw Error('not used'); }, runtime: { run: async request => {
      sent = request;
      return { text: JSON.stringify({ task, danger: [], efficiency: [], decision: { action: 'unknown', tile: null, reasons: ['限制'] }, limitations: [] }), turns: 1, toolCalls: 0 };
    } } });
  assert.equal(JSON.stringify(session), before, 'local history must not be trimmed');
  return sent;
}
test('NED sends one current snapshot and important authorized events, never old snapshots or answers', async () => {
  const s = fixture('123m123p123s111z20p'); s.source = 'live'; s.lastStep = 4; s.selfDrawnTile = '0p';
  const oldAnswer = 'OLD_AUTOMATIC_ADVICE';
  const events = [
    { kind: 'NewRound', source: 'live', position: 0, selfHand: ['9m'] },
    { kind: 'DiscardTile', source: 'live', seat: 1, position: 1, tile: '1p', riichi: true },
    { kind: 'DiscardTile', source: 'live', seat: 1, position: 2, tile: '2p' },
    { kind: 'ChiPengGang', source: 'replay', seat: 2, position: 3, tiles: ['9s'] },
    { kind: 'Hule', source: 'live', position: 5 }
  ];
  const sent = await capture(s, { context: { events, timeline: [{ type: 'exchange', request: 'OLD_SNAPSHOT', answer: oldAnswer },
    { type: 'observation', position: 4, events: [{ kind: 'BaBei', source: 'live', seat: 2, position: 4 }] }] } });
  assert.equal(sent.messages.length, 2);
  const evidence = parse(sent.messages[0]), current = parse(sent.messages[1]);
  assert.deepEqual(current.snapshot, C.cleanSnapshot(s));
  assert.deepEqual(evidence.importantEvents.map(e => e.kind), ['NewRound', 'DiscardTile', 'BaBei']);
  assert.doesNotMatch(JSON.stringify(sent.messages), /OLD_|initialSnapshot|999m|9s|"position":5/);
  assert.equal(evidence.navigation.hand.rawCounts['0p'], 1);
  assert.equal(evidence.navigation.hand.shapeCounts['5p'], 1);
  assert.equal(evidence.navigation.hand.drawnTileIncludedInHand, true);
  assert.equal(evidence.binding.position, current.position);
  assert.equal(sent.budget.maxToolCalls, 4);
  assert.equal(sent.budget.timeoutMs, 25000);
});
test('NED proactive E/D are numerically identical to current tools and attach river sources', async () => {
  const s = fixture('123m123p123s111z22z'); s.lastStep = 9;
  s.rivers[1].discards.push({ tile: '1m', riichi: true });
  const sent = await capture(s), e = parse(sent.messages[0]);
  for (const [key, tool] of [['efficiency', 'compare_discards'], ['danger', 'get_danger_evidence']]) {
    const result = await sent.tools.find(t => t.name === tool).execute('test', {});
    const value = JSON.parse(result.content[0].text);
    value.candidates.sort((a, b) => a.tile.localeCompare(b.tile));
    assert.deepEqual(e[key].calculation, value);
    assert.deepEqual(e[key].binding, e.binding);
  }
  assert.deepEqual(e.danger.genbutsuSources.find(c => c.tile === '1m').opponents.find(p => p.seat === 1).discards, [{ index: 0, tile: '1m' }]);
  assert.match(sent.systemPrompt, /至少比较一个实质备选/);
  assert.equal(sent.tools.length, 6);
});
test('NED task boundaries preserve danger-only and efficiency-only contracts', async () => {
  const s = fixture('123m123p123s111z22z');
  for (const task of ['efficiency', 'danger']) {
    const sent = await capture(s, { task }), e = parse(sent.messages[0]);
    assert.ok(e[task]);
    assert.equal(e[task === 'danger' ? 'efficiency' : 'danger'], undefined);
    assert.equal(/至少比较一个实质备选/.test(sent.systemPrompt), task === 'efficiency');
    if (task === 'danger') assert.deepEqual(parse(sent.messages.at(-1)).outputConstraints.legalDiscards, []);
  }
});
test('NED preserves sanma dora cycle, red fives and dealer-relative seat winds', async () => {
  const s = fixture('19m123p123s111z20p'); s.playerCount = 3; s.selfSeat = 2;
  s.game.players.pop(); s.game.scores.pop(); s.rivers.pop();
  s.game.round.index = 1; s.game.doras = ['1m', '9m', '4z', '7z', '0p', '?', '5m'];
  const e = parse((await capture(s)).messages[0]);
  assert.deepEqual(e.navigation.doras.map(d => d.tile), ['9m', '1m', '1z', '5z', '6p', null, null]);
  assert.deepEqual(e.navigation.players.map(p => p.wind), ['3z', '1z', '2z']);
  assert.deepEqual(e.navigation.players.map(p => p.relativeToSelf), [1, 2, 0]);
  s.game.round.index = null;
  assert.ok(parse((await capture(s)).messages[0]).navigation.players.every(p => p.dealer === null && p.wind === null));
});
test('NED never restores revoked game, hand or river facts from local history', async () => {
  const s = fixture('123m123p123s111z22z'); delete s.selfHand; delete s.game; s.rivers = [s.rivers[1]];
  s.selfDrawnTile = '7z';
  const sent = await capture(s, { context: { events: [{ kind: 'ChiPengGang', source: s.source, position: 0, seat: 2, tiles: ['9m'] },
    { kind: 'DiscardTile', source: s.source, position: 0, seat: 2, tile: '9m', riichi: true }] } });
  const e = parse(sent.messages[0]);
  assert.equal(e.navigation.hand, null); assert.equal(e.navigation.round, null); assert.equal(e.navigation.players, null);
  assert.deepEqual(e.importantEvents, []);
  assert.equal(e.efficiency.calculation.status, 'unavailable');
  assert.equal(parse(sent.messages.at(-1)).snapshot.selfHand, undefined);
  assert.equal(parse(sent.messages.at(-1)).snapshot.selfDrawnTile, undefined);
  assert.ok(e.danger.genbutsuSources.every(c => c.opponents.every(p => p.discards.length === 0)));
});
test('manual, review and question branches retain full context rather than NED', async () => {
  const s = fixture('123m123p123s111z2z');
  for (const options of [{ lane: 'manual-live' }, { lane: 'manual-review' }, { question: '解释当时判断' }]) {
    const sent = await capture(s, options);
    assert.match(sent.messages[0].content, /本小局已授权初始基线/);
    assert.doesNotMatch(JSON.stringify(sent.messages), /live-ned-v1|shapeCounts/);
  }
});
test('NED current candidate changes leave same-task system prefix stable, including riichi and call shape', async () => {
  const s = fixture('123m123p123s111z20p'); s.selfDrawnTile = '0p';
  const first = await capture(s);
  s.game.players[0].riichi = true;
  const second = await capture(s);
  assert.equal(first.systemPrompt, second.systemPrompt);
  assert.deepEqual(parse(second.messages.at(-1)).outputConstraints.legalDiscards, ['0p']);
  s.game.players[0].riichi = false;
  s.game.players[0].melds.push({ type: 0, tiles: ['1m', '2m', '3m'], froms: [1, 0, 0] });
  s.selfHand.splice(0, 3); s.selfDrawnTile = null;
  const third = await capture(s);
  assert.equal(first.systemPrompt, third.systemPrompt);
  assert.deepEqual(parse(third.messages.at(-1)).outputConstraints, A.prepare(s, 'combined').data.outputConstraints);
});
