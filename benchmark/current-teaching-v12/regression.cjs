'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const red = 'd-567ab9a74182f2e9ca32138b', river = 'd-3c136cc97af63af46851a5ba';
const targetIds = [red, river];

function checkFacts(id, facts) {
  const d = facts.explanationFocus.discard;
  if (id === red) {
    assert.equal(d.tile, '赤5万(0m)');
    assert.deepEqual(d.ownSameTile, [1, 0]);
    assert.match(d.removedKindWording, /弃后暗手已无5万/);
    assert.deepEqual(d.tenpai.shapeWaits, [['3筒(3p)', 3], ['4筒(4p)', 4]]);
    assert.deepEqual(d.tenpai.fixedYakuhaiSources, ['明刻「中」提供役牌（三元牌），与补牌或雀头无关']);
  } else if (id === river) {
    assert.equal(facts.binding.selfSeat, 1);
    const next = d.safetyByOpponent.find(o => o.seat === 2), across = d.safetyByOpponent.find(o => o.seat === 3);
    assert.equal(next.relativeName, '下家');
    assert.ok(next.wording.includes('下家本人牌河第5、9张弃过9筒，9筒对下家是现物'));
    assert.equal(across.relativeName, '对家');
    assert.deepEqual(across.wording, []);
  } else if (id === 'd-7dd402bad11e14bbc8bf193f') {
    assert.equal(facts.actionTransition.shantenWording, '弃牌后维持0向听（形状听牌）');
    assert.equal(d.tenpai.verifiedWaitType, '双碰');
  } else if (id === 'expanded-east1-h0-p96') {
    assert.deepEqual(d.localLinks.before.map(p => [p.tiles, p.waits.map(w => [w.tile.code, w.unseenUpperBound]), p.completionSupply]), [
      [['6s', '7s'], [['5s', 4], ['8s', 0]], '至少一种补牌的未见上界大于0'],
      [['7s', '8s'], [['6s', 2], ['9s', 0]], '至少一种补牌的未见上界大于0'],
    ]);
  }
}

async function main([mode, source, baseline, output, number, ...extra]) {
  if (!output || extra.length || !['prepare', 'verify', '--dispatch'].includes(mode) || ['prepare', '--dispatch'].includes(mode) !== (number !== undefined))
    throw new Error('Usage: regression.cjs prepare|verify|--dispatch SOURCE V8_EVIDENCE OUTPUT [CAP_CNY for prepare | MAX_POINTS for --dispatch]');
  const [s, base, out] = [source, baseline, output].map(v => path.resolve(v));
  const archived = read(path.join(base, 'manifest.json')), referenceHash = stableHash(archived);
  assert.equal(referenceHash, '800aebd7ee3f869aa15ec1e89cef17fcecad32f38bd5e5faea5beb14af5865e0');
  const old = new Map(archived.jobs.map(j => [j.nodeId, j]));
  const priority = [...targetIds, ...old.keys()].filter((id, i, ids) => ids.indexOf(id) === i);
  const extraControls = Object.fromEntries(archived.jobs.filter(j => j.protection).map(j => [j.nodeId, j.protection]));
  function makePlan(source, output, cap) {
    const prepared = plan(source, output, cap, { versions: { prompt: 12, facts: 11 }, selection: { priority, extraControls },
      extraCode: ['benchmark/current-teaching-v12/regression.cjs'] });
    const { manifest } = prepared;
    assert.equal(manifest.datasetHash, archived.datasetHash);
    assert.deepEqual([manifest.rules.requiredModel, manifest.rules.reasoningEffort], ['gpt-6.2-sol', 'low']);
    assert.deepEqual(manifest.jobs.map(j => j.nodeId), priority);
    for (const j of manifest.jobs) {
      for (const k of ['inputHash', 'actionHash', 'historyHash', 'currentMessageHash']) assert.equal(j[k], old.get(j.nodeId)[k]);
      j.target = targetIds.includes(j.nodeId);
    }
    manifest.format = 'mortal-teaching-v12-regression-v1';
    manifest.priorV8ManifestHash = referenceHash;
    return prepared;
  }
  if (mode === 'prepare') {
    const { jobs, ...summary } = await offline(s, out, Number(number), { makePlan, checkFacts });
    return summary;
  }
  if (mode === '--dispatch') return runLive(s, out, Number(number), makePlan);
  const ready = verifyReady(s, out, makePlan);
  return { points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap, spentCny: ready.ledger.estimatedCost };
}

main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e); process.exitCode = 1; });
