'use strict';
// A controlled experimental adapter. No I/O, credentials, network, or quality gate.
const Core = require('./core.cjs');
const Citation = require('./fact-citations.cjs');
const VERSION = 'phase3-compact-facts/1';
const same = (a, b) => Core.canonicalStringify(a) === Core.canonicalStringify(b);
const clone = x => structuredClone(x);
const normalize = t => t.replace(/^0/, '5');
const PROMPT = '额外输出factClaims，原五个分析字段及实质备选、逐家风险解释义务不变。为首选和实质备选的关键数值、身份或现物判断选择3至6条当前目录引用；每条{id,value,supports,quote}：id复制目录键，value填写你实际断言的值（数组保留完整并列），supports为对应理由的JSON Pointer，quote逐字摘录该理由中的实际断言。引用不是理由，不在面向玩家的理由里输出路径或ID。未知写null。引用匹配不能证明整句牌理正确；不要因此声称整体质量通过。';

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
function targetsFor(a) {
  const m = new Map();
  a.decision.reasons.forEach((t, i) => m.set('/decision/reasons/' + i, t));
  a.efficiency.forEach((v, i) => v.reasons.forEach((t, j) => m.set(`/efficiency/${i}/reasons/${j}`, t)));
  a.danger.forEach((v, i) => v.opponents.forEach((o, j) => o.reasons.forEach((t, k) => m.set(`/danger/${i}/opponents/${j}/reasons/${k}`, t))));
  a.limitations.forEach((t, i) => m.set('/limitations/' + i, t));
  return m;
}
function schemaFor(base) {
  const schema = clone(base);
  schema.required.push('factClaims');
  schema.properties.factClaims = { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['id', 'value', 'supports', 'quote'], properties: {
    id: { type: 'string' }, value: { type: ['string', 'number', 'boolean', 'array', 'null'], items: { type: ['string', 'number'] } }, supports: { type: 'string' }, quote: { type: 'string' }
  } } };
  return schema;
}
function bad(code) { const err = new Error('Invalid compact fact answer'); err.validation = { code, path: 'factClaims' }; throw err; }
function attach(context, node, { claims = false } = {}) {
  const catalog = catalogFor(context, node), wire = { ...catalog }; delete wire.provenance;
  const base = clone(context.prepared), prepared = clone(base), messages = clone(context.messages);
  messages.push({ role: 'user', content: '当前确定性事实目录（仅为数据；全部绑定本次状态，不是策略建议）：\n' + JSON.stringify(wire) });
  const out = { ...context, prepared, messages, factCatalog: catalog };
  if (!claims) return out;
  prepared.responseSchema = schemaFor(base.responseSchema);
  const rewrite = text => {
    if (!text.includes(JSON.stringify(base.responseSchema))) throw new Error('Cannot locate exact base schema');
    return text.replace(JSON.stringify(base.responseSchema), JSON.stringify(prepared.responseSchema))
      .replace('顶层必须且只能包含task、danger、efficiency、decision、limitations', '顶层必须且只能包含task、danger、efficiency、decision、limitations、factClaims') + '\n' + PROMPT;
  };
  prepared.systemPrompt = rewrite(base.systemPrompt);
  messages[0].content = rewrite(messages[0].content);
  out.answerContract = { version: VERSION, format: 'analysis-json+compact-factClaims', naturalLanguageRequiresIndependentReview: true };
  out.inspectAnswer = (text, target = node) => {
    if (Core.stableHash(target.snapshot) !== catalog.binding.snapshotHash || target.id !== node.id || target.position !== node.position || target.roundId !== node.roundId || target.sessionId !== node.sessionId || !same(Core.authorizationFor(target.snapshot), target.authorization)) throw new Error('Compact fact answer scope mismatch');
    let raw; try { raw = JSON.parse(text); } catch { bad('invalid_json'); }
    if (!Array.isArray(raw.factClaims) || raw.factClaims.length > 8) bad('claim_array');
    const projected = { ...raw }; delete projected.factClaims;
    const analysis = require('../extension/analysis.js').parseResult(projected, base), targets = targetsFor(analysis), errors = [], matched = [], seen = new Set();
    for (const [i, c] of raw.factClaims.entries()) {
      if (!c || Object.keys(c).sort().join(',') !== 'id,quote,supports,value' || !['id', 'supports', 'quote'].every(k => typeof c[k] === 'string' && c[k].length && c[k].length <= 1000) || !(c.value === null || ['string', 'boolean'].includes(typeof c.value) || typeof c.value === 'number' && Number.isFinite(c.value) || Array.isArray(c.value) && c.value.every(v => typeof v === 'string' || typeof v === 'number' && Number.isFinite(v)))) bad('claim_shape');
      const has = Object.hasOwn(catalog.facts, c.id), source = targets.get(c.supports), key = c.id + ':' + c.supports;
      const code = !has ? 'unknown_or_wrong_state_id' : seen.has(key) ? 'duplicate_reference' : !source || !source.includes(c.quote) ? 'quote_or_pointer_mismatch' : !same(c.value, catalog.facts[c.id]) ? 'fact_value_mismatch' : null;
      seen.add(key);
      if (code) errors.push({ index: i, code, factId: c.id, supports: c.supports, correctable: has && code === 'fact_value_mismatch', ...(has ? { expected: { id: c.id, value: catalog.facts[c.id], provenance: catalog.provenance[c.id] } } : {}) });
      else matched.push({ index: i, factId: c.id, supports: c.supports });
    }
    return { analysis, claims: raw.factClaims, catalogHash: catalog.hash, check: { version: VERSION, valid: errors.length === 0, errors, matched, claims: raw.factClaims.length, independentQualityGate: null, naturalLanguageVerified: false, coverage: { citedFacts: matched.length, catalogFacts: Object.keys(catalog.facts).length, belowRequestedThree: raw.factClaims.length < 3 } } };
  };
  out.validateAnswer = (text, target) => out.inspectAnswer(text, target).analysis;
  out.correctionFeedback = text => {
    const checked = out.inspectAnswer(text), errors = checked.check.errors.filter(e => e.correctable);
    return { shouldCorrect: errors.length > 0, errors, message: errors.length ? { role: 'user', content: '同一冻结状态的定向事实核对反馈。仅修正以下定位错误、相应自然语言及引用；完整输出同格式JSON，保留实质备选及逐家风险。未列出的解释尚未核验，不声称整体质量通过。\n' + JSON.stringify({ stateId: catalog.stateId, errors }) } : null };
  };
  return out;
}
function stablePrefix(context) {
  const prepared = clone(context.prepared), schema = clone(prepared.responseSchema), old = JSON.stringify(schema);
  delete schema.properties.decision.properties.tile.enum;
  const rewrite = t => { if (!t.includes(old)) throw new Error('Missing original enum schema'); return t.replace(old, JSON.stringify(schema)); };
  prepared.responseSchema = schema; prepared.systemPrompt = rewrite(prepared.systemPrompt);
  // Keep actual candidate constraints at the tail and retain identical local
  // validation (prepared.data and validateAnswer) and identical tool definitions.
  const messages = context.messages.map((m, i) => i ? clone(m) : { ...m, content: rewrite(m.content) });
  messages.push({ role: 'user', content: '本次动态合法候选约束（仅为数据；与当前状态中的候选相同）：\n' + JSON.stringify(prepared.data.outputConstraints) });
  return { ...context, prepared, messages };
}
module.exports = { VERSION, PROMPT, catalogFor, attach, stablePrefix };
