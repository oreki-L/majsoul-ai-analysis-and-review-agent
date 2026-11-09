'use strict';
// Read-only bridge to the previous campaign. Original records and reviews stay immutable.
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { sha256 } = require('./prompts.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function loadReuse(output) {
  const contractFile = path.join(output, 'contract.json');
  if (!fs.existsSync(contractFile)) return null;
  const contract = read(contractFile);
  if (!contract.reusePlanHash) return null;
  const plan = read(path.join(output, 'reuse-plan.json'));
  if (plan.kind !== 'mortal-teaching-reuse-v1' || stableHash(plan) !== contract.reusePlanHash || plan.datasetHash !== contract.datasetHash || plan.manifestHash !== contract.manifestHash || plan.rulesHash !== contract.rulesHash) throw new Error('Frozen reuse plan changed');
  for (const [file, hash] of Object.entries(plan.sourceFiles)) {
    const absolute = path.resolve(plan.sourceDirectory, file);
    if (!absolute.startsWith(path.resolve(plan.sourceDirectory) + path.sep) || sha256(fs.readFileSync(absolute)) !== hash) throw new Error('Original reuse evidence changed: ' + file);
  }
  const byFile = new Map();
  function records(file) {
    if (!Object.hasOwn(plan.sourceFiles, file)) throw new Error('Reuse source is not frozen');
    if (!byFile.has(file)) byFile.set(file, readEvents(path.join(plan.sourceDirectory, file)));
    return byFile.get(file);
  }
  function original(spec) {
    const rows = records(spec.file).filter(e => e.kind === 'result' && e.payload.id === spec.sourceId);
    if (rows.length !== 1 || stableHash(rows[0].payload) !== spec.sourceHash) throw new Error('Reused result identity changed');
    return rows[0].payload;
  }
  let oldReviews;
  function sourceReview(spec) {
    if (!oldReviews) {
      oldReviews = new Map();
      for (const event of records('review/queue.jsonl')) if (event.kind === 'job') oldReviews.set(event.payload.resultId, event.payload);
    }
    const source = oldReviews.get(spec.sourceId);
    if (!source || stableHash(source) !== spec.sourceReviewHash) throw new Error('Reused review identity changed');
    return source;
  }
  function rows(stage = 'development', winner) {
    const specs = stage === 'development' ? plan.main : stage === 'supplement' && winner === plan.supplementWinner ? plan.supplement : [];
    return specs.map(spec => {
      const row = structuredClone(original(spec));
      row.id = spec.id; row.variant = spec.variant; row.roundId = spec.roundId;
      if (row.reviewSource) row.reviewSource.resultId = spec.id;
      row.reuseProvenance = { sourceFile: path.join(plan.sourceDirectory, spec.file), sourceSha256: plan.sourceFiles[spec.file], sourceId: spec.sourceId,
        sourceRecordHash: spec.sourceHash, billingJobId: spec.sourceId, reviewReused: row.delivered, noNewDispatch: true };
      return row;
    });
  }
  function importReviews(queue, stage = 'development', winner, mock = false) {
    const specs = stage === 'development' ? plan.main : stage === 'supplement' && winner === plan.supplementWinner ? plan.supplement : [];
    for (const spec of specs) if (spec.sourceReviewHash) queue.importReused({ resultId: (mock ? 'mock:' : '') + spec.id, sourceJob: sourceReview(spec),
      provenance: { sourceFile: path.join(plan.sourceDirectory, 'review/queue.jsonl'), sourceSha256: plan.sourceFiles['review/queue.jsonl'], sourceResultFile: spec.file, sourceRecordHash: spec.sourceHash } });
  }
  function engines() {
    return plan.engines.map(spec => {
      let result;
      if (spec.file === 'engine-cache.jsonl') {
        const events = records(spec.file).filter(e => e.kind === 'result' && e.payload.nodeId === spec.nodeId);
        if (events.length !== 1 || stableHash(events[0].payload) !== spec.sourceHash) throw new Error('Reused engine cache changed');
        result = events[0].payload.result;
      } else result = original(spec).outcome;
      if (!result?.engine?.action) throw new Error('Missing original engine action');
      require('../../extension/contracts/engine-result.js').checkIdentity(result.engine, 'yuchen-582500');
      if (/mock/i.test(result.engine.identity.runtime)) throw new Error('Synthetic engine cannot be reused');
      return { nodeId: spec.nodeId, inputHash: spec.inputHash, result: structuredClone(result), reuseProvenance: { sourceFile: spec.file, sourceRecordHash: spec.sourceHash, noNewInference: true } };
    });
  }
  return { plan, rows, importReviews, engines };
}
function mergedRows(output, directory, stage, winner) {
  const reuse = loadReuse(output), imported = reuse?.rows(stage, winner) || [];
  const generated = readEvents(path.join(directory, 'results.jsonl')).filter(e => e.kind === 'result').map(e => e.payload);
  const ids = new Set(imported.map(r => r.id));
  if (generated.some(r => ids.has(r.id)) || new Set(generated.map(r => r.id)).size !== generated.length) throw new Error('Duplicate generated/reused logical result');
  return [...imported, ...generated];
}
function inheritedSmoke(output, contract) {
  const reuse = loadReuse(output);
  if (!reuse || !contract.reusedSmoke) throw new Error('No inherited smoke proof');
  const source = read(path.join(reuse.plan.sourceDirectory, 'contract.json'));
  const proof = read(path.join(reuse.plan.sourceDirectory, 'json-smoke.json'));
  const events = readEvents(path.join(reuse.plan.sourceDirectory, 'json-smoke.jsonl'));
  if (source.batchId !== contract.reusedSmoke.sourceBatchId || source.manifestHash !== contract.manifestHash || source.rulesHash !== contract.rulesHash || proof.batchId !== source.batchId || proof.manifestHash !== contract.manifestHash || proof.mock !== false || !proof.passed || proof.logHash !== stableHash(events) || !Object.values(proof.checks).every(Boolean) || !events.some(e => e.kind === 'result' && e.payload.passed === true)) throw new Error('Inherited real smoke proof invalid');
  return { ...proof, reused: true, currentBatchId: contract.batchId, provenance: contract.reusedSmoke, semantics: 'Original real protocol proof retained; no new smoke request and no claim of a fresh current-batch measurement.' };
}
module.exports = { loadReuse, mergedRows, inheritedSmoke };
