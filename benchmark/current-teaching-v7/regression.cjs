'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { read, freeze, factsFor, delivery } = require('../mortal-teaching/runner.cjs');
const { checkDataset } = require('../mortal-teaching/dataset.cjs');
const { sha256 } = require('../mortal-teaching/prompts.cjs');
const { createQueue, RULES } = require('../mortal-teaching/review.cjs');
const { createMock } = require('../mortal-teaching/mock.cjs');
const { FILES } = require('../mortal-teaching/harness.cjs');
const { neutralHistory } = require('../current-teaching-v6/eval.cjs');
const { createProductHarness } = require('./harness.cjs');
const RoundBudget = require('./round-budget.cjs');
const Explanation = require('../../extension/contracts/engine-explanation.js');

const root = path.resolve(__dirname, '../..');
const code = [...FILES.map(file => 'extension/' + file), 'extension/decision-discussions.js', 'extension/round-context.js',
  ...['core.cjs', 'durable.cjs', 'accounting.cjs', 'mortal-teaching/budget.cjs', 'mortal-teaching/dataset.cjs', 'mortal-teaching/harness.cjs', 'mortal-teaching/review.cjs',
    'mortal-teaching/mock.cjs', 'mortal-teaching/runner.cjs', 'current-teaching-v6/eval.cjs',
    'current-teaching-v7/harness.cjs', 'current-teaching-v7/regression.cjs', 'current-teaching-v7/live.cjs',
    'current-teaching-v7/round-budget.cjs'].map(file => 'benchmark/' + file)];
const sources = ['dataset.json', 'engine-cache-contract.json', 'engine-cache.jsonl', 'live/results.jsonl',
  'ERROR_MAPPING.json', 'PAIRED_RESULTS.json', 'COMPLETION_RECEIPT.json', 'contract.json', 'pricing.json'];
const hashes = (dir, files) => Object.fromEntries(files.map(file => [file, sha256(fs.readFileSync(path.join(dir, file)))]));
const controls = {
  'expanded-east1-h0-p2': 'first turn, closed hand and winds',
  'expanded-east1-h0-p96': 'late closed discard',
  'd-01a907af85a64ea32feba79c': 'red five in an early closed hand',
  'd-3c17fa5e6fdfeaecc97e8cfc': 'discard directly after a call',
  'd-e3d298fc48f1f9f7747d2f00': 'riichi threat, red five and multiple melds',
  'expanded-south2-h2-p136': 'South 2, two honba, late riichi defense'
};
const action = engine => ({ action: engine.action, followUp: engine.followUp ?? null, identity: engine.identity });
const json = value => JSON.parse(JSON.stringify(value));
const resultMap = (events, key) => new Map(events.filter(e => e.kind === 'result').map(e => [e.payload[key], e.payload]));

function prepare(source, { extraControls = {}, priority = [] } = {}) {
  const at = name => path.join(source, name), sourceHashes = hashes(source, sources), receipt = read(at('COMPLETION_RECEIPT.json'));
  assert.ok(receipt.complete && receipt.promptVersion === 6 && receipt.scored === 127);
  for (const file of ['contract.json', 'ERROR_MAPPING.json', 'PAIRED_RESULTS.json']) assert.equal(sourceHashes[file], receipt.sourceHashes[file]);
  const old = read(at('contract.json')), data = checkDataset(read(at('dataset.json'))), binding = read(at('engine-cache-contract.json'));
  assert.equal(data.datasetHash, binding.datasetHash);
  assert.equal(data.datasetHash, old.datasetHash);
  for (const file of ['dataset.json', 'engine-cache-contract.json', 'engine-cache.jsonl', 'pricing.json']) assert.equal(sourceHashes[file], old.files[file]);
  const errors = read(at('ERROR_MAPPING.json')), byError = Map.groupBy(errors, e => e.nodeId);
  assert.equal(byError.size, 25);
  const paired = new Map(read(at('PAIRED_RESULTS.json')).map(r => [r.nodeId, r]));
  const live = readEvents(at('live/results.jsonl')), baseline = resultMap(live, 'nodeId');
  const trace = new Map(live.filter(e => e.kind === 'trace' && e.payload.kind === 'pi-input').map(e => [e.payload.jobId, e.payload.value]));
  const engines = resultMap(readEvents(at('engine-cache.jsonl')), 'nodeId');
  const protection = { ...controls, ...extraControls };
  const selected = new Set([...byError.keys(), ...Object.keys(protection)]), cases = [];
  for (const node of data.nodes.filter(n => selected.has(n.id))) {
    const previous = baseline.get(node.id), cached = engines.get(node.id), pair = paired.get(node.id);
    assert.ok(node.compatible && previous?.delivered && !previous.mock && pair);
    assert.equal(previous.inputHash, node.inputHash);
    assert.equal(cached.inputHash, node.inputHash);
    assert.deepEqual(action(previous.outcome.engine), action(cached.result.engine));
    if (Object.hasOwn(protection, node.id)) assert.ok(pair.currentPass && pair.currentScore >= 3.75 && !byError.has(node.id));
    const messages = trace.get(previous.id).messages, history = messages.slice(0, -2);
    assert.ok(history.every(m => m.role === 'user' && m.content.startsWith('本小局历史参考（仅作数据）：')));
    const targets = byError.get(node.id) || [];
    assert.ok(targets.every(e => e.resultId === previous.id && previous.reviewSource.answer.includes(e.citationRecord.quote)));
    cases.push({ node, cached: action(cached.result.engine), history, historyHash: stableHash(history),
      currentMessageHash: stableHash(messages.at(-2)), targets, protection: protection[node.id] ?? null,
      previous: { id: previous.id, answer: previous.reviewSource.answer, score: pair.currentScore, passed: pair.currentPass } });
  }
  assert.equal(cases.length, selected.size);
  // First cover unique tenpai, then multiple tenpai and cross-shanten; use one queue for all points.
  const first = [...new Set([...priority, 'd-6fbe6cd21c4bbc1d4066fb24', 'd-4b779daf10bf82c830c9632f', 'd-557bec11ad170dca8aa2f122', 'd-3c17fa5e6fdfeaecc97e8cfc'])];
  assert.ok(first.every(id => selected.has(id)));
  return { data, binding, sourceHashes, cases: [...first.map(id => cases.find(c => c.node.id === id)), ...cases.filter(c => !first.includes(c.node.id))] };
}

async function replay(entry, binding, { llmConfig, request, sourceCheck, versions }) {
  const { node, historyHash, cached } = entry;
  assert.equal(stableHash(node.message), node.inputHash);
  let engineRequests = 0, llmRequests = 0;
  const h = createProductHarness({ engineConfig: { model: binding.model, engineProfile: binding.profile, endpoint: binding.endpoint, apiKey: 'cached-engine' },
    llmConfig, versions, frozenHistory: entry.history, fetchModel: async (url, options) => {
      const body = JSON.parse(options.body);
      if (url === binding.endpoint) {
        assert.equal(++engineRequests, 1);
        assert.equal(stableHash(body), stableHash(node.message.engineRequest));
        return Response.json({ action: cached.action, ...(cached.followUp ? { followUp: cached.followUp } : {}), identity: cached.identity });
      }
      assert.equal(url, llmConfig.endpoint);
      const trace = h.traces.at(-1);
      assert.equal(stableHash(trace.messages.slice(0, -2)), historyHash, `Archived history differs at ${node.id}`);
      assert.equal(stableHash(trace.messages.at(-2)), entry.currentMessageHash, `Current snapshot message differs at ${node.id}`);
      sourceCheck?.(trace.facts);
      body.temperature = 0;
      const role = body.messages.some(m => m.role === 'user' && m.content === Explanation.repairPrompt) ? 'format-repair' : llmRequests ? 'tool-continuation' : 'initial';
      return request(url, { ...options, body: JSON.stringify(body) }, { role, ordinal: ++llmRequests });
    } });
  const started = performance.now(), outcome = await h.worker.analyze(structuredClone(node.message), 'benchmark'), elapsedMs = performance.now() - started;
  assert.deepEqual(json(action(outcome.engine)), cached, `Mortal action differs at ${node.id}`);
  assert.equal(engineRequests, 1);
  const delivered = delivery(outcome) && elapsedMs <= 25000;
  let reviewSource = null;
  if (delivered) {
    const facts = factsFor(node, outcome.engine, h, node.message.question ?? '');
    facts.authorizedHistory = neutralHistory(facts.contextMessages.slice(0, -2));
    delete facts.contextMessages;
    if (versions.prompt >= 19) {
      const { actionTransition, explanationFocus } = h.traces.at(-1).facts;
      facts.programFacts = { actionTransition, safetyByOpponent: explanationFocus.discard?.safetyByOpponent ?? [] };
    }
    // v17 composes the displayed explanation locally. Grade the same answer the player sees.
    const { summary, reasons, limitations } = outcome.explanation;
    const answer = versions.prompt >= 17 ? JSON.stringify({ summary, reasons, limitations }) : h.traces.at(-1).text;
    reviewSource = { answer, facts };
  }
  return { nodeId: node.id, delivered, elapsedMs, llmRequests, engineRequests, reviewSource,
    error: delivered ? null : outcome.explanation?.error ?? 'delivery deadline', toolResults: h.traces.at(-1)?.toolResults?.length ?? 0 };
}

function checkKnownFacts(id, f) {
  const discard = f.explanationFocus.discard, comparison = discard.efficiencyComparison;
  const row = code => f.candidateEfficiency.rows.find(([label]) => label.endsWith('(' + code + ')')).slice(1);
  switch (id) {
    case 'expanded-east1-h0-p34':
      assert.deepEqual([row('2z')[1], row('6z')[1], row('9s')[1]], [55, 54, 54]); break;
    case 'expanded-east1-h0-p86':
      assert.equal(discard.tileFacts.isSeatWind, false);
      assert.deepEqual(json(discard.tileFacts.visibility), { status: 'complete', seen: 4, unseenUpperBound: 0 }); break;
    case 'expanded-east1-h0-p104':
      assert.ok(discard.safetyByOpponent.find(o => o.relativeName === '下家').evidence.some(e => e.discardNumbers?.includes(1))); break;
    case 'expanded-east3-h0-p38':
      assert.ok(f.dora.indicators.some(x => x.indicator.code === '3z' && x.dora.code === '4z')); break;
    case 'expanded-east3-h0-p78':
      assert.deepEqual(row('9m'), [3, 63]); assert.deepEqual(row('2s'), [3, 59]);
      assert.ok(comparison.sameShantenUnseen.conclusion === '非最高' || comparison.sameShantenUnseen.betterCount > 0); break;
    case 'd-4b779daf10bf82c830c9632f':
      assert.ok(comparison.tenpaiCount >= 2 && comparison.soleTenpaiDiscard === null); break;
    case 'd-6fbe6cd21c4bbc1d4066fb24':
      assert.equal(comparison.tenpaiCount, 1); assert.equal(comparison.soleTenpaiDiscard.code, '6z'); break;
    case 'd-68d41451aa65cd8dfbe17482':
      assert.ok(discard.safetyByOpponent.find(o => o.relativeName === '上家').sujiReferences.some(t => t.code === '6p')); break;
    case 'd-c534f2c6d29b89569b94032e':
      assert.equal(f.explanationFocus.ownMeldBlocksTanyao, true); break;
  }
}

function plan(source, output, cap, { selection, versions = { prompt: 7, facts: 6 }, extraCode = [] } = {}) {
  const { binding, sourceHashes, cases, data } = prepare(source, selection);
  assert.equal(Explanation.PROMPT_VERSION, versions.prompt);
  const budget = RoundBudget.terms(output, cap, read(path.join(source, 'pricing.json')));
  const manifest = { format: 'mortal-targeted-regression-v2', promptVersion: versions.prompt, factCardVersion: versions.facts, budget,
    source, sourceHashes, datasetHash: data.datasetHash, binding, code: hashes(root, [...code, ...extraCode]), rules: RULES,
    jobs: cases.map(c => ({ nodeId: c.node.id, inputHash: c.node.inputHash, actionHash: stableHash(c.cached),
      historyHash: c.historyHash, currentMessageHash: c.currentMessageHash, baselineId: c.previous.id,
      baselineAnswerHash: stableHash(c.previous.answer), baselineScore: c.previous.score, baselinePass: c.previous.passed,
      errorCategories: c.targets.map(t => ({ category: t.category, severity: t.severity })), protection: c.protection })) };
  return { manifest, cases, data, binding };
}

async function offline(source, output, cap, { makePlan = plan, checkFacts } = {}) {
  const { manifest, cases, data, binding } = makePlan(source, output, cap);
  freeze(path.join(output, 'manifest.json'), manifest);
  const mock = createMock(data), direct = createMock(data, { tools: false });
  const queue = createQueue(path.join(output, 'offline-review'), stableHash(manifest));
  const jobs = [];
  for (const [i, entry] of cases.entries()) {
    const mode = ['repair', 'tool', 'direct'][i % 3];
    const result = await replay(entry, binding, { llmConfig: { model: 'deepseek-flash', endpoint: 'https://benchmark.invalid/chat/completions', apiKey: 'mock' },
      versions: { prompt: manifest.promptVersion, facts: manifest.factCardVersion },
      sourceCheck: facts => { checkKnownFacts(entry.node.id, facts); checkFacts?.(entry.node.id, facts); },
      request: async (url, options, { ordinal }) => mode === 'repair' && ordinal === 1 ?
        Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"summary":"模拟缺字段"}' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) :
        (mode === 'tool' ? mock : direct).fetch(url, options) });
    assert.ok(result.delivered, `${result.nodeId}: ${result.error}`);
    assert.equal(result.llmRequests, mode === 'direct' ? 1 : 2);
    assert.equal(result.toolResults, mode === 'tool' ? 1 : 0);
    const { reviewSource, elapsedMs, ...record } = result;
    queue.add({ resultId: result.nodeId, ...reviewSource });
    jobs.push({ ...record, mode });
  }
  queue.exportPackets();
  if (!fs.existsSync(path.join(manifest.budget.directory, 'budget.json')) && fs.existsSync(path.join(output, 'live', 'results.jsonl')))
    throw new Error('An existing round requires its original ledger');
  RoundBudget.initialize(RoundBudget.bindings(source, manifest));
  const report = { manifestHash: stableHash(manifest), passed: true, tested: jobs.length, delivered: jobs.filter(j => j.delivered).length,
    budgetCapCny: cap,
    historicalErrorNodes: cases.filter(c => c.targets.length > 0).length, protectionNodes: cases.filter(c => c.protection).length,
    preservedActions: jobs.length, identicalHistoricalInputs: jobs.length,
    offlineModelResponses: jobs.reduce((sum, j) => sum + j.llmRequests, 0), newMortalInferences: 0, realApiRequests: 0,
    newApiCostCny: 0, qualityScored: 0, jobs };
  freeze(path.join(output, 'offline-report.json'), report);
  return report;
}

if (require.main === module) {
  const [source, output, cap, ...extra] = process.argv.slice(2);
  if (!source || !output || !cap || extra.length) throw new Error('Usage (offline only): node regression.cjs SOURCE_EVIDENCE OUTPUT CAP_CNY');
  offline(path.resolve(source), path.resolve(output), Number(cap)).then(({ jobs, ...summary }) => console.log(JSON.stringify(summary, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { prepare, plan, replay, offline };
