'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../benchmark/core.cjs');
const Current = require('../benchmark/context.cjs');
const Next = require('../benchmark/next-stage-context.cjs');
const { fixture } = require('../agent/eval.cjs');
const parse = message => JSON.parse(message.content.slice(message.content.indexOf('\n') + 1));
function inputs(count = 7) {
  const raw = fixture('123m123p123s111z22z');
  const baseline = Core.validateDataset({ schemaVersion: 1, id: 'synthetic-next', rounds: [{ id: 'east1', events: [], decisions: Array.from({ length: count }, (_, n) => {
    const snapshot = structuredClone(raw); snapshot.lastStep = n + 1; snapshot.game.remaining = 60 - n;
    if (n) snapshot.rivers[1].discards.push({ tile: '9m', tsumogiri: true, riichi: false, called: false });
    return { id: 'd' + (n + 1), position: n + 1, type: 'ordinary-discard', snapshot, legalActions: [...new Set(snapshot.selfHand)].map(tile => ({ action: 'discard', tile })) };
  }) }] }).rounds[0];
  const source = { baseline: { position: 0, snapshot: raw, origin: 'round-start' }, states: baseline.decisions.map(d => ({ position: d.position, snapshot: d.snapshot })), events: [
    { kind: 'NewRound', source: 'replay', position: 0 },
    { kind: 'DiscardTile', source: 'replay', position: 1, seat: 1, tile: '9m', tsumogiri: true, riichi: false },
    { kind: 'DiscardTile', source: 'replay', position: 2, seat: 2, tile: '1z', riichi: true },
    { kind: 'DealTile', source: 'replay', position: 3, seat: 2, tile: '7z' },
    { kind: 'Hule', source: 'replay', position: count + 1 }
  ] };
  const history = baseline.decisions.slice(0, -1).map(d => {
    const answer = { task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: '2z', reasons: ['SYNTHETIC_OLD_OPINION_' + d.id] }, limitations: [] };
    return { decisionId: d.id, position: d.position, roundId: d.roundId, sessionId: d.sessionId, authorization: d.authorization, snapshot: d.snapshot, answer, answerText: JSON.stringify(answer), request: '分析当时\n' + JSON.stringify({ snapshot: d.snapshot, question: '' }) };
  });
  const node = baseline.decisions.at(-1);
  return { source, node, history };
}
function build(policy, prepared = inputs(), additions = {}) {
  return Next.build({ scheme: { id: policy, context: {} }, node: prepared.node, history: prepared.history, events: [], options: { policy }, ...additions }, prepared.source);
}
test('next-stage policies preserve current full snapshot, legal candidates, scope and local inputs', () => {
  const input = inputs(), original = Core.stableHash(input);
  for (const policy of Next.POLICIES) {
    const result = build(policy, input), current = parse(result.messages.at(-1));
    assert.deepEqual(current.snapshot, input.node.snapshot, policy);
    assert.deepEqual(current.outputConstraints.legalDiscards, input.node.legalActions.map(a => a.tile), policy);
    assert.equal(result.prepared.data.lastStep, input.node.position);
    assert.equal(Core.stableHash(input), original, 'builder must not mutate local history');
  }
});
test('cancelled policies and unbound fixed-source replay fail closed', () => {
  assert.throws(() => build('R2'), /cancelled/);
  assert.throws(() => build('R4'), /cancelled/);
  assert.throws(() => build('C-L', inputs(), { options: { policy: 'C-L', sourceMode: 'fixed-source-replay' } }), /explicitly bound/);
});
test('history 2x2 has identical current evidence and events, old opinions only when selected', () => {
  const input = inputs();
  const results = Object.fromEntries(['R0', 'X-S', 'X-A', 'X-SA'].map(p => [p, build(p, input)]));
  const evidence = r => r.messages.filter(m => /当前语义导航|当前效率证据|当前风险证据|已授权历史事件/.test(m.content));
  for (const result of Object.values(results)) assert.deepEqual(evidence(result), evidence(results.R0));
  for (const p of ['R0', 'X-S']) assert.doesNotMatch(JSON.stringify(results[p].messages), /SYNTHETIC_OLD_OPINION/);
  for (const p of ['X-A', 'X-SA']) {
    const sent = JSON.stringify(results[p].messages);
    assert.match(sent, /SYNTHETIC_OLD_OPINION_d3/);
    assert.doesNotMatch(sent, /SYNTHETIC_OLD_OPINION_d1/);
    assert.doesNotMatch(sent, /initialSnapshot|OLD_COMPLETE_SNAPSHOT/);
  }
});
test('events vary only extra event range and never reveal private opponent draws or future', () => {
  const input = inputs(), none = build('EV-0', input), all = build('EV-All', input);
  assert.ok(!none.messages.some(m => /已授权历史事件|全部授权事件/.test(m.content)));
  const ev = parse(all.messages.find(m => m.content.startsWith('全部授权事件')));
  assert.equal(ev.find(e => e.kind === 'DealTile').tile, '?');
  assert.ok(!ev.some(e => e.kind === 'Hule'));
  assert.deepEqual(parse(all.messages.at(-1)), parse(none.messages.at(-1)));
});
test('all captured old facts cover failed-analysis states independently of opinion history', () => {
  const input = inputs(); input.history = input.history.slice(-1);
  const result = build('X-S', input), facts = parse(result.messages.find(m => m.content.startsWith('全部旧局面代码事实')));
  assert.equal(facts.states.length, 7, 'baseline and six captured old states');
  assert.ok(facts.states.every(s => !Object.hasOwn(s, 'snapshot')));
  assert.ok(facts.fieldDictionary.length && facts.states.every(s => s.position < input.node.position));
});
test('new summary fallbacks have no raw old snapshot and emit scoped four-point job', () => {
  const input = inputs();
  for (const policy of ['C-L', 'C-KM', 'W-SA-L', 'W-SA-KM']) {
    const result = build(policy, input), job = result.summaryJobs[0];
    assert.equal(job.contract, Next.SUMMARY_CONTRACT);
    assert.equal(job.watermark, 4);
    assert.equal(Next.validateSummary(job.mockText, job).valid, true);
    assert.doesNotMatch(JSON.stringify(result.messages), /initialSnapshot|"snapshot":\{"format"/);
    assert.equal(result.compression.fallback, true);
    assert.equal(job.source.opinions.length, policy.startsWith('W-SA') ? 4 : 0);
  }
});
test('summary acceptance binds exact source/scope, and consumed prefix is not repeated as full code', () => {
  const input = inputs(), initial = build('C-L', input), job = initial.summaryJobs[0];
  const record = { ...job, status: 'ready', text: job.mockText };
  const result = build('C-L', input, { summary: [record] });
  assert.equal(result.compression.fallback, false);
  assert.equal(result.compression.coveredSourceIds.length, 5);
  assert.equal(result.compression.codeTailSourceIds.length, 2);
  assert.equal(result.summaryJobs.length, 0);
  assert.ok(result.messages.some(m => m.content.startsWith('已校验来源绑定的历史摘要')));
  for (const altered of [{ ...record, sourceHash: 'bad' }, { ...record, scope: { ...job.scope, roundId: 'wrong' } }, { ...record, text: '{bad' }]) assert.equal(build('C-L', input, { summary: [altered] }).compression.fallback, true);
  const unsupported = JSON.parse(job.mockText); unsupported.facts = [{ sourceId: 'future', position: 99, text: 'invented' }];
  assert.equal(Next.validateSummary(JSON.stringify(unsupported), job).valid, false);
});
test('type-interned facts and hybrid anchors never duplicate covered full old states', () => {
  const input = inputs(), result = build('C-KM', input), job = result.summaryJobs[0];
  const ready = build('C-KM', input, { summary: [{ ...job, status: 'ready', text: job.mockText }] });
  const anchors = parse(ready.messages.find(m => m.content.startsWith('旧事实来源与关键骨架')));
  assert.equal(anchors.length, 5);
  assert.ok(anchors.every(a => !a.snapshot && !a.rivers && !a.selfHand));
});
test('trusted module may directly bind source data and preserve its prepared contract', () => {
  const input = inputs(), scheme = { id: 'X-SA', context: { module: '../benchmark/next-stage-context.cjs', options: { policy: 'X-SA', roundSource: input.source } } };
  const builder = Current.loadContextBuilder(scheme, { baseDir: __dirname });
  const result = builder({ scheme, node: input.node, events: [], history: input.history });
  assert.equal(result.historyPolicy.nextStagePolicy, 'X-SA');
  assert.deepEqual(result.snapshot, input.node.snapshot);
});
