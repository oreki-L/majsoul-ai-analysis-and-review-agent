/* Deterministic teaching facts, bound to the authorized frozen snapshot. */
(function (root) {
'use strict';
const Analysis = typeof module !== 'undefined' && module.exports ? require('../../../extension/mahjong-analysis.js') : root.MJMahjongAnalysis;
const Snapshot = typeof module !== 'undefined' && module.exports ? require('../../../extension/contracts/snapshot.js') : root.MJSnapshotContract;
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
function shapeFacts(tiles) {
  if (!Array.isArray(tiles) || tiles.some(t => !validTile(t))) return null;
  const c = canonicalCounts(tiles), sameTileGroups = [], sequences = [], incompleteSequences = [];
  for (const [code, count] of Object.entries(c)) if (count >= 2) sameTileGroups.push({ tile: describe(code), count, pairPossible: true, tripletPossible: count >= 3 });
  for (const suit of 'mps') for (let rank = 1; rank <= 9; rank++) {
    const first = rank + suit;
    if (!c[first]) continue;
    if (rank <= 7 && c[(rank + 1) + suit] && c[(rank + 2) + suit]) sequences.push([first, (rank + 1) + suit, (rank + 2) + suit]);
    for (const gap of [1, 2]) if (rank + gap <= 9 && c[(rank + gap) + suit]) incompleteSequences.push([first, (rank + gap) + suit]);
  }
  return { sameTileGroups, possibleSequences: sequences, possibleIncompleteSequences: incompleteSequences,
    meaning: '仅列暗手中可选的局部组合，彼此可能共用实体牌，不能相加成整手拆分；未列出的同种对子/刻子或顺子不存在。单张与孤张不同，孤张还需检查数牌相邻与间隔关系。' };
}
function buildFactCard(snapshot, engine = {}, analysis) {
  const s = snapshot || {}, game = s.game, playerCount = s.playerCount === 3 ? 3 : 4;
  const self = seatValid(s.selfSeat) && s.selfSeat < playerCount ? s.selfSeat : null;
  const relativeNames = playerCount === 3 ? ['自家', '下家', '上家'] : ['自家', '下家', '对家', '上家'];
  const dealer = s.playerCount === 4 && seatValid(game?.round?.index) ? game.round.index : null;
  const wind = seatValid(game?.round?.wind) ? game.round.wind : null;
  const selfWind = self !== null && dealer !== null ? ((self - dealer + 4) % 4 + 1) + 'z' : null;
  const seats = Array.from({ length: playerCount }, (_, seat) => ({ seat, relativeOffset: self === null ? null : (seat - self + playerCount) % playerCount, relativeName: self === null ? 'unknown' : relativeNames[(seat - self + playerCount) % playerCount], wind: describe(dealer === null ? null : ((seat - dealer + 4) % 4 + 1) + 'z') }));
  const hand = Array.isArray(s.selfHand) ? s.selfHand.slice() : null;
  const own = game?.players?.find(p => p.seat === self), melds = own && Array.isArray(own.melds) ? own.melds : null;
  const ownMeldTiles = melds?.flatMap(m => m.tiles || []) ?? null;
  let local;
  try { local = analysis || Analysis.analyze(s); }
  catch (error) { local = { efficiency: { status: 'unavailable', reasons: [error.message], candidates: [], current: null }, danger: { status: 'unavailable', reasons: [error.message], candidates: [] } }; }
  const efficiency = local.efficiency || { status: 'unavailable', reasons: ['本任务未提供牌效率计算。'], candidates: [], current: null };
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
    if (n >= 3) groups.push({ tile: describe(identity.code), area: 'concealedHand', count: n, shape: 'tripletPresent', declaredKan: false });
  }
  for (const [meldIndex, m] of (melds || []).entries()) {
    const tiles = m.tiles || [], code = Analysis.canonical(tiles[0]);
    if ([3, 4].includes(tiles.length) && tiles.every(validTile) && tiles.every(t => Analysis.canonical(t) === code) && yakuhaiCodes.includes(code)) groups.push({ tile: describe(code), area: 'meld', meldIndex, count: tiles.length, shape: tiles.length === 4 ? 'kan' : 'triplet', visibility: m.type === 3 ? 'concealedKan' : Number.isInteger(m.type) ? 'open' : 'unknown' });
  }
  return {
    format: 'mortal-teaching-fact-card-v2',
    binding: { position: s.lastStep ?? null, source: s.source ?? 'unknown', selfSeat: self },
    tileLegend: [...ALL, '0m', '0p', '0s'].map(describe),
    round: { prevailingWind: describe(wind === null ? null : (wind + 1) + 'z'), roundIndex: dealer, handNumber: dealer === null ? null : dealer + 1, dealerSeat: dealer, selfSeat: self, selfWind: describe(selfWind), honba: game?.honba ?? null },
    seats,
    hand: { concealedTiles: hand?.map(describe) ?? null, concealedCount: hand?.length ?? null, exactCounts: counts(hand), canonicalCounts: canonicalCounts(hand), drawnTile: describe(s.selfDrawnTile), drawnAlreadyIncluded: true, countScope: 'self-concealed-hand-before-action', shape: shapeFacts(hand),
      melds: melds?.map((m, index) => ({ index, type: m.type ?? null, visibility: m.type === 3 ? 'concealedKan' : Number.isInteger(m.type) ? 'open' : 'unknown', tiles: (m.tiles || []).map(describe), physicalCount: m.tiles?.length ?? null })) ?? null,
      meldPhysicalCount: ownMeldTiles?.length ?? null, totalOwnedPhysicalCount: hand && ownMeldTiles ? hand.length + ownMeldTiles.length : null },
    dora: { rules: s.playerCount === 4 ? 'four-player' : 'unknown', indicators: game?.doras?.map(t => ({ indicator: describe(t), dora: describe(s.playerCount === 4 ? doraFor(t) : null) })) ?? null, redTilesInHand: hand?.filter(t => /^0[mps]$/.test(t)).map(describe) ?? null, redTilesInOwnMelds: ownMeldTiles?.filter(t => /^0[mps]$/.test(t)).map(describe) ?? null, redDoraRuleEnabled: null },
    selectedAction: { action, followUp, discard: discard ? describe(discard.pai) : null, discardStatus, reason: discardReason, afterDiscard: after ? { concealedTiles: after.map(describe), concealedCount: after.length, exactCounts: counts(after), canonicalCounts: canonicalCounts(after), countScope: 'self-concealed-hand-after-discard', sameTileInOwnConcealedHand: { exact: after.filter(t => t === discard.pai).length, canonical: after.filter(t => Analysis.canonical(t) === Analysis.canonical(discard.pai)).length, meaning: '只统计本次弃牌后自家暗手持有枚数；0不等于全场见尽，也不等于牌山无此牌。' }, shape: shapeFacts(after), efficiency: selectedEfficiency } : null },
    localAnalysis: { ...efficiency, efficiencyCandidatesAreEngineLegalActions: false, visibleCountScope: '包含自家手牌（摸牌不重复追加）、宝牌指示牌、各家副露/暗杠和牌河；已鸣牌按本地工具规则去重。4减已见枚数为未见上界，非牌山剩余。' },
    risk: { ...local.danger, riverIndexBase: 0, candidates: (local.danger?.candidates || []).map(c => ({ ...c, tileIdentity: describe(c.tile), opponents: c.opponents.map(o => ({ ...o, relativeName: seats[o.seat]?.relativeName ?? 'unknown', wind: seats[o.seat]?.wind ?? describe(null), genbutsuMeaning: 'true仅依据该对手本人牌河；false表示本工具未找到本人弃牌证据，不否定立直后他家打出并通过等其他已核实安全证据。', genbutsuRiverIndices: s.rivers?.find(r => r.seat === o.seat)?.discards?.flatMap((d, index) => Analysis.canonical(d.tile) === Analysis.canonical(c.tile) ? [{ index, tile: describe(d.tile) }] : []) ?? null })) })) },
    yakuhai: { identities, completedGroups: groups, scoringVerified: false, concealedGroupMeaning: 'concealedHand 的 tripletPresent 仅表示手中至少三张同种役牌；可拆作其他牌形，不保证最终和牌分组或已成役。' },
    countScopes: { ownConcealed: 'hand与afterDiscard的counts仅是自家暗手；赤五在exactCounts中单列，在canonicalCounts中与普通五合并。', visible: 'localAnalysis.visibleTiles是本次已授权可见范围；partial或invalid时不能声称全场见尽。', unseen: 'effectiveTiles.unseenUpperBound是4减已见的上界；包含未知对手手牌、王牌和牌山，不能当实际牌山枚数。' },
    limitations: ['向听0仅代表形状听牌，不代表有役可和；完整役、振听和得分未知。', '现物证据只绑定对应座位及当前牌河；筋、壁不保证安全。', '不推算引擎Q值、分数、胜率或内部思考；效率候选不是引擎合法动作集合。']
  };
}
const api = { buildFactCard };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJEngineFacts = api;
})(globalThis);
