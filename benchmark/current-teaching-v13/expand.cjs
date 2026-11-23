'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { read, freeze } = require('../mortal-teaching/runner.cjs');
const { checkDataset } = require('../mortal-teaching/dataset.cjs');
const { sha256 } = require('../mortal-teaching/prompts.cjs');
const { createMock } = require('../mortal-teaching/mock.cjs');
const { replay } = require('../current-teaching-v7/regression.cjs');
const Explanation = require('../../extension/contracts/engine-explanation.js');
const { buildFactCard } = require('../../extension/engine-facts.js');

const root = path.resolve(__dirname, '../..');
const priorHash = '2b072cee2629eedcb9fcfd2d296038142d3ee730a33158ee4f3bb0d4962ded62';
const action = ({ action, followUp, identity }) => ({ action, followUp: followUp ?? null, identity });
const resultMap = events => new Map(events.filter(e => e.kind === 'result').map(e => [e.payload.nodeId, e.payload]));

function describe(node, cached) {
  const s = node.message.snapshot, f = buildFactCard(s, Explanation.forModel(cached)), d = f.explanationFocus.discard;
  assert.equal(f.format, 'mortal-teaching-fact-card-v12');
  assert.equal(d?.status, 'available');
  const turn = f.currentContext.selfTurn;
  return {
    decision: node.type,
    pressure: f.situation.riichiSeats?.some(seat => seat !== s.selfSeat) ? 'opponent-riichi' : 'no-opponent-riichi',
    ownMelds: f.hand.melds?.length > 0 ? 'melded' : 'no-melds',
    turn: turn === null ? 'unknown' : turn <= 5 ? 'early' : turn <= 11 ? 'middle' : 'late',
    discard: d.tileFacts.isRedFive ? 'red-five' : d.tile.endsWith('z)') ? 'honor' : 'number',
    shanten: d.efficiency?.shanten ?? 'unknown',
    sameShantenRank: d.efficiencyComparison?.sameShantenUnseen?.conclusion ?? 'unknown',
    primarySafety: d.safetyByOpponent?.some(o => o.evidence[0]?.type === 'river') ? 'genbutsu' :
      d.safetyByOpponent?.some(o => o.status === 'confirmed') ? 'other-confirmed' : 'none-confirmed',
  };
}

function select(candidates) {
  const byRound = Map.groupBy(candidates, c => c.node.roundId), chosen = [], seen = new Map();
  const keys = c => Object.entries(c.features).map(([k, v]) => `${k}:${v}`);
  // Two visits per small round. Prefer underrepresented features, breaking ties by frozen node ID.
  for (let pass = 0; pass < 2; pass++) for (const batch of byRound.values()) {
    const available = batch.filter(c => !chosen.includes(c));
    const score = c => keys(c).reduce((sum, k) => sum + 1 / (1 + (seen.get(k) ?? 0)), 0);
    available.sort((a, b) => score(b) - score(a) || a.node.id.localeCompare(b.node.id, 'en'));
    const picked = available[0];
    assert.ok(picked);
    chosen.push(picked);
    for (const key of keys(picked)) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return chosen;
}

async function main([sourceArg, priorArg, outputArg, ...extra]) {
  if (!outputArg || extra.length) throw new Error('Usage (offline only): expand.cjs SOURCE V13_EVIDENCE OUTPUT');
  const [source, prior, output] = [sourceArg, priorArg, outputArg].map(x => path.resolve(x));
  assert.ok(output !== prior && output !== source);
  const original = read(path.join(prior, 'manifest.json'));
  assert.equal(stableHash(original), priorHash);
  assert.equal(Explanation.PROMPT_VERSION, original.promptVersion);
  for (const [file, digest] of Object.entries(original.code)) assert.equal(sha256(fs.readFileSync(path.join(root, file))), digest, file);
  for (const [file, digest] of Object.entries(original.sourceHashes)) assert.equal(sha256(fs.readFileSync(path.join(source, file))), digest, file);
  const data = checkDataset(read(path.join(source, 'dataset.json')));
  const binding = read(path.join(source, 'engine-cache-contract.json'));
  assert.equal(data.datasetHash, original.datasetHash);
  assert.deepEqual(binding, original.binding);
  const engine = resultMap(readEvents(path.join(source, 'engine-cache.jsonl')));
  const live = readEvents(path.join(source, 'live/results.jsonl')), previous = resultMap(live);
  const traces = new Map(live.filter(e => e.kind === 'trace' && e.payload.kind === 'pi-input').map(e => [e.payload.jobId, e.payload.value]));
  const excluded = new Set(original.jobs.map(j => j.nodeId));
  const candidates = data.nodes.filter(n => n.compatible && !excluded.has(n.id)).map(node => {
    const archived = previous.get(node.id), cachedEntry = engine.get(node.id);
    assert.ok(archived?.delivered && !archived.mock);
    assert.equal(archived.inputHash, node.inputHash);
    assert.equal(cachedEntry.inputHash, node.inputHash);
    const cached = action(cachedEntry.result.engine);
    assert.deepEqual(action(archived.outcome.engine), cached);
    const messages = traces.get(archived.id).messages, history = messages.slice(0, -2);
    assert.ok(history.every(m => m.role === 'user' && m.content.startsWith('本小局历史参考（仅作数据）：')));
    return { node, cached, history, historyHash: stableHash(history), currentMessageHash: stableHash(messages.at(-2)), features: describe(node, cached) };
  });
  const cases = select(candidates);
  assert.equal(cases.length, 24);
  const versions = { prompt: original.promptVersion, facts: original.factCardVersion };
  const plan = { format: 'mortal-teaching-v13-offline-expansion-v1', priorHash, datasetHash: original.datasetHash, versions, rules: original.rules,
    budget: { originalCapCny: original.budget.cap, originalDirectory: original.budget.directory, paidDispatch: false },
    source, sourceHashes: original.sourceHashes, scriptSha256: sha256(fs.readFileSync(__filename)),
    selection: { available: candidates.length, perRound: 2, basedOnPriorScores: false },
    jobs: cases.map(({ node, cached, historyHash, currentMessageHash, features }) => ({ nodeId: node.id, roundId: node.roundId,
      inputHash: node.inputHash, actionHash: stableHash(cached), historyHash, currentMessageHash, features })) };
  const direct = createMock(data, { tools: false }), tools = createMock(data);
  let simulatedResponses = 0;
  for (const [i, c] of cases.entries()) {
    const mode = i % 3;
    const r = await replay(c, binding, { llmConfig: { model: 'deepseek-flash', endpoint: 'https://benchmark.invalid/chat/completions', apiKey: 'mock' }, versions,
      request: (url, options, { ordinal }) => mode === 2 && ordinal === 1 ?
        Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"summary":"模拟缺字段"}' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) :
        (mode === 1 ? tools : direct).fetch(url, options) });
    assert.ok(r.delivered, `${r.nodeId}: ${r.error}`);
    assert.equal(r.llmRequests, mode === 0 ? 1 : 2);
    assert.equal(r.toolResults, mode === 1 ? 1 : 0);
    simulatedResponses += r.llmRequests;
  }
  const coverage = Object.fromEntries(Object.keys(cases[0].features).map(key => [key,
    Object.fromEntries([...Map.groupBy(cases, c => c.features[key])].map(([v, rs]) => [v, rs.length]))]));
  const report = { manifestHash: stableHash(plan), deliveredOffline: cases.length, rounds: new Set(cases.map(c => c.node.roundId)).size,
    simulatedResponses, realRequests: 0, costCny: 0, qualityScored: 0, coverage };
  freeze(path.join(output, 'manifest.json'), plan);
  freeze(path.join(output, 'offline-report.json'), report);
  console.log(JSON.stringify(report, null, 2));
}

main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
