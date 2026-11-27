'use strict';

const assert = require('node:assert/strict');
const { canonical } = require('./xf-release-old29/extension/mahjong-analysis.js');
const { verifiedComparison } = require('./xf-verified-comparison.cjs');

function check(inputs, Analysis) {
  const recalculate = (input, snapshot = input.snapshot, events = input.sessionContext.events) => {
    const { availableActions, ...cleaned } = snapshot;
    return verifiedComparison(cleaned, Analysis.prepare(cleaned, 'combined'), input.facts, input.comparison, events);
  };
  let candidates = 0;
  let passedTiles = 0;
  for (const input of inputs) {
    const { snapshot, facts, verifiedComparison: card, sessionContext: { events } } = input;
    assert.deepEqual(recalculate(input), card);
    assert.deepEqual(card.rows.map(row => row.slice(0, 3)), facts.efficiency);
    const prepared = Analysis.prepare(snapshot, 'combined');
    const legal = prepared.data.outputConstraints.legalDiscards;
    assert.deepEqual(card.rows.map(([tile]) => tile).sort(), [...legal].sort());
    for (const row of card.rows) {
      const [tile, shanten, upper, deficit, remaining, , rivers, passes] = row;
      assert.equal(deficit, Math.max(...facts.efficiency.filter(r => r[1] === shanten).map(r => r[2])) - upper);
      assert.equal(remaining, snapshot.selfHand.filter(t => canonical(t) === canonical(tile)).length - 1);
      assert.deepEqual(rivers.slice().sort(), snapshot.rivers.filter(river => river.seat !== snapshot.selfSeat &&
        river.discards.some(discard => canonical(discard.tile) === canonical(tile))).map(river => river.seat).sort());
      assert.deepEqual(passes, card.postRiichiPassed.filter(threat => threat.evidence.some(([passed]) => passed === canonical(tile))).map(threat => threat.seat));
      candidates++;
    }
    for (const { seat, evidence } of card.postRiichiPassed) {
      assert(snapshot.game.players.find(player => player.seat === seat).riichi);
      for (const [tile, position, from] of evidence) {
        const discard = events.find(event => event.position === position);
        const draw = events.find(event => event.position === position + 1);
        assert.equal(canonical(discard.tile), tile);
        assert.equal(discard.seat, from);
        assert.notEqual(seat, from);
        assert.equal(draw.kind, 'DealTile');
        assert.equal(draw.seat, (from + 1) % snapshot.playerCount);
        assert(draw.position <= snapshot.lastStep);
        passedTiles++;
      }
    }
  }

  const byId = id => inputs.find(input => input.decisionId === id);
  const efficiencyCase = byId('d-93a9e20ca720eb9d2600c175');
  const [east, north] = ['1z', '4z'].map(tile => efficiencyCase.verifiedComparison.rows.find(row => row[0] === tile));
  assert.deepEqual(east.slice(1, 3), [4, 67]);
  assert.deepEqual(north.slice(1, 3), [4, 68]);
  assert.equal(east[3] - north[3], 1);
  assert(east[5].includes('场风') && !north[5].includes('场风'));

  const seatCase = byId('d-6172b9acea1476a1f4915705').verifiedComparison;
  assert.equal(seatCase.opponentSeats.find(([seat]) => seat === 3)[1], '对家');
  assert.equal(seatCase.opponentSeats.find(([seat]) => seat === 2)[1], '下家');
  assert.deepEqual(seatCase.rows.find(([tile]) => tile === '2s')[6], [3]);

  const passedCase = byId('d-eef1c7b4e990d245b17e6586');
  const { snapshot } = passedCase;
  const events = passedCase.sessionContext.events;
  const row = card => card.rows.find(([tile]) => tile === '6s');
  assert.deepEqual(row(passedCase.verifiedComparison)[7], [3]);
  assert(passedCase.verifiedComparison.postRiichiPassed.find(threat => threat.seat === 3)
    .evidence.some(entry => JSON.stringify(entry) === '["6s",69,1]'));

  const changeEvent = (position, fields) => events.map(event => event.position === position ? { ...event, ...fields } : event);
  const variants = [
    events.filter(event => event.position !== 70),
    [...events, events.find(event => event.position === 70)],
    changeEvent(70, { kind: 'Hule' }),
    changeEvent(70, { kind: 'NewRound' }),
    changeEvent(70, { source: 'other' }),
    changeEvent(70, { seat: 3 }),
    changeEvent(70, { kind: 'ChiPengGang' }),
    changeEvent(69, { riichi: true }),
    [...events.filter(event => event.position !== 70), { ...events.find(event => event.position === 70), position: snapshot.lastStep + 1 }]
  ];
  for (const variant of variants) assert.deepEqual(row(recalculate(passedCase, snapshot, variant))[7], []);
  return { priorFirstRequestsMatched: inputs.length, discardRows: candidates, verifiedOpponentTilePairs: passedTiles,
    historicalRegressions: 3, rejectedPassEvidenceVariants: variants.length };
}

module.exports = { check };
