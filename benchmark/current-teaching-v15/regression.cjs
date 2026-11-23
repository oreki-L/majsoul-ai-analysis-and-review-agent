'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { read, freeze } = require('../mortal-teaching/runner.cjs');
const { plan, offline, replay } = require('../current-teaching-v7/regression.cjs');
const { verifyReady, runLive } = require('../current-teaching-v7/live.cjs');
const { repairPrompt } = require('../../extension/contracts/engine-explanation.js');

const priorHash = 'afcec34f556715cd42c745f8806f6a5395057f9612ac34fef8dc04e8276f382f';
const rankingTarget = 'd-06fc9e61eec0210e70e0ebbe';
const versions = { prompt: 15, facts: 13 };
const action = ({ action, followUp, identity }) => ({ action, followUp: followUp ?? null, identity });
const index = (events, kind, key) => new Map(events.filter(e => e.kind === kind).map(e => [e.payload[key], e.payload]));

function checkFacts(id, facts) {
  if (id !== rankingTarget) return;
  const discard = facts.explanationFocus.discard;
  assert.equal(discard.efficiencyComparison.sameShantenUnseen.wording, '切东后为2向听，未见进张上界41枚；在2向听档唯一最高');
  assert.ok(facts.candidateEfficiency.rows.some(([, shanten, upper]) => shanten === 3 && upper === 41));
  assert.match(discard.kokushiSafetyNote, /不能单独排除/);
  assert.equal(discard.safetyByOpponent.length, 3);
  for (const o of discard.safetyByOpponent) assert.deepEqual(o.evidence.map(e => e.type), ['river']);
}

async function main([mode, evidenceArg, outputArg, maxPoints, ...extra]) {
  if (!outputArg || extra.length || !['prepare', 'verify', '--dispatch'].includes(mode) ||
      (mode === '--dispatch') !== (maxPoints !== undefined)) {
    throw new Error('Usage: regression.cjs prepare|verify|--dispatch EVIDENCE_ROOT OUTPUT [MAX_POINTS for --dispatch]');
  }
  const evidence = path.resolve(evidenceArg), output = path.resolve(outputArg);
  const source = path.join(evidence, 'current-teaching-v6-live-20261117');
  const prior = path.join(evidence, 'current-teaching-v14-ready-20261122');
  assert.ok(![source, prior].includes(output));
  const archived = read(path.join(prior, 'manifest.json'));
  assert.equal(stableHash(archived), priorHash);
  const jobs = new Map(archived.jobs.map(j => [j.nodeId, j]));
  const historical = index(readEvents(path.join(prior, 'live/results.jsonl')), 'result', 'nodeId');
  assert.deepEqual([...historical.keys()], [...jobs.keys()]);
  const attemptEvents = readEvents(path.join(prior, 'budget/attempts.jsonl'));
  const byJob = new Map(attemptEvents.filter(e => e.kind === 'dispatch').map(({ payload: a }) => [a.identity.jobId, a]));
  const responses = index(attemptEvents, 'response', 'attemptId');
  const failed = new Map([...historical.values()].filter(r => !r.delivered).map(r => {
    assert.equal(r.llmRequests, 1);
    const response = responses.get(byJob.get(r.id).attemptId);
    assert.equal(response.status, 200);
    const parsed = JSON.parse(response.body.choices[0].message.content);
    assert.deepEqual(Object.keys(parsed).sort(), ['limitations', 'reasons', 'reasons_note', 'summary']);
    assert.equal(parsed.reasons_note, null);
    return [r.nodeId, response.body];
  }));
  assert.equal(failed.size, 7);
  const selected = [...new Set([...failed.keys(), ...archived.jobs.filter(j => j.priority).map(j => j.nodeId)])];
  assert.equal(selected.length, 15);

  function makePlan(s, out, cap) {
    assert.equal(cap, 10);
    const extraControls = Object.fromEntries(archived.jobs.filter(j => j.protection).map(j => [j.nodeId, j.protection]));
    const p = plan(s, out, cap, { versions, selection: { extraControls }, extraCode: ['benchmark/current-teaching-v15/regression.cjs'] });
    assert.deepEqual(p.manifest.sourceHashes, archived.sourceHashes);
    assert.deepEqual(p.manifest.rules, archived.rules);
    assert.equal(p.manifest.datasetHash, archived.datasetHash);
    const log = readEvents(path.join(s, 'live/results.jsonl'));
    const previous = index(log, 'result', 'nodeId'), cache = index(readEvents(path.join(s, 'engine-cache.jsonl')), 'result', 'nodeId');
    const traces = new Map(log.filter(e => e.kind === 'trace' && e.payload.kind === 'pi-input').map(e => [e.payload.jobId, e.payload.value]));
    const nodes = new Map(p.data.nodes.map(n => [n.id, n]));
    const planned = new Map(p.cases.map(c => [c.node.id, c]));
    p.cases = selected.map(id => {
      const j = jobs.get(id), node = nodes.get(id), before = previous.get(id), engine = cache.get(id);
      assert.ok(node?.compatible && before?.delivered && !before.mock);
      assert.equal(node.inputHash, engine.inputHash);
      assert.equal(node.inputHash, before.inputHash);
      const cached = action(engine.result.engine), messages = traces.get(before.id).messages;
      assert.deepEqual(action(before.outcome.engine), cached);
      const history = messages.slice(0, -2), historyHash = stableHash(history), currentMessageHash = stableHash(messages.at(-2));
      assert.deepEqual([node.inputHash, stableHash(cached), historyHash, currentMessageHash],
        [j.inputHash, j.actionHash, j.historyHash, j.currentMessageHash], id);
      return planned.get(id) ?? { node, cached, history, historyHash, currentMessageHash, targets: [], protection: 'v14 control' };
    });
    Object.assign(p.manifest, { format: 'mortal-teaching-v15-regression-v1', priorHash,
      jobs: selected.map(id => ({ ...jobs.get(id), failureResponseHash: failed.has(id) ? stableHash(failed.get(id)) : null })) });
    return p;
  }

  if (mode === '--dispatch') return runLive(source, output, Number(maxPoints), makePlan);
  if (mode === 'prepare') {
    const p = makePlan(source, output, 10), repairs = [];
    for (const entry of p.cases.filter(c => failed.has(c.node.id))) {
      const body = failed.get(entry.node.id);
      const { summary, reasons, limitations } = JSON.parse(body.choices[0].message.content);
      const expected = { limitations, summary, reasons };
      const result = await replay(entry, p.binding, { versions,
        llmConfig: { model: 'deepseek-flash', endpoint: 'https://benchmark.invalid/chat/completions', apiKey: 'mock' },
        request: async (_url, options, { role, ordinal }) => {
          if (ordinal === 1) return Response.json(body);
          assert.equal(ordinal, 2);
          assert.equal(role, 'format-repair');
          const request = JSON.parse(options.body);
          assert.equal(request.messages.at(-1).content, repairPrompt);
          assert.ok(!request.tools?.length);
          const { choices, ...metadata } = body;
          const [choice] = choices;
          return Response.json({ ...metadata, choices: [{ ...choice, message: { ...choice.message, content: JSON.stringify(expected) } }] });
        } });
      assert.ok(result.delivered, `${result.nodeId}: ${result.error}`);
      assert.equal(result.llmRequests, 2);
      assert.equal(result.engineRequests, 1);
      assert.equal(result.toolResults, 0);
      assert.deepEqual(JSON.parse(result.reviewSource.answer), expected);
      repairs.push({ nodeId: result.nodeId, deliveredWithSimulatedRepair: true, requests: 2 });
    }
    const { jobs: _jobs, ...report } = await offline(source, output, 10, { makePlan, checkFacts });
    const exact = { manifestHash: report.manifestHash, realApiRequests: 0, repairs };
    freeze(path.join(output, 'archived-repair-report.json'), exact);
    return { ...report, archivedRepairs: repairs.length };
  }
  const ready = verifyReady(source, output, makePlan);
  return { points: ready.cases.length, manifestHash: ready.hash, capCny: ready.ledger.cap, committedCny: ready.ledger.budgetCommitted };
}

main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
