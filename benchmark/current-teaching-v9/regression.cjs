'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { createQueue } = require('../mortal-teaching/review.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const referenceHash = '800aebd7ee3f869aa15ec1e89cef17fcecad32f38bd5e5faea5beb14af5865e0';
const wrongWait = 'd-4b779daf10bf82c830c9632f', missedYaku = 'd-ec4475c3222d5038567de0ba';
function planWithPrior(source, prior, output, cap) {
  const at = filename => path.join(prior, filename), original = read(at('manifest.json'));
  assert.equal(stableHash(original), referenceHash);
  const results = readEvents(at('live/results.jsonl')).filter(e => e.kind === 'result').map(e => e.payload);
  assert.deepEqual(results.map(r => r.nodeId), original.jobs.map(j => j.nodeId));
  const reviews = new Map(createQueue(at('live/review'), referenceHash).snapshot().map(j => [j.resultId, j]));
  assert.equal(reviews.size, 40);
  const previous = new Map(original.jobs.map((j, i) => [j.nodeId, [j, results[i]]]));
  const extraControls = Object.fromEntries(original.jobs.filter(j => !j.priorV7).map(j => [j.nodeId, j.protection]));
  const priority = [wrongWait, missedYaku, ...original.jobs.map(j => j.nodeId)];
  const prepared = plan(source, output, cap, { versions: { prompt: 9, facts: 8 }, selection: { extraControls, priority },
    extraCode: ['benchmark/current-teaching-v9/regression.cjs'] });
  const { manifest } = prepared;
  assert.equal(manifest.datasetHash, original.datasetHash);
  assert.equal(manifest.jobs.length, 40);
  for (const j of manifest.jobs) {
    const [prev, result] = previous.get(j.nodeId), scored = reviews.get(result.id);
    assert.ok(result.delivered && scored.state === 'complete');
    assert.equal(scored.packet.answer, result.reviewSource.answer);
    for (const key of ['inputHash', 'actionHash', 'historyHash', 'currentMessageHash', 'baselineAnswerHash']) assert.equal(j[key], prev[key]);
    const review = scored.review;
    j.priorV8 = { score: review.commonMean, gate: review.gate, reviewHash: stableHash(review), answerHash: stableHash(scored.packet.answer),
      errors: review.errors.map(e => ({ severity: e.severity, reason: e.reason, citation: review.citations[e.citation] })) };
  }
  assert.equal(manifest.jobs.filter(j => j.priorV8.gate === 'pass').length, 38);
  manifest.format = 'mortal-targeted-regression-v4';
  manifest.priorV8ManifestHash = referenceHash;
  return prepared;
}

function verifyTargetFacts(id, facts) {
  if (![wrongWait, missedYaku].includes(id)) return;
  const tenpai = facts.explanationFocus.discard.tenpai;
  if (id === wrongWait) assert.deepEqual(tenpai.shapeWaits.map(([tile]) => tile), ['3筒(3p)', '4筒(4p)']);
  else {
    assert.deepEqual(tenpai.shapeWaits, [['2万(2m)', 3]]);
    assert.ok(tenpai.knownYakuByDiscard.find(r => r.discard === '5万(5m)').waits.some(([tile, types]) => tile === '2万(2m)' && types.includes('三色同顺')));
    assert.equal(tenpai.knownYakuByDiscard.some(r => r.discard === '1万(1m)'), false);
  }
}

async function main([mode, source, prior, output, number, ...extra]) {
  if (!source || !prior || !output || extra.length || !['prepare', 'verify', '--dispatch'].includes(mode) || (mode === 'verify') === (number !== undefined))
    throw new Error('Usage: regression.cjs prepare SOURCE V8_EVIDENCE OUTPUT CAP_CNY | verify SOURCE V8_EVIDENCE OUTPUT | --dispatch SOURCE V8_EVIDENCE OUTPUT MAX_POINTS');
  const [s,p,o] = [source, prior, output].map(v => path.resolve(v));
  const makePlan = (source, output, cap) => planWithPrior(source, p, output, cap);
  if (mode === 'prepare') { const { jobs, ...summary } = await offline(s, o, Number(number), { makePlan, checkFacts: verifyTargetFacts }); return summary; }
  if (mode === '--dispatch') return runLive(s, o, Number(number), makePlan);
  const ready = verifyReady(s, o, makePlan);
  return { ready: true, points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap,
    spentCny: ready.ledger.estimatedCost, remainingCny: ready.ledger.cap - ready.ledger.budgetCommitted };
}

main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error); process.exitCode = 1; });
