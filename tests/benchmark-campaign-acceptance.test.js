'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compileSuite } = require('../benchmark/core.cjs');
const { runSuite } = require('../benchmark/runner.cjs');
const { createTransport } = require('../benchmark/transport.cjs');
const { createLedger } = require('../benchmark/accounting.cjs');

test('registered branch identifiers preserve plus signs without accepting paths or whitespace', () => {
  const { validateSuite } = require('../benchmark/core.cjs');
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../benchmark/examples/suite.mock.json'), 'utf8'));
  for (const id of ['branch-KM-code+freetext', 'branch-H7-code+typed']) {
    const value = validateSuite({ ...base, schemes: [{ ...base.schemes[0], id }] });
    assert.equal(value.schemes[0].id, id);
  }
  for (const id of ['branch/foo', 'branch\\foo', 'branch foo', '+branch']) assert.throws(() => validateSuite({ ...base, schemes: [{ ...base.schemes[0], id }] }));
});

test('provider liability contract is suite-bound and rejects an output cap beyond its documented ceiling', () => {
  const { validateSuite } = require('../benchmark/core.cjs');
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../benchmark/examples/suite.mock.json'), 'utf8'));
  const name = Object.keys(base.models)[0], bound = { inputTokens: 1048576, outputTokens: 4096, contractHash: 'b'.repeat(64) };
  const raw = { ...base, models: { ...base.models, [name]: { ...base.models[name], maxTokens: 4096, liabilityBound: bound } } };
  assert.deepEqual(validateSuite(raw).models[name].liabilityBound, bound);
  for (const liabilityBound of [{ ...bound, outputTokens: 4095 }, { ...bound, inputTokens: 1.5 }, { ...bound, contractHash: 'unbound' }]) {
    assert.throws(() => validateSuite({ ...raw, models: { ...raw.models, [name]: { ...raw.models[name], liabilityBound } } }));
  }
});

test('every campaign analysis-json policy shares the explicit output contract and strict parsing rejects extra fields', () => {
  const { buildContext, ANALYSIS_JSON_CONTRACT } = require('../benchmark/context.cjs');
  const { buildCampaignContext, VERSION } = require('../benchmark/campaign-policies.cjs');
  const base = compileSuite(path.join(__dirname, '../benchmark/examples/suite.mock.json'));
  const node = base.dataset.rounds[0].decisions[0];
  const prepared = buildContext({ scheme: { id: 'fixture', context: {} }, node, history: [], events: [] }).prepared;
  const source = { baseline: { position: node.position, origin: 'mid-round', snapshot: node.snapshot }, events: [], observations: [] };
  const policies = ['A', 'B', 'B-current', 'B-dedup', 'D', 'E', 'G', 'K', 'M', 'KM', 'H1', 'H2', 'H2-dedup', 'H3', 'H4', 'H4-advice', 'H5', 'H6', 'H7', 'H8', 'Factorial-S1A0', 'Factorial-S1A1', ...['SnapshotHistory', 'AdviceHistory'].flatMap(c => ['Truncate', 'Extract', 'CodeCompress', 'LLMCompress', 'Hybrid'].map(t => `${c}-${t}`))];
  const answer = { task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: node.legalActions[0].tile, reasons: ['风险未知。'] }, limitations: [] };
  const inputs = policy => ({ scheme: { id: policy }, options: { version: VERSION, policy }, node, prepared, history: [], summary: [], events: [] });
  for (const policy of policies) for (const channel of ['realtime', 'decision-discussion']) {
    const context = buildCampaignContext({ ...inputs(policy), channel, originalAnswer: answer, branchHistory: [], question: '解释依据。' }, source);
    assert.equal(context.messages[0].content.split(ANALYSIS_JSON_CONTRACT).length - 1, 1, `${policy}/${channel}`);
    if (['B', 'B-current'].includes(policy) && channel === 'realtime') {
      assert.equal(context.historyPolicy.exactProduction, false);
      assert.equal(context.historyPolicy.productionEnvelopeExact, true);
    }
  }
  const parse = require('../benchmark/runner.cjs').validateAnswer;
  assert.deepEqual(parse(JSON.stringify(answer), { prepared }, node), answer);
  const extra = structuredClone(answer); extra.decision.actionNote = null;
  assert.throws(() => parse(JSON.stringify(extra), { prepared }, node), error => error.validation?.code === 'extra_fields' && error.validation.path === 'decision');
  assert.equal(extra.decision.actionNote, null);
});

test('strict repair rejects unsupported safe evidence without locally rewriting the invalid draft', async t => {
  const { buildContext } = require('../benchmark/context.cjs');
  const suite = compileSuite(path.join(__dirname, '../benchmark/examples/suite.mock.json'));
  suite.schemes = [suite.schemes[0]]; suite.dataset.rounds = [suite.dataset.rounds[0]];
  const round = suite.dataset.rounds[0], node = round.decisions[0];
  node.followups = []; round.globalTasks = []; round.decisions = [node];
  const prepared = buildContext({ scheme: { id: 'fixture', context: {} }, node, events: [], history: [] }).prepared;
  const candidate = prepared.data.localAnalysis.danger.candidates.find(c => c.opponents.some(o => !o.genbutsu));
  const opponent = candidate.opponents.find(o => !o.genbutsu);
  const invalid = JSON.stringify({ task: 'combined', danger: [{ tile: candidate.tile, opponents: [{ seat: opponent.seat, level: 'safe', reasons: ['无依据安全声明，测试必须拒绝。'] }] }], efficiency: [], decision: { action: 'unknown', tile: node.legalActions[0].tile, reasons: ['风险未知。'] }, limitations: [] });
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'independent-strict-evidence-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  let calls = 0; const feedback = [];
  const state = await runSuite(suite, { checkpoint: path.join(folder, 'checkpoint.json'), transportFactory: options => {
    const transport = createTransport(options), original = transport.runModel;
    transport.runModel = args => { feedback.push(structuredClone(args.messages)); if (++calls === 1) args.mockText = invalid; return original(args); }; return transport;
  } });
  const request = Object.values(state.requests)[0];
  assert.equal(calls, 2); assert.equal(state.results[0].status, 'success');
  assert.equal(request.validationAttempts[0].text, invalid);
  assert.equal(request.validationAttempts[0].validation.code, 'unsupported_safe');
  assert.equal(request.validation.firstPassValid, false); assert.equal(request.validation.repairRounds, 1);
  assert.ok(feedback[1].at(-1).content.includes('unsupported_safe'));
  assert.ok(!Object.values(state.histories)[0][0].answerText.includes('无依据安全声明'));
});

test('near-budget shared-quota summary admission yields to foreground without poisoning shared paid ledger', async () => {
  const rates = { cachedInput: 0.04, uncachedInput: 2, output: 8, unit: 'perMillion' };
  const ledger = createLedger({ cap: 0.05, currency: 'CNY', rates });
  let dispatched = 0;
  const transport = createTransport({ mode: 'real', ledger, model: { model: 'offline-fixture', endpoint: 'https://fixture.invalid', credentialRef: 'env:FAKE', currency: 'CNY', rates, maxTokens: 4096 }, credentialResolver: async () => 'fake-not-a-real-key',
    beforeRequest: ({ meta, ledger: state }) => { if (meta?.role === 'summary' && state.estimatedCost + state.reserved + 0.03 > 0.05) { const denied = new Error('protect foreground'); denied.code = 'BENCHMARK_ADMISSION_DENIED'; throw denied; } },
    fetch: async () => { dispatched++; return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'foreground answer' } }], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 } }) }; } });
  await assert.rejects(transport.request({ meta: { role: 'summary' } }), error => error.code === 'BENCHMARK_ADMISSION_DENIED');
  assert.equal(dispatched, 0); assert.equal(ledger.snapshot().blockedReason, null); assert.equal(ledger.snapshot().reserved, 0); assert.equal(ledger.snapshot().unknownLiability, false);
  assert.equal((await transport.request({ meta: { role: 'initial' } })).text, 'foreground answer'); assert.equal(dispatched, 1);
});

test('formal source materializer refuses a complete-looking mock checkpoint before writing any frozen source', t => {
  const campaign = path.resolve(__dirname, '../research/evidence/context-optimization-20261026/campaign');
  const script = path.join(campaign, 'freeze-source-and-prepare-stages.cjs');
  // Private campaign assets are optional in a clean public checkout; generic tests remain portable.
  if (!fs.existsSync(script) || !fs.existsSync(path.join(campaign, 'source-prepare.plan.proposed.json'))) { t.skip('Private campaign preparation assets unavailable'); return; }
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-reject-mock-source-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const checkpoint = path.join(folder, 'checkpoint.json'), frozen = path.join(campaign, 'source.frozen.json');
  const existed = fs.existsSync(frozen), prior = existed ? fs.readFileSync(frozen) : null;
  fs.writeFileSync(checkpoint, JSON.stringify({ status: 'complete', manifest: { mode: 'mock', synthetic: true, fingerprint: 'not-actual-source', authorizationHash: 'fixture' }, histories: {}, results: [], requests: {}, ledger: { unknownLiability: false } }));
  const outcome = spawnSync(process.execPath, [script, '--source-checkpoint', checkpoint], { encoding: 'utf8' });
  assert.notEqual(outcome.status, 0); assert.match(outcome.stderr, /source|Source|registered/);
  const { stableHash } = require('../benchmark/core.cjs'), { fingerprint } = require('../benchmark/runner.cjs');
  const sourceSuite = compileSuite(path.join(campaign, 'suite.source-prepare.proposed.json'));
  const authorizationHash = stableHash(null), sourceFingerprint = stableHash({ sourceFingerprint: fingerprint(sourceSuite), authorizationHash, fixedSourceHash: stableHash(null), seededBranchHash: stableHash(null), campaignKind: 'shared-setup' });
  fs.writeFileSync(checkpoint, JSON.stringify({ status: 'complete', manifest: { mode: 'live', synthetic: false, suiteId: sourceSuite.id, campaignKind: 'shared-setup', fingerprint: sourceFingerprint, authorizationHash }, histories: { incomplete: [] }, results: [], requests: {}, ledger: { unknownLiability: false, blockedReason: null } }));
  const partial = spawnSync(process.execPath, [script, '--source-checkpoint', checkpoint], { encoding: 'utf8' });
  assert.notEqual(partial.status, 0); assert.match(partial.stderr, /all43|registered preparation code changed/);
  assert.equal(fs.existsSync(frozen), existed); if (existed) assert.deepEqual(fs.readFileSync(frozen), prior);
});

test('H8 review is a fresh H4 factual context and natural QA receives only its frozen final plus own paired branch', async t => {
  const base = compileSuite(path.join(__dirname, '../benchmark/examples/suite.mock.json'));
  const source = structuredClone(base.dataset.rounds[0]); source.decisions = source.decisions.slice(0, 2); source.globalTasks = [];
  source.decisions.forEach(node => { node.followups = [{ id: 'why', question: '解释依据。' }, { id: 'compare', question: '比较候选。' }]; });
  const initial = structuredClone(source.decisions[0].snapshot); initial.lastStep = 0;
  const roundSource = { baseline: { position: 0, origin: 'round-start', snapshot: initial }, events: [], observations: [], states: [] };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-acceptance-h8-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const policyPath = path.join(__dirname, '../benchmark/campaign-policies.cjs');
  fs.writeFileSync(path.join(folder, 'adapter.cjs'), `const P=require(${JSON.stringify(policyPath)});module.exports={version:1,buildContext:input=>P.buildCampaignContext(input,${JSON.stringify(roundSource)})};`);
  const { VERSION } = require('../benchmark/campaign-policies.cjs');
  const scheme = policy => ({ id: policy, modelId: 'synthetic', review: policy === 'H8', context: { module: './adapter.cjs', options: { version: VERSION, policy, recent: 4, trigger: 1, ordinaryEventWindow: 12, checkpointEvery: 4, extractLimit: 4 } } });
  const suite = { ...base, baseDir: folder, dataset: { ...base.dataset, rounds: [source] }, schemes: [scheme('H4'), scheme('H8')] };
  const calls = [];
  const state = await runSuite(suite, { checkpoint: path.join(folder, 'checkpoint.json'), transportFactory: options => {
    const transport = createTransport(options), original = transport.runModel;
    transport.runModel = async args => { calls.push({ meta: args.meta, messages: structuredClone(args.messages) }); return original(args); }; return transport;
  } });
  assert.ok(state.results.every(row => row.status === 'success'));
  assert.equal(calls.filter(c => c.meta.role === 'review').length, 2);
  for (const review of calls.filter(c => c.meta.role === 'review')) {
    assert.ok(review.messages[0].content.includes(require('../benchmark/context.cjs').ANALYSIS_JSON_CONTRACT));
    const initial = calls.find(c => c.meta.schemeId === 'H8' && c.meta.decisionId === review.meta.decisionId && c.meta.role === 'initial');
    assert.deepEqual(review.messages.slice(0, -1), initial.messages);
    assert.match(review.messages.at(-1).content, /unverified model draft/);
    assert.equal(review.messages.filter(m => m.role === 'assistant').length, 0);
  }
  for (const qa of calls.filter(c => c.meta.role === 'followup')) {
    assert.equal(qa.messages.filter(m => m.role === 'assistant').length, qa.meta.requestId.includes('compare') ? 2 : 1);
    assert.ok(qa.messages[1].content.includes('initialSnapshot'));
    const current = JSON.parse(qa.messages[2].content.split('\n').slice(1).join('\n'));
    assert.equal(current.position, source.decisions.find(n => n.id === qa.meta.decisionId).position);
  }
});
