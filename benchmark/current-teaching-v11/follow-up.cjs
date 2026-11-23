'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents, acquireLock } = require('../durable.cjs');
const { createQueue } = require('../mortal-teaching/review.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const v11Hash = '76d4c4255eac0361e8b6bc585a610f946bbf11c31f2f23c659b2c11214204815';
const missing = 'expanded-east1-h0-p86';
const events = dir => readEvents(path.join(dir, 'live/results.jsonl')).filter(e => e.kind === 'result');

function makePlan(source, reference, prior, output, scope, cap) {
  const v11 = read(path.join(prior, 'manifest.json')), v8 = read(path.join(reference, 'manifest.json'));
  assert.equal(stableHash(v11), v11Hash);
  assert.equal(stableHash(v8), v11.priorV8ManifestHash);
  const priorResults = events(prior).map(e => e.payload);
  assert.deepEqual(priorResults.map(r => r.nodeId), v11.jobs.map(j => j.nodeId));
  assert.deepEqual(priorResults.filter(r => !r.delivered).map(r => r.nodeId), [missing]);
  const controls = Object.fromEntries(v8.jobs.filter(j => j.protection).map(j => [j.nodeId, j.protection]));
  const attempted = new Set(v11.jobs.map(j => j.nodeId));
  const ids = scope === 'retry' ? [missing] : v8.jobs.map(j => j.nodeId).filter(id => !attempted.has(id));
  assert.equal(ids.length, scope === 'retry' ? 1 : 26);
  const oldJobs = new Map(v8.jobs.map(j => [j.nodeId, j]));
  const oldResults = new Map(events(reference).map(e => [e.payload.nodeId, e.payload]));
  const p = plan(source, output, cap, { versions: { prompt: 11, facts: 10 }, selection: { extraControls: controls, priority: ids },
    extraCode: ['benchmark/current-teaching-v11/follow-up.cjs'] });
  assert.equal(p.manifest.datasetHash, v11.datasetHash);
  assert.deepEqual(p.manifest.rules, v11.rules);
  // Certify that the production code used for the first v11 batch is unchanged.
  for (const [file, digest] of Object.entries(v11.code)) if (file.startsWith('extension/')) assert.equal(p.manifest.code[file], digest);
  const jobs = p.manifest.jobs.slice(0, ids.length).map(j => {
    const old = oldJobs.get(j.nodeId), r = oldResults.get(j.nodeId);
    assert.ok(r?.delivered);
    for (const k of ['inputHash', 'actionHash', 'historyHash', 'currentMessageHash']) assert.equal(j[k], old[k]);
    return { ...j, referenceHash: stableHash(r.reviewSource) };
  });
  assert.deepEqual(jobs.map(j => j.nodeId), ids);
  return { ...p, cases: p.cases.slice(0, ids.length), oldResults,
    manifest: { ...p.manifest, format: 'mortal-targeted-follow-up-v1', priorV11ManifestHash: v11Hash, priorV8ManifestHash: v11.priorV8ManifestHash, scope, jobs } };
}

function exportPaired(output, ready) {
  const dir = path.join(output, 'paired-review'), unlock = acquireLock(path.join(dir, 'export.lock'));
  try {
    const q = createQueue(dir, ready.hash), jobs = new Map(ready.manifest.jobs.map(j => [j.nodeId, j]));
    for (const { payload: r } of events(output)) {
      assert.ok(jobs.has(r.nodeId));
      if (!r.delivered) continue;
      const old = ready.oldResults.get(r.nodeId).reviewSource;
      assert.equal(stableHash(old), jobs.get(r.nodeId).referenceHash);
      for (const k of ['snapshot', 'legalActions', 'engine', 'authorizedHistory']) assert.equal(stableHash(old.facts[k]), stableHash(r.reviewSource.facts[k]));
      q.add({ resultId: `v8:${r.nodeId}`, ...old });
      q.add({ resultId: `v11:${r.nodeId}`, ...r.reviewSource });
    }
    return { paired: q.snapshot().length / 2, batch: q.exportPackets() };
  } finally { unlock(); }
}

async function main([op, scope, source, reference, prior, output, number, ...extra]) {
  if (!output || extra.length || !['retry', 'expand'].includes(scope) || !['prepare', 'verify', '--dispatch', 'export-paired'].includes(op) ||
      ['prepare', '--dispatch'].includes(op) !== (number !== undefined)) throw new Error('Usage: follow-up.cjs prepare|verify|--dispatch|export-paired retry|expand SOURCE V8 V11 OUTPUT [CAP_CNY|MAX_POINTS]');
  const [s, r, p, o] = [source, reference, prior, output].map(x => path.resolve(x));
  assert.notEqual(p, o);
  assert.notEqual(r, o);
  const plan = (source, output, cap) => makePlan(source, r, p, output, scope, cap);
  if (op === 'prepare') {
    const { jobs, ...summary } = await offline(s, o, Number(number), { makePlan: plan, checkFacts: (id, facts) => {
      if (id === missing) {
        const d = facts.explanationFocus.discard;
        assert.equal(d.waitState, '未听牌');
        assert.equal(d.efficiency.shanten, 1);
        assert.deepEqual(d.efficiency.effectiveTiles.map(w => w.tile), ['5m', '8m']);
      }
    } });
    return summary;
  }
  if (op === '--dispatch') return runLive(s, o, Number(number), plan);
  const ready = verifyReady(s, o, plan);
  if (op === 'export-paired') return exportPaired(o, ready);
  return { ready: true, scope, points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap,
    spentCny: ready.ledger.estimatedCost, remainingCny: ready.ledger.cap - ready.ledger.budgetCommitted };
}

main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(e => { console.error(e); process.exitCode = 1; });
