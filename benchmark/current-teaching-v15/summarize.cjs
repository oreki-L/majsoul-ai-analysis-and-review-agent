'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { read, freeze } = require('../mortal-teaching/runner.cjs');
const { createQueue } = require('../mortal-teaching/review.cjs');

const [dir, baseline, session, ...extra] = process.argv.slice(2);
assert.ok(session && !extra.length, 'Usage: summarize.cjs V15_EVIDENCE V14_EVIDENCE BLIND_REVIEW_SESSION');
const manifest = read(path.join(dir, 'manifest.json')), hash = stableHash(manifest);
const events = (file, kind) => readEvents(path.join(dir, file)).filter(e => e.kind === kind).map(e => e.payload);
const live = events('live/results.jsonl', 'result');
assert.deepEqual(live.map(r => r.nodeId), manifest.jobs.map(j => j.nodeId));
const reviewDir = path.join(dir, 'live/review'), queue = createQueue(reviewDir, hash);
const reviewed = read(path.join(reviewDir, 'reviewer.json'));
const delivered = live.filter(r => r.delivered);
const batch = fs.readdirSync(reviewDir).filter(f => f.startsWith('batch-')).map(f => read(path.join(reviewDir, f)))
  .find(b => b.datasetHash === hash && b.order.length === delivered.length);
assert.deepEqual(reviewed.map(r => r.blindId), batch.order);
assert.deepEqual(new Set(queue.snapshot().map(r => r.resultId)), new Set(delivered.map(r => r.id)));
const records = fs.readFileSync(session, 'utf8').trimEnd().split('\n').map(JSON.parse);
const { agent_path: agentPath } = records.find(e => e.type === 'session_meta').payload;
const turn = records.find(e => e.type === 'turn_context');
assert.equal(agentPath, '/root/blind_v15');
assert.equal(turn.payload.model, 'sub2api/gpt-6.2-sol');
assert.equal(turn.payload.effort, 'low');
const attestation = { model: 'gpt-6.2-sol', reasoningEffort: 'low', evidence: { agentPath, sessionFile: path.basename(session), turnId: turn.payload.turn_id, at: turn.timestamp },
  billing: { kind: 'included-in-subscription', additionalApiChargeCny: 0, evidence: 'Codex subagent review; no metered provider calls.' } };
queue.importResults(reviewed, attestation);
const scores = new Map(queue.snapshot().map(j => [j.resultId, j.review]));
const old = new Map(read(path.join(baseline, 'PAIRED_RESULTS.json')).map(row => [row.nodeId, row]));
const dispatches = events('budget/attempts.jsonl', 'dispatch'), responses = events('budget/attempts.jsonl', 'response');
const byJob = Map.groupBy(dispatches, a => a.identity.jobId), byAttempt = new Map(responses.map(r => [r.attemptId, r]));
assert.equal(dispatches.length, responses.length);
const loadAnswer = a => JSON.parse(byAttempt.get(a.attemptId).body.choices[0].message.content);
const fields = ['summary', 'reasons', 'limitations'];
const paired = live.map((r, i) => {
  const prior = old.get(r.nodeId), job = manifest.jobs[i], attempts = byJob.get(r.id), score = scores.get(r.id);
  assert.equal(attempts.length, r.llmRequests);
  const fix = attempts.find(a => a.identity.role === 'format-repair');
  const repair = !fix ? null : { changedFields: null };
  if (fix && r.delivered) {
    const first = loadAnswer(attempts[0]), final = loadAnswer(fix);
    repair.initialExtraFields = Object.keys(first).filter(k => !fields.includes(k));
    repair.changedFields = fields.filter(k => stableHash(first[k]) !== stableHash(final[k]));
  }
  return { nodeId: r.nodeId, wasV14Failure: !!job.failureResponseHash, delivered: r.delivered, elapsedMs: r.elapsedMs, repair,
    v14: prior.v14, v15: score ? { mean: score.commonMean, gate: score.gate,
      errors: score.errors.map(({ citation, ...e }) => ({ ...e, citation: score.citations[citation] })), unresolved: score.unresolved } : null };
});
const mean = (rows, version) => rows.length ? rows.reduce((n, r) => n + r[version].mean, 0) / rows.length : null;
const scored = paired.filter(r => r.v15), both = scored.filter(r => r.v14), failures = paired.filter(r => r.wasV14Failure);
const elapsed = delivered.map(r => r.elapsedMs).sort((a, b) => a - b);
const at = p => elapsed[Math.ceil(elapsed.length * p) - 1];
const budget = read(path.join(dir, 'budget/budget.json'));
assert.ok(Math.abs(responses.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0) - budget.estimatedCost) < 1e-9);
const summary = { manifestHash: hash, attempted: paired.length, delivered: delivered.length,
  firstAnswerDelivered: paired.filter(r => r.delivered && !r.repair).length, repaired: paired.filter(r => r.repair).length,
  previousFailures: { count: failures.length, delivered: failures.filter(r => r.delivered).length },
  blind: { scored: scored.length, pass: scored.filter(r => r.v15.gate === 'pass').length, mean: mean(scored, 'v15'),
    minor: scored.flatMap(r => r.v15.errors).filter(e => e.severity === 'minor').length,
    major: scored.flatMap(r => r.v15.errors).filter(e => ['major', 'critical'].includes(e.severity)).length,
    unresolved: scored.flatMap(r => r.v15.unresolved).length },
  paired: { n: both.length, v14: mean(both, 'v14'), v15: mean(both, 'v15') },
  api: { requests: dispatches.length, estimatedCostCny: budget.estimatedCost, reservedCny: budget.reserved, capCny: budget.cap,
    medianMs: at(.5), p95Ms: at(.95) }, attestation };
freeze(path.join(dir, 'PAIRED_RESULTS.json'), paired);
freeze(path.join(dir, 'REVIEW_SUMMARY.json'), summary);
console.log(JSON.stringify(summary, null, 2));
