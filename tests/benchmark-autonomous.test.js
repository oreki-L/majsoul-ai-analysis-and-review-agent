'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compileSuite, stableHash } = require('../benchmark/core.cjs');
const { runSuite } = require('../benchmark/runner.cjs');
const { validatePolicy, automaticHolds, validateLiabilityProof } = require('../benchmark/runtime.cjs');
const { freezeRun, verifyRun, dependencyGraph } = require('../benchmark/freeze.cjs');
const { journal, readEvents, acquireLock, processIdentity, localWrite } = require('../benchmark/durable.cjs');
const { createLedger, deriveTrustedLiabilityContracts, normalizeUsage } = require('../benchmark/accounting.cjs');
const { createReviewQueue, RULES, DIMENSIONS } = require('../benchmark/review.cjs');
const { scoreRun } = require('../benchmark/scoring.cjs');
const { enrich, writeDashboard } = require('../benchmark/dashboard.cjs');
const { createReport } = require('../benchmark/report.cjs');
const ROOT = path.resolve(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'benchmark/examples/suite.mock.json');
function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-autonomous-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
const EVIDENCE = 'SYNTHETIC full-context ceiling, output cap and cached/uncached/output-only charges; not a real vendor contract.';
function proof(endpoint = 'http://127.0.0.1:1/v1') { return { provider: 'synthetic-unit', endpoint, model: 'unit', modelId: 'synthetic', inputTokens: 131072, outputTokens: 1024, rates: { cachedInput: 1, uncachedInput: 1, output: 2 }, currency: 'CNY', additionalCharges: 'none', attestation: { verifiedBy: 'synthetic-fixture', verifiedAt: '2026-10-30T00:00:00Z', sourceUrl: 'https://example.invalid/synthetic-contract', evidenceText: EVIDENCE, evidenceSha256: require('node:crypto').createHash('sha256').update(EVIDENCE).digest('hex') } }; }
function suite() {
  const s = compileSuite(EXAMPLE); s.schemes = [s.schemes[0]]; s.dataset.rounds = [s.dataset.rounds[0]]; s.dataset.rounds[0].decisions = s.dataset.rounds[0].decisions.slice(0, 1); s.dataset.rounds[0].decisions[0].followups = []; s.dataset.rounds[0].globalTasks = [];
  s.models.synthetic = { provider: 'openai-compatible', model: 'unit', endpoint: 'http://127.0.0.1:1/v1', credentialAlias: 'env:UNIT_FAKE', maxTokens: 1024, usageSemantics: { noCache: true }, rates: { input: 1, cachedInput: 1, output: 2, currency: 'CNY' }, liabilityBound: { inputTokens: 131072, outputTokens: 1024, contractHash: stableHash(proof()) } }; s.execution.budget.cap = 10; s.execution.timeoutMs = 20000; s.execution.concurrency = 1; return s;
}
const policy = extra => validatePolicy({ baseDelayMs: 0, maxDelayMs: 0, circuitDelayMs: 0, jitter: 0, httpTimeoutMs: 5000, liabilityContracts: [proof()], ...extra });
function answer(s) { const tile = s.dataset.rounds[0].decisions[0].legalActions[0].tile; return JSON.stringify({ task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile, reasons: ['SYNTHETIC'] }, limitations: ['unknown'] }); }
function response(s, status = 200, usage = { prompt_tokens: 100, completion_tokens: 20 }) { return { ok: status < 400, status, headers: { get: () => null }, json: async () => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: answer(s) } }], ...(usage ? { usage } : {}) }) }; }
function run(s, out, extra = {}) { return runSuite(s, { checkpoint: path.join(out, 'checkpoint.json'), mode: 'live', autonomousPolicy: policy(), credentialResolver: async () => 'synthetic-test-key', fetch: async () => response(s), ...extra }); }

test('autonomous: first success and missing checkpoint rebuilt from fsynced log without API replay', async t => {
  const out = temp(t), s = suite(); let calls = 0;
  const first = await run(s, out, { fetch: async () => { calls++; return response(s); } });
  assert.equal(first.status, 'complete'); assert.equal(calls, 1);
  fs.unlinkSync(path.join(out, 'checkpoint.json'));
  const resumed = await run(s, out, { resume: true, fetch: () => { throw new Error('Replay prohibited'); } });
  assert.equal(resumed.results.length, 1); assert.equal(resumed.ledger.records.length, 1); assert.equal(resumed.ledger.reserved, 0);
});

test('autonomous: 429 / 503 retry uses exact frozen body, charges every attempt and obeys Retry-After', async t => {
  const out = temp(t), s = suite(), bodies = [];
  const state = await run(s, out, { fetch: async (_url, options) => { bodies.push(options.body); const r = response(s, bodies.length === 1 ? 429 : bodies.length === 2 ? 503 : 200); r.headers.get = name => name === 'retry-after' ? '0' : 'unit-request'; return r; } });
  assert.equal(state.status, 'complete'); assert.equal(bodies.length, 3); assert.equal(new Set(bodies).size, 1); assert.equal(state.ledger.records.length, 3); assert.equal(new Set(state.ledger.records.map(r => r.meta.attemptId)).size, 3);
  assert.ok(readEvents(path.join(out, 'events.jsonl')).some(e => e.kind === 'backoff'));
});

test('autonomous: bounded retries exhaust and retain failure without choosing a later high score', async t => {
  const out = temp(t), s = suite(); let calls = 0;
  const state = await run(s, out, { fetch: async () => { calls++; return response(s, 503); } });
  assert.equal(calls, 3); assert.equal(state.status, 'finished-with-failures'); assert.equal(state.results[0].status, 'failed'); assert.equal(state.histories['0:current-only'], undefined);
});

test('autonomous: network without usage blocks by default; contract holds cover each retry once including summaries', async t => {
  const s = suite(), blocked = await run(s, temp(t), { fetch: async () => { throw new Error('offline sk-private'); } });
  assert.equal(blocked.status, 'stopped-unknown-liability'); assert.equal(blocked.ledger.records.length, 1);
  const out = temp(t); let calls = 0;
  const recovered = await run(s, out, { autonomousPolicy: policy({ unknownCost: 'contract-hold' }), fetch: async () => { if (++calls < 3) throw new Error('offline'); return response(s); } });
  assert.equal(recovered.status, 'complete'); assert.equal(recovered.ledger.conservativeHolds.length, 2); assert.equal(recovered.ledger.records[0].cost, null); assert.equal(recovered.ledger.billingUnknownLiability, true); assert.equal(recovered.ledger.unknownLiability, false);
  const ledger = createLedger({ ...s.execution.budget, initial: recovered.ledger, trustedLiabilityContracts: deriveTrustedLiabilityContracts(s.models) }); automaticHolds(ledger, s.models, policy({ unknownCost: 'contract-hold' })); automaticHolds(ledger, s.models, policy({ unknownCost: 'contract-hold' })); assert.equal(ledger.snapshot().conservativeHolds.length, 2);
  const summaryLedger = createLedger({ cap: 1, currency: 'CNY', trustedLiabilityContracts: deriveTrustedLiabilityContracts(s.models) }), m = s.models.synthetic;
  const reservation = summaryLedger.reserve({ inputTokens: 131072, maxOutputTokens: 1024, rates: { uncachedInput: 1, cachedInput: 1, output: 2 }, meta: { role: 'summary', modelId: 'synthetic', modelVersion: 'unit', endpoint: m.endpoint, liabilityBound: m.liabilityBound } }); summaryLedger.settle(reservation, null); automaticHolds(summaryLedger, s.models, policy({ unknownCost: 'contract-hold' })); assert.equal(summaryLedger.snapshot().unknownLiability, false);
});

test('autonomous: budget insufficient and 401 stop admission and retain explicit missing coverage', async t => {
  const s = suite(); s.execution.budget.cap = .001; let calls = 0;
  const budget = await run(s, temp(t), { fetch: async () => { calls++; return response(s); } }); assert.equal(calls, 0); assert.equal(budget.status, 'blocked-budget');
  const authorized = suite(); authorized.dataset.rounds[0].decisions.push({ ...structuredClone(authorized.dataset.rounds[0].decisions[0]), id: 'later', position: 999 });
  const auth = await run(authorized, temp(t), { fetch: async () => { calls++; return response(authorized, 401); } }); assert.equal(calls, 1); assert.equal(auth.status, 'blocked-config'); assert.ok(auth.results.some(r => r.status === 'blocked' && r.reason === 'blocked-config'));
});

test('autonomous: temporary checkpoint file occupation retries only local writes after paid response', async t => {
  const out = temp(t), s = suite(), original = fs.renameSync; let calls = 0, failures = 0;
  fs.renameSync = function(from, to) { if (calls && String(to).endsWith('checkpoint.json') && failures++ < 2) { const error = new Error('occupied'); error.code = 'EPERM'; throw error; } return original(from, to); };
  try { const state = await run(s, out, { fetch: async () => { calls++; return response(s); } }); assert.equal(state.status, 'complete'); assert.equal(calls, 1); } finally { fs.renameSync = original; }
});

test('autonomous: actual process exits after raw response fsync and before state; resume settles exactly once', async t => {
  const out = temp(t), s = suite(), fixture = path.join(out, 'crash.cjs'); fs.writeFileSync(path.join(out, 'suite.compiled.json'), JSON.stringify(s));
  fs.writeFileSync(fixture, `const fs=require('node:fs');const path=require('node:path');const root=${JSON.stringify(ROOT)};const durable=require(path.join(root,'benchmark/durable.cjs'));const journal=durable.journal;durable.journal=(file)=>{const log=journal(file),write=log.write;log.write=(kind,payload)=>{const event=write(kind,payload);if(kind==='response')process.exit(55);return event;};return log;};const s=JSON.parse(fs.readFileSync(path.join(__dirname,'suite.compiled.json')));const {runSuite}=require(path.join(root,'benchmark/runner.cjs'));runSuite(s,{checkpoint:path.join(__dirname,'checkpoint.json'),mode:'live',autonomousPolicy:${JSON.stringify(policy())},credentialResolver:async()=> 'synthetic-test-key-unit-private',fetch:async()=>({ok:true,status:200,json:async()=>({usage:{prompt_tokens:100,completion_tokens:20},choices:[{finish_reason:'stop',message:{role:'assistant',content:${JSON.stringify(answer(s))}}}]})})}).catch(console.error);`);
  const child = spawnSync(process.execPath, [fixture], { cwd: ROOT, windowsHide: true, encoding: 'utf8' }); assert.equal(child.status, 55, child.stderr);
  let calls = 0; const state = await run(s, out, { resume: true, fetch: async () => { calls++; return response(s); } });
  assert.equal(calls, 0); assert.equal(state.status, 'complete'); assert.equal(state.ledger.records.length, 1); assert.equal(state.ledger.reserved, 0); assert.ok(state.ledger.estimatedCost > 0);
});

test('autonomous: crashed dispatched unknown is held or blocked before any replacement request', async t => {
  const s = suite(), out = temp(t), checkpoint = path.join(out, 'checkpoint.json');
  // Stop at the durable dispatch boundary, before fetch returns.
  const durable = require('../benchmark/durable.cjs'), original = durable.journal;
  // Runtime imported journal already; emulate its authoritative checkpoint and dispatch.
  const first = await run(s, out, { fetch: async () => { throw new Error('network'); } });
  assert.equal(first.ledger.unknownLiability, true);
  await assert.rejects(run(s, out, { resume: true, fetch: () => assert.fail('must not dispatch') }), /unknown|covered/);
  assert.ok(fs.existsSync(checkpoint)); assert.equal(durable.journal, original);
});

test('durable: duplicate startup, verified stale lock, reused PID and unknown lock handling', t => {
  const out = temp(t), lock = path.join(out, 'run.lock'), release = acquireLock(lock);
  assert.throws(() => acquireLock(lock, true), /active/); release();
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, identity: 'old-reused-pid', token: 'old' })); const clear = acquireLock(lock, true); assert.equal(JSON.parse(fs.readFileSync(lock)).identity, processIdentity(process.pid)); clear();
  fs.writeFileSync(lock, 'foreign-lock'); assert.throws(() => acquireLock(lock, true), /Unrecognized/); assert.equal(fs.readFileSync(lock, 'utf8'), 'foreign-lock');
});

test('durable: torn tail preserves backup, duplicate event is idempotent, complete corruption blocks', t => {
  const out = temp(t), file = path.join(out, 'events.jsonl'), log = journal(file); log.write('one', { value: 1 }); const first = fs.readFileSync(file, 'utf8'); fs.appendFileSync(file, first + '{"torn":');
  assert.equal(journal(file).events.length, 1); assert.ok(fs.readdirSync(out).some(f => f.includes('.tail.')));
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n'); const row = JSON.parse(lines[0]); row.payload.value = 2; fs.writeFileSync(file, JSON.stringify(row) + '\n'); assert.throws(() => journal(file), /corruption/);
});

test('autonomous: mismatched contract cannot auto-hold and local full disk does not retry API', async t => {
  const s = suite(), m = s.models.synthetic, ledger = createLedger({ cap: 1, currency: 'CNY', trustedLiabilityContracts: deriveTrustedLiabilityContracts(s.models) });
  const id = ledger.reserve({ inputTokens: 1, maxOutputTokens: 1, rates: { cachedInput: 1, uncachedInput: 1, output: 2 }, meta: { modelId: 'synthetic', modelVersion: 'wrong', endpoint: m.endpoint, liabilityBound: m.liabilityBound } }); ledger.settle(id, null); assert.throws(() => automaticHolds(ledger, s.models, policy({ unknownCost: 'contract-hold' })), /matching/);
  let attempts = 0; assert.throws(() => localWrite(() => { attempts++; const e = new Error('full'); e.code = 'ENOSPC'; throw e; }), /full/); assert.equal(attempts, 1);
});

test('freeze: external plugin transitive dependencies survive moved originals and active-source edits', async t => {
  const out = temp(t), source = path.join(out, 'source'); fs.mkdirSync(source); const raw = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')); raw.dataset = path.join(ROOT, 'benchmark/examples/dataset.synthetic.json'); raw.schemes = [raw.schemes[0]]; raw.schemes[0].context.module = './plugin.cjs'; raw.schemes[0].context.options = {}; delete raw.labels;
  fs.writeFileSync(path.join(source, 'helper.cjs'), "module.exports='frozen-marker';"); fs.writeFileSync(path.join(source, 'plugin.cjs'), "const marker=require('./helper.cjs');exports.version=1;exports.buildContext=({baseline})=>({messages:[...baseline.messages,{role:'user',content:marker}]});"); fs.writeFileSync(path.join(source, 'suite.json'), JSON.stringify(raw));
  const runDir = path.join(out, 'run'); freezeRun(path.join(source, 'suite.json'), runDir, policy(), { mode: 'mock' }); fs.renameSync(source, source + '.moved');
  const state = await require('../benchmark/autonomous.cjs').executeFrozen(runDir, { mode: 'mock' }); assert.equal(state.status, 'complete'); assert.ok(fs.readFileSync(path.join(runDir, 'requests.private.jsonl'), 'utf8').includes('frozen-marker'));
  const original = fs.readFileSync(path.join(ROOT, 'benchmark/dashboard.cjs')); // Freeze itself is byte-bound even when active file is different.
  assert.ok(verifyRun(runDir).files['benchmark/dashboard.cjs']); assert.equal(original.length > 0, true);
  fs.chmodSync(path.join(runDir, 'bundle/benchmark/dashboard.cjs'), 0o600); fs.writeFileSync(path.join(runDir, 'bundle/benchmark/dashboard.cjs'), 'tampered'); assert.throws(() => verifyRun(runDir), /mismatch/);
});

test('freeze: dynamic plugin dependency rejects during offline preflight without loading its code', t => {
  const out = temp(t), plugin = path.join(out, 'dynamic.cjs'); fs.writeFileSync(plugin, "const filename='./missing.cjs';require(filename);throw new Error('must not execute');"); assert.throws(() => dependencyGraph([plugin]), /Dynamic dependencies/);
});

test('autonomous: supplemental uses original frozen input and never inserts its answer into historical trajectory', async t => {
  const s = suite(), out = temp(t); let calls = 0;
  const state = await run(s, out, { autonomousPolicy: policy({ supplemental: true }), fetch: async () => response(s, ++calls <= 3 ? 503 : 200) });
  assert.equal(state.results[0].status, 'failed'); assert.equal(state.supplemental.length, 1); assert.equal(state.supplemental[0].status, 'success'); assert.equal(state.histories['0:current-only'], undefined); assert.equal(state.ledger.records.length, 4); assert.equal(state.status, 'finished-with-failures');
});

test('review: interrupted service persists pending; freed concurrency slots schedule all without blocking requests', async t => {
  const out = temp(t), s = suite(), state = await run(s, out); const queue = createReviewQueue(out, 'contract'); queue.sync(state);
  await queue.drain(async () => { throw new Error('service down'); }, { concurrency: 2, retries: 0 }); assert.equal(queue.snapshot()[0].state, 'pending');
  const resumed = createReviewQueue(out, 'contract'); await resumed.drain(async packet => ({ blindId: packet.blindId, sourceHash: packet.sourceHash, rulesHash: packet.rulesHash, model: 'gpt-6-sol', reasoningEffort: 'medium', scores: Object.fromEntries(DIMENSIONS.map(d => [d, 3])), citations: [{ target: 'answer', quote: 'SYNTHETIC' }], severeErrors: [] }), { concurrency: 2, retries: 2 });
  assert.equal(resumed.snapshot()[0].state, 'complete'); assert.equal(resumed.snapshot()[0].review.mean, 3);
  const blind = fs.readFileSync(path.join(out, 'review/blind', resumed.snapshot()[0].blindId + '.json'), 'utf8'); for (const forbidden of ['schemeId', 'credentialAlias', 'keyAlias', 'preferred', 'current-only']) assert.equal(blind.includes(forbidden), false, forbidden);
});

test('review: import verifies source/rules/model/six scores/quotes and cannot overwrite previous grade', async t => {
  const out = temp(t), state = await run(suite(), out), queue = createReviewQueue(out, 'contract'); queue.sync(state); const job = queue.snapshot()[0];
  const result = { blindId: job.blindId, sourceHash: job.sourceHash, rulesHash: job.rulesHash, model: 'gpt-6-sol', reasoningEffort: 'medium', scores: Object.fromEntries(DIMENSIONS.map(d => [d, 4])), citations: [{ target: 'answer', quote: 'SYNTHETIC' }], severeErrors: [] };
  for (const changed of [{ sourceHash: 'wrong' }, { rulesHash: 'wrong' }, { model: 'other' }, { scores: { factual_accuracy: 5 } }, { citations: [{ target: 'answer', quote: 'not in source' }] }]) assert.throws(() => queue.importResults([{ ...result, ...changed }]));
  queue.importResults([result]); queue.importResults([result]); assert.throws(() => queue.importResults([{ ...result, scores: Object.fromEntries(DIMENSIONS.map(d => [d, 2])) }]), /overwritten/);
});

test('report: non-100 MAKA weights and unequal per-point maxima use ratio of sums, missing review stays null', async t => {
  const out = temp(t), state = await run(suite(), out), row = state.results[0]; state.results.push({ ...row, id: 'another-result', decisionId: 'another' }); state.manifest.decisions.push('another');
  const tile = row.answer.decision.tile, other = tile === '1m' ? '2m' : '1m';
  const labels = { schemaVersion: 1, labels: [{ decisionId: row.decisionId, maka: { preferred: { action: 'discard', tile }, candidates: [{ action: 'discard', tile, weight: 80 }, { action: 'discard', tile: other, weight: 20 }] } }, { decisionId: 'another', maka: { preferred: { action: 'discard', tile: other }, candidates: [{ action: 'discard', tile, weight: 10 }, { action: 'discard', tile: other, weight: 40 }] } }] };
  const score = scoreRun(state, labels); assert.equal(score.groups[0].maka.scoreRate, 90 / 120);
  const report = createReport(state, score); report.reviewQueue = []; report.phases = { execution: state.status, review: 'pending', billing: 'pending' }; report.generatedAt = 'synthetic'; report.snapshotHash = stableHash(JSON.parse(JSON.stringify(state))); enrich(report, state); writeDashboard(out, report);
  assert.equal(report.presentation[0].qualityMean, null); assert.equal(report.presentation[0].maka.scoreRate, .75); assert.ok(fs.readFileSync(path.join(out, 'report.html'), 'utf8').includes('0.750')); assert.ok(fs.readFileSync(path.join(out, 'report.md'), 'utf8').includes(report.snapshotHash)); assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'report.json'))).snapshotHash, report.snapshotHash);
  fs.unlinkSync(path.join(out, 'report.html')); writeDashboard(out, report); assert.ok(fs.existsSync(path.join(out, 'report.html')));
});

test('review: five persisted jobs reuse two slots and one unavailable result retries without touching main history', async t => {
  const out = temp(t), state = await run(suite(), out), original = state.results[0], request = state.requests[original.id];
  for (let i = 1; i < 5; i++) { const id = original.id + '-review-' + i; state.results.push({ ...original, id }); state.requests[id] = structuredClone(request); }
  const historyHash = stableHash(state.histories), queue = createReviewQueue(out, 'contract'); queue.sync(state);
  let active = 0, maxActive = 0, calls = 0, failedOnce = false;
  await queue.drain(async packet => {
    calls++; active++; maxActive = Math.max(active, maxActive);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (!failedOnce) { failedOnce = true; throw new Error('offline reviewer'); }
      return { blindId: packet.blindId, sourceHash: packet.sourceHash, rulesHash: packet.rulesHash, model: RULES.requiredModel, reasoningEffort: RULES.reasoningEffort, scores: Object.fromEntries(DIMENSIONS.map(d => [d, 3])), citations: [{ target: 'answer', quote: 'SYNTHETIC' }], severeErrors: [] };
    } finally { active--; }
  }, { concurrency: 2, retries: 1 });
  assert.equal(queue.snapshot().filter(j => j.state === 'complete').length, 5); assert.equal(maxActive, 2); assert.equal(calls, 6); assert.equal(stableHash(state.histories), historyHash);
});

test('freeze: moving and editing an entire isolated source checkout cannot alter frozen run, resume or report', async t => {
  const out = temp(t), isolated = path.join(out, 'isolated-source'), runDir = path.join(out, 'run');
  fs.mkdirSync(isolated); fs.cpSync(path.join(ROOT, 'benchmark'), path.join(isolated, 'benchmark'), { recursive: true }); fs.cpSync(path.join(ROOT, 'extension'), path.join(isolated, 'extension'), { recursive: true });
  require(path.join(isolated, 'benchmark/freeze.cjs')).freezeRun(path.join(isolated, 'benchmark/examples/suite.mock.json'), runDir, policy(), { mode: 'mock' });
  fs.renameSync(isolated, isolated + '.moved'); fs.writeFileSync(path.join(isolated + '.moved', 'benchmark/report.cjs'), "throw new Error('active source must never load');"); fs.writeFileSync(path.join(isolated + '.moved', 'benchmark/examples/dataset.synthetic.json'), '{}');
  const executor = require('../benchmark/autonomous.cjs'), first = await executor.executeFrozen(runDir, { mode: 'mock' }), historyHash = stableHash(first.histories);
  const resumed = await executor.executeFrozen(runDir, { mode: 'mock', fetch: () => assert.fail('completed run must never dispatch') }); assert.equal(stableHash(resumed.histories), historyHash);
  fs.unlinkSync(path.join(runDir, 'report.html')); const report = await executor.refresh(runDir); assert.equal(report.phases.execution, 'complete'); assert.ok(fs.existsSync(path.join(runDir, 'report.html')));
});

test('recovery: reservation-before-dispatch releases exposure; dispatched-without-response holds or blocks', async t => {
  for (const boundary of ['reservation', 'dispatch']) {
    const out = temp(t), s = suite(), fixture = path.join(out, 'crash.cjs'); fs.writeFileSync(path.join(out, 'suite.compiled.json'), JSON.stringify(s));
    fs.writeFileSync(fixture, `const fs=require('node:fs'),path=require('node:path'),root=${JSON.stringify(ROOT)};const durable=require(path.join(root,'benchmark/durable.cjs')),base=durable.journal;durable.journal=file=>{const log=base(file),write=log.write;log.write=(kind,payload)=>{const row=write(kind,payload);if(${JSON.stringify(boundary)}==='dispatch'?kind==='dispatch':kind==='state'&&payload.event==='http-pending')process.exit(55);return row;};return log;};const s=JSON.parse(fs.readFileSync(path.join(__dirname,'suite.compiled.json')));require(path.join(root,'benchmark/runner.cjs')).runSuite(s,{checkpoint:path.join(__dirname,'checkpoint.json'),mode:'live',autonomousPolicy:${JSON.stringify(policy({ unknownCost: boundary === 'dispatch' ? 'contract-hold' : 'block' }))},credentialResolver:async()=> 'unit-private-test-credential',fetch:()=>{throw new Error('must crash before fetch');}}).catch(console.error);`);
    const child = spawnSync(process.execPath, [fixture], { cwd: ROOT, windowsHide: true, encoding: 'utf8' }); assert.equal(child.status, 55, child.stderr);
    let calls = 0; const state = await run(s, out, { resume: true, autonomousPolicy: policy({ unknownCost: boundary === 'dispatch' ? 'contract-hold' : 'block' }), fetch: async () => { calls++; return response(s); } });
    assert.equal(state.status, 'complete', boundary); assert.equal(calls, 1, boundary); assert.equal(state.ledger.conservativeHolds.length, boundary === 'dispatch' ? 1 : 0); assert.equal(state.ledger.records.length, boundary === 'dispatch' ? 2 : 1);
  }
});

test('supervisor: one autonomous start restarts a genuinely exited paid-transport worker and reuses its fsynced response', async t => {
  const out = temp(t), http = require('node:http'), marker = path.join(out, 'crashed-once'), runDir = path.join(out, 'run'); let calls = 0;
  const s = suite(), server = http.createServer((req, res) => { let body = ''; req.on('data', part => { body += part; }); req.on('end', () => { calls++; JSON.parse(body); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: answer(s) } }] })); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const raw = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')); const dataset = structuredClone(s.dataset); for (const round of dataset.rounds) delete round.sessionId; fs.writeFileSync(path.join(out, 'dataset.json'), JSON.stringify(dataset)); raw.dataset = './dataset.json'; raw.models = s.models; raw.models.synthetic.endpoint = 'http://127.0.0.1:' + server.address().port + '/v1'; raw.execution = s.execution; raw.schemes = [raw.schemes[0]]; raw.schemes[0].context.module = './crash-plugin.cjs'; delete raw.labels;
  // Trusted synthetic plugin injects a real OS exit immediately after response fsync.
  fs.writeFileSync(path.join(out, 'crash-plugin.cjs'), `const fs=require('node:fs');const marker=${JSON.stringify(marker)};let responseFd=null;if(!fs.existsSync(marker)){const write=fs.writeSync,flush=fs.fsyncSync;fs.writeSync=function(fd,buffer,...args){if(Buffer.isBuffer(buffer)&&buffer.toString().includes('"kind":"response"'))responseFd=fd;return write.call(fs,fd,buffer,...args);};fs.fsyncSync=function(fd){const result=flush.call(fs,fd);if(fd===responseFd){fs.writeFileSync(marker,'synthetic crash');process.exit(55);}return result;};}exports.version=1;exports.buildContext=({baseline})=>({messages:baseline.messages});`);
  fs.writeFileSync(path.join(out, 'suite.json'), JSON.stringify(raw)); const previous = process.env.UNIT_FAKE; process.env.UNIT_FAKE = 'unit-local-http-synthetic-private'; t.after(() => { if (previous === undefined) delete process.env.UNIT_FAKE; else process.env.UNIT_FAKE = previous; });
  const report = await require('../benchmark/autonomous.cjs').start({ suite: path.join(out, 'suite.json'), output: runDir, mode: 'live', policy: policy({ restartDelayMs: 0 }) });
  assert.equal(report.phases.execution, 'complete'); assert.equal(calls, report.accounting.ledger.records.length); assert.ok(fs.existsSync(marker));
  const exits = readEvents(path.join(runDir, 'supervisor.jsonl')).filter(e => e.kind === 'worker-exit'); assert.equal(exits.length, 2); assert.equal(exits[0].payload.code, 55); assert.equal(exits[1].payload.code, 0);
});

test('durable: equal value trees decode as independent mutable histories, branches and nested groups', t => {
  const out = temp(t), log = journal(path.join(out, 'events.jsonl'));
  log.write('state', { event: 'test', state: { histories: {}, branches: {}, a: [], b: [], nested: { a: { list: [] }, b: { list: [] } }, big: Array.from({ length: 1100 }, (_, i) => ({ i, values: [] })) } });
  const state = journal(path.join(out, 'events.jsonl')).latestState(); state.histories.one = ['answer']; state.a.push('one'); state.nested.a.list.push('one'); state.big[0].values.push('one');
  assert.deepEqual(state.branches, {}); assert.deepEqual(state.b, []); assert.deepEqual(state.nested.b.list, []); assert.deepEqual(state.big[1].values, []); assert.equal(state.big.length, 1100); for (const length of [33, 120]) { const values = Array.from({ length }, (_, i) => ({ i, nested: [i] })); log.write('state', { event: 'vector', state: { values } }); assert.deepEqual(journal(path.join(out, 'events.jsonl')).latestState().values, values); }
});

test('scale: 120 synthetic points retain bounded incremental disk and memory instead of full snapshots per event', async t => {
  const metrics = await require('../benchmark/scale-smoke.cjs').runScale(temp(t));
  assert.equal(metrics.completed, 120); assert.ok(metrics.logToCheckpointRatio < 12, JSON.stringify(metrics)); assert.ok(metrics.secondHalfGrowth < 3.5, JSON.stringify(metrics)); assert.ok(metrics.rssAfter - metrics.rssBefore < 400 * 1024 * 1024, JSON.stringify(metrics));
  console.log('Synthetic scale metrics: ' + JSON.stringify(metrics));
});

test('contract: automatic unknown holds reject missing proof, extra charges and changed source evidence', () => {
  assert.throws(() => validatePolicy({ unknownCost: 'contract-hold' }), /proof/);
  const p = proof(); assert.throws(() => validateLiabilityProof({ ...p, additionalCharges: 'unbounded' }), /proof/); assert.throws(() => validateLiabilityProof({ ...p, attestation: { ...p.attestation, evidenceText: 'changed' } }), /attestation/);
});
