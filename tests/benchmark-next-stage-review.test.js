'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../agent/eval.cjs');
const Snapshot = require('../extension/contracts/snapshot.js');
const Analysis = require('../extension/analysis.js');
const { stableHash, authorizationFor } = require('../benchmark/core.cjs');
const Review = require('../benchmark/next-stage-review.cjs');
function node(position = 7, change = () => {}) {
  const raw = fixture('123m123p123s111z22z'); raw.lastStep = position; change(raw);
  const snapshot = Snapshot.cleanSnapshot(raw);
  return { id: 'd-' + position, roundId: 'east1', sessionId: 'match1', position, snapshot, authorization: authorizationFor(snapshot),
    legalActions: Analysis.prepare(snapshot, 'combined').data.outputConstraints.legalDiscards.map(tile => ({ action: 'discard', tile })),
    decisionContext: { phase: 'draw', actor: snapshot.selfSeat, triggerPosition: position, rulesSource: 'fixture' } };
}
function job(overrides = {}) { return { blindId: 'blind1', sourceHash: 'src1', rulesHash: stableHash(Review.RULES),
  packet: { answer: '首选1m；备选2m，效率与风险有差异，未见张数不是精确牌山。', rules: Review.RULES, facts: {}, ...overrides } }; }
function result(j = job()) { return { blindId: j.blindId, sourceHash: j.sourceHash, rulesHash: j.rulesHash, model: 'gpt-6-sol', reasoningEffort: 'medium',
  rubricVersion: Review.VERSION, target: 'final', gate: { pass: true, majorError: false, status: 'pass', reason: '首选、实质备选、效率风险及未知边界已满足。' },
  dimensions: Object.fromEntries(Review.DIMENSIONS.map(d => [d, { status: 'scored', score: 3, evidence: [{ quote: '首选1m', source: 'answer', reason: '本句与本维的核对依据。' }] }])),
  errors: [], uncertain: [] }; }
function error(severity = 'major') { return { severity, quote: '首选1m', expectedFact: '本节点约束与推荐不一致', evidenceSource: 'facts.legalActions', impact: '影响主决策', rootCause: 'wrong-current-state' }; }

test('frozen rubric retains v1.0.1 explicit gate and exact reviewer with six anchors', () => {
  const { validateReviewRules } = require('../benchmark/review.cjs');
  assert.equal(validateReviewRules(Review.RULES), Review.RULES);
  assert.ok(Object.isFrozen(Review.RULES.gate));
  assert.equal(Review.RULES.contractVersion, 'first-answer/1.0.1');
  assert.equal(Review.RULES.anchors.legal_comparison.length, 5);
  assert.match(Review.RULES.obligations.join('\n'), /机器事实引用匹配/);
  const j = job(), imported = Review.validateReviewResult(j, result(j));
  assert.equal(imported.gate, true); assert.equal(imported.gateStatus, 'pass'); assert.equal(imported.mean, 3);
});

test('empty major-error list never overrides explicit failed or needs-review gate', () => {
  const j = job(), r = result(j); r.gate = { pass: false, majorError: false, status: 'fail', reason: '缺乏实质合法备选比较' };
  assert.equal(Review.validateReviewResult(j, r).gate, false);
  r.gate.status = 'needs_review'; r.gate.reason = '缺证据，无法判断局部事实';
  r.uncertain = [{ issue: '缺少相应历史记录', affectsGate: true, reason: '涉及核心依据' }];
  const imported = Review.validateReviewResult(j, r);
  assert.equal(imported.gate, false); assert.equal(imported.gateStatus, 'needs_review');
  assert.equal(imported.gateDetails.reason, r.gate.reason);
  r.gate = { pass: true, majorError: false, status: 'pass', reason: '强行通过' };
  assert.throws(() => Review.validateReviewResult(j, r), /unresolved/);
});

test('unjudgable stays null, cannot inflate mean or quality gate', () => {
  const j = job(), r = result(j);
  r.gate = { pass: false, majorError: false, status: 'needs_review', reason: '无足够实质事实可核对' };
  r.dimensions.factual_accuracy = { status: 'not_judgable', score: null, evidence: [] };
  const imported = Review.validateReviewResult(j, r);
  assert.equal(imported.scores.factual_accuracy, null); assert.equal(imported.mean, null);
  assert.equal(imported.partialMean, 3); assert.equal(imported.scoredDimensionCount, 5);
  r.gate = { pass: true, majorError: false, status: 'pass', reason: '无错误' };
  assert.throws(() => Review.validateReviewResult(j, r), /unjudgable required/);
  r.dimensions.factual_accuracy.score = 4;
  assert.throws(() => Review.validateReviewResult(j, r), /must stay null/);
});

test('major and critical errors require explicit failure, bounded factual score and unique root cause', () => {
  const j = job(), r = result(j); r.errors = [error()];
  assert.throws(() => Review.validateReviewResult(j, r), /must fail/);
  r.gate = { pass: false, majorError: true, status: 'fail', reason: '客观重大错误' };
  assert.throws(() => Review.validateReviewResult(j, r), /score cap/);
  r.dimensions.factual_accuracy.score = 2;
  assert.equal(Review.validateReviewResult(j, r).gate, false);
  r.errors[0].severity = 'critical'; assert.throws(() => Review.validateReviewResult(j, r), /score cap/);
  r.dimensions.factual_accuracy.score = 1; assert.equal(Review.validateReviewResult(j, r).scores.factual_accuracy, 1);
  r.errors.push({ ...error(), quote: '备选2m' });
  assert.throws(() => Review.validateReviewResult(j, r), /duplicate independent root/);
});

test('review identity, target and every dimension/error quotation are source-bound', () => {
  const j = job();
  for (const patch of [{ model: 'gpt-6-sol-high' }, { reasoningEffort: 'high' }, { sourceHash: 'other' }, { rubricVersion: '1.0' }, { target: 'draft' }]) assert.throws(() => Review.validateReviewResult(j, { ...result(j), ...patch }), /mismatch/);
  const r = result(j); r.dimensions.usability.evidence[0].quote = '另一个回答';
  assert.throws(() => Review.validateReviewResult(j, r), /quote this answer/);
  const bad = result(j); bad.errors = [{ ...error('minor'), quote: '不存在句子' }];
  assert.throws(() => Review.validateReviewResult(j, bad), /not in answer/);
  const missing = result(j); delete missing.dimensions.calibration;
  assert.throws(() => Review.validateReviewResult(j, missing), /six dimensions/);
});

test('an undelivered final cannot pass and a draft cannot substitute for final', () => {
  const j = job({ delivered: false }); assert.throws(() => Review.validateReviewResult(j, result(j)), /undelivered/);
  const empty = job({ answer: '' }), r = result(empty);
  r.gate = { pass: false, majorError: false, status: 'fail', reason: '最终无可评文本' };
  for (const d of Review.DIMENSIONS) r.dimensions[d] = { status: 'not_judgable', score: null, evidence: [] };
  const imported = Review.validateReviewResult(empty, r); assert.equal(imported.mean, null); assert.equal(imported.gate, false);
  const draft = job({ target: 'draft', delivered: false }), valid = result(draft); valid.target = 'draft';
  assert.equal(Review.validateReviewResult(draft, valid).gate, true);
});

test('blind facts omit group prompts, past model opinions, correction verdicts and future state', () => {
  const current = node(), old = node(3), future = node(9), other = { ...node(2), roundId: 'south2' };
  const input = { node: current, messages: [{ role: 'system', content: 'secret scheme W-V' }, { role: 'assistant', content: 'old W-C answer' }], prepared: { factCatalog: { verdict: 'pass' } }, events: [] };
  const run = { requests: { old: { frozenInput: { node: old }, response: { text: 'prior model opinion' } }, future: { frozenInput: { node: future } }, other: { frozenInput: { node: other } } } };
  const facts = Review.buildBlindFacts(input, run), raw = JSON.stringify(facts);
  assert.doesNotMatch(raw, /W-V|W-C|prior model opinion|secret scheme|"factCatalog"|"verdict"/);
  assert.deepEqual(facts.historicalSnapshots.map(n => n.asOf), [3]);
  assert.equal(facts.asOf, 7); assert.ok(facts.localCalculation.efficiency);
  assert.match(facts.evidenceCoverage, /missing historical evidence is unknown/);
  assert.equal(input.messages.length, 2, 'builder does not mutate frozen input');
});

test('common frozen dataset gives scheme-independent facts and authorizes events to current cutoff', () => {
  const current = node(), old = node(3), future = node(9), self = current.snapshot.selfSeat;
  const event = (position, kind, seat, tile) => ({ position, kind, seat, tile, source: 'fixture', roundId: current.roundId, sessionId: current.sessionId });
  const dataset = { rounds: [{ id: current.roundId, decisions: [old, current, future], events: [event(1, 'draw', self, '1m'), event(2, 'draw', (self + 1) % 4, '9p'), event(4, 'discard', (self + 1) % 4, '2m'), event(8, 'discard', self, '3m')] }] };
  const a = Review.buildBlindFacts({ node: current, events: [], messages: [] }, {}, { dataset });
  const b = Review.buildBlindFacts({ node: current, events: dataset.rounds[0].events, messages: [{ content: 'different scheme' }] }, {}, { dataset });
  assert.deepEqual(a, b); assert.deepEqual(a.events.map(e => e.position), [1, 4]);
  assert.deepEqual(a.historicalSnapshots.map(n => n.asOf), [3]);
  assert.match(a.evidenceCoverage, /common frozen dataset/);
  assert.equal(a.localCalculation.efficiency.candidates.length, current.legalActions.length);
});

test('blind facts cannot restore unauthorized history and reject stale/falsified current scope', () => {
  const current = node(), prior = node(3, raw => { raw.rivers = [raw.rivers[0]]; });
  const facts = Review.buildBlindFacts({ node: current, events: [] }, { requests: { p: { frozenInput: { node: prior } } } });
  assert.equal(facts.historicalSnapshots.length, 0);
  assert.throws(() => Review.buildBlindFacts({ node: { ...current, position: 8 } }), /cutoff/);
  assert.throws(() => Review.buildBlindFacts({ node: { ...current, authorization: { ...current.authorization, selfSeat: 2 } } }), /authorization/);
  assert.throws(() => Review.buildBlindFacts({ node: { ...current, legalActions: [{ action: 'discard', tile: '9p' }] } }), /legal/);
});

test('review queue freezes common blind facts and imports explicit fail/needs_review through v1.0.1 hook', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createReviewQueue } = require('../benchmark/review.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-next-review-'));
  try {
    const current = node(), prior = node(3), future = node(9), answer = job().packet.answer;
    const dataset = { rounds: [{ id: current.roundId, decisions: [prior, current, future], events: [] }] };
    const frozenInput = { node: current, events: [], prepared: { factCatalog: 'machine verdict not for judge' },
      messages: [{ role: 'system', content: 'Scheme W-C' }, { role: 'assistant', content: 'private W-C draft text' }, { role: 'user', content: 'private W-V correction feedback' }] };
    const run = { results: [{ id: 'c', status: 'success', channel: 'main', schemeId: 'W-C' }, { id: 'v', status: 'success', channel: 'main', schemeId: 'W-V' }],
      requests: { c: { frozenInput, response: { text: answer } }, v: { frozenInput, response: { text: answer } } } };
    const queue = createReviewQueue(directory, 'contract-1', Review.RULES, { dataset }); queue.sync(run);
    assert.equal(queue.snapshot().length, 2);
    const jobs = queue.snapshot().map(j => ({ ...j, packet: JSON.parse(fs.readFileSync(path.join(queue.directory, 'blind', j.blindId + '.json'), 'utf8')) }));
    assert.deepEqual(jobs[0].packet.facts, jobs[1].packet.facts);
    for (const j of jobs) {
      assert.equal(j.packet.facts.historicalSnapshots.length, 1);
      assert.deepEqual(j.packet.facts.historicalSnapshots.map(s => s.asOf), [3]);
      assert.doesNotMatch(JSON.stringify(j.packet), /Scheme W-C|private W-C draft text|private W-V correction feedback|machine verdict not for judge|"messages"|"schemeId"/);
    }
    const fail = result(jobs[0]); fail.gate = { pass: false, majorError: false, status: 'fail', reason: '实质备选义务未满足' };
    const uncertain = result(jobs[1]); uncertain.gate = { pass: false, majorError: false, status: 'needs_review', reason: '存在未决核心证据争议' };
    uncertain.uncertain = [{ issue: '语义无法确定', affectsGate: true, reason: '涉及首答义务' }];
    queue.importResults([fail, uncertain]);
    const imported = queue.snapshot(); assert.ok(imported.every(j => j.state === 'complete' && j.review.gate === false));
    assert.deepEqual(imported.map(j => j.review.gateStatus).sort(), ['fail', 'needs_review']);
    assert.ok(imported.every(j => j.review.severeErrors.length === 0), 'absence of severe errors must not manufacture passes');
    const resumed = createReviewQueue(directory, 'contract-1', Review.RULES, { dataset });
    assert.deepEqual(resumed.snapshot().map(j => j.review.gateStatus).sort(), ['fail', 'needs_review']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
