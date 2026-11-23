'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { createQueue } = require('../mortal-teaching/review.cjs');
const { read, freeze } = require('../mortal-teaching/runner.cjs');

const [outputArg, baselineArg, sessionsArg, ...extra] = process.argv.slice(2);
assert.ok(sessionsArg && !extra.length, 'Usage: summarize.cjs V14_EVIDENCE V13_CONTINUATION CODEX_SESSIONS_DATE');
const output = path.resolve(outputArg), baseline = path.resolve(baselineArg), sessions = path.resolve(sessionsArg);
const manifest = read(path.join(output, 'manifest.json')), manifestHash = stableHash(manifest);
const events = (file, kind) => readEvents(path.join(output, file)).filter(e => e.kind === kind).map(e => e.payload);
const results = events('live/results.jsonl', 'result');
assert.deepEqual(results.map(r => r.nodeId), manifest.jobs.map(j => j.nodeId));
assert.equal(results.length, 64);
const reviewDir = path.join(output, 'live/review'), queue = createQueue(reviewDir, manifestHash);
const delivered = results.filter(r => r.delivered);
const pending = queue.snapshot();
assert.deepEqual(new Set(pending.map(j => j.resultId)), new Set(delivered.map(r => r.id)));

const sessionFiles = fs.readdirSync(sessions).filter(f => /T22-48-(?:27|46|58)-.*\.jsonl$/.test(f));
const proof = new Map();
for (const file of sessionFiles) {
  const lines = fs.readFileSync(path.join(sessions, file), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const agentPath = lines.find(e => e.type === 'session_meta')?.payload.agent_path;
  if (!/^\/root\/blind_v14_[abc]$/.test(agentPath)) continue;
  const turn = lines.find(e => e.type === 'turn_context');
  assert.equal(turn?.payload.model, 'sub2api/gpt-6.2-sol');
  assert.equal(turn?.payload.effort, 'low');
  proof.set(agentPath.at(-1), { agentPath, sessionPath: `2026/11/22/${file}`, turnId: turn.payload.turn_id, at: turn.timestamp });
}
const batches = ['a', 'b', 'c'].map(group => {
  const ids = read(path.join(reviewDir, `ids-${group}.json`)), rows = read(path.join(reviewDir, `reviewer-${group}.json`));
  assert.deepEqual(rows.map(r => r.blindId), ids);
  assert.ok(proof.has(group));
  return { rows, attestation: { model: 'gpt-6.2-sol', reasoningEffort: 'low', evidence: proof.get(group),
    billing: { kind: 'included-in-subscription', additionalApiChargeCny: 0, evidence: 'Codex subagent blind review with no metered provider requests.' } } };
});
const blindIds = batches.flatMap(b => b.rows.map(r => r.blindId));
assert.equal(blindIds.length, pending.length);
assert.deepEqual(new Set(blindIds), new Set(pending.map(j => j.packet.blindId)));
for (const { rows, attestation } of batches) queue.importResults(rows, attestation);
const reviewed = new Map(queue.snapshot().map(j => [j.resultId, j.review]));
assert.equal([...reviewed.values()].filter(Boolean).length, delivered.length);

const before = read(path.join(baseline, 'PAIRED_RESULTS.json')), expansion = read(path.join(baseline, 'EXPANSION_RESULTS.json'));
const prior = new Map([...before, ...expansion].map(r => [r.nodeId, r]));
assert.equal(prior.size, results.length);
const originalIds = new Set(before.map(r => r.nodeId));
const dispatches = events('budget/attempts.jsonl', 'dispatch'), responses = events('budget/attempts.jsonl', 'response');
assert.equal(dispatches.length, results.reduce((acc, r) => acc + r.llmRequests, 0));
assert.equal(responses.length, dispatches.length);
const byAttempt = new Map(responses.map(r => [r.attemptId, r])), byJob = Map.groupBy(dispatches, r => r.identity.jobId);
const paired = results.map(r => {
  const old = prior.get(r.nodeId), score = reviewed.get(r.id);
  const failures = r.delivered ? [] : byJob.get(r.id).map(a => {
    const response = byAttempt.get(a.attemptId);
    const content = response.body?.choices?.[0]?.message?.content;
    let keys = null;
    try { keys = Object.keys(JSON.parse(content)); } catch {}
    return { status: response.status, parsedKeys: keys, extraKeys: keys?.filter(k => !['summary', 'reasons', 'limitations'].includes(k)) ?? null };
  });
  return { nodeId: r.nodeId, sample: originalIds.has(r.nodeId) ? 'original' : 'expansion', delivered: r.delivered,
    deliveryError: r.error, failedResponses: failures, elapsedMs: r.elapsedMs, requests: r.llmRequests,
    v12: old.v12 ?? null, v13: old.v13 ?? null, v14: score ? { mean: score.commonMean, gate: score.gate,
      errors: score.errors.map(({ citation, ...error }) => ({ ...error, citation: score.citations[citation] })), unresolved: score.unresolved } : null };
});
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const stats = (rows, version) => {
  const scored = rows.flatMap(r => r[version] ? [r[version]] : []);
  return { n: scored.length, pass: scored.filter(r => r.gate === 'pass').length, needsReview: scored.filter(r => r.gate === 'needs_review').length,
    mean: mean(scored.map(r => r.mean)), majorAnswers: scored.filter(r => r.errors.some(e => ['major', 'critical'].includes(e.severity))).length,
    minor: scored.flatMap(r => r.errors).filter(r => r.severity === 'minor').length };
};
const compare = (rows, version) => {
  const both = rows.filter(r => r[version] && r.v14);
  const deltas = both.map(r => r.v14.mean - r[version].mean);
  return { [version]: stats(both, version), v14: stats(both, 'v14'), improved: deltas.filter(d => d > 1e-9).length,
    tied: deltas.filter(d => Math.abs(d) <= 1e-9).length, regressed: deltas.filter(d => d < -1e-9).length };
};
const original = paired.filter(r => r.sample === 'original'), added = paired.filter(r => r.sample === 'expansion');
const roles = Object.fromEntries([...Map.groupBy(dispatches, a => a.identity.role)].map(([role, records]) => [role, records.length]));
const b = read(path.join(output, 'budget/budget.json'));
assert.ok(Math.abs(responses.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0) - b.estimatedCost) < 1e-9);
const latencies = paired.filter(r => r.delivered).map(r => r.elapsedMs).sort((a, b) => a - b);
const at = percentile => latencies[Math.ceil(latencies.length * percentile) - 1];
const summary = { manifestHash, combined: { attempted: paired.length, v13: stats(paired, 'v13'), v14: stats(paired, 'v14'), pairedV13: compare(paired, 'v13') },
  original: { attempted: original.length, v12: stats(original, 'v12'), v13: stats(original, 'v13'), v14: stats(original, 'v14'), pairedV12: compare(original, 'v12') },
  expansion: { attempted: added.length, v13: stats(added, 'v13'), v14: stats(added, 'v14') },
  failedResponses: paired.filter(r => !r.delivered).map(({ nodeId, deliveryError, failedResponses }) => ({ nodeId, deliveryError, failedResponses })),
  api: { requests: dispatches.length, byRole: roles, confirmedEstimateCny: b.estimatedCost, reservedCny: b.reserved, committedCny: b.budgetCommitted, capCny: b.cap,
    deliveredMedianMs: at(.5), deliveredP95Ms: at(.95) }, reviewers: batches.map(({ rows, attestation }) => ({ scored: rows.length, attestation })) };
freeze(path.join(output, 'PAIRED_RESULTS.json'), paired);
freeze(path.join(output, 'REVIEW_SUMMARY.json'), summary);
console.log(JSON.stringify({ ...summary, failedResponses: summary.failedResponses.length, reviewers: summary.reviewers.length }, null, 2));
