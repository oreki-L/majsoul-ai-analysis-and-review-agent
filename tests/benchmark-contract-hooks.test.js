'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const Core = require('../benchmark/core.cjs');
const Context = require('../benchmark/context.cjs');
const { runSuite, dryRun } = require('../benchmark/runner.cjs');
const { createTransport } = require('../benchmark/transport.cjs');
const Citation = require('../benchmark/fact-citations.cjs');
const example = path.resolve(__dirname, '../benchmark/examples/suite.mock.json');
function fixture(t, body) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-contract-hooks-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const plugin = path.join(folder, 'adapter.cjs');
  fs.writeFileSync(plugin, body ?? `const F=require(${JSON.stringify(path.resolve(__dirname, '../benchmark/fact-citations.cjs'))});exports.version=1;exports.buildContext=i=>F.withFactCitations(i.baseline,i.node);`);
  const suite = Core.compileSuite(example);
  suite.schemes = [{ id: 'W-C', modelId: 'synthetic', credentialAlias: 'group:A', context: { current: 'full', events: 'all', module: plugin } }, { id: 'W-V', modelId: 'synthetic', credentialAlias: 'group:B', pairedCorrectionOf: 'W-C', context: { current: 'full', events: 'all', module: plugin } }];
  suite.dataset.rounds = suite.dataset.rounds.slice(0, 1);
  suite.dataset.rounds[0].decisions = suite.dataset.rounds[0].decisions.slice(0, 1);
  suite.dataset.rounds[0].decisions[0].followups = [];
  suite.dataset.rounds[0].globalTasks = [];
  suite.execution.repetitions = 1; suite.execution.timeoutMs = 10000;
  return { suite, node: suite.dataset.rounds[0].decisions[0], checkpoint: path.join(folder, 'checkpoint.json') };
}
function record(calls, transform) {
  return options => {
    const transport = createTransport(options), original = transport.runModel;
    transport.runModel = async args => { calls.push({ role: args.meta.role, scheme: args.meta.schemeId, key: args.meta.keyAlias, messages: structuredClone(args.messages) }); if (transform) await transform(args); return original(args); };
    return transport;
  };
}
function typedAnswer(args, node, wrong) {
  const answer = JSON.parse(args.mockText), catalog = Citation.createFactCatalog(node);
  const { status, ...fact } = catalog.facts.find(f => f.kind === 'hand-size');
  answer.factClaims = [{ ...fact, value: fact.value + (wrong ? 1 : 0), supports: '/decision/reasons/0' }];
  args.mockText = JSON.stringify(answer);
}
test('trusted preparation override retains output schema but rejects changed cutoff/legal set', t => {
  const f = fixture(t, "exports.buildContext=i=>({...i.baseline,prepared:{...i.prepared,systemPrompt:'preserved frozen prompt'}});");
  const built = Context.loadContextBuilder(f.suite.schemes[0], { baseDir: f.suite.baseDir })({ scheme: f.suite.schemes[0], node: f.node, events: [], history: [] });
  assert.equal(built.prepared.systemPrompt, 'preserved frozen prompt');
  const bad = fixture(t, "exports.buildContext=i=>{i.prepared.data.lastStep++;return {...i.baseline,prepared:i.prepared};};");
  assert.throws(() => Context.loadContextBuilder(bad.suite.schemes[0], { baseDir: bad.suite.baseDir })({ scheme: bad.suite.schemes[0], node: bad.node, events: [], history: [] }), /mismatch/);
});
test('paired correction reuses one draft, routes its own key, and does not turn fact errors into schema repairs', async t => {
  const f = fixture(t), calls = [];
  const run = await runSuite(f.suite, { checkpoint: f.checkpoint, transportFactory: record(calls, args => typedAnswer(args, f.node, args.meta.role !== 'evidence-correction')) });
  assert.equal(run.status, 'complete'); assert.equal(run.results.length, 2);
  const draft = run.results.find(r => r.schemeId === 'W-C'), corrected = run.results.find(r => r.schemeId === 'W-V');
  assert.equal(draft.factInspection.check.valid, false); assert.equal(draft.validation.firstPassValid, true);
  assert.equal(draft.validation.repairRounds, 0); assert.equal(corrected.factInspection.check.valid, true);
  assert.equal(corrected.correctionTriggered, true); assert.equal(corrected.costAttribution.actualSharedDraftBilledOnce, true);
  assert.deepEqual(calls.map(c => [c.role, c.key]), [['initial', 'group:A'], ['evidence-correction', 'group:B']]);
  assert.equal(run.histories['0:W-C'].length, 1); assert.equal(run.histories['0:W-V'], undefined);
  assert.equal(run.histories['0:W-C'][0].answerText, draft.text);
  assert.equal(dryRun(f.suite).initialRequests, 1); assert.equal(dryRun(f.suite).pairedCorrectionOutputs, 1);
});
test('valid citations cause no extra dispatch and complete pairing resumes without requests', async t => {
  const f = fixture(t), calls = [];
  const run = await runSuite(f.suite, { checkpoint: f.checkpoint, transportFactory: record(calls, args => typedAnswer(args, f.node, false)) });
  const pair = run.results.find(r => r.schemeId === 'W-V');
  assert.equal(calls.length, 1); assert.equal(pair.correctionTriggered, false);
  assert.equal(run.requests[pair.id].dispatchedModelRequests, 0);
  assert.equal(pair.costAttribution.incrementalUsageEstimate, 0);
  const resumed = await runSuite(f.suite, { checkpoint: f.checkpoint, resume: true, transportFactory: () => { throw Error('must not redispatch'); } });
  assert.equal(resumed.results.length, 2);
});
test('failed correction preserves delivered draft and never generates a new initial answer', async t => {
  const f = fixture(t), calls = [];
  const run = await runSuite(f.suite, { checkpoint: f.checkpoint, transportFactory: record(calls, args => { if (args.meta.role === 'evidence-correction') throw Error('synthetic failure'); typedAnswer(args, f.node, true); }) });
  assert.equal(run.results.find(r => r.schemeId === 'W-C').status, 'success');
  assert.equal(run.results.find(r => r.schemeId === 'W-V').status, 'failed');
  assert.equal(calls.filter(c => c.role === 'initial').length, 1);
});
test('fact mismatch after correction remains an explicit error, with no recursive fact repair', async t => {
  const f = fixture(t), calls = [];
  const run = await runSuite(f.suite, { checkpoint: f.checkpoint, transportFactory: record(calls, args => typedAnswer(args, f.node, true)) });
  const pair = run.results.find(r => r.schemeId === 'W-V');
  assert.equal(pair.status, 'success'); assert.equal(pair.factInspection.check.valid, false);
  assert.equal(pair.factInspection.check.independentQualityGate, null); assert.equal(calls.length, 2);
});
test('paired correction uses the original logical deadline rather than a fresh full timeout', async t => {
  const f = fixture(t), calls = [];
  let monotonic = 0;
  t.mock.method(performance, 'now', () => monotonic);
  const run = await runSuite(f.suite, { checkpoint: f.checkpoint, transportFactory: options => {
    const transport = createTransport(options), original = transport.runModel;
    transport.runModel = async args => { calls.push(args.meta.role); typedAnswer(args, f.node, true); const response = await original(args); monotonic = f.suite.execution.timeoutMs - 1; return response; };
    return transport;
  } });
  assert.equal(run.results.find(r => r.schemeId === 'W-C').status, 'success');
  assert.equal(run.results.find(r => r.schemeId === 'W-V').status, 'failed');
  assert.equal(calls.length, 1);
});
test('paired schemes reject different model generation contracts and unknown draft source', () => {
  const raw = JSON.parse(fs.readFileSync(example));
  raw.models.other = { ...raw.models.synthetic, temperature: .9 };
  raw.schemes = [{ id: 'a', modelId: 'synthetic', context: { module: 'trusted.cjs' } }, { id: 'b', modelId: 'other', pairedCorrectionOf: 'a', context: { module: 'trusted.cjs' } }];
  assert.throws(() => Core.validateSuite(raw), /generation contract/);
  raw.schemes[1].modelId = 'synthetic'; raw.schemes[1].pairedCorrectionOf = 'absent';
  assert.throws(() => Core.validateSuite(raw), /distinct trusted/);
});
test('pending summaries coalesce by scope while the in-flight task and its charge remain', async t => {
  const f = fixture(t, "exports.buildContext=i=>({...i.baseline,summaryJobs:i.baseline.summaryJobs.map(j=>({...j,coalesceKey:i.node.roundId}))});");
  f.suite.dataset = Core.compileSuite(example).dataset;
  f.suite.dataset.rounds = f.suite.dataset.rounds.slice(0, 1);
  const round = f.suite.dataset.rounds[0];
  round.globalTasks = []; for (const node of round.decisions) node.followups = [];
  while (round.decisions.length < 4) {
    const node = structuredClone(round.decisions.at(-1));
    node.id += '-extra'; node.position++; node.snapshot.lastStep = node.position; node.decisionContext.triggerPosition = node.position;
    round.decisions.push(node);
  }
  f.suite.schemes = [f.suite.schemes[0]];
  f.suite.schemes[0].context.snapshots = { mode: 'llm', trigger: 1, recent: 0 };
  let release, active = 0, peak = 0, initial = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const calls = [];
  const run = await runSuite(f.suite, { checkpoint: f.checkpoint, transportFactory: record(calls, async args => {
    if (args.meta.role === 'summary') { active++; peak = Math.max(peak, active); await barrier; active--; }
    else if (args.meta.role === 'initial' && ++initial === round.decisions.length) release();
  }) });
  assert.equal(peak, 1);
  assert.ok(Object.values(run.summaries).some(s => s.status === 'superseded'));
  assert.equal(calls.filter(c => c.role === 'summary').length, 2);
  assert.equal(calls.filter(c => c.role === 'initial').length, round.decisions.length);
});
