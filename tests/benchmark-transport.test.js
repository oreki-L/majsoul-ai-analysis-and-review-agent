'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTransport, endpointURL } = require('../benchmark/transport.cjs');
const { createLedger, createSharedLedger, normalizeUsage, estimateCost, timePricing, createCredentialResolver } = require('../benchmark/accounting.cjs');
const { createTools } = require('../benchmark/tools.cjs');
const rates = { cachedInput: 1, uncachedInput: 3, output: 6, unit: 'perMillion' };
const model = { provider: 'openai-compatible', endpoint: 'https://unit.invalid/v1', model: 'test', credentialAlias: 'unit', maxTokens: 100, rates: { ...rates, currency: 'CNY' } };
const usage = { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 };
const response = (message, finish_reason = 'stop', rawUsage = usage) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason }], usage: rawUsage }) });
function real(fetch, extra = {}) { const ledger = createLedger({ cap: 1, currency: 'CNY' }); return { ledger, transport: createTransport({ mode: 'real', model, ledger, credentialResolver: async () => 'private-key-unit', fetch, ...extra }) }; }

test('analysis-json enforces provider JSON mode through tool and repair rounds while prose keeps its own contract', async () => {
  const bodies = [];
  const { transport } = real(async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (bodies.length === 1) return response({ role: 'assistant', content: null, tool_calls: [{ id: 'read-json', type: 'function', function: { name: 'read', arguments: '{}' } }] }, 'tool_calls');
    return response({ role: 'assistant', content: bodies.length === 2 ? '{"invalid":"fixture"}' : '{"valid":"fixture"}' });
  });
  const args = { analysisJson: true, params: { response_format: { type: 'text' } }, messages: [{ role: 'user', content: 'Return JSON.' }], tools: [{ name: 'read', parameters: { type: 'object', additionalProperties: false }, execute: async () => 'frozen' }] };
  const draft = await transport.runModel(args);
  await transport.runModel({ ...args, messages: [...draft.messages, { role: 'user', content: 'Correct the JSON schema.' }] });
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every(body => body.response_format.type === 'json_object'));
  assert.ok(bodies[2].messages.some(m => m.role === 'tool' && m.tool_call_id === 'read-json'));
  await transport.request({ analysisJson: false, messages: [{ role: 'user', content: 'Write a prose summary.' }] });
  assert.equal(bodies[3].response_format, undefined);
});

test('documented full-context liability reservations gate concurrent HTTP and settle only actual usage', async () => {
  const officialRates = { cachedInput: 0.04, uncachedInput: 2, output: 8, unit: 'perMillion', currency: 'CNY' };
  const ledger = createLedger({ cap: 4.3, currency: 'CNY' }), pending = [];
  const bounded = { ...model, rates: officialRates, maxTokens: 4096, liabilityBound: { inputTokens: 1048576, outputTokens: 4096, contractHash: 'a'.repeat(64) } };
  const transport = createTransport({ mode: 'real', model: bounded, ledger, credentialResolver: async () => 'fake-bound-test', fetch: async () => new Promise(resolve => pending.push(resolve)) });
  const first = transport.request({ messages: [{ role: 'user', content: 'short' }] });
  while (pending.length < 1) await new Promise(resolve => setImmediate(resolve));
  const second = transport.request({ messages: [{ role: 'user', content: 'also short' }] });
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  assert.equal(ledger.snapshot().reserved, 2 * 2.12992); assert.equal(ledger.snapshot().reservationCount, 2);
  await assert.rejects(transport.request({ messages: [] }), /Budget cap/); assert.equal(pending.length, 2);
  for (const resolve of pending) resolve(response({ role: 'assistant', content: '{}' }));
  await Promise.all([first, second]);
  assert.equal(ledger.snapshot().reserved, 0); assert.equal(ledger.snapshot().reservationCount, 0);
  assert.ok(ledger.snapshot().records.every(r => r.amount === 2.12992 && r.meta.liabilityBound.contractHash === 'a'.repeat(64)));
  assert.ok(ledger.snapshot().estimatedCost < 0.01);
  await assert.rejects(transport.request({ maxOutputTokens: 4097 }), /Request failed/);
  assert.equal(pending.length, 2);
});

test('unbounded benchmark loop executes more than product tool/request clamps over actual fake HTTP payloads', async () => {
  let requests = 0, executed = 0;
  const { transport, ledger } = real(async (_url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.stream, false); assert.equal(options.headers.Authorization, 'Bearer private-key-unit');
    requests++;
    if (requests <= 7) return response({ content: null, tool_calls: [{ id: 'c' + requests, type: 'function', function: { name: 'read', arguments: '{}' } }] }, 'tool_calls');
    assert.equal(body.messages.filter(m => m.role === 'tool').length, 7);
    return response({ content: 'finished' });
  });
  const result = await transport.runModel({ messages: [{ role: 'user', content: 'start' }], tools: [{ name: 'read', parameters: { type: 'object', additionalProperties: false }, execute: async () => { executed++; return 'frozen'; } }], maxModelRequests: null, maxToolCalls: null, meta: { channel: 'followup', schemeId: 's', decisionId: 'd', repetition: 2 } });
  assert.equal(result.text, 'finished'); assert.equal(requests, 8); assert.equal(executed, 7); assert.equal(result.attempts.length, 8);
  assert.equal(result.attempts[0].channel, 'followup'); assert.ok(result.attempts.every(a => a.startedAt && a.endedAt && a.latencyMs >= 0));
  assert.equal(ledger.snapshot().unknownLiability, false);
});

test('unknown tools or invalid arguments execute no tools', async () => {
  for (const [name, args] of [['unknown', '{}'], ['read', '{"seat":99}']]) {
    let executed = 0;
    const { transport } = real(async () => response({ tool_calls: [{ id: 'a', type: 'function', function: { name, arguments: args } }] }, 'tool_calls'));
    await assert.rejects(transport.runModel({ tools: [{ name: 'read', parameters: { type: 'object', properties: { seat: { type: 'integer', maximum: 3 } } }, execute: async () => executed++ }] }), /tool/i);
    assert.equal(executed, 0);
  }
});

test('zero tool budget omits tools and lifecycle hooks can prevent dispatch before billing', async () => {
  let fetches = 0, finished;
  const { transport, ledger } = real(async (_url, options) => {
    fetches++; assert.equal(JSON.parse(options.body).tools, undefined); return response({ content: 'done' });
  }, { beforeRequest: ({ ledger: pending, requestBody }) => { assert.ok(pending.reserved > 0); assert.equal(requestBody.stream, false); assert.ok(!JSON.stringify(requestBody).includes('private-key-unit')); }, onAttempt: ({ attempt, responseMessage }) => { finished = attempt.status; assert.equal(responseMessage.content, 'done'); } });
  assert.equal((await transport.runModel({ maxToolCalls: 0, tools: [{ name: 'never', parameters: {}, execute: () => assert.fail() }] })).text, 'done');
  assert.equal(fetches, 1); assert.equal(finished, 'success');
  await assert.rejects(transport.request({ beforeRequest: () => { throw new Error('Global campaign limit'); } }));
  assert.equal(fetches, 1); assert.equal(ledger.snapshot().reserved, 0); assert.equal(ledger.snapshot().unknownLiability, false);
});

test('cache hit/miss provider usage determines estimated cost and unknown usage remains null', () => {
  const normalized = normalizeUsage(usage);
  assert.equal(normalized.inputIncludesCached, true); assert.equal(normalized.uncachedInput, 60);
  assert.equal(estimateCost(normalized, rates), 0.00028);
  const openai = normalizeUsage({ prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } });
  assert.equal(estimateCost(openai, rates), 0.00028);
  assert.equal(estimateCost(normalizeUsage({ prompt_tokens: 100, completion_tokens: 10 }), rates), null);
  assert.equal(normalizeUsage(null).output, null);
  const inconsistent = normalizeUsage({ ...usage, prompt_cache_miss_tokens: 70 });
  assert.equal(inconsistent.valid, false); assert.equal(estimateCost(inconsistent, rates), null);
  const sameRates = { ...rates, cachedInput: rates.uncachedInput };
  assert.equal(estimateCost(normalizeUsage({ prompt_tokens: 100, completion_tokens: 10 }), sameRates), 0.00036);
  assert.equal(estimateCost(normalizeUsage({ prompt_tokens: 100, completion_tokens: 10 }, { noCache: true }), rates), 0.00036);
  assert.equal(normalizeUsage({ ...usage, prompt_cache_hit_tokens: -1 }).valid, false);
});

test('credential namespaces never fall through and aliases require explicit execution gate', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-credentials-test-'));
  const credentialsFile = path.join(folder, 'credentials.json');
  try {
    fs.writeFileSync(credentialsFile, JSON.stringify({ groups: { plan15: { apiKey: 'group-test' }, groupOnly: { apiKey: 'group-only-test' } }, credentialAliases: { plan15: { apiKey: 'alias-test', executionGate: 'unknown' }, plan16: { apiKey: 'allowed-test', executionGate: 'allowed' } } }));
    const resolve = createCredentialResolver({ credentialsFile, allowGroups: ['plan15', 'groupOnly'] });
    await assert.rejects(resolve('alias:plan15'), /allowed/);
    await assert.rejects(resolve('plan15'), /allowed/);
    assert.equal(await resolve('group:plan15'), 'group-test');
    assert.equal(await resolve('plan16'), 'allowed-test');
    await assert.rejects(resolve('alias:groupOnly'), /allowed/);
    await assert.rejects(createCredentialResolver({ credentialsFile })('group:groupOnly'), /authorization/);
  } finally { fs.rmSync(credentialsFile); fs.rmdirSync(folder); }
});

test('persistence hook failures preserve paid result and accounting, then block further dispatch', async () => {
  let fetches = 0;
  const { transport, ledger } = real(async () => { fetches++; return response({ content: 'paid-success' }); }, { onAttempt: () => { throw new Error('secret-hook-error'); } });
  await assert.rejects(transport.request({}), error => {
    assert.equal(error.persistenceFailure, true); assert.equal(error.attempt.status, 'success'); assert.ok(error.attempt.cost > 0);
    assert.ok(!error.message.includes('secret-hook-error')); assert.ok(error.ledgerState.estimatedCost > 0); return true;
  });
  await assert.rejects(transport.request({})); assert.equal(fetches, 1); assert.ok(ledger.snapshot().blockedReason);
  const restored = createLedger({ cap: 1, currency: 'CNY', rates, initial: ledger.snapshot() });
  assert.throws(() => restored.reserve({ inputTokens: 1, maxOutputTokens: 1 }), /blocked/);
});

test('shared campaign budget carries spending across stages and locks parallel processes or unresolved reservations', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-shared-ledger-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'budget.json');
  const first = createSharedLedger({ filename, cap: 50, currency: 'CNY' });
  assert.throws(() => createSharedLedger({ filename, cap: 50, currency: 'CNY' }), /locked/);
  const id = first.reserve({ inputTokens: 100, maxOutputTokens: 20, rates });
  first.settle(id, normalizeUsage(usage)); first.close();
  const second = createSharedLedger({ filename, cap: 50, currency: 'CNY' }); assert.equal(second.snapshot().estimatedCost, 0.00028);
  second.reserve({ inputTokens: 100, maxOutputTokens: 20, rates }); second.close();
  const third = createSharedLedger({ filename, cap: 50, currency: 'CNY' }); assert.equal(third.snapshot().unknownLiability, true);
  assert.throws(() => third.reserve({ inputTokens: 100, maxOutputTokens: 20, rates }), /liability/); third.close();
  assert.throws(() => createSharedLedger({ filename, cap: 51, currency: 'CNY' }), /mismatch/);
});

test('reservation balances derive from outstanding obligations and never absorb negative legacy balances', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-reservation-roundoff-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'budget.json'), ledger = createSharedLedger({ filename, cap: 50, currency: 'CNY' });
  const fractional = { uncachedInput: 1, cachedInput: 1, output: 1, currency: 'CNY', unit: 'perMillion' };
  const ids = [100000, 200000, 300000].map(inputTokens => ledger.reserve({ inputTokens, maxOutputTokens: 1, rates: fractional }));
  ledger.settle(ids[1], normalizeUsage({ prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0 }));
  const live = ledger.snapshot(); assert.equal(live.reservationCount, 2); assert.equal(live.reserved, 0.100001 + 0.300001);
  ledger.release(ids[0]); assert.equal(ledger.snapshot().reserved, 0.300001); assert.equal(ledger.snapshot().reservationCount, 1);
  ledger.release(ids[2]); assert.equal(ledger.snapshot().reserved, 0); assert.equal(ledger.snapshot().reservationCount, 0);
  for (let i = 0; i < 88; i++) { const id = ledger.reserve({ inputTokens: 1234 + i, maxOutputTokens: 4096, rates }); ledger.settle(id, normalizeUsage(usage)); }
  const completed = ledger.snapshot(); assert.equal(completed.reserved, 0); assert.equal(completed.reservationCount, 0); assert.equal(completed.unknownLiability, false); ledger.close();
  const reloaded = createSharedLedger({ filename, cap: 50, currency: 'CNY' }); assert.equal(reloaded.snapshot().estimatedCost, completed.estimatedCost); reloaded.close();
  for (const reserved of [-1.6653345369377348e-16, -0.01]) {
    const original = JSON.stringify({ ...completed, reserved }); fs.writeFileSync(filename, original);
    assert.throws(() => createSharedLedger({ filename, cap: 50, currency: 'CNY' }), /invalid/);
    assert.equal(fs.readFileSync(filename, 'utf8'), original);
    assert.throws(() => createLedger({ cap: 50, currency: 'CNY', initial: { ...completed, reserved } }), /migration/);
  }
  const zeroRates = { ...fractional, uncachedInput: 0, cachedInput: 0, output: 0 };
  fs.writeFileSync(filename, JSON.stringify(completed));
  const pending = createSharedLedger({ filename, cap: 50, currency: 'CNY' }); pending.reserve({ inputTokens: 1, maxOutputTokens: 1, rates: zeroRates });
  assert.equal(pending.snapshot().reserved, 0); assert.equal(pending.snapshot().reservationCount, 1); pending.close();
  const unresolved = createSharedLedger({ filename, cap: 50, currency: 'CNY' }); assert.equal(unresolved.snapshot().unknownLiability, true); assert.equal(unresolved.snapshot().reservationCount, 1);
  assert.throws(() => unresolved.reserve({ inputTokens: 1, maxOutputTokens: 1, rates }), /liability/); unresolved.close();
  fs.writeFileSync(filename, JSON.stringify({ ...completed, reserved: 1e-16, reservationCount: 1 }));
  const tinyDebt = createSharedLedger({ filename, cap: 50, currency: 'CNY' }); assert.equal(tinyDebt.snapshot().reserved, 1e-16); assert.equal(tinyDebt.snapshot().unknownLiability, true); tinyDebt.close();
});

test('group-array credentials resolve exact id and DeepSeek thinking is explicit in wire body', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-group-array-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const credentialsFile = path.join(folder, 'credentials.json'); fs.writeFileSync(credentialsFile, JSON.stringify({ groups: [{ id: 'A', apiKey: 'array-test-key' }] }));
  assert.equal(await createCredentialResolver({ credentialsFile, allowGroups: ['A'] })('group:A'), 'array-test-key');
  const { transport } = real(async (_url, options) => { assert.deepEqual(JSON.parse(options.body).thinking, { type: 'disabled' }); return response({ content: 'ok' }); }, { model: { ...model, thinking: { type: 'disabled' } } });
  assert.equal((await transport.request({})).text, 'ok');
});

test('scoped frozen authorization allows prepared aliases but excludes C/F values without modifying credentials', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-scoped-auth-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const credentialsFile = path.join(folder, 'credentials.json');
  const source = JSON.stringify({ groups: [{ id: 'A', apiKey: 'active-test' }, { id: 'C', apiKey: 'excluded-test' }], credentialAliases: { plan15: { apiKey: 'alias-test', executionGate: 'unknown' }, plan16: { apiKey: 'excluded-test', executionGate: 'unknown' } } }); fs.writeFileSync(credentialsFile, source);
  const resolve = createCredentialResolver({ credentialsFile, authorization: { manifestId: 'frozen-hash-test', allowedReferences: ['group:A', 'alias:plan15', 'alias:plan16'], excludedGroups: ['C', 'F'] } });
  assert.equal(await resolve('alias:plan15'), 'alias-test'); assert.equal(await resolve('group:A'), 'active-test');
  await assert.rejects(resolve('alias:plan16'), /excluded/); await assert.rejects(resolve('group:C'), /outside/);
  assert.equal(fs.readFileSync(credentialsFile, 'utf8'), source);
});

test('request-time Shanghai price changes preserve peak reservation and distinguish conservative fallback', () => {
  const schedule = { timezone: 'Asia/Shanghai', currency: 'CNY', peak: { cachedInput: 0.04, uncachedInput: 2, output: 8 }, offPeak: { cachedInput: 0.02, uncachedInput: 1, output: 4 } };
  assert.equal(timePricing('2026-10-27T01:00:00Z', schedule).period, 'peak');
  assert.equal(timePricing('2026-10-27T04:00:00Z', schedule).period, 'offPeak');
  assert.equal(timePricing('2026-10-27T06:00:00Z', schedule).period, 'peak');
  assert.equal(timePricing('2026-10-27T10:00:00Z', schedule).period, 'offPeak');
  assert.equal(timePricing('2026-10-31T01:00:00Z', schedule).period, 'offPeak');
  assert.equal(timePricing('2026-10-27T01:00:00Z', { ...schedule, holidays: ['2026-10-27'], holidaysVerified: true }).period, 'offPeak');
  const ledger = createLedger({ cap: 50, currency: 'CNY', rates: schedule.peak });
  const id = ledger.reserve({ inputTokens: 100, maxOutputTokens: 20 });
  const pricing = timePricing('2026-10-27T11:00:00Z', schedule);
  ledger.settle(id, normalizeUsage(usage), { rates: pricing.rates, pricing });
  const record = ledger.snapshot().records[0]; assert.equal(record.reservationRates.output, 8); assert.equal(record.rates.output, 4); assert.equal(record.pricing.period, 'offPeak');
});

test('reservations are atomic and failed dispatched requests leave unknown liability across resume', async () => {
  const ledger = createLedger({ cap: 0.001, currency: 'CNY', rates });
  const id = ledger.reserve({ inputTokens: 200, maxOutputTokens: 50 });
  assert.throws(() => ledger.reserve({ inputTokens: 200, maxOutputTokens: 50 }), /cap/);
  ledger.settle(id, null); assert.equal(ledger.snapshot().unknownLiability, true);
  assert.throws(() => ledger.reserve({ inputTokens: 1, maxOutputTokens: 1 }), /liability/);
  const restored = createLedger({ cap: 1, currency: 'CNY', rates, initial: ledger.snapshot() });
  assert.throws(() => restored.reserve({ inputTokens: 1, maxOutputTokens: 1 }), /liability/);
  const { transport, ledger: failed } = real(async () => { throw new Error('network dropped'); });
  await assert.rejects(transport.request({ messages: [] })); assert.equal(failed.snapshot().unknownLiability, true);
});

test('timeout/cancel terminate fetch implementations that ignore signal and redact provider failures', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const { transport, ledger } = real(async () => new Promise(() => {}));
    const pending = transport.request({ timeoutMs: 30, signal: controller.signal });
    if (cancel) setTimeout(() => controller.abort(new Error('private-key-unit')), 5);
    await assert.rejects(pending);
    assert.equal(transport.attempts[0].status, cancel ? 'cancelled' : 'timeout');
    assert.equal(ledger.snapshot().unknownLiability, true);
    assert.ok(!JSON.stringify(transport.attempts).includes('private-key-unit'));
  }
  const { transport } = real(async () => { throw new Error('HTTP https://secret.invalid/?token=private-key-unit raw-secret'); });
  await assert.rejects(transport.request({}));
  assert.ok(!JSON.stringify(transport.attempts).includes('raw-secret'));
});

test('mock never resolves credentials; insecure endpoints fail without credentials', async () => {
  let reads = 0;
  const transport = createTransport({ mode: 'mock', model, credentialResolver: async () => { reads++; throw new Error('must not read'); } });
  const result = await transport.runModel({ mockText: 'mock-only' });
  assert.equal(result.text, 'mock-only'); assert.equal(reads, 0); assert.equal(result.simulated, true);
  for (const endpoint of ['https://user:password@unit.invalid/v1', 'https://unit.invalid/?key=secret']) assert.throws(() => endpointURL(endpoint));
  const resolve = createCredentialResolver({ env: { UNIT_TEST_KEY: 'env-private' } });
  assert.equal(await resolve('env:UNIT_TEST_KEY'), 'env-private');
});

test('read-only tools freeze facts, filter future events and enforce post-call legal discards', async () => {
  const snapshot = { playerCount: 4, selfSeat: 0, selfHand: ['1m'], phase: 'playing', lastStep: 3, rivers: [] };
  const node = { position: 3, legalActions: [{ action: 'discard', tile: '1m' }] };
  const tools = createTools({ snapshot, node, events: [{ position: 2, kind: 'DiscardTile' }, { position: 4, kind: 'DealTile' }], prepared: { data: { localAnalysis: { efficiency: { candidates: [{ tile: '1m' }, { tile: '2m' }] } } } } });
  snapshot.selfHand.push('9p'); node.legalActions.push({ action: 'discard', tile: '2m' });
  const read = async (name, args = {}) => JSON.parse((await tools.find(t => t.name === name).execute('x', args)).content[0].text);
  assert.deepEqual((await read('get_self_hand')).hand, ['1m']);
  assert.equal((await read('get_round_events')).events.length, 1);
  assert.deepEqual((await read('compare_discards')).efficiency.candidates, [{ tile: '1m' }]);
  await assert.rejects(read('get_player_discards', { seat: 9 }), /seat/);
});

test('injected fake live runner completes context, wire tool loop, cache accounting and private checkpoint/report offline', async t => {
  const { compileSuite } = require('../benchmark/core.cjs');
  const { runSuite } = require('../benchmark/runner.cjs');
  const { createReport } = require('../benchmark/report.cjs');
  const suite = compileSuite(path.resolve(__dirname, '../benchmark/examples/suite.mock.json'));
  suite.schemes = [{ ...suite.schemes[0], review: false }];
  suite.models.synthetic = { ...model, maxTokens: 100, credentialAlias: 'env:FAKE_ONLY' };
  suite.execution = { ...suite.execution, maxModelRequests: null, maxToolCalls: null, budget: { cap: 1, currency: 'CNY' } };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-fake-live-integration-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  let fetches = 0, toolRounds = 0, credentialsRead = 0;
  const checkpoint = path.join(folder, 'checkpoint.json');
  const state = await runSuite(suite, { mode: 'live', checkpoint,
    credentialResolver: async () => { credentialsRead++; return 'fake-private-key-for-offline-only'; },
    fetch: async (url, options) => {
      fetches++; assert.equal(url, 'https://unit.invalid/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer fake-private-key-for-offline-only');
      const body = JSON.parse(options.body);
      const payload = body.messages.filter(m => m.role === 'user').map(m => { try { return JSON.parse(m.content); } catch { return null; } }).find(p => p?.legalActions);
      assert.ok(payload); assert.ok(payload.events.every(e => e.position <= payload.asOf));
      if (payload.channel !== 'realtime') return response({ content: '纯离线假供应商追问回答。' });
      if (!body.messages.some(m => m.role === 'tool')) {
        toolRounds++; assert.ok(body.tools.some(t => t.function.name === 'get_self_hand'));
        return response({ role: 'assistant', content: null, tool_calls: [{ id: 'offline-hand', type: 'function', function: { name: 'get_self_hand', arguments: '{}' } }] }, 'tool_calls');
      }
      const hand = JSON.parse(body.messages.find(m => m.role === 'tool').content);
      assert.deepEqual(hand.hand, payload.current.selfHand);
      return response({ role: 'assistant', content: JSON.stringify({ task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: payload.legalActions[0].tile, reasons: ['离线假供应商选择合法候选，仅验证连接。'] }, limitations: ['纯模拟接口，不代表牌力。'] }) });
    } });
  const nodes = suite.dataset.rounds.flatMap(r => r.decisions);
  const qaCount = nodes.reduce((n, node) => n + node.followups.length, 0) + suite.dataset.rounds.reduce((n, round) => n + (round.globalTasks ?? []).length, 0);
  assert.equal(state.status, 'complete'); assert.ok(state.results.every(r => r.status === 'success'));
  assert.equal(toolRounds, nodes.length); assert.equal(state.toolCalls, nodes.length);
  assert.equal(fetches, nodes.length * 2 + qaCount); assert.equal(credentialsRead, fetches);
  assert.equal(state.modelRequests, fetches);
  assert.equal(Object.values(state.requests).reduce((n, request) => n + request.dispatchedModelRequests, 0), fetches);
  assert.ok(Math.abs(state.ledger.estimatedCost - fetches * 0.00028) < 1e-12); assert.equal(state.ledger.unknownLiability, false);
  const report = createReport(state); assert.equal(report.synthetic, false); assert.equal(report.accounting.ledger.estimatedCost, state.ledger.estimatedCost);
  for (const file of fs.readdirSync(folder)) if (fs.statSync(path.join(folder, file)).isFile()) assert.ok(!fs.readFileSync(path.join(folder, file), 'utf8').includes('fake-private-key-for-offline-only'));
  const resumed = await runSuite(suite, { mode: 'live', checkpoint, resume: true, credentialResolver: () => assert.fail('Resume must not read credentials'), fetch: () => assert.fail('Resume must not dispatch') });
  assert.equal(resumed.results.length, state.results.length); assert.equal(resumed.modelRequests, state.modelRequests); assert.equal(resumed.ledger.estimatedCost, state.ledger.estimatedCost);
});
