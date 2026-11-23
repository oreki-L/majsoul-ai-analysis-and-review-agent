'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const priorHash = 'afcec34f556715cd42c745f8806f6a5395057f9612ac34fef8dc04e8276f382f';
const versions = { prompt: 16, facts: 13 };
const ranking = 'd-06fc9e61eec0210e70e0ebbe';
const safety = new Set(['expanded-east3-h0-p70', 'd-561794c3743ac32356113699', 'd-4f6f2ff9dd2ed9e7b6b84eac',
  'expanded-east3-h0-p86', 'expanded-east3-h0-p14']);
const results = events => new Map(events.filter(e => e.kind === 'result').map(e => [e.payload.nodeId, e.payload]));
const action = ({ action, followUp, identity }) => ({ action, followUp: followUp ?? null, identity });

function checkFacts(id, facts) {
  const d = facts.explanationFocus.discard;
  if (id === ranking) {
    assert.equal(d.efficiencyComparison.sameShantenUnseen.wording, '切东后为2向听，未见进张上界41枚；在2向听档唯一最高');
    assert.equal(d.safetyByOpponent.length, 3);
    for (const o of d.safetyByOpponent) assert.deepEqual(o.evidence.map(e => e.type), ['river']);
    assert.match(d.kokushiSafetyNote, /不能单独排除/);
  }
  if (safety.has(id)) {
    assert.equal(d.safetyByOpponent.length, 3);
    assert.ok(d.safetyByOpponent.every(o => o.status === 'unknown'));
    assert.equal(d.safetyEvidenceGapWording, `当前资料未确认${facts.actionTransition.discardedTile.name}对任一对手的安全依据`);
  }
}

async function main([mode, evidenceArg, outputArg, count, ...extra]) {
  if (!outputArg || extra.length || !['prepare', 'verify', '--dispatch'].includes(mode) ||
      (mode === '--dispatch') !== (count !== undefined)) {
    throw new Error('Usage: regression.cjs prepare|verify|--dispatch EVIDENCE_ROOT OUTPUT [MAX_POINTS for --dispatch]');
  }
  const evidence = path.resolve(evidenceArg), output = path.resolve(outputArg);
  const source = path.join(evidence, 'current-teaching-v6-live-20261117');
  const prior = path.join(evidence, 'current-teaching-v14-ready-20261122');
  assert.ok(![source, prior].includes(output));
  const archived = read(path.join(prior, 'manifest.json'));
  assert.equal(stableHash(archived), priorHash);
  assert.equal(archived.jobs.length, 64);

  function makePlan(s, out, cap) {
    assert.equal(cap, 10);
    const extraControls = Object.fromEntries(archived.jobs.filter(j => j.protection).map(j => [j.nodeId, j.protection]));
    const p = plan(s, out, cap, { versions, selection: { extraControls }, extraCode: ['benchmark/current-teaching-v16/regression.cjs'] });
    for (const k of ['sourceHashes', 'rules', 'datasetHash', 'binding']) assert.deepEqual(p.manifest[k], archived[k]);
    const log = readEvents(path.join(s, 'live/results.jsonl'));
    const previous = results(log), engines = results(readEvents(path.join(s, 'engine-cache.jsonl')));
    const traces = new Map(log.filter(e => e.kind === 'trace' && e.payload.kind === 'pi-input').map(e => [e.payload.jobId, e.payload.value]));
    const nodes = new Map(p.data.nodes.map(n => [n.id, n]));
    const primary = new Map(p.cases.map(c => [c.node.id, c]));
    p.cases = archived.jobs.map(j => {
      const id = j.nodeId, node = nodes.get(id), before = previous.get(id), engine = engines.get(id);
      assert.ok(node?.compatible && before?.delivered && !before.mock);
      assert.equal(node.inputHash, engine.inputHash);
      assert.equal(node.inputHash, before.inputHash);
      const cached = action(engine.result.engine), messages = traces.get(before.id).messages;
      assert.deepEqual(action(before.outcome.engine), cached);
      const history = messages.slice(0, -2), historyHash = stableHash(history), currentMessageHash = stableHash(messages.at(-2));
      assert.deepEqual([node.inputHash, stableHash(cached), historyHash, currentMessageHash],
        [j.inputHash, j.actionHash, j.historyHash, j.currentMessageHash], id);
      return primary.get(id) ?? { node, cached, history, historyHash, currentMessageHash, targets: [], protection: 'v14 expansion' };
    });
    Object.assign(p.manifest, { format: 'mortal-teaching-v16-regression-v1', priorHash,
      jobs: archived.jobs.map(j => ({ ...j, defenseTarget: safety.has(j.nodeId) })) });
    return p;
  }

  if (mode === '--dispatch') return runLive(source, output, Number(count), makePlan);
  if (mode === 'prepare') {
    const { jobs, ...summary } = await offline(source, output, 10, { makePlan, checkFacts });
    return summary;
  }
  const ready = verifyReady(source, output, makePlan);
  return { points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap, committedCny: ready.ledger.budgetCommitted };
}

main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
