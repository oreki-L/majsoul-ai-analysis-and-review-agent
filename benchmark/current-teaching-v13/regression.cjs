'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');

const baselineHash = 'c2024e7124cc447c98edd3f410a8731f53236fb1b332c0884bbd54bccde46504';
const safetyTarget = 'd-06fc9e61eec0210e70e0ebbe';
const motiveTargets = new Set(['d-3858152e34de47e288fc7700', 'd-69198271b18addf8f2ed9fa6', 'expanded-east1-h0-p96',
  'expanded-east3-h0-p70', 'd-561794c3743ac32356113699', 'd-4f6f2ff9dd2ed9e7b6b84eac']);

function checkFacts(id, facts) {
  const d = facts.explanationFocus.discard;
  if (id === safetyTarget) {
    assert.equal(d.tile, '东(1z)');
    assert.deepEqual(d.tileFacts.visibility, { status: 'complete', seen: 4, unseenUpperBound: 0 });
    assert.match(d.kokushiSafetyNote, /不能单独排除/);
    assert.deepEqual(Object.fromEntries(d.safetyByOpponent.map(o => [o.relativeName, o.wording])), {
      上家: ['上家本人牌河第2张弃过东，东对上家是现物'],
      下家: ['下家本人牌河第2张弃过东，东对下家是现物'],
      对家: ['对家本人牌河第5张弃过东，东对对家是现物'],
    });
    for (const o of d.safetyByOpponent) assert.deepEqual(o.evidence.map(e => e.type), ['river']);
    for (const o of facts.risk.candidates.find(c => c.tile === '1z').opponents) {
      assert.equal(o.safety.evidence.find(e => e.type === 'visible-exclusion').kokushi.excludedByFullyVisible, '6z');
    }
  } else if (id === 'd-567ab9a74182f2e9ca32138b') {
    assert.match(d.removedKindWording, /弃后暗手已无5万/);
    assert.deepEqual(d.tenpai.fixedYakuhaiSources, ['明刻「中」提供役牌（三元牌），与补牌或雀头无关']);
  } else if (id === 'd-3c136cc97af63af46851a5ba') {
    assert.deepEqual(d.safetyByOpponent.find(o => o.relativeName === '下家').wording, ['下家本人牌河第5、9张弃过9筒，9筒对下家是现物']);
    assert.deepEqual(d.safetyByOpponent.find(o => o.relativeName === '对家').wording, []);
  } else if (id === 'd-7dd402bad11e14bbc8bf193f') {
    assert.equal(facts.actionTransition.shantenWording, '弃牌后维持0向听（形状听牌）');
  } else if (id === 'expanded-east1-h0-p96') {
    assert.deepEqual(d.localLinks.before.map(p => p.waits.map(w => [w.tile.code, w.unseenUpperBound])), [
      [['5s', 4], ['8s', 0]], [['6s', 2], ['9s', 0]],
    ]);
  }
}

async function main([mode, source, baseline, output, number, ...extra]) {
  if (!output || extra.length || !['prepare', 'verify', '--dispatch'].includes(mode) || ['prepare', '--dispatch'].includes(mode) !== (number !== undefined)) {
    throw new Error('Usage: regression.cjs prepare|verify|--dispatch SOURCE V12_EVIDENCE OUTPUT [CAP_CNY for prepare | MAX_POINTS for --dispatch]');
  }
  const [s, base, out] = [source, baseline, output].map(v => path.resolve(v));
  const archived = read(path.join(base, 'manifest.json'));
  assert.equal(stableHash(archived), baselineHash);
  const old = new Map(archived.jobs.map(j => [j.nodeId, j]));
  assert.ok(old.has(safetyTarget) && [...motiveTargets].every(id => old.has(id)));
  const priority = [...new Set([safetyTarget, ...motiveTargets, ...old.keys()])];
  const extraControls = Object.fromEntries(archived.jobs.filter(j => j.protection).map(j => [j.nodeId, j.protection]));
  function makePlan(source, output, cap) {
    const prepared = plan(source, output, cap, { versions: { prompt: 13, facts: 12 }, selection: { priority, extraControls },
      extraCode: ['benchmark/current-teaching-v13/regression.cjs'] });
    const { manifest } = prepared;
    assert.equal(manifest.datasetHash, archived.datasetHash);
    assert.deepEqual(manifest.rules, archived.rules);
    assert.deepEqual(manifest.jobs.map(j => j.nodeId), priority);
    for (const j of manifest.jobs) {
      for (const k of ['inputHash', 'actionHash', 'historyHash', 'currentMessageHash']) assert.equal(j[k], old.get(j.nodeId)[k]);
      j.target = j.nodeId === safetyTarget;
      j.motiveTarget = motiveTargets.has(j.nodeId);
    }
    manifest.format = 'mortal-teaching-v13-regression-v1';
    manifest.priorV12ManifestHash = baselineHash;
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
