'use strict';
// Cold summary preparation is separately billed and timed, never online-ready latency.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableHash, validateSuite } = require('./core.cjs');
const { createTransport } = require('./transport.cjs');
const { createLedger, createSharedLedger, createCredentialResolver, deriveTrustedLiabilityContracts } = require('./accounting.cjs');
const { saveAtomic, scrub } = require('./runner.cjs');
function validateJobManifest(raw) {
  if (raw?.schemaVersion !== 1 || typeof raw.id !== 'string' || !raw.sourceFreezeHash || !Array.isArray(raw.jobs) || !raw.jobs.length || !raw.models) throw new Error('Explicit source-bound job manifest required');
  validateSuite({ schemaVersion: 1, id: raw.id, dataset: 'not-loaded.json', models: raw.models, schemes: [{ id: 'validation-only', modelId: Object.keys(raw.models)[0], context: {} }], execution: { budget: raw.budget } });
  const seen = new Set();
  for (const job of raw.jobs) {
    if (!job.id || seen.has(job.id) || !raw.models[job.modelId] || !job.credentialAlias || !job.descriptor?.sourceHash || job.descriptor.id !== job.id || !Array.isArray(job.descriptor.messages) || job.descriptor.messages.some(m => !['system', 'user'].includes(m.role) || typeof m.content !== 'string')) throw new Error('Invalid or duplicate summary job');
    seen.add(job.id);
  }
  return raw;
}
function jobFingerprint(manifest, mode, authorizationHash) {
  const files = ['job-runner.cjs', 'runner.cjs', 'core.cjs', 'context.cjs', 'transport.cjs', 'accounting.cjs', 'tools.cjs', 'discussion-policies.cjs', 'campaign-policies.cjs', 'production-v010.cjs', 'global-policies.cjs', '../extension/analysis.js', '../extension/mahjong-analysis.js', '../extension/contracts/snapshot.js'];
  return stableHash({ manifest, mode, authorizationHash, sources: Object.fromEntries(files.map(file => [file, stableHash(fs.readFileSync(path.resolve(__dirname, file), 'utf8').replace(/\r\n/g, '\n'))])) });
}
function validatePreparedJobs(manifest, prepared, checkpoint) {
  validateJobManifest(manifest);
  if (prepared.synthetic || prepared.status !== 'complete' || checkpoint.synthetic || checkpoint.mode !== 'live' || checkpoint.status !== 'complete' || checkpoint.sourceFreezeHash !== manifest.sourceFreezeHash || prepared.sourceFreezeHash !== manifest.sourceFreezeHash || prepared.jobManifestHash !== stableHash(manifest) || checkpoint.fingerprint !== jobFingerprint(manifest, 'live', checkpoint.authorizationHash) || prepared.summaries?.length !== manifest.jobs.length || checkpoint.results?.length !== manifest.jobs.length || checkpoint.ledger?.unknownLiability || checkpoint.ledger?.blockedReason || checkpoint.ledger?.reserved) throw new Error('Cold preparation source/code/authorization fingerprint mismatch or incomplete liability');
  for (const job of manifest.jobs) {
    const result = prepared.summaries.filter(r => r.id === job.id), stored = checkpoint.results.filter(r => r.id === job.id), request = checkpoint.requests[job.id];
    if (result.length !== 1 || stored.length !== 1 || stableHash(result[0]) !== stableHash(stored[0]) || !result[0].text || result[0].synthetic || request?.status !== 'success' || request.responseTextHash !== stableHash(result[0].text) || !request.attempts?.some(a => a.dispatched && !a.mock && a.status === 'success' && a.usage)) throw new Error('Cold summary must match checkpoint raw response and actual accounted request');
    for (const [key, value] of Object.entries(job.descriptor)) if (stableHash(result[0][key]) !== stableHash(value)) throw new Error('Cold summary descriptor/source mismatch');
    if (job.descriptor.outputSchema) require('./discussion-policies.cjs').validateTypedSummary(result[0].text, job.descriptor);
  }
  return prepared;
}
async function runJobs(raw, options = {}) {
  const manifest = validateJobManifest(raw), mode = options.mode ?? 'mock';
  if (!['mock', 'live'].includes(mode) || mode === 'live' && !options.budgetFile) throw new Error('Live cold preparation requires the shared campaign budget file');
  if (mode === 'live' && (!Number.isFinite(manifest.budget?.cap) || manifest.budget.cap <= 0)) throw new Error('Positive shared budget required');
  const output = path.resolve(options.output ?? path.join('research/evidence/benchmark', manifest.id)), checkpoint = path.join(output, 'checkpoint.json'); fs.mkdirSync(output, { recursive: true });
  const lock = checkpoint + '.lock', token = crypto.randomUUID(); let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch { throw new Error('Job checkpoint locked; reconcile requests before removing stale locks'); }
  let ledger;
  try {
    fs.writeFileSync(fd, JSON.stringify({ token, pid: process.pid }));
    const authorizationHash = stableHash(options.authorization ?? null), fingerprint = jobFingerprint(manifest, mode, authorizationHash);
    const prior = options.resume ? JSON.parse(fs.readFileSync(checkpoint, 'utf8')) : null;
    if (!options.resume && fs.existsSync(checkpoint)) throw new Error('Job checkpoint exists; explicit resume required');
    if (prior && (prior.fingerprint !== fingerprint || Object.values(prior.requests).some(r => r.status === 'pending') || prior.ledger?.unknownLiability || prior.ledger?.blockedReason || prior.ledger?.reserved)) throw new Error('Job resume mismatch or unresolved paid liability; replay prohibited');
    const trustedLiabilityContracts = deriveTrustedLiabilityContracts(manifest.models);
    ledger = options.budgetFile ? createSharedLedger({ filename: options.budgetFile, ...manifest.budget, trustedLiabilityContracts }) : createLedger({ ...manifest.budget, initial: prior?.ledger, trustedLiabilityContracts });
    const state = prior ?? { schemaVersion: 1, fingerprint, authorizationHash, manifestId: manifest.id, mode, synthetic: mode === 'mock', sourceFreezeHash: manifest.sourceFreezeHash, requests: {}, results: [], status: 'running' }, secrets = [];
    const resolveCredential = mode === 'live' ? options.credentialResolver ?? createCredentialResolver({ credentialsFile: options.credentialsFile, authorization: options.authorization }) : null;
    const credentialResolver = resolveCredential ? async ref => { const key = await resolveCredential(ref); secrets.push(key); return key; } : null;
    function persist() { state.ledger = ledger.snapshot(); saveAtomic(checkpoint, state, secrets); }
    persist();
    for (const job of manifest.jobs) {
      if (state.requests[job.id]) continue;
      if (ledger.snapshot().unknownLiability || ledger.snapshot().blockedReason) break;
      const started = Date.now(), model = { ...manifest.models[job.modelId], credentialAlias: job.credentialAlias };
      state.requests[job.id] = { status: 'pending', role: 'probe-summary-preparation', schemeId: job.schemeId }; persist();
      const transport = createTransport({ model, mode: mode === 'live' ? 'real' : 'mock', ledger, credentialResolver, fetch: options.fetch,
        beforeRequest: ({ requestBody }) => { persist(); fs.appendFileSync(path.join(output, 'requests.private.jsonl'), JSON.stringify(scrub({ jobId: job.id, body: requestBody }, secrets)) + '\n'); },
        onAttempt: ({ attempt, responseMessage }) => { persist(); fs.appendFileSync(path.join(output, 'responses.private.jsonl'), JSON.stringify(scrub({ jobId: job.id, attempt, responseMessage }, secrets)) + '\n'); }
      });
      try {
        const response = await transport.runModel({ messages: job.descriptor.messages, tools: [], timeoutMs: manifest.timeoutMs ?? 180000, maxModelRequests: null, maxToolCalls: 0, meta: { requestId: job.id, schemeId: job.schemeId, role: 'probe-summary-preparation', campaignKind: 'probe-preparation', channel: 'realtime', modelId: job.modelId, keyAlias: job.credentialAlias, credentialAlias: job.credentialAlias }, mockText: job.descriptor.mockText ?? 'SYNTHETIC cold summary; never formal evidence.' });
        if (job.descriptor.outputSchema) require('./discussion-policies.cjs').validateTypedSummary(response.text, job.descriptor);
        const record = { ...job.descriptor, text: response.text, schemeId: job.schemeId, preparedForDecisionId: job.decisionId, coldPreparationMs: Date.now() - started, actualOnlineLatency: false, synthetic: mode === 'mock' };
        state.results.push(record); state.requests[job.id] = { status: 'success', responseTextHash: stableHash(response.text), attempts: transport.attempts, latencyMs: Date.now() - started };
      } catch { state.requests[job.id] = { status: ledger.snapshot().unknownLiability ? 'unresolved' : 'failed', attempts: transport.attempts }; }
      persist();
    }
    state.status = ledger.snapshot().unknownLiability || ledger.snapshot().blockedReason ? 'stopped-liability' : state.results.length === manifest.jobs.length ? 'complete' : 'incomplete'; persist();
    const summaries = { schemaVersion: 1, synthetic: mode === 'mock', sourceFreezeHash: manifest.sourceFreezeHash, jobManifestHash: stableHash(manifest), status: state.status, summaries: state.results };
    saveAtomic(path.join(output, 'summaries.frozen.json'), summaries, secrets);
    return state;
  } finally {
    ledger?.close?.(); fs.closeSync(fd);
    try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.unlinkSync(lock); } catch { /* unfamiliar lock is never deleted */ }
  }
}
module.exports = { runJobs, validateJobManifest, jobFingerprint, validatePreparedJobs };
