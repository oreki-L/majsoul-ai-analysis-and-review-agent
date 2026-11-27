'use strict';

const assert = require('node:assert/strict');

const prefix = '本次局面的核对卡（仅使用当前数据，模型自行比较并决定）：\n';
const winds = ['1z', '2z', '3z', '4z'];
const relativeSeats = ['自家', '下家', '对家', '上家'];

function actualDora(indicator) {
  assert.match(indicator, /^(?:[0-9][mps]|[1-7]z)$/);
  const suit = indicator[1];
  const rank = Number(indicator[0]) || 5;
  if (suit !== 'z') return `${rank % 9 + 1}${suit}`;
  return `${rank <= 4 ? rank % 4 + 1 : (rank - 4) % 3 + 5}z`;
}

function currentFacts(snapshot, prepared) {
  const { game, selfSeat, playerCount } = snapshot;
  assert.equal(playerCount, 4);
  assert(game.players.length === 4 && winds[game.round.wind] && winds[game.round.index] && winds[selfSeat]);
  const dealer = game.round.index;
  const seats = game.players.map(player => ({ seat: player.seat,
    relative: relativeSeats[(player.seat - selfSeat + 4) % 4],
    wind: winds[(player.seat - dealer + 4) % 4], riichi: player.riichi }));
  const { efficiency, danger } = prepared.data.localAnalysis;
  const legal = new Set(prepared.data.outputConstraints.legalDiscards);
  const candidates = efficiency.candidates.filter(candidate => legal.has(candidate.tile));
  assert(legal.size === candidates.length && candidates.length > 0);
  const bestShanten = Math.min(...candidates.map(candidate => candidate.shanten));
  const opponents = seats.filter(player => player.seat !== selfSeat);
  const threats = opponents.filter(player => player.riichi === true).map(player => player.seat);
  const genbutsuByRiichiSeat = threats.map(seat => ({ seat, ownRiverGenbutsu: danger.candidates.filter(candidate =>
    legal.has(candidate.tile) && candidate.opponents.some(opponent => opponent.seat === seat && opponent.genbutsu === true))
    .map(candidate => candidate.tile) }));
  const reminder = threats.length > 0
    ? '已确认有人立直。逐家核对首选与备选的安全依据，再说明两者在向听和进张上的代价。同一家牌河的现物只对该家适用；立直后过牌须另查已授权事件。'
    : opponents.every(player => player.riichi === false && game.players[player.seat].melds.length === 0) && game.remaining >= 52
      ? '当前牌量与公开威胁满足前期效率提醒。先在最低向听的合法候选内比较总进张上界，再结合牌值和可验证的风险解释取舍。'
      : '先在相同向听的候选之间比较进张上界。涉及安全时按对手分开核对，说明接受的效率代价和仍存在的风险。';
  return { position: snapshot.lastStep, prevailingWind: winds[game.round.wind],
    selfWind: seats.find(player => player.seat === selfSeat).wind,
    honors: { '1z': '东', '2z': '南', '3z': '西', '4z': '北', '5z': '白', '6z': '发', '7z': '中' },
    seats, dora: game.doras.map(indicator => ({ indicator, actual: actualDora(indicator) })),
    efficiencyColumns: ['弃牌', '弃牌后向听', '有效进张未见总数上界'], bestShanten,
    efficiency: candidates.map(({ tile, shanten, totalUnseenUpperBound }) => [tile, shanten, totalUnseenUpperBound]),
    genbutsuByRiichiSeat, reminder };
}

function decorate(options, facts) {
  const anchor = options.messages.findIndex(message => message.role === 'user' &&
    typeof message.content === 'string' && message.content.startsWith('请分析本次问题。snapshot'));
  assert(anchor >= 0, 'XF current-state prompt missing');
  return { ...options, messages: [
    ...options.messages.slice(0, anchor), { role: 'user', content: prefix + JSON.stringify(facts) },
    ...options.messages.slice(anchor)
  ] };
}

module.exports = { prefix, actualDora, currentFacts, decorate };
