'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Analysis = require('../extension/analysis.js'), Snapshot = require('../extension/contracts/snapshot.js');
const Core = require('../benchmark/core.cjs'), Facts = require('../benchmark/phase3-facts.cjs');
const { fixture } = require('../agent/eval.cjs');
function setup(change = () => {}) {
  const raw = fixture('123m123p123s111z22z'); raw.lastStep = 7; change(raw);
  const snapshot = Snapshot.cleanSnapshot(raw), prepared = Analysis.prepare(snapshot, 'combined');
  prepared.responseSchema.properties.decision.properties.tile.enum = [null, ...prepared.data.outputConstraints.legalDiscards];
  prepared.systemPrompt = prepared.systemPrompt.split('\n输出JSON Schema：\n')[0] + '\n输出JSON Schema：\n' + JSON.stringify(prepared.responseSchema);
  const node = { id: 'n7', roundId: 'r1', sessionId: 's1', position: 7, snapshot, authorization: Core.authorizationFor(snapshot), legalActions: prepared.data.outputConstraints.legalDiscards.map(tile => ({ action: 'discard', tile })) };
  const context = { prepared, messages: [{ role: 'system', content: prepared.systemPrompt }, { role: 'user', content: prepared.userPrompt }] };
  return { node, context, typed: Facts.attach(context, node, { claims: true }) };
}
function answer(f, patch = {}) {
  return { task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: f.node.legalActions[0].tile, reasons: ['当前进张为2，按效率推进；对手风险证据不足。'] }, limitations: [], factClaims: [], ...patch };
}
test('compact catalog keeps all tied ranking candidates and exact red discard identity', () => {
  const f = setup(s => { s.selfHand[0] = '0m'; s.selfDrawnTile = '0m'; });
  const all = f.typed.factCatalog.facts, get = k => all[Object.keys(all).find(id => id.endsWith(':' + k))];
  const candidates = f.context.prepared.data.localAnalysis.efficiency.candidates, min = Math.min(...candidates.map(c => c.shanten));
  const best = candidates.filter(c => c.shanten === min), max = Math.max(...best.map(c => c.totalUnseenUpperBound));
  assert.deepEqual(get('ranking.maxUpperTilesAtMin'), best.filter(c => c.totalUnseenUpperBound === max).map(c => c.tile).sort());
  assert.equal(get('after.0m.redCount'), 0);
  assert.equal(get('after.1p.redCount'), 1);
  assert.ok(get('after.1p.hand').includes('0m'));
});
test('unknown river stays null; fact inputs are identical with and without citation contract', () => {
  const f = setup(s => { s.rivers = s.rivers.filter(r => r.seat !== 2); });
  const plain = Facts.attach(f.context, f.node);
  assert.equal(plain.messages.at(-1).content, f.typed.messages.at(-1).content);
  assert.equal(plain.prepared.responseSchema.required.includes('factClaims'), false);
  for (const [id, value] of Object.entries(plain.factCatalog.facts)) if (id.includes('.seat.2.genbutsu')) assert.equal(value, null);
});
test('fact mismatch is not a schema error; correction localizes grounded mismatch only', () => {
  const f = setup(), id = Object.keys(f.typed.factCatalog.facts).find(k => k.endsWith('.totalUpper'));
  const a = answer(f, { factClaims: [{ id, value: -1, supports: '/decision/reasons/0', quote: '当前进张为2' }] });
  const text = JSON.stringify(a), inspection = f.typed.inspectAnswer(text);
  assert.doesNotThrow(() => f.typed.validateAnswer(text));
  assert.equal(inspection.check.valid, false); assert.equal(inspection.check.errors[0].code, 'fact_value_mismatch');
  assert.equal(f.typed.correctionFeedback(text).shouldCorrect, true);
  a.factClaims[0].value = f.typed.factCatalog.facts[id];
  const correctCitationWrongProse = f.typed.inspectAnswer(JSON.stringify(a));
  assert.equal(correctCitationWrongProse.check.valid, true);
  assert.equal(correctCitationWrongProse.check.naturalLanguageVerified, false, 'matching copied values cannot certify prose');
  assert.equal(f.typed.correctionFeedback(JSON.stringify(a)).shouldCorrect, false);
});
test('wrong-state id, invalid quote and empty coverage never manufacture grounded correction', () => {
  const f = setup(), id = Object.keys(f.typed.factCatalog.facts)[0];
  for (const c of [{ id: 'old:' + id, quote: '当前进张为2' }, { id, quote: '不存在的引文' }]) {
    const a = answer(f, { factClaims: [{ ...c, value: -1, supports: '/decision/reasons/0' }] });
    assert.equal(f.typed.inspectAnswer(JSON.stringify(a)).check.valid, false);
    assert.equal(f.typed.correctionFeedback(JSON.stringify(a)).shouldCorrect, false);
  }
  const empty = f.typed.inspectAnswer(JSON.stringify(answer(f)));
  assert.equal(empty.check.coverage.belowRequestedThree, true); assert.equal(empty.check.independentQualityGate, null);
  assert.throws(() => f.typed.validateAnswer(JSON.stringify(answer(f)), { ...f.node, sessionId: 'other' }), /scope/);
});
test('stable prefix keeps schema independent of candidate order, local legality and current facts', () => {
  const f = setup(), old = JSON.stringify(f.context), x = Facts.stablePrefix(f.context);
  assert.equal(JSON.stringify(f.context), old);
  assert.equal(x.prepared.responseSchema.properties.decision.properties.tile.enum, undefined);
  assert.deepEqual(x.prepared.data, f.context.prepared.data);
  const projected = answer(f); delete projected.factClaims;
  assert.doesNotThrow(() => Analysis.parseResult(projected, x.prepared));
  projected.decision.tile = '9s';
  assert.throws(() => Analysis.parseResult(projected, x.prepared));
  assert.ok(x.messages.at(-1).content.includes(JSON.stringify(f.context.prepared.data.outputConstraints)));
});
