'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFactCard } = require('../extension/engine-facts.js');
const tiles = text => text.match(/\d+[mpsz]/g).flatMap(g => [...g.slice(0, -1)].map(n => n + g.at(-1)));
function snapshot(text = '123m123p123s111z25z') {
  return { playerCount: 4, selfSeat: 1, complete: true, selfHand: tiles(text), selfDrawnTile: '5z',
    game: { round: { wind: 0, index: 1 }, doras: ['8p'], players: Array.from({ length: 4 }, (_, seat) => ({ seat, melds: [], norths: 0 })) },
    rivers: Array.from({ length: 4 }, (_, seat) => ({ seat, discards: [] })) };
}
test('duplicate drawn honor is already included; honor names, dealer and relative seats are exact', () => {
  const s = snapshot(), before = structuredClone(s);
  const c = buildFactCard(s, { action: { type: 'dahai', pai: '5z' } });
  assert.equal(c.hand.concealedCount, 14);
  assert.equal(c.hand.exactCounts['5z'], 1);
  assert.equal(c.round.selfWind.name, '东');
  assert.equal(c.round.handNumber, 2);
  assert.deepEqual(c.seats.map(x => x.relativeName), ['上家', '自家', '下家', '对家']);
  assert.deepEqual(['2z', '5z', '4z'].map(t => c.tileLegend.find(x => x.code === t).name), ['南', '白', '北']);
  assert.equal(c.selectedAction.afterDiscard.concealedCount, 13);
  assert.equal(c.selectedAction.afterDiscard.sameTileInOwnConcealedHand.canonical, 0);
  assert.equal(c.selectedAction.afterDiscard.efficiency.shanten, 0);
  assert.equal(c.selectedAction.afterDiscard.canonicalCounts['2z'], 1); // single south, not a pair
  assert.equal(c.dora.indicators[0].dora.code, '9p');
  assert.deepEqual(s, before);
});
test('genbutsu records bind to one opponent and retain original zero-based river indices', () => {
  const s = snapshot();
  s.rivers[0].discards = [{ tile: '4z', called: false }, { tile: '2z', called: false }];
  const c = buildFactCard(s), danger = c.risk.candidates.find(x => x.tile === '2z');
  assert.equal(danger.opponents.find(o => o.seat === 0).genbutsu, true);
  assert.equal(danger.opponents.find(o => o.seat === 0).relativeName, '上家');
  assert.equal(danger.opponents.find(o => o.seat === 0).wind.name, '北');
  assert.deepEqual(danger.opponents.find(o => o.seat === 0).genbutsuRiverIndices.map(x => x.index), [1]);
  assert.equal(danger.opponents.find(o => o.seat === 2).genbutsu, false);
  assert.deepEqual(danger.opponents.find(o => o.seat === 2).genbutsuRiverIndices, []);
});
test('fact binding identifies frozen snapshot and dora cycles do not invent missing rules or wind', () => {
  const s = snapshot(); s.lastStep = 42; s.source = 'replay';
  s.game.doras = ['9m', '9p', '9s', '4z', '7z'];
  const c = buildFactCard(s);
  assert.deepEqual(c.binding, { position: 42, source: 'replay', selfSeat: 1 });
  assert.deepEqual(c.dora.indicators.map(i => i.dora.code), ['1m', '1p', '1s', '1z', '5z']);
  delete s.game.round.wind;
  const noWind = buildFactCard(s);
  assert.equal(noWind.round.prevailingWind.code, null);
  assert.ok(!noWind.yakuhai.identities.some(i => i.roles.includes('场风')));
  delete s.playerCount;
  const noRules = buildFactCard(s);
  assert.equal(noRules.dora.rules, 'unknown');
  assert.ok(noRules.dora.indicators.every(i => i.dora.code === null));
  assert.equal(noRules.round.dealerSeat, null);
});
test('reach uses only supplied followUp and red entities cannot substitute for normal five', () => {
  const s = snapshot('123m123p123s055s22z'); s.selfDrawnTile = '0s';
  const c = buildFactCard(s, { action: { type: 'reach' }, followUp: { type: 'dahai', pai: '0s' } });
  assert.equal(c.selectedAction.afterDiscard.sameTileInOwnConcealedHand.exact, 0);
  assert.equal(c.selectedAction.afterDiscard.sameTileInOwnConcealedHand.canonical, 2);
  assert.equal(c.selectedAction.afterDiscard.exactCounts['5s'], 2);
  assert.equal(c.hand.exactCounts['0s'], 1);
  assert.equal(c.dora.redTilesInHand[0].name, '赤5索');
  assert.equal(buildFactCard(s, { action: { type: 'reach' } }).selectedAction.discardStatus, 'unavailable');
  s.selfHand = s.selfHand.filter(t => t !== '0s');
  const missing = buildFactCard(s, { action: { type: 'dahai', pai: '0s' } });
  assert.equal(missing.selectedAction.afterDiscard, null);
  assert.match(missing.selectedAction.reason, /实体/);
});
test('meld tile ownership counts physical kan tiles separately and only identifies certain yakuhai groups', () => {
  const s = snapshot('123m123p2z'); s.selfDrawnTile = null;
  s.game.players[1].melds = [{ type: 1, tiles: tiles('555z'), froms: [1, 1, 0] }, { type: 3, tiles: tiles('1111z'), froms: [] }];
  const c = buildFactCard(s);
  assert.equal(c.hand.concealedCount, 7);
  assert.equal(c.hand.meldPhysicalCount, 7);
  assert.equal(c.hand.totalOwnedPhysicalCount, 14);
  assert.deepEqual(c.yakuhai.completedGroups.map(g => [g.tile.name, g.shape, g.visibility]), [['白', 'triplet', 'open'], ['东', 'kan', 'concealedKan']]);
  assert.equal(c.yakuhai.scoringVerified, false);
  assert.equal(c.localAnalysis.visibleTiles.counts['1z'], 4);
  assert.equal(c.localAnalysis.efficiencyCandidatesAreEngineLegalActions, false);
});
test('unavailable local calculation preserves its reason and unknown fields remain unknown', () => {
  const s = snapshot(); s.selfHand[0] = '?'; delete s.game.round; s.selfSeat = null;
  const c = buildFactCard(s);
  assert.equal(c.localAnalysis.status, 'unavailable');
  assert.ok(c.localAnalysis.reasons.length);
  assert.equal(c.round.dealerSeat, null);
  assert.equal(c.round.selfWind.name, '未知');
  assert.equal(c.seats[0].relativeName, 'unknown');
  assert.equal(c.selectedAction.afterDiscard, null);
});

test('discard counts are explicitly own hand counts, not global availability, and shapes can overlap', () => {
  const s = snapshot('12345m123p123s55z');
  const c = buildFactCard(s, { action: { type: 'dahai', pai: '1m' } });
  const after = c.selectedAction.afterDiscard;
  assert.equal(c.hand.countScope, 'self-concealed-hand-before-action');
  assert.equal(after.countScope, 'self-concealed-hand-after-discard');
  assert.equal(after.sameTileInOwnConcealedHand.canonical, 0);
  assert.match(after.sameTileInOwnConcealedHand.meaning, /不等于全场见尽/);
  assert.deepEqual(c.hand.shape.possibleSequences.filter(a => a[0].endsWith('m')), [['1m','2m','3m'], ['2m','3m','4m'], ['3m','4m','5m']]);
  assert.deepEqual(after.shape.possibleSequences.filter(a => a[0].endsWith('m')), [['2m','3m','4m'], ['3m','4m','5m']]);
  assert.equal(after.shape.sameTileGroups.find(g => g.tile.code === '5z').count, 2);
  assert.match(after.shape.meaning, /共用实体牌/);
});

test('unknown hand does not invent groups and genbutsu false retains its evidence scope', () => {
  const s = snapshot(); s.selfHand[0] = '?';
  const c = buildFactCard(s);
  assert.equal(c.hand.shape, null);
  const opponent = c.risk.candidates[0].opponents[0];
  assert.match(opponent.genbutsuMeaning, /不否定立直后他家打出并通过/);
  assert.match(c.countScopes.unseen, /不能当实际牌山枚数/);
});

test('three-player teaching has three relative seats and does not assert unverified four-player wind or dora facts', () => {
  const s = snapshot(); s.playerCount = 3;
  s.game.players = s.game.players.slice(0, 3); s.rivers = s.rivers.slice(0, 3);
  const c = buildFactCard(s);
  assert.equal(c.seats.length, 3);
  assert.deepEqual(c.seats.map(p => p.relativeName), ['上家', '自家', '下家']);
  assert.deepEqual(c.seats.map(p => p.relativeOffset), [2, 0, 1]);
  assert.ok(c.seats.every(p => p.wind.code === null));
  assert.equal(c.round.selfWind.code, null);
  assert.equal(c.dora.rules, 'unknown');
});
