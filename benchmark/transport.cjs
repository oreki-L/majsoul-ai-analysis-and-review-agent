'use strict';
const { normalizeUsage, normalizeRates, timePricing, redact } = require('./accounting.cjs');
const { performance } = require('node:perf_hooks');
const { stableHash } = require('./core.cjs');

function endpointURL(endpoint) {
  const url = new URL(endpoint);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Endpoint must be HTTP(S), without credentials, query or fragment');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
  return url.href;
}
function textOf(content) { return typeof content === 'string' ? content : (content ?? []).filter(x => x.type === 'text').map(x => x.text).join('\n'); }
function wireMessages(messages, systemPrompt) {
  const result = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
  for (const item of messages ?? []) {
    if (item.role === 'toolResult') result.push({ role: 'tool', tool_call_id: item.toolCallId, content: textOf(item.content) });
    else if (item.role === 'assistant' && Array.isArray(item.content)) {
      const calls = item.content.filter(x => x.type === 'toolCall');
      result.push({ role: 'assistant', content: textOf(item.content) || null, ...(calls.length ? { tool_calls: calls.map(x => ({ id: x.id, type: 'function', function: { name: x.name, arguments: JSON.stringify(x.arguments) } })) } : {}), ...(item.reasoning_content ? { reasoning_content: item.reasoning_content } : {}) });
    } else if (['system', 'user', 'assistant', 'tool'].includes(item.role)) result.push(structuredClone(item));
    else throw new Error('Unsupported message role');
  }
  return result;
}
function parseResponse(data) {
  const choice = data?.choices?.[0], message = choice?.message;
  if (!choice || !message || !['stop', 'tool_calls', 'function_call'].includes(choice.finish_reason)) throw new Error('Provider response did not finish normally');
  if (message.tool_calls?.length) {
    if (!Array.isArray(message.tool_calls)) throw new Error('Invalid tool calls');
    const ids = new Set();
    const toolCalls = message.tool_calls.map(call => {
      if (call.type !== 'function' || typeof call.id !== 'string' || !call.id || call.id.length > 200 || ids.has(call.id) || !/^[a-z_]{1,64}$/.test(call.function?.name ?? '') || typeof call.function?.arguments !== 'string' || call.function.arguments.length > 100000) throw new Error('Invalid tool call');
      ids.add(call.id);
      let args; try { args = JSON.parse(call.function.arguments); } catch { throw new Error('Invalid tool arguments JSON'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
      return { id: call.id, name: call.function.name, arguments: args };
    });
    return { text: typeof message.content === 'string' ? message.content : '', toolCalls, message: { ...message, role: 'assistant' } };
  }
  if (choice.finish_reason !== 'stop' || typeof message.content !== 'string' || !message.content.trim()) throw new Error('Provider returned no final answer');
  return { text: message.content, toolCalls: [], message };
}
function guard(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Cancelled'));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('Cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function limit(value, label, minimum = 1) { if (value !== null && value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) throw new Error('Invalid ' + label); return value ?? null; }
function mockAnswer(prepared) {
  return JSON.stringify({ task: prepared?.task ?? 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: prepared?.task === 'danger' ? null : prepared?.data?.outputConstraints?.legalDiscards?.[0] ?? null, reasons: ['Mock模拟响应，不代表模型牌力。'] }, limitations: ['Mock未调用真实模型。'] });
}
function createTransport(options = {}) {
  const { model = {}, mode = model.provider === 'openai-compatible' ? 'real' : 'mock', ledger, credentialResolver, fetch: fetchImpl = globalThis.fetch } = options;
  if (!['mock', 'real', 'paid', 'openai-compatible'].includes(mode)) throw new Error('Unsupported transport mode');
  const mock = mode === 'mock', attempts = [];
  let physicalOrdinal = 0;
  let lifecycleFailed = false;
  async function lifecycle(hook, event) {
    if (!hook) return;
    try { await hook(event); } catch (cause) {
      if (cause?.code === 'BENCHMARK_ADMISSION_DENIED') {
        const denied = new Error('Request admission denied'); denied.code = 'BENCHMARK_ADMISSION_DENIED'; throw denied;
      }
      lifecycleFailed = true; ledger?.block?.();
      const error = new Error('Lifecycle persistence failed; execution stopped');
      error.code = 'BENCHMARK_PERSISTENCE_FAILED'; error.persistenceFailure = true; error.attempt = event.attempt; error.ledgerState = ledger?.snapshot();
      throw error;
    }
  }
  // Validate endpoint without ever resolving credentials in mock mode.
  const endpoint = mock ? null : endpointURL(model.endpoint ?? model.baseUrl ?? model.baseURL);
  async function request(args = {}) {
    const started = performance.now(), startedAt = new Date().toISOString();
    const timeoutMs = args.timeoutMs ?? model.timeoutMs ?? options.timeoutMs ?? 60000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('A finite positive timeoutMs is required');
    const controller = new AbortController();
    const signals = [args.signal, options.signal].filter(Boolean);
    const abortListeners = signals.map(signal => { const listener = () => controller.abort(signal.reason ?? new Error('Cancelled')); if (signal.aborted) listener(); else signal.addEventListener('abort', listener, { once: true }); return [signal, listener]; });
    const timer = setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs);
    const ordinal = ++physicalOrdinal;
    const attempt = { attemptId: (options.runIdentity ? options.runIdentity + ':' : '') + (args.meta?.requestId ?? 'request') + ':http:' + ordinal, ...redact(args.meta ?? {}), startedAt, endedAt: null, status: 'pending', attempt: args.attempt ?? 1, retryOf: args.retryOf ?? null, dispatched: false, mock, usage: null, cost: null, estimated: true };
    attempts.push(attempt);
    let reservation = null, dispatched = false, key = '', usage = null, responseMessage = null, pricing = null;
    try {
      if (lifecycleFailed) throw new Error('Lifecycle persistence failed; execution stopped');
      if (controller.signal.aborted) throw controller.signal.reason;
      if (mock) {
        const requestBody = { model: model.model ?? model.id ?? 'mock', stream: false, messages: wireMessages(args.messages, args.systemPrompt),
          ...(args.tools?.length ? { tools: args.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}), simulated: true };
        await guard(lifecycle(args.beforeRequest ?? options.beforeRequest, { attempt, meta: args.meta, ledger: ledger?.snapshot(), requestBody: redact(requestBody) }), controller.signal);
        usage = normalizeUsage(args.mockUsage ?? { prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0 });
        const text = args.mockText ?? mockAnswer(args.prepared);
        responseMessage = { role: 'assistant', content: text, simulated: true };
        Object.assign(attempt, { status: 'success', usage, cost: 0, simulated: true });
        return { text, toolCalls: [], usage, cost: 0, simulated: true, latencyMs: performance.now() - started, attempt };
      }
      if (!ledger || !credentialResolver) throw new Error('Paid requests require a ledger and credential resolver');
      const maxOutputTokens = args.maxOutputTokens ?? model.maxOutputTokens ?? model.maxTokens;
      if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error('maxOutputTokens is required');
      const params = { ...(model.temperature !== undefined ? { temperature: model.temperature } : {}), ...(model.params ?? {}), ...(args.params ?? {}) };
      if (args.analysisJson === true) params.response_format = { type: 'json_object' };
      // Only generation settings may be user supplied; wire messages/model/auth remain authoritative.
      for (const name of Object.keys(params)) if (!['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'seed', 'reasoning_effort', 'response_format'].includes(name)) throw new Error('Unsupported generation parameter: ' + name);
      const tools = args.tools ?? [];
      const body = { ...params, model: model.model ?? model.id, stream: false, max_tokens: maxOutputTokens, messages: wireMessages(args.messages, args.systemPrompt), ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}) };
      if (model.thinking !== undefined) {
        const thinking = model.thinking === false ? { type: 'disabled' } : model.thinking;
        if (!thinking || typeof thinking !== 'object' || Array.isArray(thinking) || Object.keys(thinking).some(k => k !== 'type') || !['disabled', 'enabled'].includes(thinking.type)) throw new Error('Invalid thinking configuration');
        body.thinking = { type: thinking.type };
      }
      if (typeof body.model !== 'string' || !body.model) throw new Error('Model id required');
      // UTF-8 bytes are a conservative text-token estimate (not chars/4); optional caller
      // reservation must be at least this bound. Add framing/tool/schema margin.
      const bodyHash = stableHash(JSON.parse(JSON.stringify(body)));
      const recovered = options.replay?.({ attempt, bodyHash });
      if (recovered) {
        Object.assign(attempt, recovered.attempt, { replayed: true });
        if (!recovered.data) { const e = new Error('Recovered dispatched request has unknown outcome'); e.fault = recovered.fault ?? 'network'; throw e; }
        if (attempt.httpStatus >= 400) { const e = new Error('Provider HTTP status ' + attempt.httpStatus); e.fault = attempt.httpStatus === 429 ? 'rate-limit' : attempt.httpStatus >= 500 ? 'service' : 'configuration'; throw e; }
        const parsed = parseResponse(recovered.data);
        return { ...parsed, usage: attempt.usage, cost: attempt.cost, latencyMs: attempt.latencyMs ?? 0, attempt, replayed: true };
      }
      const byteBound = Buffer.byteLength(JSON.stringify(body), 'utf8') + 1024 + body.messages.length * 64;
      const bound = model.liabilityBound;
      if (bound && (!Number.isSafeInteger(bound.inputTokens) || bound.inputTokens < 1 || !Number.isSafeInteger(bound.outputTokens) || maxOutputTokens > bound.outputTokens || !/^[a-f0-9]{64}$/.test(bound.contractHash))) throw new Error('Invalid liability contract bound');
      const inputTokens = Math.max(bound?.inputTokens ?? byteBound, args.inputReservationTokens ?? 0);
      if (!Number.isSafeInteger(inputTokens)) throw new Error('Invalid input reservation');
      key = await guard(credentialResolver(model.credentialRef ?? model.credentialAlias ?? model.credential ?? model.keyRef), controller.signal);
      let reservationRates = normalizeRates(model.rates);
      pricing = model.pricingSchedule ? timePricing(startedAt, model.pricingSchedule) : { basis: 'prescribed conservative rates; actual provider time price not selected' };
      if (model.pricingSchedule) {
        if (model.pricingSchedule.currency !== (model.currency ?? model.rates?.currency)) throw new Error('Pricing currency mismatch');
        reservationRates = { ...reservationRates };
        for (const component of ['cachedInput', 'uncachedInput', 'output']) reservationRates[component] = Math.max(reservationRates[component], model.pricingSchedule.peak[component], model.pricingSchedule.offPeak[component]);
      }
      reservation = ledger.reserve({ inputTokens, maxOutputTokens, rates: reservationRates, currency: model.currency ?? model.rates?.currency, meta: { ...args.meta, attemptId: attempt.attemptId, ...(bound ? { liabilityBound: bound } : {}) } });
      attempt.reservation = { inputTokens, maxOutputTokens, basis: bound ? 'Documented provider full-context input ceiling plus transmitted output cap; conservative budget exposure, not usage' : 'UTF-8 request bytes plus framing margin; provider tokenization may differ', ...(bound ? { contractHash: bound.contractHash } : {}) };
      await guard(lifecycle(args.beforeRequest ?? options.beforeRequest, { attempt, meta: args.meta, ledger: ledger.snapshot(), requestBody: redact(structuredClone(body), [key]) }), controller.signal);
      await guard(lifecycle(options.onDispatch, { attempt: { ...attempt, dispatched: true }, bodyHash, reservationId: reservation, signal: controller.signal }), controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      dispatched = true;
      attempt.dispatched = true;
      const response = await guard(fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: controller.signal }), controller.signal);
      attempt.httpStatus = response.status;
      attempt.providerRequestId = String(response.headers?.get?.('x-request-id') ?? '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 200) || null;
      const retryAfter = response.headers?.get?.('retry-after');
      attempt.retryAfterMs = retryAfter ? Math.max(0, /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : null;
      const data = await guard(response.json(), controller.signal);
      responseMessage = data?.choices?.[0]?.message ?? null;
      usage = normalizeUsage(data?.usage, model.usageSemantics);
      usage.raw = redact(usage.raw, [key]);
      attempt.usage = usage;
      await lifecycle(options.onResponse, { attempt, bodyHash, reservationId: reservation, data: redact(data, [key]) });
      const settledReservation = reservation; reservation = null;
      attempt.pricing = pricing;
      attempt.cost = ledger.settle(settledReservation, usage, { rates: pricing.rates, pricing });
      if (!response.ok) throw new Error('Provider HTTP status ' + response.status);
      const parsed = parseResponse(data);
      Object.assign(attempt, { status: 'success' });
      return { ...parsed, usage, cost: attempt.cost, estimated: true, latencyMs: performance.now() - started, attempt };
    } catch (error) {
      if (reservation !== null) { const pendingReservation = reservation; reservation = null; if (dispatched) ledger.settle(pendingReservation, usage); else ledger.release(pendingReservation); }
      attempt.fault = error.fault ?? (/Budget cap/.test(String(error.message)) ? 'budget' : /Credential/.test(String(error.message)) ? 'authentication' : /Provider response|Provider returned|Invalid tool/.test(String(error.message)) ? 'model-output' : lifecycleFailed || error.persistenceFailure ? 'persistence' : attempt.httpStatus === 401 || attempt.httpStatus === 403 ? 'authentication' : attempt.httpStatus === 429 ? 'rate-limit' : attempt.httpStatus >= 500 ? 'service' : attempt.httpStatus >= 400 ? 'configuration' : controller.signal.aborted ? 'timeout' : dispatched || attempt.replayed ? 'network' : 'pre-dispatch');
      attempt.status = controller.signal.aborted ? (/timeout/i.test(String(controller.signal.reason?.message)) ? 'timeout' : 'cancelled') : 'failed';
      // Never retain raw provider/network exceptions: URLs, headers and body may contain secrets.
      const message = String(error?.message ?? 'Request failed');
      const trusted = /^(Provider (HTTP status \d+|response did not finish normally|returned no final answer)|Paid requests require|Unknown cost liability|Budget cap would be exceeded|A finite input|Invalid input reservation|maxOutputTokens is required|Model id required|Unsupported generation parameter|Credential (reference required|is missing or invalid)|Credentials file required)$/.test(message);
      attempt.error = controller.signal.aborted ? (/timeout/i.test(message) ? 'Request timeout' : 'Cancelled') : trusted ? redact(message, [key]) : 'Request failed (details omitted)';
      const safe = new Error(attempt.error); safe.fault = attempt.fault; safe.attempt = attempt; safe.ledgerState = ledger?.snapshot(); if (error?.code === 'BENCHMARK_ADMISSION_DENIED') safe.code = 'BENCHMARK_ADMISSION_DENIED'; if (lifecycleFailed || error.persistenceFailure) { safe.code = 'BENCHMARK_PERSISTENCE_FAILED'; safe.persistenceFailure = true; } throw safe;
    } finally {
      clearTimeout(timer); abortListeners.forEach(([signal, listener]) => signal.removeEventListener('abort', listener));
      attempt.endedAt = new Date().toISOString(); attempt.latencyMs = performance.now() - started;
      try { await lifecycle(args.onAttempt ?? options.onAttempt, { attempt, ledger: ledger?.snapshot(), responseMessage: redact(responseMessage, [key]) }); }
      catch (error) { attempt.persistenceStatus = 'failed'; throw error; }
    }
  }
  async function runModel(args = {}) {
    const maxRequests = limit(args.maxModelRequests, 'maxModelRequests'), maxTools = limit(args.maxToolCalls, 'maxToolCalls', 0);
    const start = performance.now(), from = attempts.length, messages = wireMessages(args.messages, args.systemPrompt);
    const timeoutMs = args.timeoutMs ?? options.timeoutMs ?? model.timeoutMs ?? 60000;
    let requestCount = 0, toolCount = 0, totalCost = 0;
    const tools = args.tools ?? [];
    while (true) {
      if (maxRequests !== null && requestCount >= maxRequests) throw new Error('maxModelRequests reached without final answer');
      const remaining = timeoutMs - (performance.now() - start); if (remaining <= 0) throw new Error('Decision timeout');
      let response;
      const retry = options.infrastructureRetry;
      for (let retryIndex = 0;; retryIndex++) {
        const remainingAttemptMs = timeoutMs - (performance.now() - start);
        if (remainingAttemptMs <= 0) throw new Error('Decision timeout');
        try {
          response = await request({ ...args, tools: maxTools !== null && toolCount >= maxTools ? [] : tools, systemPrompt: undefined, messages, timeoutMs: Math.min(remainingAttemptMs, retry?.httpTimeoutMs ?? remainingAttemptMs), meta: { ...args.meta, modelRequest: ++requestCount, infrastructureRetry: retryIndex } }); break;
        } catch (error) {
          await options.afterFailure?.(error);
          if (!retry || error.persistenceFailure || !retry.categories.includes(error.fault) || retryIndex >= retry.maxRetries || ledger?.snapshot().unknownLiability || ledger?.snapshot().blockedReason || maxRequests !== null && requestCount >= maxRequests) throw error;
          const delay = Math.max(error.attempt?.retryAfterMs ?? 0, Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** retryIndex * (1 + retry.jitter * Math.random())));
          if (delay > retry.maxWaitMs || timeoutMs - (performance.now() - start) <= delay) throw error;
          await options.onBackoff?.({ attemptId: error.attempt?.attemptId, delayMs: delay, retryIndex });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      totalCost = response.cost === null || totalCost === null ? null : totalCost + response.cost;
      if (!response.toolCalls.length) return { ...response, messages: [...messages, { role: 'assistant', content: response.text }], attempts: attempts.slice(from), cost: totalCost, toolCalls: toolCount, modelRequests: requestCount, latencyMs: performance.now() - start };
      // Validate all calls before executing any, including unknown tools and excess budgets.
      if (maxTools !== null && toolCount + response.toolCalls.length > maxTools) throw new Error('maxToolCalls reached');
      const calls = response.toolCalls.map(call => {
        const tool = tools.find(tool => tool.name === call.name); if (!tool) throw new Error('Unknown tool requested');
        validateArguments(call.arguments, tool.parameters);
        return { call, tool };
      });
      messages.push(response.message);
      for (const { call, tool } of calls) {
        if (args.signal?.aborted || options.signal?.aborted) throw new Error('Cancelled');
        const controller = new AbortController(), budget = timeoutMs - (performance.now() - start);
        if (budget <= 0) throw new Error('Decision timeout');
        const timer = setTimeout(() => controller.abort(new Error('Tool timeout')), budget);
        const signals = [args.signal, options.signal].filter(Boolean);
        const listeners = signals.map(signal => { const listener = () => controller.abort(new Error('Cancelled')); if (signal.aborted) listener(); else signal.addEventListener('abort', listener, { once: true }); return [signal, listener]; });
        try {
          let result;
          try { result = await guard(Promise.resolve().then(() => tool.execute(call.id, call.arguments)), controller.signal); }
          catch { throw new Error(controller.signal.aborted ? 'Tool cancelled or timed out' : 'Tool execution failed'); }
          messages.push({ role: 'tool', tool_call_id: call.id, content: typeof result === 'string' ? result : result?.content ? textOf(result.content) : JSON.stringify(result) });
          toolCount++;
        } finally { clearTimeout(timer); listeners.forEach(([signal, listener]) => signal.removeEventListener('abort', listener)); }
      }
    }
  }
  return { request, runModel, attempts };
}
function validateArguments(args, schema = {}) {
  if (schema.type === 'object' && (!args || typeof args !== 'object' || Array.isArray(args))) throw new Error('Invalid tool object');
  for (const key of schema.required ?? []) if (!Object.hasOwn(args, key)) throw new Error('Missing tool argument');
  for (const [key, value] of Object.entries(args)) {
    const spec = schema.properties?.[key];
    if (!spec) { if (schema.additionalProperties === false) throw new Error('Unknown tool argument'); continue; }
    if (spec.type === 'integer' && !Number.isInteger(value) || spec.type === 'number' && !Number.isFinite(value) || spec.type === 'string' && typeof value !== 'string' || spec.type === 'boolean' && typeof value !== 'boolean') throw new Error('Invalid tool argument type');
    if (spec.enum && !spec.enum.includes(value) || spec.minimum !== undefined && value < spec.minimum || spec.maximum !== undefined && value > spec.maximum) throw new Error('Invalid tool argument value');
  }
}
module.exports = { createTransport, endpointURL, wireMessages, parseResponse, validateArguments, mockAnswer };
