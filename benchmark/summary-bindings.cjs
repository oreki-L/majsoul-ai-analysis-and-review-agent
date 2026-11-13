'use strict';
// Pure body/envelope binding. Provenance is locally auditable evidence, not a provider signature.
const crypto = require('node:crypto');
const Core = require('./core.cjs');
const Next = require('./next-stage-context.cjs');
const VERSION = 'shared-summary-bindings/1';
const rawHash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const contentHash = d => Core.stableHash({ contract: d.contract, source: d.source, watermark: d.watermark });
const bodyOf = v => ({ schemaVersion: v.schemaVersion, facts: v.facts, opinions: v.opinions, limitations: v.limitations });
const same = (a,b) => Core.stableHash(a) === Core.stableHash(b);
function fail(s) { throw new Error('Summary bindings: ' + s); }
function createArtifact(sourceIdentity, descriptors, generations) {
  if (!sourceIdentity?.hash || !sourceIdentity.runId || !sourceIdentity.contractHash) fail('source identity required');
  const groups = new Map();
  for (const d of descriptors) {
    if (!['C-L','C-KM'].includes(d.scope?.schemeId) || d.contract !== Next.SUMMARY_CONTRACT || d.kind !== 'next-stage-facts') fail('fact descriptor required');
    const h = contentHash(d), rows = groups.get(h) ?? []; rows.push(d); groups.set(h,rows);
  }
  if (!groups.size || !Array.isArray(generations) || generations.length !== groups.size) fail('complete generation set required');
  const seen = new Set(), bindings = [];
  for (const g of generations) {
    const ds = groups.get(g.sharedContentHash);
    if (!ds || seen.has(g.sharedContentHash) || ds.length !== 2 || new Set(ds.map(d=>d.scope.schemeId)).size !== 2) fail('shared content group mismatch');
    seen.add(g.sharedContentHash);
    const original = ds.find(d=>d.sourceHash === g.descriptorSourceHash);
    if (!original || typeof g.rawText !== 'string' || rawHash(g.rawText) !== g.rawResponseHash) fail('raw response/hash mismatch');
    const p = g.provenance;
    if (!p || p.mode !== 'live' || p.synthetic !== false || !p.runId || !p.contractHash || !p.requestId || !p.modelId || p.dispatchedModelRequests < 1 || p.simulatedModelRequests !== 0 || p.sourceFixture !== false || !Number.isFinite(Date.parse(p.startedAt)) || !Number.isFinite(Date.parse(p.finishedAt)) || Date.parse(p.finishedAt) < Date.parse(p.startedAt)) fail('real generation provenance required');
    if (!g.review?.accepted || g.review.rawResponseHash !== g.rawResponseHash || !g.review.evidenceHash || !g.review.reviewer) fail('independent semantic review required');
    const checked = Next.validateSummary(g.rawText,original);
    if (!checked.valid) fail('original summary invalid: '+checked.code);
    // A structurally valid empty/mock body must not silently count as tested content.
    if (!checked.value.facts.length || checked.value.opinions.length || /SYNTHETIC|workflow-only/.test(g.rawText)) fail('real factual body required');
    const body = bodyOf(checked.value), bodyHash = Core.stableHash(body);
    for (const d of ds) {
      const value = { ...body, sourceHash:d.sourceHash, coveredSourceIds:d.coveredSourceIds };
      const text = JSON.stringify(value);
      if (!Next.validateSummary(text,d).valid || !same(bodyOf(JSON.parse(text)),body)) fail('derived envelope mismatch');
      const envelope = { id:d.id,sourceHash:d.sourceHash,scope:d.scope,coveredSourceIds:d.coveredSourceIds,coveredDecisionIds:d.coveredDecisionIds,
        watermark:d.watermark,sourceIdentity,sharedContentHash:g.sharedContentHash,bodyHash,rawResponseHash:g.rawResponseHash };
      bindings.push({ ...envelope,envelopeHash:Core.stableHash(envelope),status:'ready',text });
    }
  }
  const value = { schemaVersion:1,version:VERSION,sourceIdentity,generations:structuredClone(generations),bindings };
  return { ...value,hash:Core.stableHash(value) };
}
function validateArtifact(artifact, expectedHash, sourceIdentity, descriptors) {
  if (!expectedHash || artifact?.hash !== expectedHash) fail('artifact expected hash required/mismatch');
  const { hash,...value } = artifact;
  if (Core.stableHash(value) !== hash || artifact.version !== VERSION || !same(artifact.sourceIdentity,sourceIdentity)) fail('artifact/source hash mismatch');
  const rebuilt = createArtifact(sourceIdentity,descriptors,artifact.generations);
  if (!same(rebuilt,artifact)) fail('body/envelope tampering');
  return rebuilt;
}
module.exports = { VERSION, rawHash, contentHash, bodyOf, createArtifact, validateArtifact };
