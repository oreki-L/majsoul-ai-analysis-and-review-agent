'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stableHash } = require('../benchmark/core.cjs');
const { openBudget } = require('../benchmark/mortal-teaching/budget.cjs');
const { loadPrompts } = require('../benchmark/mortal-teaching/prompts.cjs');
const { createQueue, validateReview, COMMON } = require('../benchmark/mortal-teaching/review.cjs');
const { createHarness } = require('../benchmark/mortal-teaching/harness.cjs');
const { createMock } = require('../benchmark/mortal-teaching/mock.cjs');
const { schedule, factsFor, runStage, cacheEngines } = require('../benchmark/mortal-teaching/runner.cjs');
const { mask } = require('../benchmark/mortal-teaching/dataset.cjs');
const { buildReport } = require('../benchmark/mortal-teaching/report.cjs');
const { runSupplement, QUESTIONS } = require('../benchmark/mortal-teaching/supplement.cjs');
const State = require('../extension/state.js');
const Snapshot = require('../extension/collector/snapshot-adapter.js');
const Mjai = require('../extension/adapters/mjai.js');
const temp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mortal-teaching-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const pricing = { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/chat/completions', currency: 'CNY', sourceSha256: 'a'.repeat(64),
  inputBound: 1048576, maxOutputTokens: 4096, rates: { cachedInput: 0.04, uncachedInput: 2, output: 8, unit: 'perMillion' } };
const authorization = { manifestId: 'test-independent-50', approved: true, cap: 50, currency: 'CNY' };
const wire = { method: 'POST', body: JSON.stringify({ model: pricing.model, max_tokens: 4096, messages: [] }) };
const attempt = n => ({ jobId: 'job', role: 'initial', ordinal: n });
function fixture() {
  const events = [{ kind: 'NewRound', source: 'live', step: 0, wind: 0, round: 0, honba: 0, sticks: 0, scores: [25000, 25000, 25000, 25000], remaining: 70, doras: ['4p'], hand: ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '1z', '1z', '1z', '2z'] },
    { kind: 'DealTile', source: 'live', step: 1, seat: 0, tile: '9p', remaining: 69 }];
  const state = events.reduce((s, e) => State.apply(s, e), State.initial('live', 0));
  const message = { provider: 'mjai', task: 'combined', lane: 'live', snapshot: Snapshot.snapshot(state, { game: true, rivers: 'all', hand: true }),
    engineRequest: Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'live', state, events }, { hand: true }),
    context: { identity: { matchId: 'fixture', roundStartId: 'round' }, position: 1, events, historyComplete: true, eventWindowStart: 0 } };
  return { id: 'node', roundId: 'round', position: 1, compatible: true, split: 'development', message,
    inputHash: stableHash(message), legalActions: [{ action: 'discard', tile: '9p' }], decisionContext: { phase: 'draw', actor: 0 }, discardConstraints: { forbiddenTiles: [] } };
}
const engineConfig = { model: 'Yuchen1457-mortal-v4-582500', engineProfile: 'yuchen-582500', endpoint: 'http://127.0.0.1:17342/analyze', apiKey: 'fake-engine-private' };
function harness(variant, options = {}) {
  const node = fixture(), mock = createMock({ nodes: [node] }, options);
  const h = createHarness({ variant, engineConfig, llmConfig: { endpoint: pricing.endpoint, model: pricing.model, apiKey: 'fake-llm-private' }, fetchModel: mock.fetch });
  return { h, node, mock };
}
test('all four frozen prompts run real product Worker/Pi, tools, staged action and persist exact output', async () => {
  for (const variant of loadPrompts().variants) {
    const { h, node, mock } = harness(variant);
    const result = await h.worker.analyze(node.message, 1);
    assert.equal(result.ok, true, result.error); assert.equal(result.explanation.status, 'completed', result.explanation.error);
    assert.equal(h.stages.length, 1); assert.equal(h.stages[0].analysis.result.decision.tile, '9p');
    assert.equal(result.result.decision.tile, '9p'); assert.deepEqual(mock.counts(), { engines: 1, llm: 2 });
    assert.equal(h.traces[0].candidateSha256, variant.sha256); assert.equal(h.traces[0].toolResults.length, 1);
    const facts = factsFor(node, result.engine, h);
    assert.ok(facts.toolResults.length); assert.doesNotMatch(JSON.stringify(facts), /fake-engine-private|fake-llm-private|Yuchen1457|MOCK-NO-REAL/);
    assert.equal((await h.discussions.get(result.discussionRecord.id)).analysis.explanation.summary, result.explanation.summary);
  }
});
test('LLM failure retains published engine action; retry/follow-up never rerun engine', async () => {
  const variant = loadPrompts().variants[0], { h, node, mock } = harness(variant, { failLlm: true });
  const result = await h.worker.analyze(node.message, 1);
  assert.equal(result.explanation.status, 'failed'); assert.equal(result.result.decision.tile, '9p');
  await h.worker.analyze({ provider: 'chat', discussionId: result.discussionRecord.id, retryExplanation: true, selection: { hand: true, game: true, rivers: 'all' } }, 1);
  assert.equal(mock.counts().engines, 1); assert.equal(mock.counts().llm, 2);
});
test('separate candidates cannot inherit another candidate teaching history', async () => {
  const variants = loadPrompts().variants;
  const first = harness(variants[0]), second = harness(variants[1]);
  await first.h.worker.analyze(first.node.message, 1); await second.h.worker.analyze(second.node.message, 1);
  assert.doesNotMatch(JSON.stringify(second.h.traces[0].messages), /仅用于验证链路的模拟教学/);
  assert.equal((await first.h.discussions.list()).length, 1); assert.equal((await second.h.discussions.list()).length, 1);
});
test('no real fetch for cap exhaustion, unknown usage, restart or duplicate physical attempt', async t => {
  const directory = temp(t); let calls = 0;
  const b = openBudget({ directory, authorization, pricing, fetchImpl: async () => { calls++; return Response.json({ choices: [] }); } });
  await b.request(pricing.endpoint, wire, attempt(1));
  assert.equal(b.snapshot().reserved, 2.12992); assert.equal(b.snapshot().estimatedCost, 0);
  await assert.rejects(b.request(pricing.endpoint, wire, attempt(2)), /Unsettled/); b.close();
  const reopened = openBudget({ directory, authorization, pricing, fetchImpl: async () => { calls++; } });
  await assert.rejects(reopened.request(pricing.endpoint, wire, attempt(1)), /Unsettled/);
  assert.equal(reopened.snapshot().reserved, 2.12992); reopened.close(); assert.equal(calls, 1);
});
test('each known usage settles durably; same attempt cannot dispatch twice', async t => {
  const directory = temp(t); let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json({ usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 200, prompt_cache_miss_tokens: 800, completion_tokens: 100 } }); };
  const b = openBudget({ directory, authorization, pricing, fetchImpl });
  await b.request(pricing.endpoint, wire, attempt(1)); assert.equal(b.snapshot().estimatedCost, 0.002408);
  await assert.rejects(b.request(pricing.endpoint, wire, attempt(1)), /already dispatched/); b.close();
  const b2 = openBudget({ directory, authorization, pricing, fetchImpl });
  await assert.rejects(b2.request(pricing.endpoint, wire, attempt(1)), /already dispatched/); assert.equal(calls, 1); b2.close();
});
test('full-context reservation enforces CNY50 across independent jobs and refuses changed contracts', async t => {
  const directory = temp(t); let calls = 0;
  // With the published maximum context charged on each response, only 23 fit.
  const b = openBudget({ directory, authorization, pricing, fetchImpl: async () => { calls++; return Response.json({ usage: { prompt_tokens: 1048576, prompt_cache_hit_tokens: 0, completion_tokens: 4096 } }); } });
  for (let i = 1; i <= 23; i++) await b.request(pricing.endpoint, wire, attempt(i));
  await assert.rejects(b.request(pricing.endpoint, wire, attempt(24)), /Budget cap/); assert.equal(calls, 23); b.close();
  assert.throws(() => openBudget({ directory, authorization, pricing: { ...pricing, maxOutputTokens: 2048 } }), /contract changed/);
});
test('preparation versions share one campaign cap and cannot move their ledger to reset spending', async t => {
  const directory = temp(t), scoped = { ...authorization, budgetDirectory: directory };
  const fetchImpl = async () => Response.json({ usage: { prompt_tokens: 1048576, prompt_cache_hit_tokens: 0, completion_tokens: 4096 } });
  const first = openBudget({ directory, authorization: scoped, pricing, fetchImpl });
  for (let i = 1; i <= 21; i++) await first.request(pricing.endpoint, wire, attempt(i)); first.close();
  assert.throws(() => openBudget({ directory: path.join(directory, 'new-version'), authorization: scoped, pricing, fetchImpl }), /same campaign/);
  const nextVersion = openBudget({ directory, authorization: scoped, pricing, fetchImpl });
  for (let i = 22; i <= 23; i++) await nextVersion.request(pricing.endpoint, wire, attempt(i));
  await assert.rejects(nextVersion.request(pricing.endpoint, wire, attempt(24)), /Budget cap/); nextVersion.close();
});
test('transport failure and corrupt/incomplete usage preserve reservation and block continuation', async t => {
  for (const response of ['throw', 'invalid']) {
    const directory = path.join(temp(t), response);
    const b = openBudget({ directory, authorization, pricing, fetchImpl: async () => { if (response === 'throw') throw new Error('offline'); return Response.json({ usage: { prompt_tokens: -1, completion_tokens: 2 } }); } });
    await b.request(pricing.endpoint, wire, attempt(1)).catch(() => {});
    assert.equal(b.snapshot().reservationCount, 1);
    await assert.rejects(b.request(pricing.endpoint, wire, attempt(2)), /Unsettled/); b.close();
  }
});
const attest = { model: 'gpt-6.1-sol', reasoningEffort: 'medium', evidence: 'test execution metadata; mock only', billing: { kind: 'included-in-subscription', additionalApiChargeCny: 0, evidence: 'synthetic subscription attestation; no real execution' } };
function review(packet) {
  return { blindId: packet.blindId, sourceHash: packet.sourceHash, rulesHash: packet.rulesHash, datasetHash: packet.datasetHash, model: attest.model, reasoningEffort: attest.reasoningEffort,
    comparison: { actual: false, requested: false, rationale: '未比较且问题未要求比较。' },
    scores: { ...Object.fromEntries(COMMON.map(d => [d, 3])), legal_comparison: null }, citations: [{ target: 'answer', quote: '测试回答' }], errors: [], unresolved: [] };
}
test('NA comparison neither penalizes nor adds an automatic full score; major gates fail', t => {
  const q = createQueue(temp(t), 'dataset'), packet = q.add({ resultId: 'r', answer: '测试回答', facts: { legalActions: [1, 2] } });
  const r = review(packet), validated = validateReview(packet, r, attest);
  assert.equal(validated.commonMean, 3); assert.equal(validated.contractMean, 3); assert.equal(validated.gate, 'pass');
  r.errors.push({ severity: 'major', citation: 0, reason: '测试重大错误' }); assert.equal(validateReview(packet, r, attest).gate, 'fail');
  r.errors = []; r.unresolved.push('事实不足待复核'); assert.equal(validateReview(packet, r, attest).gate, 'needs_review');
});
test('review rejects wrong model, forged quotes, missing requested comparison and source changes', t => {
  const q = createQueue(temp(t), 'dataset'), p = q.add({ resultId: 'r', answer: '测试回答', facts: { snapshot: {} } });
  assert.throws(() => validateReview(p, { ...review(p), model: 'gpt-6-sol' }, attest), /model/);
  assert.throws(() => validateReview(p, { ...review(p), citations: [{ target: 'answer', quote: '不存在' }] }, attest), /Citation/);
  assert.throws(() => validateReview(p, review(p), { ...attest, reasoningEffort: 'high' }), /attestation/);
  assert.throws(() => validateReview(p, review(p), { ...attest, billing: { kind: 'unknown' } }), /budget/);
  const asked = q.add({ resultId: 'asked', answer: '测试回答', facts: {}, questionRequiresComparison: true });
  assert.throws(() => validateReview(asked, review(asked), attest), /applicability/);
  assert.throws(() => q.add({ resultId: 'r', answer: '更换回答', facts: {} }), /overwrite/);
});
test('review imports are atomic, immutable and blind order survives restart', t => {
  const directory = temp(t), q = createQueue(directory, 'dataset');
  const p = q.add({ resultId: 'r', answer: '测试回答', facts: {} }), p2 = q.add({ resultId: 'r2', answer: '测试回答', facts: {} });
  assert.throws(() => q.importResults([review(p), { ...review(p2), sourceHash: 'bad' }], attest), /identity/);
  assert.ok(q.snapshot().every(j => j.state === 'pending'));
  const file = q.exportPackets(), bytes = fs.readFileSync(file, 'utf8');
  const reopened = createQueue(directory, 'dataset'); assert.equal(reopened.exportPackets(), file); assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  q.importResults([review(p)], attest);
  assert.throws(() => q.importResults([{ ...review(p), scores: { ...review(p).scores, usability: 4 } }], attest), /overwritten/);
});
test('dataset masking preserves own hand, hides opponent draws and strips operations', () => {
  const raw = { kind: 'NewRound', hands: [['1m'], ['2m']], operation: { hidden: true } };
  const masked = mask(raw, 0); assert.deepEqual(masked.hands, [['1m'], ['?']]); assert.equal(masked.operation, undefined); assert.deepEqual(raw.hands[1], ['2m']);
  assert.equal(mask({ kind: 'DealTile', seat: 1, tile: '7z' }, 0).tile, '?');
  const facts = factsFor(fixture(), { action: { type: 'dahai', actor: 0, pai: 'E', tsumogiri: false } }, { traces: [] });
  assert.equal(facts.engine.action.pai, '1z'); assert.equal(facts.engine.tileEncoding, 'snapshot-v1');
});
test('development schedule rotates candidates and retains every fixed opportunity', () => {
  const variants = loadPrompts().variants, data = { nodes: Array.from({ length: 4 }, (_, i) => ({ ...fixture(), id: 'n' + i })) };
  const jobs = schedule(data, variants, 'development'); assert.equal(jobs.length, 16);
  for (let i = 0; i < 4; i++) assert.equal(jobs[i * 4].variant, variants[i].id);
});
test('mock runner exercises frozen job recovery without dispatching completed opportunities again', async t => {
  const output = temp(t), body = { format: 'test', nodes: [fixture()] }, data = { ...body, datasetHash: stableHash(body) };
  for (const [name, value] of Object.entries({ 'dataset.json': data, 'authorization.local.json': authorization, 'pricing.json': pricing })) fs.writeFileSync(path.join(output, name), JSON.stringify(value));
  const mock = createMock(data);
  const first = await runStage({ output, stage: 'development', engineConfig, fetchImpl: mock.fetch, mock: true });
  assert.equal(first.planned, 4); assert.equal(first.delivered, 4); assert.equal(mock.counts().llm, 8);
  const second = await runStage({ output, stage: 'development', engineConfig, fetchImpl: mock.fetch, mock: true });
  assert.equal(second.delivered, 4); assert.equal(mock.counts().llm, 8);
});
test('cached component actions and real product HTTP bodies pass through shared accounting (mock network only)', async t => {
  const output = temp(t), body = { format: 'synthetic-integration', nodes: [fixture()] }, data = { ...body, datasetHash: stableHash(body) };
  const credentialsFile = path.join(output, 'credentials.local.json');
  fs.writeFileSync(credentialsFile, JSON.stringify({ groups: [{ id: 'G', apiKey: 'synthetic-api-secret' }] }));
  const scoped = { ...authorization, allowedReferences: ['group:G'], credentialsFile };
  for (const [name, value] of Object.entries({ 'dataset.json': data, 'authorization.local.json': scoped, 'pricing.json': pricing })) fs.writeFileSync(path.join(output, name), JSON.stringify(value));
  const mock = createMock(data);
  assert.equal(await cacheEngines({ output, engineConfig, fetchImpl: mock.fetch }), 1);
  const result = await runStage({ output, stage: 'development', engineConfig, fetchImpl: mock.fetch });
  assert.equal(result.delivered, 4); assert.equal(result.billing.records.length, 8);
  assert.equal(result.billing.reservationCount, 0); assert.equal(result.billing.unknownLiability, false);
  assert.ok(Math.abs(result.billing.estimatedCost - 0.00352) < 1e-12);
  assert.deepEqual(mock.counts(), { engines: 1, llm: 8 });
  const report = buildReport(output, 'development');
  assert.ok(Object.values(report.groups).every(g => g.billing.physicalAttempts === 2 && g.billing.comparablePeakRateEstimateCny > 0));
});
test('supplement restores exact original first input and two follow-ups without engine inference', async t => {
  const output = temp(t), body = { format: 'test', nodes: [fixture()] }, data = { ...body, datasetHash: stableHash(body) };
  for (const [name, value] of Object.entries({ 'dataset.json': data, 'authorization.local.json': authorization, 'pricing.json': pricing,
    'supplement-plan.json': { repeatNodes: ['node'], followupNodes: ['node'], questions: QUESTIONS } })) fs.writeFileSync(path.join(output, name), JSON.stringify(value));
  const mock = createMock(data);
  await runStage({ output, stage: 'development', engineConfig, fetchImpl: mock.fetch, mock: true });
  const before = mock.counts();
  const result = await runSupplement({ output, winner: 'p0-release-v2', engineConfig, fetchImpl: mock.fetch, mock: true });
  assert.equal(result.planned, 3); assert.equal(result.delivered, 3); assert.equal(mock.counts().engines, before.engines);
  const q = createQueue(path.join(output, 'mock-review'), data.datasetHash).snapshot();
  assert.equal(q.find(j => j.resultId.endsWith('p0-release-v2:1')).packet.questionRequiresComparison, true);
});
test('report keeps failed and unreviewed answers in planned denominators without fake zero scores', async t => {
  const output = temp(t), body = { format: 'test', nodes: [fixture()] }, data = { ...body, datasetHash: stableHash(body) };
  for (const [name, value] of Object.entries({ 'dataset.json': data, 'authorization.local.json': authorization, 'pricing.json': pricing })) fs.writeFileSync(path.join(output, name), JSON.stringify(value));
  const mock = createMock(data, { failLlm: true });
  await runStage({ output, stage: 'development', engineConfig, fetchImpl: mock.fetch, mock: true });
  const report = buildReport(output, 'development', true);
  for (const g of Object.values(report.groups)) {
    assert.equal(g.planned, 1); assert.equal(g.delivered, 0); assert.equal(g.qualityPassRate, 0); assert.equal(g.commonMean, null);
    assert.equal(g.billing.comparablePeakRateEstimateCny, null); assert.equal(g.failures.length, 1);
  }
});
test('changed exported blind packet is rejected instead of silently reused', t => {
  const directory = temp(t), q = createQueue(directory, 'dataset');
  const p = q.add({ resultId: 'r', answer: '测试回答', facts: { snapshot: {} } }); q.exportPackets();
  fs.writeFileSync(path.join(directory, 'blind', p.blindId + '.json'), JSON.stringify({ ...p, answer: '篡改回答' }));
  assert.throws(() => q.exportPackets(), /packet changed/);
});
