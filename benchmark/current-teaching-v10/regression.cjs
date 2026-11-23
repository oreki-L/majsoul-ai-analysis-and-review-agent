'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents, acquireLock } = require('../durable.cjs');
const { createQueue } = require('../mortal-teaching/review.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const referenceHash = '800aebd7ee3f869aa15ec1e89cef17fcecad32f38bd5e5faea5beb14af5865e0';
const targets = {
  'd-7dd402bad11e14bbc8bf193f': 'double-pair wait',
  'expanded-east1-h0-p86': 'one-shanten improvements',
  'expanded-east1-h0-p2': 'discarded singleton',
  'expanded-south2-h2-p72': 'red dora vs indicator',
  'd-06fc9e61eec0210e70e0ebbe': 'opponent own river vs post-riichi pass',
  'd-4b779daf10bf82c830c9632f': 'preserve exact whole-hand waits',
  'd-ec4475c3222d5038567de0ba': 'preserve three-color straight evidence',
};
const controls = ['d-7e27a513fc756dd3006d31d7', 'd-3858152e34de47e288fc7700', 'd-ea3455f69a77bda223d4978d',
  'd-69198271b18addf8f2ed9fa6', 'expanded-south2-h2-p56', 'd-3c17fa5e6fdfeaecc97e8cfc', 'expanded-east1-h0-p96'];
const selected = [...Object.keys(targets), ...controls];
const resultsIn = file => readEvents(file).filter(e => e.kind === 'result').map(e => e.payload);

function planWithPrior(source, prior, output, cap) {
  const original = read(path.join(prior, 'manifest.json'));
  assert.equal(stableHash(original), referenceHash);
  const archived = resultsIn(path.join(prior, 'live/results.jsonl'));
  assert.deepEqual(archived.map(r => r.nodeId), original.jobs.map(j => j.nodeId));
  const reviews = new Map(createQueue(path.join(prior, 'live/review'), referenceHash).snapshot().map(j => [j.resultId, j]));
  const reference = new Map(original.jobs.map((j, i) => [j.nodeId, [j, archived[i]]]));
  const extraControls = Object.fromEntries(original.jobs.filter(j => !j.priorV7).map(j => [j.nodeId, j.protection]));
  const prepared = plan(source, output, cap, { versions: { prompt: 10, facts: 9 }, selection: { extraControls, priority: selected },
    extraCode: ['benchmark/current-teaching-v10/regression.cjs'] });
  const { manifest } = prepared;
  assert.equal(manifest.datasetHash, original.datasetHash);
  assert.equal(manifest.rules.requiredModel, 'gpt-6.2-sol');
  assert.equal(manifest.rules.reasoningEffort, 'low');
  manifest.format = 'mortal-targeted-regression-v5';
  manifest.priorV8ManifestHash = referenceHash;
  manifest.jobs = manifest.jobs.slice(0, selected.length);
  prepared.cases = prepared.cases.slice(0, selected.length);
  assert.deepEqual(manifest.jobs.map(j => j.nodeId), selected);
  for (const job of manifest.jobs) {
    const [prev, r] = reference.get(job.nodeId), scored = reviews.get(r.id);
    assert.ok(r.delivered && scored.state === 'complete');
    assert.equal(stableHash(r.reviewSource), stableHash({ answer: scored.packet.answer, facts: scored.packet.facts }));
    for (const key of ['inputHash', 'actionHash', 'historyHash', 'currentMessageHash']) assert.equal(job[key], prev[key]);
    job.target = targets[job.nodeId] ?? null;
    job.referenceHash = stableHash(r.reviewSource);
  }
  return { ...prepared, reference };
}

function verifyTargetFacts(id, facts) {
  const d = facts.explanationFocus.discard;
  switch (id) {
    case 'd-7dd402bad11e14bbc8bf193f':
      assert.equal(d.tenpai.verifiedWaitType, '双碰');
      assert.deepEqual(d.tenpai.shapeWaits.map(([t]) => t), ['6索(6s)', '8索(8s)']); break;
    case 'expanded-east1-h0-p86':
      assert.equal(d.efficiency.shanten, 1); assert.equal(d.waitState, '未听牌'); assert.equal(d.tenpai, null);
      assert.deepEqual(d.efficiency.effectiveTiles.map(w => w.tile), ['5m', '8m']); break;
    case 'expanded-east1-h0-p2':
      assert.deepEqual(d.selectedKindIsolated, { before: true, after: false }); break;
    case 'expanded-south2-h2-p72':
      assert.equal(d.tileFacts.isRedFive, true); assert.equal(d.tileFacts.isDoraFromIndicator, false);
      assert.match(d.tileFacts.redDoraIdentity, /赤宝牌/); break;
    case 'd-06fc9e61eec0210e70e0ebbe': {
      const sources = d.safetyByOpponent.find(o => o.relativeName === '对家').confirmedSources;
      assert.ok(sources.includes('对手本人弃过该牌'));
      assert.ok(!sources.includes('已核实立直后通过'));
      break;
    }
    case 'd-4b779daf10bf82c830c9632f':
      assert.deepEqual(d.tenpai.shapeWaits.map(([t]) => t), ['3筒(3p)', '4筒(4p)']); break;
    case 'd-ec4475c3222d5038567de0ba':
      assert.deepEqual(d.tenpai.shapeWaits, [['2万(2m)', 3]]);
      assert.ok(d.tenpai.knownYakuByDiscard.find(row => row.discard === '5万(5m)').waits.some(([t, yaku]) => t === '2万(2m)' && yaku.includes('三色同顺'))); break;
  }
}

function exportPaired(output, ready) {
  const directory = path.join(output, 'paired-review'), unlock = acquireLock(path.join(directory, 'export.lock'));
  try {
    const generated = new Map(resultsIn(path.join(output, 'live/results.jsonl')).map(r => [r.nodeId, r]));
    const queue = createQueue(directory, ready.hash);
    for (const j of ready.manifest.jobs) {
      const newResult = generated.get(j.nodeId);
      if (!newResult?.delivered) continue;
      const [, prior] = ready.reference.get(j.nodeId);
      for (const key of ['snapshot', 'legalActions', 'engine', 'authorizedHistory'])
        assert.equal(stableHash(prior.reviewSource.facts[key]), stableHash(newResult.reviewSource.facts[key]));
      queue.add({ resultId: `v8:${j.nodeId}`, ...prior.reviewSource });
      queue.add({ resultId: `v10:${j.nodeId}`, ...newResult.reviewSource });
    }
    return { paired: queue.snapshot().length / 2, batch: queue.exportPackets() };
  } finally { unlock(); }
}

async function main([mode, source, prior, output, number, ...extra]) {
  const needsNumber = ['prepare', '--dispatch'].includes(mode);
  if (!source || !prior || !output || extra.length || !['prepare', 'verify', '--dispatch', 'export-paired'].includes(mode) || needsNumber !== (number !== undefined))
    throw new Error('Usage: regression.cjs prepare|--dispatch SOURCE V8_EVIDENCE OUTPUT CAP_CNY|MAX_POINTS; verify|export-paired SOURCE V8_EVIDENCE OUTPUT');
  const [s,p,o] = [source, prior, output].map(v => path.resolve(v));
  const makePlan = (source, output, cap) => planWithPrior(source, p, output, cap);
  if (mode === 'prepare') { const { jobs, ...summary } = await offline(s, o, Number(number), { makePlan, checkFacts: verifyTargetFacts }); return summary; }
  if (mode === '--dispatch') return runLive(s, o, Number(number), makePlan);
  const ready = verifyReady(s, o, makePlan);
  if (mode === 'export-paired') return exportPaired(o, ready);
  return { ready: true, points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap,
    spentCny: ready.ledger.estimatedCost, remainingCny: ready.ledger.cap - ready.ledger.budgetCommitted };
}

main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e); process.exitCode = 1; });
