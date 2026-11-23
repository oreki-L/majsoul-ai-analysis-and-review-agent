'use strict';
const Analysis = require('../../extension/mahjong-analysis.js');
const Snapshot = require('../../extension/contracts/snapshot.js');
const { stableHash } = require('../core.cjs');
const ALL = Array.from({ length: 34 }, (_, i) => i < 27 ? (i % 9 + 1) + 'mps'[Math.floor(i / 9)] : (i - 26) + 'z');
const validTile = t => typeof t === 'string' && /^(?:[1-9][mps]|0[mps]|[1-7]z)$/.test(t);
const describe = code => ({ code: code ?? null, name: validTile(code) ? Snapshot.label(code) : '未知', canonical: validTile(code) ? Analysis.canonical(code) : null, red: validTile(code) ? /^0[mps]$/.test(code) : null });
const counts = tiles => tiles === null ? null : Object.fromEntries([...new Set(tiles)].map(t => [t, tiles.filter(x => x === t).length]));
const canonicalCounts = tiles => tiles === null ? null : counts(tiles.map(Analysis.canonical));
const seatValid = n => Number.isInteger(n) && n >= 0 && n < 4;
function doraFor(t) {
  if (!validTile(t)) return null;
  const c = Analysis.canonical(t), n = Number(c[0]);
  return (c[1] !== 'z' ? n % 9 + 1 : n <= 4 ? n % 4 + 1 : (n - 4) % 3 + 5) + c[1];
}
function buildFactCard(snapshot, engine = {}) {
  const s = snapshot || {}, game = s.game, self = seatValid(s.selfSeat) ? s.selfSeat : null;
  const dealer = s.playerCount === 4 && seatValid(game?.round?.index) ? game.round.index : null;
  const wind = seatValid(game?.round?.wind) ? game.round.wind : null;
  const selfWind = self !== null && dealer !== null ? ((self - dealer + 4) % 4 + 1) + 'z' : null;
  const seats = Array.from({ length: 4 }, (_, seat) => ({ seat, relativeOffset: self === null ? null : (seat - self + 4) % 4, relativeName: self === null ? 'unknown' : ['自家', '下家', '对家', '上家'][(seat - self + 4) % 4], wind: describe(dealer === null ? null : ((seat - dealer + 4) % 4 + 1) + 'z') }));
  const hand = Array.isArray(s.selfHand) ? s.selfHand.slice() : null;
  const own = game?.players?.find(p => p.seat === self), melds = own && Array.isArray(own.melds) ? own.melds : null;
  const ownMeldTiles = melds?.flatMap(m => m.tiles || []) ?? null;
  let local;
  try { local = Analysis.analyze(s); }
  catch (error) { local = { efficiency: { status: 'unavailable', reasons: [error.message], candidates: [], current: null }, danger: { status: 'unavailable', reasons: [error.message], candidates: [] } }; }
  const efficiency = local.efficiency;
  const action = engine?.action || null, followUp = engine?.followUp || null;
  const discard = action?.type === 'dahai' ? action : action?.type === 'reach' && followUp?.type === 'dahai' ? followUp : null;
  let after = null, discardStatus = 'not-applicable', discardReason = null;
  if (action?.type === 'reach' && !discard) { discardStatus = 'unavailable'; discardReason = '立直缺少 followUp 弃牌，不补造。'; }
  if (discard) {
    const index = hand?.indexOf(discard.pai) ?? -1;
    if (index < 0 || !validTile(discard.pai)) { discardStatus = 'unavailable'; discardReason = '弃牌实体不在已知手牌中；赤五与普通五不可替换。'; }
    else { after = hand.slice(); after.splice(index, 1); discardStatus = 'available'; }
  }
  const selectedEfficiency = discardStatus === 'available' ? efficiency.candidates?.find(c => c.tile === discard.pai) || null : null;
  const yakuhaiCodes = ['5z', '6z', '7z', ...(wind !== null ? [(wind + 1) + 'z'] : []), ...(selfWind ? [selfWind] : [])];
  const identities = [...new Set(yakuhaiCodes)].map(code => ({ ...describe(code), roles: [Number(code[0]) >= 5 ? '三元牌' : null, wind !== null && code === (wind + 1) + 'z' ? '场风' : null, code === selfWind ? '自风' : null].filter(Boolean) }));
  const groups = [];
  if (hand) for (const identity of identities) {
    const n = hand.filter(t => Analysis.canonical(t) === identity.code).length;
    if (n >= 3) groups.push({ tile: describe(identity.code), location: 'concealedHand', count: n, shape: 'tripletPresent', declaredKan: false });
  }
  for (const [meldIndex, m] of (melds || []).entries()) {
    const tiles = m.tiles || [], code = Analysis.canonical(tiles[0]);
    if ([3, 4].includes(tiles.length) && tiles.every(validTile) && tiles.every(t => Analysis.canonical(t) === code) && yakuhaiCodes.includes(code)) groups.push({ tile: describe(code), location: 'meld', meldIndex, count: tiles.length, shape: tiles.length === 4 ? 'kan' : 'triplet', visibility: m.type === 3 ? 'concealedKan' : Number.isInteger(m.type) ? 'open' : 'unknown' });
  }
  return {
    format: 'mortal-teaching-fact-card-v1',
    binding: { snapshotHash: stableHash(s), position: s.lastStep ?? null, source: s.source ?? 'unknown', selfSeat: self },
    tileLegend: [...ALL, '0m', '0p', '0s'].map(describe),
    round: { prevailingWind: describe(wind === null ? null : (wind + 1) + 'z'), roundIndex: dealer, handNumber: dealer === null ? null : dealer + 1, dealerSeat: dealer, selfSeat: self, selfWind: describe(selfWind), honba: game?.honba ?? null },
    seats,
    hand: { concealedTiles: hand?.map(describe) ?? null, concealedCount: hand?.length ?? null, exactCounts: counts(hand), canonicalCounts: canonicalCounts(hand), drawnTile: describe(s.selfDrawnTile), drawnAlreadyIncluded: true,
      melds: melds?.map((m, index) => ({ index, type: m.type ?? null, visibility: m.type === 3 ? 'concealedKan' : Number.isInteger(m.type) ? 'open' : 'unknown', tiles: (m.tiles || []).map(describe), physicalCount: m.tiles?.length ?? null })) ?? null,
      meldPhysicalCount: ownMeldTiles?.length ?? null, totalOwnedPhysicalCount: hand && ownMeldTiles ? hand.length + ownMeldTiles.length : null },
    dora: { rules: s.playerCount === 4 ? 'four-player' : 'unknown', indicators: game?.doras?.map(t => ({ indicator: describe(t), dora: describe(s.playerCount === 4 ? doraFor(t) : null) })) ?? null, redTilesInHand: hand?.filter(t => /^0[mps]$/.test(t)).map(describe) ?? null, redTilesInOwnMelds: ownMeldTiles?.filter(t => /^0[mps]$/.test(t)).map(describe) ?? null, redDoraRuleEnabled: null },
    selectedAction: { action, followUp, discard: discard ? describe(discard.pai) : null, discardStatus, reason: discardReason, afterDiscard: after ? { concealedTiles: after.map(describe), concealedCount: after.length, exactCounts: counts(after), canonicalCounts: canonicalCounts(after), sameExactTileRemaining: after.filter(t => t === discard.pai).length, sameCanonicalTileRemaining: after.filter(t => Analysis.canonical(t) === Analysis.canonical(discard.pai)).length, efficiency: selectedEfficiency } : null },
    localAnalysis: { ...efficiency, efficiencyCandidatesAreEngineLegalActions: false, visibleCountScope: '包含自家手牌（摸牌不重复追加）、宝牌指示牌、各家副露/暗杠和牌河；已鸣牌按本地工具规则去重。4减已见枚数为未见上界，非牌山剩余。' },
    risk: { ...local.danger, riverIndexBase: 0, candidates: (local.danger?.candidates || []).map(c => ({ ...c, tileIdentity: describe(c.tile), opponents: c.opponents.map(o => ({ ...o, relativeName: seats[o.seat]?.relativeName ?? 'unknown', wind: seats[o.seat]?.wind ?? describe(null), genbutsuRiverIndices: s.rivers?.find(r => r.seat === o.seat)?.discards?.flatMap((d, index) => Analysis.canonical(d.tile) === Analysis.canonical(c.tile) ? [{ index, tile: describe(d.tile) }] : []) ?? null })) })) },
    yakuhai: { identities, completedGroups: groups, scoringVerified: false, concealedGroupMeaning: 'concealedHand 的 tripletPresent 仅表示手中至少三张同种役牌；可拆作其他牌形，不保证最终和牌分组或已成役。' },
    limitations: ['向听0仅代表形状听牌，不代表有役可和；完整役、振听和得分未知。', '现物证据只绑定对应座位及当前牌河；筋、壁不保证安全。', '不推算引擎Q值、分数、胜率或内部思考；效率候选不是引擎合法动作集合。']
  };
}
module.exports = { buildFactCard };
