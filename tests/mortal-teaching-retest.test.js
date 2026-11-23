'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stableHash } = require('../benchmark/core.cjs');
const { journal } = require('../benchmark/durable.cjs');
const { main, prepare, verify, smokePassed, smokeJson, retestReport, engineConfiguration, promptDirectory, legacyPromptDirectory, contractPromptDirectory, COPIED } = require('../benchmark/mortal-teaching/retest.cjs');
const { loadPrompts } = require('../benchmark/mortal-teaching/prompts.cjs');
const { schedule, validateEngineCache } = require('../benchmark/mortal-teaching/runner.cjs');
const { openBudget } = require('../benchmark/mortal-teaching/budget.cjs');
const { buildReport } = require('../benchmark/mortal-teaching/report.cjs');
const { RULES } = require('../benchmark/mortal-teaching/review.cjs');
function syntheticData(runtime = false) {
  let base;
  if (runtime) {
    const State = require('../extension/state.js'), Snapshot = require('../extension/collector/snapshot-adapter.js'), Mjai = require('../extension/adapters/mjai.js');
    const events = [{ kind: 'NewRound', source: 'live', step: 0, wind: 0, round: 0, honba: 0, sticks: 0, scores: [25000, 25000, 25000, 25000], remaining: 70, doras: ['4p'], hand: ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '1z', '1z', '1z', '2z'] }, { kind: 'DealTile', source: 'live', step: 1, seat: 0, tile: '9p', remaining: 69 }];
    const state = events.reduce((state, event) => State.apply(state, event), State.initial('live', 0));
    base = { provider: 'mjai', task: 'combined', lane: 'live', snapshot: Snapshot.snapshot(state, { game: true, rivers: 'all', hand: true }), engineRequest: Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'live', state, events }, { hand: true }), context: { identity: { matchId: 'fixture', roundStartId: 'round' }, position: 1, events, historyComplete: true, eventWindowStart: 0 } };
  }
  const nodes = Array.from({ length: 84 }, (_, i) => {
    const message = runtime ? { ...structuredClone(base), clientRunId: 'n' + i } : { fixture: true, decision: i };
    return { id: 'n' + i, roundId: 'round' + Math.floor(i / 8), position: i % 8, compatible: true, split: i < 24 ? 'development' : 'validation', message, inputHash: stableHash(message), legalActions: [{ action: 'discard', tile: '9p' }], decisionContext: { phase: 'draw', actor: 0 }, discardConstraints: { forbiddenTiles: [] } };
  });
  const body = { format: 'synthetic-retest-test', nodes };
  return { ...body, datasetHash: stableHash(body) };
}
function temporary(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mortal-retest-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
async function preparedFixture(t, runtime = false) {
  const root = temporary(t), source = path.join(root, 'source'), output = path.join(root, 'next'); fs.mkdirSync(source);
  const data = syntheticData(runtime); write(path.join(source, 'dataset.json'), data);
  const history = { datasetHash: data.datasetHash, rows: [] }; write(path.join(source, 'history-xf.json'), { ...history, historyHash: stableHash(history) });
  const supplement = { repeatNodes: data.nodes.slice(0, 18).map(n => n.id), followupNodes: data.nodes.slice(0, 3).map(n => n.id), questions: ['first', 'second'] }; write(path.join(source, 'supplement-plan.json'), supplement);
  const credentialsFile = path.join(root, 'credentials.json'); write(credentialsFile, { groups: [{ id: 'G', apiKey: 'synthetic-never-dispatched' }] });
  const authorization = { manifestId: 'synthetic-retest', approved: true, cap: 50, currency: 'CNY', allowedReferences: ['group:G'], credentialsFile, budgetDirectory: path.join(root, 'billing') };
  write(path.join(source, 'authorization.local.json'), authorization);
  const pricing = { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/chat/completions', currency: 'CNY', sourceSha256: 'a'.repeat(64), inputBound: 1048576, maxOutputTokens: 4096, rates: { cachedInput: 0.04, uncachedInput: 2, output: 8, unit: 'perMillion' } }; write(path.join(source, 'pricing.json'), pricing);
  const budget = openBudget({ directory: authorization.budgetDirectory, authorization, pricing, fetchImpl: async () => Response.json({ usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 } }) });
  await budget.request(pricing.endpoint, { body: JSON.stringify({ model: pricing.model, max_tokens: 4096, messages: [] }) }, { jobId: 'prior-spend', role: 'initial', ordinal: 1 }); budget.close();
  const contract = { datasetHash: data.datasetHash, manifestHash: loadPrompts().manifestHash, rulesHash: stableHash(RULES), authorizationHash: stableHash(authorization), pricingHash: stableHash(pricing), supplementPlanHash: stableHash(supplement), historyHash: stableHash(history), sampling: { temperature: 0, maxTokens: 4096, thinking: false } }; write(path.join(source, 'contract.json'), contract);
  const result = await prepare(source, output);
  return { root, source, output, result };
}
test('retest preparation preserves source bytes, shared ledger, five frozen candidates and pending real smoke', async t => {
  const { source, output, result } = await preparedFixture(t);
  assert.equal(result.developmentJobs, 120); assert.equal(result.development, 24); assert.equal(result.regression, 60); assert.equal(result.paidRequests, 0);
  const status = await main(['status', '--out', output]); assert.ok(status.billing.spent > 0 || status.billing.estimatedCost > 0 || status.billing.budgetCommitted > 0);
  for (const file of COPIED) assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(source, file)));
  const { contract } = verify(output, true);
  assert.equal(contract.counts.regression, 60); assert.equal(contract.candidateCount, 5); assert.equal(contract.smokeGate.initialState, 'pending'); assert.match(contract.stages.development, /persistent variant\/round/);
  assert.deepEqual(contract.experiments.map(v => v.id), ['p0-release-v2', 'r1-facts', 'r2-history', 'r3-json', 'r4-honors-zh']);
  assert.throws(() => smokePassed(output, contract));
  await assert.rejects(main(['run-development', '--out', output, '--engine-config', path.join(output, 'missing.json')]));
  await assert.rejects(main(['select', '--out', output, '--winner', 'p0-release-v2']));
  await assert.rejects(prepare(source, output), /already exists/);
  const data = JSON.parse(fs.readFileSync(path.join(output, 'dataset.json'))); data.nodes[0].id += '-changed'; write(path.join(output, 'dataset.json'), data);
  assert.throws(() => verify(output), /changed|hash|dataset/i);
});
test('regression schedules concurrent P0/winner, P0 fallback has 60; development history is ascending', async () => {
  const data = syntheticData(), variants = loadPrompts(promptDirectory).variants;
  assert.equal(schedule(data, variants, 'development', undefined, true).length, 120);
  assert.equal(schedule(data, variants, 'regression', 'r2-history').length, 120);
  assert.equal(schedule(data, variants, 'regression', 'p0-release-v2').length, 60);
  const jobs = schedule({ nodes: [...data.nodes].reverse() }, variants, 'development', undefined, true).filter(j => j.variant === 'r2-history');
  const nodes = new Map(data.nodes.map(n => [n.id, n]));
  for (let i = 1; i < jobs.length; i++) if (jobs[i].roundId === jobs[i - 1].roundId) assert.ok(nodes.get(jobs[i].nodeId).position > nodes.get(jobs[i - 1].nodeId).position);
});
test('cache reuse binds dataset/input/profile/identity and rejects mock runtime', t => {
  const output = temporary(t), data = { datasetHash: 'frozen', nodes: [{ id: 'n', inputHash: 'i', compatible: true, split: 'development' }] };
  const config = { engineProfile: 'yuchen-582500', endpoint: 'http://127.0.0.1:17342/analyze', model: 'Yuchen1457-mortal-v4-582500' };
  write(path.join(output, 'engine-cache-contract.json'), { datasetHash: data.datasetHash, profile: config.engineProfile, endpoint: config.endpoint, model: config.model });
  const log = journal(path.join(output, 'engine-cache.jsonl'));
  log.write('dispatch', { nodeId: 'n', inputHash: 'i' });
  log.write('result', { nodeId: 'n', inputHash: 'i', result: { engine: { action: { type: 'discard' }, identity: require('../benchmark/mortal-teaching/mock.cjs').IDENTITY } } });
  assert.throws(() => validateEngineCache(output, data, config), /Mock cache/);
  assert.throws(() => validateEngineCache(output, data, { ...config, endpoint: 'http://127.0.0.1:2/analyze' }), /binding/);
  assert.throws(() => validateEngineCache(output, { ...data, nodes: [{ ...data.nodes[0], inputHash: 'modified' }] }, config), /input/);
  const configFile = path.join(output, 'config.json'); write(configFile, { ...config, apiKey: 'synthetic' }); assert.equal(engineConfiguration(configFile).engineProfile, 'yuchen-582500');
  write(configFile, { ...config, apiKey: 'synthetic', endpoint: 'https://example.com/analyze' }); assert.throws(() => engineConfiguration(configFile), /loopback/);
});
test('mock smoke proof cannot authorize selection; opportunity denominator includes nondelivery', async t => {
  const { output } = await preparedFixture(t), { contract } = verify(output);
  write(path.join(output, 'json-smoke.json'), { passed: true, mock: true, batchId: contract.batchId, manifestHash: contract.manifestHash, logHash: stableHash([]) });
  assert.throws(() => smokePassed(output, contract), /pending|invalid/);
  const directory = path.join(output, 'live', 'development'); fs.mkdirSync(directory, { recursive: true });
  write(path.join(directory, 'schedule.json'), { datasetHash: contract.datasetHash, manifestHash: contract.manifestHash, jobs: [{ id: 'a', variant: 'p0-release-v2', roundId: 'r' }, { id: 'b', variant: 'p0-release-v2', roundId: 'r' }] });
  const log = journal(path.join(directory, 'results.jsonl')); log.write('result', { id: 'a', variant: 'p0-release-v2', roundId: 'r', delivered: false, elapsedMs: 1, outcome: { error: 'failed' } });
  const report = buildReport(output, 'development'); assert.equal(report.groups['p0-release-v2'].planned, 2); assert.equal(report.groups['p0-release-v2'].qualityPassRate, 0); assert.equal(report.groups['p0-release-v2'].commonMean, null); assert.equal(report.groups['p0-release-v2'].notAttempted, 1);
  const nextReport = retestReport(output, 'development'); assert.equal(nextReport.groups['p0-release-v2'].endToEndCommonMean, null);
  log.write('result', { id: 'b', variant: 'p0-release-v2', roundId: 'r', delivered: false, elapsedMs: 1, outcome: { error: 'failed' } });
  assert.equal(retestReport(output, 'development').groups['p0-release-v2'].endToEndCommonMean, 0);
});
test('smoke CLI logic exercises real Worker/Pi/tool sequence and budget with synthetic HTTP, rejecting missing usage', async t => {
  for (const missingUsage of [false, true]) {
    const { output } = await preparedFixture(t, true), { data, contract } = verify(output);
    const engineConfig = { model: 'Yuchen1457-mortal-v4-582500', engineProfile: 'yuchen-582500', endpoint: 'http://127.0.0.1:17342/analyze', apiKey: 'synthetic-engine-secret' };
    write(path.join(output, 'engine-cache-contract.json'), { datasetHash: data.datasetHash, profile: engineConfig.engineProfile, endpoint: engineConfig.endpoint, model: engineConfig.model });
    const identity = { ...require('../benchmark/mortal-teaching/mock.cjs').IDENTITY, runtime: 'SYNTHETIC-TEST-FIXTURE-NO-REAL-INFERENCE' };
    const result = await require('../extension/engine-agent.js').run({ snapshot: data.nodes[0].message.snapshot, request: data.nodes[0].message.engineRequest, expectedProfile: 'yuchen-582500', infer: async () => ({ action: { type: 'dahai', actor: 0, pai: '9p', tsumogiri: true }, identity }) });
    const log = journal(path.join(output, 'engine-cache.jsonl'));
    for (const node of data.nodes.filter(n => n.split === 'development')) { log.write('dispatch', { nodeId: node.id, inputHash: node.inputHash }); log.write('result', { nodeId: node.id, inputHash: node.inputHash, result }); }
    const bodies = [];
    const fetchImpl = async (url, options) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      const body = JSON.parse(options.body); bodies.push(body);
      assert.equal(body.response_format.type, 'json_object');
      const hasTools = body.tools?.length > 0;
      if (bodies.length === 1) assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'get_self_hand' } });
      else if (hasTools) assert.equal(body.tool_choice, 'auto');
      else assert.equal(Object.hasOwn(body, 'tool_choice'), false);
      const message = hasTools ? { content: null, tool_calls: [{ id: 'synthetic-tool-' + bodies.length, type: 'function', function: { name: 'get_self_hand', arguments: '{}' } }] }
        : { content: JSON.stringify({ summary: '合成测试教学。', reasons: ['仅用于离线链路检验。'], limitations: ['没有真实推理。'] }) };
      return Response.json({ choices: [{ finish_reason: hasTools ? 'tool_calls' : 'stop', message }], ...(!missingUsage || hasTools ? { usage: { prompt_tokens: 100, completion_tokens: 30, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 } } : {}) });
    };
    const proof = await smokeJson({ output, engineConfig, fetchImpl });
    assert.equal(proof.passed, !missingUsage, JSON.stringify(proof));
    assert.ok(bodies.length >= 2); assert.equal(bodies.at(-1).tools, undefined);
    assert.equal(proof.checks.realToolCall, true); assert.equal(proof.checks.toolContinuation, true); assert.equal(proof.checks.strictJson, true);
    assert.equal(proof.checks.reconciledUsage, !missingUsage);
    if (missingUsage) assert.throws(() => smokePassed(output, contract), /pending|invalid/);
    else assert.equal(smokePassed(output, contract).passed, true);
    await assert.rejects(smokeJson({ output, engineConfig, fetchImpl }), /already started/);
  }
});


test('Chinese-honor candidate inherits four frozen prompts and adds only R1 encoding treatment', () => {
  const previous = loadPrompts(legacyPromptDirectory), current = loadPrompts(promptDirectory);
  assert.deepEqual(current.manifest.variants.slice(0, 4), previous.manifest.variants);
  for (const variant of previous.variants) assert.deepEqual(fs.readFileSync(path.join(promptDirectory, variant.file)), fs.readFileSync(path.join(legacyPromptDirectory, variant.file)));
  const candidate = current.variants.at(-1), r1 = previous.variants.find(v => v.id === 'r1-facts');
  assert.ok(candidate.text.startsWith(r1.text));
  assert.deepEqual(candidate.experiment, { factCard: true, isolateAutomaticHistory: false, jsonObject: false, honorChinese: true });
  assert.match(candidate.text.slice(r1.text.length), /snapshot-v1/);
  assert.equal(current.manifest.inheritedSource.manifestSha256, require('../benchmark/mortal-teaching/prompts.cjs').sha256(fs.readFileSync(path.join(legacyPromptDirectory, 'manifest.json'))));
});

test('new contracts bind five report groups; old fieldless contracts remain readable with their four-candidate manifest', async t => {
  const { output } = await preparedFixture(t), { contract, data, prompts } = verify(output);
  assert.equal(contract.promptDirectory, 'benchmark/prompts/mortal-teaching-20261106-honors');
  assert.equal(contractPromptDirectory(contract), promptDirectory);
  const directory = path.join(output, 'live', 'development'); fs.mkdirSync(directory, { recursive: true });
  const reportFor = async variants => {
    const jobs = schedule(data, variants, 'development', undefined, true);
    write(path.join(directory, 'schedule.json'), { datasetHash: data.datasetHash, manifestHash: contract.manifestHash, jobs });
    return main(['report', '--out', output]);
  };
  const current = await reportFor(prompts.variants);
  assert.equal(Object.keys(current.groups).length, 5);
  assert.ok(Object.values(current.groups).every(group => group.planned === 24));
  const previous = loadPrompts(legacyPromptDirectory);
  delete contract.promptDirectory;
  contract.manifestHash = previous.manifestHash;
  contract.experiments = previous.variants.map(v => ({ id: v.id, experiment: v.experiment || {} }));
  contract.code = { frozenBeforeThisChange: true };
  write(path.join(output, 'contract.json'), contract);
  assert.equal(verify(output).prompts.variants.length, 4);
  assert.equal(contractPromptDirectory(contract), legacyPromptDirectory);
  assert.equal((await main(['status', '--out', output])).alreadyExamined, true);
  assert.equal(Object.keys((await reportFor(previous.variants)).groups).length, 4);
  assert.throws(() => verify(output, true), /Prepared code changed/);
  for (const value of ['../mortal-teaching-20261106-honors', path.resolve(promptDirectory), 'benchmark/prompts/unknown']) {
    assert.throws(() => contractPromptDirectory({ promptDirectory: value }), /Unknown frozen/);
  }
  assert.equal(contractPromptDirectory({ promptDirectory: 'benchmark/prompts/mortal-teaching-20261106' }), legacyPromptDirectory);
});


test('honor encoding report compares R4 only with R1 and requires matching engine actions', async t => {
  const { output } = await preparedFixture(t), { contract, data, prompts } = verify(output);
  const directory = path.join(output, 'live', 'development'); fs.mkdirSync(directory, { recursive: true });
  const jobs = schedule(data, prompts.variants, 'development', undefined, true);
  write(path.join(directory, 'schedule.json'), { datasetHash: data.datasetHash, manifestHash: contract.manifestHash, jobs });
  const log = journal(path.join(directory, 'results.jsonl'));
  for (const variant of ['r1-facts', 'r4-honors-zh']) for (let index = 0; index < 3; index++) {
    const job = jobs.find(j => j.variant === variant && j.nodeId === 'n' + index);
    log.write('result', { ...job, delivered: index === 2, elapsedMs: 1,
      outcome: { engine: { action: { type: 'discard', tile: index === 1 && variant === 'r4-honors-zh' ? '8p' : '9p' } } } });
  }
  const report = retestReport(output, 'development'), comparison = report.encodingComparison;
  assert.equal(comparison.source, 'r1-facts'); assert.equal(comparison.target, 'r4-honors-zh');
  assert.equal(comparison.ties, 1); assert.equal(comparison.actionMismatch, 1); assert.equal(comparison.pending, 22);
  assert.equal(comparison.wins, 0); assert.equal(comparison.losses, 0);
  assert.equal(comparison.sourceMetrics.planned, 24); assert.equal(comparison.targetMetrics.planned, 24);
  assert.equal(comparison.pairedCommonMeanDelta, null); assert.equal(comparison.pairedScored, 0);
  assert.ok(report.pairs['r4-honors-zh']);
});
