'use strict';
const path = require('node:path');
const { stableHash } = require('./core.cjs');
const { normalizeUsage, deriveTrustedLiabilityContracts } = require('./accounting.cjs');
const crypto = require('node:crypto');
const { journal } = require('./durable.cjs');
function validatePolicy(raw = {}) {
  const defaults = { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000, maxWaitMs: 120000, jitter: .2, httpTimeoutMs: 60000, categories: ['pre-dispatch', 'rate-limit', 'service', 'network', 'timeout'], unknownCost: 'block', circuitFailures: 3, circuitDelayMs: 30000, maxRestarts: 2, restartDelayMs: 1000, maxRecoveryWaitMs: 86400000, reviewConcurrency: 2, reviewRetries: 1, supplemental: false, liabilityContracts: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !Object.hasOwn(defaults, k))) throw new Error('Unknown autonomous policy field');
  const value = { ...defaults, ...raw };
  for (const field of ['maxRetries', 'baseDelayMs', 'maxDelayMs', 'maxWaitMs', 'httpTimeoutMs', 'circuitFailures', 'circuitDelayMs', 'maxRestarts', 'restartDelayMs', 'maxRecoveryWaitMs', 'reviewConcurrency', 'reviewRetries']) if (!Number.isSafeInteger(value[field]) || value[field] < (['httpTimeoutMs', 'reviewConcurrency', 'circuitFailures'].includes(field) ? 1 : 0)) throw new Error('Invalid policy ' + field);
  if (!Number.isFinite(value.jitter) || value.jitter < 0 || value.jitter > 1 || !['block', 'contract-hold'].includes(value.unknownCost) || typeof value.supplemental !== 'boolean' || !Array.isArray(value.categories) || value.categories.some(k => !defaults.categories.includes(k))) throw new Error('Invalid retry/hold policy');
  if (!Array.isArray(value.liabilityContracts)) throw new Error('liabilityContracts must be an array');
  const seen = new Set(); for (const contract of value.liabilityContracts) { validateLiabilityProof(contract); const hash = stableHash(contract); if (seen.has(hash)) throw new Error('Duplicate liability proof'); seen.add(hash); }
  if (value.unknownCost === 'contract-hold' && !value.liabilityContracts.length) throw new Error('Automatic holds require complete verified frozen liability proofs');
  return value;
}
function validateLiabilityProof(proof) {
  const allowed = ['provider', 'endpoint', 'model', 'modelId', 'inputTokens', 'outputTokens', 'rates', 'currency', 'additionalCharges', 'attestation'];
  if (!proof || Object.keys(proof).some(k => !allowed.includes(k)) || allowed.some(k => !Object.hasOwn(proof, k)) || !proof.provider || !proof.model || !proof.modelId || !Number.isSafeInteger(proof.inputTokens) || proof.inputTokens < 1 || !Number.isSafeInteger(proof.outputTokens) || proof.outputTokens < 1 || !['CNY', 'USD'].includes(proof.currency) || proof.additionalCharges !== 'none') throw new Error('Incomplete full-context liability proof');
  const url = new URL(proof.endpoint); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid liability proof endpoint');
  if (!proof.rates || Object.keys(proof.rates).sort().join(',') !== 'cachedInput,output,uncachedInput' || Object.values(proof.rates).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Proof must state all maximum per-million rates');
  const a = proof.attestation;
  if (!a || Object.keys(a).sort().join(',') !== 'evidenceSha256,evidenceText,sourceUrl,verifiedAt,verifiedBy' || typeof a.verifiedBy !== 'string' || !a.verifiedBy || !Number.isFinite(Date.parse(a.verifiedAt)) || typeof a.evidenceText !== 'string' || !a.evidenceText || !/^https:\/\//.test(a.sourceUrl) || crypto.createHash('sha256').update(a.evidenceText).digest('hex') !== a.evidenceSha256) throw new Error('Liability proof requires hash-bound source evidence and explicit verification attestation');
  return proof;
}
function validateModelProofs(models, policy) {
  if (policy.unknownCost !== 'contract-hold') return;
  for (const contract of deriveTrustedLiabilityContracts(models)) {
    const proof = policy.liabilityContracts.find(p => stableHash(p) === contract.contractHash);
    if (!proof || proof.modelId !== contract.modelId || proof.model !== contract.model || proof.endpoint !== contract.endpoint || proof.inputTokens !== contract.inputTokens || proof.outputTokens !== contract.outputTokens || proof.currency !== contract.currency || ['cachedInput', 'uncachedInput', 'output'].some(k => proof.rates[k] < contract.rates[k])) throw new Error('Model liability ceiling/hash does not match a frozen verified proof');
  }
  if (Object.values(models).some(m => m.provider === 'openai-compatible' && !m.liabilityBound)) throw new Error('Every paid model requires full liability proof when automatic holds are enabled');
}
function automaticHolds(ledger, models, policy) {
  if (policy.unknownCost !== 'contract-hold') return;
  validateModelProofs(models, policy);
  const contracts = deriveTrustedLiabilityContracts(models), snapshot = ledger.snapshot();
  for (let index = 0; index < snapshot.records.length; index++) {
    const record = snapshot.records[index];
    if (record.cost !== null || snapshot.conservativeHolds.some(h => h.recordIndex === index)) continue;
    const contract = contracts.find(c => c.modelId === record.meta?.modelId && c.model === record.meta?.modelVersion && c.endpoint === record.meta?.endpoint && c.contractHash === record.meta?.liabilityBound?.contractHash);
    if (!contract) throw new Error('Unknown cost has no matching frozen complete liability contract');
    const amount = (contract.inputTokens * Math.max(contract.rates.cachedInput, contract.rates.uncachedInput) + contract.outputTokens * contract.rates.output) / 1e6;
    ledger.addConservativeHold({ recordIndex: index, recordHash: stableHash(record), contractHash: contract.contractHash, currency: contract.currency, amount, approved: true, reviewId: 'frozen-automatic:' + policy.policyHash });
  }
}
function createRuntime(checkpoint, policy, models) {
  validateModelProofs(models, policy);
  const log = journal(path.join(path.dirname(checkpoint), 'events.jsonl'));
  const responses = new Map(), dispatches = new Map(), finals = new Map();
  for (const event of log.events) {
    if (event.kind === 'response') responses.set(event.payload.attempt.attemptId, event.payload);
    if (event.kind === 'dispatch') dispatches.set(event.payload.attempt.attemptId, event.payload);
    if (event.kind === 'attempt-final') finals.set(event.payload.attempt.attemptId, event.payload);
  }
  const prior = log.latestState();
  if (prior && Date.now() - Date.parse(log.events.at(-1).at) > policy.maxRecoveryWaitMs) throw new Error('Frozen maximum recovery wait exceeded');
  let consecutive = 0, circuitUntil = 0; for (const event of log.events) { if (event.kind === 'attempt-final') consecutive = event.payload.attempt.status === 'success' ? 0 : consecutive + 1; if (event.kind === 'circuit-open') circuitUntil = event.payload.until; }
  return { log, prior, hasResponse(requestId) { return [...responses.values()].some(e => e.attempt.requestId === requestId && e.attempt.httpStatus < 400); }, physicalCount(requestId) { return [...dispatches.values()].filter(e => e.attempt.requestId === requestId).length; },
    recover(ledger) {
      ledger.recoverReserved((reservationId, entry) => {
        const dispatch = [...dispatches.values()].find(e => e.reservationId === reservationId);
        if (dispatch && dispatch.attempt.attemptId !== entry.meta?.attemptId) throw new Error('Reservation/dispatch identity corruption');
        const dispatched = !!dispatch;
        if (!dispatched) { log.write('pre-dispatch-reservation-released', { reservationId, attemptId: entry.meta?.attemptId }); return { notDispatched: true }; }
        const found = [...responses.values()].find(e => e.reservationId === reservationId && e.attempt.requestId === entry.meta?.requestId);
        return found ? { usage: normalizeUsage(found.data?.usage, models[entry.meta?.modelId]?.usageSemantics) } : null;
      });
      automaticHolds(ledger, models, policy);
      if (ledger.snapshot().unknownLiability) throw new Error('Recovery stopped: unknown dispatched charge is not fully covered');
      ledger.clearPersistenceBlock();
    },
    transport(ledger, persist, deadlineWallAt) { return {
      infrastructureRetry: policy,
      replay({ attempt, bodyHash }) {
        const dispatch = dispatches.get(attempt.attemptId), response = responses.get(attempt.attemptId), final = finals.get(attempt.attemptId);
        if (!dispatch && !response) return null;
        if ((response ?? dispatch).bodyHash !== bodyHash) throw Object.assign(new Error('Recovery body hash mismatch; replay forbidden'), { fault: 'integrity', persistenceFailure: true });
        const recovered = final?.attempt ?? { ...dispatch.attempt, usage: response ? normalizeUsage(response.data?.usage, models[attempt.modelId]?.usageSemantics) : null, cost: ledger.snapshot().records.find(r => r.meta?.attemptId === attempt.attemptId)?.cost ?? null, status: response ? 'success' : 'failed' };
        return { data: response?.data, attempt: recovered, fault: 'network' };
      },
      async onDispatch(event) {
        if (Date.now() >= deadlineWallAt) { const error = new Error('Original logical deadline expired; new dispatch forbidden'); error.code = 'BENCHMARK_ADMISSION_DENIED'; throw error; }
        if (circuitUntil > Date.now()) {
          const delay = circuitUntil - Date.now();
          if (delay > policy.maxWaitMs) throw new Error('Circuit recovery wait exceeds frozen policy');
          log.write('circuit-wait', { delayMs: delay }); await new Promise(resolve => setTimeout(resolve, delay));
        }
        if (event.signal?.aborted) { const error = new Error('Circuit admission cancelled before dispatch'); error.code = 'BENCHMARK_ADMISSION_DENIED'; throw error; }
        if (Date.now() >= deadlineWallAt) { const error = new Error('Original logical deadline expired'); error.code = 'BENCHMARK_ADMISSION_DENIED'; throw error; }
        const { signal, ...durableEvent } = event; log.write('dispatch', durableEvent); dispatches.set(event.attempt.attemptId, durableEvent);
      },
      onResponse(event) { log.write('response', event); responses.set(event.attempt.attemptId, structuredClone(event)); },
      afterFailure(error) {
        if (['service', 'rate-limit', 'network', 'timeout'].includes(error.fault)) { consecutive++; if (consecutive >= policy.circuitFailures) { circuitUntil = Date.now() + policy.circuitDelayMs; log.write('circuit-open', { until: circuitUntil, consecutive }); } }
        automaticHolds(ledger, models, policy); persist('automatic-hold');
      },
      onBackoff(event) { log.write('backoff', event); },
      recordFinal(event) { automaticHolds(ledger, models, policy); if (event.attempt.status === 'success') { consecutive = 0; circuitUntil = 0; } log.write('attempt-final', event); finals.set(event.attempt.attemptId, structuredClone(event)); }
    }; }
  };
}
module.exports = { validatePolicy, validateLiabilityProof, validateModelProofs, automaticHolds, createRuntime };
