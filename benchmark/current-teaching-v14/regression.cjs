'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const originalHash = '2b072cee2629eedcb9fcfd2d296038142d3ee730a33158ee4f3bb0d4962ded62';
const expansionHash = '77c430b5154543eda799a5053c97a9cf19de3e4722a65eb8b8c03a8d04d00280';
const rankingTarget = 'd-06fc9e61eec0210e70e0ebbe';
const deliveryTargets = ['d-4b779daf10bf82c830c9632f', 'd-567ab9a74182f2e9ca32138b'];
const safetyTargets = ['expanded-east3-h0-p70', 'd-561794c3743ac32356113699', 'd-4f6f2ff9dd2ed9e7b6b84eac',
  'expanded-east3-h0-p86', 'expanded-east3-h0-p14'];
const priority = [...deliveryTargets, rankingTarget, ...safetyTargets];
const results = events => new Map(events.filter(e => e.kind === 'result').map(e => [e.payload.nodeId, e.payload]));
const action = ({ action, followUp, identity }) => ({ action, followUp: followUp ?? null, identity });

function checkFacts(id, facts) {
  const d = facts.explanationFocus.discard;
  if (id === rankingTarget) {
    assert.deepEqual(d.efficiencyComparison.sameShantenUnseen, {
      conclusion: '唯一最高', highest: 41, wording: '切东后为2向听，未见进张上界41枚；在2向听档唯一最高',
    });
    assert.ok(facts.candidateEfficiency.rows.some(([, shanten, upper]) => shanten === 3 && upper === 41));
    assert.match(d.kokushiSafetyNote, /不能单独排除/);
    assert.equal(d.safetyByOpponent.length, 3);
    for (const o of d.safetyByOpponent) assert.deepEqual(o.evidence.map(e => e.type), ['river']);
    assert.equal(d.safetyEvidenceGapWording, null);
  } else if (safetyTargets.includes(id)) {
    assert.ok(d.safetyByOpponent.length > 0);
    if (d.safetyByOpponent.every(o => o.status === 'unknown')) {
      assert.equal(d.safetyEvidenceGapWording, `当前资料未确认${facts.actionTransition.discardedTile.name}对任一对手的安全依据`);
    } else {
      assert.equal(d.safetyEvidenceGapWording, null);
    }
  }
}

async function main([mode, evidenceArg, outputArg, maxPoints, ...extra]) {
  if (!outputArg || maxPoints === '' || extra.length || !['prepare', 'verify', '--dispatch'].includes(mode) ||
      (mode === '--dispatch') !== (maxPoints !== undefined)) {
    throw new Error('Usage: regression.cjs prepare|verify|--dispatch EVIDENCE_ROOT OUTPUT [MAX_POINTS for --dispatch]');
  }
  const evidence = path.resolve(evidenceArg), output = path.resolve(outputArg);
  const source = path.join(evidence, 'current-teaching-v6-live-20261117');
  const prior = path.join(evidence, 'current-teaching-v13-cny10-20261121');
  const added = path.join(evidence, 'current-teaching-v13-expand24-20261121');
  const original = read(path.join(prior, 'manifest.json')), expansion = read(path.join(added, 'manifest.json'));
  assert.ok(![source, prior, added].includes(output));
  assert.equal(stableHash(original), originalHash);
  assert.equal(stableHash(expansion), expansionHash);
  const archive = new Map([...original.jobs, ...expansion.jobs].map(j => [j.nodeId, j]));
  assert.equal(archive.size, 64);

  function makePlan(s, out, cap) {
    assert.equal(cap, 10);
    const extraControls = Object.fromEntries(original.jobs.filter(j => j.protection).map(j => [j.nodeId, j.protection]));
    const p = plan(s, out, cap, { versions: { prompt: 14, facts: 13 }, selection: { extraControls },
      extraCode: ['benchmark/current-teaching-v14/regression.cjs'] });
    assert.deepEqual(p.manifest.sourceHashes, original.sourceHashes);
    assert.deepEqual(p.manifest.rules, original.rules);
    assert.equal(p.manifest.datasetHash, original.datasetHash);

    const log = readEvents(path.join(s, 'live/results.jsonl'));
    const previous = results(log), engines = results(readEvents(path.join(s, 'engine-cache.jsonl')));
    const traces = new Map(log.filter(e => e.kind === 'trace' && e.payload.kind === 'pi-input').map(e => [e.payload.jobId, e.payload.value]));
    const nodes = new Map(p.data.nodes.map(n => [n.id, n]));
    const originalCases = new Map(p.cases.map(c => [c.node.id, c]));
    const originalJobs = new Map(p.manifest.jobs.map(j => [j.nodeId, j]));
    assert.deepEqual(new Set(originalCases.keys()), new Set(original.jobs.map(j => j.nodeId)));

    const ordered = [...new Set([...priority, ...archive.keys()])];
    assert.equal(ordered.length, 64);
    p.cases = ordered.map(id => {
      const frozen = archive.get(id), node = nodes.get(id), engine = engines.get(id), before = previous.get(id);
      assert.ok(node?.compatible && before?.delivered && !before.mock);
      assert.equal(node.inputHash, before.inputHash);
      assert.equal(node.inputHash, engine.inputHash);
      const cached = action(engine.result.engine), messages = traces.get(before.id).messages;
      assert.deepEqual(cached, action(before.outcome.engine));
      const history = messages.slice(0, -2), historyHash = stableHash(history), currentMessageHash = stableHash(messages.at(-2));
      assert.deepEqual([node.inputHash, stableHash(cached), historyHash, currentMessageHash],
        [frozen.inputHash, frozen.actionHash, frozen.historyHash, frozen.currentMessageHash], id);
      return originalCases.get(id) ?? { node, cached, history, historyHash, currentMessageHash, targets: [], protection: 'expansion' };
    });
    Object.assign(p.manifest, { format: 'mortal-teaching-v14-regression-v1', originalHash, expansionHash,
      jobs: ordered.map(id => ({ ...(originalJobs.get(id) ?? archive.get(id)), priority: priority.includes(id) })) });
    return p;
  }

  if (mode === 'prepare') {
    const { jobs, ...summary } = await offline(source, output, 10, { makePlan, checkFacts });
    return summary;
  }
  if (mode === '--dispatch') return runLive(source, output, Number(maxPoints), makePlan);
  const ready = verifyReady(source, output, makePlan);
  return { points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap, committedCny: ready.ledger.budgetCommitted };
}

main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
