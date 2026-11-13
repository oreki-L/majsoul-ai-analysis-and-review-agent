'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Core = require('../benchmark/core.cjs');
const Next = require('../benchmark/next-stage-context.cjs');
const Combo = require('../benchmark/phase2-combinations.cjs');
const Freeze = require('../benchmark/freeze.cjs');
const { fixture } = require('../agent/eval.cjs');
function data() {
  const raw = fixture('123m123p123s111z22z');
  const round = Core.validateDataset({ schemaVersion: 1, id: 'synthetic-combinations', rounds: [{ id: 'r', events: [], decisions: Array.from({ length: 7 }, (_, i) => {
    const snapshot = structuredClone(raw); snapshot.lastStep = i + 1;
    snapshot.rivers[1].discards.push({ tile: '9m', tsumogiri: true, riichi: false, called: false });
    return { id: 'd' + i, position: i + 1, type: 'ordinary-discard', snapshot, legalActions: [...new Set(snapshot.selfHand)].map(tile => ({ action: 'discard', tile })) };
  }) }] }).rounds[0];
  const history = round.decisions.slice(0, -1).map(d => ({ decisionId: d.id, roundId: d.roundId, sessionId: d.sessionId, authorization: d.authorization, position: d.position, snapshot: d.snapshot,
    answer: { decision: { action: 'discard', tile: '2z', reasons: ['OWN_' + d.id] } }, answerText: 'OWN_' + d.id }));
  const node = round.decisions.at(-1);
  const source = { id: round.id, baseline: { position: 0, snapshot: raw, origin: 'round-start' }, states: round.decisions.map(d => ({ position: d.position, snapshot: d.snapshot })), events: [
    { kind: 'DiscardTile', source: 'replay', position: 2, seat: 2, tile: '1z', riichi: true },
    { kind: 'Hule', source: 'replay', position: 100, tile: 'FUTURE_SENTINEL' }],
    nodeBindings: [{ decisionId: node.id, position: node.position, snapshotHash: Core.stableHash(node.snapshot) }] };
  return { node, source, history };
}
const input = (policy, d) => ({ scheme: { id: policy, context: {} }, node: d.node, history: d.history, events: [], options: { policy, sourceMode: 'own-causal-history' } });
test('controls are exact Next.build payloads and variants remove only extra event messages', () => {
  const d = data(), before = Core.stableHash(d);
  for (const policy of Combo.POLICIES) {
    const original = Next.build(input(Combo.BASE[policy], d), d.source), result = Combo.build(input(policy, d), d.source);
    if (['EV-0', 'X-S'].includes(policy)) assert.deepEqual(result, original);
    else {
      assert.ok(original.messages.some(m => m.content.startsWith('已授权历史事件')));
      assert.deepEqual(result.messages, original.messages.filter(m => !m.content.startsWith('已授权历史事件')));
      assert.deepEqual(result.prepared, original.prepared);
      assert.deepEqual(result.messages.at(-1), original.messages.at(-1));
      assert.deepEqual(result.sourceDecisionIds, original.sourceDecisionIds);
    }
    const current = JSON.parse(result.messages.at(-1).content.split('\n').slice(1).join('\n'));
    assert.deepEqual(current.snapshot.rivers, d.node.snapshot.rivers);
    assert.deepEqual(current.outputConstraints.legalDiscards, d.node.legalActions.map(a => a.tile));
    assert.ok(result.messages.some(m => m.content.startsWith('当前效率证据')));
    assert.ok(result.messages.some(m => m.content.startsWith('当前风险证据')));
    assert.equal(result.summaryJobs.length, 0);
    assert.doesNotMatch(JSON.stringify(result.messages), /FUTURE_SENTINEL/);
  }
  assert.equal(Core.stableHash(d), before);
});
test('own recent opinions obey scope/authorization/time and do not leak into facts-only group', () => {
  const d = data(), h = d.history[0];
  d.history.push({ ...h, position: 200, answerText: 'BAD_FUTURE' }, { ...h, roundId: 'foreign', answerText: 'BAD_ROUND' }, { ...h, authorization: {}, answerText: 'BAD_AUTH' });
  const sa = Combo.build(input('E0-SA', d), d.source), s = Combo.build(input('E0-S', d), d.source);
  assert.match(JSON.stringify(sa.messages), /OWN_d5/);
  assert.doesNotMatch(JSON.stringify(sa.messages), /BAD_|OWN_d0/);
  assert.doesNotMatch(JSON.stringify(s.messages), /OWN_/);
  assert.equal(sa.sourceDecisionIds.length, 6);
  assert.throws(() => Combo.build({ ...input('E0-SA', d), options: { policy: 'E0-SA', sourceMode: 'fixed-source-replay' } }, d.source), /own causal/);
  const wrong = data(); wrong.history[0].snapshot.lastStep = 123;
  assert.throws(() => Combo.build(input('E0-SA', wrong), wrong.source), /authorization\/position/);
});
test('static graph closes and adapter rejects mismatched source binding', () => {
  const graph = Freeze.dependencyGraph([path.resolve(__dirname, '../benchmark/phase2-combinations.cjs')]);
  assert.ok(graph.size > 5);
  for (const item of graph.values()) for (const dependency of item.dependencies) assert.ok(graph.has(require('node:fs').realpathSync(dependency.target)));
  const d = data(), adapter = Combo.createAdapter({ rounds: [d.source] });
  assert.deepEqual(adapter.buildContext(input('E0-S', d)), Combo.build(input('E0-S', d), d.source));
  d.node.snapshot.lastStep = 123;
  assert.throws(() => adapter.buildContext(input('E0-S', d)), /source binding/);
});
test('proposed slots preserve original controls and reserved slots 20..22', () => {
  assert.deepEqual(Combo.MAPPING.map(r => [r.schemeId, r.slot, r.credentialAlias]), [['EV-0', 10, 'group:M'], ['X-S', 7, 'group:G'], ['E0-S', 23, 'alias:plan23'], ['E0-SA', 24, 'alias:plan24']]);
  assert.ok(Combo.MAPPING.slice(2).every(r => r.status === 'proposed-unapproved'));
});
