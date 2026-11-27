'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const [extensionArg, evidenceArg, outputArg, mode = '--check'] = process.argv.slice(2);
assert(extensionArg && evidenceArg && outputArg, 'Expected release extension, evidence root and output directory');
assert(['--check', '--mock', '--live', '--status'].includes(mode));
const extension = path.resolve(extensionArg);
const evidence = path.resolve(evidenceArg);
const output = path.resolve(outputArg);
const release = name => require(path.join(extension, name));
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const datasetFile = path.join(evidence, 'realtime-quality-20261031/preparation/dataset.old29.frozen.json');
const productionFile = path.join(evidence, 'context-optimization-20261026/data-preparation/inputs/production-rounds.v1.json');
const crosscheckFile = path.join(evidence, 'realtime-quality-20261031/xf-release-facts-history-preparation-20261113/dataset.frozen.json');
const dataset = read(datasetFile);
const production = read(productionFile);
const crosscheck = read(crosscheckFile);
const manifest = release('manifest.json');
const Agent = release('agent.js');
const Analysis = release('analysis.js');
const Usage = release('model-usage.js');
const Xf = release('xf-context.js');
const Snapshot = release('contracts/snapshot.js');
const Round = release('round-context.js');
const Endpoint = release('adapters/model-endpoint.js');
const Transport = release('model-session-transport.js');
const runtimeScope = { TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, console, performance };
vm.runInNewContext(fs.readFileSync(path.join(extension, 'pi-runtime.js'), 'utf8'), runtimeScope);
const config = { endpoint: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: false, maxTokens: 4096 };
const outputOptions = { ...Endpoint.outputOptions(config), temperature: 0 };

async function executeNative(input, send) {
  const result = await Agent.run({
    snapshot: input.snapshot, sessionContext: input.sessionContext,
    contextPolicy: 'live-xf', task: 'combined', question: '', maxTurns: 2, timeoutMs: 25000,
    runtime: runtimeScope.MJPiRuntime,
    transport: async request => {
      const wire = Transport.body(request, config, outputOptions);
      if (!request.messages.some(message => message.role === 'toolResult')) {
        assert.equal(hash(wire), input.firstWireHash, 'Released first wire differs from frozen replay');
      }
      const raw = await send(wire, request.signal);
      const parsed = Transport.result(raw, request.tools.length > 0);
      const usage = Usage.normalizeUsage(raw);
      return { ...parsed, usage: { input: usage.uncachedInput ?? usage.input ?? 0,
        output: usage.output ?? 0, cacheRead: usage.cachedInput ?? 0, totalTokens: (usage.input ?? 0) + (usage.output ?? 0) } };
    }
  });
  return { text: result.sessionTurn.answer, turns: result.runtime.turns, toolCalls: result.runtime.toolCalls };
}

async function capture(input, expected, sample, useTool) {
  const wires = [];
  const result = await Agent.run({
    ...input, contextPolicy: 'live-xf', task: 'combined', question: '', maxTurns: 2, timeoutMs: 25000,
    runtime: runtimeScope.MJPiRuntime,
    transport: async request => {
      const wire = Transport.body(request, config, outputOptions);
      wires.push(wire);
      if (wires.length === 1) assert.deepEqual(JSON.parse(JSON.stringify(wire.messages)), expected);
      if (useTool && wires.length === 1) {
        return Transport.result({ choices: [{ finish_reason: 'tool_calls', message: {
          tool_calls: [{ id: 'offline-tool', type: 'function', function: { name: 'get_self_hand', arguments: '{}' } }]
        } }] }, true);
      }
      return Transport.result({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(sample) } }] });
    }
  });
  assert.equal(wires.length, useTool ? 2 : 1);
  if (useTool) {
    assert(wires[1].messages.some(message => message.role === 'tool'));
    assert(!wires[1].tools);
  }
  assert.deepEqual(result.result.limitations, sample.decision.limitations);
  assert(!Object.hasOwn(result.result.decision, 'limitations'));
  return wires;
}

async function check() {
  assert.equal(manifest.version, '0.16.17');
  assert.deepEqual(dataset.rounds.map(round => [round.id, round.decisions.length]), [['east3-h0', 11], ['south2-h2', 18]]);
  const rows = [];
  const inputs = [];
  for (const round of dataset.rounds) {
    const source = production.rounds.find(candidate => candidate.id === round.id);
    const otherRound = crosscheck.rounds.find(candidate => candidate.id === round.id);
    assert(source && otherRound);
    const identity = { matchId: dataset.sessionId, roundStartId: round.id, viewId: 'xf-old29-replay' };
    const store = Round.createStore({ instanceId: `xf-old29-${round.id}` });
    const observe = (snapshot, position) => store.observe({ snapshot, position, identity, historyComplete: true,
      events: source.events.filter(event => event.position <= position), provider: 'deepseek', model: config.model,
      task: 'combined', lane: 'live' });
    await observe(source.baseline.snapshot, source.baseline.position);
    for (const node of round.decisions) {
      const snapshot = Snapshot.cleanSnapshot(node.snapshot);
      const binding = source.nodeBindings.find(candidate => candidate.decisionId === node.id);
      const otherNode = otherRound.decisions.find(candidate => candidate.id === node.id);
      assert(binding && otherNode, node.id);
      assert.equal(node.position, otherNode.position, node.id);
      const snapshotHash = Xf.stableHash(snapshot);
      assert.equal(snapshotHash, binding.snapshotHash, node.id);
      assert.equal(snapshotHash, Xf.stableHash(Snapshot.cleanSnapshot(otherNode.snapshot)), node.id);
      const sessionContext = await store.getContext(await observe(snapshot, node.position));
      assert.equal(sessionContext.lane, 'live');
      assert.equal(sessionContext.baseline.position, source.baseline.position);
      assert.deepEqual(sessionContext.checkpoint.snapshot, snapshot);
      assert(sessionContext.capturedStates.every(state => state.position <= node.position));
      assert(sessionContext.events.every(event => event.position <= node.position));
      assert.equal(sessionContext.exchanges?.length ?? 0, 0);

      const agentSnapshot = { ...snapshot };
      delete agentSnapshot.availableActions;
      const prepared = Analysis.prepare(agentSnapshot, 'combined');
      assert(Xf.supports(agentSnapshot, prepared), node.id);
      const xf = Xf.forSession(prepared, agentSnapshot, sessionContext);
      const expected = [{ role: 'system', content: xf.systemPrompt }, ...xf.messages];
      const sample = { task: 'combined', danger: [], efficiency: [],
        decision: { action: 'unknown', tile: null, reasons: ['offline fixture'], limitations: ['offline fixture'] } };
      const input = { snapshot, sessionContext };
      const wires = await capture(input, expected, sample, true);
      rows.push({ decisionId: node.id, roundId: round.id, position: node.position, snapshotHash,
        contextHash: hash(sessionContext), firstWireHash: hash(wires[0]), toolWireHash: hash(wires[1]),
        eventCount: sessionContext.events.length, fieldRepairVerified: true });
      inputs.push({ decisionId: node.id, ...input, firstWireHash: hash(wires[0]) });
    }
  }
  assert.equal(new Set(rows.map(row => row.decisionId)).size, 29);
  fs.mkdirSync(output, { recursive: true });
  const frozenInputs = { config, inputs };
  fs.writeFileSync(path.join(output, 'INPUTS.private.json'), JSON.stringify(frozenInputs));
  const audit = { version: manifest.version, route: 'live-xf', mode: 'offline-only', points: rows.length,
    datasetHash: hash(dataset), productionHash: hash(production), crosscheckHash: hash(crosscheck),
    wireOptions: outputOptions, model: config.model, networkAttempts: 0, inputHash: hash(frozenInputs), rows };
  fs.writeFileSync(path.join(output, 'OFFLINE_AUDIT.json'), JSON.stringify(audit, null, 2) + '\n');
  console.log(JSON.stringify({ version: audit.version, route: audit.route, points: audit.points, networkAttempts: 0 }));
}

async function execution() {
  const common = path.join(evidence, 'realtime-quality-20261031');
  const old = path.join(common, 'xf-release-facts-history-preparation-20261113');
  const recovery = path.join(old, 'recovery-20261117');
  const budgetFile = path.join(common, 'preparation/budget.shared.json');
  const { journal, acquireLock } = require(path.join(recovery, 'lib/durable.cjs'));
  const { stableHash } = require(path.join(recovery, 'lib/core.cjs'));
  const Accounting = require(path.join(recovery, 'lib/accounting.cjs'));
  const { atomic } = require(path.join(recovery, 'io.cjs'));
  const { run, reservation, sharedCap } = require(path.join(common, 'xf-s-format-execution-20261120/run.cjs'));
  const recoveryPlan = read(path.join(recovery, 'PLAN.json'));
  const audit = read(path.join(output, 'OFFLINE_AUDIT.json'));
  const frozen = read(path.join(output, 'INPUTS.private.json'));
  assert.equal(hash(frozen), audit.inputHash);
  assert.deepEqual(audit.wireOptions, outputOptions);
  assert.equal(audit.points, 29);
  assert.deepEqual(frozen.inputs.map(input => [input.decisionId, input.firstWireHash]),
    audit.rows.map(row => [row.decisionId, row.firstWireHash]));
  const runId = `xf-v0.16.17-old29:${hash(audit)}`;
  const liveDir = path.join(output, 'live');
  const checkpoint = path.join(liveDir, 'checkpoint.json');
  const context = { runId, atomic, stableHash, executeNative, Accounting,
    order: audit.rows.map(row => ({ id: `XF:${row.decisionId}`, decisionId: row.decisionId })),
    inputs: new Map(frozen.inputs.map(input => [input.decisionId, input])) };
  function inspectBudget() {
    assert(!fs.existsSync(budgetFile + '.lock'), 'Shared ledger locked');
    const budget = read(budgetFile);
    assert.equal(stableHash(budget), stableHash(journal(budgetFile + '.events.jsonl').latestBudget()));
    assert(!fs.existsSync(budgetFile + '.lock'), 'Shared ledger locked');
    assert.equal(budget.cap, sharedCap);
    assert(!budget.blockedReason && !budget.unboundedBudgetExposure, 'Shared ledger blocks new requests');
    assert.equal(stableHash(budget.conservativeHolds), recoveryPlan.oldHoldHash);
    assert.equal(stableHash(budget.reservationEntries), recoveryPlan.preservedReservationHash);
    return budget;
  }
  const budget = inspectBudget();
  if (mode === '--status') {
    const state = fs.existsSync(checkpoint) ? read(checkpoint) : { results: {}, attempts: {}, status: 'ready' };
    const results = Object.values(state.results);
    const attempts = Object.values(state.attempts);
    const records = budget.records.filter(row => row.meta?.runId === runId);
    console.log(JSON.stringify({ runId, status: state.status, planned: 29, terminal: results.length,
      delivered: results.filter(result => result.status === 'success').length, attempts: attempts.length,
      settled: records.length, known: records.reduce((total, record) => total + (record.cost ?? 0), 0),
      reserved: budget.reserved, sharedRemaining: budget.cap - budget.budgetCommitted, reservation }));
    return;
  }
  const recoveryRunner = require(path.join(recovery, 'runner.cjs'));
  if (mode === '--mock') {
    const mockDir = fs.mkdtempSync(path.join(output, 'mock-'));
    require(path.join(recovery, 'reconciliation.cjs')).configure(recoveryPlan);
    const contracts = Accounting.deriveTrustedLiabilityContracts(read(path.join(old, 'execution/legacy-models.frozen.json')));
    const ledger = Accounting.createLedger({ cap: sharedCap, currency: 'CNY', initial: budget, trustedLiabilityContracts: contracts });
    const result = await run(context, { ledger, output: mockDir, send: async () => new Response(JSON.stringify({ choices: [
      { finish_reason: 'stop', message: { content: JSON.stringify({ task: 'combined', danger: [], efficiency: [],
        decision: { action: 'unknown', tile: null, reasons: ['offline fixture'], limitations: ['offline fixture'] } }) } }
    ], usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100, completion_tokens: 100 } })) });
    assert.equal(result.completed, 29);
    assert.equal(result.newRequests, 29);
    assert.equal(result.status, 'complete');
    const recap = await run(context, { ledger, output: mockDir, send: async () => { throw new Error('Unexpected mock replay'); } });
    assert.equal(recap.newRequests, 0);
    console.log(JSON.stringify({ ...result, networkRequests: 0, runId, resumeRequests: recap.newRequests }));
    return;
  }

  assert(budget.cap - budget.budgetCommitted >= reservation, 'Insufficient budget for a single attempt');
  const authorization = read(path.join(old, 'execution/authorization.approved.local.json'));
  const reference = authorization.perSchemeReferences.R;
  assert(authorization.approved && authorization.networkAuthorized && authorization.allowedReferences.includes(reference));
  const endpoint = new URL(authorization.endpoint);
  assert.equal(endpoint.href, 'https://api.deepseek.com/chat/completions');
  assert.equal(path.resolve(authorization.budgetFile), path.resolve(budgetFile));
  const resolveCredential = Accounting.createCredentialResolver({ credentialsFile: authorization.credentialsFile,
    authorization: { ...authorization, allowedReferences: [reference] } });
  fs.mkdirSync(liveDir, { recursive: true });
  const unlock = acquireLock(checkpoint + '.lock', false);
  let ledger;
  try {
    ledger = recoveryRunner.ledger(recoveryPlan, budgetFile);
    const state = ledger.snapshot();
    assert.equal(stableHash(state.reservationEntries), recoveryPlan.preservedReservationHash);
    assert.equal(stableHash(state.conservativeHolds), recoveryPlan.oldHoldHash);
    let key;
    const result = await run(context, { ledger, output: liveDir, send: async (body, signal) => {
      key ??= await resolveCredential(reference);
      return fetch(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    } });
    console.log(JSON.stringify({ ...result, runId }));
  } finally {
    try { ledger?.close(); } finally { unlock(); }
  }
}

(mode === '--check' ? check() : execution()).catch(error => {
  console.error(error instanceof assert.AssertionError ? `${error.code}: ${error.stack.split('\n').find(line => line.includes('xf-release-old29-check.cjs'))}` : error.message);
  process.exitCode = 1;
});
