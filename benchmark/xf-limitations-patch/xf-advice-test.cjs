'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const [mode, commonArg] = process.argv.slice(2);
assert(['--freeze', '--check', '--live', '--audit'].includes(mode) && commonArg);
const common = path.resolve(commonArg);
const output = path.join(__dirname, 'xf-advice-old29');
const prior = path.join(__dirname, 'xf-release-old29');
const extension = path.join(prior, 'extension');
const old = path.join(common, 'xf-release-facts-history-preparation-20261113');
const bench = path.join(old, 'execution/v8-source/benchmark');
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
const scope = { TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, console, performance };
vm.runInNewContext(fs.readFileSync(path.join(extension, 'pi-runtime.js'), 'utf8'), scope);
assert.equal(read(path.join(extension, 'manifest.json')).version, '0.16.17');

const sourceFiles = {
  oldInputs: path.join(prior, 'INPUTS.private.json'),
  oldAudit: path.join(prior, 'OFFLINE_AUDIT.json'),
  oldReplies: path.join(old, 'recovery-20261117/live/merged-view.json'),
  approvedUnits: path.join(common, 'history-fact-card-dedup-preparation-20261113-v8-semantic-repair/APPROVED_SEMANTIC_UNITS.private.json'),
  dataset: path.join(common, 'preparation/dataset.old29.frozen.json'),
  rules: path.join(common, 'xf-s-format-execution-20261120/review-rules.json'),
  code: __filename
};
const oldInput = read(sourceFiles.oldInputs);
const oldAudit = read(sourceFiles.oldAudit);
assert.equal(hash(oldInput), oldAudit.inputHash);
assert.equal(oldInput.inputs.length, 29);
const outputOptions = oldAudit.wireOptions;
const cap = 10;
const maxInput = 1048576;
const maxOutput = 4096;
const rates = { cachedInput: 0.04, uncachedInput: 2, output: 8, unit: 'perMillion' };
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
  const releaseFiles = fs.readdirSync(extension, { recursive: true }).sort().flatMap(name => {
    const file = path.join(extension, name);
    return fs.statSync(file).isFile() ? [{ name, sha256: fileHash(file) }] : [];
  });
  const sourceHashes = Object.fromEntries(Object.entries(sourceFiles).map(([key, file]) => [key, fileHash(file)]));
  return { version: 'v0.16.17', points: 29, opportunities: 58, cap, reservation, rates, outputOptions, sourceHashes, releaseFiles, rows };
}

function decorate(options, advice) {
  if (!advice.length) return options;
  const index = options.messages.length - 2;
  assert(options.messages[index].content.startsWith('请分析本次问题。snapshot'));
  const content = '已核实适用条件的同局旧建议（只作参考。当前局面和本地计算优先，不沿用旧数值或旧安全判断）：\n' +
    JSON.stringify(advice.map(item => ({ asOf: item.asOf, advice: item.text })));
  return { ...options, messages: [...options.messages.slice(0, index), { role: 'user', content }, ...options.messages.slice(index)] };
}

async function execute(input, advice, send, onWire) {
  const result = await Agent.run({ snapshot: input.snapshot, sessionContext: input.sessionContext,
    contextPolicy: 'live-xf', task: 'combined', question: '', maxTurns: 2, timeoutMs: 25000,
    runtime: { run: options => scope.MJPiRuntime.run(decorate(options, advice)) },
    transport: async request => {
      const wire = Transport.body(request, oldInput.config, outputOptions);
      if (!request.messages.some(message => message.role === 'toolResult')) {
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
  return { text: result.sessionTurn.answer, turns: result.runtime.turns, toolCalls: result.runtime.toolCalls };
}

const fake = (input, useTool, turn) => ({
  choices: [useTool && turn === 1 ? { finish_reason: 'tool_calls', message: {
    tool_calls: [{ id: 'synthetic', type: 'function', function: { name: 'get_self_hand', arguments: '{}' } }]
  } } : { finish_reason: 'stop', message: { content: JSON.stringify({ task: 'combined', danger: [], efficiency: [],
    decision: { action: 'unknown', tile: null, reasons: ['mock'], limitations: ['mock'] } }) } }],
  usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100, completion_tokens: 100 }
});

async function run(plan, dir, send) {
  const cp = path.join(dir, 'checkpoint.json');
  const ledgerFile = path.join(dir, 'budget.round.json');
  const runId = `xf-advice-old29:${hash(plan)}`;
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
        if (budget.budgetCommitted + reservation <= cap + 1e-10) {
          const booking = ledger.reserve({ inputTokens: maxInput, maxOutputTokens: maxOutput, rates, currency: 'CNY', meta });
          pending++;
          return booking;
        }
        if (!pending) { stop = 'budget-stopped'; throw new Error(stop); }
        await new Promise(resolve => waiters.add(resolve));
      }
    }
    persist();
    const tasks = plan.rows.flatMap((row, index) => (index % 2 ? ['advice', 'base'] : ['base', 'advice']).map(arm => ({ row, arm })));
    let next = 0;
    async function worker() {
      while (!stop && next < tasks.length) {
        const { row, arm } = tasks[next++];
        const input = oldInput.inputs.find(item => item.decisionId === row.decisionId);
        const id = `${arm}:${row.decisionId}`;
        let count = 0;
        let rawText = '';
        const inflight = [];
        const started = Date.now();
        try {
          const result = await execute(input, arm === 'advice' ? row.advice : [], (wire, signal) => {
            const promise = (async () => {
              assert(count < 2 && Buffer.byteLength(JSON.stringify(wire)) + 16384 <= maxInput);
              const attemptId = `${id}:a${++count}`;
              const booking = await reserve({ runId, requestId: id, attemptId, modelId: wire.model, modelVersion: wire.model }, signal);
              const suffix = attemptId.replaceAll(':', '_') + '.json';
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
                persist();
                dispatched = true;
                const response = await send(wire, signal, input, count);
                const body = await response.text();
                const raw = JSON.parse(body);
                const usage = accounting.normalizeUsage(raw.usage);
                rawText = raw.choices?.[0]?.message?.content ?? '';
                const cost = accounting.estimateCost(usage, rates);
                atomic(path.join(dir, attempt.responseFile), { httpStatus: response.status, rawText: body, rawHash: sha(body), usage });
                Object.assign(attempt, { status: 'received', usage, rawHash: sha(body) });
                persist();
                assert(cost !== null && usage.input !== null && usage.input <= maxInput && usage.output <= maxOutput && cost <= reservation + 1e-10);
                assert.equal(ledger.settle(booking, usage), cost);
                settled = true;
                Object.assign(attempt, { status: 'settled', cost });
                persist();
                if (!response.ok) throw new Error(`HTTP_${response.status}`);
                return raw;
              } catch (error) {
                if (!settled) {
                  stop = 'stopped-requires-audit';
                  if (!dispatched) {
                    ledger.release(booking);
                    attempt.status = 'not-dispatched';
                  } else attempt.status = 'unresolved';
                  persist();
                }
                throw error;
              } finally { pending--; notify(); }
            })();
            inflight.push(promise);
            return promise;
          }, () => {});
          state.results[id] = { status: 'success', ...result, rawText, elapsedMs: Date.now() - started };
        } catch (error) {
          await Promise.allSettled(inflight);
          if (inflight.length === 0) stop = 'stopped-requires-audit';
          if (!stop || Object.values(state.attempts).some(attempt => attempt.logicalId === id)) {
            state.results[id] = { status: 'failed', text: rawText, elapsedMs: Date.now() - started,
              error: error.validation?.code ?? (error instanceof assert.AssertionError ? 'invariant' : error.message.slice(0, 100)) };
          }
        }
        persist();
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    state.status = stop ?? (Object.values(state.results).every(result => result.status === 'success') ? 'complete' : 'finished-with-failures');
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
    assert.equal(result.results, 58);
    assert.equal(result.attempts, 116);
    const state = read(path.join(dir, 'checkpoint.json'));
    for (const row of plan.rows) {
      const getWire = arm => read(path.join(dir, state.attempts[`${arm}:${row.decisionId}:a1`].requestFile));
      const control = getWire('base');
      const variant = getWire('advice');
      assert.equal(variant.messages.length - control.messages.length, Number(row.advice.length > 0));
      if (row.advice.length) assert(variant.messages.at(-3).content.includes(row.advice[0].text));
      variant.messages = variant.messages.filter(m => !m.content?.startsWith('已核实适用条件的同局旧建议'));
      assert.deepEqual(variant, control);
    }
    atomic(path.join(output, 'OFFLINE_ACCEPTANCE.json'), { ...result, networkRequests: 0, planHash: hash(plan) });
    console.log(JSON.stringify({ ...result, networkRequests: 0 }));
    return;
  }
  if (mode === '--audit') {
    const cp = read(checkpoint);
    assert(!fs.existsSync(checkpoint + '.lock') && !fs.existsSync(budgetFile + '.lock'));
    const budget = read(budgetFile);
    assert.equal(stableHash(budget), stableHash(journal(budgetFile + '.events.jsonl').latestBudget()));
    assert.equal(cp.runId, `xf-advice-old29:${hash(plan)}`);
    const booked = new Map(budget.records.map(record => [record.meta.attemptId, record]));
    for (const [id, attempt] of Object.entries(cp.attempts)) {
      if (attempt.status !== 'settled') continue;
      const wire = read(path.join(output, attempt.requestFile));
      const response = read(path.join(output, attempt.responseFile));
      assert.equal(hash(wire), attempt.wireHash);
      assert.equal(sha(response.rawText), attempt.rawHash);
      assert.deepEqual(accounting.normalizeUsage(JSON.parse(response.rawText).usage), booked.get(id).usage);
      assert.equal(booked.get(id).cost, attempt.cost);
    }
    const stats = { runId: cp.runId, status: cp.status, checkpointSha256: fileHash(checkpoint), opportunities: plan.opportunities,
      terminal: Object.keys(cp.results).length, attempts: Object.keys(cp.attempts).length, settled: booked.size, cap: budget.cap,
      known: budget.estimatedCost, outstanding: budget.reserved, cacheRead: budget.records.reduce((n, record) => n + record.usage.cachedInput, 0) };
    atomic(path.join(output, 'EXECUTION_ACCEPTANCE.json'), stats);
    console.log(JSON.stringify(stats));
    return;
  }
  const check = read(path.join(output, 'OFFLINE_ACCEPTANCE.json'));
  assert.equal(check.planHash, hash(plan));
  assert.equal(check.results, 58);
  const authorization = read(path.join(old, 'execution/authorization.approved.local.json'));
  const ref = authorization.perSchemeReferences.R;
  assert(authorization.allowedReferences.includes(ref));
  const endpoint = new URL(authorization.endpoint);
  assert.equal(endpoint.href, 'https://api.deepseek.com/chat/completions');
  const key = await accounting.createCredentialResolver({ credentialsFile: authorization.credentialsFile,
    authorization: { ...authorization, allowedReferences: [ref] } })(ref);
  console.log(JSON.stringify(await run(plan, output, (wire, signal) => fetch(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(wire) }))));
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.stack.split('\n').find(line => line.includes('xf-advice-test.cjs')) : error.message);
  process.exitCode = 1;
});
