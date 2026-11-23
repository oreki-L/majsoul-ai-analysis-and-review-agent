'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { stableHash } = require('../core.cjs');
const { acquireLock, journal, readEvents } = require('../durable.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { sha256 } = require('../mortal-teaching/prompts.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const root = path.resolve(__dirname, '../..');
const originalHash = '2b072cee2629eedcb9fcfd2d296038142d3ee730a33158ee4f3bb0d4962ded62';
const expansionHash = '77c430b5154543eda799a5053c97a9cf19de3e4722a65eb8b8c03a8d04d00280';
const followupName = 'current-teaching-v13-continue56-20261121';
const index = (events, kind, key) => new Map(events.filter(e => e.kind === kind).map(e => [e.payload[key], e.payload]));
const action = ({ action, followUp, identity }) => ({ action, followUp: followUp ?? null, identity });

async function main([mode, ...extra]) {
  assert.ok(['prepare', 'verify', '--dispatch'].includes(mode) && extra.length === 0);
  const evidence = path.join(root, 'research/evidence');
  const source = path.join(evidence, 'current-teaching-v6-live-20261117');
  const prior = path.join(evidence, 'current-teaching-v13-cny10-20261121');
  const extension = path.join(evidence, 'current-teaching-v13-expand24-20261121');
  const output = path.join(evidence, followupName);
  const original = read(path.join(prior, 'manifest.json')), expansion = read(path.join(extension, 'manifest.json'));
  assert.equal(stableHash(original), originalHash);
  assert.equal(stableHash(expansion), expansionHash);
  assert.deepEqual(expansion.rules, original.rules);
  assert.equal(expansion.priorHash, originalHash);
  assert.equal(expansion.datasetHash, original.datasetHash);
  assert.equal(read(path.join(extension, 'offline-report.json')).manifestHash, expansionHash);
  assert.equal(path.join(prior, 'budget'), original.budget.directory);
  // Hold both original locks until any continuation spending stops.
  const unlockRun = acquireLock(path.join(prior, 'live/run.lock'));
  try {
    const budgetFile = path.join(original.budget.directory, 'budget.json');
    const unlockBudget = acquireLock(budgetFile + '.lock', true);
    try {
      const ledger = journal(budgetFile + '.events.jsonl').latestBudget();
      assert.deepEqual(ledger, read(budgetFile));
      const { cap, budgetCommitted, reserved } = ledger;
      assert.equal(cap, 10);
      assert.equal(ledger.reservationCount, 1);
      assert.equal(reserved, original.budget.fullContextReservationCny);
      assert.equal(budgetCommitted, ledger.estimatedCost + reserved);
      const [[reservation, entry]] = ledger.reservationEntries;
      const attempts = readEvents(path.join(original.budget.directory, 'attempts.jsonl'));
      const sent = index(attempts, 'dispatch', 'attemptId').get(entry.meta.attemptId);
      const response = index(attempts, 'response', 'attemptId').get(entry.meta.attemptId);
      assert.equal(sent.reservation, reservation);
      assert.equal(response.estimatedCost, null);
      assert.equal(response.status, 200);
      const first = readEvents(path.join(prior, 'live/results.jsonl'));
      const done = first.filter(e => e.kind === 'result').map(e => e.payload);
      assert.deepEqual(first.filter(e => e.kind === 'start').map(e => e.payload.id), done.map(r => r.id));
      assert.deepEqual(done.map(r => r.nodeId), original.jobs.slice(0, 8).map(j => j.nodeId));
      assert.equal(done.filter(r => r.delivered).length, 7);
      assert.equal(done[7].id, sent.identity.jobId);
      assert.equal(done[7].delivered, false);
      const subcap = Math.floor((cap - budgetCommitted) * 100) / 100;
      assert.ok(subcap >= original.budget.fullContextReservationCny && budgetCommitted + subcap <= cap);

      const oldControls = Object.fromEntries(original.jobs.filter(j => j.protection).map(j => [j.nodeId, j.protection]));
      const versions = { prompt: original.promptVersion, facts: original.factCardVersion };
      const sourceLog = readEvents(path.join(source, 'live/results.jsonl'));
      const priorRows = index(sourceLog, 'result', 'nodeId');
      const traces = new Map(sourceLog.filter(e => e.kind === 'trace' && e.payload.kind === 'pi-input').map(e => [e.payload.jobId, e.payload.value]));
      const cachedRows = index(readEvents(path.join(source, 'engine-cache.jsonl')), 'result', 'nodeId');
      function makePlan(s, o, maxCny) {
        assert.equal(o, output); assert.equal(maxCny, subcap);
        const p = plan(s, o, maxCny, { versions, selection: { priority: original.jobs.map(j => j.nodeId), extraControls: oldControls },
          extraCode: ['benchmark/current-teaching-v13/regression.cjs', 'benchmark/current-teaching-v13/continue.cjs'] });
        assert.deepEqual(p.manifest.sourceHashes, original.sourceHashes);
        for (const [file, digest] of Object.entries(original.code)) assert.equal(p.manifest.code[file], digest, file);
        assert.deepEqual(p.manifest.jobs.map(j => j.nodeId), original.jobs.map(j => j.nodeId));
        const check = (a, b) => { for (const k of ['inputHash', 'actionHash', 'historyHash', 'currentMessageHash']) assert.equal(a[k], b[k]); };
        p.manifest.jobs.forEach((j, i) => check(j, original.jobs[i]));
        const nodes = new Map(p.data.nodes.map(n => [n.id, n]));
        const added = expansion.jobs.map(j => {
          const node = nodes.get(j.nodeId), prev = priorRows.get(j.nodeId), c = cachedRows.get(j.nodeId);
          assert.ok(node.compatible && prev.delivered && !prev.mock);
          assert.equal(node.inputHash, prev.inputHash); assert.equal(node.inputHash, c.inputHash);
          const cached = action(c.result.engine), messages = traces.get(prev.id).messages;
          assert.deepEqual(cached, action(prev.outcome.engine));
          const history = messages.slice(0, -2), historyHash = stableHash(history), currentMessageHash = stableHash(messages.at(-2));
          check({ inputHash: node.inputHash, actionHash: stableHash(cached), historyHash, currentMessageHash }, j);
          return { node, cached, history, historyHash, currentMessageHash, targets: [], protection: 'expansion' };
        });
        p.cases = [...p.cases.slice(8), ...added];
        p.manifest.jobs = [...p.manifest.jobs.slice(8), ...expansion.jobs];
        assert.equal(new Set([...done, ...p.manifest.jobs].map(j => j.nodeId)).size, 64);
        Object.assign(p.manifest, { format: 'mortal-teaching-v13-continuation-v1', priorHash: originalHash, expansionHash,
          inheritedBudget: { ledgerHash: stableHash(ledger), cap, knownCny: ledger.estimatedCost, heldCny: reserved,
            attemptId: entry.meta.attemptId, receipt: null, subcap } });
        return p;
      }
      if (mode === 'prepare') {
        const { jobs, ...summary } = await offline(source, output, subcap, { makePlan });
        return { ...summary, subcap, heldCny: reserved };
      }
      if (mode === '--dispatch') return await runLive(source, output, 56, makePlan);
      const ready = verifyReady(source, output, makePlan);
      const digest = sha256(fs.readFileSync(__filename));
      assert.equal(ready.manifest.code['benchmark/current-teaching-v13/continue.cjs'], digest);
      return { points: ready.cases.length, subcap, heldCny: reserved, wholeCap: cap, spentCny: ready.ledger.estimatedCost, hash: ready.hash };
    } finally { unlockBudget(); }
  } finally { unlockRun(); }
}

main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
