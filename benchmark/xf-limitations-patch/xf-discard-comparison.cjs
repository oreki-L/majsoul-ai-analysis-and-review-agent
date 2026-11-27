'use strict';

const assert = require('node:assert/strict');
const { canonical } = require('./xf-release-old29/extension/mahjong-analysis.js');

function comparisonFacts(snapshot, prepared, facts) {
  const opponents = facts.seats.filter(({ seat }) => seat !== snapshot.selfSeat).map(({ seat }) => seat);
  const { danger } = prepared.data.localAnalysis;
  const rivers = new Map(danger.candidates.map(({ tile, opponents }) => [tile, opponents]));
  const knownRiverSeats = new Set(snapshot.rivers.map(({ seat }) => seat));
  const bestUpperBound = Math.max(...facts.efficiency.filter(([, shanten]) => shanten === facts.bestShanten).map(([, , count]) => count));
  const flags = tile => {
    const identity = canonical(tile);
    return [
      ...(identity === facts.prevailingWind ? ['场风'] : []),
      ...(identity === facts.selfWind ? ['自风'] : []),
      ...(/^[5-7]z$/.test(identity) ? ['三元牌'] : []),
      ...(facts.dora.some(({ actual }) => actual === identity) ? ['宝牌'] : []),
      ...(tile.startsWith('0') ? ['赤牌'] : [])
    ];
  };
  return {
    ownHandCounts: [...new Set(snapshot.selfHand.map(canonical))].map(tile => [tile, snapshot.selfHand.filter(t => canonical(t) === tile).length]),
    ownRiverAvailableSeats: opponents.filter(seat => knownRiverSeats.has(seat)),
    highestUpperBoundAtBestShanten: bestUpperBound,
    highestUpperBoundTiles: facts.efficiency.filter(([, shanten, count]) => shanten === facts.bestShanten && count === bestUpperBound).map(([tile]) => tile),
    columns: ['弃牌', '打出这张牌本身的身份', '哪几家的本人牌河有这张现物（绝对座次）'],
    perDiscard: facts.efficiency.map(([tile]) => {
      const evidence = rivers.get(tile);
      assert(evidence && evidence.length === opponents.length && opponents.every(seat => evidence.some(entry => entry.seat === seat)));
      return [tile, flags(tile), evidence.filter(entry => entry.riverAvailable && entry.genbutsu).map(({ seat }) => seat)];
    }),
    check: '给出首选与一个有实质取舍的合法备选。分别从表里核对两张牌的向听和总进张上界，同向听时上界较大才表示进张较宽。比较防守时用同一名对手的证据，查明哪张对该家有现物依据。本人河无记录时只说明此项依据缺失，立直后过牌须另查时点事件。解释牌值时核对打出的是哪张，以及剩余手牌实际保留什么。'
  };
}

module.exports = { comparisonFacts };
