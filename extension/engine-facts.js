/* Deterministic teaching facts, bound to the authorized frozen snapshot. */
(function (root) {
'use strict';
const Analysis = typeof module !== 'undefined' && module.exports ? require('./mahjong-analysis.js') : root.MJMahjongAnalysis;
const Snapshot = typeof module !== 'undefined' && module.exports ? require('./contracts/snapshot.js') : root.MJSnapshotContract;
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
function shapeFacts(tiles, visible) {
  if (!Array.isArray(tiles) || tiles.some(t => !validTile(t))) return null;
  const c = canonicalCounts(tiles);
  if (Object.values(c).some(n => n > 4)) return null;
  const sameTileGroups = [], sequences = [], incompleteSequences = [];
  for (const [code, count] of Object.entries(c)) if (count >= 2) sameTileGroups.push({ tile: describe(code), count, shapeName: count === 2 ? '对子形' : count === 3 ? '刻子形' : '四张同种（未宣杠）', pairPossible: true, tripletPossible: count >= 3 });
  for (const suit of 'mps') for (let rank = 1; rank <= 9; rank++) {
    const first = rank + suit;
    if (!c[first]) continue;
    if (rank <= 7 && c[(rank + 1) + suit] && c[(rank + 2) + suit]) sequences.push([first, (rank + 1) + suit, (rank + 2) + suit]);
    for (const gap of [1, 2]) if (rank + gap <= 9 && c[(rank + gap) + suit]) incompleteSequences.push([first, (rank + gap) + suit]);
  }
  const isolatedTiles = tiles.filter(t => {
    const code = Analysis.canonical(t);
    return c[code] === 1 && (code.endsWith('z') || !Object.keys(c).some(other => other !== code && other[1] === code[1] && Math.abs(Number(other[0]) - Number(code[0])) <= 2));
  }).map(describe);
  return { sameTileGroups, isolatedTiles, isolatedMeaning: '只指当前暗手中无同种伙伴且无同花色相邻或隔一张联系的牌，赤五合并检查后保留实体身份；不表示没有打点、安全或未来发展价值。', possibleSequences: sequences, possibleIncompleteSequences: incompleteSequences,
    incompleteSequenceCompletions: incompleteSequences.map(pair => {
      const a = Number(pair[0][0]), b = Number(pair[1][0]), suit = pair[0][1];
      const ranks = b - a === 2 ? [a + 1] : [a - 1, b + 1].filter(n => n >= 1 && n <= 9);
      return { tiles: pair, shapeName: b - a === 2 ? '嵌张' : a === 1 || b === 9 ? '边张' : '两面', status: !visible || visible.invalid ? "unavailable" : visible.partial ? "partial" : "complete",
        waits: ranks.map(n => { const tile = n + suit; return { tile: describe(tile), unseenUpperBound: visible && !visible.invalid ? 4 - (visible.counts[tile] || 0) : null }; }) };
    }),
    meaning: '仅列暗手中可选的局部组合，彼此可能共用实体牌，不能相加成整手拆分；未列出的同种对子/刻子或顺子不存在。单张与孤张不同，孤张还需检查数牌相邻与间隔关系。' };
}

// Reuse authorized visible counts; the table remains three columns.
function compactCounts(s, f) {
  const visible = f.localAnalysis.visibleTiles, hand = Array.isArray(s.selfHand) ? s.selfHand : [];
  const allowed = t => s.playerCount !== 3 || !/^[2-8]m$/.test(t);
  const codes = [...new Set(hand.filter(validTile).map(Analysis.canonical))].filter(allowed);
  let status = 'unavailable';
  if ([3, 4].includes(s.playerCount) && Array.isArray(s.selfHand) && visible && visible.counts && typeof visible.counts === 'object' && !Array.isArray(visible.counts) && typeof visible.partial === 'boolean' && typeof visible.invalid === 'boolean') {
    status = visible.invalid || hand.some(t => t !== '?' && (!validTile(t) || !allowed(Analysis.canonical(t)))) ||
      Object.entries(visible.counts).some(([t,n]) => !validTile(t) || Analysis.canonical(t) !== t || !allowed(t) || !Number.isInteger(n) || n < 0 || n > 4) ||
      codes.some(t => (visible.counts[t] || 0) < hand.filter(h => Analysis.canonical(h) === t).length) ? 'invalid' : visible.partial || hand.includes('?') ? 'partial' : 'complete';
  }
  return { status, columns: ['牌', '已见', '未见上界'], rows: codes.map(t => {
    const seen = ['complete','partial'].includes(status) ? visible.counts[t] || 0 : null;
    return [Snapshot.label(t) + '(' + t + ')', seen, seen === null ? null : 4 - seen];
  }), meaning: '仅列当前手牌同种牌；已见含自家暗手和公开牌，五含赤五。未见上界含对手暗手、牌山和王牌，非牌山实剩；partial不作全场见尽断言。',
    ...(status !== 'complete' ? { reasons: [...new Set([...(visible?.reasons || []), ...(status === 'invalid' ? ['计数冲突，不输出数量。'] : status === 'unavailable' ? ['已见计数不可用。'] : [])])] } : {}) };
}
function authorizedTimeline(s, events) {
  if (!Number.isSafeInteger(s.lastStep) || typeof s.source !== 'string' || !s.source || !Array.isArray(events)) return [];
  let clean = events.filter(e => e && e.source === s.source && Number.isSafeInteger(e.position) && e.position >= 0 && e.position <= s.lastStep);
  const start = Math.max(-1, ...clean.filter(e => e.kind === 'NewRound').map(e => e.position));
  clean = clean.filter(e => e.position >= start).sort((a,b) => a.position - b.position);
  // Conflicting observations cannot prove an accepted action sequence.
  const seen = new Map();
  for (const e of clean) { const signature = JSON.stringify([e.kind,e.seat,e.tile,e.riichi]); if (seen.has(e.position) && seen.get(e.position) !== signature) return []; seen.set(e.position,signature); }
  clean = [...new Map(clean.map(e => [e.position, e])).values()];
  // A partial history may skip discards, but its observed order must agree with
  // each current river. Conflicting order cannot establish post-riichi safety.
  for (let seat = 0; seat < s.playerCount; seat++) {
    const river = s.rivers?.find(r => r.seat === seat)?.discards || [];
    let cursor = 0;
    for (const e of clean.filter(e => e.kind === 'DiscardTile' && e.seat === seat)) {
      if (!validTile(e.tile)) return [];
      while (cursor < river.length && (river[cursor].tile !== e.tile || (e.riichi === true && river[cursor].riichi !== true))) cursor++;
      if (cursor === river.length) return [];
      cursor++;
    }
  }
  return clean;
}
function passedRiichiEvidence(s, events, seat, tile) {
  if (s.game?.players?.find(p => p.seat === seat)?.riichi !== true) return [];
  const declaration = events.find(e => e.kind === 'DiscardTile' && e.seat === seat && e.riichi === true && validTile(e.tile));
  if (!declaration || !s.rivers?.find(r => r.seat === seat)?.discards?.some(d => d.riichi === true && Analysis.canonical(d.tile) === Analysis.canonical(declaration.tile)) || events.some(e => e.position > declaration.position && ['Hule','NoTile','LiuJu'].includes(e.kind))) return [];
  const result = [];
  for (const e of events) {
    if (e.kind !== 'DiscardTile' || !seatValid(e.seat) || e.seat >= s.playerCount || e.seat === seat || e.position <= declaration.position || !validTile(e.tile) || Analysis.canonical(e.tile) !== Analysis.canonical(tile)) continue;
    if (!s.rivers?.find(r => r.seat === e.seat)?.discards?.some(d => Analysis.canonical(d.tile) === Analysis.canonical(e.tile))) continue;
    // A discard at the current frozen step is still awaiting responses. A later
    // authorized gameplay action proves this earlier discard did not end in ron.
    const next = events.find(n => n.position > e.position && ['DealTile','DiscardTile','ChiPengGang','AnGangAddGang','BaBei'].includes(n.kind) && seatValid(n.seat) && n.seat < s.playerCount);
    if (next) result.push({ type: 'riichi-passed', riichiPosition: declaration.position, discardPosition: e.position, discardedBy: e.seat, passedAtPosition: next.position });
  }
  return result;
}
function visibleExclusion(s, visible, tile) {
  if (s.playerCount !== 4 || !visible || visible.invalid || visible.partial || !validTile(tile)) return null;
  const code = Analysis.canonical(tile), c = visible.counts;
  if (c[code] !== 4) return null; // No copies of this kind can be in any opponent's hand.
  const blockers = [], rank = Number(code[0]), suit = code[1];
  if (suit !== 'z') for (let start = Math.max(1, rank - 2); start <= Math.min(7, rank); start++) {
    const sequence = [start, start+1, start+2].map(n => n + suit), block = sequence.find(t => t !== code && c[t] === 4);
    if (!block) return null; blockers.push({ sequence, fullyVisible: block });
  }
  const orphan = suit === 'z' || [1,9].includes(rank);
  const orphanBlock = orphan ? ALL.find(t => t !== code && (t.endsWith('z') || /^[19][mps]$/.test(t)) && c[t] === 4) : null;
  if (orphan && !orphanBlock) return null; // Keep kokushi single wait possible.
  return { type: 'visible-exclusion', tileFullyVisible: code, sequenceBlockers: blockers, kokushi: orphan ? { excludedByFullyVisible: orphanBlock } : 'tile-not-terminal-or-honor', meaning: '已见四枚排除同种对子/刻子等待，逐个顺子形和国士另行排除；仅限当前授权四麻计数。' };
}
// All labels come from the current snapshot; no event-index or history fallback.
function currentContext(s, self, dealer, wind, seats) {
  const progress = s.game?.turnProgress, count = s.playerCount;
  const known = progress?.status === 'known' && progress.source === 'events' &&
    [3,4].includes(count) && Array.isArray(progress.bySeat) && progress.bySeat.length === count &&
    progress.bySeat.every(n => Number.isInteger(n) && n >= 1 && n <= 145);
  const roundName = wind !== null && dealer !== null ? ['东','南','西','北'][wind] + (dealer + 1) + '局' : null;
  const honba = s.game?.honba;
  return { position: s.lastStep ?? null, roundName,
    honba: Number.isInteger(honba) && honba >= 0 ? honba : null,
    selfWind: self === null || dealer === null ? null : seats[self].wind.name,
    selfTurn: known && self !== null ? progress.bySeat[self] : null,
    turnStatus: known ? 'known' : 'unknown',
    turnsBySeat: seats.map(p => ({ seat:p.seat, relativeName:p.relativeName, turn:known ? progress.bySeat[p.seat] : null })),
    meaning:'当前快照事实；巡目是各家下一次打牌的序号。position是事件位置，honba是本场数，都不是巡目；null不得从历史教学或牌河长度补猜。' };
}
function candidateTable(efficiency) {
  return { status:efficiency.status, columns:['弃牌','向听','未见进张上界'],
    rows:(efficiency.candidates || []).map(c => [Snapshot.label(c.tile) + '(' + c.tile + ')',
      Number.isInteger(c.shanten) ? c.shanten : null,
      Number.isInteger(c.totalUnseenUpperBound) && c.totalUnseenUpperBound >= 0 ? c.totalUnseenUpperBound : null]),
    meaning:'每行只对应括号内的精确弃牌编码，赤五单列；只读同一行数值，不能套用其他行。顺序不是引擎排名；该表不证明候选合法，不要求比较。' };
}
function meldFact(m, index) {
  const tiles = Array.isArray(m.tiles) ? m.tiles : [], canonical = tiles.filter(validTile).map(Analysis.canonical), sorted = canonical.slice().sort();
  const known = canonical.length === tiles.length, same = known && tiles.length >= 3 && canonical.every(t => t === canonical[0]);
  const sequence = known && tiles.length === 3 && sorted[0][1] !== 'z' && sorted.every((t,i) => t[1] === sorted[0][1] && Number(t[0]) === Number(sorted[0][0]) + i);
  const label = m.type === 0 && sequence ? '明顺子' : m.type === 1 && tiles.length === 3 && same ? '明刻' : m.type === 2 && tiles.length === 4 && same ? '明杠' : m.type === 3 && tiles.length === 4 && same ? '暗杠' : null;
  return { index, type: m.type ?? null, visibility: label === null ? 'unknown' : m.type === 3 ? 'concealedKan' : 'open',
    label, status: label === null ? 'unavailable' : 'known', tiles: tiles.map(describe), physicalCount: tiles.length,
    meaning: label === null ? '类型或实体牌不完整／不一致，不补猜明暗与结构。' : '当前快照已存在的组合；暗杠是四张，不是暗刻。' };
}
function actionTransition(f) {
  const selected = f.selectedAction, after = selected.afterDiscard;
  if (selected.discardStatus !== 'available' || !after) return { status:selected.discardStatus === 'not-applicable' ? 'not-applicable' : 'unavailable', reason:selected.reason ?? '本次没有可确认的配套弃牌，不模拟鸣牌、杠或缺失后续动作。' };
  const tile = selected.discard, beforeShanten = f.localAnalysis.status === 'available' && Number.isInteger(f.localAnalysis.shanten) ? f.localAnalysis.shanten : null;
  const afterShanten = f.localAnalysis.status === 'available' && Number.isInteger(after.efficiency?.shanten) ? after.efficiency.shanten : null;
  return { status:'available', scope:'仅比较当前冻结暗手（已含摸牌或已完成鸣牌）与执行本次弃牌之后，不代表摸牌前或上一巡。',
    discardedTile:tile, drawnTile:f.hand.drawnTile, discardMethod:selected.discardMethod,
    ownTileCount: { before:f.hand.shape ? f.hand.canonicalCounts?.[tile.canonical] ?? null : null, after:after.shape ? after.sameTileInOwnConcealedHand.canonical : null, scope:'自家暗手同种牌，含赤五；不是牌河或全场已见数量。' },
    shanten: { before:beforeShanten, after:afterShanten, change:beforeShanten === null || afterShanten === null ? 'unknown' : afterShanten < beforeShanten ? 'improved' : afterShanten > beforeShanten ? 'worsened' : 'unchanged' },
    isolatedTiles: { before:f.hand.shape?.isolatedTiles ?? null, after:after.shape?.isolatedTiles ?? null },
    meldsChangedByDiscard:false,
    meaning:'摸切／手切只读discardMethod；改善向听须change=improved，unchanged只能说维持，不能把已完成摸牌带来的变化归给弃牌。局部牌形与孤张不等于引擎动机。' };
}
function focusFor(f) {
  const name = t => t?.code ? t.name + '(' + t.code + ')' : null;
  const shape = x => x ? { sameTileGroups: x.sameTileGroups.map(g => [name(g.tile),g.count,g.shapeName]), sequences: x.possibleSequences } : null;
  const selected = f.selectedAction, after = selected.afterDiscard, tile = selected.discard?.code, canonical = tile ? Analysis.canonical(tile) : null;
  const links = x => !x || !canonical ? null : x.incompleteSequenceCompletions.filter(p => p.tiles.includes(canonical));
  const risk = f.risk.candidates?.find(c => c.tile === tile);
  return { position: f.binding.position, currentContext: f.currentContext, candidateEfficiencySource: 'facts.candidateEfficiency', actionTransitionSource: 'facts.actionTransition', meldsSource: 'facts.situation.players[].melds', round: { prevailingWind: name(f.round.prevailingWind), selfWind: name(f.round.selfWind), dealerSeat: f.round.dealerSeat },
    situation: f.situation, concealedSize: [f.hand.concealedCount, after?.concealedCount ?? null], availableGroups: { before: shape(f.hand.shape), after: shape(after?.shape) },
    discard: tile ? { tile: name(selected.discard), status: selected.discardStatus, method: selected.discardMethod,
      ownSameTile: [f.hand.canonicalCounts?.[canonical] ?? null, after?.sameTileInOwnConcealedHand.canonical ?? null],
      localLinks: { before: links(f.hand.shape), after: links(after?.shape) }, efficiency: after?.efficiency ?? null,
      safetyByOpponent: risk?.opponents.map(o => ({ seat: o.seat, relativeName: o.relativeName, ...o.safety })) ?? [],
      safetyScope: 'confirmed仅绑定对应对手和当前时点；unknown不是不安全。' } : null,
    scope: '仅索引当前动作；局部组合可能重叠，补牌不是总体进张；null为未知或不适用。' };
}

function buildFactCard(snapshot, engine = {}, analysis, context = {}) {
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
    if (meldFact(m, meldIndex).status === 'known' && [3, 4].includes(tiles.length) && tiles.every(validTile) && tiles.every(t => Analysis.canonical(t) === code) && yakuhaiCodes.includes(code)) groups.push({ tile: describe(code), area: 'meld', meldIndex, count: tiles.length, shape: tiles.length === 4 ? 'kan' : 'triplet', visibility: meldFact(m, meldIndex).visibility });
  }
  const events = authorizedTimeline(s, context.events);
  const visible = efficiency.visibleTiles;
  const card = {
    format: 'mortal-teaching-fact-card-v5',
    binding: { position: s.lastStep ?? null, source: s.source ?? 'unknown', selfSeat: self },
    tileLegend: [...ALL, '0m', '0p', '0s'].map(describe),
    round: { prevailingWind: describe(wind === null ? null : (wind + 1) + 'z'), roundIndex: dealer, handNumber: dealer === null ? null : dealer + 1, dealerSeat: dealer, selfSeat: self, selfWind: describe(selfWind), honba: game?.honba ?? null },
    seats,
    currentContext: currentContext(s, self, dealer, wind, seats),
    candidateEfficiency: candidateTable(efficiency),
    hand: { concealedTiles: hand?.map(describe) ?? null, concealedCount: hand?.length ?? null, exactCounts: counts(hand), canonicalCounts: canonicalCounts(hand), drawnTile: describe(s.selfDrawnTile), drawnAlreadyIncluded: true, countScope: 'self-concealed-hand-before-action', shape: shapeFacts(hand, visible),
      melds: melds?.map(meldFact) ?? null,
      meldPhysicalCount: ownMeldTiles?.length ?? null, totalOwnedPhysicalCount: hand && ownMeldTiles ? hand.length + ownMeldTiles.length : null },
    dora: { rules: s.playerCount === 4 ? 'four-player' : 'unknown', indicators: game?.doras?.map(t => ({ indicator: describe(t), dora: describe(s.playerCount === 4 ? doraFor(t) : null) })) ?? null, redTilesInHand: hand?.filter(t => /^0[mps]$/.test(t)).map(describe) ?? null, redTilesInOwnMelds: ownMeldTiles?.filter(t => /^0[mps]$/.test(t)).map(describe) ?? null, redDoraRuleEnabled: null },
    selectedAction: { action, followUp, discard: discard ? describe(discard.pai) : null, discardStatus, reason: discardReason, discardMethod: typeof discard?.tsumogiri === 'boolean' ? discard.tsumogiri ? 'drawn-tile' : 'hand-tile' : 'unknown', afterDiscard: after ? { concealedTiles: after.map(describe), concealedCount: after.length, exactCounts: counts(after), canonicalCounts: canonicalCounts(after), countScope: 'self-concealed-hand-after-discard', sameTileInOwnConcealedHand: { exact: after.filter(t => t === discard.pai).length, canonical: after.filter(t => Analysis.canonical(t) === Analysis.canonical(discard.pai)).length, meaning: '只统计本次弃牌后自家暗手持有枚数；0不等于全场见尽，也不等于牌山无此牌。' }, shape: shapeFacts(after, visible), efficiency: selectedEfficiency } : null },
    localAnalysis: { ...efficiency, efficiencyCandidatesAreEngineLegalActions: false, visibleCountScope: '包含自家手牌（摸牌不重复追加）、宝牌指示牌、各家副露/暗杠和牌河；已鸣牌按本地工具规则去重。4减已见枚数为未见上界，非牌山剩余。' },
    situation: { riichiSeats: game?.players?.filter(p => p.riichi === true).map(p => p.seat) ?? null, players: seats.map(p => { const v = game?.players?.find(x => x.seat === p.seat); return { seat: p.seat, relativeName: p.relativeName, riichi: typeof v?.riichi === 'boolean' ? v.riichi : null, meldCount: Array.isArray(v?.melds) ? v.melds.length : null, melds: Array.isArray(v?.melds) ? v.melds.map(meldFact).map(m => ({ label:m.label, status:m.status, tiles:m.tiles.map(t => t.name + '(' + t.code + ')') })) : null }; }) },
    risk: { ...local.danger, riverIndexBase: 0, candidates: (local.danger?.candidates || []).map(c => ({ ...c, tileIdentity: describe(c.tile), opponents: c.opponents.map(o => {
        const riverIndices = s.rivers?.find(r => r.seat === o.seat)?.discards?.flatMap((d,index) => Analysis.canonical(d.tile) === Analysis.canonical(c.tile) ? [index] : []) ?? [];
        const exclusion = visibleExclusion(s, visible, c.tile);
        const evidence = [...(riverIndices.length ? [{type:'river',riverIndices}] : []), ...passedRiichiEvidence(s, events, o.seat, c.tile), ...(exclusion ? [exclusion] : [])];
        return ({ ...o, safety: { status: evidence.length ? 'confirmed' : 'unknown', evidence, scope: '仅限本座位在当前冻结时点不能荣和该牌；不推断其他牌或未来。' }, relativeName: seats[o.seat]?.relativeName ?? 'unknown', wind: seats[o.seat]?.wind ?? describe(null), genbutsuMeaning: 'true仅依据该对手本人牌河；false表示本工具未找到本人弃牌证据，不否定立直后他家打出并通过等其他已核实安全证据。', genbutsuRiverIndices: s.rivers?.find(r => r.seat === o.seat)?.discards?.flatMap((d, index) => Analysis.canonical(d.tile) === Analysis.canonical(c.tile) ? [{ index, tile: describe(d.tile) }] : []) ?? null }); }) })) },
    yakuhai: { identities, completedGroups: groups, scoringVerified: false, concealedGroupMeaning: 'concealedHand 的 tripletPresent 仅表示手中至少三张同种役牌；可拆作其他牌形，不保证最终和牌分组或已成役。' },
    countScopes: { ownConcealed: 'hand与afterDiscard的counts仅是自家暗手；赤五在exactCounts中单列，在canonicalCounts中与普通五合并。', visible: 'localAnalysis.visibleTiles是本次已授权可见范围；partial或invalid时不能声称全场见尽。', unseen: 'effectiveTiles.unseenUpperBound是4减已见的上界；包含未知对手手牌、王牌和牌山，不能当实际牌山枚数。' },
    limitations: ['向听0仅代表形状听牌，不代表有役可和；完整役、振听和得分未知。', '安全证据只绑定对应座位和当前时点；unknown不是不安全，筋、壁不保证安全。', '不推算引擎Q值、分数、胜率或内部思考；效率候选不是引擎合法动作集合。']
  };
  card.handTileAvailability = compactCounts(s, card);
  card.actionTransition = actionTransition(card);
  card.explanationFocus = focusFor(card);
  return card;
}
const api = { buildFactCard };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJEngineFacts = api;
})(globalThis);
