'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const [mode, commonArg] = process.argv.slice(2);
assert(['--freeze', '--check', '--check-reuse', '--live', '--audit'].includes(mode) && commonArg);
const common = path.resolve(commonArg);
const initial = path.join(__dirname, 'xf-five-arm-old29');
const recovery = path.join(__dirname, 'xf-five-arm-old29-recovery');
const completedStage = path.join(__dirname, 'xf-five-arm-old29-comparison');
const output = path.join(__dirname, 'xf-five-arm-old29-supplement-diagnostics');
const prior = path.join(__dirname, 'xf-release-old29');
const extension = path.join(prior, 'extension');
const old = path.join(common, 'xf-release-facts-history-preparation-20261113');
const bench = path.join(old, 'execution/v8-source/benchmark');
const historyEvidence = path.join(path.dirname(common), 'context-optimization-20261026');
const legacyRuntime = path.join(historyEvidence, 'campaign/source-v4-live-20261028/runtime-snapshot');
const legacyPolicyFile = path.join(legacyRuntime, 'benchmark/campaign-policies.cjs');
const legacyAnalysisFile = path.join(legacyRuntime, 'extension/analysis.js');
const Campaign = require(legacyPolicyFile);
const LegacyAnalysis = require(legacyAnalysisFile);
const legacyArms = ['H2-dedup', 'AdviceHistory-Extract', 'AdviceHistory-CodeCompress'];
const arms = ['base', 'advice', ...legacyArms];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const { stableHash } = require(path.join(bench, 'core.cjs'));
const accounting = require(path.join(bench, 'accounting.cjs'));
const { acquireLock, journal } = require(path.join(bench, 'durable.cjs'));
const { atomic } = require(path.join(old, 'recovery-20261117/io.cjs'));
const Agent = require(path.join(extension, 'agent.js'));
const Analysis = require(path.join(extension, 'analysis.js'));
const Transport = require(path.join(extension, 'model-session-transport.js'));
const Usage = require(path.join(extension, 'model-usage.js'));
const scope = { TextEncoder, TextDecoder, AbortController, structuredClone, setTimeout, clearTimeout, console, performance };
vm.runInNewContext(fs.readFileSync(path.join(extension, 'pi-runtime.js'), 'utf8'), scope);
assert.equal(read(path.join(extension, 'manifest.json')).version, '0.16.17');

const sourceFiles = {
  oldInputs: path.join(prior, 'INPUTS.private.json'),
  oldAudit: path.join(prior, 'OFFLINE_AUDIT.json'),
  oldReplies: path.join(old, 'recovery-20261117/live/merged-view.json'),
  approvedUnits: path.join(common, 'history-fact-card-dedup-preparation-20261113-v8-semantic-repair/APPROVED_SEMANTIC_UNITS.private.json'),
  dataset: path.join(common, 'preparation/dataset.old29.frozen.json'),
  production: path.join(historyEvidence, 'data-preparation/inputs/production-rounds.v1.json'),
  legacyDataset: path.join(historyEvidence, 'data-preparation/inputs/dataset.v1.json'),
  legacySuite: path.join(historyEvidence, 'campaign/suite.realtime.ready.json'),
  rules: path.join(common, 'xf-s-format-execution-20261120/review-rules.json'),
  comparisonQuality: path.join(completedStage, 'QUALITY_RESULTS.json'),
  code: __filename
};
const oldInput = read(sourceFiles.oldInputs);
const oldAudit = read(sourceFiles.oldAudit);
const dataset = read(sourceFiles.dataset);
const production = read(sourceFiles.production);
const legacyDataset = require(path.join(legacyRuntime, 'benchmark/core.cjs')).loadDataset(sourceFiles.legacyDataset);
assert.equal(stableHash(legacyDataset), production.datasetHash);
const legacySuite = read(sourceFiles.legacySuite);
const nodes = new Map(dataset.rounds.flatMap(round => round.decisions.map(node => [node.id, node])));
assert.equal(hash(oldInput), oldAudit.inputHash);
assert.equal(oldInput.inputs.length, 29);
const outputOptions = oldAudit.wireOptions;
const initialAudit = read(path.join(initial, 'EXECUTION_ACCEPTANCE.json'));
const initialState = read(path.join(initial, 'checkpoint.json'));
const initialBudget = read(path.join(initial, 'budget.round.json'));
assert.equal(initialAudit.checkpointSha256, fileHash(path.join(initial, 'checkpoint.json')));
assert.equal(stableHash(initialBudget), stableHash(journal(path.join(initial, 'budget.round.json.events.jsonl')).latestBudget()));
assert.equal(initialBudget.cap, 10);
assert.equal(initialBudget.estimatedCost, initialAudit.known);
assert.equal(initialAudit.outstanding, 0);
assert.equal(initialAudit.settled, initialAudit.attempts);
const recoveryAudit = read(path.join(recovery, 'EXECUTION_ACCEPTANCE.json'));
const recoveryState = read(path.join(recovery, 'checkpoint.json'));
const recoveryBudget = read(path.join(recovery, 'budget.round.json'));
assert(!fs.existsSync(path.join(recovery, 'checkpoint.json.lock')));
assert.equal(recoveryAudit.checkpointSha256, fileHash(path.join(recovery, 'checkpoint.json')));
assert.equal(stableHash(recoveryBudget), stableHash(journal(path.join(recovery, 'budget.round.json.events.jsonl')).latestBudget()));
assert.equal(recoveryAudit.outstanding, recoveryBudget.reserved);
const priorState = read(path.join(completedStage, 'checkpoint.json'));
const priorAudit = read(path.join(completedStage, 'EXECUTION_ACCEPTANCE.json'));
const quality = read(sourceFiles.comparisonQuality);
for (const dir of [initial, recovery, completedStage, path.join(__dirname, 'xf-five-arm-old29-complete'), path.join(__dirname, 'xf-five-arm-old29-results')]) {
  assert(!['checkpoint.json.lock', 'budget.round.json.lock'].some(file => fs.existsSync(path.join(dir, file))));
}
assert.equal(fileHash(path.join(completedStage, 'checkpoint.json')), priorAudit.checkpointSha256);
assert.equal(quality.runId, priorState.runId);
assert.equal(quality.sourceHashes.checkpoint, priorAudit.checkpointSha256);
assert.equal(quality.sourceHashes.rules, fileHash(sourceFiles.rules));
assert.equal(quality.sourceHashes.dataset, fileHash(sourceFiles.dataset));
const retained = new Set(quality.outcomes.filter(row => row.blindId).map(row => `${row.arm}:${row.decisionId}`));
assert.equal(retained.size, quality.reviewed);
assert.equal(retained.size, 110);
const priorDirectories = [completedStage, path.join(__dirname, 'xf-five-arm-old29-complete'), recovery, initial];
const priorStages = priorDirectories.map(directory => ({ directory, state: read(path.join(directory, 'checkpoint.json')) }));
for (const { directory, state } of priorStages) {
  for (const attempt of Object.values(state.attempts).filter(a => a.status === 'unresolved')) {
    assert(!fs.existsSync(path.join(directory, attempt.responseFile)), 'Unknown request has an unexamined response');
  }
}
const oldUnknown = new Set(priorStages.flatMap(({ state }) => Object.values(state.attempts)
  .filter(attempt => attempt.status === 'unresolved').map(attempt => attempt.logicalId)));
assert.equal(oldUnknown.size, 4);
const maxInput = 1048576;
const maxOutput = 4096;
const rates = { cachedInput: 0.04, uncachedInput: 2, output: 8, unit: 'perMillion' };
const discount = { cachedInput: 0.02, uncachedInput: 1, output: 4, unit: 'perMillion' };
const publishedPricing = { timezone: 'Asia/Shanghai', currency: 'CNY', peak: rates, offPeak: discount };
const pricingUrl = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing';
function historicalEstimate(directory, budget) {
  const eventsFile = path.join(directory, 'budget.round.json.events.jsonl');
  const events = fs.readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  const first = events.at(0).at;
  const last = events.at(-1).at;
  // Both historical batches fit inside one off-peak clock hour. This bounds
  // each request even where its individual timestamp was not recorded.
  assert.equal(first.slice(0, 13), last.slice(0, 13));
  assert(events.every(event => event.at >= first && event.at <= last && accounting.timePricing(event.at, publishedPricing).period === 'offPeak'));
  const known = budget.records.reduce((total, record) => {
    assert.deepEqual(record.rates, rates);
    const cost = accounting.estimateCost(record.usage, discount);
    assert(cost !== null);
    return total + cost;
  }, 0);
  return { first, last, journalSha256: fileHash(eventsFile), count: budget.records.length,
    recordedPeakEstimate: budget.estimatedCost, known: Number(known.toFixed(8)) };
}
const priorPricing = { source: pricingUrl, initial: historicalEstimate(initial, initialBudget), recovery: historicalEstimate(recovery, recoveryBudget) };
assert.deepEqual(priorPricing, priorAudit.priorPricing);
const priorKnown = priorAudit.roundKnown;
const priorOutstanding = priorAudit.roundOutstanding;
const cap = 10;
const reservation = (maxInput * rates.uncachedInput + maxOutput * rates.output) / 1e6;
const planFile = path.join(output, 'PLAN.private.json');
const budgetFile = path.join(output, 'budget.round.json');
const checkpoint = path.join(output, 'checkpoint.json');

function buildPlan() {
  const original = read(sourceFiles.oldReplies).results;
  const approved = read(sourceFiles.approvedUnits).sources;
  const source = (index, repeat, section, offset, quote) => {
    const row = oldAudit.rows[index];
    const reply = original[`R:${row.decisionId}:r${repeat}`];
    assert.equal(reply.status, 'success');
    const parsed = JSON.parse(reply.text);
    const unit = (section === 'reason' ? parsed.decision.reasons : parsed.limitations).find(text => text.includes(quote));
    assert(unit, `Missing source ${index}/${repeat}/${offset}`);
    return { from: row.decisionId, round: row.roundId, asOf: row.position, text: quote, unitHash: sha(unit) };
  };
  const early = source(0, 1, 'reason', 1, '当前没有立直者，且这是开局阶段，优先按效率推进。');
  const lead = source(12, 2, 'reason', 0, '当前是南2局2本场，自家55900点排名第一，且无人立直、无人副露，属于可以正常推进的场面。');
  const defense = source(19, 2, 'reason', 0, '上家已立直，自家虽为庄家且领先，但手牌仅3向听、无现成和牌形，先打全场三家现物的5z最稳。');
  const riichiText = '若后续出现立直或明显副露，再依据牌河现物与筋壁重新评估防守。';
  const riichiRow = oldAudit.rows[11];
  const approvedSource = approved.find(entry => entry.sourceDecisionId === riichiRow.decisionId &&
    entry.units.some(unit => unit.approved && unit.text === riichiText && unit.dependencies.length === 0));
  assert(approvedSource);
  const refresh = { from: riichiRow.decisionId, round: riichiRow.roundId, asOf: riichiRow.position, text: riichiText,
    unitHash: approvedSource.units.find(unit => unit.approved && unit.text === riichiText).unitHash };

  const rows = oldInput.inputs.map((input, index) => {
    const row = oldAudit.rows[index];
    const s = input.snapshot;
    assert.equal(row.decisionId, input.decisionId);
    assert.equal(row.position, s.lastStep);
    const others = s.game.players.filter(player => player.seat !== s.selfSeat);
    assert.equal(others.length, 3);
    const riichi = others.filter(player => player.riichi).map(player => player.seat);
    const closed = s.game.players.every(player => !player.riichi && player.melds.length === 0);
    const score = s.game.scores[s.selfSeat];
    const leading = others.every(player => score > s.game.scores[player.seat]);
    const gate = (item, ok, condition, facts) => ok && item.round === row.roundId && item.asOf < row.position
      ? { ...item, condition, facts } : null;
    const preparer = Analysis.prepare(s, 'combined').data;
    const legal = preparer.outputConstraints.legalDiscards.includes('5z');
    const hand = preparer.localAnalysis.efficiency.candidates;
    const shanten = Math.min(...hand.map(candidate => candidate.shanten));
    const allGenbutsu = others.every(player => s.rivers.find(river => river.seat === player.seat)?.discards.some(d => d.tile === '5z'));
    const advice = [
      gate(early, closed && s.game.remaining >= 52, 'early-no-threat', { remaining: s.game.remaining, closed }),
      gate(lead, closed && score === 55900 && leading && s.game.round.wind === 1 && s.game.round.index === 1 && s.game.honba === 2,
        'unchanged-lead-and-no-threat', { score, leading, closed }),
      gate(refresh, riichi.length > 0, 'confirmed-opponent-riichi', { riichi }),
      gate(defense, riichi.length === 1 && riichi[0] === 0 && s.selfSeat === 1 && s.game.round.index === s.selfSeat && leading && shanten === 3 &&
        legal && allGenbutsu, 'defense-conditions-still-hold', { riichi, leading, shanten, legal, allGenbutsu })
    ].filter(Boolean);
    assert(advice.length <= 2);
    return { decisionId: row.decisionId, round: row.roundId, position: row.position, advice };
  });
  assert.equal(rows.length, 29);
  const inventory = directory => fs.readdirSync(directory, { recursive: true }).sort().flatMap(name => {
    const file = path.join(directory, name);
    return fs.statSync(file).isFile() ? [{ name, sha256: fileHash(file) }] : [];
  });
  const releaseFiles = inventory(extension);
  const legacyFiles = inventory(legacyRuntime);
  const oldOptions = Object.fromEntries(legacyArms.map(arm => {
    const options = legacySuite.schemes.find(scheme => scheme.id === `rt-${arm}`)?.context.options;
    assert.equal(options.version, Campaign.VERSION);
    assert.equal(options.policy, arm);
    assert.equal(options.sourceIndexHash, stableHash(production));
    const { policy, version, recent, trigger, ordinaryEventWindow, checkpointEvery, extractLimit } = options;
    return [arm, { policy, version, recent, trigger, ordinaryEventWindow, checkpointEvery, extractLimit }];
  }));
  const sourceHashes = Object.fromEntries(Object.entries(sourceFiles).map(([key, file]) => [key, fileHash(file)]));
  return { version: 'v0.16.17', arms, points: 29, opportunities: arms.length * 29, cap, reservation, rates, outputOptions, sourceHashes, releaseFiles, legacyFiles, oldOptions, rows,
    originalRunId: initialAudit.runId, originalCheckpointSha256: initialAudit.checkpointSha256, originalKnown: initialAudit.known,
    recoveryRunId: recoveryAudit.runId, recoveryCheckpointSha256: recoveryAudit.checkpointSha256, recoveryKnown: recoveryAudit.known,
    recoveryOutstanding: recoveryAudit.outstanding, priorPricing, priorKnown, priorOutstanding,
    priorCheckpointSha256: priorAudit.checkpointSha256, roundCap: cap,
    retainComparisonScores: true, targetCount: 145 - retained.size, priorUnknownOpportunities: oldUnknown.size };
}

function decorate(options, advice) {
  if (!advice.length) return options;
  const index = options.messages.length - 2;
  assert(options.messages[index].content.startsWith('请分析本次问题。snapshot'));
  const content = '已核实适用条件的同局旧建议（只作参考。当前局面和本地计算优先，不沿用旧数值或旧安全判断）：\n' +
    JSON.stringify(advice.map(item => ({ asOf: item.asOf, advice: item.text })));
  return { ...options, messages: [...options.messages.slice(0, index), { role: 'user', content }, ...options.messages.slice(index)] };
}

function oldContext(input, options, history, nativeOptions) {
  const node = structuredClone(nodes.get(input.decisionId));
  const snapshot = { ...input.snapshot };
  delete snapshot.availableActions;
  node.snapshot = snapshot;
  const prepared = LegacyAnalysis.prepare(snapshot, 'combined');
  const releasePrepared = Analysis.prepare(snapshot, 'combined');
  assert.deepEqual(prepared.data.outputConstraints.legalDiscards, releasePrepared.data.outputConstraints.legalDiscards);
  const originalSource = production.rounds.find(round => round.id === node.roundId);
  const originalRound = legacyDataset.rounds.find(round => round.id === node.roundId);
  assert(originalSource);
  const binding = originalSource.nodeBindings.find(member => member.decisionId === node.id);
  assert.equal(binding.snapshotHash, oldAudit.rows.find(row => row.decisionId === node.id).snapshotHash);
  const roundSource = { ...originalSource, states: originalRound.decisions.filter(point => point.position <= node.position)
    .map(point => ({ position: point.position, snapshot: point.snapshot })) };
  const scoped = history.filter(row => row.roundId === node.roundId);
  assert(scoped.every(source => source.position < node.position));
  const context = Campaign.buildCampaignContext({ node, prepared, channel: 'realtime', history: scoped, options,
    scheme: { id: options.policy } }, roundSource);
  assert.deepEqual(context.sourceDecisionIds, scoped.map(row => row.decisionId));
  assert.equal(context.summaryJobs.length, 0);
  const contractStart = nativeOptions.systemPrompt.indexOf('\nBenchmark统一输出约束');
  assert(contractStart > 0);
  const [system, ...messages] = context.messages;
  const request = Campaign.currentRequest(prepared, node, 'full');
  assert.equal(messages.at(-1).content, request);
  return { runtimeOptions: { ...nativeOptions, systemPrompt: system.content + nativeOptions.systemPrompt.slice(contractStart), messages },
    historyEntry: { decisionId: node.id, roundId: node.roundId, sessionId: node.sessionId, authorization: node.authorization,
      position: node.position, snapshot, request }, priorIds: context.sourceDecisionIds };
}

async function execute(input, arm, advice, plan, history, send, onWire) {
  const legacy = legacyArms.includes(arm);
  let context;
  const result = await Agent.run({ snapshot: input.snapshot, sessionContext: input.sessionContext,
    contextPolicy: 'live-xf', task: 'combined', question: '', maxTurns: 2, timeoutMs: 25000,
    runtime: { run: options => {
      if (!legacy) return scope.MJPiRuntime.run(decorate(options, advice));
      context = oldContext(input, plan.oldOptions[arm], history, options);
      return scope.MJPiRuntime.run(context.runtimeOptions);
    } },
    transport: async request => {
      const wire = Transport.body(request, oldInput.config, outputOptions);
      if (!legacy && !request.messages.some(message => message.role === 'toolResult')) {
        const base = { ...wire, messages: wire.messages.filter(message => !message.content?.startsWith('已核实适用条件的同局旧建议')) };
        assert.equal(hash(base), input.firstWireHash, 'Base XF wire drift');
      }
      onWire(wire);
      const raw = await send(wire, request.signal);
      const parsed = Transport.result(raw, request.tools.length > 0);
      const usage = Usage.normalizeUsage(raw);
      return { ...parsed, usage: { input: usage.uncachedInput ?? usage.input ?? 0,
        output: usage.output ?? 0, cacheRead: usage.cachedInput ?? 0, totalTokens: (usage.input ?? 0) + (usage.output ?? 0) } };
    } });
  return { text: result.sessionTurn.answer, turns: result.runtime.turns, toolCalls: result.runtime.toolCalls,
    ...(context && { historyEntry: { ...context.historyEntry, answer: result.result, answerText: result.sessionTurn.answer }, priorIds: context.priorIds }) };
}

const fake = (input, useTool, turn) => ({
  choices: [useTool && turn === 1 ? { finish_reason: 'tool_calls', message: {
    tool_calls: ['get_self_hand', 'compare_discards', 'get_danger_evidence'].map(name => ({
      id: `synthetic_${name}`, type: 'function', function: { name, arguments: '{}' }
    }))
  } } : { finish_reason: 'stop', message: { content: JSON.stringify({ task: 'combined', danger: [], efficiency: [],
    decision: { action: 'unknown', tile: null, reasons: ['mock'], limitations: ['mock'] } }) } }],
  usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100, completion_tokens: 100 }
});

async function run(plan, dir, send, reuse = false) {
  const cp = path.join(dir, 'checkpoint.json');
  const ledgerFile = path.join(dir, 'budget.round.json');
  const runId = `xf-five-arm-old29:${hash(plan)}`;
  fs.mkdirSync(dir, { recursive: true });
  const unlock = acquireLock(cp + '.lock', true);
  let ledger;
  try {
    assert(!fs.existsSync(cp) && !fs.existsSync(ledgerFile), 'Existing results require reconciliation, no replay');
    ledger = accounting.createSharedLedger({ filename: ledgerFile, cap, currency: 'CNY', autonomous: true });
    const state = { runId, status: 'running', results: {}, attempts: {} };
    const persist = () => atomic(cp, state);
    let stop = null;
    let pending = 0;
    const waiters = new Set();
    const notify = () => { for (const wake of waiters) wake(); waiters.clear(); };
    async function reserve(meta, signal) {
      for (;;) {
        signal?.throwIfAborted();
        if (stop) throw new Error(stop);
        const budget = ledger.snapshot();
        if (budget.budgetCommitted + reservation <= budget.cap + 1e-10) {
          const booking = ledger.reserve({ inputTokens: maxInput, maxOutputTokens: maxOutput, rates, currency: 'CNY', meta });
          pending++;
          return booking;
        }
        if (!pending) { stop = 'budget-stopped'; throw new Error(stop); }
        await new Promise(resolve => waiters.add(resolve));
      }
    }
    persist();
    const history = new Map(legacyArms.map(arm => [arm, []]));
    const recoveryAttempts = new Map();
    for (const [key, attempt] of Object.entries(priorState.attempts)) {
      const entries = recoveryAttempts.get(attempt.logicalId) ?? [];
      entries.push([key, attempt]);
      recoveryAttempts.set(attempt.logicalId, entries);
    }
    function carryRecovery(row, arm, input, id) {
      const result = priorState.results[id];
      const attempts = recoveryAttempts.get(id);
      if (!retained.has(id)) return false;
      assert(result && attempts?.length && result.error !== 'invariant');
      for (const [key, attempt] of attempts) {
        assert(['settled', 'reused', 'carried'].includes(attempt.status));
        const wire = read(path.join(completedStage, attempt.requestFile));
        const response = read(path.join(completedStage, attempt.responseFile));
        assert.equal(hash(wire), attempt.wireHash);
        assert.equal(sha(response.rawText), attempt.rawHash);
        assert(wire.messages.every(message => message.role !== 'tool' || !/structuredClone is not defined/.test(message.content)));
        atomic(path.join(dir, attempt.requestFile), wire);
        atomic(path.join(dir, attempt.responseFile), response);
        state.attempts[key] = { ...attempt, status: 'carried', priorAttemptId: key, priorPhase: 'previous-stage' };
      }
      state.results[id] = { ...result, timingBasis: result.timingBasis ?? 'continued-observed' };
      if (result.status === 'success' && legacyArms.includes(arm)) {
        const node = nodes.get(row.decisionId);
        const snapshot = { ...input.snapshot };
        delete snapshot.availableActions;
        const prepared = LegacyAnalysis.prepare(snapshot, 'combined');
        history.get(arm).push({ decisionId: node.id, roundId: node.roundId, sessionId: node.sessionId, authorization: node.authorization,
          position: node.position, snapshot, request: Campaign.currentRequest(prepared, { ...node, snapshot }, 'full'),
          answer: Analysis.parseXfResult(result.text, Analysis.prepare(snapshot, 'combined')).result, answerText: result.text });
      }
      persist();
      return true;
    }
    async function executePoint(row, arm) {
        const input = oldInput.inputs.find(item => item.decisionId === row.decisionId);
        const id = `${arm}:${row.decisionId}`;
        if (reuse && carryRecovery(row, arm, input, id)) return;
        let count = 0;
        let rawText = '';
        const inflight = [];
        const started = Date.now();
        try {
          const earlier = history.get(arm)?.filter(item => item.position < row.position);
          const result = await execute(input, arm, arm === 'advice' ? row.advice : [], plan, earlier, (wire, signal) => {
            const promise = (async () => {
              assert(count < 2 && Buffer.byteLength(JSON.stringify(wire)) + 16384 <= maxInput);
              const attemptId = `${id}:a${++count}`;
              if (count === 2) {
                const toolResults = wire.messages.filter(message => message.role === 'tool');
                assert(toolResults.length && toolResults.every(message => !/structuredClone is not defined/.test(message.content)),
                  'Tool results must not contain the original runtime error');
              }
              const suffix = attemptId.replaceAll(':', '_') + '.json';
              // Only an already settled first response with an identical wire may be reused.
              if (reuse && count === 1) for (const { directory, state: sourceState } of priorStages) {
                const originalAttempt = sourceState.attempts[attemptId];
                if (!['settled', 'reused', 'carried'].includes(originalAttempt?.status) || originalAttempt.wireHash !== hash(wire)) continue;
                const originalResponse = read(path.join(directory, originalAttempt.responseFile));
                assert.equal(sha(originalResponse.rawText), originalAttempt.rawHash);
                assert.deepEqual(wire, read(path.join(directory, originalAttempt.requestFile)));
                if (originalResponse.httpStatus !== 200) continue;
                const raw = JSON.parse(originalResponse.rawText);
                if (!['stop', 'tool_calls'].includes(raw.choices?.[0]?.finish_reason)) continue;
                rawText = raw.choices[0].message?.content ?? '';
                const attempt = { logicalId: id, number: count, status: 'reused', wireHash: hash(wire), rawHash: originalAttempt.rawHash,
                  requestFile: `requests/${suffix}`, responseFile: `responses/${suffix}`, priorAttemptId: attemptId,
                  priorDirectory: path.basename(directory), usage: originalResponse.usage,
                  cost: directory === initial ? accounting.estimateCost(originalResponse.usage, discount) : originalAttempt.cost };
                atomic(path.join(dir, attempt.requestFile), wire);
                atomic(path.join(dir, attempt.responseFile), originalResponse);
                state.attempts[attemptId] = attempt;
                persist();
                return raw;
              }
              const booking = await reserve({ runId, requestId: id, attemptId, modelId: wire.model, modelVersion: wire.model }, signal);
              const attempt = { logicalId: id, number: count, booking, status: 'reserved', wireHash: hash(wire),
                requestFile: `requests/${suffix}`, responseFile: `responses/${suffix}` };
              state.attempts[attemptId] = attempt;
              let dispatched = false;
              let settled = false;
              try {
                persist();
                atomic(path.join(dir, attempt.requestFile), wire);
                signal?.throwIfAborted();
                attempt.status = 'dispatching';
                attempt.dispatchedAt = new Date().toISOString();
                persist();
                dispatched = true;
                const response = await send(wire, signal, input, count);
                const body = await response.text();
                const raw = JSON.parse(body);
                const usage = accounting.normalizeUsage(raw.usage);
                rawText = raw.choices?.[0]?.message?.content ?? '';
                const pricing = accounting.timePricing(attempt.dispatchedAt, publishedPricing);
                const appliedRates = pricing.period === 'offPeak' ? discount : rates;
                const cost = accounting.estimateCost(usage, appliedRates);
                atomic(path.join(dir, attempt.responseFile), { httpStatus: response.status, rawText: body, rawHash: sha(body), usage });
                Object.assign(attempt, { status: 'received', usage, rawHash: sha(body) });
                persist();
                assert(cost !== null && usage.input !== null && usage.input <= maxInput && usage.output <= maxOutput && cost <= reservation + 1e-10);
                assert.equal(ledger.settle(booking, usage, { rates: appliedRates, pricing: {
                  ...pricing, rates: appliedRates, source: pricingUrl } }), cost);
                settled = true;
                Object.assign(attempt, { status: 'settled', cost });
                persist();
                if (!response.ok) throw new Error(`HTTP_${response.status}`);
                return raw;
              } catch (error) {
                if (!settled) {
                  if (!dispatched) {
                    ledger.release(booking);
                    attempt.status = 'not-dispatched';
                    stop = 'stopped-requires-audit';
                  } else {
                    attempt.status = 'unresolved';
                    // A network timeout with no received response retains the
                    // booking. Continue distinct opportunities under the same cap.
                    if (fs.existsSync(path.join(dir, attempt.responseFile)) || !(signal?.aborted || error instanceof TypeError)) stop = 'stopped-requires-audit';
                  }
                  persist();
                }
                throw error;
              } finally { pending--; notify(); }
            })();
            inflight.push(promise);
            return promise;
          }, () => {});
          const { historyEntry, ...answer } = result;
          if (historyEntry) history.get(arm).push(historyEntry);
          state.results[id] = { status: 'success', ...answer, rawText, elapsedMs: Date.now() - started };
        } catch (error) {
          if(error instanceof assert.AssertionError) console.log(JSON.stringify({id,assertion:error.stack?.split("\n").filter(line=>line.includes(__filename)).at(-2),code:error.code,operator:error.operator}));
          await Promise.allSettled(inflight);
          if (inflight.length === 0) stop = 'stopped-requires-audit';
          if (!stop || Object.values(state.attempts).some(attempt => attempt.logicalId === id)) {
            state.results[id] = { status: 'failed', text: rawText, elapsedMs: Date.now() - started,
              error: error.validation?.code ?? (error instanceof assert.AssertionError ? 'invariant' : error.message.slice(0, 100)) };
          }
        }
        const first = state.attempts[`${id}:a1`];
        if (first?.status === 'reused' && state.results[id]) state.results[id].timingBasis = 'replayed-first';
        persist();
    }
    for (const [index, row] of plan.rows.entries()) {
      if (stop) break;
      const offset = index % arms.length;
      const order = [...arms.slice(offset), ...arms.slice(0, offset)];
      await Promise.all(order.map(arm => executePoint(row, arm)));
    }
    state.status = stop ?? (Object.keys(state.results).length === plan.opportunities &&
      Object.values(state.results).every(result => result.status === 'success') ? 'complete' : 'finished-with-failures');
    persist();
    return { status: state.status, results: Object.keys(state.results).length, attempts: Object.keys(state.attempts).length,
      known: ledger.snapshot().estimatedCost, reserved: ledger.snapshot().reserved, runId };
  } finally { try { ledger?.close(); } finally { unlock(); } }
}

async function main() {
  if (mode === '--freeze') {
    fs.mkdirSync(output, { recursive: true });
    const plan = buildPlan();
    atomic(planFile, plan);
    console.log(JSON.stringify({ points: plan.points, opportunities: plan.opportunities, exposed: plan.rows.filter(row => row.advice.length).length,
      doubleAdvice: plan.rows.filter(row => row.advice.length === 2).length, cap, planHash: hash(plan) }));
    return;
  }
  const plan = read(planFile);
  assert.deepEqual(plan, buildPlan());
  if (mode === '--check') {
    const dir = fs.mkdtempSync(path.join(output, 'mock-'));
    const result = await run(plan, dir, async (_, __, input, turn) => new Response(JSON.stringify(fake(input, true, turn))));
    assert.equal(result.status, 'complete');
    assert.equal(result.results, plan.opportunities);
    assert.equal(result.attempts, plan.opportunities * 2);
    const state = read(path.join(dir, 'checkpoint.json'));
    for (const attempt of Object.values(state.attempts).filter(attempt => attempt.number === 2)) {
      const wire = read(path.join(dir, attempt.requestFile));
      const tools = new Map(wire.messages.filter(message => message.role === 'tool')
        .map(message => [message.tool_call_id, JSON.parse(message.content)]));
      assert.equal(tools.size, 3);
      assert(tools.get('synthetic_get_self_hand').hand.length >= 1);
      assert(tools.get('synthetic_compare_discards').candidates.length >= 1);
      assert(tools.get('synthetic_get_danger_evidence'));
    }
    for (const row of plan.rows) {
      const getWire = arm => read(path.join(dir, state.attempts[`${arm}:${row.decisionId}:a1`].requestFile));
      const control = getWire('base');
      const variant = getWire('advice');
      assert.equal(variant.messages.length - control.messages.length, Number(row.advice.length > 0));
      if (row.advice.length) assert(variant.messages.at(-3).content.includes(row.advice[0].text));
      variant.messages = variant.messages.filter(m => !m.content?.startsWith('已核实适用条件的同局旧建议'));
      assert.deepEqual(variant, control);
      const expectedPriors = plan.rows.filter(prior => prior.round === row.round && prior.position < row.position);
      const expected = expectedPriors.map(prior => prior.decisionId);
      for (const arm of legacyArms) assert.deepEqual(state.results[`${arm}:${row.decisionId}`].priorIds, expected);
      const h2 = getWire('H2-dedup');
      assert.equal(h2.messages.filter(message => message.role === 'assistant').length, Math.min(4, expected.length));
      const refs = h2.messages.filter(message => message.role === 'user' && message.content.includes('"snapshotReference":'));
      assert.equal(refs.length, Math.min(4, expected.length));
      for (const message of refs) assert(!Object.hasOwn(JSON.parse(message.content.split('\n').slice(1).join('\n')), 'snapshot'));
      for (const arm of legacyArms.slice(1)) {
        const wire = getWire(arm);
        assert.equal(wire.messages.filter(message => message.role === 'assistant').length, 0);
        const prefix = wire.messages.find(message => message.content.startsWith(`${arm}（`));
        assert.equal(!!prefix, expected.length > 4);
        if (prefix && arm.endsWith('CodeCompress')) assert(prefix.content.includes('opinion-dictionary-v1'));
      }
    }
    atomic(path.join(output, 'OFFLINE_ACCEPTANCE.json'), { ...result, toolResultsVerified: plan.opportunities, networkRequests: 0, planHash: hash(plan) });
    console.log(JSON.stringify({ ...result, networkRequests: 0 }));
    return;
  }
  if (mode === '--check-reuse') {
    const dir = fs.mkdtempSync(path.join(output, 'mock-reuse-'));
    const sent = [];
    const result = await run(plan, dir, async (wire, _, input, turn) => {
      sent.push([input.decisionId, turn]);
      return new Response(JSON.stringify(fake(input, true, turn)));
    }, true);
    assert.equal(result.results, plan.opportunities);
    const state = read(path.join(dir, 'checkpoint.json'));
    for (const id of retained) {
      const { timingBasis, ...result } = state.results[id];
      const { timingBasis: oldTiming, ...previous } = priorState.results[id];
      assert.deepEqual(result, previous);
      assert.equal(timingBasis, oldTiming ?? 'continued-observed');
    }
    const fresh = Object.values(state.attempts).filter(attempt => attempt.status === 'settled');
    assert.equal(fresh.length, sent.length);
    assert(fresh.every(attempt => !retained.has(attempt.logicalId)));
    for (const a of fresh.filter(attempt => attempt.number === 2)) {
      const wire = read(path.join(dir, a.requestFile));
      for (const tool of wire.messages.filter(message => message.role === 'tool')) {
        const result = JSON.parse(tool.content);
        assert(!Object.hasOwn(result, 'error'));
        assert(!Object.hasOwn(result, 'toolError'));
      }
    }
    const receipt = { planHash: hash(plan), checked: result.results, retained: retained.size,
      simulatedDispatches: sent.length, networkRequests: 0 };
    atomic(path.join(output, 'REUSE_ACCEPTANCE.json'), receipt);
    console.log(JSON.stringify(receipt));
    return;
  }
  if (mode === '--audit') {
    const cp = read(checkpoint);
    assert(!fs.existsSync(checkpoint + '.lock') && !fs.existsSync(budgetFile + '.lock'));
    const budget = read(budgetFile);
    assert.equal(stableHash(budget), stableHash(journal(budgetFile + '.events.jsonl').latestBudget()));
    assert.equal(cp.runId, `xf-five-arm-old29:${hash(plan)}`);
    const booked = new Map(budget.records.map(record => [record.meta.attemptId, record]));
    for (const [id, attempt] of Object.entries(cp.attempts)) {
      if (!['settled', 'reused', 'carried'].includes(attempt.status)) continue;
      const wire = read(path.join(output, attempt.requestFile));
      const response = read(path.join(output, attempt.responseFile));
      assert.equal(hash(wire), attempt.wireHash);
      assert.equal(sha(response.rawText), attempt.rawHash);
      if (attempt.status === 'carried') {
        const recovered = priorState.attempts[attempt.priorAttemptId];
        assert.equal(attempt.wireHash, recovered.wireHash);
        assert.equal(attempt.rawHash, recovered.rawHash);
        assert.equal(attempt.cost, recovered.cost);
        assert(!booked.has(id));
        continue;
      }
      if (attempt.status === 'reused') {
        const origin = priorStages.find(({ directory }) => path.basename(directory) === attempt.priorDirectory);
        assert(origin);
        const originalAttempt = origin.state.attempts[attempt.priorAttemptId];
        assert(['settled', 'reused', 'carried'].includes(originalAttempt.status));
        assert.equal(attempt.wireHash, originalAttempt.wireHash);
        assert.equal(attempt.rawHash, originalAttempt.rawHash);
        assert.equal(attempt.cost, origin.directory === initial ? accounting.estimateCost(response.usage, discount) : originalAttempt.cost);
        assert(!booked.has(id));
        continue;
      }
      assert.deepEqual(accounting.normalizeUsage(JSON.parse(response.rawText).usage), booked.get(id).usage);
      assert.equal(booked.get(id).cost, attempt.cost);
    }
    const stats = { runId: cp.runId, status: cp.status, checkpointSha256: fileHash(checkpoint), opportunities: plan.opportunities,
      terminal: Object.keys(cp.results).length, attempts: Object.keys(cp.attempts).length, settled: booked.size, cap: budget.cap,
      known: budget.estimatedCost, outstanding: budget.reserved, cacheRead: budget.records.reduce((n, record) => n + record.usage.cachedInput, 0),
      reused: Object.values(cp.attempts).filter(attempt => attempt.status === 'reused').length,
      carried: Object.values(cp.attempts).filter(attempt => attempt.status === 'carried').length,
      priorKnown, priorOutstanding, priorCheckpointSha256: priorAudit.checkpointSha256, retainedReviews: retained.size,
      combinedKnown: Number((priorKnown + budget.estimatedCost).toFixed(8)),
      combinedOutstanding: Number((priorOutstanding + budget.reserved).toFixed(8)) };
    assert(stats.known + stats.outstanding <= cap + 1e-10);
    assert.equal(budget.reserved, Object.values(cp.attempts).filter(attempt => attempt.status === 'unresolved').length * reservation);
    assert.equal(booked.size, Object.values(cp.attempts).filter(attempt => attempt.status === 'settled').length);
    atomic(path.join(output, 'EXECUTION_ACCEPTANCE.json'), stats);
    console.log(JSON.stringify(stats));
    return;
  }
  const check = read(path.join(output, 'OFFLINE_ACCEPTANCE.json'));
  assert.equal(check.planHash, hash(plan));
  assert.equal(check.results, plan.opportunities);
  assert.equal(check.toolResultsVerified, plan.opportunities);
  const reuseCheck = read(path.join(output, 'REUSE_ACCEPTANCE.json'));
  assert.equal(reuseCheck.planHash, hash(plan));
  assert.equal(reuseCheck.checked, plan.opportunities);
  assert.equal(reuseCheck.retained, retained.size);
  assert(!fs.existsSync(checkpoint) && !fs.existsSync(budgetFile) && !fs.existsSync(checkpoint + '.lock'));
  const authorization = read(path.join(old, 'execution/authorization.approved.local.json'));
  const ref = authorization.perSchemeReferences.R;
  assert(authorization.allowedReferences.includes(ref));
  const endpoint = new URL(authorization.endpoint);
  assert.equal(endpoint.href, 'https://api.deepseek.com/chat/completions');
  const key = await accounting.createCredentialResolver({ credentialsFile: authorization.credentialsFile,
    authorization: { ...authorization, allowedReferences: [ref] } })(ref);
  console.log(JSON.stringify(await run(plan, output, (wire, signal) => fetch(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(wire) }), true)));
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message.slice(0, 160) : error.message);
  process.exitCode = 1;
});
