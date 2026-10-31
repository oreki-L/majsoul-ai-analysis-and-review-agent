'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compileSuite, stableHash, validateSuite } = require('../benchmark/core.cjs');
const { runSuite, dryRun, fingerprint } = require('../benchmark/runner.cjs');
const { createTransport } = require('../benchmark/transport.cjs');
const { scoreRun, loadLabels } = require('../benchmark/scoring.cjs');
const { createReport, markdown } = require('../benchmark/report.cjs');
const EXAMPLE = path.resolve(__dirname, '../benchmark/examples/suite.mock.json');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-benchmark-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return path.join(dir, 'checkpoint.json'); }
function recording(calls, transform) { return options => { const transport = createTransport(options), run = transport.runModel; transport.runModel = async args => { calls.push(structuredClone({ messages: args.messages, meta: args.meta })); if (transform) await transform(args); return run(args); }; return transport; }; }

test('mock E2E isolates schemes, freeze QA/global, constrains post-call, keeps labels out and resumes histories', async t => {
  const suite = compileSuite(EXAMPLE), checkpoint = temp(t), calls = [];
  const state = await runSuite(suite, { checkpoint, transportFactory: recording(calls), credentialResolver: () => { throw new Error('Must not resolve mock credentials'); }, fetch: () => { throw new Error('Must not fetch'); } });
  assert.equal(state.status, 'complete'); assert.equal(state.results.filter(r => r.channel === 'main').length, 12);
  assert.ok(state.results.every(r => r.status === 'success')); assert.equal(state.results.filter(r => r.channel === 'global').length, 3);
  const exposed = state.results.find(r => r.schemeId === 'async-summary' && r.decisionId === 'synthetic-d3-call' && r.channel === 'main');
  assert.ok(exposed.compression.advice.summarizedItems > 0);
  const exposedCall = calls.find(c => c.meta.schemeId === 'async-summary' && c.meta.decisionId === 'synthetic-d3-call' && c.meta.role === 'initial');
  const opinions = JSON.parse(exposedCall.messages[1].content).historicalModelOpinions;
  assert.equal(opinions.filter(o => o.coveredDecisionIds?.includes('synthetic-d1')).length, 1);
  assert.equal(opinions.filter(o => o.decisionId === 'synthetic-d1').length, 0);
  const evidence = fs.readFileSync(path.join(path.dirname(checkpoint), 'requests.private.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(evidence.every(e => Array.isArray(e.body.messages)));
  const dataset = suite.dataset.rounds.flatMap(r => r.decisions);
  for (const r of state.results.filter(r => r.channel === 'main')) {
    const node = dataset.find(n => n.id === r.decisionId);
    assert.ok(node.legalActions.some(a => a.tile === r.answer.decision.tile));
    assert.ok(r.sourceDecisionIds.every(id => { const before = dataset.find(n => n.id === id); return before.position < node.position && before.roundId === node.roundId; }));
  }
  for (const call of calls.filter(c => c.meta.role !== 'summary' && c.meta.role !== 'review')) {
    const payload = JSON.parse(call.messages[1].content);
    assert.equal(payload.decisionId, call.meta.decisionId);
    assert.ok(!JSON.stringify(call.messages).includes('preferred'));
    assert.ok(payload.events.every(e => e.position <= payload.asOf));
    if (payload.channel === 'global-analysis') { assert.equal(payload.originalAnswer, undefined); assert.equal(call.messages.length, 3); }
    if (payload.channel === 'decision-discussion') assert.equal(payload.originalAnswer.decisionId, call.meta.decisionId);
  }
  for (const [key, history] of Object.entries(state.histories)) assert.equal(history.length, 4, key);
  const before = stableHash(state.histories), resumed = await runSuite(suite, { checkpoint, resume: true, transportFactory: () => { throw new Error('Completed campaign must not send'); } });
  assert.equal(stableHash(resumed.histories), before); assert.equal(resumed.results.length, state.results.length); assert.equal(resumed.modelRequests, state.modelRequests);
});

test('async summary never blocks foreground; single-slot defers and records late unused summaries', async t => {
  const suite = compileSuite(EXAMPLE); suite.schemes = [suite.schemes[2]]; suite.schemes[0].review = false;
  const calls = [], order = [];
  const state = await runSuite(suite, { checkpoint: temp(t), transportFactory: recording(calls, async args => { if (args.meta.role === 'summary') { await new Promise(r => setTimeout(r, 30)); order.push('summary-final'); } else if (args.meta.role === 'initial') order.push('main:' + args.meta.decisionId); }) });
  assert.ok(order.indexOf('main:synthetic-d3-call') < order.indexOf('summary-final'));
  const main = state.results.find(r => r.decisionId === 'synthetic-d3-call' && r.channel === 'main');
  assert.ok(main.compression.advice.rawItems > 0); assert.equal(main.compression.advice.summarizedItems, 0);
  assert.ok(Object.values(state.requests).some(r => r.role === 'summary'));
  assert.ok(Object.values(state.summaries).some(s => s.status === 'late-unused'));
  suite.execution.concurrency = 1; const singleCalls = [];
  const single = await runSuite(suite, { checkpoint: temp(t), transportFactory: recording(singleCalls) });
  const firstSummary = singleCalls.findIndex(c => c.meta.role === 'summary');
  assert.ok(singleCalls.slice(firstSummary).every(c => c.meta.role === 'summary'));
  assert.ok(Object.values(single.summaries).every(s => s.status === 'late-unused'));
});

test('resume rejects changed manifest and unresolved HTTP without resending', async t => {
  const suite = compileSuite(EXAMPLE), checkpoint = temp(t);
  await runSuite(suite, { checkpoint });
  suite.execution.seed++;
  await assert.rejects(runSuite(suite, { checkpoint, resume: true }), /manifest mismatch/);
  suite.execution.seed--;
  const state = JSON.parse(fs.readFileSync(checkpoint, 'utf8')); state.requests.uncertain = { status: 'pending' }; fs.writeFileSync(checkpoint, JSON.stringify(state));
  await assert.rejects(runSuite(suite, { checkpoint, resume: true, transportFactory: () => { throw new Error('Must never replay'); } }), /Unresolved/);
});

test('score retains failures/missing answers, zero candidates, non-100 MAKA weights and deduplicates aliases', () => {
  const labels = { schemaVersion: 1, synthetic: true, labels: [{ decisionId: 'a', maka: { preferred: '2m', candidates: [{ action: 'discard', tile: '1m', weight: 0 }, { action: 'discard', tile: '2m', weight: 37 }] }, gpt: { candidates: [{ action: 'discard', tile: '1m', weight: 0 }, { action: 'discard', tile: '2m', weight: 100 }] } }, { decisionId: 'b', maka: { preferred: '1m', candidates: [{ action: 'discard', tile: '1m', weight: 12 }] } }] };
  const row = { id: 'same', schemeId: 's', repeat: 0, decisionId: 'a', channel: 'main', status: 'success', answer: { decision: { tile: '1m' } } };
  const run = { manifest: { mode: 'mock', schemeIds: ['s'], decisions: ['a', 'b', 'c'], repetitions: 1 }, results: [row, row], status: 'complete' };
  const score = scoreRun(run, labels), g = score.groups[0];
  assert.equal(g.expected, 3); assert.equal(g.completed, 1); assert.equal(g.failures, 2);
  assert.equal(g.maka.denominator, 2); assert.equal(g.maka.candidateCoverage, 1); assert.equal(g.maka.positiveCoverage, 0); assert.equal(g.maka.preferredMatches, 0); assert.equal(g.gpt.denominator, 1);
  assert.equal(g.maka.rawWeightSumMean, 0); assert.equal(g.maka.missing, 1);
  const report = createReport(run, score); assert.match(markdown(report), /SYNTHETIC MOCK/); assert.deepEqual(createReport(run, score), report);
  assert.equal(loadLabels(path.resolve(__dirname, '../benchmark/examples/labels.synthetic.json')).labels.length, 2);
});

test('dry-run never loads labels or credentials; fingerprint excludes keys and includes source/params', () => {
  const suite = compileSuite(EXAMPLE); suite.labelsPath = 'DOES-NOT-EXIST';
  assert.equal(dryRun(suite).network, false); const before = fingerprint(suite);
  suite.models.synthetic.mock = { apiKey: 'private-one' }; const a = fingerprint(suite); suite.models.synthetic.mock.apiKey = 'private-two'; assert.equal(fingerprint(suite), a);
  suite.models.synthetic.temperature = .7; assert.notEqual(fingerprint(suite), a); assert.notEqual(before, a);
});

test('validation failures continue with the same denominator; errors never echo secrets', async t => {
  const suite = compileSuite(EXAMPLE); suite.schemes = [suite.schemes[0]]; const checkpoint = temp(t), calls = [];
  const run = await runSuite(suite, { checkpoint, transportFactory: recording(calls, async args => { if (args.meta.decisionId === 'synthetic-d1' && args.meta.role === 'initial') args.mockText = 'not-json sk-super-secret'; }) });
  assert.equal(run.results.find(r => r.decisionId === 'synthetic-d1').status, 'failed');
  assert.ok(run.results.some(r => r.decisionId === 'synthetic-d1' && r.channel === 'branch' && r.status === 'blocked'));
  assert.equal(run.results.filter(r => r.channel === 'main').length, 4);
  assert.ok(!fs.readFileSync(checkpoint, 'utf8').includes('sk-super-secret'));
  assert.equal(scoreRun(run, loadLabels(path.resolve(__dirname, '../benchmark/examples/labels.synthetic.json'))).groups[0].maka.denominator, 2);
});

test('colon-bearing identifiers cannot collide; independent imports validate IDs and repeats never pool', async t => {
  const suite = compileSuite(EXAMPLE); suite.schemes = [{ ...suite.schemes[0], id: 'a' }, { ...suite.schemes[0], id: 'a:b' }];
  const r = suite.dataset.rounds[0]; r.decisions = r.decisions.slice(0, 2); r.decisions[0].id = 'b:c'; r.decisions[1].id = 'c'; r.decisions.forEach(n => n.followups = []); r.globalTasks = []; suite.dataset.rounds = [r];
  const state = await runSuite(suite, { checkpoint: temp(t) });
  assert.equal(state.results.length, 4); assert.equal(new Set(state.results.map(r => r.id)).size, 4);
  const labels = { schemaVersion: 1, labels: [] };
  assert.throws(() => scoreRun(state, labels, { human: { results: [{ id: 'unknown', score: 1 }] } }), /unknown/);
  const id = state.results[0].id;
  assert.throws(() => scoreRun(state, labels, { human: { results: [{ id, score: 1 }, { id, score: 2 }] } }), /Duplicate/);
  const scored = scoreRun(state, labels, { human: { results: [{ id, scores: { coherence: 4, factual: 3 } }] } });
  assert.equal(scored.human.entries.length, 2); assert.equal(scored.human.groups[0].expected, 2); assert.equal(scored.human.groups[0].meanAllPlanned, null);
  state.manifest.repetitions = 2; const repeated = scoreRun(state, labels);
  assert.equal(repeated.groups[0].expected, 2); assert.equal(repeated.repeatGroups.length, 4); assert.equal(repeated.repeatGroups.find(g => g.repeat === 1).failures, 2);
  const unknown = createReport({ manifest: {}, status: 'stopped', ledger: { records: [{ meta: { role: 'initial', schemeId: 's' }, cost: null }], unknownLiability: true } });
  assert.equal(unknown.accounting.byRole.initial.total, null); assert.equal(unknown.accounting.byScheme.s.unknownAttempts, 1);
});

test('fake live accepts optional null request caps, preserves unknown liability and blocks remaining planned results', async t => {
  const raw = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')); raw.schemes = [raw.schemes[0]];
  raw.models.synthetic = { provider: 'openai-compatible', model: 'test-only', endpoint: 'https://example.invalid/v1', credentialAlias: 'plan01', maxTokens: 1024, rates: { input: 1, cachedInput: .1, output: 2, currency: 'CNY' }, usageSemantics: { inputIncludesCached: true, noCache: true } };
  raw.execution.maxModelRequests = null; raw.execution.maxToolCalls = null; raw.execution.budget.cap = 10;
  const suite = compileSuite(raw, { baseDir: path.dirname(EXAMPLE) });
  for (const usageSemantics of [{ noCache: 1 }, { inputIncludesCached: 'yes' }, { futureOption: true }, null, []]) {
    const invalid = structuredClone(raw); invalid.models.synthetic.usageSemantics = usageSemantics;
    assert.throws(() => validateSuite(invalid));
  }
  const checkpoint = temp(t); let calls = 0;
  const state = await runSuite(suite, { checkpoint, mode: 'live', credentialResolver: async () => 'test-private-value', fetch: async (_url, init) => {
    calls++; if (calls > 1) throw new Error('test-private-value provider lost response');
    const body = JSON.parse(init.body), input = JSON.parse(body.messages[1].content), tile = input.legalActions[0].tile;
    assert.equal(body.usageSemantics, undefined);
    return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile, reasons: ['仅用于本地fake HTTP测试。'] }, limitations: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) };
  } });
  assert.equal(calls, 2); assert.equal(state.status, 'stopped-unknown-liability'); assert.equal(state.ledger.unknownLiability, true);
  assert.equal(state.ledger.records[0].cost, .00003); assert.equal(state.ledger.records[0].usage.cachedInput, 0);
  assert.equal(state.results.filter(r => r.channel === 'main').length, 4); assert.ok(state.results.some(r => r.status === 'blocked'));
  for (const file of fs.readdirSync(path.dirname(checkpoint))) assert.ok(!fs.readFileSync(path.join(path.dirname(checkpoint), file), 'utf8').includes('test-private-value'));
  await assert.rejects(runSuite(suite, { checkpoint, mode: 'live', resume: true }), /Unresolved/);
});

test('checkpoint lock prevents concurrent execution and never removes an unfamiliar stale lock', async t => {
  const suite = compileSuite(EXAMPLE), checkpoint = temp(t); let release;
  const barrier = new Promise(resolve => { release = resolve; }); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const first = runSuite(suite, { checkpoint, transportFactory: recording([], async () => { entered(); await barrier; }) });
  await started;
  await assert.rejects(runSuite(suite, { checkpoint, resume: true }), /locked/);
  release(); await first; assert.equal(fs.existsSync(checkpoint + '.lock'), false);
  fs.writeFileSync(checkpoint + '.lock', '{"token":"unfamiliar"}');
  await assert.rejects(runSuite(suite, { checkpoint, resume: true }), /locked/);
  assert.equal(fs.readFileSync(checkpoint + '.lock', 'utf8'), '{"token":"unfamiliar"}');
});

test('explicit summary model retains its own credential alias instead of inheriting foreground alias', async t => {
  const suite = compileSuite(EXAMPLE); suite.schemes = [{ ...suite.schemes[2], credentialAlias: 'plan01', summaryModelId: 'summary' }];
  suite.models.summary = { ...suite.models.synthetic, credentialAlias: 'plan02' };
  const aliases = [];
  await runSuite(suite, { checkpoint: temp(t), transportFactory: options => { const transport = createTransport(options), run = transport.runModel; transport.runModel = args => { aliases.push({ role: args.meta.role, alias: options.model.credentialAlias }); return run(args); }; return transport; } });
  assert.ok(aliases.some(a => a.role === 'summary' && a.alias === 'plan02')); assert.ok(aliases.filter(a => a.role !== 'summary').every(a => a.alias === 'plan01'));
});


test('strict repair keeps every invalid draft and all paid attempts; main, H8 and natural QA share validation semantics', async t => {
  const raw = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')); raw.schemes = [{ ...raw.schemes[0], id: 'strict-repair', review: true }];
  raw.models.synthetic = { provider: 'openai-compatible', model: 'test-only', endpoint: 'https://example.invalid/v1', credentialAlias: 'plan01', maxTokens: 1024, rates: { input: 1, cachedInput: .1, output: 2, currency: 'CNY' }, usageSemantics: { inputIncludesCached: true, noCache: true } };
  raw.execution.maxModelRequests = null; raw.execution.maxToolCalls = null; raw.execution.budget.cap = 10;
  const suite = compileSuite(raw, { baseDir: path.dirname(EXAMPLE) }), checkpoint = temp(t), dir = path.dirname(checkpoint);
  suite.dataset.rounds = [suite.dataset.rounds[0]]; const round = suite.dataset.rounds[0]; round.globalTasks = []; round.decisions = round.decisions.slice(0, 2);
  for (const node of round.decisions) node.followups = [{ id: node.id + '.why', question: '解释当前建议。' }];
  const adapter = path.join(dir, 'strict.cjs'); fs.writeFileSync(adapter, "module.exports={version:1,buildContext(input){return {...input.baseline,qaResponseFormat:'analysis-json'};}};"); suite.schemes[0].context.module = adapter;
  const counts = new Map(), requests = [], bodies = [];
  const state = await runSuite(suite, { checkpoint, mode: 'live', credentialResolver: async () => 'only-local-fake-key', transportFactory: options => {
    let args;
    const transport = createTransport({ ...options, fetch: async (_url, init) => {
      const body = JSON.parse(init.body); assert.deepEqual(body.response_format, { type: 'json_object' }); bodies.push({ id: args.meta.requestId, role: args.meta.role, body });
      const key = args.meta.requestId, n = (counts.get(key) ?? 0) + 1; counts.set(key, n);
      const firstNode = args.meta.decisionId === round.decisions[0].id;
      const invalidLimit = firstNode ? (args.meta.role === 'initial' ? 18 : 1) : 0;
      const decision = { action: 'unknown', tile: args.prepared.data.outputConstraints.legalDiscards[0], reasons: ['测试冻结事实，第' + n + '次草稿。'], ...(n <= invalidLimit ? { actionNote: null } : {}) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ task: 'combined', danger: [], efficiency: [], decision, limitations: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) };
    } });
    const run = transport.runModel; transport.runModel = next => { args = next; requests.push({ id: next.meta.requestId, role: next.meta.role, messages: structuredClone(next.messages), timeoutMs: next.timeoutMs }); return run(next); }; return transport;
  } });
  assert.ok(state.results.every(r => r.status === 'success')); assert.equal(state.modelRequests, 26); assert.equal(state.ledger.records.length, 26);
  const initial = Object.values(state.requests).find(r => r.role === 'initial');
  assert.equal(initial.validationAttempts.length, 19); assert.deepEqual(initial.validation, { firstPassValid: false, repairRounds: 18, validated: true });
  assert.equal(initial.response.attempts.length, 19); assert.equal(initial.response.usageByAttempt.length, 19);
  assert.ok(Math.abs(initial.response.cost - 19 * .00003) < 1e-12);
  assert.ok(Math.abs(Object.values(state.requests).reduce((sum, r) => sum + r.response.cost, 0) - state.ledger.estimatedCost) < 1e-12);
  for (const request of Object.values(state.requests)) assert.ok(!request.response.text.includes('actionNote'));
  for (const request of Object.values(state.requests).filter(r => r.decisionId === round.decisions[0].id)) assert.equal(request.validation.firstPassValid, false);
  const feedback = requests.find(r => r.messages.at(-1).content.includes('code/path')).messages.at(-1).content;
  assert.ok(feedback.includes('extra_fields')); assert.ok(feedback.includes('decision')); assert.ok(feedback.includes('additionalProperties')); assert.ok(!feedback.includes('preferred'));
  const history = Object.values(state.histories)[0]; assert.equal(history.length, 2); assert.ok(history.every(h => !h.answerText.includes('actionNote')));
  const later = requests.find(r => r.id.includes(round.decisions[1].id) && r.role === 'initial'); assert.ok(!JSON.stringify(later.messages).includes('"actionNote":null'));
  const main = state.results.find(r => r.channel === 'main' && r.decisionId === round.decisions[0].id); assert.equal(main.validation.repairRounds, 19); assert.equal(main.validation.review.repairRounds, 1);
  assert.equal(state.validationReport.length, 6); assert.ok(requests.slice(0, 19).every((r, i, list) => i === 0 || r.timeoutMs < list[i - 1].timeoutMs));
  assert.ok(fs.readFileSync(path.join(dir, 'responses.private.jsonl'), 'utf8').includes('actionNote'));
});

test('strict repair stops at one logical deadline and retains invalid evidence without freezing bad history', async t => {
  const suite = compileSuite(EXAMPLE), checkpoint = temp(t); suite.schemes = [suite.schemes[0]]; suite.dataset.rounds = [suite.dataset.rounds[0]];
  const node = suite.dataset.rounds[0].decisions[0]; node.followups = []; suite.dataset.rounds[0].decisions = [node]; suite.dataset.rounds[0].globalTasks = [];
  suite.execution.timeoutMs = 220; suite.execution.maxModelRequests = null; suite.execution.maxToolCalls = null;
  let rounds = 0; const budgets = [];
  const state = await runSuite(suite, { checkpoint, transportFactory: options => {
    const transport = createTransport(options), run = transport.runModel;
    transport.runModel = async args => { rounds++; budgets.push(args.timeoutMs); await new Promise(resolve => setTimeout(resolve, 40)); args.mockText = JSON.stringify({ task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: node.legalActions[0].tile, reasons: ['第' + rounds + '次无效草稿'], actionNote: null }, limitations: [] }); return run(args); }; return transport;
  } });
  assert.equal(state.results[0].status, 'failed'); assert.equal(Object.values(state.histories).flat().length, 0); assert.ok(rounds >= 2 && rounds < 8);
  const request = Object.values(state.requests)[0]; assert.ok(request.validationAttempts.length >= 2); assert.equal(request.validation.validated, false); assert.equal(request.validation.firstPassValid, false);
  assert.ok(budgets.at(-1) < budgets[0]); assert.ok(request.validationAttempts.every(a => a.validation?.code === 'extra_fields'));
});


test('repair feedback preserves real tool exchanges and stops on provider failure without retrying invalid drafts', async t => {
  const raw = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')); raw.schemes = [raw.schemes[0]];
  raw.models.synthetic = { provider: 'openai-compatible', model: 'test-only', endpoint: 'https://example.invalid/v1', credentialAlias: 'plan01', maxTokens: 1024, rates: { input: 1, cachedInput: .1, output: 2, currency: 'CNY' }, usageSemantics: { inputIncludesCached: true, noCache: true } };
  raw.execution.maxModelRequests = null; raw.execution.maxToolCalls = null; raw.execution.budget.cap = 10;
  const suite = compileSuite(raw, { baseDir: path.dirname(EXAMPLE) }); suite.dataset.rounds = [suite.dataset.rounds[0]];
  const node = suite.dataset.rounds[0].decisions[0]; node.followups = []; suite.dataset.rounds[0].decisions = [node]; suite.dataset.rounds[0].globalTasks = [];
  let requests = 0; const bodies = [];
  const response = message => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) });
  const state = await runSuite(suite, { checkpoint: temp(t), mode: 'live', credentialResolver: async () => 'fake-secret', fetch: async (_url, init) => {
    requests++; const body = JSON.parse(init.body); bodies.push(body);
    if (requests === 1) return response({ role: 'assistant', content: null, tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'get_self_hand', arguments: '{}' } }] });
    if (requests === 2) return response({ role: 'assistant', content: '{bad JSON' });
    throw new Error('Provider response lost');
  } });
  assert.equal(requests, 3); assert.equal(state.results[0].status, 'failed'); assert.equal(state.ledger.unknownLiability, true);
  assert.equal(state.toolCalls, 1); assert.equal(Object.values(state.histories).flat().length, 0);
  const last = bodies[2].messages; assert.ok(last.some(m => m.role === 'tool' && m.tool_call_id === 'tool-1')); assert.ok(last.some(m => m.role === 'assistant' && m.content === '{bad JSON'));
  assert.ok(last.at(-1).content.includes('invalid_json'));
  const req = Object.values(state.requests)[0]; assert.equal(req.validationAttempts.length, 1); assert.equal(req.validation.repairRounds, 1); assert.equal(req.attempts.length, 3); assert.equal(req.status, 'unresolved');
});


test('H8 review cannot restart the initial logical deadline and total latency includes both phases', async t => {
  const suite = compileSuite(EXAMPLE), checkpoint = temp(t); suite.schemes = [{ ...suite.schemes[0], review: true }]; suite.dataset.rounds = [suite.dataset.rounds[0]];
  const node = suite.dataset.rounds[0].decisions[0]; node.followups = []; suite.dataset.rounds[0].decisions = [node]; suite.dataset.rounds[0].globalTasks = []; suite.execution.timeoutMs = 160;
  const calls = [];
  const state = await runSuite(suite, { checkpoint, transportFactory: options => {
    const transport = createTransport(options), run = transport.runModel; transport.runModel = async args => { calls.push({ role: args.meta.role, timeoutMs: args.timeoutMs }); await new Promise(resolve => setTimeout(resolve, args.meta.role === 'review' ? 170 : 25)); return run(args); }; return transport;
  } });
  assert.equal(calls.length, 2); assert.ok(calls[1].timeoutMs < calls[0].timeoutMs - 20);
  assert.equal(state.results[0].status, 'failed'); assert.ok(state.results[0].latencyMs >= 190);
  const requests = Object.values(state.requests); assert.equal(requests.find(r => r.role === 'initial').status, 'success'); assert.equal(requests.find(r => r.role === 'review').status, 'failed');
  assert.equal(Object.values(state.histories).flat().length, 0);
});


test('deterministic identical invalid answer and error terminate without a count cap or unpaid liability', async t => {
  const suite = compileSuite(EXAMPLE), checkpoint = temp(t); suite.schemes = [suite.schemes[0]]; suite.dataset.rounds = [suite.dataset.rounds[0]];
  const node = suite.dataset.rounds[0].decisions[0]; node.followups = []; suite.dataset.rounds[0].decisions = [node]; suite.dataset.rounds[0].globalTasks = []; suite.execution.maxModelRequests = null; suite.execution.maxToolCalls = null;
  let count = 0;
  const state = await runSuite(suite, { checkpoint, transportFactory: options => { const transport = createTransport(options), run = transport.runModel; transport.runModel = args => { count++; return run({ ...args, mockText: count === 1 ? '{missing bracket' : ' \r\n{ missing   bracket \r\n' }); }; return transport; } });
  const request = Object.values(state.requests)[0]; assert.equal(count, 2); assert.equal(request.validationAttempts.length, 2); assert.equal(request.termination.reason, 'deterministic_no_progress'); assert.equal(request.termination.duplicateOf, 0);
  assert.notEqual(request.validationAttempts[0].text, request.validationAttempts[1].text); assert.equal(request.validationAttempts[0].invalidHash, request.validationAttempts[1].invalidHash); assert.equal(request.validation.repairRounds, 1);
  assert.equal(state.ledger.unknownLiability, false); assert.equal(state.ledger.reserved, 0); assert.equal(state.results[0].status, 'failed'); assert.equal(Object.values(state.histories).flat().length, 0);
  assert.equal(state.validationReport[0].termination.reason, 'deterministic_no_progress');
});

test('remaining logical deadline too small prevents a new HTTP attempt instead of dispatching milliseconds of liability', async t => {
  const suite = compileSuite(EXAMPLE), checkpoint = temp(t); suite.schemes = [suite.schemes[0]]; suite.dataset.rounds = [suite.dataset.rounds[0]];
  const node = suite.dataset.rounds[0].decisions[0]; node.followups = []; suite.dataset.rounds[0].decisions = [node]; suite.dataset.rounds[0].globalTasks = []; suite.execution.timeoutMs = 1000; suite.execution.maxModelRequests = null; suite.execution.maxToolCalls = null;
  let count = 0;
  const state = await runSuite(suite, { checkpoint, transportFactory: options => { const transport = createTransport(options), run = transport.runModel; transport.runModel = async args => { count++; await new Promise(resolve => setTimeout(resolve, 925)); return run({ ...args, mockText: '{missing bracket' }); }; return transport; } });
  const request = Object.values(state.requests)[0]; assert.equal(count, 1); assert.equal(request.response, undefined); assert.equal(request.attempts.length, 1); assert.equal(request.termination.reason, 'insufficient_deadline_budget'); assert.equal(request.termination.minimumHttpRemainingMs, 100);
  assert.equal(state.ledger.unknownLiability, false); assert.equal(state.results[0].status, 'failed');
});


test('no-progress normalization preserves quoted semantic whitespace while ignoring JSON layout and key order', () => {
 const { normalizedInvalidText } = require('../benchmark/runner.cjs');
 assert.equal(normalizedInvalidText('{ "b": 2, "a": "x y" }'), normalizedInvalidText('{"a":"x y","b":2}'));
 assert.notEqual(normalizedInvalidText('{"a":"x y"'), normalizedInvalidText('{"a":"xy"'));
 assert.equal(normalizedInvalidText(' \r\n{ "a" : "x \\\" y" ' .replace(/\\r\\n/g,'\r\n')), normalizedInvalidText('{"a":"x \\\" y"'));
});
