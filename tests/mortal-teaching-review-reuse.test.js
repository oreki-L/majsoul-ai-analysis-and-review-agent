'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableHash } = require('../benchmark/core.cjs');
const { journal } = require('../benchmark/durable.cjs');
const { createQueue, COMMON } = require('../benchmark/mortal-teaching/review.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mortal-review-reuse-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceDirectory = path.join(directory, 'source'), targetDirectory = path.join(directory, 'target');
  const source = createQueue(sourceDirectory, 'old-dataset');
  const packet = source.add({ resultId: 'old-result', answer: '原始测试回答', facts: { snapshot: { hand: ['1m'] }, legalActions: ['1m'] } });
  const attestation = { model: 'gpt-6.1-sol', reasoningEffort: 'medium', evidence: 'synthetic offline test',
    billing: { kind: 'included-in-subscription', additionalApiChargeCny: 0, evidence: 'synthetic offline test' } };
  const review = { blindId: packet.blindId, sourceHash: packet.sourceHash, rulesHash: packet.rulesHash, datasetHash: packet.datasetHash,
    model: attestation.model, reasoningEffort: attestation.reasoningEffort,
    comparison: { actual: false, requested: false, rationale: '未要求比较。' },
    scores: { ...Object.fromEntries(COMMON.map(key => [key, 3])), legal_comparison: null },
    citations: [{ target: 'answer', quote: '原始测试回答' }, { target: 'facts', quote: '1m' }], errors: [], unresolved: [] };
  source.importResults([review], attestation);
  const sourceJob = source.snapshot()[0], sourceFile = path.join(sourceDirectory, 'queue.jsonl');
  const bytes = fs.readFileSync(sourceFile);
  const provenance = { sourceFile, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  return { sourceJob, targetDirectory, provenance, bytes, attestation, rawReview: review };
}

test('cross-dataset reuse keeps original score identity, citations and denominator with zero calls', t => {
  const f = fixture(t), previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Network forbidden in offline reuse test'); };
  t.after(() => { global.fetch = previousFetch; });
  const q = createQueue(f.targetDirectory, 'expanded-dataset');
  const packet = q.importReused({ resultId: 'new-result', sourceJob: f.sourceJob, provenance: f.provenance });
  assert.equal(packet.datasetHash, 'expanded-dataset');
  assert.notEqual(packet.blindId, f.sourceJob.packet.blindId);
  assert.notEqual(packet.sourceHash, f.sourceJob.packet.sourceHash);
  const reused = q.snapshot()[0];
  assert.deepEqual(reused.review, f.sourceJob.review);
  assert.equal(reused.review.datasetHash, 'old-dataset');
  assert.equal(reused.review.blindId, f.sourceJob.packet.blindId);
  assert.equal(reused.state, 'complete');
  assert.equal(reused.review.commonMean, 3);
  assert.equal(reused.review.contractMean, 3);
  assert.equal(reused.review.comparisonApplicable, false);
  assert.equal(Object.values(reused.review.scores).filter(Number.isFinite).length, 5);
  assert.deepEqual(reused.reviewOrigin, { provenance: f.provenance, sourceResultId: 'old-result', sourceDatasetHash: 'old-dataset',
    sourcePacket: f.sourceJob.packet, sourceContentHash: f.sourceJob.contentHash, sourceReviewHash: stableHash(f.sourceJob.review) });
  const batch = JSON.parse(fs.readFileSync(q.exportPackets(), 'utf8'));
  assert.deepEqual(batch.order, []);
  assert.deepEqual(createQueue(f.targetDirectory, 'expanded-dataset').snapshot(), q.snapshot());
  const eventBytes = fs.readFileSync(path.join(f.targetDirectory, 'queue.jsonl'));
  q.importReused({ resultId: 'new-result', sourceJob: f.sourceJob, provenance: f.provenance });
  assert.deepEqual(fs.readFileSync(path.join(f.targetDirectory, 'queue.jsonl')), eventBytes);
  assert.deepEqual(fs.readFileSync(f.provenance.sourceFile), f.bytes);
  assert.equal(calls, 0);
});

test('same-dataset reuse also preserves the source blind identity and normal add cannot overwrite it', t => {
  const f = fixture(t), q = createQueue(f.targetDirectory, 'old-dataset');
  q.importReused({ resultId: 'new-result', sourceJob: f.sourceJob, provenance: f.provenance });
  assert.deepEqual(q.snapshot()[0].review, f.sourceJob.review);
  assert.throws(() => q.add({ resultId: 'new-result', answer: '替换回答', facts: {} }), /overwrite/);
  assert.deepEqual(createQueue(f.targetDirectory, 'old-dataset').snapshot(), q.snapshot());
});

test('reuse rejects changed text, facts, rules, scores, incomplete jobs and missing provenance before writing', t => {
  const f = fixture(t), q = createQueue(f.targetDirectory, 'expanded-dataset');
  for (const mutate of [
    job => { job.packet.answer += '篡改'; },
    job => { job.packet.facts.snapshot.hand = ['9m']; },
    job => { job.packet.rules.anchors[4] = '任意评分'; },
    job => { job.packet.rulesHash = 'bad'; },
    job => { job.contentHash = 'bad'; },
    job => { job.review.scores.usability = 0; },
    job => { job.review.commonMean = 4; },
    job => { job.review.blindId = 'forged'; },
    job => { job.state = 'pending'; }
  ]) {
    const job = structuredClone(f.sourceJob); mutate(job);
    assert.throws(() => q.importReused({ resultId: 'new-result', sourceJob: job, provenance: f.provenance }));
    assert.deepEqual(q.snapshot(), []);
  }
  for (const provenance of [undefined, {}, [], { sourceFile: 'x' }, { sourceFile: ' ', sourceSha256: 'a'.repeat(64) }, { sourceFile: 'x', sourceSha256: 'bad' }]) {
    assert.throws(() => q.importReused({ resultId: 'new-result', sourceJob: f.sourceJob, provenance }), /provenance/);
  }
  assert.equal(fs.existsSync(path.join(f.targetDirectory, 'queue.jsonl')), false);
});

test('completed reuse refuses conflicting origins, ordinary blind imports and completed source replacement', t => {
  const f = fixture(t), q = createQueue(f.targetDirectory, 'expanded-dataset');
  const packet = q.importReused({ resultId: 'new-result', sourceJob: f.sourceJob, provenance: f.provenance });
  const before = q.snapshot();
  assert.throws(() => q.importReused({ resultId: 'new-result', sourceJob: f.sourceJob, provenance: { ...f.provenance, sourceFile: 'different-source' } }), /overwritten/);
  const differentJob = structuredClone(f.sourceJob); differentJob.resultId = 'different-result';
  assert.throws(() => q.importReused({ resultId: 'new-result', sourceJob: differentJob, provenance: f.provenance }), /overwritten/);
  assert.throws(() => q.importResults([{ ...f.rawReview, blindId: packet.blindId, datasetHash: packet.datasetHash, sourceHash: packet.sourceHash }], f.attestation), /Reused completed review/);
  assert.deepEqual(q.snapshot(), before);
  const local = q.add({ resultId: 'local', answer: '原始测试回答', facts: f.sourceJob.packet.facts });
  q.importResults([{ ...f.rawReview, blindId: local.blindId, datasetHash: local.datasetHash, sourceHash: local.sourceHash }], f.attestation);
  assert.throws(() => q.importReused({ resultId: 'local', sourceJob: f.sourceJob, provenance: f.provenance }), /overwritten/);
});

test('reopening rejects tampered reused content, scores, origin hashes and historical overwrite', t => {
  const f = fixture(t);
  const mutations = [
    job => { job.packet.answer += '篡改'; },
    job => { job.review.scores.usability = 0; },
    job => { job.reviewOrigin.sourcePacket.facts.snapshot.hand = ['9m']; },
    job => { job.reviewOrigin.sourceReviewHash = 'bad'; },
    job => { job.reviewOrigin.sourceContentHash = 'bad'; },
    job => { job.reviewOrigin.provenance.sourceFile = 'changed-origin'; },
    job => { delete job.reviewOrigin; }
  ];
  mutations.forEach((mutate, index) => {
    const directory = path.join(f.targetDirectory, String(index)), q = createQueue(directory, 'expanded-dataset');
    q.importReused({ resultId: 'new-result', sourceJob: f.sourceJob, provenance: f.provenance });
    const job = q.snapshot()[0]; mutate(job);
    // Append a valid journal event: semantic validation must reject even a
    // correctly hashed log that attempts to replace a completed score/source.
    journal(path.join(directory, 'queue.jsonl')).write('job', job);
    assert.throws(() => createQueue(directory, 'expanded-dataset'));
  });
});
