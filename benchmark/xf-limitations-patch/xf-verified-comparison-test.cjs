'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const Facts = require('./xf-current-facts.cjs');
const Delivery = require('./xf-output-delivery.cjs');
const { verifiedComparison } = require('./xf-verified-comparison.cjs');

const defaultFolder = 'xf-current-facts-51-verified-comparison';
const previous = path.join(__dirname, 'xf-current-facts-51-pass-comparison');
const [mode, commonArg, folderArg = defaultFolder] = process.argv.slice(2);
assert(['--prepare', '--check', '--live', '--audit'].includes(mode) && commonArg);
const common = path.resolve(commonArg);
const folder = path.resolve(__dirname, folderArg);
assert(path.dirname(folder) === __dirname && path.basename(folder).startsWith('xf-current-facts-'));
const extension = path.join(__dirname, 'xf-release-old29', 'extension');
const original = path.join(common, 'xf-release-facts-history-preparation-20261113');
const bench = path.join(original, 'execution/v8-source/benchmark');
const load = name => require(path.join(extension, name));
const Agent = load('agent.js');
const Analysis = load('analysis.js');
const Transport = load('model-session-transport.js');
const Usage = load('model-usage.js');
const Accounting = require(path.join(bench, 'accounting.cjs'));
const { stableHash } = require(path.join(bench, 'core.cjs'));
const { acquireLock, journal } = require(path.join(bench, 'durable.cjs'));
const { atomic } = require(path.join(original, 'recovery-20261117/io.cjs'));
const runtime = { TextEncoder, TextDecoder, AbortController, structuredClone, setTimeout, clearTimeout, console, performance };
vm.runInNewContext(fs.readFileSync(path.join(extension, 'pi-runtime.js'), 'utf8'), runtime);

const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const wireHash = wire => hash(JSON.stringify(wire));
const write = (file, object) => fs.writeFileSync(file, JSON.stringify(object, null, 2) + '\n', { flag: 'wx' });
const into = file => path.join(folder, file);
const liveDir = into('live');
const liveFile = file => path.join(liveDir, file);
const [control, candidate] = ['XF-current-facts-comparison', 'XF-verified-comparison'];
const tracks = [control, candidate];
const count = 51;
const endpoint = 'https://api.deepseek.com/chat/completions';
const source = {
  runner: __filename, currentFacts: require.resolve('./xf-current-facts.cjs'), delivery: require.resolve('./xf-output-delivery.cjs'),
  verifiedComparison: require.resolve('./xf-verified-comparison.cjs'),
  review: require.resolve('./xf-verified-comparison-review.cjs'),
  verification: require.resolve('./xf-verified-comparison-check.cjs'),
  priorPlan: path.join(previous, 'PLAN.json'),
  priorDataset: path.join(previous, 'DATASET.private.json'),
  priorInputs: path.join(previous, 'INPUTS.private.json'),
  priorResults: path.join(previous, 'QUALITY_RESULTS.json'),
  priorAcceptance: path.join(previous, 'EXECUTION_ACCEPTANCE.json'),
  priorCheckpoint: path.join(previous, 'live/checkpoint.json'),
  rules: path.join(common, 'xf-s-format-execution-20261120/review-rules.json')
};
const config = { endpoint: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: false, maxTokens: 4096 };
const outputOptions = { ...load('adapters/model-endpoint.js').outputOptions(config), temperature: 0 };
const peak = { cachedInput: 0.04, uncachedInput: 2, output: 8, unit: 'perMillion' };
const offPeak = { cachedInput: 0.02, uncachedInput: 1, output: 4, unit: 'perMillion' };
const pricingSchedule = { timezone: 'Asia/Shanghai', currency: 'CNY', peak, offPeak };
const maxInput = 1048576;
const maxOutput = config.maxTokens;
const reservation = (maxInput * peak.uncachedInput + maxOutput * peak.output) / 1e6;

function sourceHashes() {
  return Object.fromEntries(Object.entries(source).map(([key, file]) => [key, fileHash(file)]));
}

function runtimeInventory() {
  return fs.readdirSync(extension, { recursive: true }).sort().flatMap(relative => {
    const file = path.join(extension, relative);
    return fs.statSync(file).isFile() ? [[relative, fileHash(file)]] : [];
  });
}

async function execute(input, track, send) {
  let deliveryActions = [];
  assert(tracks.includes(track));
  const facts = { ...input.facts, discardComparison: track === control ? input.comparison : input.verifiedComparison };
  const result = await Agent.run({ snapshot: input.snapshot, sessionContext: input.sessionContext,
    contextPolicy: 'live-xf', task: 'combined', question: '', maxTurns: 2, timeoutMs: 25000,
    runtime: { run: options => runtime.MJPiRuntime.run(Delivery.tightenContract(Facts.decorate(options, facts))) },
    transport: async (request, prepared) => {
      const wire = Transport.body(request, config, outputOptions);
      const raw = await send(wire, request.signal);
      const parsed = Transport.result(raw, request.tools.length > 0);
      if (raw.choices?.[0]?.finish_reason === 'stop' && !parsed.toolCalls?.length) {
        const repaired = Delivery.repairFinal(parsed.text, prepared);
        if (repaired) {
          parsed.text = repaired.text;
          deliveryActions = repaired.actions;
        }
      }
      const usage = Usage.normalizeUsage(raw);
      return { ...parsed, usage: { input: usage.uncachedInput ?? usage.input ?? 0, output: usage.output ?? 0,
        cacheRead: usage.cachedInput ?? 0, totalTokens: (usage.input ?? 0) + (usage.output ?? 0) } };
    } });
  return { text: result.sessionTurn.answer, toolCalls: result.runtime.toolCalls, deliveryActions };
}

function offlineResponse(turn, broken = false) {
  const toolCalls = ['get_self_hand', 'compare_discards', 'get_danger_evidence'].map(name => ({ id: `offline-${name}`,
    type: 'function', function: { name, arguments: '{}' } }));
  const content = JSON.stringify({ task: 'combined', danger: [], efficiency: [],
    decision: { action: 'unknown', tile: null, reasons: ['offline fixture'], limitations: ['offline fixture'],
      ...(broken ? { reasons_note: null } : {}) } });
  return { choices: [turn === 0 ? { finish_reason: 'tool_calls', message: { tool_calls: toolCalls } }
    : { finish_reason: 'stop', message: { content } }],
  usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100, completion_tokens: 100 } };
}

async function verifyWires(input) {
  const capture = async track => {
    const wires = [];
    const result = await execute(input, track, async wire => {
      wires.push(wire);
      return offlineResponse(wires.length - 1);
    });
    assert.equal(wires.length, 2);
    assert.equal(result.toolCalls.length ?? result.toolCalls, 3);
    const tools = new Map(wires[1].messages.filter(message => message.role === 'tool')
      .map(message => [message.tool_call_id, JSON.parse(message.content)]));
    assert.equal(tools.size, 3);
    assert(tools.get('offline-get_self_hand').hand.length > 0);
    assert(tools.get('offline-compare_discards').candidates.length > 0);
    assert(tools.get('offline-get_danger_evidence').candidates.length > 0);
    return wires;
  };
  const [base, variant] = await Promise.all(tracks.map(capture));
  for (const [index, wire] of variant.entries()) {
    const cards = wire.messages.filter(message => message.role === 'user' && message.content?.startsWith(Facts.prefix));
    assert.equal(cards.length, 1);
    const { discardComparison, ...sharedFacts } = JSON.parse(cards[0].content.slice(Facts.prefix.length));
    assert.deepEqual(discardComparison, input.verifiedComparison);
    assert.deepEqual(sharedFacts, input.facts);
    const messages = wire.messages.map(message => message === cards[0]
      ? { ...message, content: Facts.prefix + JSON.stringify({ ...sharedFacts, discardComparison: input.comparison }) } : message);
    assert.deepEqual({ ...wire, messages }, base[index]);
  }
  assert.equal(wireHash(base[0]), input.priorWinningWire);
  assert.notEqual(wireHash(base[0]), wireHash(variant[0]));
  return { [control]: wireHash(base[0]), [candidate]: wireHash(variant[0]) };
}

async function prepare() {
  const priorPlan = read(source.priorPlan);
  const priorResults = read(source.priorResults);
  const priorAcceptance = read(source.priorAcceptance);
  assert.equal(priorResults.sourceHashes.plan, fileHash(source.priorPlan));
  assert.equal(priorResults.sourceHashes.acceptance, fileHash(source.priorAcceptance));
  assert.equal(priorAcceptance.checkpointSha256, fileHash(source.priorCheckpoint));
  const priorCheckpoint = read(source.priorCheckpoint);
  assert.equal(priorCheckpoint.runId, priorAcceptance.runId);
  const priorFirstRequests = new Map(Object.values(priorCheckpoint.attempts)
    .filter(attempt => attempt.number === 1 && attempt.logicalId.startsWith(`${control}:`))
    .map(attempt => [attempt.logicalId, attempt]));
  assert.equal(priorFirstRequests.size, count);
  assert.equal(priorResults.groups[control].all.pass, 37);
  assert.equal(priorResults.groups[control].all.planned, count);
  assert.equal(priorPlan.inputsHash, fileHash(source.priorInputs));
  assert.equal(priorPlan.datasetHash, fileHash(source.priorDataset));
  assert.deepEqual(priorPlan.runtimeInventory, runtimeInventory());
  assert.equal(priorPlan.sourceHashes.currentFacts, fileHash(source.currentFacts));
  assert.equal(priorPlan.sourceHashes.delivery, fileHash(source.delivery));
  assert.deepEqual(priorPlan.outputOptions, outputOptions);
  const prior = read(source.priorInputs);
  assert.deepEqual(prior.config, config);
  const dataset = read(source.priorDataset);
  const inputs = [];
  for (const { firstWires, ...existing } of prior.inputs) {
    const { availableActions, ...snapshot } = existing.snapshot;
    const events = existing.sessionContext.events;
    const priorAttempt = priorFirstRequests.get(`${control}:${existing.decisionId}`);
    assert.equal(priorAttempt.wireHash, firstWires[control]);
    assert.equal(wireHash(read(path.join(previous, 'live', priorAttempt.requestFile))), firstWires[control]);
    assert.equal(existing.facts.position, snapshot.lastStep);
    assert(events.every(event => event.position <= snapshot.lastStep));
    const prepared = Analysis.prepare(snapshot, 'combined');
    const input = { ...existing, priorWinningWire: firstWires[control],
      verifiedComparison: verifiedComparison(snapshot, prepared, existing.facts, existing.comparison, events) };
    input.firstWires = await verifyWires(input);
    inputs.push(input);
  }
  assert.equal(inputs.length, count);
  assert.equal(new Set(inputs.map(input => input.decisionId)).size, count);
  const rules = read(source.rules);
  assert.equal(load('manifest.json').version, '0.16.17');
  assert.equal(rules.requiredModel, 'gpt-6.2-sol');
  assert.equal(rules.reasoningEffort, 'low');
  fs.mkdirSync(folder);
  write(into('DATASET.private.json'), dataset);
  write(into('INPUTS.private.json'), { config, inputs });
  write(into('PLAN.json'), { release: 'v0.16.17', endpoint, model: config.model, tracks, count, opportunities: count * tracks.length,
    rounds: dataset.rounds.map(round => [round.id, round.decisions.length]), maxAttemptsPerOpportunity: 2,
    primaryMetric: 'independent blind quality passes per planned opportunity',
    primaryComparison: 'paired net increase in passes across 51 decisions, with original 29 and added 22 shown separately',
    intervention: 'replace only discardComparison with verified per-tile comparisons, opponent-scoped evidence and post-riichi pass evidence',
    secondaryMetrics: ['final delivery per planned opportunity', 'major mahjong errors', 'decision P95', 'six-dimension mean for diagnosis'],
    sourceHashes: sourceHashes(), runtimeInventory: runtimeInventory(), datasetHash: fileHash(into('DATASET.private.json')),
    inputsHash: fileHash(into('INPUTS.private.json')), outputOptions, peak, offPeak, maxInput, maxOutput, reservation,
    rulesHash: stableHash(rules), reviewer: { model: rules.requiredModel, reasoning: rules.reasoningEffort }, sameMatch: true });
}

async function live(plan, inputs) {
  const approval = read(into('LIVE_APPROVAL.json'));
  assert.equal(approval.planSha256, fileHash(into('PLAN.json')));
  assert.equal(approval.endpoint, endpoint);
  assert(approval.externalDataApproved === true && Number.isFinite(approval.capCny) && approval.capCny >= reservation);
  const cap = approval.capCny;
  const credentialConfig = read(path.join(original, 'execution/authorization.approved.local.json'));
  const ref = credentialConfig.perSchemeReferences.R;
  assert.equal(new URL(credentialConfig.endpoint).href, endpoint);
  assert(credentialConfig.allowedReferences.includes(ref));
  const key = await Accounting.createCredentialResolver({ credentialsFile: credentialConfig.credentialsFile,
    authorization: { ...credentialConfig, allowedReferences: [ref] } })(ref);
  fs.mkdirSync(liveDir);
  const unlock = acquireLock(liveFile('checkpoint.json.lock'), true);
  const cp = { runId: `xf-current-facts:${fileHash(into('PLAN.json'))}`, status: 'running', results: {}, attempts: {} };
  const persist = () => atomic(liveFile('checkpoint.json'), cp);
  let ledger;
  let stop = null;
  try {
    ledger = Accounting.createSharedLedger({ filename: liveFile('budget.round.json'), cap, currency: 'CNY', autonomous: true });
    persist();
    async function runInput(input, track) {
      if (stop) return;
      const id = `${track}:${input.decisionId}`;
      let turn = 0;
      let lastText = '';
      let pending;
      const start = Date.now();
      try {
        const result = await execute(input, track, (wire, signal) => {
          pending = (async () => {
            assert(++turn <= plan.maxAttemptsPerOpportunity);
            if (turn === 1) assert.equal(wireHash(wire), input.firstWires[track]);
            assert(Buffer.byteLength(JSON.stringify(wire)) + 16384 <= maxInput);
            if (turn === 2) assert(wire.messages.some(message => message.role === 'tool') &&
              wire.messages.filter(message => message.role === 'tool').every(message => !message.content.includes('structuredClone is not defined')));
            if (ledger.snapshot().budgetCommitted + reservation > cap + 1e-10) {
              stop = 'budget-stopped';
              throw new Error(stop);
            }
            signal?.throwIfAborted();
            const attemptId = `${id}:a${turn}`;
            const name = attemptId.replaceAll(':', '_') + '.json';
            const booking = ledger.reserve({ inputTokens: maxInput, maxOutputTokens: maxOutput, rates: peak, currency: 'CNY',
              meta: { requestId: id, attemptId, runId: cp.runId, modelId: config.model, modelVersion: config.model, endpoint } });
            const attempt = cp.attempts[attemptId] = { logicalId: id, number: turn, status: 'reserved', booking,
              wireHash: wireHash(wire), requestFile: `requests/${name}`, responseFile: `responses/${name}` };
            let dispatched = false;
            try {
              persist();
              atomic(liveFile(attempt.requestFile), wire);
              signal?.throwIfAborted();
              attempt.status = 'dispatching';
              attempt.dispatchedAt = new Date().toISOString();
              persist();
              dispatched = true;
              const response = await fetch(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(wire) });
              const rawText = await response.text();
              const rawHash = hash(rawText);
              atomic(liveFile(attempt.responseFile), { httpStatus: response.status, rawText, rawHash });
              attempt.status = 'received';
              attempt.rawHash = rawHash;
              persist();
              const raw = JSON.parse(rawText);
              const usage = Accounting.normalizeUsage(raw.usage);
              lastText = raw.choices?.[0]?.message?.content ?? '';
              const pricing = Accounting.timePricing(attempt.dispatchedAt, pricingSchedule);
              const cost = Accounting.estimateCost(usage, pricing.rates);
              assert(cost !== null && usage.input !== null && usage.input <= maxInput && usage.output <= maxOutput && cost <= reservation + 1e-10);
              assert.equal(ledger.settle(booking, usage, { rates: pricing.rates, pricing }), cost);
              Object.assign(attempt, { status: 'settled', usage, cost });
              persist();
              if (!response.ok) throw new Error(`HTTP_${response.status}`);
              return raw;
            } catch (error) {
              if (attempt.status !== 'settled') {
                if (!dispatched) {
                  ledger.release(booking);
                  attempt.status = 'not-dispatched';
                } else attempt.status = 'unresolved';
                if (!dispatched || attempt.rawHash || !(signal?.aborted || error instanceof TypeError)) stop = 'stopped-requires-audit';
                persist();
              }
              throw error;
            }
          })();
          return pending;
        });
        cp.results[id] = { status: 'success', ...result, elapsedMs: Date.now() - start };
      } catch (error) {
        if (pending) await Promise.allSettled([pending]);
        if (error instanceof assert.AssertionError) stop = 'stopped-requires-audit';
        if (Object.values(cp.attempts).some(attempt => attempt.logicalId === id)) {
          cp.results[id] = { status: 'failed', text: lastText, elapsedMs: Date.now() - start,
            error: error.validation?.code ?? (stop ?? 'request-or-delivery-failed') };
        }
      }
      persist();
    }
    for (const [index, input] of inputs.entries()) {
      if (stop) break;
      for (const track of index % 2 ? [...tracks].reverse() : tracks) await runInput(input, track);
    }
    cp.status = stop ?? (Object.values(cp.results).every(result => result.status === 'success') ? 'complete' : 'finished-with-failures');
    persist();
    console.log(JSON.stringify({ status: cp.status, terminal: Object.keys(cp.results).length,
      known: ledger.snapshot().estimatedCost, outstanding: ledger.snapshot().reserved }));
  } finally { try { ledger?.close(); } finally { unlock(); } }
}

function audit(plan) {
  const checkpointPath = liveFile('checkpoint.json');
  const budgetPath = liveFile('budget.round.json');
  assert(!fs.existsSync(checkpointPath + '.lock') && !fs.existsSync(budgetPath + '.lock'));
  const cp = read(checkpointPath);
  const budget = read(budgetPath);
  assert.notEqual(cp.status, 'running');
  assert.equal(cp.runId, `xf-current-facts:${fileHash(into('PLAN.json'))}`);
  assert.equal(stableHash(budget), stableHash(journal(budgetPath + '.events.jsonl').latestBudget()));
  const records = new Map(budget.records.map(record => [record.meta.attemptId, record]));
  for (const [id, attempt] of Object.entries(cp.attempts)) {
    if (attempt.status === 'not-dispatched') continue;
    assert.equal(wireHash(read(liveFile(attempt.requestFile))), attempt.wireHash);
    if (attempt.status === 'settled') {
      const response = read(liveFile(attempt.responseFile));
      assert.equal(hash(response.rawText), attempt.rawHash);
      assert.deepEqual(Accounting.normalizeUsage(JSON.parse(response.rawText).usage), records.get(id).usage);
      assert.equal(records.get(id).cost, attempt.cost);
      records.delete(id);
    } else assert.equal(attempt.status, 'unresolved');
  }
  assert.equal(records.size, 0);
  const unknown = Object.values(cp.attempts).filter(attempt => attempt.status === 'unresolved').length;
  assert(Math.abs(budget.reserved - unknown * reservation) < 1e-8);
  assert(budget.estimatedCost + budget.reserved <= budget.cap + 1e-8);
  const summary = { runId: cp.runId, status: cp.status, planned: plan.opportunities, terminal: Object.keys(cp.results).length,
    attempts: Object.keys(cp.attempts).length, cap: budget.cap, known: budget.estimatedCost, outstanding: budget.reserved, unknown,
    checkpointSha256: fileHash(checkpointPath), budgetSha256: fileHash(budgetPath), planSha256: fileHash(into('PLAN.json')) };
  write(into('EXECUTION_ACCEPTANCE.json'), summary);
  console.log(JSON.stringify(summary));
}

async function main() {
  if (mode === '--prepare') { await prepare(); return; }
  const plan = read(into('PLAN.json'));
  const { inputs } = read(into('INPUTS.private.json'));
  assert.deepEqual(plan.sourceHashes, sourceHashes());
  assert.deepEqual(plan.runtimeInventory, runtimeInventory());
  assert.equal(plan.datasetHash, fileHash(into('DATASET.private.json')));
  assert.equal(plan.inputsHash, fileHash(into('INPUTS.private.json')));
  if (mode === '--check') {
    assert.equal(Facts.actualDora('3z'), '4z');
    assert.equal(Facts.actualDora('4z'), '1z');
    assert.equal(Facts.actualDora('7z'), '5z');
    assert.equal(Facts.actualDora('9p'), '1p');
    assert.equal(Facts.actualDora('0m'), '6m');
    const { canonical } = load('mahjong-analysis.js');
    for (const input of inputs) {
      assert.deepEqual(await verifyWires(input), input.firstWires);
      const { snapshot, facts, comparison } = input;
      const efficiencyLeader = [...facts.efficiency].sort((a, b) => a[1] - b[1] || b[2] - a[2])[0];
      assert.equal(comparison.highestUpperBoundAtBestShanten, efficiencyLeader[2]);
      assert.deepEqual(comparison.highestUpperBoundTiles,
        facts.efficiency.filter(([, shanten, count]) => shanten === efficiencyLeader[1] && count === efficiencyLeader[2]).map(([tile]) => tile));
      assert.equal(comparison.ownHandCounts.reduce((sum, [, count]) => sum + count, 0), snapshot.selfHand.length);
      assert.deepEqual(comparison.perDiscard.map(([tile]) => tile), facts.efficiency.map(([tile]) => tile));
      for (const [tile, , seats] of comparison.perDiscard) {
        assert.deepEqual([...seats].sort(), snapshot.rivers.filter(({ seat, discards }) => seat !== snapshot.selfSeat &&
          discards.some(discard => canonical(discard.tile) === canonical(tile))).map(({ seat }) => seat).sort());
      }
    }
    const verification = require('./xf-verified-comparison-check.cjs').check(inputs, Analysis);
    const fixture = inputs[0];
    const broken = async () => offlineResponse(1, true);
    for (const track of tracks) {
      const repaired = await execute(fixture, track, broken);
      assert.deepEqual(repaired.deliveryActions, ['remove_null_reasons_note', 'move_limitations']);
      assert.deepEqual(JSON.parse(repaired.text).limitations, ['offline fixture']);
    }
    const valid = JSON.stringify({ task: 'combined', danger: [], efficiency: [],
      decision: { action: 'unknown', tile: null, reasons: ['offline fixture with } and ]'] }, limitations: ['offline fixture'] });
    const withNote = note => valid.replace('"reasons":', `"actionNote":${JSON.stringify(note)},"reasons":`);
    const badBoundary = valid.replace(',"decision":', '}],"decision":');
    let regressionRequests = 0;
    const replayFinal = (text, finish_reason = 'stop') => execute(fixture, candidate, async () => {
      regressionRequests++;
      const response = offlineResponse(1);
      response.choices[0] = { finish_reason, message: { content: text } };
      return response;
    });
    for (const [text, actions] of [[withNote(null), ['remove_null_actionNote']], [withNote(''), ['remove_empty_actionNote']],
      [badBoundary, ['move_root_close', 'remove_stray_closing_bracket']]]) {
      const result = await replayFinal(text);
      assert.deepEqual(result.deliveryActions, actions);
      assert.deepEqual(JSON.parse(result.text), JSON.parse(valid));
    }
    const badDecision = { validation: { code: 'extra_fields', path: 'decision' } };
    await assert.rejects(replayFinal(withNote('requires a separate condition')), badDecision);
    await assert.rejects(replayFinal(withNote(null).replace('"tile":null', '"tile":"invalid"')), badDecision);
    await assert.rejects(replayFinal(withNote(null).replace('"tile":null', '"tile":"6m","tile":null')), badDecision);
    const prepared = Analysis.prepare(fixture.snapshot, 'combined');
    const risk = prepared.data.localAnalysis.danger.candidates.find(entry => entry.opponents.some(opponent => !opponent.genbutsu));
    assert(risk);
    const { seat } = risk.opponents.find(opponent => !opponent.genbutsu);
    const unsupportedSafe = JSON.parse(withNote(null));
    unsupportedSafe.danger = [{ tile: risk.tile, opponents: [{ seat, level: 'safe', reasons: ['offline fixture'] }] }];
    await assert.rejects(replayFinal(JSON.stringify(unsupportedSafe)), { validation: { code: 'unsupported_safe', path: 'danger[0].opponents[0].level' } });
    await assert.rejects(replayFinal(badBoundary, 'length'), /长度上限/);
    const receipt = { planSha256: fileHash(into('PLAN.json')), points: inputs.length, opportunities: plan.opportunities,
      fakeRequests: plan.opportunities * 2 + 2 + regressionRequests, networkRequests: 0, verification };
    write(into('OFFLINE_ACCEPTANCE.json'), receipt);
    console.log(JSON.stringify(receipt));
  } else if (mode === '--audit') audit(plan);
  else {
    const check = read(into('OFFLINE_ACCEPTANCE.json'));
    assert.equal(check.planSha256, fileHash(into('PLAN.json')));
    assert.equal(check.opportunities, plan.opportunities);
    await live(plan, inputs);
  }
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? `Assertion failed at ${error.stack?.split('\n').find(line => line.includes(__filename))?.trim()}`
    : String(error.message).slice(0, 160));
  process.exitCode = 1;
});
