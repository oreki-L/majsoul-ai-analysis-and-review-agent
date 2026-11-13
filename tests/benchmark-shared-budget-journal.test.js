'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compileSuite, stableHash } = require('../benchmark/core.cjs');
const { createLedger, createSharedLedger, deriveTrustedLiabilityContracts, normalizeUsage } = require('../benchmark/accounting.cjs');
const { journal } = require('../benchmark/durable.cjs');
const { runSuite } = require('../benchmark/runner.cjs');
const { runJobs } = require('../benchmark/job-runner.cjs');
const { validatePolicy } = require('../benchmark/runtime.cjs');

const rates = { cachedInput: .04, uncachedInput: 2, output: 8, unit: 'perMillion' };
const contractHash = 'a'.repeat(64);
const models = { synthetic: { provider: 'openai-compatible', endpoint: 'https://fixture.invalid/chat/completions', model: 'offline-fixture', maxTokens: 4096, credentialAlias: 'alias:fixture', rates: { ...rates, currency: 'CNY' }, liabilityBound: { inputTokens: 1048576, outputTokens: 4096, contractHash } } };
const contracts = deriveTrustedLiabilityContracts(models);
const usage = normalizeUsage({ prompt_tokens: 1000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 1000, completion_tokens: 100 });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-budget-journal-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function open(filename, autonomous = false) { return createSharedLedger({ filename, cap: 70, currency: 'CNY', trustedLiabilityContracts: contracts, autonomous }); }
function addKnown(ledger) { const id = ledger.reserve({ inputTokens: 1000, maxOutputTokens: 100, rates, meta: { requestId: 'offline-known' } }); ledger.settle(id, usage); return id; }
function assertSynced(filename) { assert.deepEqual(journal(filename + '.events.jsonl').latestBudget(), read(filename)); }

test('shared journal: actual autonomous runner -> two job-runner batches -> autonomous retains all accounting and resume never rebills', async t => {
  const dir = temp(t), filename = path.join(dir, 'budget.json');
  const suite = compileSuite(path.resolve(__dirname, '../benchmark/examples/suite.mock.json'));
  suite.schemes = [suite.schemes[0]]; suite.models = structuredClone(models); suite.execution.budget = { cap: 70, currency: 'CNY' }; suite.execution.concurrency = 1;
  suite.dataset.rounds = [suite.dataset.rounds[0]]; suite.dataset.rounds[0].globalTasks = []; suite.dataset.rounds[0].decisions = [suite.dataset.rounds[0].decisions[0]]; suite.dataset.rounds[0].decisions[0].followups = [];
  const tile = suite.dataset.rounds[0].decisions[0].legalActions[0].tile;
  const answer = JSON.stringify({ task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile, reasons: ['Offline accounting test'] }, limitations: ['offline fixture'] });
  // Injected fetch only: no network or real API/key is used, despite exercising live paths.
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ usage: usage.raw, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: answer } }] }) }; };
  const options = { mode: 'live', budgetFile: filename, credentialResolver: async () => 'offline-fixture-key', fetch };
  const run = name => runSuite(suite, { ...options, checkpoint: path.join(dir, name, 'checkpoint.json'), autonomousPolicy: validatePolicy({}) });
  const first = await run('first'); assert.equal(first.status, 'complete'); assert.equal(calls, 1); assertSynced(filename);
  // A held unknown predates both summary batches and must keep its original index/hash.
  const seed = open(filename, true);
  const unknownId = seed.reserve({ inputTokens: 1048576, maxOutputTokens: 4096, rates, meta: { modelId: 'synthetic', modelVersion: models.synthetic.model, endpoint: models.synthetic.endpoint, requestId: 'offline-unknown' } });
  seed.settle(unknownId, null);
  const pending = seed.snapshot(); seed.addConservativeHold({ recordIndex: 1, recordHash: stableHash(pending.records[1]), contractHash, currency: 'CNY', amount: 2.12992, approved: true, reviewId: 'offline-fixture' });
  const before = seed.snapshot(); seed.close(); assertSynced(filename);
  const manifests = [], states = [];
  for (let batch = 0; batch < 2; batch++) {
    const manifest = { schemaVersion: 1, id: 'batch-' + batch, sourceFreezeHash: 'offline-fixture', models, budget: { cap: 70, currency: 'CNY' }, jobs: Array.from({ length: 6 }, (_, i) => ({ id: 'summary-' + i, modelId: 'synthetic', credentialAlias: 'alias:fixture', schemeId: 'fixture', descriptor: { id: 'summary-' + i, sourceHash: 'source-' + i, messages: [{ role: 'user', content: 'Offline summary accounting fixture' }] } })) };
    manifests.push(manifest);
    const state = await runJobs(manifest, { ...options, output: path.join(dir, manifest.id) }); states.push(state);
    assert.equal(state.status, 'complete'); assert.equal(state.ledger.records.length, before.records.length + (batch + 1) * 6); assert.equal(state.ledger.nextId, before.nextId + (batch + 1) * 6); assertSynced(filename);
  }
  assert.equal(calls, 13);
  for (const manifest of manifests) for (let n = 0; n < 2; n++) {
    const resumed = await runJobs(manifest, { ...options, resume: true, output: path.join(dir, manifest.id), fetch: () => { throw new Error('No HTTP replay allowed'); } });
    assert.equal(resumed.status, 'complete'); assert.equal(resumed.ledger.records.length, 14); assert.equal(resumed.ledger.nextId, before.nextId + 12); assertSynced(filename);
  }
  const last = await run('last'); assert.equal(last.status, 'complete'); assert.equal(calls, 14); assertSynced(filename);
  const final = read(filename);
  assert.equal(final.records.length, 15); assert.equal(final.nextId, before.nextId + 13); assert.equal(final.reserved, 0);
  assert.deepEqual(final.records.slice(0, before.records.length), before.records); assert.deepEqual(final.conservativeHolds, before.conservativeHolds);
  assert.equal(final.records[1].cost, null); assert.equal(final.conservativeUnknownHoldTotal, 2.12992); assert.equal(final.billingUnknownLiability, true);
  assert.ok(Math.abs(final.estimatedCost - 14 * .0028) < 1e-12); assert.equal(final.budgetCommitted, final.estimatedCost + 2.12992);
  for (const state of states) assert.equal(final.records.filter(r => r.meta.runId === state.runId).length, 6);
  // Even two mutually consistent but rolled-back indexes cannot erase evidence in a job checkpoint.
  fs.writeFileSync(filename, JSON.stringify(before)); journal(filename + '.events.jsonl').write('budget', { snapshot: before });
  await assert.rejects(runJobs(manifests[0], { ...options, resume: true, output: path.join(dir, manifests[0].id) }), /no longer contains job checkpoint accounting/);
  assert.equal(calls, 14); assert.deepEqual(read(filename), before);
});

test('shared journal: legacy snapshot without journal imports once in either caller mode', t => {
  const dir = temp(t), filename = path.join(dir, 'budget.json');
  const old = createLedger({ cap: 70, currency: 'CNY' }); addKnown(old); const original = old.snapshot(); fs.writeFileSync(filename, JSON.stringify(original));
  let ledger = open(filename); assert.deepEqual(ledger.snapshot(), original); ledger.close(); assertSynced(filename);
  ledger = open(filename, true); assert.deepEqual(ledger.snapshot(), original); assert.equal(addKnown(ledger), original.nextId); ledger.close(); assertSynced(filename);
});

test('shared journal: both caller modes reject a valid newer snapshot branch without overwriting either side', t => {
  const dir = temp(t), filename = path.join(dir, 'budget.json'), first = open(filename, true); addKnown(first); const logged = first.snapshot(); first.close();
  const foreign = createLedger({ cap: 70, currency: 'CNY', initial: logged }); addKnown(foreign); const branch = foreign.snapshot(); fs.writeFileSync(filename, JSON.stringify(branch));
  const paths = [filename, filename + '.events.jsonl', filename + '.events.jsonl.objects.jsonl']; const original = paths.map(file => fs.readFileSync(file));
  // File ages are deliberately misleading; accounting authority must not use mtime.
  fs.utimesSync(filename, new Date(0), new Date(0));
  for (const mode of [false, true]) { assert.throws(() => open(filename, mode), e => e.code === 'BENCHMARK_BUDGET_DIVERGENCE'); assert.equal(fs.existsSync(filename + '.lock'), false); for (const [i, file] of paths.entries()) assert.deepEqual(fs.readFileSync(file), original[i]); }
});

test('shared journal: journal committed before snapshot interruption blocks for explicit audit, while missing disposable snapshot rebuilds', t => {
  const dir = temp(t), filename = path.join(dir, 'budget.json'), first = open(filename); addKnown(first); const saved = first.snapshot(); first.close();
  const advanced = createLedger({ cap: 70, currency: 'CNY', initial: saved }); addKnown(advanced); journal(filename + '.events.jsonl').write('budget', { snapshot: advanced.snapshot() });
  assert.throws(() => open(filename), /divergence.*audited recovery/); assert.deepEqual(read(filename), saved);
  fs.unlinkSync(filename); const rebuilt = open(filename, true); assert.deepEqual(rebuilt.snapshot(), advanced.snapshot()); rebuilt.close(); assertSynced(filename);
});

test('shared journal: non-autonomous writer uses the same owned lock and rejects concurrent or unfamiliar owners', t => {
  const dir = temp(t), filename = path.join(dir, 'budget.json'), ledger = open(filename);
  const owner = read(filename + '.lock'); assert.equal(owner.pid, process.pid); assert.ok(owner.identity && owner.token);
  assert.throws(() => open(filename, true), /active/); ledger.close();
  fs.writeFileSync(filename + '.lock', 'legacy-unrecognized-owner'); assert.throws(() => open(filename), /Unrecognized lock/); assert.equal(fs.readFileSync(filename + '.lock', 'utf8'), 'legacy-unrecognized-owner');
});
