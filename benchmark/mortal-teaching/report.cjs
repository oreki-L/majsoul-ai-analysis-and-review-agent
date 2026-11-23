'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readEvents } = require('../durable.cjs');
const { stableHash } = require('../core.cjs');
const { createQueue } = require('./review.cjs');
const { read, freeze } = require('./runner.cjs');
const { loadPrompts } = require('./prompts.cjs');
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const p95 = values => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null;
function buildReport(output, stage, mock = false) {
  const directory = path.join(output, mock ? 'mock' : 'live', stage);
  const planFile = path.join(directory, 'schedule.json');
  const plan = read(!fs.existsSync(planFile) && stage === 'development' && fs.existsSync(path.join(output, 'reuse-plan.json')) ? path.join(output, 'planned-schedule.json') : planFile);
  const results = require('./reuse.cjs').mergedRows(output, directory, stage, plan.winner);
  if (stage === 'supplement') {
    const nodes = read(path.join(output, 'dataset.json')).nodes;
    plan.jobs = plan.jobs.map(j => ({ ...j, variant: plan.winner, roundId: nodes.find(n => n.id === j.nodeId)?.roundId }));
    for (const row of results) {
      row.roundId ??= nodes.find(n => n.id === row.nodeId)?.roundId;
      row.variant ??= plan.winner;
    }
  }
  const queue = createQueue(path.join(output, mock ? 'mock-review' : 'review'), plan.datasetHash).snapshot();
  const reviewMap = new Map(queue.map(j => [j.resultId, j.review]));
  const authorization = fs.existsSync(path.join(output, 'authorization.local.json')) ? read(path.join(output, 'authorization.local.json')) : {};
  const billingEvents = mock ? [] : readEvents(path.join(authorization.budgetDirectory || path.join(output, 'billing'), 'attempts.jsonl'));
  const billing = new Map(billingEvents.filter(e => e.kind === 'dispatch').map(e => [e.payload.attemptId, { ...e.payload, cost: null }]));
  for (const e of billingEvents) if (e.kind === 'response' && billing.has(e.payload.attemptId)) billing.get(e.payload.attemptId).cost = e.payload.estimatedCost;
  const groups = {};
  for (const variant of [...new Set(plan.jobs.map(j => j.variant))]) {
    const jobs = plan.jobs.filter(j => j.variant === variant), rows = results.filter(r => r.variant === variant);
    const reviews = rows.map(r => reviewMap.get((mock ? 'mock:' : '') + r.id)).filter(Boolean);
    const delivered = rows.filter(r => r.delivered), failed = rows.filter(r => !r.delivered);
    const billingIds = new Set([...jobs.map(j => j.id), ...rows.map(r => r.reuseProvenance?.billingJobId).filter(Boolean)]);
    const paid = [...billing.values()].filter(a => billingIds.has(a.identity.jobId));
    const unknownCosts = paid.filter(a => a.cost === null).length;
    const rounds = Object.fromEntries([...new Set(jobs.map(j => j.roundId))].map(roundId => {
      const rjobs = jobs.filter(j => j.roundId === roundId), rr = rows.filter(r => r.roundId === roundId);
      return [roundId, { planned: rjobs.length, attempted: rr.length, delivered: rr.filter(r => r.delivered).length, passed: rr.filter(r => reviewMap.get((mock ? 'mock:' : '') + r.id)?.gate === 'pass').length }];
    }));
    groups[variant] = { planned: jobs.length, reused: rows.filter(r => r.reuseProvenance).length, newlyAttempted: rows.filter(r => !r.reuseProvenance).length, attempted: rows.length, delivered: delivered.length, notAttempted: jobs.length - rows.length,
      deliveryRate: delivered.length / jobs.length, scored: reviews.length, pendingReview: delivered.length - reviews.length,
      qualityPass: reviews.filter(r => r.gate === 'pass').length, qualityPassRate: reviews.filter(r => r.gate === 'pass').length / jobs.length,
      needsReview: reviews.filter(r => r.gate === 'needs_review').length,
      commonMean: average(reviews.map(r => r.commonMean)), contractMean: average(reviews.map(r => r.contractMean)),
      comparisons: reviews.filter(r => r.comparisonApplicable).length,
      major: reviews.reduce((s, r) => s + r.errors.filter(e => e.severity === 'major').length, 0),
      critical: reviews.reduce((s, r) => s + r.errors.filter(e => e.severity === 'critical').length, 0),
      deliveredP95Ms: p95(delivered.map(r => stage === 'development' ? r.explanationMs : r.elapsedMs)), p95N: delivered.length,
      allAttemptP95Ms: p95(rows.map(r => r.elapsedMs)), failures: failed.map(r => ({ id: r.id, error: r.outcome?.error || r.outcome?.explanation?.error || 'deadline' })), rounds };
    const reusedBillingIds = new Set(rows.map(r => r.reuseProvenance?.billingJobId).filter(Boolean));
    const reusedPaid = paid.filter(a => reusedBillingIds.has(a.identity.jobId)), newPaid = paid.filter(a => !reusedBillingIds.has(a.identity.jobId));
    groups[variant].billing = { physicalAttempts: paid.length, unknownCosts, reusedPhysicalAttempts: reusedPaid.length, newPhysicalAttempts: newPaid.length,
      reusedKnownEstimateCny: reusedPaid.reduce((sum,a) => sum + (a.cost ?? 0), 0), newKnownEstimateCny: newPaid.reduce((sum,a) => sum + (a.cost ?? 0), 0),
      knownPeakRateEstimateCny: paid.reduce((sum, a) => sum + (a.cost ?? 0), 0),
      comparablePeakRateEstimateCny: !mock && paid.length && !unknownCosts && rows.length === jobs.length ? paid.reduce((sum, a) => sum + a.cost, 0) : null };
  }
  const pairs = {};
  for (const variant of Object.keys(groups).filter(v => v !== 'p0-release-v2')) {
    let wins = 0, losses = 0, ties = 0, pending = 0, actionMismatch = 0;
    const improvedRounds = new Set();
    for (const job of plan.jobs.filter(j => j.variant === variant)) {
      const a = results.find(r => r.nodeId === job.nodeId && r.variant === 'p0-release-v2'), b = results.find(r => r.id === job.id);
      const ar = a && reviewMap.get((mock ? 'mock:' : '') + a.id), br = b && reviewMap.get((mock ? 'mock:' : '') + b.id);
      if (a?.outcome.engine && b?.outcome.engine && stableHash({ action: a.outcome.engine.action, followUp: a.outcome.engine.followUp ?? null }) !== stableHash({ action: b.outcome.engine.action, followUp: b.outcome.engine.followUp ?? null })) { actionMismatch++; continue; }
      if (!a || !b || a.delivered && !ar || b.delivered && !br || ar?.gate === 'needs_review' || br?.gate === 'needs_review') { pending++; continue; }
      const apass = ar?.gate === 'pass', bpass = br?.gate === 'pass';
      if (bpass && !apass) { wins++; improvedRounds.add(job.roundId); } else if (apass && !bpass) losses++; else ties++;
    }
    pairs[variant] = { wins, losses, ties, pending, actionMismatch, improvedRounds: [...improvedRounds] };
  }
  const adoption = {};
  if (['validation', 'regression'].includes(stage)) for (const id of Object.keys(pairs)) {
    const g = groups[id], base = groups['p0-release-v2'], p = pairs[id];
    const complete = g.attempted === g.planned && base.attempted === base.planned && !g.pendingReview && !base.pendingReview && !g.needsReview && !base.needsReview;
    const hard = !g.critical && !g.major && !p.actionMismatch && !p.pending && g.deliveryRate >= 0.95 && g.qualityPassRate >= 0.8;
    const quality = g.qualityPass - base.qualityPass >= Math.ceil(0.05 * g.planned) && p.improvedRounds.length >= 2 && g.commonMean >= base.commonMean && g.deliveredP95Ms <= 1.1 * base.deliveredP95Ms;
    const cost = g.billing.comparablePeakRateEstimateCny !== null && base.billing.comparablePeakRateEstimateCny !== null && g.billing.comparablePeakRateEstimateCny <= base.billing.comparablePeakRateEstimateCny * 0.85;
    const efficiency = g.qualityPass >= base.qualityPass && g.commonMean >= base.commonMean && (g.deliveredP95Ms <= 0.85 * base.deliveredP95Ms || cost);
    adoption[id] = { eligible: complete && hard && (quality || efficiency), complete, hard, quality, efficiency };
  }
  return { stage, mock, datasetHash: plan.datasetHash, manifestHash: plan.manifestHash, groups, pairs, adoption,
    limitations: ['Replay simulation, not browser rendering or real online play.', 'Unattempted, failed and unreviewed opportunities remain in fixed denominators.', 'No cost improvement claim from missing usage; historical X-F is not a concurrent control.'] };
}
function select(output, winner, promptDirectory) {
  const report = buildReport(output, 'development'), base = report.groups['p0-release-v2'];
  if (!base || Object.values(report.groups).some(g => g.attempted !== g.planned || g.pendingReview || g.needsReview)) throw new Error('Complete all development opportunities and resolve reviews before selection');
  if (!report.groups[winner]) throw new Error('Unknown winner');
  const candidates = Object.keys(report.pairs).filter(id => {
    const g = report.groups[id], p = report.pairs[id];
    return !g.critical && !g.major && !p.pending && !p.actionMismatch && g.qualityPass - base.qualityPass >= 2 && p.wins > p.losses && p.improvedRounds.length >= 2 && g.commonMean >= base.commonMean;
  });
  const efficient = Object.keys(report.pairs).filter(id => {
    const g = report.groups[id], p = report.pairs[id];
    const cost = g.billing.comparablePeakRateEstimateCny !== null && base.billing.comparablePeakRateEstimateCny !== null && g.billing.comparablePeakRateEstimateCny <= base.billing.comparablePeakRateEstimateCny * 0.85;
    return !g.critical && !g.major && !p.pending && !p.actionMismatch && g.qualityPass === base.qualityPass && g.commonMean >= base.commonMean && g.delivered === base.delivered && (g.deliveredP95Ms <= base.deliveredP95Ms * 0.85 || cost);
  });
  const eligible = candidates.length ? candidates : efficient;
  const bytes = Object.fromEntries(loadPrompts(promptDirectory).variants.map(v => [v.id, v.utf8Bytes]));
  const ordered = eligible.sort((a, b) => report.groups[b].qualityPass - report.groups[a].qualityPass || report.groups[b].commonMean - report.groups[a].commonMean || report.groups[a].deliveredP95Ms - report.groups[b].deliveredP95Ms || bytes[a] - bytes[b]);
  const preferred = ordered[0] || 'p0-release-v2';
  if (winner !== preferred) throw new Error('Selection does not match frozen development gates');
  return freeze(path.join(output, 'selection.json'), { winner, datasetHash: report.datasetHash, manifestHash: report.manifestHash,
    evidence: { reportHash: stableHash(report), selectionBasis: candidates.length ? 'quality' : efficient.length ? 'latency' : 'retain released baseline', eligible: ordered } });
}
module.exports = { buildReport, select, p95 };
