'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { plan, offline, replay } = require('../current-teaching-v7/regression.cjs');
const { runLive, verifyReady } = require('../current-teaching-v7/live.cjs');

const defaultVersions = { prompt: 17, facts: 13 };
const baselineHash = '32e495a07afc84697398e893ff9b4cb932d037cf697388a97a6721c957bc12e4';
const targetedHash = '13dae5cb547235b8dce39f62b1e360db9609a8240df1d511969a4a55fb452e6e';
const major = 'd-2a54d453702769e3bee42a22';
const ranking = 'd-06fc9e61eec0210e70e0ebbe';
const questions = new Map([
  [major, '打7筒对下家安全吗？有哪些能确认的依据？'],
  [ranking, '打东对已经立直的对家安全吗？依据是什么？'],
]);
const index = (events, kind, key) => new Map(events.filter(e => e.kind === kind).map(e => [e.payload[key], e.payload]));
const action = ({ action, followUp, identity }) => ({ action, followUp: followUp ?? null, identity });

async function main([mode, evidenceArg, outputArg, ...extra], versions = defaultVersions, expansion = null) {
  assert.ok(outputArg && !extra.length && ['prepare', 'verify', '--dispatch'].includes(mode),
    'Usage: regression.cjs prepare|verify|--dispatch EVIDENCE_ROOT OUTPUT');
  const evidence = path.resolve(evidenceArg), output = path.resolve(outputArg);
  const source = path.join(evidence, 'current-teaching-v6-live-20261117');
  const baseline = path.join(evidence, 'current-teaching-v16-ready-20261123');
  const targeted = path.join(evidence, 'current-teaching-v15-ready-20261122');
  assert.ok(![source, baseline, targeted].includes(output));
  const prior = read(path.join(baseline, 'manifest.json'));
  const selected = read(path.join(targeted, 'manifest.json'));
  assert.equal(stableHash(prior), baselineHash);
  assert.equal(stableHash(selected), targetedHash);
  const archived = new Map(prior.jobs.map(j => [j.nodeId, j]));
  const followUps = new Map([...questions, ...(expansion?.questions ?? [])]);
  const baseJobs = expansion ? [...selected.jobs, ...prior.jobs.filter(j => !selected.jobs.some(s => s.nodeId === j.nodeId))] : selected.jobs;
  const count = baseJobs.length + followUps.size;
  const priorRound = expansion && read(path.join(evidence, expansion.priorRound.directory, 'manifest.json'));
  if (priorRound) assert.equal(stableHash(priorRound), expansion.priorRound.hash);

  function makePlan(s, out, cap) {
    assert.equal(cap, 10);
    const extraControls = Object.fromEntries(prior.jobs.filter(j => j.protection).map(j => [j.nodeId, j.protection]));
    const extraCode = ['benchmark/current-teaching-v17/regression.cjs', ...(expansion?.extraCode ?? [])];
    if (versions.prompt !== defaultVersions.prompt) extraCode.push(`benchmark/current-teaching-v${versions.prompt}/regression.cjs`);
    const prepared = plan(s, out, cap, { versions, selection: { extraControls }, extraCode });
    for (const key of ['datasetHash', 'sourceHashes', 'binding', 'rules']) assert.deepEqual(prepared.manifest[key], prior[key]);
    const log = readEvents(path.join(s, 'live/results.jsonl'));
    const previous = index(log, 'result', 'nodeId'), engines = index(readEvents(path.join(s, 'engine-cache.jsonl')), 'result', 'nodeId');
    const traces = new Map(log.filter(e => e.kind === 'trace' && e.payload.kind === 'pi-input').map(e => [e.payload.jobId, e.payload.value]));
    const nodes = new Map(prepared.data.nodes.map(n => [n.id, n]));
    const originalCases = new Map(prepared.cases.map(c => [c.node.id, c]));
    const cases = baseJobs.map(j => {
      const id = j.nodeId, frozen = archived.get(id), node = nodes.get(id), before = previous.get(id), engine = engines.get(id);
      assert.ok(node?.compatible && before?.delivered && !before.mock);
      assert.equal(node.inputHash, before.inputHash);
      assert.equal(node.inputHash, engine.inputHash);
      const cached = action(engine.result.engine), messages = traces.get(before.id).messages;
      assert.deepEqual(cached, action(before.outcome.engine));
      const history = messages.slice(0, -2), historyHash = stableHash(history), current = messages.at(-2);
      assert.deepEqual([node.inputHash, stableHash(cached), historyHash, stableHash(current)],
        [frozen.inputHash, frozen.actionHash, frozen.historyHash, frozen.currentMessageHash], id);
      const c = originalCases.get(id) ?? { node, cached, history, historyHash, currentMessageHash: stableHash(current), protection: 'v17 control', targets: [] };
      return { ...c, current, baseId: id };
    });
    for (const [baseId, question] of followUps) {
      const c = cases.find(x => x.baseId === baseId);
      const message = { ...c.node.message, question }, node = { ...c.node, id: `${baseId}-safety-question`, message, inputHash: stableHash(message) };
      const separator = c.current.content.indexOf('\n') + 1;
      assert.ok(separator > 0);
      const original = JSON.parse(c.current.content.slice(separator));
      assert.equal(original.question, '');
      const current = { ...c.current, content: c.current.content.slice(0, separator) + JSON.stringify({ ...original, question }) };
      cases.push({ ...c, node, currentMessageHash: stableHash(current), targets: [], protection: 'explicit safety question' });
    }
    assert.equal(new Set(cases.map(c => c.node.id)).size, count);
    prepared.cases = cases;
    Object.assign(prepared.manifest, { format: `mortal-teaching-v${versions.prompt}-regression-v1`, baselineHash, targetedHash,
      jobs: cases.map(c => ({ ...archived.get(c.baseId), nodeId: c.node.id, baseId: c.baseId, inputHash: c.node.inputHash,
        currentMessageHash: c.currentMessageHash, question: c.node.message.question ?? '' })) });
    if (priorRound) {
      const jobs = new Map(prepared.manifest.jobs.map(j => [j.nodeId, j]));
      assert.deepEqual(priorRound.jobs.map(j => jobs.get(j.nodeId)), priorRound.jobs);
      prepared.manifest.priorRoundHash = expansion.priorRound.hash;
    }
    return prepared;
  }

  if (mode === '--dispatch') return runLive(source, output, count, makePlan);
  if (mode === 'prepare') {
    const p = makePlan(source, output, 10), wrong = index(readEvents(path.join(baseline, 'live/results.jsonl')), 'result', 'nodeId').get(major);
    const corrected = await replay(p.cases.find(c => c.node.id === major), p.binding, { versions,
      llmConfig: { model: 'deepseek-flash', endpoint: 'https://benchmark.invalid/chat/completions', apiKey: 'mock' },
      request: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: wrong.reviewSource.answer } }] }) });
    assert.ok(corrected.delivered, corrected.error);
    const answer = JSON.parse(corrected.reviewSource.answer);
    assert.equal(answer.summary, '引擎选择手切7筒，弃牌后维持2向听。');
    assert.ok(answer.reasons.some(r => r.includes('9索、西、中三组对子形')));
    assert.doesNotMatch(JSON.stringify(answer), /安全|防守|现物/);
    const { jobs, ...summary } = await offline(source, output, 10, { makePlan, checkFacts: expansion?.checkFacts });
    return { ...summary, archivedMajorReplayed: true };
  }
  const ready = verifyReady(source, output, makePlan);
  return { points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap, committedCny: ready.ledger.budgetCommitted };
}

function run(argv, versions, expansion) {
  return main(argv, versions, expansion).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

if (require.main === module) run(process.argv.slice(2));
module.exports = { run };
