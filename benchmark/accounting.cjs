'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
function redact(value, secrets = []) {
  if (typeof value === 'string') {
    let out = value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').replace(/\bsk-[\w-]+/g, '[REDACTED]');
    for (const secret of secrets) if (secret) out = out.split(secret).join('[REDACTED]');
    return out;
  }
  if (Array.isArray(value)) return value.map(v => redact(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /api.?key|authorization|cookie|secret|password|access.?token/i.test(k) ? '[REDACTED]' : redact(v, secrets)]));
  return value;
}
function normalizeUsage(raw, semantics = {}) {
  const input = number(raw?.prompt_tokens ?? raw?.input_tokens);
  const output = number(raw?.completion_tokens ?? raw?.output_tokens);
  let cachedInput = number(raw?.prompt_cache_hit_tokens ?? raw?.prompt_tokens_details?.cached_tokens ?? raw?.input_tokens_details?.cached_tokens ?? raw?.cache_read_input_tokens);
  let uncachedInput = number(raw?.prompt_cache_miss_tokens);
  // OpenAI and DeepSeek totals include hits. Providers with exclusive totals must opt in.
  const inputIncludesCached = semantics.inputIncludesCached !== false;
  if (semantics.noCache === true && cachedInput === null) cachedInput = 0;
  if (cachedInput === null && input !== null && uncachedInput !== null && inputIncludesCached) cachedInput = number(input - uncachedInput);
  if (uncachedInput === null && input !== null && cachedInput !== null) uncachedInput = inputIncludesCached ? number(input - cachedInput) : input;
  const fields = [raw?.prompt_tokens ?? raw?.input_tokens, raw?.completion_tokens ?? raw?.output_tokens,
    raw?.prompt_cache_hit_tokens ?? raw?.prompt_tokens_details?.cached_tokens ?? raw?.input_tokens_details?.cached_tokens ?? raw?.cache_read_input_tokens, raw?.prompt_cache_miss_tokens];
  const invalid = fields.some(v => v !== undefined && v !== null && (!Number.isSafeInteger(v) || v < 0)) ||
    (inputIncludesCached && input !== null && (cachedInput !== null && cachedInput > input || uncachedInput !== null && uncachedInput > input || cachedInput !== null && uncachedInput !== null && cachedInput + uncachedInput !== input)) ||
    (!inputIncludesCached && input !== null && uncachedInput !== null && input !== uncachedInput) ||
    (semantics.noCache === true && cachedInput !== null && cachedInput !== 0);
  return { input, output, cachedInput: invalid ? null : cachedInput, uncachedInput: invalid ? null : uncachedInput, inputIncludesCached, valid: !invalid, raw: raw ? redact(raw) : null };
}
function validateRates(rates) {
  return rates && ['cachedInput', 'uncachedInput', 'output'].every(k => number(rates[k]) !== null) && (rates.unit === undefined || rates.unit === 'perMillion');
}
function normalizeRates(rates) {
  if (!rates) return null;
  const scale = 1e6 / (rates.perTokens ?? 1e6);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return { cachedInput: rates.cachedInputPerMillion ?? (number(rates.cachedInput) === null ? null : rates.cachedInput * scale),
    uncachedInput: rates.inputPerMillion ?? (number(rates.uncachedInput ?? rates.input) === null ? null : (rates.uncachedInput ?? rates.input) * scale),
    output: rates.outputPerMillion ?? (number(rates.output) === null ? null : rates.output * scale), unit: 'perMillion' };
}
function estimateCost(usage, rates) {
  if (!validateRates(rates) || usage?.valid === false || number(usage?.output) === null) return null;
  if ([usage?.cachedInput, usage?.uncachedInput].some(v => number(v) === null)) {
    if (rates.cachedInput === rates.uncachedInput && usage?.inputIncludesCached === true && number(usage?.input) !== null) return (usage.input * rates.uncachedInput + usage.output * rates.output) / 1e6;
    return null;
  }
  return (usage.cachedInput * rates.cachedInput + usage.uncachedInput * rates.uncachedInput + usage.output * rates.output) / 1e6;
}
function timePricing(at, schedule) {
  if (!schedule || schedule.timezone !== 'Asia/Shanghai' || !validateRates(schedule.peak) || !validateRates(schedule.offPeak)) throw new Error('Invalid time pricing schedule');
  const date = new Date(at); if (!Number.isFinite(date.getTime())) throw new Error('Invalid pricing timestamp');
  const local = new Date(date.getTime() + 8 * 3600000), day = local.getUTCDay(), minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const localDate = local.toISOString().slice(0, 10), holiday = (schedule.holidays ?? []).includes(localDate);
  const peak = day >= 1 && day <= 5 && !holiday && (minute >= 540 && minute < 720 || minute >= 840 && minute < 1080);
  return { rates: { ...(peak ? schedule.peak : schedule.offPeak), unit: 'perMillion' }, basis: 'provider published time-of-request estimate; actual provider billing may differ', period: peak ? 'peak' : 'offPeak', requestStartedAt: date.toISOString(), timezone: 'Asia/Shanghai', localDate, holidayCalendarVerified: schedule.holidaysVerified === true, currency: schedule.currency };
}
// Contracts are supplied by the frozen caller model manifest, never trusted from a hold itself.
function deriveTrustedLiabilityContracts(models = {}) {
  const result = new Map();
  for (const [modelId, model] of Object.entries(models)) {
    const bound = model.liabilityBound; if (!bound) continue;
    const rates = normalizeRates(model.rates), currency = model.currency ?? model.rates?.currency;
    if (model.pricingSchedule) for (const field of ['cachedInput', 'uncachedInput', 'output']) rates[field] = Math.max(rates[field], model.pricingSchedule.peak[field], model.pricingSchedule.offPeak[field]);
    const contract = { ...bound, currency, rates, modelId, model: model.model, endpoint: model.endpoint };
    if (result.has(bound.contractHash + ':' + modelId) && require('./core.cjs').stableHash(result.get(bound.contractHash + ':' + modelId)) !== require('./core.cjs').stableHash(contract)) throw new Error('Conflicting trusted liability contract');
    result.set(bound.contractHash + ':' + modelId, contract);
  }
  return [...result.values()];
}
function createLedger({ cap, currency, rates, initial, snapshot = initial, trustedLiabilityContracts = [] } = {}) {
  const stableHash = require('./core.cjs').stableHash;
  if (snapshot && (!Number.isFinite(snapshot.reserved) || snapshot.reserved < 0 || snapshot.reservationCount !== undefined && (!Number.isSafeInteger(snapshot.reservationCount) || snapshot.reservationCount < 0 || snapshot.reservationCount === 0 && snapshot.reserved !== 0))) throw new Error('Invalid reservation state; audit migration required');
  let unresolvedReservationCount = snapshot?.reservationCount ?? ((snapshot?.reserved ?? 0) > 0 ? 1 : 0);
  let estimatedCost = snapshot?.estimatedCost ?? 0, reserved = snapshot?.reserved ?? 0, restoredReserved = reserved, nextId = (snapshot?.nextId ?? 1);
  const reservations = new Map(), records = structuredClone(snapshot?.records ?? []), conservativeHolds = structuredClone(snapshot?.conservativeHolds ?? []);
  if (!Array.isArray(conservativeHolds) || !Array.isArray(trustedLiabilityContracts)) throw new Error('Invalid conservative holds or trusted contracts');
  const trusted = new Map();
  for (const contract of trustedLiabilityContracts) {
    if (!/^[a-f0-9]{64}$/.test(contract.contractHash ?? '') || !Number.isSafeInteger(contract.inputTokens) || contract.inputTokens < 1 || !Number.isSafeInteger(contract.outputTokens) || contract.outputTokens < 1 || contract.currency !== currency || !validateRates(contract.rates) || typeof contract.modelId !== 'string' || !contract.modelId || typeof contract.model !== 'string' || !contract.model || typeof contract.endpoint !== 'string' || !contract.endpoint) throw new Error('Invalid or duplicate trusted liability contract');
    const entries = trusted.get(contract.contractHash) ?? [];
    if (entries.some(entry => entry.modelId === contract.modelId)) throw new Error('Duplicate trusted model liability contract');
    entries.push(structuredClone(contract)); trusted.set(contract.contractHash, entries);
  }
  let blockedReason = snapshot?.blockedReason ?? null;
  const legacyUnclassifiedLiability = snapshot?.legacyUnclassifiedLiability === true || snapshot?.unknownLiability === true && snapshot?.unknownLiabilitySemantics !== 'unbounded-budget-exposure-v1' && !records.some(r => r.cost === null) && !unresolvedReservationCount;
  function refreshReserved() { reserved = [...reservations.values()].reduce((sum, entry) => sum + entry.amount, restoredReserved); }
  function exposure() {
    const covered = new Set(); let conservativeUnknownHoldTotal = 0;
    for (const hold of conservativeHolds) {
      const record = records[hold.recordIndex], contracts = trusted.get(hold.contractHash) ?? [];
      const scoped = contracts.filter(c => c.modelId === record?.meta?.modelId && c.model === record?.meta?.modelVersion && (!record?.meta?.endpoint || c.endpoint === record.meta.endpoint));
      const contract = scoped.length === 1 ? scoped[0] : null;
      if (!Number.isSafeInteger(hold.recordIndex) || hold.recordIndex < 0 || !record || record.cost !== null || covered.has(hold.recordIndex) || hold.recordHash !== stableHash(record) || !contract || hold.currency !== currency || hold.approved !== true || typeof hold.reviewId !== 'string' || !hold.reviewId.trim() || !Number.isFinite(hold.amount) || hold.amount < 0) throw new Error('Invalid, duplicate or untrusted conservative hold binding');
      const upperCharge = (contract.inputTokens * Math.max(contract.rates.cachedInput, contract.rates.uncachedInput) + contract.outputTokens * contract.rates.output) / 1e6;
      if (hold.amount < upperCharge || ['cachedInput', 'uncachedInput', 'output'].some(field => contract.rates[field] < (record.reservationRates ?? record.rates)?.[field]) || record.meta?.liabilityBound && record.meta.liabilityBound.contractHash !== hold.contractHash) throw new Error('Conservative hold does not cover trusted full-context liability contract');
      covered.add(hold.recordIndex); conservativeUnknownHoldTotal += hold.amount;
    }
    const unknownRecords = records.flatMap((record, index) => record.cost === null ? [index] : []);
    const billingUnknownLiability = unknownRecords.length > 0 || unresolvedReservationCount > 0 || legacyUnclassifiedLiability;
    const unboundedBudgetExposure = legacyUnclassifiedLiability || unresolvedReservationCount > 0 || unknownRecords.some(index => !covered.has(index)) || records.some(r => typeof r.cost === 'number' && r.cost > r.amount + 1e-12) || estimatedCost + conservativeUnknownHoldTotal + reserved > cap + 1e-12;
    return { confirmedUsageEstimate: estimatedCost, conservativeUnknownHoldTotal, billingUnknownLiability, unboundedBudgetExposure, budgetCommitted: estimatedCost + conservativeUnknownHoldTotal + reserved };
  }
  exposure();
  function reserve({ inputTokens, maxOutputTokens, rates: requestRates = rates, currency: requestCurrency = currency, meta } = {}) {
    if (!Number.isFinite(cap) || cap < 0 || typeof currency !== 'string' || !currency || requestCurrency !== currency || !validateRates(requestRates)) throw new Error('Paid requests require an explicit cap, matching currency and perMillion rates');
    const risk = exposure();
    if (risk.unboundedBudgetExposure) throw new Error('Unknown cost liability blocks paid requests');
    if (blockedReason) throw new Error('Ledger blocked after lifecycle persistence failure');
    if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error('A finite input reservation and maxOutputTokens are required');
    const amount = (inputTokens * Math.max(requestRates.cachedInput, requestRates.uncachedInput) + maxOutputTokens * requestRates.output) / 1e6;
    if (risk.budgetCommitted + amount > cap + 1e-12) throw new Error('Budget cap would be exceeded');
    const id = nextId++; reservations.set(id, { amount, rates: requestRates, meta: redact(meta) }); refreshReserved(); return id;
  }
  function settle(id, usage, settlement = {}) {
    const entry = reservations.get(id); if (!entry) throw new Error('Unknown reservation');
    reservations.delete(id); refreshReserved();
    const appliedRates = settlement.rates ?? entry.rates, cost = estimateCost(usage, appliedRates);
    if (cost !== null) estimatedCost += cost;
    records.push({ ...entry, reservationRates: entry.rates, rates: appliedRates, pricing: settlement.pricing ?? { basis: 'prescribed conservative rates; actual provider time price not selected' }, usage, cost, estimated: true }); return cost;
  }
  function release(id) { if (reservations.delete(id)) refreshReserved(); }
  function addConservativeHold(hold) {
    conservativeHolds.push(structuredClone(hold));
    try { const risk = exposure(); if (risk.budgetCommitted > cap + 1e-12) throw new Error('Conservative hold exceeds budget cap'); }
    catch (error) { conservativeHolds.pop(); throw error; }
  }
  function recoverReserved(resolve) {
    if (!unresolvedReservationCount) return;
    const entries = snapshot?.reservationEntries;
    if (!Array.isArray(entries) || entries.length !== unresolvedReservationCount || Math.abs(entries.reduce((n, [, e]) => n + e.amount, 0) - restoredReserved) > 1e-12) throw new Error('Unrecoverable legacy reservation evidence');
    for (const [id, entry] of entries) {
      const settlement = resolve(id, entry); if (settlement?.notDispatched) continue;
      const usage = settlement?.usage ?? null, appliedRates = settlement?.rates ?? entry.rates, cost = estimateCost(usage, appliedRates);
      if (cost !== null) estimatedCost += cost;
      records.push({ ...entry, reservationRates: entry.rates, rates: appliedRates, usage, cost, estimated: true, recovered: true });
    }
    restoredReserved = 0; unresolvedReservationCount = 0; refreshReserved();
  }
  function view() { const risk = exposure(); return { cap, currency, estimatedCost, reserved, reservationCount: reservations.size + unresolvedReservationCount, nextId, reservationEntries: [...(unresolvedReservationCount ? snapshot?.reservationEntries ?? [] : []), ...reservations.entries()], ...risk, unknownLiability: risk.unboundedBudgetExposure, unknownLiabilitySemantics: 'unbounded-budget-exposure-v1', legacyUnclassifiedLiability, blockedReason, conservativeHolds: structuredClone(conservativeHolds), records: structuredClone(records), estimated: true }; }
  return { reserve, settle, release, recoverReserved, clearPersistenceBlock: () => { if (blockedReason === 'lifecycle_persistence_failure') blockedReason = null; }, addConservativeHold, block: () => { blockedReason = 'lifecycle_persistence_failure'; }, snapshot: view };
}
function createCredentialResolver({ credentialsFile, env = process.env, allowGroups = false, authorization } = {}) {
  return async reference => {
    if (typeof reference !== 'string' || !reference) throw new Error('Credential reference required');
    let key;
    if (reference.startsWith('env:')) {
      if (authorization && !(typeof authorization.manifestId === 'string' && authorization.manifestId && Array.isArray(authorization.allowedReferences) && authorization.allowedReferences.includes(reference))) throw new Error('Credential is outside authorized campaign manifest');
      key = env[reference.slice(4)];
    }
    else {
      if (!credentialsFile) throw new Error('Credentials file required');
      const data = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
      const id = reference.replace(/^(group|alias):/, '');
      const alias = reference.startsWith('alias:') || !reference.startsWith('group:') && /^plan\d+$/.test(reference);
      const scopedReference = (alias ? 'alias:' : 'group:') + id;
      const scoped = typeof authorization?.manifestId === 'string' && !!authorization.manifestId && Array.isArray(authorization.allowedReferences) && authorization.allowedReferences.includes(scopedReference);
      if (authorization && !scoped) throw new Error('Credential is outside authorized campaign manifest');
      if (alias) {
        const entry = data.credentialAliases?.[id];
        if (entry?.executionGate !== 'allowed' && !scoped) throw new Error('Credential alias is not explicitly allowed');
        key = entry.apiKey;
      } else {
        if (!scoped && allowGroups !== true && !(Array.isArray(allowGroups) && allowGroups.includes(id))) throw new Error('Credential group requires explicit authorization');
        key = (Array.isArray(data.groups) ? data.groups.find(group => group?.id === id) : data.groups?.[id])?.apiKey;
      }
      const groupEntries = Array.isArray(data.groups) ? data.groups : Object.entries(data.groups ?? {}).map(([groupId, entry]) => ({ id: groupId, ...entry }));
      const excluded = authorization?.excludedGroups ?? [];
      if (excluded.includes(id) || groupEntries.some(entry => excluded.includes(entry.id) && typeof key === 'string' && entry.apiKey === key)) throw new Error('Credential belongs to excluded campaign group');
    }
    if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw new Error('Credential is missing or invalid');
    return key.trim();
  };
}
function createSharedLedger({ filename, cap, currency, trustedLiabilityContracts = [], autonomous = false } = {}) {
  if (typeof filename !== 'string' || !filename || !Number.isFinite(cap) || cap <= 0 || typeof currency !== 'string' || !currency) throw new Error('Shared ledger requires filename, positive cap and currency');
  const target = path.resolve(filename), lock = target + '.lock', token = crypto.randomUUID();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const durable = autonomous ? require('./durable.cjs') : null;
  const durableRelease = durable ? durable.acquireLock(lock, true) : null;
  let budgetLog; try { budgetLog = durable ? durable.journal(target + '.events.jsonl') : null; } catch (error) { durableRelease?.(); throw error; }
  let descriptor;
  if (!durable) try { descriptor = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(descriptor, token); fs.closeSync(descriptor); descriptor = null; }
  catch { if (descriptor !== undefined && descriptor !== null) fs.closeSync(descriptor); const safe = new Error('Shared campaign budget is locked'); safe.code = 'BENCHMARK_BUDGET_LOCKED'; throw safe; }
  let closed = false;
  function close() { if (closed) return; closed = true; if (durableRelease) { durableRelease(); return; } if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === token) fs.unlinkSync(lock); }
  try {
    const initial = budgetLog?.latestBudget() ?? (fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null);
    if (initial && (initial.cap !== cap || initial.currency !== currency)) throw new Error('Shared campaign budget cap or currency mismatch');
    if (initial && (!Number.isFinite(initial.estimatedCost) || initial.estimatedCost < 0 || !Number.isFinite(initial.reserved) || initial.reserved < 0 || typeof initial.unknownLiability !== 'boolean' || !Array.isArray(initial.records))) throw new Error('Shared campaign budget state is invalid');
    const ledger = createLedger({ cap, currency, initial, trustedLiabilityContracts });
    function save() {
      if (closed || !durable && fs.readFileSync(lock, 'utf8') !== token) throw new Error('Shared campaign budget lock lost');
      const temporary = target + '.' + token + '.tmp';
      try { budgetLog?.write('budget', { snapshot: ledger.snapshot() }); const write = () => { const fd = fs.openSync(temporary, 'w', 0o600); try { fs.writeFileSync(fd, JSON.stringify(ledger.snapshot(), null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temporary, target); }; if (durable) durable.localWrite(write); else write(); }
      catch { ledger.block(); throw new Error('Shared campaign budget persistence failed'); }
    }
    const clearBase = ledger.clearPersistenceBlock; ledger.clearPersistenceBlock = () => { clearBase(); save(); };
    const recoverBase = ledger.recoverReserved;
    ledger.recoverReserved = resolve => { recoverBase(resolve); save(); };
    const reserveBase = ledger.reserve, settleBase = ledger.settle, releaseBase = ledger.release, addHoldBase = ledger.addConservativeHold;
    ledger.reserve = args => { if (closed) throw new Error('Shared campaign budget is closed'); const id = reserveBase(args); save(); return id; };
    ledger.settle = (id, usage, settlement) => { const cost = settleBase(id, usage, settlement); save(); return cost; };
    ledger.release = id => { releaseBase(id); save(); };
    ledger.addConservativeHold = hold => { if (closed) throw new Error('Shared campaign budget is closed'); addHoldBase(hold); save(); };
    save(); return { ...ledger, save, close, filename: target };
  } catch (error) { close(); throw error; }
}
module.exports = { normalizeUsage, normalizeRates, estimateCost, timePricing, createLedger, createSharedLedger, createCredentialResolver, redact, validateRates, deriveTrustedLiabilityContracts };
