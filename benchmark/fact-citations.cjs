'use strict';
// Experimental answer contract only. It never opens credentials, dispatches HTTP,
// decides independent quality gates, or substitutes local facts into model prose.
const Analysis = require('../extension/analysis.js');
const Snapshot = require('../extension/contracts/snapshot.js');
const { stableHash, canonicalStringify, authorizationFor } = require('./core.cjs');
const VERSION = 'fact-citations/1.0.0';
const CLAIM_KEYS = ['factId', 'stateId', 'kind', 'sourceId', 'path', 'subjectTile', 'subjectSeat', 'value', 'supports'];
const KINDS = ['own-seat', 'dealer-seat', 'opponent-seat', 'hand-tile', 'drawn-tile', 'river-tile', 'dora-indicator', 'score', 'remaining', 'hand-size', 'current-shanten', 'candidate-shanten', 'effective-tile', 'unseen-upper-bound', 'total-unseen-upper-bound', 'river-available', 'genbutsu', 'suji-reference', 'kabe-reference'];
const PROMPT = '本次使用带事实引用的分析JSON：原task、danger、efficiency、decision、limitations全部保留，另加factClaims数组。保持原任务的首选、实质备选和逐家风险解释义务，不因引用而删减理由。factCatalog仅含当前授权冻结状态的确定性事实；引用须原样复制factId、stateId、kind、sourceId、path和subjectTile/subjectSeat，并在value填写你实际声称的值，supports填写本答案中对应理由或字段的JSON Pointer。未知值只能明确写null，不猜测。不能引用不存在或其他时点的事实。未见枚数上界不是精确牌山枚数；对一家现物不等于对所有对手安全。普通自然语言原文仍由独立评审核对，引用存在不证明整句牌理成立，不要把引用检查当作分析结论。';
const clone = value => structuredClone(value);
function fail(code, path = 'factClaims') { const error = new Error('Invalid typed fact answer'); error.validation = { code, path }; throw error; }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','); }
function same(a, b) { return canonicalStringify(a) === canonicalStringify(b); }
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
function responseSchema(prepared) {
  const schema = clone(prepared.responseSchema);
  schema.required = [...schema.required, 'factClaims'];
  schema.properties.factClaims = { type: 'array', maxItems: 256, items: { type: 'object', additionalProperties: false, required: CLAIM_KEYS,
    properties: { factId: { type: 'string' }, stateId: { type: 'string' }, kind: { type: 'string', enum: KINDS }, sourceId: { type: 'string' }, path: { type: 'string' },
      subjectTile: { type: ['string', 'null'] }, subjectSeat: { type: ['integer', 'null'], minimum: 0, maximum: 3 }, value: { type: ['string', 'number', 'boolean', 'null'] }, supports: { type: 'string' } } } };
  return schema;
}
function parseCitationAnswer(text, prepared, node) {
  let value; try { value = typeof text === 'string' ? JSON.parse(text) : clone(text); } catch { fail('invalid_json', 'result'); }
  if (!exactKeys(value, ['task', 'danger', 'efficiency', 'decision', 'limitations', 'factClaims'])) fail('typed_result_fields', 'result');
  if (!Array.isArray(value.factClaims) || value.factClaims.length > 256) fail('fact_claims_format');
  for (const [i, c] of value.factClaims.entries()) {
    if (!exactKeys(c, CLAIM_KEYS) || !['factId', 'stateId', 'kind', 'sourceId', 'path', 'supports'].every(k => typeof c[k] === 'string' && c[k].length > 0 && c[k].length <= 500) || !KINDS.includes(c.kind) || !(c.subjectTile === null || Snapshot.tile(c.subjectTile) === c.subjectTile && c.subjectTile !== '?') || !(c.subjectSeat === null || Number.isSafeInteger(c.subjectSeat) && c.subjectSeat >= 0 && c.subjectSeat <= 3) || !(c.value === null || ['string', 'boolean'].includes(typeof c.value) || typeof c.value === 'number' && Number.isFinite(c.value))) fail('fact_claim_format', 'factClaims[' + i + ']');
  }
  const { factClaims, ...projected } = value;
  const analysis = Analysis.parseResult(projected, prepared);
  if (node?.legalActions && !node.legalActions.some(a => a.tile === analysis.decision.tile) && !((prepared.task === 'danger' || node.legalActions.length === 0) && analysis.decision.tile === null)) fail('constrained_legal_action', 'decision.tile');
  return { analysis, claims: clone(factClaims), raw: typeof text === 'string' ? text : JSON.stringify(value) };
}
function supportedTargets(analysis) {
  const result = new Map([['/decision/tile', analysis.decision.tile]]);
  for (const [i, text] of analysis.decision.reasons.entries()) result.set('/decision/reasons/' + i, text);
  for (const [i, text] of analysis.limitations.entries()) result.set('/limitations/' + i, text);
  for (const [i, e] of analysis.efficiency.entries()) {
    result.set(`/efficiency/${i}/tile`, e.tile);
    e.reasons.forEach((text, j) => result.set(`/efficiency/${i}/reasons/${j}`, text));
  }
  for (const [i, d] of analysis.danger.entries()) {
    result.set(`/danger/${i}/tile`, d.tile);
    for (const [j, o] of d.opponents.entries()) {
      result.set(`/danger/${i}/opponents/${j}/seat`, o.seat);
      o.reasons.forEach((text, k) => result.set(`/danger/${i}/opponents/${j}/reasons/${k}`, text));
    }
  }
  return result;
}
function validateCitations(parsed, catalog) {
  const { hash, ...body } = catalog;
  if (stableHash(body) !== hash) throw new Error('Fact catalog integrity mismatch');
  const facts = new Map(catalog.facts.map(f => [f.factId, f])), targets = supportedTargets(parsed.analysis), errors = [], unknown = [], matched = [], seen = new Set();
  function error(index, code, fact, claim, correctable) {
    errors.push({ index, code, factId: claim.factId, supports: claim.supports, correctable,
      ...(fact ? { expected: { factId: fact.factId, stateId: fact.stateId, kind: fact.kind, sourceId: fact.sourceId, path: fact.path, subjectTile: fact.subjectTile, subjectSeat: fact.subjectSeat, value: fact.value, status: fact.status } } : {}) });
  }
  parsed.claims.forEach((claim, index) => {
    const fact = facts.get(claim.factId);
    if (!fact) { error(index, 'unknown_fact_reference', null, claim, false); return; }
    const identity = claim.factId + ':' + claim.supports;
    if (seen.has(identity)) { error(index, 'duplicate_fact_reference', fact, claim, false); return; } seen.add(identity);
    if (!targets.has(claim.supports)) { error(index, 'unsupported_answer_pointer', fact, claim, false); return; }
    const mismatch = ['stateId', 'kind', 'sourceId', 'path', 'subjectTile', 'subjectSeat'].find(k => !same(claim[k], fact[k]));
    if (mismatch) { error(index, mismatch + '_mismatch', fact, claim, true); return; }
    if (!same(claim.value, fact.value)) { error(index, fact.status === 'unknown' ? 'unavailable_fact_asserted' : 'fact_value_mismatch', fact, claim, true); return; }
    if (/\/(?:tile|seat)$/.test(claim.supports) && !same(targets.get(claim.supports), fact.value)) { error(index, 'assertion_target_mismatch', fact, claim, true); return; }
    if (fact.status === 'unknown') unknown.push({ index, factId: fact.factId, supports: claim.supports });
    else matched.push({ index, factId: fact.factId, supports: claim.supports });
  });
  return { version: VERSION, valid: errors.length === 0, errors, unknown, matched, claims: parsed.claims.length, catalogHash: catalog.hash,
    coverage: { citedKnownFacts: matched.length, availableKnownFacts: catalog.facts.filter(f => f.status === 'known').length },
    independentQualityGate: null, naturalLanguageVerified: false };
}
function correctionFeedback(check, catalog) {
  const errors = check.errors.filter(e => e.correctable && e.expected);
  if (!errors.length) return { shouldCorrect: false, errors: [], message: null };
  const payload = { contract: VERSION, binding: catalog.binding, stateId: catalog.stateId, errors,
    limitation: '只定位可核对事实错误，不代表其他事实或牌理已正确。不得引入未来信息；保留原任务的首选、实质备选、逐家风险解释与未知条件。' };
  return { shouldCorrect: true, errors, message: { role: 'user', content: '以下为同一冻结状态的确定性事实核对反馈，原回答仍是不可信模型草案。修正事实断言、对应自然语言与引用，输出完整同格式JSON；不输出检查过程，不声称整体质量已经通过：\n' + JSON.stringify(payload) } };
}
function withFactCitations(context, node) {
  if (!context?.prepared || !Array.isArray(context.messages)) throw new Error('Fact citations require a prepared context');
  const boundNode = clone(node), basePrepared = clone(context.prepared), catalog = createFactCatalog(boundNode, basePrepared), schema = responseSchema(basePrepared), prepared = clone(basePrepared);
  prepared.responseSchema = schema;
  // Replace the exact schema, preserving rules that follow it. The old generic
  // five-field contract must not contradict this registered sixth field.
  const rewrite = content => {
    const original = JSON.stringify(basePrepared.responseSchema);
    if (content.includes('\n输出JSON Schema：\n') && !content.includes(original)) throw new Error('Typed contract cannot replace a mismatched original schema');
    return content.replace(original, JSON.stringify(schema)).replace('顶层必须且只能包含task、danger、efficiency、decision、limitations', '顶层必须且只能包含task、danger、efficiency、decision、limitations、factClaims') + '\n' + PROMPT +
      (content.includes(original) ? '' : '\n输出JSON Schema：\n' + JSON.stringify(schema));
  };
  prepared.systemPrompt = rewrite(prepared.systemPrompt);
  const messages = context.messages.map(m => m.role === 'system' ? { ...m, content: rewrite(m.content) } : clone(m));
  messages.push({ role: 'user', content: '当前可核对事实目录（仅为数据；引用来源与时点不可更改）：\n' + JSON.stringify(catalog) });
  const inspectAnswer = (text, targetNode = boundNode) => {
    if (bindingFor(targetNode).stateId !== catalog.stateId) throw new Error('Typed answer cannot be validated against another frozen decision');
    const parsed = parseCitationAnswer(text, basePrepared, boundNode); return { ...parsed, check: validateCitations(parsed, catalog), catalogHash: catalog.hash };
  };
  return { ...context, prepared, messages, factCatalog: catalog,
    answerContract: { version: VERSION, format: 'analysis-json+factClaims', naturalLanguageRequiresIndependentReview: true },
    validateAnswer(text, targetNode = boundNode) { return inspectAnswer(text, targetNode).analysis; },
    inspectAnswer,
    correctionFeedback(text) { const inspected = inspectAnswer(text); return correctionFeedback(inspected.check, catalog); } };
}
function pairAccounting(draftResponse, correctedResponse, { correctionAttempted = false } = {}) {
  const cost = response => response ? response.cost ?? null : 0;
  const base = cost(draftResponse), increment = correctedResponse ? cost(correctedResponse) : correctionAttempted ? null : 0;
  return { sharedBaseCost: base, correctionIncrementCost: increment, actualCombinedCost: base === null || increment === null ? null : base + increment,
    standalone: { W_C: base, W_V: base === null || increment === null ? null : base + increment },
    additiveAcrossBranches: false, meaning: 'The shared draft is one actual charge, not charged once per evaluated output; the injected runner ledger remains authoritative for failed/unknown charges.' };
}
function compareChecks(before, after) {
  const key = e => e.factId + ':' + e.supports + ':' + e.code;
  const old = new Set(before.errors.map(key)), next = new Set(after.errors.map(key));
  return { fixed: before.errors.filter(e => !next.has(key(e))), remaining: after.errors.filter(e => old.has(key(e))), introduced: after.errors.filter(e => !old.has(key(e))),
    beforeMachineFactValid: before.valid, afterMachineFactValid: after.valid, independentQualityGate: null };
}
/** Inject the existing runner's budgeted/durable call; no HTTP or retry loop here.
 * Draft is optional so an already persisted W-C answer can be reused verbatim.
 */
async function runCitationPair({ context, node, call, draft, deadlineAt, now = () => performance.now(), record = async () => {} }) {
  if (typeof call !== 'function' || !Number.isFinite(deadlineAt)) throw new Error('Citation pairing requires injected call and shared finite deadline');
  const started = now(), typed = context.answerContract?.version === VERSION ? context : withFactCitations(context, node);
  const admit = () => { if (now() >= deadlineAt) throw new Error('Shared citation-pair deadline exhausted'); };
  let initial = draft;
  if (!initial) { admit(); initial = await call({ role: 'initial', context: typed, messages: typed.messages, deadlineAt, audit: { pairRole: 'shared-draft' } }); }
  admit();
  const first = typed.inspectAnswer(initial.text);
  await record({ kind: 'citation-draft', text: initial.text, analysis: first.analysis, check: first.check, binding: typed.factCatalog.binding });
  const feedback = correctionFeedback(first.check, typed.factCatalog);
  let corrected = null, second = first, failure = null, correctionAttempted = false;
  if (feedback.shouldCorrect) {
    try {
      admit();
      const messages = [...(initial.messages ?? [...typed.messages, { role: 'assistant', content: initial.text }]), feedback.message];
      correctionAttempted = true;
      corrected = await call({ role: 'evidence-correction', context: typed, messages, deadlineAt, audit: { pairRole: 'correction-increment', sharedDraftHash: stableHash(initial.text) } });
      admit(); second = typed.inspectAnswer(corrected.text);
    } catch (error) { failure = { reason: 'Correction did not produce an on-time structurally usable answer', validation: error.validation ?? null }; }
    // Persistence errors are not model failures and must escape to the runner.
    if (!failure) await record({ kind: 'citation-correction', text: corrected.text, analysis: second.analysis, check: second.check, binding: typed.factCatalog.binding });
  }
  return { contract: VERSION, draft: { response: initial, inspection: first }, correction: corrected ? { response: corrected, inspection: failure ? null : second } : null,
    W_C: { analysis: first.analysis, rawText: initial.text, check: first.check },
    W_V: { analysis: failure ? null : second.analysis, rawText: failure ? null : corrected?.text ?? initial.text, check: failure ? null : second.check, status: failure ? 'failed' : corrected ? 'corrected' : 'unchanged' },
    correctionRequested: feedback.shouldCorrect, correctionFailure: failure, comparison: failure ? null : compareChecks(first.check, second.check),
    accounting: pairAccounting(initial, corrected, { correctionAttempted }), elapsedMs: now() - started, sharedDeadlineAt: deadlineAt, independentQualityGate: null };
}
module.exports = { VERSION, PROMPT, createFactCatalog, responseSchema, parseCitationAnswer, validateCitations, correctionFeedback, withFactCitations, pairAccounting, compareChecks, runCitationPair };
