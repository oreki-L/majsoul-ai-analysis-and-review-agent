'use strict';
// Offline source extraction and a statically bound context adapter. No provider or credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Core = require('./core.cjs');
const Freeze = require('./freeze.cjs');
const Next = require('./next-stage-context.cjs');
const Bindings = require('./summary-bindings.cjs');
const VERSION = 'phase2-fixed-source/1';
const POLICIES = ['C-K', 'C-L', 'C-KM', 'W-SA-K', 'W-SA-L', 'W-SA-KM'];
const same = (a, b) => Core.stableHash(a) === Core.stableHash(b);
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function fail(reason) { throw new Error('Fixed R0 source: ' + reason); }
function seal(value) { if (value && typeof value === 'object') { Object.values(value).forEach(seal); Object.freeze(value); } return value; }
function validateSource(source, expectedHash) {
  const { hash, ...body } = source;
  if (!expectedHash || hash !== expectedHash || Core.stableHash(body) !== hash) fail('source hash mismatch');
  if (source.version !== VERSION || source.provenance.mode !== 'live' || source.provenance.synthetic !== false || !source.provenance.runId || !source.provenance.contractHash || !source.provenance.checkpointHash) fail('real run provenance required');
  const rawDataset = structuredClone(source.dataset);
  for (const round of rawDataset.rounds) delete round.sessionId;
  const dataset = Core.validateDataset(rawDataset), nodes = dataset.rounds.flatMap(r => r.decisions);
  if (nodes.length !== 29 || source.entries.length !== nodes.length || !same(dataset, source.dataset) || Core.stableHash(dataset) !== source.provenance.datasetHash) fail('complete normalized 29-node dataset required');
  const seen = new Set();
  for (const entry of source.entries) {
    const node = nodes.find(n => n.id === entry.decisionId);
    if (!node || seen.has(node.id) || entry.position !== node.position || entry.roundId !== node.roundId || entry.sessionId !== node.sessionId || !same(entry.authorization, node.authorization) || !same(entry.snapshot, node.snapshot) || entry.snapshotHash !== Core.stableHash(node.snapshot)) fail('entry scope/snapshot mismatch');
    if (typeof entry.answerText !== 'string' || !entry.answerText.trim() || entry.answerTextHash !== Core.stableHash(entry.answerText) || !entry.answer?.decision || !same(entry.authorization, Core.authorizationFor(entry.snapshot))) fail('answer binding mismatch');
    if (entry.evidence.status !== 'success' || entry.evidence.dispatchedModelRequests < 1 || entry.evidence.simulatedModelRequests !== 0 || entry.evidence.sourceFixture) fail('mock/fixture/unsuccessful source forbidden');
    seen.add(node.id);
  }
  if (source.rounds.length !== dataset.rounds.length) fail('round sources incomplete');
  for (const round of dataset.rounds) {
    const captured = source.rounds.find(r => r.id === round.id);
    if (!captured?.baseline?.snapshot || !Array.isArray(captured.states) || !Array.isArray(captured.events) || captured.events.length !== round.events.length) fail('captured round source mismatch');
    for (const node of round.decisions) if (!captured.nodeBindings.some(b => b.decisionId === node.id && b.position === node.position && b.snapshotHash === Core.stableHash(node.snapshot))) fail('captured node binding mismatch');
  }
  return source;
}
function materializeRun(runRoot) {
  const contract = Freeze.verifyRun(runRoot), checkpointPath = path.join(runRoot, 'checkpoint.json'), checkpoint = read(checkpointPath);
  if (checkpoint.manifest?.mode !== 'live' || checkpoint.manifest.synthetic !== false || checkpoint.manifest.fixedSourceHash !== Core.stableHash(null) || !checkpoint.runId) fail('non-synthetic unseeded live run required');
  const dataset = Core.validateDataset(read(path.join(runRoot, 'bundle', 'dataset.json')));
  const sourceFiles = Object.keys(contract.files).filter(f => f.endsWith('round-sources.old29.frozen.json'));
  if (sourceFiles.length !== 1) fail('exact frozen old29 round source required');
  const rounds = read(path.join(runRoot, 'bundle', sourceFiles[0])).rounds;
  const histories = checkpoint.histories['0:R0'] ?? [];
  const results = checkpoint.results.filter(r => r.schemeId === 'R0' && r.channel === 'main' && r.repeat === 0);
  const entries = dataset.rounds.flatMap(r => r.decisions).map(node => {
    const matches = histories.filter(h => h.decisionId === node.id), rows = results.filter(r => r.decisionId === node.id);
    if (matches.length !== 1 || rows.length !== 1 || rows[0].status !== 'success' || rows[0].sourceFixture) fail('missing/duplicate/fixture R0 success');
    const h = matches[0], id = rows[0].id, request = checkpoint.requests[id];
    if (!request || request.status !== 'success' || request.schemeId !== 'R0' || request.repeat !== 0 || request.dispatchedModelRequests < 1 || request.simulatedModelRequests !== 0 || request.response?.sourceFixture || request.response?.text !== h.answerText || !same(request.frozenInput.node, node) || !same(rows[0].answer, h.answer)) fail('real successful request/response binding mismatch');
    return { ...structuredClone(h), snapshotHash: Core.stableHash(h.snapshot), answerTextHash: Core.stableHash(h.answerText), evidence: { requestId: id, status: request.status, dispatchedModelRequests: request.dispatchedModelRequests, simulatedModelRequests: request.simulatedModelRequests, sourceFixture: false } };
  });
  if (histories.length !== 29 || results.length !== 29) fail('full 29 R0 successes required');
  const body = { schemaVersion: 1, version: VERSION, provenance: { runId: checkpoint.runId, runFingerprint: checkpoint.manifest.fingerprint, contractHash: contract.hash, checkpointHash: digest(checkpointPath), datasetHash: Core.stableHash(dataset), roundSourceFileHash: contract.files[sourceFiles[0]], mode: checkpoint.manifest.mode, synthetic: checkpoint.manifest.synthetic }, dataset, rounds, entries };
  const source = { ...body, hash: Core.stableHash(body) }; validateSource(source, source.hash); return source;
}
function createAdapter(raw, expectedHash, options = {}) {
  const source = seal(structuredClone(validateSource(raw, expectedHash)));
  let accepted = null;
  function previewContext(input) {
    const options = input.options ?? input.scheme?.context?.options ?? {}, policy = options.policy ?? input.scheme.id;
    if (!POLICIES.includes(policy) || options.sourceMode !== 'fixed-source-replay') fail('explicit fixed-source policy required');
    const node = input.node, bound = source.dataset.rounds.flatMap(r => r.decisions).find(n => n.id === node.id);
    if (!bound || !same(node, bound)) fail('current node/dataset/domain binding mismatch');
    const history = source.entries.filter(e => e.sessionId === node.sessionId && e.roundId === node.roundId && same(e.authorization, node.authorization) && e.position < node.position).sort((a, b) => a.position - b.position);
    // Next's direct fixed-source entry remains closed. Only this hash-bound adapter
    // supplies past source opinions; newly generated online history is ignored.
    const context = Next.build({ ...input, history: structuredClone(history), options: { ...options, sourceMode: 'own-causal-history' } }, source.rounds.find(r => r.id === node.roundId));
    context.sourceProvenance = { ...source.provenance, sourceHash: source.hash, sourceSchemeId: 'R0', sourceMode: 'fixed-source-replay', historyDecisionIds: history.map(h => h.decisionId), currentAnswer: 'normal-new-model-request' };
    context.historyPolicy = { ...context.historyPolicy, fixedSourceHash: source.hash, sourceMode: 'fixed-source-replay' };
    return context;
  }
  function buildContext(input) {
    let context = previewContext({ ...input, summary: [] });
    if (['C-L', 'C-KM'].includes(context.historyPolicy.nextStagePolicy)) {
      const latest = context.summaryJobs[0];
      if (!latest) {
        context.compression.summaryUse = 'code-warmup-no-eligible-checkpoint';
        context.compression.testedLlmSummary = false;
        context.compression.fallbackReason = 'no-eligible-checkpoint';
        return context;
      }
      const record = accepted?.bindings.find(r => r.id === latest.id);
      if (!record) fail('LLM summary not ready; eligible checkpoint requires accepted shared body binding');
      context = previewContext({ ...input, summary: [record] });
      if (context.compression.fallback || context.compression.summaryWatermark !== latest.watermark) fail('latest eligible summary not consumed');
      context.compression.summaryUse = 'shared-llm-body';
      context.compression.testedLlmSummary = true;
      context.sourceProvenance.summaryBinding = { artifactHash:accepted.hash, envelopeHash:record.envelopeHash, bodyHash:record.bodyHash,
        rawResponseHash:record.rawResponseHash, sharedContentHash:record.sharedContentHash, sourceHash:record.sourceHash, watermark:record.watermark };
      // Runner persists compression on each result; retain consumed-body identity there too.
      context.compression.summaryBinding = structuredClone(context.sourceProvenance.summaryBinding);
      return context;
    }
    // Other fixed-source policies retain their original supplied-summary path.
    context = previewContext(input);
    if (context.compression.fallback) fail('LLM summary not ready; offline fallback is not a tested LLM summary');
    return context;
  }
  function summaryDescriptors() {
    const descriptors = new Map();
    for (const policy of ['C-L','C-KM']) for (const round of source.dataset.rounds) for (const node of round.decisions) {
      const c = previewContext({ node,scheme:{id:policy},options:{policy,sourceMode:'fixed-source-replay'},channel:'realtime',history:[],summary:[] });
      for (const d of c.summaryJobs) { const { mockText,...descriptor } = d; descriptors.set(d.id,descriptor); }
    }
    return [...descriptors.values()];
  }
  const sourceIdentity = { hash:source.hash, runId:source.provenance.runId, contractHash:source.provenance.contractHash };
  if (options.summaryBindings) accepted = seal(Bindings.validateArtifact(options.summaryBindings,options.summaryBindingsHash,sourceIdentity,summaryDescriptors()));
  return { version: 1, buildContext, previewContext, summaryDescriptors, sourceIdentity };
}
module.exports = { VERSION, POLICIES, materializeRun, validateSource, createAdapter };
