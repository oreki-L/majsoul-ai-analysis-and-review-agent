'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const Core = require('./core.cjs');
const Context = require('./context.cjs');
const Analysis = require('../extension/analysis.js');
const { createTools } = require('./tools.cjs');
const { createTransport } = require('./transport.cjs');
const { createLedger, createSharedLedger, createCredentialResolver, normalizeRates, validateRates, deriveTrustedLiabilityContracts } = require('./accounting.cjs');
const component = value => encodeURIComponent(String(value));
const historyKey = (repeat, schemeId) => `${repeat}:${component(schemeId)}`;
function admission(reason) { const error = new Error(reason); error.code = 'BENCHMARK_ADMISSION_DENIED'; return error; }
function modelFor(suite, scheme, modelId, role) {
  const model = suite.models[modelId];
  const alias = role === 'summary' && scheme.summaryModelId ? model.credentialAlias ?? scheme.credentialAlias : scheme.credentialAlias ?? model.credentialAlias;
  return { ...model, ...(alias ? { credentialAlias: alias } : {}) };
}

const frozenScrubCache = new WeakMap();
function freezeTree(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freezeTree); Object.freeze(value); } return value; }
function scrub(value, secrets = []) {
  if (value && typeof value === 'object' && Object.isFrozen(value)) { const signature = secrets.join('\u0000'); const cached = frozenScrubCache.get(value); if (cached?.signature === signature) return cached.value; const clean = Array.isArray(value) ? value.map(v => scrub(v, secrets)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /^(api.?key|secret|password|access.?token|cookie)$/i.test(k) || k.toLowerCase() === 'authorization' && typeof v === 'string' ? '[REDACTED]' : scrub(v, secrets)])); freezeTree(clean); frozenScrubCache.set(value, { signature, value: clean }); return clean; }
  if (typeof value === 'string') { let s = value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').replace(/\bsk-[\w-]+/g, '[REDACTED]'); for (const secret of secrets) if (secret) s = s.split(secret).join('[REDACTED]'); return s; }
  if (Array.isArray(value)) return value.map(v => scrub(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /^(api.?key|secret|password|access.?token|cookie)$/i.test(k) || (k.toLowerCase() === 'authorization' && typeof v === 'string') ? '[REDACTED]' : scrub(v, secrets)]));
  return value;
}
function fingerprint(suite) {
  const { baseDir, datasetPath, labelsPath, labels, ...data } = suite;
  const plugins = suite.schemes.filter(s => s.context.module).map(s => ({ schemeId: s.id, source: fs.readFileSync(path.resolve(baseDir, s.context.module), 'utf8') }));
  const sources = Object.fromEntries(['runner.cjs', 'core.cjs', 'context.cjs', 'campaign-policies.cjs', 'production-v010.cjs', 'discussion-policies.cjs', 'global-policies.cjs', 'job-runner.cjs', 'transport.cjs', 'accounting.cjs', 'tools.cjs', '../extension/analysis.js', '../extension/mahjong-analysis.js', '../extension/contracts/snapshot.js'].map(file => [file, Core.stableHash(fs.readFileSync(path.resolve(__dirname, file), 'utf8').replace(/\r\n/g, '\n'))]));
  return Core.stableHash({ suite: scrub(data), plugins, sources, runnerContract: 1 });
}
function manifest(suite, mode) { return { strictValidationPolicy: { repair: 'same-model schema/code/path feedback, no count cap', noProgress: 'same normalized text hash plus same validation code/path seen in this logical request terminates; normalization only for detection, raw preserved', minimumHttpRemainingMs: Math.min(5000, suite.execution.timeoutMs / 10), deadline: 'initial+review share one logical timeout; each QA has one logical timeout' }, fingerprint: fingerprint(suite), suiteId: suite.id, datasetId: suite.dataset.id, mode, seed: suite.execution.seed, repetitions: suite.execution.repetitions, schemeIds: suite.schemes.map(s => s.id), decisions: suite.dataset.rounds.flatMap(r => r.decisions.map(d => d.id)), backgroundPolicy: suite.execution.backgroundPolicy ?? 'defer', quotaAssumption: suite.execution.backgroundPolicy === 'independent-quota' ? { foreground: suite.execution.foregroundQuotaId, summary: suite.execution.summaryQuotaId, userDeclared: true, providerVerified: false } : null, globalScope: suite.schemes.some(s => s.context.options?.stage === 'global') ? 'explicit selected-round/asOf scoped custom adapter; non-contiguous selected rounds, never whole-match evidence' : 'generic entry is round-bound; selected-round global requires explicit versioned adapter', synthetic: mode === 'mock' }; }
function planSuite(suite) {
  const jobs = [], rounds = suite.dataset.rounds, schemes = suite.schemes.filter(s => !s.aliasOf);
  for (let repeat = 0; repeat < suite.execution.repetitions; repeat++) {
    const max = Math.max(...rounds.map(r => r.decisions.length));
    for (let index = 0; index < max; index++) for (let offset = 0; offset < rounds.length; offset++) {
      const round = rounds[(offset + repeat + suite.execution.seed) % rounds.length], node = round.decisions[index];
      if (!node) continue;
      const rotate = (jobs.length + index + repeat + suite.execution.seed) % schemes.length;
      for (let s = 0; s < schemes.length; s++) jobs.push({ repeat, round, node, scheme: schemes[(s + rotate) % schemes.length] });
    }
  }
  return jobs;
}
function dryRun(suite) { const schedule = planSuite(suite); return { manifest: manifest(suite, 'dry-run'), network: false, credentialsRead: false, initialRequests: schedule.length, followupRequests: schedule.reduce((n, j) => n + j.node.followups.length, 0), globalRequests: schedule.reduce((n, j) => n + (j.round.globalTasks ?? []).filter(t => t.nodeId === j.node.id).length, 0), reviewRequests: schedule.filter(j => j.scheme.review).length, summaryRequests: 'data dependent; budget includes all roles', schedule: schedule.map(j => ({ repeat: j.repeat, schemeId: j.scheme.id, decisionId: j.node.id, roundId: j.round.id })) }; }
function livePreflight(suite) {
  const e = suite.execution;
  if (!Number.isFinite(e.budget.cap) || e.budget.cap <= 0) throw new Error('Live requires explicit positive budget cap');
  if (e.backgroundPolicy === 'independent-quota' && (!e.foregroundQuotaId || !e.summaryQuotaId || e.foregroundQuotaId === e.summaryQuotaId || suite.schemes.some(s => ['llm', 'hybrid'].includes(s.context.advice.mode) || ['llm', 'hybrid'].includes(s.context.snapshots.mode) ? !s.summaryModelId || s.summaryModelId === s.modelId : false))) throw new Error('Independent summary quota requires distinct quota IDs and summary model IDs');
  for (const s of suite.schemes) for (const [id, role] of [[s.modelId, 'initial'], [s.summaryModelId ?? s.modelId, 'summary']]) { const m = modelFor(suite, s, id, role); if (m.provider !== 'openai-compatible' || !m.maxTokens || !validateRates(normalizeRates(m.rates)) || m.rates.currency !== e.budget.currency || !m.credentialAlias) throw new Error('Live requires provider, finite maxTokens, complete matching rates and credential alias for every model'); }
}
function saveAtomic(filename, state, secrets) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = filename + '.tmp'; const { localWrite } = require('./durable.cjs'); localWrite(() => { const fd = fs.openSync(temp, 'w', 0o600); try { fs.writeFileSync(fd, JSON.stringify(scrub(state, secrets), null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp, filename); });
}
function loadCheckpoint(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function mockText(node) { return JSON.stringify({ task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: node.legalActions[0].tile, reasons: ['纯合成模拟：风险未知，仅用于验证执行流程。'] }, limitations: ['未调用真实模型。'] }); }
function normalizedInvalidText(text) {
  const value = text.replace(/\r\n/g, '\n').trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  try { return Core.canonicalStringify(JSON.parse(value)); } catch { /* Malformed JSON still gets lexical whitespace normalization. */ }
  let normalized = '', quoted = false, escaped = false;
  for (const character of value) {
    if (quoted) { normalized += character; if (escaped) escaped = false; else if (character.charCodeAt(0) === 92) escaped = true; else if (character === '"') quoted = false; }
    else if (character === '"') { quoted = true; normalized += character; }
    else if (!/\s/.test(character)) normalized += character;
  }
  return normalized;
}
function validateAnswer(text, context, node) { const answer = Analysis.parseResult(text, context.prepared); if (!node.legalActions.some(a => a.tile === answer.decision.tile)) { const error = new Error('Recommendation outside constrained legalActions'); error.validation = { code: 'constrained_legal_action', path: 'decision.tile' }; throw error; } return answer; }

async function runSuite(suite, options = {}) {
  const checkpoint = options.checkpoint ?? path.resolve('research/evidence/benchmark', suite.id, 'checkpoint.json');
  fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
  if (options.autonomousPolicy) { const release = require('./durable.cjs').acquireLock(checkpoint + '.lock', true); let shared; try { shared = options.budgetFile ? createSharedLedger({ filename: options.budgetFile, ...suite.execution.budget, trustedLiabilityContracts: deriveTrustedLiabilityContracts(suite.models), autonomous: true }) : null; return await runSuiteUnlocked(suite, { ...options, checkpoint, sharedLedger: shared }); } finally { shared?.close(); release(); } }
  const lockFile = checkpoint + '.lock', token = require('node:crypto').randomUUID(); let fd;
  try { fd = fs.openSync(lockFile, 'wx'); } catch (error) { if (error.code === 'EEXIST') { const locked = new Error('Checkpoint is locked; reconcile pending requests before manually removing a stale lock'); locked.code = 'BENCHMARK_LOCKED'; throw locked; } throw error; }
  try {
    fs.writeFileSync(fd, JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString() }));
    const shared = options.budgetFile ? createSharedLedger({ filename: options.budgetFile, ...suite.execution.budget, trustedLiabilityContracts: deriveTrustedLiabilityContracts(suite.models) }) : null;
    try { return await runSuiteUnlocked(suite, { ...options, checkpoint, sharedLedger: shared }); }
    finally { shared?.close(); }
  } finally {
    fs.closeSync(fd);
    try { if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).token === token) fs.unlinkSync(lockFile); } catch { /* Never remove an unfamiliar or damaged lock. */ }
  }
}
async function runSuiteUnlocked(suite, options = {}) {
  const mode = options.mode ?? 'mock';
  if (!['mock', 'live'].includes(mode)) throw new Error('Choose explicit mock or live mode');
  if (mode === 'live') livePreflight(suite);
  const expected = manifest(suite, mode), checkpoint = options.checkpoint ?? path.resolve('research/evidence/benchmark', suite.id, 'checkpoint.json');
  expected.authorizationHash = Core.stableHash(options.authorization ?? null);
  expected.fixedSourceHash = Core.stableHash(options.fixedMainAnswers ?? null);
  expected.seededBranchHash = Core.stableHash(options.seededBranches ?? null);
  expected.campaignKind = options.campaignKind ?? 'main';
  if (options.autonomousPolicy) expected.autonomousPolicyHash = Core.stableHash(options.autonomousPolicy);
  expected.fingerprint = Core.stableHash({ sourceFingerprint: expected.fingerprint, authorizationHash: expected.authorizationHash, fixedSourceHash: expected.fixedSourceHash, seededBranchHash: expected.seededBranchHash, campaignKind: expected.campaignKind, ...(options.autonomousPolicy ? { autonomousPolicyHash: expected.autonomousPolicyHash } : {}) });
  const runtime = options.autonomousPolicy ? require('./runtime.cjs').createRuntime(checkpoint, options.autonomousPolicy, suite.models) : null;
  const prior = options.resume ? (runtime?.prior ?? loadCheckpoint(checkpoint)) : null;
  if (!options.resume && fs.existsSync(checkpoint)) throw new Error('Checkpoint exists; use resume or a new output directory');
  if (prior && (prior.manifest.fingerprint !== expected.fingerprint || prior.manifest.mode !== mode)) throw new Error('Resume manifest mismatch (suite/source/model/parameters/authorization/seed)');
  if (!runtime && prior && (Object.values(prior.requests ?? {}).some(r => ['pending', 'unresolved'].includes(r.status)) || prior.ledger?.unknownLiability || prior.ledger?.reserved > 0 || prior.ledger?.blockedReason || prior.persistenceFailure)) throw new Error('Unresolved request, unknown paid liability or persistence failure: reconcile externally; automatic replay is disabled');
  const state = prior ?? { schemaVersion: 1, manifest: expected, status: 'running', results: [], histories: {}, frozen: {}, branches: {}, summaries: {}, requests: {}, auditSequence: 0, modelRequests: 0, toolCalls: 0 };
  if (runtime) state.runId ??= require('node:crypto').randomUUID();
  const secrets = [], ledger = options.sharedLedger ?? createLedger({ ...suite.execution.budget, initial: prior?.ledger, trustedLiabilityContracts: deriveTrustedLiabilityContracts(suite.models) });
  if (runtime && prior) { runtime.recover(ledger); if (state.persistenceFailure) { for (const [rid, r] of Object.entries(state.requests)) if (r.response?.text || runtime.hasResponse(rid)) { r.status = r.response?.text ? 'success' : 'recovering'; state.results = state.results.filter(result => result.id !== rid && result.id + ':review' !== rid); } state.results = state.results.filter(r => r.reason !== 'campaign-stopped-before-request'); }
    for (const [rid, r] of Object.entries(state.requests)) r.dispatchedModelRequests = Math.max(r.dispatchedModelRequests ?? 0, runtime.physicalCount(rid)); state.persistenceFailure = false; for (const r of Object.values(state.requests)) if (r.status === 'pending') r.status = 'recovering'; state.recoveries ??= []; state.recoveries.push({ at: new Date().toISOString(), downtimeMs: Math.max(0, Date.now() - Date.parse(runtime.log.events.at(-1).at)) }); }
  if (runtime && prior) { for (const r of Object.values(state.requests)) if (r.frozenInput) freezeTree(r.frozenInput); for (const entries of Object.values(state.histories)) entries.forEach(freezeTree); for (const frozen of Object.values(state.frozen)) if (frozen.history) freezeTree(frozen.history); }
  const resolver = mode === 'live' ? (options.credentialResolver ?? createCredentialResolver({ credentialsFile: options.credentialsFile, authorization: options.authorization })) : null;
  const credentialResolver = resolver ? async alias => { const key = await resolver(alias); if (!secrets.includes(key)) secrets.push(key); return key; } : null;
  const builders = new Map(suite.schemes.map(s => [s.id, Context.loadContextBuilder(s, { baseDir: suite.baseDir })]));
  const tasks = new Set(), deferred = new Map();
  let foregroundRequests = 0, summaryRequests = 0;
  const done = new Map(state.results.map(r => [r.id, r]));
  state.foregroundComplete = false;
  let lastCheckpointResults = 0, lastCheckpointAt = Date.now();
  function persist(event) {
    try {
      state.ledger = ledger.snapshot(); state.auditSequence++;
      runtime?.log.write('state', { event, state: scrub(state, secrets) });
      if (!runtime || ['run-start', 'run-final'].includes(event) || state.results.length - lastCheckpointResults >= 25 || Date.now() - lastCheckpointAt >= 10000) { saveAtomic(checkpoint, state, secrets); lastCheckpointResults = state.results.length; lastCheckpointAt = Date.now(); }
      if (runtime && ['decision-final', 'qa-final', 'run-final'].includes(event)) { try { options.onProgress?.(state); } catch { state.reviewExportPending = true; } }
      fs.appendFileSync(path.join(path.dirname(checkpoint), 'audit.jsonl'), JSON.stringify(scrub({ sequence: state.auditSequence, event, status: state.status }, secrets)) + '\n');
    } catch (error) { state.persistenceFailure = true; throw error; }
  }
  const transportFactory = options.transportFactory ?? createTransport;
  async function call({ id, role, scheme, modelId, context, node, messages, text, analysisJson = false, deadlineAt = performance.now() + suite.execution.timeoutMs, channel = role === 'summary' ? 'summary' : 'realtime' }) {
    if (state.requests[id]?.status === 'success') return state.requests[id].response;
    if (state.requests[id]?.status === 'pending') throw new Error('Unresolved request cannot be replayed');
    if (ledger.snapshot().unknownLiability || ledger.snapshot().blockedReason || state.persistenceFailure) throw new Error('Unknown liability or persistence failure');
    const e = suite.execution, minimumHttpRemainingMs = Math.min(5000, e.timeoutMs / 10);
    function deadlineAdmission() {
      if (deadlineAt - performance.now() < minimumHttpRemainingMs) { state.requests[id].termination = { reason: 'insufficient_deadline_budget', minimumHttpRemainingMs }; throw admission('Insufficient remaining logical deadline for another HTTP'); }
    }
    const remainingModels = e.maxModelRequests == null ? null : e.maxModelRequests - state.modelRequests;
    const remainingTools = e.maxToolCalls == null ? null : e.maxToolCalls - state.toolCalls;
    if (remainingModels !== null && remainingModels < 1) throw new Error('Campaign request limit exhausted');
    const previousRequest = state.requests[id];
    const originalInput = runtime ? previousRequest?.frozenInput : null;
    const submittedAt = originalInput ? previousRequest.submittedAt : new Date().toISOString();
    const deadlineWallAt = originalInput ? previousRequest.deadlineWallAt : Date.now() + Math.max(0, deadlineAt - performance.now());
    const model = modelFor(suite, scheme, modelId, role);
    const durableTransport = runtime?.transport(ledger, persist, deadlineWallAt);
    const transport = transportFactory({ model, mode: mode === 'live' ? 'real' : 'mock', ledger, credentialResolver, fetch: options.fetch, ...(runtime ? { runIdentity: state.runId } : {}), ...(durableTransport ?? {}),
      beforeRequest: ({ requestBody }) => {
        deadlineAdmission();
        if (e.maxModelRequests !== null && state.modelRequests >= e.maxModelRequests) throw admission('Campaign request limit exhausted');
        if (role === 'summary' && !state.foregroundComplete && e.maxModelRequests !== null && e.maxModelRequests - state.modelRequests <= 1) throw admission('Last request reserved for foreground');
        if (role === 'summary') {
          if (!state.foregroundComplete && suite.execution.backgroundPolicy === 'shared-quota' && (ledger.snapshot().budgetCommitted ?? ledger.snapshot().estimatedCost + ledger.snapshot().reserved) + Math.max(options.foregroundReserve ?? 0, state.foregroundReserve ?? 0) > suite.execution.budget.cap) throw admission('Summary deferred to protect foreground budget reserve');
          summaryRequests++;
        } else foregroundRequests++;
        state.contention ??= []; state.contention.push({ requestId: id, role, concurrentForeground: foregroundRequests - (role === 'summary' ? 0 : 1), concurrentSummary: summaryRequests - (role === 'summary' ? 1 : 0), sharedQuota: suite.execution.backgroundPolicy === 'shared-quota' });
        state.modelRequests++; state.requests[id].modelRequests++; persist('http-pending');
        try { fs.appendFileSync(path.join(path.dirname(checkpoint), 'requests.private.jsonl'), JSON.stringify(scrub({ requestId: id, modelRequest: state.modelRequests, role, channel, repeat: Number(id.split(':')[0]), schemeId: scheme.id, modelId, body: requestBody ?? { messages: messages ?? context?.messages, evidenceLimitation: 'Transport did not supply exact wire body' } }, secrets)) + '\n'); } catch (error) { state.persistenceFailure = true; throw error; }
      }, onAttempt: ({ attempt, responseMessage }) => {
        if (runtime && attempt.replayed) return;
        durableTransport?.recordFinal({ attempt, responseMessage });
        if (role === 'summary') summaryRequests = Math.max(0, summaryRequests - 1); else foregroundRequests = Math.max(0, foregroundRequests - 1);
        if (attempt.dispatched) state.requests[id].dispatchedModelRequests++;
        if (attempt.simulated) state.requests[id].simulatedModelRequests++;
        try { fs.appendFileSync(path.join(path.dirname(checkpoint), 'responses.private.jsonl'), JSON.stringify(scrub({ requestId: id, role, channel, attempt, responseMessage }, secrets)) + '\n'); } catch (error) { state.persistenceFailure = true; throw error; }
        persist('http-final');
      } });
    state.requests[id] = { status: 'pending', ...(runtime ? { frozenInput: originalInput ?? freezeTree(scrub({ messages: messages ?? context?.messages, prepared: context?.prepared, events: context?.events ?? [], snapshot: context?.snapshot ?? node.snapshot, node, analysisJson }, secrets)) } : {}), role, channel, repeat: Number(id.split(':')[0]), schemeId: scheme.id, decisionId: node.id, modelId, modelRequests: originalInput ? previousRequest.modelRequests : 0, dispatchedModelRequests: originalInput ? previousRequest.dispatchedModelRequests : 0, simulatedModelRequests: originalInput ? previousRequest.simulatedModelRequests : 0, toolCalls: originalInput ? previousRequest.toolCalls : 0, submittedAt, ...(runtime ? { deadlineWallAt, recoveryOutsideDeadline: !!originalInput && Date.now() > deadlineWallAt } : {}) }; persist('request-pending');
    try {
      const tools = context && remainingTools !== 0 ? (context.tools ?? createTools({ ...context, node })).map(tool => ({ ...tool, execute: async (...args) => {
        if (e.maxToolCalls !== null && state.toolCalls >= e.maxToolCalls) throw new Error('Campaign tool limit exhausted');
        state.toolCalls++; state.requests[id].toolCalls++; persist('tool-pending'); return tool.execute(...args);
      } })) : [];
      const beganCall = performance.now();
      let response, requestMessages = originalInput?.messages ?? messages ?? context.messages;
      state.requests[id].validationAttempts = [];
      let logicalRounds = 0;
      const invalidSeen = new Map();
      function validationStats(validated = false) { return { firstPassValid: state.requests[id].validationAttempts.length ? state.requests[id].validationAttempts[0].valid : null, repairRounds: Math.max(0, logicalRounds - 1), validated }; }
      while (true) {
        const remainingMs = deadlineAt - performance.now();
        deadlineAdmission();
        logicalRounds++;
        if (analysisJson) state.requests[id].validation = validationStats();
        response = await transport.runModel({ messages: requestMessages, prepared: context?.prepared, tools, meta: { ...(runtime ? { runId: state.runId, qualifiedJobId: state.runId + ':' + id } : {}), requestId: id, role, channel, schemeId: scheme.id, decisionId: node.id, roundId: node.roundId, sessionId: node.sessionId, repeat: Number(id.split(':')[0]), campaignKind: options.campaignKind ?? (Number(id.split(':')[0]) ? 'repeat' : 'first'), endpoint: model.endpoint ?? null, credentialAlias: model.credentialAlias ?? null, keyAlias: model.credentialAlias ?? null, modelId, modelVersion: model.model ?? modelId, repairRound: state.requests[id].validationAttempts.length }, maxModelRequests: e.maxModelRequests == null ? null : e.maxModelRequests - state.modelRequests, maxToolCalls: e.maxToolCalls == null ? null : e.maxToolCalls - state.toolCalls, analysisJson, timeoutMs: remainingMs, mockText: text });
        if (!analysisJson) break;
        let invalid;
        try { validateAnswer(response.text, context, node); }
        catch (error) {
          if (error.validation) invalid = error.validation;
          else if (error.message === '模型分析结果不是有效 JSON。') invalid = { code: 'invalid_json', path: 'result' };
          else throw error;
        }
        state.requests[id].validationAttempts.push({ text: response.text, valid: !invalid, ...(invalid ? { validation: invalid } : {}), elapsedMs: performance.now() - beganCall, attemptCount: transport.attempts.length });
        state.requests[id].validation = validationStats(!invalid && performance.now() < deadlineAt);
        if (invalid) {
          const invalidHash = Core.stableHash({ normalizedText: normalizedInvalidText(response.text), validation: invalid });
          state.requests[id].validationAttempts.at(-1).invalidHash = invalidHash;
          if (invalidSeen.has(invalidHash)) {
            state.requests[id].termination = { reason: 'deterministic_no_progress', invalidHash, validation: invalid, duplicateOf: invalidSeen.get(invalidHash) };
            persist('strict-validation-no-progress');
            throw new Error('Repeated identical invalid answer and validation error; deterministic no progress');
          }
          invalidSeen.set(invalidHash, state.requests[id].validationAttempts.length - 1);
        }
        persist(invalid ? 'strict-validation-invalid' : 'strict-validation-valid');
        if (!invalid) {
          if (performance.now() >= deadlineAt) throw new Error('Logical deadline exhausted before validated final');
          break;
        }
        // Keep the real invalid draft in this logical request only; never clean it locally.
        // Transport's returned messages retain the exact preceding tool exchanges.
        requestMessages = [...(response.messages ?? [...requestMessages, { role: 'assistant', content: response.text }]), { role: 'user', content: '上一个回答未通过本地严格校验。请依据本次已授权冻结事实重新输出完整JSON，修正下列code/path；不要增加字段，也不要说明校验过程。原始回答保留在上文，不视为事实。\n' + JSON.stringify({ validation: invalid, schema: context.prepared.responseSchema, outputConstraints: context.prepared.data.outputConstraints }) }];
      }
      const validation = analysisJson ? validationStats(true) : undefined;
      response = { ...response, latencyMs: performance.now() - beganCall, ...(validation ? { validation } : {}) };
      state.requests[id] = { ...state.requests[id], status: 'success', response: scrub({ text: response.text, latencyMs: response.latencyMs, usage: response.usage, usageByAttempt: transport.attempts.map(a => a.usage), cost: transport.attempts.some(a => a.cost === null) ? null : transport.attempts.reduce((sum, a) => sum + (a.cost ?? 0), 0), attempts: transport.attempts, ...(response.validation ? { validation: response.validation } : {}) }, secrets) }; persist('request-success');
      return state.requests[id].response;
    } catch (error) {
      state.requests[id] = { ...state.requests[id], status: ledger.snapshot().unknownLiability ? 'unresolved' : 'failed', error: 'Request failed; inspect private provider/accounting evidence', attempts: scrub(transport.attempts, secrets) }; if (runtime && error.fault === 'budget') state.stopReason = 'budget'; if (runtime && ['authentication', 'configuration'].includes(error.fault)) { state.disabledSchemes ??= {}; state.disabledSchemes[scheme.id] = error.fault; } persist('request-failed'); throw error;
    }
  }
  function summaryJobs(jobs, job, key) {
    for (const descriptor of jobs) {
      const id = `${key}:${descriptor.id}`;
      if (state.summaries[id]) continue;
      state.summaries[id] = { ...descriptor, id: descriptor.id, storageId: id, originDecisionId: job.node.id, status: 'deferred', reason: 'foreground-priority' };
      deferred.set(id, { descriptor, job });
    }
    pump();
  }
  function pump(flush = false) {
    // A credential alias is not evidence of an independent provider quota. Until a
    // quota contract exists, paid summaries yield every foreground request slot.
    const capacity = flush ? Math.max(1, suite.execution.concurrency - 1) : mode === 'live' && !['independent-quota', 'shared-quota'].includes(suite.execution.backgroundPolicy) ? 0 : suite.execution.backgroundPolicy === 'shared-quota' ? Math.min(1, Math.max(0, suite.execution.concurrency - 1)) : Math.max(0, suite.execution.concurrency - 1);
    while (tasks.size < capacity && deferred.size) {
      const [id, pending] = deferred.entries().next().value; deferred.delete(id);
      const { descriptor: d, job } = pending;
      const task = (async () => {
        state.summaries[id].status = 'pending';
        try {
          const response = await call({ id, role: 'summary', scheme: job.scheme, modelId: job.scheme.summaryModelId ?? job.scheme.modelId, node: job.node, messages: d.messages, text: d.mockText ?? '合成摘要：保留来源时点；历史建议是模型意见，风险未知。' });
          if (d.outputSchema) require('./discussion-policies.cjs').validateTypedSummary(response.text, d);
          Object.assign(state.summaries[id], { status: state.foregroundComplete ? 'late-unused' : 'ready', text: response.text, reason: state.foregroundComplete ? 'no-remaining-foreground-consumer' : null });
        } catch { Object.assign(state.summaries[id], { status: 'discarded', reason: ledger.snapshot().unknownLiability ? 'unknown-liability' : 'request-failed' }); }
        persist('summary-final');
      })();
      tasks.add(task); task.then(() => tasks.delete(task), () => { state.persistenceFailure = true; tasks.delete(task); });
    }
  }
  function summariesFor(key) { return Object.entries(state.summaries).filter(([id, s]) => id.startsWith(key + ':') && s.status === 'ready').map(([, s]) => s); }
  function contextFor(job, key, extra = {}) { return builders.get(job.scheme.id)({ scheme: job.scheme, node: job.node, events: job.round.events, history: state.histories[key] ?? [], summary: summariesFor(key), channel: 'realtime', ...extra }); }
  if (prior) for (const [id, summary] of Object.entries(state.summaries)) {
    if (summary.status === 'pending' && state.requests[id]?.status === 'success') { summary.text = state.requests[id].response.text; summary.status = 'ready'; }
    if (summary.status === 'deferred' || runtime && summary.status === 'pending') {
      const job = planSuite(suite).find(j => id.startsWith(historyKey(j.repeat, j.scheme.id) + ':') && j.node.id === summary.originDecisionId && j.node.roundId === summary.scope.roundId);
      if (job) deferred.set(id, { descriptor: summary, job });
    }
  }
  persist('run-start');
  for (const job of planSuite(suite)) {
    if (ledger.snapshot().unknownLiability || ledger.snapshot().blockedReason || state.persistenceFailure) break;
    if (runtime && (state.stopReason || state.disabledSchemes?.[job.scheme.id])) continue;
    const { scheme, node, repeat } = job, key = historyKey(repeat, scheme.id), id = `${key}:${component(node.id)}:main`;
    const began = performance.now();
    let result = done.get(id);
    if (!result) {
      const frozenHistory = structuredClone(state.histories[key] ?? []);
      state.frozen[id] ??= { history: runtime ? freezeTree(frozenHistory) : frozenHistory, summary: structuredClone(summariesFor(key)) };
      let context;
      try {
        context = contextFor(job, key);
        const foregroundModel = modelFor(suite, scheme, scheme.modelId, 'initial'), rates = normalizeRates(foregroundModel.rates);
        if (rates) {
          if (foregroundModel.pricingSchedule) for (const field of ['cachedInput', 'uncachedInput', 'output']) rates[field] = Math.max(rates[field], foregroundModel.pricingSchedule.peak[field], foregroundModel.pricingSchedule.offPeak[field]);
          const inputReserve = foregroundModel.liabilityBound?.inputTokens ?? (Buffer.byteLength(JSON.stringify(context.messages), 'utf8') * 2 + 8192);
          const outputReserve = foregroundModel.liabilityBound?.outputTokens ?? foregroundModel.maxTokens ?? 8192;
          state.foregroundReserve = Math.max(state.foregroundReserve ?? 0, (inputReserve * Math.max(rates.cachedInput, rates.uncachedInput) + outputReserve * rates.output) / 1e6);
        }
        summaryJobs(context.summaryJobs, job, key);
        const sourceMessages = JSON.stringify(context.messages);
        for (const [summaryId, summary] of Object.entries(state.summaries)) if (summaryId.startsWith(key + ':') && summary.status === 'ready' && sourceMessages.includes(summary.sourceHash)) summary.consumedBy = [...new Set([...(summary.consumedBy ?? []), id])];
        const sourceAnswer = options.fixedMainAnswers?.[node.id];
        if (context.requireFixedMainSource && !sourceAnswer) throw new Error('This controlled stage requires the fixed actual shared original answer, not a new main generation');
        const response = sourceAnswer ? { text: typeof sourceAnswer === 'string' ? sourceAnswer : JSON.stringify(sourceAnswer), latencyMs: 0, sourceFixture: true } : await call({ id, role: repeat ? 'repeat' : 'initial', scheme, modelId: scheme.modelId, context, node, text: mockText(node), analysisJson: true, deadlineAt: began + suite.execution.timeoutMs });
        let validation = response.validation, answer = validateAnswer(response.text, context, node), finalAnswerText = response.text, requestLatency = response.latencyMs ?? 0;
        if (scheme.review) {
          const review = await call({ id: id + ':review', role: 'review', scheme, modelId: scheme.modelId, context, node, messages: [...context.messages, { role: 'user', content: '独立复核以下有来源的草案；仅用本次冻结事实与工具重新判断，可保留或修改，输出完整JSON：\n' + JSON.stringify({ draft: answer, sourceDecisionId: node.id, sourcePosition: node.position, sourceSnapshotHash: Core.stableHash(node.snapshot), meaning: 'unverified model draft; not fact' }) }], text: mockText(node), analysisJson: true, deadlineAt: began + suite.execution.timeoutMs });
          validation = { firstPassValid: validation?.firstPassValid === true && review.validation?.firstPassValid === true, repairRounds: (validation?.repairRounds ?? 0) + (review.validation?.repairRounds ?? 0), initial: validation, review: review.validation, validated: true };
          answer = validateAnswer(review.text, context, node);
          finalAnswerText = review.text;
          requestLatency += review.latencyMs ?? 0;
        }
        result = { id, repeat, schemeId: scheme.id, decisionId: node.id, roundId: node.roundId, channel: 'main', status: 'success', answer, ...(validation ? { validation } : {}), latencyMs: Math.max(performance.now() - began, requestLatency), ...(sourceAnswer ? { statisticalRole: 'frozen-source-fixture-not-new-model-result', sourceFixture: true } : {}), compression: context.compression, sourceDecisionIds: context.sourceDecisionIds };
        state.histories[key] ??= [];
        state.histories[key].push((runtime ? freezeTree : x => x)({ decisionId: node.id, position: node.position, roundId: node.roundId, sessionId: node.sessionId, authorization: node.authorization, snapshot: node.snapshot, answer, request: context.messages.filter(m => m.role === 'user').at(-1).content, answerText: finalAnswerText, ...(context.historyPolicy ? { historyPolicy: context.historyPolicy } : {}) }));
        state.frozen[id].answer = answer;
      } catch { result = { id, repeat, schemeId: scheme.id, decisionId: node.id, roundId: node.roundId, channel: 'main', status: 'failed', error: 'Request or final validation failed', validation: { initial: state.requests[id]?.validation ?? null, review: state.requests[id + ':review']?.validation ?? null }, latencyMs: performance.now() - began }; }
      state.results.push(result); done.set(id, result); persist('decision-final');
    }
    if (result.status !== 'success') {
      const blocked = node.followups.map(q => ({ ...q, channel: 'branch' }));
      for (const q of blocked) { const qid = `${key}:${component(node.id)}:${q.channel}:${component(q.id)}`; if (!done.has(qid)) { const row = { id: qid, repeat, schemeId: scheme.id, decisionId: node.id, questionId: q.id, channel: q.channel, status: 'blocked', reason: 'main-answer-unavailable' }; state.results.push(row); done.set(qid, row); } }
      persist('qa-blocked');
    }
    const frozen = state.frozen[id] ?? { history: state.histories[key] ?? [], summary: [] };
    const questions = [...(result.status === 'success' ? node.followups : []), ...(job.round.globalTasks ?? []).filter(t => t.nodeId === node.id).map(t => ({ ...t, channel: 'global-analysis' }))];
    for (const question of questions) {
      if (ledger.snapshot().unknownLiability) break;
      const qid = `${key}:${component(node.id)}:${question.channel === 'global-analysis' ? 'global' : 'branch'}:${component(question.id)}`;
      if (done.has(qid)) continue;
      const start = performance.now(), branchKey = `${key}:${component(node.id)}`;
      if (!state.branches[branchKey] && options.seededBranches?.[node.id]) {
        const seeded = structuredClone(options.seededBranches[node.id]);
        if (seeded.some(p => p.decisionId !== node.id || p.position !== node.position || p.roundId !== node.roundId || p.sessionId !== node.sessionId || Core.stableHash(p.authorization) !== Core.stableHash(node.authorization) || typeof p.question !== 'string' || typeof p.answer !== 'string')) throw new Error('Seeded branch must contain only source-bound frozen same-decision QA');
        state.branches[branchKey] = seeded.map(p => ({ ...p, branchId: branchKey, sourceRole: 'shared frozen controlled source, separately billed' })); persist('branch-source-seeded');
      }
      let qa;
      try {
        const context = contextFor(job, key, { history: frozen.history, summary: [...frozen.summary, ...summariesFor(key)], channel: question.channel === 'global-analysis' ? 'global-analysis' : 'decision-discussion', question: question.question, ...(question.channel === 'global-analysis' ? { globalHistory: state.globalConversations?.[branchKey] ?? [] } : { originalAnswer: frozen.answer, branchHistory: state.branches[branchKey] ?? [], branchId: branchKey }) });
        summaryJobs(context.summaryJobs, job, key);
        const qaMessages = JSON.stringify(context.messages);
        for (const [summaryId, summary] of Object.entries(state.summaries)) if (summaryId.startsWith(key + ':') && summary.status === 'ready' && qaMessages.includes(summary.sourceHash)) summary.consumedBy = [...new Set([...(summary.consumedBy ?? []), qid])];
        const response = await call({ id: qid, role: 'followup', channel: question.channel === 'global-analysis' ? 'global-analysis' : 'decision-discussion', scheme, modelId: scheme.modelId, context, node, text: context.qaResponseFormat === 'analysis-json' ? mockText(node) : '纯合成追问回复：只解释冻结决策，不引入后续信息。', analysisJson: context.qaResponseFormat === 'analysis-json', deadlineAt: start + suite.execution.timeoutMs });
        if (typeof response.text !== 'string' || !response.text.trim()) throw new Error('Empty QA response');
        const qaAnswer = context.qaResponseFormat === 'analysis-json' ? validateAnswer(response.text, context, node) : undefined;
        qa = { id: qid, repeat, schemeId: scheme.id, decisionId: node.id, questionId: question.id, channel: question.channel === 'global-analysis' ? 'global' : 'branch', status: 'success', text: response.text, ...(response.validation ? { validation: response.validation } : {}), ...(qaAnswer ? { answer: qaAnswer } : {}), latencyMs: performance.now() - start, sourceDecisionIds: context.sourceDecisionIds, compression: context.compression, ...(context.historyPolicy ? { historyPolicy: context.historyPolicy } : {}) };
        if (question.channel !== 'global-analysis') { state.branches[branchKey] ??= []; state.branches[branchKey].push({ decisionId: node.id, position: node.position, roundId: node.roundId, sessionId: node.sessionId, authorization: node.authorization, branchId: branchKey, question: question.question, answer: response.text }); }
        else { state.globalConversations ??= {}; state.globalConversations[branchKey] ??= []; state.globalConversations[branchKey].push({ id: question.id, question: question.question, answer: response.text, scopeHash: context.scopeHash ?? null }); }
      } catch { qa = { id: qid, repeat, schemeId: scheme.id, decisionId: node.id, questionId: question.id, channel: question.channel === 'global-analysis' ? 'global' : 'branch', status: 'failed', ...(state.requests[qid]?.validation ? { validation: state.requests[qid].validation } : {}), latencyMs: performance.now() - start }; }
      state.results.push(qa); done.set(qid, qa); persist('qa-final');
    }
    if (runtime && state.requests[id]?.recoveryOutsideDeadline) { result.recoveryOutsideDeadline = true; result.statisticalRole = 'recovered-delivery-outside-original-realtime-deadline'; }
    /* FROZEN_CACHE_GC_START */
    // A frozen copy is needed only until this node's planned questions terminate.
    // Original answers remain in immutable successful histories/results/branches.
    const questionIds = [...node.followups.map(q => `${key}:${component(node.id)}:branch:${component(q.id)}`), ...(job.round.globalTasks ?? []).filter(q => q.nodeId === node.id).map(q => `${key}:${component(node.id)}:global:${component(q.id)}`)];
    if (state.frozen[id] && questionIds.every(qid => done.has(qid))) {
      delete state.frozen[id];
      persist('frozen-cache-released');
    }
    /* FROZEN_CACHE_GC_END */
    pump();
  }
  for (const job of planSuite(suite)) {
    const key = `${historyKey(job.repeat, job.scheme.id)}:${component(job.node.id)}`;
    const planned = [{ id: `${key}:main`, channel: 'main' }, ...job.node.followups.map(q => ({ id: `${key}:branch:${component(q.id)}`, questionId: q.id, channel: 'branch' })), ...(job.round.globalTasks ?? []).filter(q => q.nodeId === job.node.id).map(q => ({ id: `${key}:global:${component(q.id)}`, questionId: q.id, channel: 'global' }))];
    for (const p of planned) if (!done.has(p.id)) { const row = { ...p, repeat: job.repeat, schemeId: job.scheme.id, decisionId: job.node.id, status: 'blocked', reason: runtime ? state.stopReason === 'budget' ? 'blocked-budget' : state.disabledSchemes?.[job.scheme.id] ? 'blocked-config' : 'campaign-stopped-before-request' : 'campaign-stopped-before-request' }; state.results.push(row); done.set(p.id, row); }
  }
  state.foregroundComplete = true;
  while (tasks.size || deferred.size) { pump(true); await Promise.allSettled([...tasks]); }
  for (const summary of Object.values(state.summaries)) if (summary.status === 'ready' && !summary.consumedBy?.length) { summary.status = 'late-unused'; summary.reason = 'no-foreground-consumer'; }
  for (const alias of suite.schemes.filter(s => s.aliasOf)) for (const original of state.results.filter(r => r.schemeId === alias.aliasOf)) {
    const id = `alias:${component(alias.id)}:${original.id}`;
    if (!done.has(id)) { const row = { ...structuredClone(original), id, schemeId: alias.id, canonicalSchemeId: alias.aliasOf, canonicalResultId: original.id, statisticalRole: 'alias-no-independent-sample', billedSeparately: false }; state.results.push(row); done.set(id, row); }
  }
  if (runtime && options.autonomousPolicy.supplemental && !ledger.snapshot().unknownLiability && !state.persistenceFailure) {
    state.supplemental ??= [];
    for (const [originalRequestId, original] of Object.entries({ ...state.requests })) {
      if (!['failed', 'unresolved'].includes(original.status) || !original.frozenInput || original.role === 'summary' || original.role === 'supplemental' || state.supplemental.some(r => r.originalRequestId === originalRequestId)) continue;
      if (!original.attempts?.length || !original.attempts.some(a => options.autonomousPolicy.categories.includes(a.fault))) continue;
      const input = original.frozenInput, scheme = suite.schemes.find(s => s.id === original.schemeId), supplementalId = originalRequestId + ':supplemental';
      const beforeHistoryHash = Core.stableHash(state.histories), started = performance.now();
      let row = { originalRequestId, id: supplementalId, schemeId: scheme.id, channel: original.channel, decisionId: original.decisionId, frozenInputHash: Core.stableHash(input), statisticalRole: 'supplemental-never-replaces-original', status: 'failed' };
      try {
        const response = await call({ id: supplementalId, role: 'supplemental', scheme, modelId: original.modelId ?? scheme.modelId, context: { ...input, summaryJobs: [] }, node: input.node, messages: input.messages, analysisJson: input.analysisJson, channel: original.channel, text: input.analysisJson ? mockText(input.node) : 'SYNTHETIC supplemental response' });
        row = { ...row, status: 'success', text: response.text, latencyMs: performance.now() - started };
      } catch { row.latencyMs = performance.now() - started; }
      if (Core.stableHash(state.histories) !== beforeHistoryHash) throw new Error('Supplemental history isolation violated');
      state.supplemental.push(row); persist('supplemental-final');
      if (ledger.snapshot().unknownLiability || ledger.snapshot().blockedReason || state.persistenceFailure) break;
    }
  }
  state.validationReport = Object.values(state.requests).filter(r => r.validation).map(r => ({ schemeId: r.schemeId, decisionId: r.decisionId, role: r.role, channel: r.channel, ...r.validation, ...(r.termination ? { termination: r.termination } : {}) }));
  state.status = runtime && state.stopReason === 'budget' ? 'blocked-budget' : runtime && state.results.some(r => r.status === 'blocked' && r.reason === 'blocked-config') ? 'blocked-config' : runtime && !ledger.snapshot().unknownLiability && !state.persistenceFailure && state.results.some(r => r.status !== 'success') ? 'finished-with-failures' : ledger.snapshot().unknownLiability ? 'stopped-unknown-liability' : ledger.snapshot().blockedReason || state.persistenceFailure ? 'stopped-persistence-failure' : 'complete'; persist('run-final');
  return state;
}
module.exports = { runSuite, dryRun, planSuite, fingerprint, manifest, livePreflight, loadCheckpoint, saveAtomic, scrub, validateAnswer, normalizedInvalidText };
