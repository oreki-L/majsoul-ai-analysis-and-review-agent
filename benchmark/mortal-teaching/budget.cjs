'use strict';
// One ledger for every paid role. Unknown/unfinished attempts stop admission;
// their full-context reservations remain charged against the cap until audited.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableHash } = require('../core.cjs');
const { journal } = require('../durable.cjs');
const { createSharedLedger, normalizeUsage, estimateCost, validateRates, redact } = require('../accounting.cjs');
function openBudget({ directory, authorization, pricing, fetchImpl = fetch, secrets = [] }) {
  if (authorization?.cap !== 50 || authorization.currency !== 'CNY' || authorization.approved !== true || !authorization.manifestId) throw new Error('This experiment requires the approved independent CNY 50 authorization');
  if (authorization.budgetDirectory && path.resolve(directory) !== path.resolve(authorization.budgetDirectory)) throw new Error('All preparation versions must use the same campaign budget directory');
  if (!validateRates(pricing?.rates) || !Number.isSafeInteger(pricing.inputBound) || pricing.inputBound < 1 || !Number.isSafeInteger(pricing.maxOutputTokens) || pricing.maxOutputTokens < 1 || pricing.currency !== 'CNY' || !pricing.model || !pricing.endpoint || !pricing.sourceSha256) throw new Error('Frozen pricing and full-context liability bound required');
  const binding = { authorization, pricing }, filename = path.join(directory, 'budget.json');
  fs.mkdirSync(directory, { recursive: true });
  const ledger = createSharedLedger({ filename, cap: 50, currency: 'CNY', autonomous: true });
  let log;
  try {
    log = journal(path.join(directory, 'attempts.jsonl'));
    const previous = log.events.find(e => e.kind === 'contract');
    if (previous && previous.payload.hash !== stableHash(binding)) throw new Error('Campaign budget or pricing contract changed');
    if (!previous) log.write('contract', { hash: stableHash(binding), binding });
  } catch (error) { ledger.close(); throw error; }
  let busy = false;
  async function request(url, options, { jobId, role, ordinal } = {}) {
    if (busy) throw new Error('Paid attempts must be serial');
    if (!jobId || !role || !Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error('Physical attempt identity required');
    if (ledger.snapshot().reservationCount || ledger.snapshot().unknownLiability) throw new Error('Unsettled liability blocks paid requests');
    const body = JSON.parse(options.body);
    if (url !== pricing.endpoint || body.model !== pricing.model || body.stream === true || body.max_tokens !== pricing.maxOutputTokens) throw new Error('Request outside frozen paid model/output contract');
    const identity = { jobId, role, ordinal };
    if (log.events.some(e => e.kind === 'dispatch' && stableHash(e.payload.identity) === stableHash(identity))) throw new Error('Attempt already dispatched; never replay automatically');
    const attemptId = crypto.randomUUID();
    const id = ledger.reserve({ inputTokens: pricing.inputBound, maxOutputTokens: pricing.maxOutputTokens, rates: pricing.rates, meta: { ...identity, attemptId, model: pricing.model, endpoint: pricing.endpoint } });
    busy = true;
    try {
      log.write('dispatch', { attemptId, reservation: id, identity, requestHash: stableHash(body), request: redact(body, secrets) });
      const response = await fetchImpl(url, options);
      // Preserve the product response stream. Failure to read usage is a billing
      // unknown, even for HTTP errors; never assume an error is free.
      const payload = await response.clone().json().catch(() => null);
      const usage = normalizeUsage(payload?.usage), cost = estimateCost(usage, pricing.rates);
      log.write('response', { attemptId, status: response.status, body: redact(payload, secrets), usage, estimatedCost: cost });
      if (cost !== null) ledger.settle(id, usage);
      else log.write('unknown', { attemptId, reservation: id, reason: 'missing-or-invalid-usage; full reservation retained; no automatic retry' });
      return response;
    } catch (error) {
      // A failure can occur after dispatch or after receiving a billable answer.
      // The durable reservation survives; reopening also blocks admission.
      try { log.write('unknown', { attemptId, reservation: id, reason: 'transport-or-persistence-failure' }); } catch { /* reservation is authoritative */ }
      throw error;
    } finally { busy = false; }
  }
  return { request, snapshot: ledger.snapshot, close: ledger.close, log };
}
module.exports = { openBudget };
