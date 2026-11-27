'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const Analysis = require('./xf-release-old29/extension/analysis.js');
const Delivery = require('./xf-output-delivery.cjs');

const [mode, commonArg] = process.argv.slice(2);
assert(['--export', '--accept'].includes(mode) && commonArg);
const common = path.resolve(commonArg);
const root = __dirname;
const original = path.join(root, 'xf-five-arm-old29-closure');
const earlier = path.join(root, 'xf-five-arm-old29-s-repair-replay');
const output = path.join(root, 'xf-five-arm-old29-delivery-v2-review');
const bench = path.join(common, 'xf-release-facts-history-preparation-20261113/execution/v8-source/benchmark');
const { stableHash } = require(path.join(bench, 'core.cjs'));
const { validateReviewResult } = require(path.join(bench, 'next-stage-review.cjs'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const out = file => path.join(output, file);
const key = row => `${row.arm}:${row.decisionId}`;
const files = {
  rules: path.join(common, 'xf-s-format-execution-20261120/review-rules.json'),
  dataset: path.join(common, 'preparation/dataset.old29.frozen.json'),
  checkpoint: path.join(original, 'checkpoint.json'),
  inputs: path.join(root, 'xf-release-old29/INPUTS.private.json'),
  plan: path.join(original, 'PLAN.private.json'),
  originalQuality: path.join(original, 'QUALITY_RESULTS.json'),
  earlierManifest: path.join(earlier, 'REPLAY_MANIFEST.private.json'),
  earlierQuality: path.join(earlier, 'QUALITY_REPLAY_RESULTS.json'),
  earlierDispatch: path.join(earlier, 'REVIEW_DISPATCH.json'),
  replay: path.join(root, 'xf-current-facts-51-delivery-v2/LOCAL_REPLAY_RESULTS.json'),
  delivery: require.resolve('./xf-output-delivery.cjs')
};
const hashes = Object.fromEntries(Object.entries(files).map(([label, file]) => [label, hash(file)]));
const rules = read(files.rules);
const rulesHash = stableHash(rules);
const quality = read(files.originalQuality);
const previous = read(files.earlierQuality);
const previousManifest = read(files.earlierManifest);
const previousDispatch = read(files.earlierDispatch);
const replay = read(files.replay);
for (const [label, hashValue] of Object.entries(quality.sourceHashes)) assert.equal(hashes[label], hashValue);
assert.equal(replay.historicalSha256, hashes.originalQuality);
assert.equal(replay.deliverySha256, hashes.delivery);
assert.equal(previous.originalQualitySha256, hashes.originalQuality);
assert.equal(previous.replayManifestSha256, hashes.earlierManifest);
assert.equal(previousDispatch.manifestSha256, hashes.earlierManifest);
assert.equal(previous.validation.packetsHash, previousDispatch.packetsHash);
assert(previous.validation.valid && previous.validation.reviewed === 8);
assert.equal(rules.requiredModel, 'gpt-6.2-sol');
assert.equal(rules.reasoningEffort, 'low');
assert.equal(previous.validation.model, rules.requiredModel);
assert.equal(previous.validation.reasoningEffort, rules.reasoningEffort);

function exportReviews() {
  const checkpoint = read(files.checkpoint);
  const points = new Map(read(files.dataset).rounds.flatMap(round => round.decisions.map(node => [node.id, node])));
  const inputs = new Map(read(files.inputs).inputs.map(input => [input.decisionId, input]));
  const outcomes = new Map(quality.outcomes.map(row => [key(row), row]));
  const reviews = new Map(quality.reviews.map(row => [row.blindId, row]));
  const earlierCandidates = new Map(previousManifest.candidates.map(row => [key(row), row]));
  const earlierDetails = new Map(previous.detail.map(row => [key(row), row]));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xf-delivery-review-'));
  const records = [];
  const jobs = [];
  for (const saved of replay.recovered) {
    const id = key(saved);
    const row = outcomes.get(id);
    const priorReview = reviews.get(row.blindId);
    assert(!row.delivered && row.gate === 'fail');
    const node = points.get(row.decisionId);
    const input = inputs.get(row.decisionId);
    const attempt = Object.values(checkpoint.attempts).filter(entry => entry.logicalId === id &&
      ['settled', 'reused', 'carried'].includes(entry.status)).at(-1);
    const responseFile = path.join(original, attempt.responseFile);
    assert.equal(hash(responseFile), saved.responseSha256);
    const choice = JSON.parse(read(responseFile).rawText).choices[0];
    const answer = checkpoint.results[id].text;
    assert.equal(choice.finish_reason, 'stop');
    assert.equal(choice.message.content, answer);
    assert.equal(input.snapshot.lastStep, node.position);
    const snapshot = { ...input.snapshot };
    delete snapshot.availableActions;
    const prepared = Analysis.prepare(snapshot, 'combined');
    const historicalSnapshots = input.sessionContext.capturedStates.filter(state => state.position < node.position)
      .map(state => ({ asOf: state.position, snapshot: state.snapshot }));
    const events = input.sessionContext.events;
    assert(events.every(event => event.position <= node.position));
    const facts = { snapshot, asOf: node.position, legalActions: node.legalActions, decisionContext: node.decisionContext,
      localCalculation: prepared.data.localAnalysis, historicalSnapshots, events,
      evaluationBoundary: 'Authorized facts through cutoff. Local calculation is production evidence. Historical snapshots only verify historical claims.' };
    const originalPacket = { schemaVersion: 1, blindId: row.blindId, target: 'final', delivered: false, rules, answer, facts };
    assert.equal(stableHash(originalPacket), priorReview.sourceHash);
    const repair = Delivery.repairFinal(answer, prepared);
    assert.deepEqual(repair?.actions, saved.actions);
    const patched = { ...originalPacket, delivered: true, answer: repair.text };
    const earlierCandidate = earlierCandidates.get(id);
    const record = { id, responseSha256: saved.responseSha256, originalBlindId: row.blindId,
      actions: saved.actions, historicalTimeout: /timed out/.test(saved.historicalError) };
    if (earlierCandidate) {
      const detail = earlierDetails.get(id);
      const earlierPacket = { ...patched, blindId: earlierCandidate.blindId };
      if (stableHash(earlierPacket) === earlierCandidate.sourceHash) {
        assert.equal(earlierCandidate.previousBlindId, row.blindId);
        assert.equal(earlierCandidate.previousSourceHash, priorReview.sourceHash);
        assert.equal(earlierCandidate.sourceResponseSha256, saved.responseSha256);
        assert.equal(earlierCandidate.rulesHash, rulesHash);
        assert.equal(detail.blindId, earlierCandidate.blindId);
        assert.equal(detail.previousBlindId, row.blindId);
        assert.equal(detail.gate[0], row.gate);
        assert.equal(detail.mean[0], row.mean);
        assert(detail.delivered[1]);
        records.push({ ...record, blindId: detail.blindId, sourceHash: earlierCandidate.sourceHash, reused: true });
        continue;
      }
    }
    const packet = { ...patched, blindId: randomUUID() };
    const sourceHash = stableHash(packet);
    jobs.push({ ...packet, sourceHash, rulesHash });
    records.push({ ...record, blindId: packet.blindId, sourceHash, reused: false });
  }
  assert.equal(records.length, 39);
  const shards = [[], []];
  jobs.sort((a, b) => a.blindId.localeCompare(b.blindId)).forEach((job, index) => shards[index % shards.length].push(job));
  const shardManifest = shards.map(packets => {
    const folder = fs.mkdtempSync(path.join(work, 'shard-'));
    fs.mkdirSync(path.join(folder, 'packets'));
    fs.mkdirSync(path.join(folder, 'reviews'));
    for (const packet of packets) write(path.join(folder, 'packets', packet.blindId + '.json'), packet);
    const entries = packets.map(({ blindId, sourceHash }) => ({ blindId, sourceHash, file: `packets/${blindId}.json` }));
    write(path.join(folder, 'entries.json'), entries);
    return { folder, count: packets.length, packetsHash: stableHash(packets), entries };
  });
  fs.mkdirSync(output);
  write(out('REVIEW_MANIFEST.private.json'), { hashes, records, shards: shardManifest, rulesHash });
  console.log(JSON.stringify({ total: records.length, reused: records.length - jobs.length,
    shards: shardManifest.map(({ folder, count }) => ({ folder, count })),
    manifestSha256: hash(out('REVIEW_MANIFEST.private.json')) }));
}

function acceptReviews() {
  const manifestFile = out('REVIEW_MANIFEST.private.json');
  const manifest = read(manifestFile);
  const dispatch = read(out('REVIEW_DISPATCH.json'));
  assert.deepEqual(manifest.hashes, hashes);
  assert.equal(dispatch.manifestSha256, hash(manifestFile));
  assert.equal(dispatch.model, 'sub2api/gpt-6.2-sol');
  assert.equal(dispatch.reasoningEffort, 'low');
  assert.equal(dispatch.forkTurns, 'none');
  assert.deepEqual(dispatch.shards.map(s => [s.folder, s.count]), manifest.shards.map(s => [s.folder, s.count]));
  const reviews = new Map();
  for (const shard of manifest.shards) {
    assert.deepEqual(read(path.join(shard.folder, 'entries.json')), shard.entries);
    assert.deepEqual(fs.readdirSync(path.join(shard.folder, 'reviews')).sort(), shard.entries.map(row => row.blindId + '.json').sort());
    const packets = [];
    for (const entry of shard.entries) {
      const { sourceHash, rulesHash: packetRulesHash, ...packet } = read(path.join(shard.folder, entry.file));
      assert.equal(packetRulesHash, rulesHash);
      assert.equal(stableHash(packet.rules), rulesHash);
      assert.equal(packet.blindId, entry.blindId);
      assert.equal(sourceHash, entry.sourceHash);
      assert.equal(stableHash(packet), sourceHash);
      assert(packet.delivered);
      packets.push({ ...packet, sourceHash, rulesHash: packetRulesHash });
      const review = read(path.join(shard.folder, 'reviews', entry.blindId + '.json'));
      const validation = validateReviewResult({ blindId: entry.blindId, sourceHash, rulesHash, packet }, review);
      assert(!reviews.has(entry.blindId));
      reviews.set(entry.blindId, { review, mean: validation.mean });
    }
    assert.equal(stableHash(packets), shard.packetsHash);
  }
  const earlierDetails = new Map(previous.detail.map(row => [key(row), row]));
  const beforeReviews = new Map(quality.reviews.map(row => [row.blindId, row]));
  const records = new Map(manifest.records.map(row => [row.id, row]));
  assert.equal(records.size, replay.recovered.length);
  const rows = quality.outcomes.map(row => {
    const prior = { delivered: row.delivered, gate: row.gate, mean: row.mean, major: beforeReviews.get(row.blindId).gate.majorError };
    const match = records.get(key(row));
    const item = { arm: row.arm, decisionId: row.decisionId, round: row.round, prior, current: prior };
    if (!match) return item;
    const { blindId, sourceHash, reused, historicalTimeout, actions } = match;
    const linked = { ...item, blindId, sourceHash, reused, historicalTimeout, actions };
    if (reused) {
      const detail = earlierDetails.get(key(row));
      assert.equal(detail.blindId, blindId);
      return { ...linked, current: { delivered: true, gate: detail.gate[1], mean: detail.mean[1], major: detail.major[1] } };
    }
    const { review, mean } = reviews.get(blindId);
    assert.equal(review.sourceHash, sourceHash);
    return { ...linked, current: { delivered: true, gate: review.gate.status, mean, major: review.gate.majorError } };
  });
  assert.equal(reviews.size, manifest.records.filter(row => !row.reused).length);
  function summarize(rows, field) {
    const scores = rows.map(row => row[field].mean).filter(Number.isFinite);
    const index = rows.map(row => row[field]);
    return { planned: rows.length, delivered: index.filter(row => row.delivered).length,
      pass: index.filter(row => row.gate === 'pass').length, fail: index.filter(row => row.gate === 'fail').length,
      needsReview: index.filter(row => row.gate === 'needs_review').length, major: index.filter(row => row.major).length,
      scored: scores.length, mean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null };
  }
  const summarizeBoth = group => ({ before: summarize(group, 'prior'), after: summarize(group, 'current'),
    newlyPassed: group.filter(row => row.prior.gate === 'fail' && row.current.gate === 'pass').length });
  const groups = Object.fromEntries(Object.keys(quality.groups).map(arm => [arm, summarizeBoth(rows.filter(row => row.arm === arm))]));
  const overall = summarizeBoth(rows);
  assert.equal(overall.before.pass, quality.pass);
  assert.equal(overall.before.delivered, quality.delivered);
  assert.equal(overall.after.delivered, 144);
  const historicalTimeouts = rows.filter(row => row.historicalTimeout);
  write(out('QUALITY_REPLAY_RESULTS.json'), { hashes, manifestSha256: hash(manifestFile),
    dispatchSha256: hash(out('REVIEW_DISPATCH.json')), model: rules.requiredModel, reasoningEffort: rules.reasoningEffort,
    newReviews: reviews.size, reusedReviews: manifest.records.length - reviews.size, groups, overall, historicalTimeouts,
    answerGenerationRequests: 0, rows, reviews: [...reviews.values()].map(entry => entry.review) });
  console.log(JSON.stringify({ groups, overall, historicalTimeouts }, null, 2));
}

if (mode === '--export') exportReviews();
else acceptReviews();
