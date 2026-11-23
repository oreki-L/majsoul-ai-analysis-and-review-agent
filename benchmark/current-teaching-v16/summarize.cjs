'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { read, freeze } = require('../mortal-teaching/runner.cjs');
const { createQueue } = require('../mortal-teaching/review.cjs');

const [dir, baselineDir, ...sessions] = process.argv.slice(2);
assert.ok(dir && baselineDir && sessions.length, 'Usage: summarize.cjs EVIDENCE BASELINE_DIR REVIEW_SESSION [REVIEW_SESSION ...]');
const manifest = read(path.join(dir, 'manifest.json')), hash = stableHash(manifest);
const readKind = (file, kind) => readEvents(path.join(dir, file)).filter(e => e.kind === kind).map(e => e.payload);
const live = readKind('live/results.jsonl', 'result');
assert.deepEqual(live.map(r => r.nodeId), manifest.jobs.slice(0, live.length).map(j => j.nodeId));
const delivered = live.filter(r => r.delivered);
const reviewDir = path.join(dir, 'live/review'), queue = createQueue(reviewDir, hash);
assert.deepEqual(new Set(queue.snapshot().map(j => j.resultId)), new Set(delivered.map(r => r.id)));
const batches = sessions.map(file => {
  const entries = fs.readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const agentPath = entries.find(e => e.type === 'session_meta').payload.agent_path;
  assert.match(agentPath, /^\/root\/blind_v16_[a-c]$/);
  const turn = entries.find(e => e.type === 'turn_context');
  assert.equal(turn.payload.model, 'sub2api/gpt-6.2-sol');
  assert.equal(turn.payload.effort, 'low');
  const group = agentPath.at(-1), rows = read(path.join(reviewDir, `reviewer-${group}.json`));
  assert.deepEqual(rows.map(r => r.blindId), read(path.join(reviewDir, `ids-${group}.json`)));
  const attestation = { model: 'gpt-6.2-sol', reasoningEffort: 'low',
    evidence: { agentPath, sessionFile: path.basename(file), turnId: turn.payload.turn_id, at: turn.timestamp },
    billing: { kind: 'included-in-subscription', additionalApiChargeCny: 0, evidence: 'Codex subagent blind review; no metered API calls.' } };
  return { rows, attestation };
});
const ids = batches.flatMap(b => b.rows.map(r => r.blindId));
assert.equal(ids.length, delivered.length);
assert.deepEqual(new Set(ids), new Set(queue.snapshot().map(j => j.packet.blindId)));
for (const b of batches) queue.importResults(b.rows, b.attestation);
const scored = new Map(queue.snapshot().map(j => [j.resultId, j.review]));
const prior = new Map(read(path.join(baselineDir, 'PAIRED_RESULTS.json')).map(r => [r.nodeId, r]));
assert.equal(prior.size, manifest.jobs.length);
const calls = readKind('budget/attempts.jsonl', 'dispatch'), replies = readKind('budget/attempts.jsonl', 'response');
const byJob = Map.groupBy(calls, c => c.identity.jobId), byAttempt = new Map(replies.map(r => [r.attemptId, r]));
assert.equal(calls.length, replies.length);
assert.equal(calls.length, live.reduce((n, r) => n + r.llmRequests, 0));
const fields = ['summary', 'reasons', 'limitations'];
const content = (attempt) => {
  try { return JSON.parse(byAttempt.get(attempt?.attemptId)?.body?.choices?.[0]?.message?.content); } catch { return null; }
};
const paired = live.map((r, i) => {
  const j = manifest.jobs[i], old = prior.get(r.nodeId), score = scored.get(r.id);
  const attempts = byJob.get(r.id) ?? [], fix = attempts.find(a => a.identity.role === 'format-repair');
  const first = content(attempts[0]), final = content(fix);
  return { nodeId: r.nodeId, sample: old.sample, defenseTarget: j.defenseTarget, delivered: r.delivered, error: r.error,
    requests: r.llmRequests, elapsedMs: r.elapsedMs, initialKeys: first ? Object.keys(first) : null,
    repair: fix ? { changedFields: first && final ? fields.filter(k => stableHash(first[k]) !== stableHash(final[k])) : null } : null,
    v12: old.v12, v13: old.v13, v14: old.v14, v16: score ? { mean: score.commonMean, gate: score.gate,
      errors: score.errors.map(({ citation, ...e }) => ({ ...e, citation: score.citations[citation] })), unresolved: score.unresolved } : null };
});
const stats = (rows, v) => {
  const s = rows.flatMap(r => r[v] ? [r[v]] : []), errors = s.flatMap(r => r.errors);
  return { n: s.length, pass: s.filter(r => r.gate === 'pass').length,
    mean: s.length ? s.reduce((n, r) => n + r.mean, 0) / s.length : null,
    minor: errors.filter(e => e.severity === 'minor').length, major: errors.filter(e => ['major', 'critical'].includes(e.severity)).length,
    needsReview: s.filter(r => r.gate === 'needs_review').length };
};
const compare = v => {
  const both = paired.filter(r => r[v] && r.v16), changes = both.map(r => r.v16.mean - r[v].mean);
  return { [v]: stats(both, v), v16: stats(both, 'v16'), improved: changes.filter(d => d > 1e-9).length,
    tied: changes.filter(d => Math.abs(d) <= 1e-9).length, regressed: changes.filter(d => d < -1e-9).length };
};
const b = read(path.join(dir, 'budget/budget.json')), lats = delivered.map(r => r.elapsedMs).sort((a, b) => a - b);
assert.ok(Math.abs(replies.reduce((n, r) => n + (r.estimatedCost ?? 0), 0) - b.estimatedCost) < 1e-9);
const at = p => lats[Math.ceil(lats.length * p) - 1] ?? null;
const summary = { manifestHash: hash, planned: manifest.jobs.length, attempted: live.length, delivered: delivered.length,
  firstAnswerDelivered: paired.filter(r => r.delivered && r.requests === 1).length,
  repairDelivered: paired.filter(r => r.delivered && r.repair).length,
  original: stats(paired.filter(r => r.sample === 'original'), 'v16'), expansion: stats(paired.filter(r => r.sample === 'expansion'), 'v16'),
  blind: stats(paired, 'v16'), pairedV13: compare('v13'), pairedV14: compare('v14'),
  api: { requests: calls.length, byRole: Object.fromEntries([...Map.groupBy(calls, c => c.identity.role)].map(([role, rs]) => [role, rs.length])),
    estimateCny: b.estimatedCost, reservedCny: b.reserved, capCny: b.cap, medianMs: at(.5), p95Ms: at(.95) },
  reviewers: batches.map(b => ({ scored: b.rows.length, attestation: b.attestation })) };
freeze(path.join(dir, 'PAIRED_RESULTS.json'), paired);
freeze(path.join(dir, 'REVIEW_SUMMARY.json'), summary);
console.log(JSON.stringify({ ...summary, reviewers: summary.reviewers.length }, null, 2));
