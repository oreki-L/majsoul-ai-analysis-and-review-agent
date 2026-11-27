'use strict';

const assert = require('node:assert/strict');
const { canonical } = require('./xf-release-old29/extension/mahjong-analysis.js');

const seatInRange = (seat, count) => Number.isInteger(seat) && seat >= 0 && seat < count;
const terminalEvents = new Set(['NewRound', 'Hule', 'NoTile', 'LiuJu']);
const tilePattern = /^(?:[0-9][mps]|[1-7]z)$/;

function postRiichiPasses(snapshot, events, tiles, threatSeat) {
  if (!snapshot.complete || snapshot.phase !== 'playing' ||
      !snapshot.game.players.some(player => player.seat === threatSeat && player.riichi === true)) return [];
  const declarations = events.filter(event => event.source === snapshot.source && Number.isInteger(event.position) &&
    event.position >= 0 && event.position < snapshot.lastStep && tilePattern.test(event.tile) &&
    event.kind === 'DiscardTile' && event.seat === threatSeat && event.riichi === true);
  if (declarations.length !== 1) return [];
  const start = declarations[0].position;
  const segment = events.filter(event => event.position >= start && event.position <= snapshot.lastStep)
    .sort((a, b) => a.position - b.position);
  if (segment.length !== snapshot.lastStep - start + 1 || segment[0] !== declarations[0] ||
      segment.some((event, index) => event.position !== start + index || event.source !== snapshot.source || terminalEvents.has(event.kind))) return [];

  const visibleRivers = new Map(snapshot.rivers.map(river => [river.seat, river.discards]));
  const evidence = new Map();
  for (let i = 1; i < segment.length - 1; i++) {
    const event = segment[i];
    const next = segment[i + 1];
    // A normal draw after a discard confirms the ron window on that tile closed.
    if (event.kind !== 'DiscardTile' || event.seat === threatSeat || event.riichi === true || !tilePattern.test(event.tile) ||
        !seatInRange(event.seat, snapshot.playerCount) || next.kind !== 'DealTile' ||
        next.seat !== (event.seat + 1) % snapshot.playerCount) continue;
    const tile = canonical(event.tile);
    const witnessed = visibleRivers.get(event.seat)?.some(discard => discard.tile === event.tile && discard.called === false);
    if (witnessed && tiles.has(tile)) evidence.set(tile, [tile, event.position, event.seat]);
  }
  return [...evidence.values()];
}

function verifiedComparison(snapshot, prepared, facts, comparison, events) {
  const { danger, efficiency } = prepared.data.localAnalysis;
  const upperBoundByShanten = new Map();
  for (const [, shanten, count] of facts.efficiency) {
    upperBoundByShanten.set(shanten, Math.max(upperBoundByShanten.get(shanten) ?? 0, count));
  }
  const legal = new Set(facts.efficiency.map(([tile]) => canonical(tile)));
  const identityCounts = new Map(comparison.ownHandCounts);
  const opponents = facts.seats.filter(({ seat }) => seat !== snapshot.selfSeat);
  const support = new Map(danger.candidates.map(candidate => [candidate.tile, candidate.opponents]));
  const hasCompleteVisibility = efficiency.visibleTiles?.partial === false && !efficiency.visibleTiles.invalid;
  const threats = opponents.filter(player => player.riichi === true).map(({ seat }) => ({
    seat, passes: postRiichiPasses(snapshot, events, legal, seat)
  }));

  const rows = facts.efficiency.map(([tile, shanten, count], index) => {
    const candidates = support.get(tile);
    const identity = canonical(tile);
    const handCount = identityCounts.get(identity);
    assert(candidates && handCount > 0);
    const rivers = comparison.perDiscard[index][2];
    assert.equal(comparison.perDiscard[index][0], tile);
    const passSeats = threats.filter(threat => threat.passes.some(([passed]) => passed === identity)).map(({ seat }) => seat);
    const walls = hasCompleteVisibility ? [...new Set(candidates.flatMap(opponent => opponent.kabeReferences))] : [];
    const visibleCount = hasCompleteVisibility ? efficiency.visibleTiles.counts[identity] ?? 0 : null;
    return [tile, shanten, count, upperBoundByShanten.get(shanten) - count, handCount - 1, comparison.perDiscard[index][1],
      rivers, passSeats, visibleCount, walls];
  });
  return {
    selfSeat: snapshot.selfSeat,
    opponentSeatColumns: ['绝对座次', '相对位置', '自风', '已立直'],
    opponentSeats: opponents.map(({ seat, relative, wind, riichi }) => [seat, relative, wind, riichi]),
    ownRiverAvailableSeats: comparison.ownRiverAvailableSeats,
    postRiichiPassed: threats.filter(threat => threat.passes.length).map(({ seat, passes }) => ({ seat, evidence: passes })),
    passedEvidenceColumns: ['牌', '舍牌时点', '出牌者绝对座次'],
    rowColumns: ['弃牌', '弃后向听', '总进张上界', '比同向听最高少几枚（0为该向听组最高）', '弃后暗手同种牌剩几枚（含赤牌）',
      '打出这张牌的身份', '哪些对手的本人河有这张现物（绝对座次）', '立直后已过这张牌的对手（绝对座次）',
      '打出前这张牌的已见枚数（含自家暗手，null为范围不完整）', '已见四枚的近邻牌'],
    rows,
    evidenceBoundary: '立直后过牌只适用于对应的已立直者，可在理由里说明。结构化 danger 的 safe 仍须有该对手本人河现物。壁只限制部分牌形。弃牌自身的已见枚数与其他有效牌的总进张是不同指标。',
    decisionCheck: '先选合法首选和一个合法备选，再逐行核对。比较同向听进张时写清哪张少几枚。说防守时先锁定同一家的座次，再分别查两张牌的证据。说打点或牌形时按弃后剩余牌解释。两张在该指标相同就说明持平，给出另一条已核实的取舍或说明无法细分。'
  };
}

module.exports = { verifiedComparison };
