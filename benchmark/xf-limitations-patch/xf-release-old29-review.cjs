'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const [folder, common, mode] = process.argv.slice(2);
assert(folder && common && ['--export', '--accept'].includes(mode));
const dir = path.resolve(folder);
const release = path.join(dir, 'extension');
const original = path.join(common, 'xf-release-facts-history-preparation-20261113');
const bench = path.join(original, 'execution', 'v8-source', 'benchmark');
const { stableHash } = require(path.join(bench, 'core.cjs'));
const { validateReviewResult } = require(path.join(bench, 'next-stage-review.cjs'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const rulesFile = path.join(common, 'xf-s-format-execution-20261120', 'review-rules.json');
const files = {
  rules: rulesFile,
  dataset: path.join(common, 'preparation', 'dataset.old29.frozen.json'),
  checkpoint: path.join(dir, 'live', 'checkpoint.json'),
  inputs: path.join(dir, 'INPUTS.private.json'),
  audit: path.join(dir, 'OFFLINE_AUDIT.json')
};
const sourceHashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, sha(file)]));
const rules = read(rulesFile);
assert.equal(rules.requiredModel, 'gpt-6.2-sol');
assert.equal(rules.reasoningEffort, 'low');
const rulesHash = stableHash(rules);
const checkpoint = read(files.checkpoint);
const points = read(files.dataset).rounds.flatMap(round => round.decisions.map(node => ({ round: round.id, node })));
assert.equal(points.length, 29);
const accepted = ['complete', 'finished-with-failures', 'budget-stopped'];
assert(accepted.includes(checkpoint.status), 'Run has not reached a reconciled terminal state');
const audit = read(files.audit);
const frozen = read(files.inputs);
assert.equal(createHash('sha256').update(JSON.stringify(frozen)).digest('hex'), audit.inputHash);
assert.equal(checkpoint.runId, `xf-v0.16.17-old29:${createHash('sha256').update(JSON.stringify(audit)).digest('hex')}`);
const inputById = new Map(frozen.inputs.map(input => [input.decisionId, input]));
const manifestFile = path.join(dir, 'REVIEW_MANIFEST.private.json');

if (mode === '--export') {
  const Analysis = require(path.join(release, 'analysis.js'));
  const jobs = [];
  const outcomes = points.map(({ round, node }) => {
    const id = `XF:${node.id}`;
    const result = checkpoint.results[id];
    const input = inputById.get(node.id);
    assert(input && input.snapshot.lastStep === node.position);
    const attempts = Object.values(checkpoint.attempts).filter(attempt => attempt.logicalId === id);
    const finalAttempt = attempts.filter(attempt => attempt.status === 'settled').at(-1);
    const outcome = { decisionId: node.id, round, terminal: !!result, delivered: result?.status === 'success',
      elapsedMs: result?.elapsedMs ?? null, attempts: attempts.length, repaired: false, blindId: null };
    if (!result?.text?.trim() || !finalAttempt) return outcome;
    const raw = JSON.parse(read(path.join(dir, 'live', finalAttempt.responseFile)).rawText);
    const choice = raw.choices?.[0];
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') return outcome;
    outcome.repaired = outcome.delivered && choice.message.content !== result.text;
    const historicalSnapshots = input.sessionContext.capturedStates.filter(state => state.position < node.position)
      .map(state => ({ asOf: state.position, snapshot: state.snapshot }));
    const events = input.sessionContext.events;
    assert(events.every(event => event.position <= node.position));
    const snapshot = { ...input.snapshot };
    delete snapshot.availableActions;
    const facts = { snapshot, asOf: node.position, legalActions: node.legalActions, decisionContext: node.decisionContext,
      localCalculation: Analysis.prepare(snapshot, 'combined').data.localAnalysis, historicalSnapshots, events,
      evaluationBoundary: 'Authorized facts through cutoff. Local calculation is production evidence. Historical snapshots only verify historical claims.' };
    const blindId = randomUUID();
    const packet = { schemaVersion: 1, blindId, target: 'final', delivered: outcome.delivered, rules, answer: result.text, facts };
    assert(!/"(?:schemeId|credentialAlias|keyAlias|rates|preferred|candidateWeights)"\s*:/.test(JSON.stringify(packet)));
    jobs.push({ ...packet, sourceHash: stableHash(packet), rulesHash });
    outcome.blindId = blindId;
    return outcome;
  });
  assert(!fs.existsSync(manifestFile), 'Existing review manifest must be retained');
  const template = path.join(original, 'execution', 'evaluation', 'blind-shards', 'original-01');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'first-answer-review-'));
  const brief = fs.readFileSync(path.join(template, 'REVIEW_BRIEF.md'), 'utf8')
    .replace('model gpt-6-sol, reasoningEffort medium', 'model gpt-6.2-sol, reasoningEffort low');
  const validator = fs.readFileSync(path.join(template, 'validate.cjs'), 'utf8')
    .replaceAll(/'\.\.\/\.\.\/\.\.\/v8-source\/benchmark\/([^']+)'/g, (_, name) => JSON.stringify(path.join(bench, name)));
  const buckets = Array.from({ length: jobs.length <= 12 ? 1 : 2 }, () => []);
  jobs.sort((a, b) => a.blindId.localeCompare(b.blindId)).forEach((job, index) => buckets[index % buckets.length].push(job));
  const shards = buckets.filter(bucket => bucket.length).map((bucket, index) => {
    const id = `shard-${index + 1}`;
    const shardDir = path.join(work, id);
    fs.mkdirSync(path.join(shardDir, 'packets'), { recursive: true });
    const packets = bucket.map(packet => {
      const { blindId, sourceHash, rulesHash } = packet;
      const file = `packets/${blindId}.json`;
      write(path.join(shardDir, file), packet);
      return { blindId, sourceHash, rulesHash, file };
    });
    fs.writeFileSync(path.join(shardDir, 'REVIEW_BRIEF.md'), brief);
    fs.writeFileSync(path.join(shardDir, 'validate.cjs'), validator);
    write(path.join(shardDir, 'MANIFEST.json'), { model: rules.requiredModel, reasoningEffort: rules.reasoningEffort, packets });
    return { id, folder: shardDir, count: packets.length, packetsHash: stableHash(packets) };
  });
  write(manifestFile, { runId: checkpoint.runId, sourceHashes, rulesHash, outcomes, shards });
  console.log(JSON.stringify({ planned: points.length, reviewable: jobs.length, shards }));
} else {
  const manifest = read(manifestFile);
  assert.deepEqual(manifest.sourceHashes, sourceHashes);
  assert.equal(manifest.rulesHash, rulesHash);
  assert.equal(manifest.runId, checkpoint.runId);
  const results = new Map();
  for (const shard of manifest.shards) {
    const local = read(path.join(shard.folder, 'MANIFEST.json'));
    const combined = read(path.join(shard.folder, 'REVIEWS.json'));
    assert.equal(local.packets.length, shard.count);
    assert.equal(combined.reviews.length, shard.count);
    assert.equal(stableHash(local.packets), shard.packetsHash);
    assert.deepEqual(read(path.join(shard.folder, 'validation.json')), { valid: true, reviewed: shard.count,
      model: rules.requiredModel, reasoningEffort: rules.reasoningEffort, reviewHash: stableHash(combined), packetsHash: shard.packetsHash });
    for (const [index, entry] of local.packets.entries()) {
      const packet = read(path.join(shard.folder, entry.file));
      const { sourceHash, rulesHash: packetRules, ...body } = packet;
      assert.equal(stableHash(body), sourceHash);
      assert.equal(sourceHash, entry.sourceHash);
      assert.equal(packetRules, rulesHash);
      const review = combined.reviews[index];
      validateReviewResult({ blindId: entry.blindId, sourceHash, rulesHash, packet }, review);
      assert.deepEqual(review, read(path.join(shard.folder, 'reviews', `${entry.blindId}.json`)));
      assert(!results.has(entry.blindId));
      results.set(entry.blindId, review);
    }
  }
  const outcomes = manifest.outcomes.map(outcome => {
    const review = outcome.blindId ? results.get(outcome.blindId) : null;
    if (outcome.blindId) assert(review);
    return { ...outcome, gate: review?.gate.status ?? null, dimensions: review?.dimensions ?? null };
  });
  assert.equal(results.size, outcomes.filter(outcome => outcome.blindId).length);
  const summary = { planned: points.length, status: checkpoint.status, terminal: outcomes.filter(o => o.terminal).length,
    reviewed: results.size, delivered: outcomes.filter(o => o.delivered).length, repaired: outcomes.filter(o => o.repaired).length,
    pass: outcomes.filter(o => o.gate === 'pass').length, fail: outcomes.filter(o => o.gate === 'fail').length,
    needsReview: outcomes.filter(o => o.gate === 'needs_review').length };
  write(path.join(dir, 'QUALITY_RESULTS.json'), { ...summary, runId: checkpoint.runId, model: rules.requiredModel,
    reasoningEffort: rules.reasoningEffort, sourceHashes, outcomes, reviews: [...results.values()] });
  console.log(JSON.stringify(summary));
}
