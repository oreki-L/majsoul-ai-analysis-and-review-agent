'use strict';
// Pure preparation helpers. Never resolves credentials, calls a provider or starts a run.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableHash, validateSuite, validateDataset } = require('./core.cjs');
const { validateLabels } = require('./scoring.cjs');

const VERSION = 'next-stage-preparation/1.0.0';
const CORE = Object.freeze(['R0', 'R1', 'R3', 'R5', 'R6', 'R7', 'X-S', 'X-A', 'X-SA']);
const EVENTS = Object.freeze(['EV-0', 'EV-All']);
const COMPRESSION = Object.freeze(['C-K', 'C-L', 'C-KM']);
const ALL_HISTORY = Object.freeze(['W-SA-K', 'W-SA-L', 'W-SA-KM']);
const SCHEME_ORDER = Object.freeze([...CORE, ...EVENTS, ...COMPRESSION, ...ALL_HISTORY, 'W-C', 'W-V']);
const RESERVED = Object.freeze(['P2-C1', 'P2-C2', 'P-Stable']);
const GROUP_ORDER = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'B-current', 'K', 'M', 'KM', 'H1', 'H2', 'H3']);
const STAGES = Object.freeze([
  { id: 'phase1', schemes: [...CORE], decisions: 29, repetitions: 1, outputs: 261, status: 'fixed-strategies' },
  { id: 'phase1-events', schemes: [...EVENTS], decisions: 29, repetitions: 1, outputs: 58, status: 'fixed-strategies' },
  { id: 'phase2a', schemes: [...COMPRESSION], decisions: 29, repetitions: 1, outputs: 87, status: 'requires-frozen-current-R0-source-and-ready-summaries', sourceMode: 'fixed-source-replay' },
  { id: 'phase2b', schemes: [...COMPRESSION], decisions: 29, repetitions: 2, outputs: 174, status: 'requires-continuous-summary-validation', sourceMode: 'own-causal-history' },
  { id: 'phase2c', schemes: [...ALL_HISTORY], decisions: 29, repetitions: 1, outputs: 87, status: 'requires-frozen-current-R0-source-and-ready-summaries', sourceMode: 'fixed-source-replay' },
  { id: 'phase3-facts', schemes: ['W-C', 'W-V'], decisions: 29, repetitions: 1, outputs: 58, independentDrafts: 29, status: 'requires-locked-base-candidate-and-same-period-control' },
  { id: 'phase3-prompts', candidateCount: 2, variants: ['original', 'P2'], decisions: 29, repetitions: 1, outputs: 116, status: 'requires-locked-candidates-and-tested-P2' },
  { id: 'phase3-prefix', candidateCount: 1, variants: ['original', 'stable'], decisions: 29, repetitions: 1, outputs: 58, status: 'requires-locked-candidate-and-real-serialization-difference' },
  { id: 'phase4', candidateCount: 4, decisions: 45, repetitions: 1, outputs: 180, status: 'requires-two-controls-and-at-most-two-locked-new-candidates' }
]);
const CAP = 70;
const hashFile = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
function readJSON(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')); }
function originalSlots() {
  return [...GROUP_ORDER.map(id => `group:${id}`), ...Array.from({ length: 20 }, (_, i) => `alias:plan${15 + i}`)];
}
function makeKeyMapping({ credentialsFile, cap = CAP } = {}) {
  if (typeof credentialsFile !== 'string' || !credentialsFile || cap !== CAP) throw new Error('Original credentials reference and approved CNY70 cap required');
  const slots = originalSlots();
  return { schemaVersion: 1, version: VERSION, credentialsFile: path.resolve(credentialsFile), credentialsRead: false,
    order: 'original group slots 1..14, then numeric aliases plan15..34; no file mutation',
    assigned: SCHEME_ORDER.map((schemeId, i) => ({ schemeId, slot: i + 1, sourceSlot: `plan${String(i + 1).padStart(2, '0')}`, credentialAlias: slots[i] })),
    reserved: RESERVED.map((schemeId, i) => ({ schemeId, slot: SCHEME_ORDER.length + i + 1, credentialAlias: slots[SCHEME_ORDER.length + i], state: 'reserved-unbound-candidate' })),
    unused: slots.slice(SCHEME_ORDER.length + RESERVED.length).map((credentialAlias, i) => ({ slot: SCHEME_ORDER.length + RESERVED.length + i + 1, credentialAlias })),
    cap, currency: 'CNY', accounting: 'same strategy across phases/repetitions reuses its own reference; new variants get separate references; summary uses its scheme reference; paired correction charges only its actual incremental request' };
}
function validateMapping(mapping) {
  if (mapping.cap !== CAP || mapping.currency !== 'CNY') throw new Error('Campaign cap/currency mismatch');
  const expected = [...SCHEME_ORDER, ...RESERVED];
  const rows = [...mapping.assigned, ...mapping.reserved];
  if (rows.length !== expected.length || rows.some((r, i) => r.schemeId !== expected[i] || r.slot !== i + 1 || r.credentialAlias !== originalSlots()[i])) throw new Error('Original ordered scheme-to-slot mapping changed');
  if (new Set(rows.map(r => r.credentialAlias)).size !== rows.length) throw new Error('Different strategies must not share credential references');
  if (rows.some(r => ['R2', 'R4'].includes(r.schemeId))) throw new Error('Cancelled strategy restored');
  return mapping;
}
function stripNonRealtime(raw) {
  const dataset = structuredClone(raw);
  for (const round of dataset.rounds ?? []) { delete round.sessionId; round.globalTasks = []; for (const node of round.decisions ?? []) node.followups = []; }
  validateDataset(dataset); return dataset;
}
function validateInputs(dataset, rawLabels, expected) {
  const normalized = validateDataset(dataset), labels = validateLabels(rawLabels), byId = new Map(labels.labels.map(l => [l.decisionId, l]));
  const points = normalized.rounds.flatMap(r => r.decisions);
  if (points.length !== expected.decisions || normalized.rounds.length !== expected.rounds) throw new Error('Frozen complete-round coverage changed');
  if (points.some(n => n.followups.length) || normalized.rounds.some(r => r.globalTasks.length)) throw new Error('Realtime preparation must not schedule QA/global tasks');
  if (points.some(n => !byId.get(n.id)?.maka || !byId.get(n.id)?.gpt) || labels.labels.length !== points.length) throw new Error('Dual reference must match exact decision scope');
  const maximum = source => points.reduce((sum, n) => sum + Math.max(...byId.get(n.id)[source].candidates.map(c => c.weight)), 0);
  const result = { decisions: points.length, rounds: normalized.rounds.map(r => ({ id: r.id, decisions: r.decisions.length, postCall: r.decisions.filter(n => n.type === 'post-call-discard').length })), makaMax: maximum('maka'), gptMax: maximum('gpt'), datasetHash: stableHash(normalized), labelsHash: stableHash(labels) };
  if (result.makaMax !== expected.makaMax || result.gptMax !== expected.gptMax) throw new Error('Frozen reference denominators changed');
  return result;
}
function phaseSuite({ stageId, dataset, labels, contextModule, model, mapping, sourceSet = 'old29', extraOptions = {} }) {
  validateMapping(mapping);
  const stage = STAGES.find(s => s.id === stageId);
  if (!stage?.schemes || ['phase3-facts'].includes(stageId)) throw new Error('Selected-candidate stage must be materialized after candidate lock');
  if (!contextModule || !dataset || !labels || !model) throw new Error('Explicit frozen inputs, labels, context adapter and model required');
  const summaryIds = new Set(['R7', 'C-L', 'C-KM', 'W-SA-L', 'W-SA-KM']);
  const suite = { schemaVersion: 1, id: `realtime-next-20261031-${stageId}`, dataset, labels,
    models: { 'deepseek-flash': structuredClone(model) },
    schemes: stage.schemes.map(schemeId => ({ id: schemeId, modelId: 'deepseek-flash', credentialAlias: mapping.assigned.find(r => r.schemeId === schemeId).credentialAlias,
      context: { module: contextModule, options: { policy: schemeId, sourceSet, stage: stageId, sourceMode: stage.sourceMode ?? 'own-causal-history', ...extraOptions } },
      ...(summaryIds.has(schemeId) ? { summaryModelId: 'deepseek-flash' } : {}) })),
    execution: { repetitions: stage.repetitions, seed: 31, concurrency: 2, timeoutMs: 180000, maxModelRequests: null, maxToolCalls: null, backgroundPolicy: 'shared-quota', budget: { cap: CAP, currency: 'CNY' } } };
  validateSuite(suite); return suite;
}
function stagePlan(mapping) {
  validateMapping(mapping);
  return { schemaVersion: 1, version: VERSION, cap: CAP, currency: 'CNY', executionMode: 'prepare-only', stages: structuredClone(STAGES), maximumOutputOpportunities: STAGES.reduce((n, s) => n + s.outputs, 0),
    independentSampleWarning: 'Paired W-V shares W-C drafts. An output opportunity is neither an independent draft nor a physical HTTP count.',
    selectedCandidates: [], cancelledSchemeIds: ['R2', 'R4'], allPaidRolesShareBudget: true,
    phase4: { repeats: 1, completeRounds: 4, decisions: 45, controls: ['R0', 'R1'], maximumNewCandidates: 2, futureExpansion: 'different complete rounds before repeated same nodes' },
    inheritedCostsOpening: 'Before-this-campaign provider usage belongs to opening reconciliation, not a zeroed or duplicated historical charge.',
    gates: { currentAuthorization: 'CNY70 approved by user; original ordered keys approved', preparation: 'no provider dispatch', prices: 'inherited unverified today; public source check required', candidateStages: 'source/candidate/prompt/serialization locks required before suite generation', providerBilling: 'usage estimated until user key-level reconciliation', overall: 'not-ready-until-offline-acceptance-and-price-contract-check' } };
}
function approval(mapping) {
  validateMapping(mapping);
  return { schemaVersion: 1, manifestId: 'realtime-next-20261031', approved: true, approvedBy: 'user-in-this-chat', approvalDate: '2026-10-31', timezone: 'Asia/Shanghai', cap: CAP, currency: 'CNY',
    evidence: [{ text: '预算还是70元，其它的你去让子代理协同准备', scope: 'campaign aggregate cap and collaborative preparation' }, { text: 'key还是沿用之前准备好的，按顺序映射使用', scope: 'original credentials references; ordered scheme isolation' }],
    allowedReferences: [...mapping.assigned, ...mapping.reserved].map(r => r.credentialAlias), excludedGroups: [],
    phaseGate: 'prepare-only; no paid dispatch until preparation acceptance and public provider-contract verification',
    allRoles: ['initial', 'tool-continuation', 'repair', 'infrastructure-retry', 'summary', 'evidence-correction'], oldCampaignBalanceTransferred: false };
}
function pricingEnvelope(model, historicalMeans = [0.015002, 0.030549]) {
  const rates = model.pricingSchedule?.peak ?? model.rates;
  const perUnknownRequestCeiling = model.liabilityBound ? (model.liabilityBound.inputTokens * Math.max(rates.cachedInput, rates.uncachedInput) + model.liabilityBound.outputTokens * rates.output) / 1e6 : null;
  const outputs = STAGES.reduce((n, s) => n + s.outputs, 0);
  return { currency: 'CNY', approvedCap: CAP, outputOpportunities: outputs, exactHttpCount: null, exactCampaignCost: null,
    inheritedRates: structuredClone(model.pricingSchedule ?? model.rates), publicVerification: 'pending-current-source-check',
    fullRunCostGuaranteedWithinCap: false, reasons: ['No added model/tool call count ceiling; physical calls are data dependent.', 'New summaries, W-C/W-V, prompt variants and shared server caches lack measured usage.', 'Historical full-context liability proof must be reverified before paid use.'],
    historicalMeanScenarioOnly: { range: historicalMeans, total: historicalMeans.map(x => Number((x * outputs).toFixed(4))), source: '20261030 observed NED and SA-K known cost per planned node, not a prediction interval or upper bound' },
    inheritedUnknownRequestHold: perUnknownRequestCeiling,
    lowerBound: { amount: 0, meaning: 'No paid requests during preparation; not a promised live campaign price.' },
    upperBound: { amount: null, meaning: 'No valid total HTTP bound; aggregate admission must enforce approved cap including known charges, reservations and unknown exposure. Exhausting cap stops execution rather than guarantees completion.' } };
}
function writeJSON(filename, value) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n'); }
function freezePreparation(output, files, metadata = {}) {
  const resolved = path.resolve(output), listing = {};
  for (const file of files) { const absolute = path.resolve(resolved, file); if (!absolute.startsWith(resolved + path.sep)) throw new Error('Preparation manifest path escape'); listing[file.replaceAll('\\', '/')] = hashFile(absolute); }
  const body = { schemaVersion: 1, version: VERSION, mode: 'prepare-only', createdAt: new Date().toISOString(), files: listing, ...metadata };
  const manifest = { ...body, hash: stableHash(body) }; writeJSON(path.join(resolved, 'preparation.manifest.json'), manifest); return manifest;
}
function verifyPreparation(output) {
  const manifest = readJSON(path.join(output, 'preparation.manifest.json')), { hash, ...body } = manifest;
  if (stableHash(body) !== hash) throw new Error('Preparation manifest content mismatch');
  for (const [relative, expected] of Object.entries(body.files)) { const absolute = path.resolve(output, relative); if (!absolute.startsWith(path.resolve(output) + path.sep) || hashFile(absolute) !== expected) throw new Error('Preparation artifact mismatch: ' + relative); }
  return manifest;
}
module.exports = { VERSION, CORE, EVENTS, COMPRESSION, ALL_HISTORY, SCHEME_ORDER, RESERVED, STAGES, CAP, originalSlots, makeKeyMapping, validateMapping, stripNonRealtime, validateInputs, phaseSuite, stagePlan, approval, pricingEnvelope, freezePreparation, verifyPreparation, hashFile, readJSON, writeJSON };
