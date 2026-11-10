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
  const c = canonicalCounts(tiles), sameTileGroups = [], sequences = [], incompleteSequences = [];
  for (const [code, count] of Object.entries(c)) if (count >= 2) sameTileGroups.push({ tile: describe(code), count, pairPossible: true, tripletPossible: count >= 3 });
  for (const suit of 'mps') for (let rank = 1; rank <= 9; rank++) {
    const first = rank + suit;
    if (!c[first]) continue;
    if (rank <= 7 && c[(rank + 1) + suit] && c[(rank + 2) + suit]) sequences.push([first, (rank + 1) + suit, (rank + 2) + suit]);
    for (const gap of [1, 2]) if (rank + gap <= 9 && c[(rank + gap) + suit]) incompleteSequences.push([first, (rank + gap) + suit]);
  }
  return { sameTileGroups, possibleSequences: sequences, possibleIncompleteSequences: incompleteSequences,
    incompleteSequenceCompletions: incompleteSequences.map(pair => {
      const a = Number(pair[0][0]), b = Number(pair[1][0]), suit = pair[0][1];
      const ranks = b - a === 2 ? [a + 1] : [a - 1, b + 1].filter(n => n >= 1 && n <= 9);
      return { tiles: pair, status: !visible || visible.invalid ? "unavailable" : visible.partial ? "partial" : "complete",
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
function focusFor(f) {
  const name = t => t?.code ? t.name + '(' + t.code + ')' : null;
  const shape = x => x ? { sameTileGroups: x.sameTileGroups.map(g => [name(g.tile),g.count]), sequences: x.possibleSequences } : null;
  const selected = f.selectedAction, after = selected.afterDiscard, tile = selected.discard?.code, canonical = tile ? Analysis.canonical(tile) : null;
  const links = x => !x || !canonical ? null : x.incompleteSequenceCompletions.filter(p => p.tiles.includes(canonical));
  const risk = f.risk.candidates?.find(c => c.tile === tile);
  return { position: f.binding.position, round: { prevailingWind: name(f.round.prevailingWind), selfWind: name(f.round.selfWind), dealerSeat: f.round.dealerSeat },
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
    if ([3, 4].includes(tiles.length) && tiles.every(validTile) && tiles.every(t => Analysis.canonical(t) === code) && yakuhaiCodes.includes(code)) groups.push({ tile: describe(code), area: 'meld', meldIndex, count: tiles.length, shape: tiles.length === 4 ? 'kan' : 'triplet', visibility: m.type === 3 ? 'concealedKan' : Number.isInteger(m.type) ? 'open' : 'unknown' });
  }
  const events = authorizedTimeline(s, context.events);
  const visible = efficiency.visibleTiles;
  const card = {
    format: 'mortal-teaching-fact-card-v3',
    binding: { position: s.lastStep ?? null, source: s.source ?? 'unknown', selfSeat: self },
    tileLegend: [...ALL, '0m', '0p', '0s'].map(describe),
    round: { prevailingWind: describe(wind === null ? null : (wind + 1) + 'z'), roundIndex: dealer, handNumber: dealer === null ? null : dealer + 1, dealerSeat: dealer, selfSeat: self, selfWind: describe(selfWind), honba: game?.honba ?? null },
    seats,
    hand: { concealedTiles: hand?.map(describe) ?? null, concealedCount: hand?.length ?? null, exactCounts: counts(hand), canonicalCounts: canonicalCounts(hand), drawnTile: describe(s.selfDrawnTile), drawnAlreadyIncluded: true, countScope: 'self-concealed-hand-before-action', shape: shapeFacts(hand, visible),
      melds: melds?.map((m, index) => ({ index, type: m.type ?? null, visibility: m.type === 3 ? 'concealedKan' : Number.isInteger(m.type) ? 'open' : 'unknown', tiles: (m.tiles || []).map(describe), physicalCount: m.tiles?.length ?? null })) ?? null,
      meldPhysicalCount: ownMeldTiles?.length ?? null, totalOwnedPhysicalCount: hand && ownMeldTiles ? hand.length + ownMeldTiles.length : null },
    dora: { rules: s.playerCount === 4 ? 'four-player' : 'unknown', indicators: game?.doras?.map(t => ({ indicator: describe(t), dora: describe(s.playerCount === 4 ? doraFor(t) : null) })) ?? null, redTilesInHand: hand?.filter(t => /^0[mps]$/.test(t)).map(describe) ?? null, redTilesInOwnMelds: ownMeldTiles?.filter(t => /^0[mps]$/.test(t)).map(describe) ?? null, redDoraRuleEnabled: null },
    selectedAction: { action, followUp, discard: discard ? describe(discard.pai) : null, discardStatus, reason: discardReason, discardMethod: typeof discard?.tsumogiri === 'boolean' ? discard.tsumogiri ? 'drawn-tile' : 'hand-tile' : 'unknown', afterDiscard: after ? { concealedTiles: after.map(describe), concealedCount: after.length, exactCounts: counts(after), canonicalCounts: canonicalCounts(after), countScope: 'self-concealed-hand-after-discard', sameTileInOwnConcealedHand: { exact: after.filter(t => t === discard.pai).length, canonical: after.filter(t => Analysis.canonical(t) === Analysis.canonical(discard.pai)).length, meaning: '只统计本次弃牌后自家暗手持有枚数；0不等于全场见尽，也不等于牌山无此牌。' }, shape: shapeFacts(after, visible), efficiency: selectedEfficiency } : null },
    localAnalysis: { ...efficiency, efficiencyCandidatesAreEngineLegalActions: false, visibleCountScope: '包含自家手牌（摸牌不重复追加）、宝牌指示牌、各家副露/暗杠和牌河；已鸣牌按本地工具规则去重。4减已见枚数为未见上界，非牌山剩余。' },
    situation: { riichiSeats: game?.players?.filter(p => p.riichi === true).map(p => p.seat) ?? null, players: seats.map(p => { const v = game?.players?.find(x => x.seat === p.seat); return { seat: p.seat, relativeName: p.relativeName, riichi: typeof v?.riichi === 'boolean' ? v.riichi : null, meldCount: Array.isArray(v?.melds) ? v.melds.length : null }; }) },
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
  card.explanationFocus = focusFor(card);
  return card;
}
const api = { buildFactCard };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJEngineFacts = api;
})(globalThis);
