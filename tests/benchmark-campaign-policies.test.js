'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { compileSuite, stableHash } = require('../benchmark/core.cjs');
const { buildContext } = require('../benchmark/context.cjs');
const Policies = require('../benchmark/campaign-policies.cjs');
const Production = require('../benchmark/production-v010.cjs');

function fixture() {
  const source = compileSuite(path.join(__dirname, '../benchmark/examples/suite.mock.json'));
  const seed = source.dataset.rounds[0].decisions[0], initial = structuredClone(seed.snapshot); initial.lastStep = 0;
  const nodes = Array.from({ length: 12 }, (_, i) => { const node = structuredClone(seed); node.id = `d${i + 1}`; node.position = i + 1; node.snapshot.lastStep = i + 1; node.decisionContext.triggerPosition = i + 1; return node; });
  const events = nodes.map(n => ({ kind: 'DiscardTile', position: n.position, source: n.snapshot.source, seat: n.snapshot.selfSeat, tile: n.legalActions[0].tile, tsumogiri: false, riichi: false }));
  const round = { id: seed.roundId, baseline: { position: 0, origin: 'round-start', snapshot: initial }, events, observations: events.map(e => ({ position: e.position, events: [e] })), states: nodes.map(n => ({ position: n.position, snapshot: n.snapshot })) };
  function input(policy, node, history = [], summary = []) {
    const scheme = { id: policy, context: {} }, baseline = buildContext({ scheme, node, history, events: [] });
    return { scheme, node, history, summary, prepared: baseline.prepared, baseline, channel: 'realtime', options: { version: Policies.VERSION, policy, recent: 4, trigger: 1, ordinaryEventWindow: 12, checkpointEvery: 4, extractLimit: 4 } };
  }
  function exchange(node, built, answer = null) {
    answer ??= { task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: node.legalActions[0].tile, reasons: [`旧建议${node.id}保留原文。`] }, limitations: [] };
    return { decisionId: node.id, position: node.position, roundId: node.roundId, sessionId: node.sessionId, authorization: node.authorization, snapshot: node.snapshot, answer, answerText: JSON.stringify(answer), request: built.messages.filter(m => m.role === 'user').at(-1).content };
  }
  const history = []; for (const node of nodes.slice(0, -1)) { const built = Policies.buildCampaignContext(input('B', node, history), round); history.push(exchange(node, built)); }
  return { nodes, round, input, exchange, history };
}
function payload(message) { return JSON.parse(message.content.slice(message.content.indexOf('\n') + 1)); }

test('production adapter is byte equivalent to the baseline messagesFor implementation over long successful/failing histories', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/agent.js'), 'utf8').replace('const api = { run };', 'const api = { run, messagesFor, authorizedEvents };');
  const sandbox = { module: { exports: {} }, require: createRequire(path.join(__dirname, '../extension/agent.js')), globalThis: {} }; vm.runInNewContext(source, sandbox);
  const f = fixture(), node = f.nodes.at(-1), history = f.history.filter((_, i) => i !== 3);
  const input = f.input('B-current', node, history), timeline = [];
  for (const group of f.round.observations.filter(g => g.position <= node.position)) { timeline.push({ type: 'observation', ...group }); const e = history.find(e => e.position === group.position); if (e) timeline.push({ type: 'exchange', ...e, answer: e.answerText }); }
  const context = { baseline: f.round.baseline, checkpoint: { position: node.position }, events: f.round.events, timeline };
  const expected = sandbox.module.exports.messagesFor(input.prepared, node.snapshot, context, '');
  const production = Production.messagesFor(input.prepared, node.snapshot, context, '');
  assert.equal(JSON.stringify(production), JSON.stringify(expected));
  const actual = Policies.buildCampaignContext(input, f.round).messages.slice(1);
  const flattened = production.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(c => c.text).join('') }));
  assert.deepEqual(actual, flattened);
  assert.deepEqual(actual, Policies.buildCampaignContext(f.input('B', node, history), f.round).messages.slice(1));
});

test('B/H2 snapshot dedup changes only old request snapshot expansions and preserves answers/task/questions/constraints', () => {
  const f = fixture(), node = f.nodes.at(-1);
  for (const [raw, dedup, count] of [['B', 'B-dedup', f.history.length], ['H2', 'H2-dedup', 4]]) {
    const a = Policies.buildCampaignContext(f.input(raw, node, f.history), f.round), b = Policies.buildCampaignContext(f.input(dedup, node, f.history), f.round);
    assert.equal(a.messages.length, b.messages.length); let changed = 0;
    for (let i = 0; i < a.messages.length; i++) if (a.messages[i].content !== b.messages[i].content) { changed++; const x = payload(a.messages[i]), y = payload(b.messages[i]); assert.ok(x.snapshot); assert.equal(y.snapshot, undefined); assert.equal(y.snapshotReference.sourceSnapshotHash, stableHash(x.snapshot)); delete x.snapshot; delete y.snapshotReference; assert.deepEqual(x, y); }
    assert.equal(changed, count);
  }
});

test('H4 advice whitelist and factorial cells preserve a common background with no old requests or full answer details', () => {
  const f = fixture(), node = f.nodes.at(-1), h4 = Policies.buildCampaignContext(f.input('H4', node, f.history), f.round);
  const advice = Policies.buildCampaignContext(f.input('H4-advice', node, f.history), f.round);
  assert.equal(advice.messages.length, h4.messages.length + 1);
  assert.deepEqual(advice.messages.filter(m => !m.content.startsWith('过去自动实时核心建议')), h4.messages);
  const opinions = payload(advice.messages.find(m => m.content.startsWith('过去自动实时核心建议')));
  assert.equal(opinions.length, f.history.length); assert.deepEqual(Object.keys(opinions[0]).sort(), ['finalDecision', 'limitations', 'source', 'sourceDecisionId', 'sourcePosition', 'sourceSnapshotHash'].sort());
  const f10 = Policies.buildCampaignContext(f.input('Factorial-S1A0', node, f.history), f.round), f11 = Policies.buildCampaignContext(f.input('Factorial-S1A1', node, f.history), f.round);
  assert.equal(f10.messages.length, h4.messages.length + 1); assert.equal(f11.messages.length, h4.messages.length + 2);
  const first = f.nodes[0]; for (const p of ['H4-advice', 'Factorial-S1A0', 'Factorial-S1A1']) assert.deepEqual(Policies.buildCampaignContext(f.input(p, first), f.round).messages, Policies.buildCampaignContext(f.input('H4', first), f.round).messages);
});

test('K/M/KM share source prefix, ready summaries replace mutually exclusively, snapshot/advice components remain isolated', () => {
  const f = fixture(), node = f.nodes.at(-1), histories = f.history;
  const results = Object.fromEntries(['K', 'M', 'KM'].map(p => [p, Policies.buildCampaignContext(f.input(p, node, histories), f.round)]));
  assert.deepEqual(results.K.historyPolicy.eligibleSourceIds, results.M.historyPolicy.eligibleSourceIds); assert.deepEqual(results.K.historyPolicy.eligibleSourceIds, results.KM.historyPolicy.eligibleSourceIds);
  assert.equal(results.M.summaryJobs.length, 1); assert.equal(results.KM.summaryJobs.length, 1);
  assert.ok(results.M.summaryJobs[0].source[0].snapshot); assert.equal(results.KM.summaryJobs[0].source[0].snapshot, undefined);
  for (const p of ['M', 'KM', 'SnapshotHistory-LLMCompress', 'AdviceHistory-LLMCompress', 'SnapshotHistory-Hybrid', 'AdviceHistory-Hybrid']) {
    const raw = Policies.buildCampaignContext(f.input(p, node, histories), f.round), job = raw.summaryJobs[0], ready = { ...job, text: '已校验来源的历史摘要。' };
    const compressed = Policies.buildCampaignContext(f.input(p, node, histories, [ready]), f.round);
    assert.deepEqual(compressed.historyPolicy.coveredDecisionIds, job.coveredDecisionIds); assert.equal(compressed.summaryJobs.length, 0);
    const text = JSON.stringify(compressed.messages);
    if (!p.startsWith('SnapshotHistory')) assert.equal(text.includes('旧建议d1保留原文。'), p.endsWith('Hybrid'));
    if (p.startsWith('SnapshotHistory')) assert.ok(text.includes('旧建议d1保留原文。'), 'answers must not be processed by snapshot-only treatment');
    const wrong = { ...ready, scope: { ...ready.scope, roundId: 'other' } };
    assert.equal(Policies.buildCampaignContext(f.input(p, node, histories, [wrong]), f.round).historyPolicy.coveredDecisionIds.length, 0);
  }
});

test('D sends baseline once and later deltas, G uses compact recent requests; production branch freezes duplicate snapshots and JSON response', () => {
  const f = fixture(), history = [], node = f.nodes.at(-1);
  for (const n of f.nodes.slice(0, -1)) { const built = Policies.buildCampaignContext(f.input('D', n, history), f.round); assert.equal(payload(built.messages.at(-1)).snapshot, undefined); assert.ok(payload(built.messages.at(-1)).incremental); history.push(f.exchange(n, built)); }
  const built = Policies.buildCampaignContext(f.input('D', node, history), f.round);
  assert.equal(built.messages.filter(m => m.content.includes('initialSnapshot')).length, 1);
  const branchInput = { ...f.input('H6', node, f.history), channel: 'decision-discussion', originalAnswer: f.history[0].answer, question: '请解释原建议。', branchHistory: [] };
  const branch = Policies.buildCampaignContext(branchInput, f.round);
  assert.equal(branch.qaResponseFormat, 'analysis-json'); assert.equal(branch.historyPolicy.productionDuplicateSnapshot, true);
  assert.ok(branch.messages[1].content.includes('initialSnapshot')); assert.ok(payload(branch.messages[2]).snapshot); assert.equal(branch.messages.length, 5);
});
