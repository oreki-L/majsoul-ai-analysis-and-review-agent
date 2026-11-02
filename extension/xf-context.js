/* X-F: browser-portable projection of the frozen X-S + phase3 facts strategy. */
(function (root) {
'use strict';
const Snapshot = typeof module !== 'undefined' && module.exports ? require('./contracts/snapshot.js') : root.MJSnapshotContract;
const C = Snapshot;
const Analysis = typeof module !== 'undefined' && module.exports ? require('./analysis.js') : root.MJAnalysis;
const clone = v => structuredClone(v);
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function canonicalStringify(value) {
  const seen = new Set();
  function visit(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== 'object' || seen.has(item)) throw new Error('Benchmark canonical data must be finite JSON');
    seen.add(item);
    const out = Array.isArray(item) ? `[${item.map(visit).join(',')}]` : `{${Object.keys(item).sort().map(k => `${JSON.stringify(k)}:${visit(item[k])}`).join(',')}}`;
    seen.delete(item); return out;
  }
  return visit(value);
}
// SHA-256 over UTF-8 canonical JSON; no network or platform-specific runtime.
function sha256(text) {
 const bytes = new TextEncoder().encode(text), size = Math.ceil((bytes.length + 9) / 64) * 64;
 const data = new Uint8Array(size); data.set(bytes); data[bytes.length] = 128;
 const view = new DataView(data.buffer); view.setUint32(size - 8, Math.floor(bytes.length / 536870912)); view.setUint32(size - 4, (bytes.length * 8) >>> 0);
 const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
 const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const rotr = (x,n) => (x >>> n) | (x << (32-n)), w = new Uint32Array(64);
 for (let offset=0;offset<size;offset+=64) {
  for(let i=0;i<16;i++) w[i]=view.getUint32(offset+i*4);
  for(let i=16;i<64;i++) { const x=w[i-15],y=w[i-2]; w[i]=((rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-16]+(rotr(y,17)^rotr(y,19)^(y>>>10))+w[i-7])>>>0; }
  let [a,b,c,d,e,f,g,j]=h;
  for(let i=0;i<64;i++) { const t1=(j+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0; j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0; }
  [a,b,c,d,e,f,g,j].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
 }
 return h.map(x=>x.toString(16).padStart(8,'0')).join('');
}
const stableHash = v => sha256(canonicalStringify(v));
function authorizationFor(snapshot) { return { game: !!snapshot.game, riverSeats: (snapshot.rivers ?? []).map(x => x.seat).sort(), selfHand: !!snapshot.selfHand, selfSeat: snapshot.selfSeat }; }
const Core = { stableHash, canonicalStringify, authorizationFor };
const same = (a,b) => canonicalStringify(a) === canonicalStringify(b);
function fail(reason) { throw new Error('X-F context: ' + reason); }
  function authorizedEvents(input, history, position) {
    const seen = new Set();
    return history.filter(e => e && Number.isInteger(e.position) && e.position <= (position ?? -1)).sort((a, b) => a.position - b.position).flatMap(e => {
      if (!['NewRound', 'DealTile', 'DiscardTile', 'ChiPengGang', 'AnGangAddGang', 'BaBei', 'Hule', 'NoTile', 'LiuJu'].includes(e.kind) || e.source !== input.source) return [];
      if (['DealTile', 'DiscardTile', 'ChiPengGang', 'AnGangAddGang', 'BaBei'].includes(e.kind) &&
        (!Number.isInteger(e.seat) || e.seat < 0 || e.seat >= input.playerCount)) return [];
      if (e.kind === 'DiscardTile' && !input.rivers?.some(r => r.seat === e.seat)) return [];
      if (['ChiPengGang', 'AnGangAddGang', 'BaBei'].includes(e.kind) && !input.game) return [];
      const out = { kind: e.kind, source: e.source, position: e.position };
      if (Number.isInteger(e.seat) && e.seat >= 0 && e.seat < input.playerCount) out.seat = e.seat;
      if (e.kind === 'DealTile') out.tile = e.seat === input.selfSeat && input.selfHand ? C.tile(e.tile) : '?';
      if (e.kind === 'DiscardTile') { out.tile = C.tile(e.tile); for (const key of ['riichi', 'tsumogiri']) if (typeof e[key] === 'boolean') out[key] = e[key]; }
      if (['ChiPengGang', 'AnGangAddGang'].includes(e.kind)) {
        if (Number.isInteger(e.meldType)) out.meldType = e.meldType;
        if (Array.isArray(e.tiles)) out.tiles = e.tiles.slice(0, 4).map(C.tile);
        if (e.tile) out.tile = C.tile(e.tile);
      }
      const key = JSON.stringify(out);
      if (seen.has(key)) return [];
      seen.add(key); return [out];
    });
  }

const IMPORTANT = new Set(['NewRound', 'ChiPengGang', 'AnGangAddGang', 'BaBei', 'riichi', 'riichi-declaration', 'riichi-accepted', 'dora-change', 'score-or-stick-change', 'round-start', 'meld', 'kan', 'north-extraction']);
function projectBaseline(raw, node) {
  if (!raw?.snapshot || !Number.isSafeInteger(raw.position) || raw.position > node.position) throw new Error('Exact production baseline is required');
  const snapshot = Snapshot.cleanSnapshot(raw.snapshot); delete snapshot.availableActions;
  if (!node.snapshot.selfHand) { delete snapshot.selfHand; snapshot.selfDrawnTile = null; }
  if (!node.snapshot.game) delete snapshot.game;
  if (snapshot.rivers) snapshot.rivers = snapshot.rivers.filter(r => node.snapshot.rivers?.some(c => c.seat === r.seat));
  return { position: raw.position, snapshot, origin: raw.origin, ...(raw.reason ? { reason: raw.reason } : {}) };
}
function importantEvents(events) { return events.filter(e => IMPORTANT.has(e.kind) || e.riichi === true); }
function importantFacts(roundSource, node, initial, events) {
  const out = [{ kind: 'round-start', position: initial.position, source: 'authorized-round-baseline', snapshotHash: stableHash(initial.snapshot), game: initial.snapshot.game ? { round: initial.snapshot.game.round, honba: initial.snapshot.game.honba, sticks: initial.snapshot.game.sticks, scores: initial.snapshot.game.scores, doras: initial.snapshot.game.doras } : null }];
  for (const event of importantEvents(events).filter(e => e.kind !== 'NewRound')) out.push(event);
  let before = initial.snapshot;
  for (const state of (roundSource.states ?? []).filter(s => s.position <= node.position).sort((a, b) => a.position - b.position)) {
    const after = Snapshot.cleanSnapshot(state.snapshot);
    if (!same(authorizationFor(after), node.authorization)) throw new Error('Important state-difference authorization mismatch');
    for (const [kind, fields] of [['dora-change', ['doras']], ['score-or-stick-change', ['scores', 'sticks', 'honba']]]) {
      const changedFields = fields.filter(k => !same(before.game?.[k] ?? null, after.game?.[k] ?? null));
      if (changedFields.length) out.push({ kind, position: state.position, source: 'verified-state-difference-at-observation', sourceSnapshotHash: stableHash(after), previousSnapshotHash: stableHash(before), changedFields, before: Object.fromEntries(changedFields.map(k => [k, before.game?.[k] ?? null])), after: Object.fromEntries(changedFields.map(k => [k, after.game?.[k] ?? null])), limitation: 'Change observed by this cutoff; exact intervening event position unknown' });
    }
    before = after;
  }
  return out.sort((a, b) => a.position - b.position);
}
function stateEntries(node, source) {
  const entries = [{ ...source.baseline, origin: 'baseline' }, ...(source.states ?? []).map(s => ({ ...s, origin: s.origin ?? 'collected-state' }))]
    .filter(e => Number.isSafeInteger(e.position) && e.position < node.position).sort((a, b) => a.position - b.position);
  return entries.map((e, i) => {
    const snapshot = Snapshot.cleanSnapshot(e.snapshot);
    if (snapshot.lastStep !== e.position || !same(Core.authorizationFor(snapshot), node.authorization)) fail('captured fact authorization/position mismatch');
    const hash = Core.stableHash(snapshot);
    return { sourceId: (e.origin === 'baseline' ? 'baseline' : 'state') + ':' + e.position + ':' + hash.slice(0, 16) + ':' + i, position: e.position, origin: e.origin, snapshotHash: hash, snapshot };
  });
}
// Scalar interning, including explicit null/empty values; never a raw first snapshot.
function internFacts(entries) {
  const dictionary = [], indexes = new Map();
  function leaves(value, at = [], out = []) {
    if (value && typeof value === 'object' && Object.keys(value).length) for (const k of Object.keys(value)) leaves(value[k], [...at, Array.isArray(value) ? +k : k], out);
    else out.push({ path: at, value });
    return out;
  }
  const states = entries.map(e => ({ sourceId: e.sourceId, position: e.position, origin: e.origin, snapshotHash: e.snapshotHash,
    factRefs: leaves(e.snapshot).map(f => { const key = Core.canonicalStringify(f); if (!indexes.has(key)) { indexes.set(key, dictionary.length); dictionary.push(f); } return indexes.get(key); }) }));
  return { format: 'typed-field-intern-v1', meaning: 'All authorized captured old scalar facts; never current authority.', fieldDictionary: dictionary, states };
}
function binding(node) { return {stateId:node.id,decisionId:node.id,eventPosition:node.position,snapshotHash:Core.stableHash(node.snapshot),authorizationRevision:Core.stableHash(node.authorization)}; }
function navigation(node) {
  const s=node.snapshot, g=s.game, round=g?.round, dealer=Number.isInteger(round?.index)&&round.index>=0&&round.index<4?round.index:null;
  const counts={}; for(const t of s.selfHand??[]) counts[t]=(counts[t]??0)+1;
  const canonical=t=>/^0[mps]$/.test(t)?'5'+t[1]:t, shapeCounts={}; for(const t of s.selfHand??[]) shapeCounts[canonical(t)]=(shapeCounts[canonical(t)]??0)+1;
  const wind=dealer===null?null:(s.selfSeat-dealer+4)%4;
  return {...binding(node), selfSeat:s.selfSeat,dealerSeat:dealer,identityRule:'four-player snapshot.round.index is dealer seat; extension/state.js seatWind convention',round:round??null,honba:g?.honba??null,selfWind:wind===null?'unknown':['东','南','西','北'][wind],roundWind:Number.isInteger(round?.wind)?['东','南','西','北'][round.wind]??'unknown':'unknown',
    seats:Array.from({length:4},(_,seat)=>({seat,relative:seat===s.selfSeat?'自家':((seat-s.selfSeat+4)%4===1?'下家':(seat-s.selfSeat+4)%4===2?'对家':'上家'),score:g?.scores?.[seat]??null,differenceFromSelf:g?.scores?g.scores[s.selfSeat]-g.scores[seat]:null})),selfRank:g?.scores?1+g.scores.filter(v=>v>g.scores[s.selfSeat]).length:null,
    hand:{raw:s.selfHand??null,rawCounts:counts,shapeCounts,drawnTile:s.selfDrawnTile??null,drawnAlreadyInHand:s.selfDrawnTile?(s.selfHand??[]).includes(s.selfDrawnTile):null,pairs:Object.keys(shapeCounts).filter(t=>shapeCounts[t]>=2),pairMeaning:'count >= 2; not optimal decomposition'},
    honors:Array.from({length:7},(_,i)=>({tile:(i+1)+'z',name:['东','南','西','北','白','发','中'][i],kind:i<4?'wind':'dragon',roundWind:i<4&&round?.wind===i,selfWind:i<4&&wind===i})),
    doraIndicators:g?.doras??null,actualDoras:(g?.doras??[]).map(raw=>{const t=canonical(raw);if(!/^[1-9][mpsz]$/.test(t))return null;const n=+t[0],suit=t[1];return (suit==='z'?(n<=4?n%4+1:(n-5+1)%3+5):n%9+1)+suit;}),doraRule:'standard four-player indicator cycle; red identity preserved in raw hand',
    decisionContext:node.decisionContext,discardConstraints:node.discardConstraints??null,legalActions:node.legalActions};
}
const KINDS = ['own-seat', 'dealer-seat', 'opponent-seat', 'hand-tile', 'drawn-tile', 'river-tile', 'dora-indicator', 'score', 'remaining', 'hand-size', 'current-shanten', 'candidate-shanten', 'effective-tile', 'unseen-upper-bound', 'total-unseen-upper-bound', 'river-available', 'genbutsu', 'suji-reference', 'kabe-reference'];
function bindingFor(node) {
  if (!node || !['id', 'roundId', 'sessionId'].every(k => typeof node[k] === 'string' && node[k]) || !Number.isSafeInteger(node.position) || node.position < 0) throw new Error('Fact catalog requires an explicitly bound decision');
  const snapshot = Snapshot.cleanSnapshot(node.snapshot), authorization = authorizationFor(snapshot);
  if (snapshot.lastStep !== node.position || node.authorization && !same(node.authorization, authorization)) throw new Error('Fact catalog snapshot/authorization cutoff mismatch');
  const binding = { decisionId: node.id, roundId: node.roundId, sessionId: node.sessionId, position: node.position, snapshotHash: stableHash(snapshot), authorizationHash: stableHash(authorization) };
  return { snapshot, binding, stateId: stableHash(binding) };
}
function createFactCatalog(node, prepared = Analysis.prepare(node.snapshot, 'combined')) {
  const { snapshot, binding, stateId } = bindingFor(node);
  if (prepared.data.lastStep !== node.position || prepared.data.selfSeat !== snapshot.selfSeat || !same(prepared.data.authorization, { game: !!snapshot.game, riverSeats: (snapshot.rivers || []).map(r => r.seat), selfHand: !!snapshot.selfHand })) throw new Error('Prepared facts do not match the authorized current snapshot');
  const computed = Analysis.prepare(snapshot, prepared.task).data.localAnalysis;
  const legal = node.legalActions?.map(a => a.tile) ?? prepared.data.outputConstraints.legalDiscards;
  if (!Array.isArray(legal) || legal.some(t => !snapshot.selfHand?.includes(t)) || new Set(legal).size !== legal.length) throw new Error('Fact catalog requires valid constrained legal candidates');
  if (computed.efficiency?.candidates) computed.efficiency.candidates = computed.efficiency.candidates.filter(c => legal.includes(c.tile));
  if (!same(computed, prepared.data.localAnalysis)) throw new Error('Prepared local calculations differ from deterministic frozen-state calculations');
  const sources = { snapshot: { id: 'snapshot-' + stableHash({ stateId, value: snapshot }), value: snapshot } };
  for (const name of ['efficiency', 'danger']) if (computed[name]) sources[name] = { id: name + '-' + stableHash({ stateId, value: computed[name] }), value: computed[name] };
  const facts = [];
  function add(kind, sourceName, path, value, tile = null, seat = null, status = value === null || value === undefined ? 'unknown' : 'known') {
    const source = sources[sourceName];
    if (!source || !KINDS.includes(kind)) throw new Error('Unsupported fact source');
    const normalized = value === undefined ? null : value;
    if (!['string', 'number', 'boolean'].includes(typeof normalized) && normalized !== null || typeof normalized === 'number' && !Number.isFinite(normalized)) throw new Error('Facts must contain finite scalar assertions');
    const fact = { factId: 'f-' + stableHash({ stateId, sourceId: source.id, path, kind, tile, seat }).slice(0, 24), stateId, kind, sourceId: source.id, path, subjectTile: tile, subjectSeat: seat, value: normalized, status };
    facts.push(fact);
  }
  add('own-seat', 'snapshot', '/selfSeat', snapshot.selfSeat, null, snapshot.selfSeat);
  if (snapshot.selfHand) {
    add('hand-size', 'snapshot', '/selfHand/length', snapshot.selfHand.length, null, snapshot.selfSeat);
    snapshot.selfHand.forEach((tile, i) => add('hand-tile', 'snapshot', '/selfHand/' + i, tile, tile, snapshot.selfSeat));
    add('drawn-tile', 'snapshot', '/selfDrawnTile', snapshot.selfDrawnTile, snapshot.selfDrawnTile, snapshot.selfSeat);
  }
  if (snapshot.game) {
    add('dealer-seat', 'snapshot', '/game/round/index', snapshot.game.round.index, null, snapshot.game.round.index);
    add('remaining', 'snapshot', '/game/remaining', snapshot.game.remaining);
    snapshot.game.scores.forEach((score, seat) => add('score', 'snapshot', '/game/scores/' + seat, score, null, seat));
    snapshot.game.doras.forEach((tile, i) => add('dora-indicator', 'snapshot', '/game/doras/' + i, tile, tile));
  }
  for (const [ri, river] of (snapshot.rivers ?? []).entries()) river.discards.forEach((discard, di) => add('river-tile', 'snapshot', `/rivers/${ri}/discards/${di}/tile`, discard.tile, discard.tile, river.seat));
  if (computed.efficiency) {
    const e = computed.efficiency;
    add('current-shanten', 'efficiency', '/shanten', e.status === 'available' ? e.shanten : null, null, snapshot.selfSeat);
    for (const [i, c] of (e.candidates ?? []).entries()) {
      add('candidate-shanten', 'efficiency', `/candidates/${i}/shanten`, c.shanten, c.tile, snapshot.selfSeat);
      add('total-unseen-upper-bound', 'efficiency', `/candidates/${i}/totalUnseenUpperBound`, c.totalUnseenUpperBound, c.tile, snapshot.selfSeat);
      for (const [j, t] of c.effectiveTiles.entries()) {
        add('effective-tile', 'efficiency', `/candidates/${i}/effectiveTiles/${j}/tile`, t.tile, c.tile, snapshot.selfSeat);
        add('unseen-upper-bound', 'efficiency', `/candidates/${i}/effectiveTiles/${j}/unseenUpperBound`, t.unseenUpperBound, c.tile, snapshot.selfSeat);
      }
    }
  }
  if (computed.danger) for (const [i, c] of computed.danger.candidates.entries()) for (const [j, o] of c.opponents.entries()) {
    add('opponent-seat', 'danger', `/candidates/${i}/opponents/${j}/seat`, o.seat, c.tile, o.seat);
    add('river-available', 'danger', `/candidates/${i}/opponents/${j}/riverAvailable`, o.riverAvailable, c.tile, o.seat);
    // No river means genbutsu is unknown, even though the calculator internally
    // uses false as the absence of found evidence. Do not publish it as a fact.
    add('genbutsu', 'danger', `/candidates/${i}/opponents/${j}/genbutsu`, o.riverAvailable ? o.genbutsu : null, c.tile, o.seat);
    o.sujiReferences.forEach((tile, k) => add('suji-reference', 'danger', `/candidates/${i}/opponents/${j}/sujiReferences/${k}`, tile, c.tile, o.seat));
    o.kabeReferences.forEach((tile, k) => add('kabe-reference', 'danger', `/candidates/${i}/opponents/${j}/kabeReferences/${k}`, tile, c.tile, o.seat));
  }
  const catalog = { version: VERSION, binding, stateId, sources: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, { id: source.id, hash: stableHash(source.value) }])), facts,
    limitations: ['Only listed current authorized scalar assertions are machine-checkable.', 'A matching citation does not prove natural-language meaning, strategic value, exact wall counts, or overall answer quality.'] };
  return freeze({ ...catalog, hash: stableHash(catalog) });
}
const Citation = { createFactCatalog };
const VERSION = "phase3-compact-facts/1";
const normalize = t => t.replace(/^0/, "5");
function catalogFor(context, node) {
  // Reuse authorization, prepared-calculation and legal-set validation, without
  // sending its verbose per-leaf catalog to the model.
  const checked = Citation.createFactCatalog(node, context.prepared);
  const s = node.snapshot, e = context.prepared.data.localAnalysis.efficiency;
  const d = context.prepared.data.localAnalysis.danger;
  const prefix = checked.stateId.slice(0, 12) + ':', facts = {}, provenance = {};
  const add = (key, value, source) => {
    if (value === undefined) value = null;
    facts[prefix + key] = clone(value); provenance[prefix + key] = source;
  };
  add('selfSeat', s.selfSeat, 'snapshot/selfSeat');
  add('hand', s.selfHand ?? null, 'snapshot/selfHand');
  add('legalDiscards', node.legalActions.map(a => a.tile), 'node/legalActions');
  if (s.game) {
    add('roundWind', (s.game.round.wind + 1) + 'z', 'snapshot/game/round/wind + 1');
    add('dealerSeat', s.game.round.index, 'snapshot/game/round/index');
    if (s.playerCount === 4 && s.selfSeat !== null) add('selfWind', ((s.selfSeat - s.game.round.index + 4) % 4 + 1) + 'z', 'yonma: (selfSeat-dealerSeat+4)%4+1');
    add('selfMeldCount', s.selfSeat === null ? null : s.game.players[s.selfSeat].melds.length, 'snapshot/game/players[selfSeat]/melds/length');
    add('doraIndicators', s.game.doras, 'snapshot/game/doras (indicators, not dora tiles)');
    for (const p of s.game.players) add('seat.' + p.seat + '.riichi', p.riichi, 'snapshot/game/players/' + p.seat + '/riichi');
  }
  const candidates = e?.status === 'available' ? e.candidates : [];
  if (candidates.length) {
    const min = Math.min(...candidates.map(c => c.shanten));
    const group = candidates.filter(c => c.shanten === min);
    const max = Math.max(...group.map(c => c.totalUnseenUpperBound));
    add('ranking.minShanten', min, 'min over complete constrained efficiency candidates');
    add('ranking.minShantenTiles', group.map(c => c.tile).sort(), 'all tied minimum-shanten legal candidates');
    add('ranking.maxUpperAtMin', max, 'max totalUnseenUpperBound within minShanten group');
    add('ranking.maxUpperTilesAtMin', group.filter(c => c.totalUnseenUpperBound === max).map(c => c.tile).sort(), 'all tied max upper-bound candidates within minShanten group');
  }
  for (const c of candidates) {
    add('eff.' + c.tile + '.shanten', c.shanten, 'localAnalysis/efficiency/candidates[tile]/shanten');
    add('eff.' + c.tile + '.totalUpper', c.totalUnseenUpperBound, 'localAnalysis/efficiency/candidates[tile]/totalUnseenUpperBound');
    const after = [...s.selfHand]; after.splice(after.indexOf(c.tile), 1);
    add('after.' + c.tile + '.hand', after.sort(), 'snapshot/selfHand minus one exact discard (red identity retained)');
    add('after.' + c.tile + '.redCount', after.filter(t => /^0[mps]$/.test(t)).length, 'count red fives in exact post-discard hand');
    const risk = d?.candidates.find(x => normalize(x.tile) === normalize(c.tile));
    for (const seat of context.prepared.data.outputConstraints.opponentSeats) {
      const o = risk?.opponents.find(x => x.seat === seat);
      add('risk.' + c.tile + '.seat.' + seat + '.genbutsu', o?.riverAvailable ? o.genbutsu : null, 'localAnalysis/danger/candidates[normalizedTile]/opponents[seat]; absent river = unknown');
    }
  }
  const body = { version: VERSION, binding: checked.binding, stateId: checked.stateId, facts,
    limitations: ['totalUpper is an unseen-count upper bound, not exact live-wall count', 'ranking covers the constrained legal set; no strategic preference is implied', 'same-kind exhaustion does not eliminate sequences using neighboring tiles', 'matching references do not verify prose or strategy'] };
  return { ...body, hash: Core.stableHash(body), provenance };
}
const P1 = `你为玩家分析本次冻结的日式立直麻将决策。当前状态与同stateId的本地计算是事实来源；旧建议只是当时意见，不能证明当前手牌、牌河或数值。编码、座位、局名使用本次导航映射，不自行换算缺失身份。
本次已附且状态匹配的计算可直接使用，无须重复查询；缺项、字段含义不清或证据不足时使用对应工具。不要凭记忆重算向听、进张枚数或宝牌。所有比较要说明对象和范围，并保留并列。
给出一个合法首选，解释当前攻守选择、主要风险对象及效率取舍；再比较至少一个真正有区别的合法备选。没有安全比较依据时明确未知，不把无证据当作安全或确定高危。不要为策略标签补造理由，不推测对手暗牌或牌山。
仅陈述与本次选择有关且可支持的事实。说明保留的牌形时先核对手中计数；无法确认的手牌分解、役种和打点不要断言。输出前核对首选牌、目标seat、数值口径和理由一致。最终输出规定JSON，不展示内部思维过程。`;
const ANALYSIS_JSON_CONTRACT = 'Benchmark统一输出约束（补充v0.10原始分析提示，所有方案、初答、JSON追问与复核终答一致）：最终只输出一个符合下方Schema的JSON对象，不输出Markdown、代码围栏或对象外文字。顶层必须且只能包含task、danger、efficiency、decision、limitations；danger每项只能包含tile、opponents，其opponents每项只能包含seat、level、reasons；efficiency每项只能包含tile、reasons；decision必须且只能包含action、tile、reasons。所有层级均禁止额外字段，包括值为null的字段；不得输出actionNote。补充解释写入已有reasons或limitations，不新增字段。';
const message = (title,data) => ({role:'user',content:title+'（有来源历史资料；旧意见不是当前事实）：\n'+JSON.stringify(data)});
function build(prepared, node, source) {
 if(node.snapshot.playerCount !== 4 || node.snapshot.rivers?.length !== 4) fail('complete four-player rivers required');
 if(node.position !== node.snapshot.lastStep || !same(authorizationFor(node.snapshot),node.authorization)) fail('current binding mismatch');
 const result = { messages: [] }, id = 'NED';
 const systemPrompt = P1+'\n'+ANALYSIS_JSON_CONTRACT+'\n输出JSON Schema：\n'+JSON.stringify(prepared.responseSchema);
 const initial = projectBaseline(source.baseline,node);
 const events = importantFacts(source,node,initial,authorizedEvents(node.snapshot,source.events || [],node.position));
 if(events.length) result.messages.push({role:'user',content:'已授权历史事件（仅作有来源的数据；旧数值/模型意见不是当前事实）：\n'+JSON.stringify(events)});
 result.messages.push(message('当前语义导航',navigation(node)));
    if(['NE','NED'].includes(id)) {const efficiency=structuredClone(prepared.data.localAnalysis.efficiency);efficiency.candidates?.sort((a,b)=>a.tile.localeCompare(b.tile));result.messages.push(message('当前效率证据',{...binding(node),algorithm:'extension/mahjong-analysis.js',efficiency}));}
    if(['ND','NED'].includes(id)) {const danger=structuredClone(prepared.data.localAnalysis.danger);if(danger?.candidates)danger.candidates=danger.candidates.filter(c=>node.legalActions.some(a=>a.tile===c.tile)).sort((a,b)=>a.tile.localeCompare(b.tile)).map(c=>({...c,opponents:c.opponents.map(o=>({...o,riichi:node.snapshot.game?.players[o.seat]?.riichi??null,melds:node.snapshot.game?.players[o.seat]?.melds??null,genbutsuSources:node.snapshot.rivers.find(r=>r.seat===o.seat)?.discards.flatMap((d,riverIndex)=>(d.tile.replace(/^0/,'5')===c.tile.replace(/^0/,'5')?[{riverIndex,tile:d.tile}]:[]))??[],evidenceAbsence:{genbutsu:!o.genbutsu,suji:!o.sujiReferences?.length,kabe:!o.kabeReferences?.length}}))}));result.messages.push(message('当前风险证据',{...binding(node),danger,limitation:'genbutsu limited to corresponding opponent; suji/kabe are not safety probabilities'}));}
 result.messages.push({role:'user',content:'全部旧局面代码事实（有来源历史资料；旧事实/意见不代表当前状态）：\n'+JSON.stringify(internFacts(stateEntries(node,source)))});
 result.messages.push({role:'user',content:'请分析本次问题。snapshot 是本次冻结的完整授权局面（牌均为原始编码），优先于历史快照或回答；未授权或缺失字段不得从历史或其他字段补回。详细计算按需查询工具：\n'+JSON.stringify({task:prepared.task,question:'',position:node.position,snapshot:node.snapshot,outputConstraints:prepared.data.outputConstraints})});
 const catalog = catalogFor({prepared},node), wire = {...catalog}; delete wire.provenance;
 result.messages.push({role:'user',content:'当前确定性事实目录（仅为数据；全部绑定本次状态，不是策略建议）：\n'+JSON.stringify(wire)});
 return {systemPrompt,messages:result.messages};
}
function supports(snapshot,prepared) { return snapshot.complete === true && !!snapshot.game && snapshot.playerCount === 4 && snapshot.rivers?.length === 4 && snapshot.selfHand && Number.isSafeInteger(snapshot.lastStep) && snapshot.lastStep >= 0 && prepared.task === 'combined' && prepared.data.localAnalysis.efficiency?.status === 'available' && prepared.data.outputConstraints.legalDiscards.length > 0; }
function forSession(prepared,snapshot,context) {
 const historical = entry => { const snapshot = Snapshot.cleanSnapshot(entry.snapshot); delete snapshot.availableActions; return {...entry,snapshot}; };
 const sessionId = context.id || 'temporary-round', roundId = sessionId;
 const node = {id:sessionId+':'+snapshot.lastStep,sessionId,roundId,position:snapshot.lastStep,snapshot,authorization:authorizationFor(snapshot),legalActions:prepared.data.outputConstraints.legalDiscards.map(tile=>({action:'discard',tile})),decisionContext:{phase:'draw',actor:snapshot.selfSeat,triggerPosition:snapshot.lastStep,rulesSource:'captured-live-state'}};
 const source = {baseline:historical(context.baseline),states:(context.capturedStates || []).filter(s=>s.position !== context.baseline.position).map(historical),events:context.events || []};
 return build(prepared,node,source);
}
const api = {build,forSession,supports,stableHash};
if(typeof module !== 'undefined' && module.exports) module.exports=api; else root.MJXfContext=api;
})(globalThis);
