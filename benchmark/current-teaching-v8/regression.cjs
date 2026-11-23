'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { createQueue } = require('../mortal-teaching/review.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const versions = { prompt: 8, facts: 7 };
const added = {
  'd-7dd402bad11e14bbc8bf193f': 'post-call discard with the only tenpai entry',
  'd-7e27a513fc756dd3006d31d7': 'unique highest with two tenpai entries and both red and ordinary fives in hand',
  'd-ec4475c3222d5038567de0ba': 'tenpai with a strictly higher same-shanten alternative',
  'd-3858152e34de47e288fc7700': 'two-way tie in a closed hand',
  'd-ea3455f69a77bda223d4978d': 'three-way tie when discarding the seat wind',
  'd-69198271b18addf8f2ed9fa6': 'red-five discard genuinely tied with an honor',
  'expanded-south2-h2-p56': 'post-call tie under riichi pressure',
  'expanded-south2-h2-p72': 'red-five discard with lower ukeire under riichi pressure',
  'd-06fc9e61eec0210e70e0ebbe': 'guest wind and unique highest under riichi pressure'
};
const priority = ['d-c534f2c6d29b89569b94032e', 'd-567ab9a74182f2e9ca32138b', 'd-7b693bb58237be093c405d44',
  'd-c81710fccaa98f25522d6177', 'd-99f9cc9a63a53a6ecc4a3895', 'd-2a54d453702769e3bee42a22', ...Object.keys(added)];

function planWithPrior(source, prior, output, cap) {
  const at = name => path.join(prior, name);
  const original = read(at('manifest.json')), originalHash = stableHash(original);
  assert.equal(originalHash, '1c31e187ef5e0893082eb0df4851b2b28970bbdacda46150bf4c495df2439061');
  const previousResults = readEvents(at('live/results.jsonl')).filter(e => e.kind === 'result').map(e => e.payload);
  const previousReviews = new Map(createQueue(at('live/review'), originalHash).snapshot().map(j => [j.resultId, j]));
  assert.equal(previousResults.length, 31);
  assert.equal(previousReviews.size, 31);
  const current = plan(source, output, cap, { versions, selection: { extraControls: added, priority },
    extraCode: ['benchmark/current-teaching-v8/regression.cjs'] });
  const { manifest } = current, previous = new Map(original.jobs.map((j, i) => [j.nodeId, { job: j, result: previousResults[i] }]));
  assert.equal(manifest.datasetHash, original.datasetHash);
  assert.equal(manifest.jobs.length, 40);
  assert.equal(original.jobs.length, 31);
  const carried = manifest.jobs.filter(j => !Object.hasOwn(added, j.nodeId));
  assert.deepEqual(carried.map(j => j.nodeId).sort(), [...previous.keys()].sort());
  for (const j of carried) {
    const { job, result } = previous.get(j.nodeId), scored = previousReviews.get(result.id);
    assert.equal(result.nodeId, j.nodeId);
    assert.ok(result.delivered && scored.state === 'complete');
    assert.equal(scored.packet.answer, result.reviewSource.answer);
    for (const field of ['inputHash', 'actionHash', 'historyHash', 'currentMessageHash', 'baselineAnswerHash']) assert.equal(j[field], job[field]);
    j.priorV7 = { resultId: result.id, reviewHash: stableHash(scored.review), answerHash: stableHash(scored.packet.answer),
      score: scored.review.commonMean, gate: scored.review.gate, errors: scored.review.errors.map(e => ({ severity: e.severity, reason: e.reason,
        citation: scored.review.citations[e.citation] })) };
  }
  manifest.format = 'mortal-targeted-regression-v3';
  manifest.priorV7ManifestHash = originalHash;
  return current;
}

function checkFacts(id, facts) {
  const discard = facts.explanationFocus.discard, rank = discard.efficiencyComparison?.sameShantenUnseen;
  const expected = {
    'd-c534f2c6d29b89569b94032e': ['唯一最高', 7], 'd-567ab9a74182f2e9ca32138b': ['唯一最高', 7],
    'd-7b693bb58237be093c405d44': ['唯一最高', 8], 'd-c81710fccaa98f25522d6177': ['唯一最高', 27],
    'd-7dd402bad11e14bbc8bf193f': ['该向听档只有这一项', 4], 'd-7e27a513fc756dd3006d31d7': ['唯一最高', 7],
    'd-ec4475c3222d5038567de0ba': ['非最高', 4], 'd-3858152e34de47e288fc7700': ['并列最高', 26, ['7万(7m)']],
    'd-ea3455f69a77bda223d4978d': ['并列最高', 43, ['7筒(7p)', '5索(5s)']],
    'd-69198271b18addf8f2ed9fa6': ['并列最高', 6, ['发(6z)']],
    'expanded-south2-h2-p56': ['并列最高', 19, ['中(7z)', '西(3z)', '白(5z)']],
    'expanded-south2-h2-p72': ['非最高', 29], 'd-06fc9e61eec0210e70e0ebbe': ['唯一最高', 41]
  }[id];
  if (expected) assert.deepEqual([rank.conclusion, rank.highest, ...(rank.tiedWithOtherDiscards ? [rank.tiedWithOtherDiscards] : [])], expected);
  if (id === 'd-99f9cc9a63a53a6ecc4a3895') assert.equal(discard.tileFacts.windRole, '客风');
  if (id === 'd-2a54d453702769e3bee42a22') {
    assert.equal(facts.selectedAction.afterDiscard.canonicalCounts['1z'], 1);
    assert.ok(!facts.explanationFocus.availableGroups.after.sameTileGroups.some(([tile]) => tile === '东(1z)'));
  }
  if (id === 'd-7e27a513fc756dd3006d31d7') {
    assert.equal(discard.efficiencyComparison.tenpaiCount, 2);
    for (const code of ['0p', '5p']) assert.ok(facts.candidateEfficiency.rows.some(([tile]) => tile.endsWith(`(${code})`)));
  }
}

async function main([mode, source, prior, output, number, ...extra]) {
  const noNumber = mode === 'verify';
  if (!source || !prior || !output || extra.length || !['prepare', 'verify', '--dispatch'].includes(mode) || noNumber === (number !== undefined))
    throw new Error('Usage: regression.cjs prepare SOURCE V7_EVIDENCE OUTPUT CAP_CNY | verify SOURCE V7_EVIDENCE OUTPUT | --dispatch SOURCE V7_EVIDENCE OUTPUT MAX_POINTS');
  const [s, p, o] = [source, prior, output].map(v => path.resolve(v));
  const makePlan = (source, output, cap) => planWithPrior(source, p, output, cap);
  if (mode === 'prepare') { const { jobs, ...summary } = await offline(s, o, Number(number), { makePlan, checkFacts }); return summary; }
  if (mode === '--dispatch') return runLive(s, o, Number(number), makePlan);
  const ready = verifyReady(s, o, makePlan);
  return { ready: true, points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap,
    spentCny: ready.ledger.estimatedCost, remainingCny: ready.ledger.cap - ready.ledger.budgetCommitted,
    expanded: Object.keys(added).length, hasLiveResults: fs.existsSync(path.join(o, 'live/results.jsonl')) };
}

if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error); process.exitCode = 1; });
