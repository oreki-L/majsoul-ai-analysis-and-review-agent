'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents, acquireLock } = require('../durable.cjs');
const { createQueue } = require('../mortal-teaching/review.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const shantenTarget = 'd-7dd402bad11e14bbc8bf193f', supplyTarget = 'expanded-east1-h0-p96';
const targets = { [shantenTarget]: 'shared shanten wording', [supplyTarget]: 'local completion supply by tile' };
const resultsIn = dir => readEvents(path.join(dir, 'live/results.jsonl')).filter(e => e.kind === 'result').map(e => e.payload);
const sameInputs = ['inputHash', 'actionHash', 'historyHash', 'currentMessageHash'];

function planWithPrior(source, baseline, prior, output, cap) {
  const old = read(path.join(prior, 'manifest.json')), priorHash = stableHash(old);
  const v8 = read(path.join(baseline, 'manifest.json'));
  assert.equal(priorHash, 'b849eb117db5852abe0eebf14ea7e6d77106ffe0832bc2a7330b29ebde7993a5');
  assert.equal(stableHash(v8), old.priorV8ManifestHash);
  const originals = new Map(resultsIn(baseline).map(r => [r.nodeId, r]));
  const priority = [...Object.keys(targets), ...old.jobs.map(j => j.nodeId).filter(id => !Object.hasOwn(targets, id))];
  const extraControls = Object.fromEntries(old.jobs.filter(j => j.protection).map(j => [j.nodeId, j.protection]));
  const p = plan(source, output, cap, { versions: { prompt: 11, facts: 10 }, selection: { extraControls, priority },
    extraCode: ['benchmark/current-teaching-v11/regression.cjs'] });
  assert.equal(p.manifest.datasetHash, old.datasetHash);
  assert.equal(p.manifest.rules.requiredModel, 'gpt-6.2-sol');
  assert.equal(p.manifest.rules.reasoningEffort, 'low');
  const previous = new Map(old.jobs.map(j => [j.nodeId, j]));
  const jobs = p.manifest.jobs.slice(0, priority.length).map(j => {
    const before = previous.get(j.nodeId), archived = originals.get(j.nodeId);
    assert.ok(archived.delivered);
    assert.equal(stableHash(archived.reviewSource), before.referenceHash);
    for (const k of sameInputs) assert.equal(j[k], before[k]);
    return { ...j, target: targets[j.nodeId] ?? null, referenceHash: before.referenceHash };
  });
  assert.deepEqual(jobs.map(j => j.nodeId), priority);
  return { ...p, cases: p.cases.slice(0, priority.length), originals,
    manifest: { ...p.manifest, format: 'mortal-targeted-regression-v6', priorV10ManifestHash: priorHash, priorV8ManifestHash: old.priorV8ManifestHash, jobs } };
}

function verifyTargetFacts(id, facts) {
  const discard = facts.explanationFocus.discard;
  if (id === shantenTarget) {
    assert.deepEqual(facts.actionTransition.shanten, { before: 0, after: 0, change: 'unchanged' });
    assert.equal(facts.actionTransition.shantenWording, '弃牌后维持0向听（形状听牌）');
    assert.equal(discard.tenpai.verifiedWaitType, '双碰');
    assert.deepEqual(discard.tenpai.shapeWaits.map(([tile]) => tile), ['6索(6s)', '8索(8s)']);
  } else if (id === supplyTarget) {
    const links = discard.localLinks;
    assert.deepEqual(links.before.map(p => [p.tiles, p.waits.map(w => [w.tile.code, w.unseenUpperBound]), p.completionSupply]), [
      [['6s', '7s'], [['5s', 4], ['8s', 0]], '至少一种补牌的未见上界大于0'],
      [['7s', '8s'], [['6s', 2], ['9s', 0]], '至少一种补牌的未见上界大于0'],
    ]);
    assert.deepEqual(links.after, []);
  } else if (id === 'd-4b779daf10bf82c830c9632f') {
    assert.deepEqual(discard.tenpai.shapeWaits.map(([t]) => t), ['3筒(3p)', '4筒(4p)']);
  } else if (id === 'd-ec4475c3222d5038567de0ba') {
    assert.ok(discard.tenpai.knownYakuByDiscard.find(row => row.discard === '5万(5m)')?.waits.some(([t, yaku]) => t === '2万(2m)' && yaku.includes('三色同顺')));
  }
}

function exportPaired(output, ready) {
  const dir = path.join(output, 'paired-review'), unlock = acquireLock(path.join(dir, 'export.lock'));
  try {
    const queue = createQueue(dir, ready.hash), generated = new Map(resultsIn(output).map(r => [r.nodeId, r]));
    for (const { nodeId } of ready.manifest.jobs) {
      const fresh = generated.get(nodeId);
      if (!fresh?.delivered) continue;
      const old = ready.originals.get(nodeId);
      for (const k of ['snapshot', 'legalActions', 'engine', 'authorizedHistory']) {
        assert.equal(stableHash(old.reviewSource.facts[k]), stableHash(fresh.reviewSource.facts[k]));
      }
      queue.add({ resultId: `v8:${nodeId}`, ...old.reviewSource });
      queue.add({ resultId: `v11:${nodeId}`, ...fresh.reviewSource });
    }
    return { paired: queue.snapshot().length / 2, batch: queue.exportPackets() };
  } finally { unlock(); }
}

async function main([mode, source, baseline, prior, output, number, ...extra]) {
  const needsNumber = ['prepare', '--dispatch'].includes(mode);
  if (!source || !baseline || !prior || !output || extra.length || !['prepare', 'verify', '--dispatch', 'export-paired'].includes(mode) || needsNumber !== (number !== undefined))
    throw new Error('Usage: regression.cjs MODE SOURCE V8_EVIDENCE V10_EVIDENCE OUTPUT [CAP_CNY for prepare | MAX_POINTS for --dispatch]');
  const [s, b, p, o] = [source, baseline, prior, output].map(v => path.resolve(v));
  const makePlan = (source, output, cap) => planWithPrior(source, b, p, output, cap);
  if (mode === 'prepare') { const { jobs, ...summary } = await offline(s, o, Number(number), { makePlan, checkFacts: verifyTargetFacts }); return summary; }
  if (mode === '--dispatch') return runLive(s, o, Number(number), makePlan);
  const ready = verifyReady(s, o, makePlan);
  if (mode === 'export-paired') return exportPaired(o, ready);
  return { ready: true, points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap,
    spentCny: ready.ledger.estimatedCost, remainingCny: ready.ledger.cap - ready.ledger.budgetCommitted };
}

main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e); process.exitCode = 1; });
