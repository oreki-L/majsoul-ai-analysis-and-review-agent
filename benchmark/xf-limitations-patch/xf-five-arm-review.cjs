'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const [folder, common, mode, mockFolder] = process.argv.slice(2);
assert(folder && common && ['--export', '--accept'].includes(mode));
assert(!mockFolder || mode === '--export');
const dir = path.resolve(mockFolder || folder);
const release = path.join(__dirname, 'xf-release-old29/extension');
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
  checkpoint: path.join(dir, 'checkpoint.json'),
  inputs: path.join(__dirname, 'xf-release-old29/INPUTS.private.json'),
  plan: path.join(folder, 'PLAN.private.json')
};
const sourceHashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, sha(file)]));
const rules = read(rulesFile);
assert.equal(rules.requiredModel, 'gpt-6.2-sol');
assert.equal(rules.reasoningEffort, 'low');
const rulesHash = stableHash(rules);
const checkpoint = read(files.checkpoint);
const points = read(files.dataset).rounds.flatMap(round => round.decisions.map(node => ({ round: round.id, node })));
assert.equal(points.length, 29);
const accepted = ['complete', 'finished-with-failures', 'budget-stopped', 'partial-reconciled'];
assert(accepted.includes(checkpoint.status), 'Run has not reached a reconciled terminal state');
const plan = read(files.plan);
assert.equal(plan.points, 29);
assert.equal(plan.arms.length, 5);
assert.equal(plan.opportunities, 145);
const frozen = read(files.inputs);
assert.equal(sha(files.inputs), plan.sourceHashes.oldInputs);
assert.equal(checkpoint.runId, `xf-five-arm-old29:${createHash('sha256').update(JSON.stringify(plan)).digest('hex')}`);
if (!mockFolder) assert.equal(read(path.join(dir, 'EXECUTION_ACCEPTANCE.json')).checkpointSha256, sourceHashes.checkpoint);
const inputById = new Map(frozen.inputs.map(input => [input.decisionId, input]));
const manifestFile = path.join(dir, 'REVIEW_MANIFEST.private.json');
const initialDir = path.join(__dirname, 'xf-five-arm-old29');
const partialDir = path.join(__dirname, 'xf-five-arm-old29-final');
const comparisonDir = path.join(__dirname, 'xf-five-arm-old29-comparison');
const supplementDir = path.join(__dirname, 'xf-five-arm-old29-supplement');
const qualitySources = { initial: initialDir, partial: partialDir, comparison: comparisonDir, supplement: supplementDir };
const partialQualityFile = path.join(partialDir, 'QUALITY_RESULTS.json');

function checkComparisonQuality(quality, file) {
  assert.equal(plan.retainComparisonScores, true);
  assert.equal(sha(file), plan.sourceHashes.comparisonQuality);
  assert.equal(quality.sourceHashes.checkpoint, plan.priorCheckpointSha256);
  assert.equal(quality.sourceHashes.checkpoint, sha(path.join(comparisonDir, 'checkpoint.json')));
  assert.equal(quality.runId, read(path.join(comparisonDir, 'EXECUTION_ACCEPTANCE.json')).runId);
}

function checkSupplementQuality(quality) {
  assert.equal(plan.retainSupplementScores, true);
  const supplementManifestFile = path.join(supplementDir, 'REVIEW_MANIFEST.private.json');
  assert.equal(sha(supplementManifestFile), plan.sourceHashes.supplementReviewManifest);
  const previous = read(supplementManifestFile);
  assert.equal(quality.runId, previous.runId);
  assert.deepEqual(quality.sourceHashes, previous.sourceHashes);
  assert.equal(quality.sourceHashes.checkpoint, plan.priorCheckpointSha256);
  assert.equal(quality.sourceHashes.checkpoint, sha(path.join(supplementDir, 'checkpoint.json')));
  assert.equal(quality.sourceHashes.rules, sourceHashes.rules);
  assert.equal(quality.sourceHashes.dataset, sourceHashes.dataset);
  assert.equal(quality.sourceHashes.inputs, sourceHashes.inputs);
  assert.equal(quality.model, rules.requiredModel);
  assert.equal(quality.reasoningEffort, rules.reasoningEffort);
  assert.equal(quality.outcomes.length, previous.outcomes.length);
  for (const [index, row] of previous.outcomes.entries()) {
    const { gate, mean, dimensions, errors, ...record } = quality.outcomes[index];
    assert.deepEqual(record, row);
  }
  assert.equal(quality.reviewed, previous.outcomes.filter(row => row.blindId).length);
}

if (mode === '--export') {
  const Analysis = require(path.join(release, 'analysis.js'));
  const jobs = [];
  const retainedReviews = [];
  const retainedSource = plan.retainSupplementScores ? 'supplement' : plan.retainComparisonScores ? 'comparison' :
    plan.recoveryRunId ? (dir !== partialDir && fs.existsSync(partialQualityFile) ? 'partial' : 'initial') : null;
  const initialQualityFile = retainedSource && path.join(qualitySources[retainedSource], 'QUALITY_RESULTS.json');
  const initialQuality = retainedSource && read(initialQualityFile);
  if (initialQuality) {
    if (retainedSource === 'initial') {
      assert.equal(initialQuality.runId, plan.originalRunId);
      assert.equal(initialQuality.sourceHashes.checkpoint, plan.originalCheckpointSha256);
    } else if (retainedSource === 'comparison') {
      checkComparisonQuality(initialQuality, initialQualityFile);
    } else if (retainedSource === 'supplement') {
      checkSupplementQuality(initialQuality);
    } else {
      const partialAudit = read(path.join(partialDir, 'EXECUTION_ACCEPTANCE.json'));
      assert.equal(initialQuality.runId, partialAudit.runId);
      assert.equal(initialQuality.sourceHashes.checkpoint, partialAudit.checkpointSha256);
      assert.equal(initialQuality.sourceHashes.checkpoint, sha(path.join(partialDir, 'checkpoint.json')));
      assert.equal(initialQuality.status, 'partial-reconciled');
    }
    assert.equal(initialQuality.sourceHashes.rules, sourceHashes.rules);
    assert.equal(initialQuality.sourceHashes.dataset, sourceHashes.dataset);
    assert.equal(initialQuality.sourceHashes.inputs, sourceHashes.inputs);
  }
  const outcomes = points.flatMap(({ round, node }) => plan.arms.map(arm => {
    const id = `${arm}:${node.id}`;
    const result = checkpoint.results[id];
    const input = inputById.get(node.id);
    assert(input && input.snapshot.lastStep === node.position);
    const attempts = Object.values(checkpoint.attempts).filter(attempt => attempt.logicalId === id);
    const finalAttempt = attempts.filter(attempt => ['settled', 'reused', 'carried'].includes(attempt.status)).at(-1);
    const outcome = { arm, decisionId: node.id, round, terminal: !!result, delivered: result?.status === 'success',
      elapsedMs: result?.elapsedMs ?? null, timingBasis: result?.timingBasis ?? null,
      attempts: attempts.length, repaired: false, blindId: null };
    if (!result?.text?.trim() || !finalAttempt) return outcome;
    const raw = JSON.parse(read(path.join(dir, finalAttempt.responseFile)).rawText);
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
    const requireCarried = ['comparison', 'supplement'].includes(retainedSource);
    const isRetained = requireCarried ? finalAttempt.status === 'carried' :
      outcome.timingBasis === 'original-unchanged' || (retainedSource === 'partial' && outcome.timingBasis === 'recovery-observed');
    const original = isRetained
      ? initialQuality.outcomes.find(entry => entry.arm === arm && entry.decisionId === node.id) : null;
    if (requireCarried && isRetained) assert(original?.blindId);
    const blindId = original?.blindId ?? randomUUID();
    const packet = { schemaVersion: 1, blindId, target: 'final', delivered: outcome.delivered, rules, answer: result.text, facts };
    assert(!/"(?:schemeId|credentialAlias|keyAlias|rates|preferred|candidateWeights)"\s*:/.test(JSON.stringify(packet)));
    const job = { ...packet, sourceHash: stableHash(packet), rulesHash };
    if (original?.blindId) {
      const review = initialQuality.reviews.find(entry => entry.blindId === blindId);
      validateReviewResult({ blindId, sourceHash: job.sourceHash, rulesHash, packet }, review);
      retainedReviews.push({ job, reviewHash: stableHash(review) });
    } else {
      jobs.push(job);
    }
    outcome.blindId = blindId;
    return outcome;
  }));
  if (['comparison', 'supplement'].includes(retainedSource)) assert.equal(retainedReviews.length, initialQuality.reviewed);
  assert(!fs.existsSync(manifestFile), 'Existing review manifest must be retained');
  const template = path.join(original, 'execution', 'evaluation', 'blind-shards', 'original-01');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'first-answer-review-'));
  const brief = fs.readFileSync(path.join(template, 'REVIEW_BRIEF.md'), 'utf8')
    .replace('model gpt-6-sol, reasoningEffort medium', 'model gpt-6.2-sol, reasoningEffort low');
  const validator = fs.readFileSync(path.join(template, 'validate.cjs'), 'utf8')
    .replaceAll(/'\.\.\/\.\.\/\.\.\/v8-source\/benchmark\/([^']+)'/g, (_, name) => JSON.stringify(path.join(bench, name)));
  const buckets = Array.from({ length: jobs.length === 0 ? 0 : jobs.length <= 12 ? 1 : 3 }, () => []);
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
  write(manifestFile, { runId: checkpoint.runId, sourceHashes, rulesHash, outcomes, shards, retainedReviews,
    retainedSource, initialQualitySha256: initialQuality ? sha(initialQualityFile) : null });
  console.log(JSON.stringify({ planned: plan.opportunities, reviewable: jobs.length + retainedReviews.length,
    retained: retainedReviews.length, newReviews: jobs.length, shards }));
} else {
  const manifest = read(manifestFile);
  assert.deepEqual(manifest.sourceHashes, sourceHashes);
  assert.equal(manifest.rulesHash, rulesHash);
  assert.equal(manifest.runId, checkpoint.runId);
  const dispatch = read(path.join(dir, 'REVIEW_DISPATCH.json'));
  assert.equal(dispatch.runId, manifest.runId);
  assert.equal(dispatch.manifestSha256, sha(manifestFile));
  assert.equal(dispatch.model, `sub2api/${rules.requiredModel}`);
  assert.equal(dispatch.reasoningEffort, rules.reasoningEffort);
  assert.equal(dispatch.forkTurns, 'none');
  assert.deepEqual(dispatch.shards.map(({ agent, ...shard }) => shard),
    manifest.shards.map(({ id, count, packetsHash }) => ({ id, count, packetsHash })));
  assert.equal(new Set(dispatch.shards.map(shard => shard.agent)).size, manifest.shards.length);
  const results = new Map();
  const means = new Map();
  if (manifest.retainedReviews?.length) {
    const retainedSource = manifest.retainedSource ?? 'initial';
    assert(Object.hasOwn(qualitySources, retainedSource));
    const initialQualityFile = path.join(qualitySources[retainedSource], 'QUALITY_RESULTS.json');
    assert.equal(manifest.initialQualitySha256, sha(initialQualityFile));
    const initialQuality = read(initialQualityFile);
    if (retainedSource === 'initial') assert.equal(initialQuality.runId, plan.originalRunId);
    else if (retainedSource === 'comparison') checkComparisonQuality(initialQuality, initialQualityFile);
    else if (retainedSource === 'supplement') checkSupplementQuality(initialQuality);
    else assert.equal(initialQuality.runId, read(path.join(partialDir, 'EXECUTION_ACCEPTANCE.json')).runId);
    for (const { job, reviewHash } of manifest.retainedReviews) {
      const { blindId, sourceHash, rulesHash: jobRulesHash, ...rest } = job;
      const packet = { blindId, ...rest };
      const review = initialQuality.reviews.find(entry => entry.blindId === blindId);
      assert.equal(stableHash(packet), sourceHash);
      assert.equal(jobRulesHash, rulesHash);
      assert.equal(stableHash(review), reviewHash);
      const validated = validateReviewResult({ blindId, sourceHash, rulesHash, packet }, review);
      assert(!results.has(blindId));
      results.set(blindId, review);
      means.set(blindId, validated.mean);
    }
  }
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
      const validated = validateReviewResult({ blindId: entry.blindId, sourceHash, rulesHash, packet }, review);
      assert.deepEqual(review, read(path.join(shard.folder, 'reviews', `${entry.blindId}.json`)));
      assert(!results.has(entry.blindId));
      results.set(entry.blindId, review);
      means.set(entry.blindId, validated.mean);
    }
  }
  const outcomes = manifest.outcomes.map(outcome => {
    const review = outcome.blindId ? results.get(outcome.blindId) : null;
    if (outcome.blindId) assert(review);
    return { ...outcome, gate: review?.gate.status ?? null, mean: means.get(outcome.blindId) ?? null,
      dimensions: review?.dimensions ?? null, errors: review?.errors ?? null };
  });
  assert.equal(results.size, outcomes.filter(outcome => outcome.blindId).length);
  const summary = { planned: plan.opportunities, status: checkpoint.status, terminal: outcomes.filter(o => o.terminal).length,
    reviewed: results.size, delivered: outcomes.filter(o => o.delivered).length, repaired: outcomes.filter(o => o.repaired).length,
    pass: outcomes.filter(o => o.gate === 'pass').length, fail: outcomes.filter(o => o.gate === 'fail').length,
    needsReview: outcomes.filter(o => o.gate === 'needs_review').length };
  const avg = numbers => numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
  const groupMetrics = rows => {
    const scores = rows.map(row => row.mean).filter(Number.isFinite);
    const times = rows.filter(row => row.timingBasis !== 'replayed-first').map(row => row.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b);
    return { planned: rows.length, reviewed: rows.filter(row => row.blindId).length, delivered: rows.filter(row => row.delivered).length,
      repaired: rows.filter(row => row.repaired).length, pass: rows.filter(row => row.gate === 'pass').length,
      fail: rows.filter(row => row.gate === 'fail').length, needsReview: rows.filter(row => row.gate === 'needs_review').length,
      scored: scores.length, averageScore: avg(scores), timed: times.length,
      meanMs: avg(times), p95Ms: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null };
  };
  const groups = Object.fromEntries(plan.arms.map(arm => [arm, { ...groupMetrics(outcomes.filter(row => row.arm === arm)),
    cost: Object.values(checkpoint.attempts).filter(a => a.logicalId.startsWith(`${arm}:`) && ['settled', 'reused', 'carried'].includes(a.status))
      .reduce((sum, a) => sum + (a.cost ?? 0), 0) }]));
  const comparisons = Object.fromEntries(plan.arms.slice(1).map(arm => {
    const pairs = plan.rows.map(point => {
      const control = outcomes.find(o => o.arm === 'base' && o.decisionId === point.decisionId);
      const candidate = outcomes.find(o => o.arm === arm && o.decisionId === point.decisionId);
      const determined = [control.gate, candidate.gate].every(gate => ['pass', 'fail'].includes(gate));
      return { decisionId: point.decisionId, round: point.round, advised: point.advice.length > 0, controlGate: control.gate,
        candidateGate: candidate.gate, controlErrors: control.errors, candidateErrors: candidate.errors,
        change: !determined ? 'undetermined' : control.gate === candidate.gate ? 'same' : candidate.gate === 'pass' ? 'improved' : 'regressed' };
    });
    const counts = rows => Object.fromEntries(['improved', 'regressed', 'same', 'undetermined'].map(change => [change, rows.filter(row => row.change === change).length]));
    return [arm, { ...counts(pairs), ...(arm === 'advice' && { exposed: counts(pairs.filter(row => row.advised)),
      identicalInput: counts(pairs.filter(row => !row.advised)) }), pairs }];
  }));
  write(path.join(dir, 'QUALITY_RESULTS.json'), { ...summary, runId: checkpoint.runId, model: rules.requiredModel,
    reasoningEffort: rules.reasoningEffort, sourceHashes, groups, comparisons, outcomes, reviews: [...results.values()] });
  console.log(JSON.stringify({ ...summary, groups }));
}
