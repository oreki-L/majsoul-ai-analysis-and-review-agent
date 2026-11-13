'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Analysis = require('../extension/analysis.js');
const Snapshot = require('../extension/contracts/snapshot.js');
const { fixture } = require('../agent/eval.cjs');
const { authorizationFor } = require('../benchmark/core.cjs');
const F = require('../benchmark/fact-citations.cjs');

function setup(change = () => {}, allowed) {
  const raw = fixture('123m123p123s111z22z'); raw.lastStep = 7; change(raw);
  const snapshot = Snapshot.cleanSnapshot(raw), prepared = Analysis.prepare(snapshot, 'combined');
  const legal = allowed ?? prepared.data.outputConstraints.legalDiscards;
  prepared.data.outputConstraints.legalDiscards = legal;
  if (prepared.data.localAnalysis.efficiency?.candidates) prepared.data.localAnalysis.efficiency.candidates = prepared.data.localAnalysis.efficiency.candidates.filter(c => legal.includes(c.tile));
  const node = { id: 'decision-' + snapshot.lastStep, roundId: 'synthetic-east1', sessionId: 'synthetic-match', position: snapshot.lastStep, snapshot, authorization: authorizationFor(snapshot), legalActions: legal.map(tile => ({ action: 'discard', tile })) };
  const context = { snapshot, events: [], prepared, messages: [{ role: 'system', content: prepared.systemPrompt }, { role: 'user', content: JSON.stringify({ current: snapshot }) }] };
  return { node, context, typed: F.withFactCitations(context, node) };
}
function answer(typed, claims = [], overrides = {}) {
  return { task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: typed.prepared.data.outputConstraints.legalDiscards[0] ?? null, reasons: ['以当前效率推进；对手风险信息不足。'] }, limitations: [], factClaims: claims, ...overrides };
}
function claimFor(fact, overrides = {}) {
  const { factId, stateId, kind, sourceId, path, subjectTile, subjectSeat, value } = fact;
  return { factId, stateId, kind, sourceId, path, subjectTile, subjectSeat, value, supports: '/decision/reasons/0', ...overrides };
}
function pick(typed, kind, where = () => true) {
  const fact = typed.factCatalog.facts.find(f => f.kind === kind && where(f));
  assert.ok(fact, 'fixture should provide ' + kind); return fact;
}
function inspect(typed, value) { return typed.inspectAnswer(JSON.stringify(value)); }

test('typed contract preserves ordinary answer, legal validation, prose, and independent review boundary', () => {
  const { typed, node, context } = setup(), before = JSON.stringify(context.prepared);
  const fact = pick(typed, 'candidate-shanten'), value = answer(typed, [claimFor(fact)]);
  const result = inspect(typed, value);
  assert.equal(result.check.valid, true); assert.equal(result.check.matched.length, 1);
  assert.equal(result.check.independentQualityGate, null); assert.equal(result.check.naturalLanguageVerified, false);
  assert.equal(JSON.stringify(context.prepared), before);
  assert.deepEqual(typed.validateAnswer(JSON.stringify(value)), result.analysis);
  assert.equal(result.analysis.decision.reasons[0], value.decision.reasons[0]);
  assert.equal(result.analysis.factClaims, undefined);
  assert.deepEqual(Analysis.parseResult(result.analysis, context.prepared), result.analysis);
  assert.deepEqual(typed.factCatalog.binding, { decisionId: node.id, roundId: node.roundId, sessionId: node.sessionId, position: 7,
    snapshotHash: typed.factCatalog.binding.snapshotHash, authorizationHash: typed.factCatalog.binding.authorizationHash });
  assert.ok(typed.prepared.responseSchema.required.includes('factClaims'));
  assert.equal(typed.prepared.responseSchema.additionalProperties, false);
  assert.match(typed.messages.at(-1).content, /factId/);
});

test('incorrect deterministic number remains an evaluable W-C draft and produces scoped correction feedback', () => {
  const { typed } = setup(), fact = pick(typed, 'candidate-shanten');
  const value = answer(typed, [claimFor(fact, { value: fact.value + 2 })]);
  const result = inspect(typed, value);
  assert.equal(result.check.valid, false);
  assert.equal(result.check.errors[0].code, 'fact_value_mismatch');
  assert.doesNotThrow(() => typed.validateAnswer(JSON.stringify(value)), 'fact error must not trigger structural repair');
  const feedback = typed.correctionFeedback(JSON.stringify(value));
  assert.equal(feedback.shouldCorrect, true); assert.equal(feedback.errors[0].expected.value, fact.value);
  assert.match(feedback.message.content, /同一冻结状态/);
  assert.doesNotMatch(feedback.message.content, /maka|preferred|qualityScore|apiKey/i);
});

test('binding refuses cross-decision/cross-time/cross-seat references and preserves red-five identity', () => {
  const { typed } = setup(s => { s.selfHand[0] = '0m'; s.selfDrawnTile = '0m'; });
  const red = pick(typed, 'hand-tile', f => f.value === '0m');
  for (const [patch, expected] of [[{ stateId: 'old-state' }, 'stateId_mismatch'], [{ subjectSeat: 1 }, 'subjectSeat_mismatch'], [{ subjectTile: '5m' }, 'subjectTile_mismatch'], [{ value: '5m' }, 'fact_value_mismatch'], [{ sourceId: 'other-source' }, 'sourceId_mismatch']]) {
    const result = inspect(typed, answer(typed, [claimFor(red, patch)]));
    assert.equal(result.check.errors[0].code, expected);
  }
  const other = setup(s => { s.lastStep = 8; });
  assert.notEqual(other.typed.factCatalog.stateId, typed.factCatalog.stateId);
  assert.throws(() => F.createFactCatalog({ ...other.node, position: 7 }, other.context.prepared), /cutoff/);
  assert.throws(() => typed.validateAnswer(JSON.stringify(answer(typed)), other.node), /another frozen decision/);
});

test('unknown has an explicit null assertion; absent river is not known non-genbutsu', () => {
  const { typed } = setup(s => { s.rivers = s.rivers.filter(r => r.seat !== 2); });
  const unknown = pick(typed, 'genbutsu', f => f.subjectSeat === 2);
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.value, null);
  const honest = inspect(typed, answer(typed, [claimFor(unknown)]));
  assert.equal(honest.check.valid, true); assert.equal(honest.check.unknown.length, 1);
  assert.equal(typed.correctionFeedback(JSON.stringify(answer(typed, [claimFor(unknown)]))).shouldCorrect, false);
  const falseClaim = inspect(typed, answer(typed, [claimFor(unknown, { value: false })]));
  assert.equal(falseClaim.check.errors[0].code, 'unavailable_fact_asserted');
});

test('authorization omissions cannot restore hand, scores, rivers or calculation facts', () => {
  const { typed } = setup(s => { delete s.selfHand; delete s.game; s.rivers = [s.rivers[1]]; });
  assert.ok(!typed.factCatalog.facts.some(f => ['hand-tile', 'hand-size', 'score', 'dealer-seat', 'remaining', 'river-tile'].includes(f.kind)));
  assert.ok(typed.factCatalog.facts.filter(f => f.kind === 'current-shanten').every(f => f.value === null && f.status === 'unknown'));
  assert.doesNotMatch(JSON.stringify(typed.factCatalog), /25000/);
  const forged = { ...setup().typed.factCatalog.facts.find(f => f.kind === 'hand-tile') };
  const result = inspect(typed, answer(typed, [claimFor(forged)]));
  assert.equal(result.check.errors[0].code, 'unknown_fact_reference');
  assert.equal(typed.correctionFeedback(JSON.stringify(answer(typed, [claimFor(forged)]))).shouldCorrect, false);
});

test('forged paths, prototype pointers and unrelated output fields are not executed', () => {
  const { typed } = setup(), f = pick(typed, 'current-shanten');
  const badPath = answer(typed, [claimFor(f, { path: '/__proto__/polluted' })]);
  assert.equal(inspect(typed, badPath).check.errors[0].code, 'path_mismatch');
  const badTarget = answer(typed, [claimFor(f, { supports: '/constructor/prototype/polluted' })]);
  assert.equal(inspect(typed, badTarget).check.errors[0].code, 'unsupported_answer_pointer');
  assert.equal(typed.correctionFeedback(JSON.stringify(badTarget)).shouldCorrect, false);
  assert.equal({}.polluted, undefined);
});

test('citation target checks hard tile/seat values but does not pretend to verify natural prose', () => {
  const { typed } = setup(), tile = pick(typed, 'hand-tile', f => f.value !== typed.prepared.data.outputConstraints.legalDiscards[0]);
  const mismatch = inspect(typed, answer(typed, [claimFor(tile, { supports: '/decision/tile' })]));
  assert.equal(mismatch.check.errors[0].code, 'assertion_target_mismatch');
  const prose = answer(typed, [claimFor(tile)]);
  prose.decision.reasons[0] = '这是没有证据的自由牌理和错误牌名复述，必须交给独立评审。';
  const result = inspect(typed, prose);
  assert.equal(result.check.valid, true); assert.equal(result.check.naturalLanguageVerified, false);
  assert.equal(result.analysis.decision.reasons[0], prose.decision.reasons[0]);
});

test('duplicate citations, malformed typed schema, and illegal projected discards remain visible', () => {
  const { typed } = setup(undefined, ['1m']), f = pick(typed, 'current-shanten'), claim = claimFor(f);
  assert.equal(inspect(typed, answer(typed, [claim, claim])).check.errors[0].code, 'duplicate_fact_reference');
  const malformed = answer(typed); delete malformed.factClaims;
  assert.throws(() => typed.validateAnswer(JSON.stringify(malformed)), e => e.validation.code === 'typed_result_fields');
  const illegal = answer(typed); illegal.decision.tile = '2m';
  assert.throws(() => typed.validateAnswer(JSON.stringify(illegal)), e => ['illegal_decision_tile', 'constrained_legal_action'].includes(e.validation?.code));
  const extra = answer(typed, [{ ...claim, __extra: 'no' }]);
  assert.throws(() => typed.validateAnswer(JSON.stringify(extra)), e => e.validation.code === 'fact_claim_format');
});

test('catalog is immutable, deterministic, and rejects altered computations or authorization', () => {
  const { node, context, typed } = setup();
  assert.equal(F.createFactCatalog(node, context.prepared).hash, typed.factCatalog.hash);
  assert.throws(() => { typed.factCatalog.facts[0].value = 99; }, TypeError);
  const tampered = structuredClone(typed.factCatalog); tampered.facts[0].value = 99;
  assert.throws(() => F.validateCitations({ analysis: answer(typed), claims: [] }, tampered), /integrity/);
  const wrong = structuredClone(context.prepared); wrong.data.localAnalysis.efficiency.shanten = 10;
  assert.throws(() => F.createFactCatalog(node, wrong), /calculations differ/);
  assert.throws(() => F.createFactCatalog({ ...node, authorization: { selfHand: false } }, context.prepared), /authorization/);
});

test('paired adapter uses one shared draft, only corrects located facts, and never double-charges base', async () => {
  const { node, typed } = setup(), f = pick(typed, 'candidate-shanten'), calls = [], events = [];
  const first = JSON.stringify(answer(typed, [claimFor(f, { value: f.value + 1 })]));
  const final = JSON.stringify(answer(typed, [claimFor(f)]));
  let clock = 0;
  const result = await F.runCitationPair({ context: typed, node, now: () => clock, deadlineAt: 100,
    call: async args => { calls.push(args); clock += 10; return { text: calls.length === 1 ? first : final, cost: calls.length === 1 ? .03 : .02 }; },
    record: async event => events.push(event) });
  assert.deepEqual(calls.map(c => c.role), ['initial', 'evidence-correction']);
  assert.equal(result.W_C.check.valid, false); assert.equal(result.W_V.check.valid, true);
  assert.equal(result.comparison.fixed.length, 1); assert.equal(result.comparison.introduced.length, 0);
  assert.equal(result.accounting.actualCombinedCost, .05); assert.equal(result.accounting.sharedBaseCost, .03);
  assert.deepEqual(result.accounting.standalone, { W_C: .03, W_V: .05 });
  assert.equal(result.accounting.additiveAcrossBranches, false);
  assert.equal(result.elapsedMs, 20); assert.equal(result.independentQualityGate, null);
  assert.equal(events.length, 2); assert.equal(events[0].text, first);
  assert.ok(calls[1].messages.some(m => m.role === 'assistant' && m.content === first));
});

test('paired adapter reuses a persisted draft verbatim and sends no correction for matching or unknown facts', async () => {
  const { node, typed } = setup();
  const text = JSON.stringify(answer(typed));
  const result = await F.runCitationPair({ context: typed, node, draft: { text, cost: .04 }, deadlineAt: 100, now: () => 1,
    call: async () => { throw new Error('must not call'); } });
  assert.equal(result.W_V.status, 'unchanged'); assert.equal(result.W_V.rawText, text);
  assert.equal(result.correctionRequested, false); assert.equal(result.accounting.actualCombinedCost, .04);
});

test('paired adapter retains new errors, uses original deadline, and preserves failed corrections', async () => {
  const { node, typed } = setup(), f = pick(typed, 'current-shanten'), second = pick(typed, 'candidate-shanten');
  const draft = { text: JSON.stringify(answer(typed, [claimFor(f, { value: 99 })])), cost: .01 };
  const result = await F.runCitationPair({ context: typed, node, draft, deadlineAt: 100, now: () => 1,
    call: async () => ({ text: JSON.stringify(answer(typed, [claimFor(f), claimFor(second, { value: 99 })])), cost: .02 }) });
  assert.equal(result.comparison.fixed.length, 1); assert.equal(result.comparison.introduced.length, 1);
  assert.equal(result.W_V.check.valid, false);
  let clock = 1;
  const late = await F.runCitationPair({ context: typed, node, draft, deadlineAt: 10, now: () => clock,
    call: async () => { clock = 11; return { text: draft.text, cost: .02 }; } });
  assert.equal(late.W_V.status, 'failed'); assert.equal(late.W_V.analysis, null);
  assert.equal(late.accounting.actualCombinedCost, .03);
  assert.equal(late.draft.response.text, draft.text);
});

test('unknown usage is not silently replaced by zero fee', () => {
  assert.equal(F.pairAccounting({ cost: null }, { cost: .02 }).actualCombinedCost, null);
  assert.equal(F.pairAccounting({ cost: .02 }, { cost: null }).actualCombinedCost, null);
  assert.equal(F.pairAccounting({ cost: .02 }, null).actualCombinedCost, .02);
  assert.equal(F.pairAccounting({ cost: .02 }, null, { correctionAttempted: true }).actualCombinedCost, null);
});

test('rules after the original schema are retained and the five-field sentence is updated', () => {
  const { node, context } = setup();
  context.messages[0].content = '顶层必须且只能包含task、danger、efficiency、decision、limitations。\n' + context.messages[0].content + '\nTAIL_AUTHORIZATION_RULE';
  const typed = F.withFactCitations(context, node);
  assert.match(typed.messages[0].content, /TAIL_AUTHORIZATION_RULE/);
  assert.match(typed.messages[0].content, /limitations、factClaims。/);
  assert.equal(typed.messages[0].content.split('输出JSON Schema：').length, 2);
});

test('failed correction costs stay unknown and persistence failure is never swallowed', async () => {
  const { node, typed } = setup(), f = pick(typed, 'current-shanten');
  const draft = { text: JSON.stringify(answer(typed, [claimFor(f, { value: 99 })])), cost: .01 };
  const failed = await F.runCitationPair({ context: typed, node, draft, deadlineAt: 100, now: () => 1,
    call: async () => { throw new Error('network failed after dispatch'); } });
  assert.equal(failed.W_V.status, 'failed'); assert.equal(failed.accounting.correctionIncrementCost, null);
  assert.equal(failed.accounting.actualCombinedCost, null);
  await assert.rejects(F.runCitationPair({ context: typed, node, draft, deadlineAt: 100, now: () => 1,
    call: async () => ({ text: JSON.stringify(answer(typed, [claimFor(f)])), cost: .02 }),
    record: async e => { if (e.kind === 'citation-correction') throw new Error('disk save failed'); } }), /disk save failed/);
});
