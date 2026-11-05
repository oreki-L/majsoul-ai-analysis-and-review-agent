const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../extension/mahjong-analysis');
const corpus = require('./fixtures/mahjong-reference.json');

test(`mahjong ${corpus.version}: seeded per-form shanten and every discard/draw`, () => {
  const differences = [];
  for (const c of corpus.cases) {
    const meldTiles = c.melds.flat();
    const byType = M.shantenByType(c.hand, c.melds.length, c.playerCount, meldTiles);
    const snapshot = { complete: true, playerCount: c.playerCount, selfSeat: 0, selfHand: c.hand,
      game: { doras: [], players: Array.from({ length: c.playerCount }, (_, seat) => ({ seat, norths: 0,
        melds: seat ? [] : c.melds.map(tiles => ({ type: tiles.length === 4 ? 3 : 1, tiles, froms: tiles.map(() => 0) })) })) },
      rivers: Array.from({ length: c.playerCount }, (_, seat) => ({ seat, discards: [] })) };
    const e = M.analyze(snapshot).efficiency;
    const actual = { byType, shanten: e.shanten, current: e.current, candidates: e.candidates };
    try { assert.deepEqual(actual, c.expected); }
    catch (error) { differences.push({ id: c.id, hand: c.hand, melds: c.melds, actual, expected: c.expected }); }
  }
  assert.deepEqual(differences, [], JSON.stringify(differences, null, 2));
});
