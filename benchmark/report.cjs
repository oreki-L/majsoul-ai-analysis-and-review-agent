'use strict';
const fs = require('node:fs');
const path = require('node:path');
function percentile(values, p) { if (!values.length) return null; const a = values.slice().sort((a, b) => a - b); return a[Math.max(0, Math.ceil(a.length * p) - 1)]; }
function createReport(run, score = null) {
  const unique = [...new Map((run.results ?? []).map(r => [r.id, r])).values()];
  const latency = {};
  for (const channel of ['main', 'branch', 'global']) {
    const rows = unique.filter(r => !r.sourceFixture && (r.repeat ?? 0) === 0 && r.channel === channel && r.status === 'success' && Number.isFinite(r.latencyMs));
    latency[channel] = { count: rows.length, p50Ms: percentile(rows.map(r => r.latencyMs), .5), p95Ms: percentile(rows.map(r => r.latencyMs), .95) };
  }
  const latencyByScheme = {};
  for (const schemeId of run.manifest?.schemeIds ?? [...new Set(unique.map(r => r.schemeId))]) {
    latencyByScheme[schemeId] = {};
    for (const channel of ['main', 'branch', 'global']) {
      const values = unique.filter(r => !r.sourceFixture && (r.repeat ?? 0) === 0 && r.schemeId === schemeId && r.channel === channel && r.status === 'success' && Number.isFinite(r.latencyMs)).map(r => r.latencyMs);
      latencyByScheme[schemeId][channel] = { count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95) };
    }
  }
  const requestAttempts = Object.values(run.requests ?? {}).flatMap(r => (r.response?.attempts ?? r.attempts ?? []).map(a => ({ ...a, role: r.role })));
  const ledgerAttempts = run.ledger?.records ?? run.ledger?.entries ?? run.ledger?.attempts ?? [];
  const attempts = ledgerAttempts.length ? ledgerAttempts : requestAttempts;
  const totals = {};
  for (const a of attempts) { const role = a.meta?.role ?? a.role ?? 'unknown'; const amount = a.estimatedCost ?? a.cost?.amount ?? a.cost; const total = totals[role] ??= { knownEstimatedCost: 0, unknownAttempts: 0, total: 0 }; if (typeof amount === 'number') total.knownEstimatedCost += amount; else total.unknownAttempts++; total.total = total.unknownAttempts ? null : total.knownEstimatedCost; }
  function costsBy(field) {
    const out = {};
    for (const a of attempts) { const meta = a.meta ?? a, key = String(typeof field === 'function' ? field(meta) : meta[field] ?? 'unknown'), amount = a.estimatedCost ?? a.cost?.amount ?? a.cost; const group = out[key] ??= { knownEstimatedCost: 0, unknownAttempts: 0, requests: 0, total: 0 }; group.requests++; if (typeof amount === 'number') group.knownEstimatedCost += amount; else group.unknownAttempts++; group.total = group.unknownAttempts ? null : group.knownEstimatedCost; }
    return out;
  }
  const attemptLatency = {};
  for (const a of requestAttempts) { const role = a.role ?? 'unknown', item = attemptLatency[role] ??= { expected: 0, success: 0, failed: 0, values: [] }; item.expected++; if (a.status === 'success') item.success++; else item.failed++; if (Number.isFinite(a.latencyMs)) item.values.push(a.latencyMs); }
  for (const item of Object.values(attemptLatency)) { item.p50Ms = percentile(item.values, .5); item.p95Ms = percentile(item.values, .95); delete item.values; }
  const invocationMetrics = {}, decisionMetrics = {};
  for (const r of Object.values(run.requests ?? {})) {
    const channel = r.channel === 'realtime' ? 'main' : r.channel === 'decision-discussion' ? 'branch' : r.channel === 'global-analysis' ? 'global' : r.channel;
    for (const [groups, key] of [[invocationMetrics, JSON.stringify([r.schemeId, r.repeat, channel, r.role])], [decisionMetrics, JSON.stringify([r.schemeId, r.repeat, channel])]]) {
      const group = groups[key] ??= { schemeId: r.schemeId, repeat: r.repeat, channel, role: groups === invocationMetrics ? r.role : undefined, logicalRequests: 0, dispatchedModelRequests: 0, simulatedModelRequests: 0, toolCalls: 0 };
      group.logicalRequests++; group.dispatchedModelRequests += r.dispatchedModelRequests ?? 0; group.simulatedModelRequests += r.simulatedModelRequests ?? 0; group.toolCalls += r.toolCalls ?? 0;
    }
  }
  for (const groups of [invocationMetrics, decisionMetrics]) for (const g of Object.values(groups)) {
    g.plannedDecisions = g.channel === 'summary' ? g.logicalRequests : unique.filter(r => r.schemeId === g.schemeId && (r.repeat ?? 0) === (g.repeat ?? 0) && r.channel === g.channel).length;
    g.meanToolCallsPerPlannedDecision = g.plannedDecisions ? g.toolCalls / g.plannedDecisions : null;
    g.meanDispatchedModelRequestsPerPlannedDecision = g.plannedDecisions ? g.dispatchedModelRequests / g.plannedDecisions : null;
    g.meanSimulatedModelRequestsPerPlannedDecision = g.plannedDecisions ? g.simulatedModelRequests / g.plannedDecisions : null;
  }
  const exposure = {};
  for (const schemeId of run.manifest?.schemeIds ?? []) { const rows = unique.filter(r => r.schemeId === schemeId && r.channel === 'main'); const used = rows.filter(r => (r.compression?.snapshots?.summarizedItems ?? 0) + (r.compression?.advice?.summarizedItems ?? 0) > 0).length; exposure[schemeId] = { decisionsWithSummary: used, totalDecisions: rows.length, assessment: used ? 'exposed' : 'insufficient_exposure' }; }
  const treatmentExposure = [];
  for (const schemeId of run.manifest?.schemeIds ?? []) for (const channel of ['branch', 'global']) {
    const rows = unique.filter(r => r.schemeId === schemeId && r.channel === channel && !r.sourceFixture), decisions = [...new Set(rows.map(r => r.decisionId))];
    if (!rows.length) continue;
    for (const decisionId of decisions) {
      const sequence = rows.filter(r => r.decisionId === decisionId), first = sequence.findIndex(r => r.status === 'success' && (r.compression?.[channel]?.transformedItems ?? 0) > 0);
      const injected = sequence.filter(r => r.status === 'success' && (r.compression?.[channel]?.transformedItems ?? 0) > 0);
      treatmentExposure.push({ schemeId, channel, decisionId, plannedQuestions: sequence.length, successfulQuestionsWithTransformation: injected.length, successfulQuestionsWithSummary: sequence.filter(r => r.status === 'success' && (r.compression?.[channel]?.summarizedItems ?? 0) > 0).length, firstInjectedResultId: first < 0 ? null : sequence[first].id, postInjectionSuccessfulQuestions: first < 0 ? 0 : sequence.slice(first).filter(r => r.status === 'success' && (r.compression?.[channel]?.transformedItems ?? 0) > 0).length, assessment: injected.length >= 3 ? 'minimum-single-dialogue-exposure-met; requires >=2 independent dialogues for stage' : 'insufficient_exposure' });
    }
  }
  const latencyByRun = {};
  for (const r of unique.filter(r => r.status === 'success' && Number.isFinite(r.latencyMs))) { const key = `${r.schemeId}:${r.repeat ?? 0}:${r.channel}`; (latencyByRun[key] ??= []).push(r.latencyMs); }
  for (const [key, values] of Object.entries(latencyByRun)) latencyByRun[key] = { count: values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95) };
  return { schemaVersion: 1, synthetic: run.manifest?.mode === 'mock', fingerprint: run.manifest?.fingerprint, status: run.status, score, validationReport: run.validationReport ?? [], labelProvenance: 'decisionId-bound only; source/input hash and independent gold provenance unverified; caller must freeze matching dataset', latency, latencyByScheme, latencyByRun, attemptLatency, invocationMetrics: Object.values(invocationMetrics), decisionMetrics: Object.values(decisionMetrics), treatmentExposure, background: { policy: run.manifest?.backgroundPolicy, quotaAssumption: run.manifest?.quotaAssumption, mockConcurrencyIsSynthetic: run.manifest?.mode === 'mock', exposure, contention: run.contention ?? [] }, globalScope: run.manifest?.globalScope, plannedStatus: unique.reduce((a, r) => { const key = `${r.channel}:${r.status}`; a[key] = (a[key] ?? 0) + 1; return a; }, {}), accounting: { estimatedOnly: true, modelRequests: run.modelRequests ?? requestAttempts.length, toolCalls: run.toolCalls ?? 0, attempts: requestAttempts, ledger: run.ledger ?? null, byRole: totals, byScheme: costsBy('schemeId'), byKeyAlias: costsBy('credentialAlias'), byRun: costsBy('repeat'), bySchemeRun: costsBy(m => `${m.schemeId ?? 'unknown'}:${m.repeat ?? 'unknown'}`), byCampaignKind: costsBy('campaignKind') }, summaryStates: Object.values(run.summaries ?? {}).map(s => ({ id: s.id, status: s.status, reason: s.reason, sourceHash: s.sourceHash, coveredDecisionIds: s.coveredDecisionIds, consumedBy: s.consumedBy ?? [], scope: s.scope })), limitations: ['Estimated API cost is not a receipt.', 'Synthetic mock output cannot establish model effectiveness.', 'Missing labels are excluded equally; failed and missing answers retain labeled denominators.'] };
}
function markdown(report) {
  const lines = ['# Benchmark report', '', report.synthetic ? '**SYNTHETIC MOCK — no model effectiveness claim.**' : 'Reference agreement; not correctness, win rate, or playing strength.', '', `Status: ${report.status}`, `Fingerprint: ${report.fingerprint}`, `Background policy: ${report.background.policy ?? 'unspecified'}; independent quota is a user declaration, not provider verification.`, `Global scope: ${report.globalScope ?? 'unspecified'}`, '', '## First-run latency (submit → validated final, including tools and review)', '', '| Channel | N | P50 ms | P95 ms |', '| --- | ---: | ---: | ---: |'];
  for (const [channel, l] of Object.entries(report.latency)) lines.push(`| ${channel} | ${l.count} | ${l.p50Ms ?? 'n/a'} | ${l.p95Ms ?? 'n/a'} |`);
  if (report.accounting.ledger?.billingUnknownLiability) lines.push('', '**Billing reconciliation pending.** Original unknown HTTP usage/cost remain null; conservative budget holds are not actual provider charges. Known usage estimate: ' + report.accounting.ledger.confirmedUsageEstimate + '; conservative unknown hold: ' + report.accounting.ledger.conservativeUnknownHoldTotal + '; unbounded budget exposure: ' + report.accounting.ledger.unboundedBudgetExposure + '.');
  if (report.validationReport?.length) lines.push('', '## Strict analysis JSON validation', '', `First-pass valid: ${report.validationReport.filter(r => r.firstPassValid === true).length}/${report.validationReport.length}; repair rounds: ${report.validationReport.reduce((sum, r) => sum + (r.repairRounds ?? 0), 0)}; validated finals: ${report.validationReport.filter(r => r.validated).length}/${report.validationReport.length}. Invalid drafts and every billed attempt remain in private checkpoint evidence.`);
  lines.push('', '## Latency by scheme', '', '| Scheme | Channel | N | P50 ms | P95 ms |', '| --- | --- | ---: | ---: | ---: |');
  for (const [schemeId, channels] of Object.entries(report.latencyByScheme)) for (const [channel, l] of Object.entries(channels)) lines.push(`| ${schemeId} | ${channel} | ${l.count} | ${l.p50Ms ?? 'n/a'} | ${l.p95Ms ?? 'n/a'} |`);
  lines.push('', '## Summary exposure', '', '| Scheme | Decisions using summary | Status |', '| --- | ---: | --- |');
  for (const [schemeId, e] of Object.entries(report.background.exposure)) lines.push(`| ${schemeId} | ${e.decisionsWithSummary}/${e.totalDecisions} | ${e.assessment} |`);
  if (report.score) { lines.push('', '## First-run reference labels', '', '| Scheme | Expected | Failures | MAKA rank | MAKA raw sum | MAKA preferred / N | MAKA candidate incl.0 / N | GPT rank | GPT raw sum | GPT argmax / N | GPT candidate incl.0 / N | GPT positive / N |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'); for (const g of report.score.groups) lines.push(`| ${g.schemeId} | ${g.expected} | ${g.failures} | ${g.maka.rank} | ${g.maka.rawWeightSum} | ${g.maka.preferredMatches}/${g.maka.denominator} | ${g.maka.candidateCoverage}/${g.maka.denominator} | ${g.gpt.rank} | ${g.gpt.rawWeightSum} | ${g.gpt.preferredMatches}/${g.gpt.denominator} | ${g.gpt.candidateCoverage}/${g.gpt.denominator} | ${g.gpt.positiveCoverage}/${g.gpt.denominator} |`); }
  if (report.score?.repeatGroups?.some(g => g.repeat > 0)) { lines.push('', '## Repeat runs (separate denominators)', '', '| Scheme | Run | Expected | MAKA preferred / denominator | GPT argmax / denominator |', '| --- | ---: | ---: | ---: | ---: |'); for (const g of report.score.repeatGroups) lines.push(`| ${g.schemeId} | ${g.repeat} | ${g.expected} | ${g.maka.preferredMatches}/${g.maka.denominator} | ${g.gpt.preferredMatches}/${g.gpt.denominator} |`); }
  if (report.score?.repeatGroups?.some(g => g.repeat > 0)) { lines.push('', '## Repeat means and ranges', '', '| Scheme | Source | Preferred rate mean | Min | Max | Runs |', '| --- | --- | ---: | ---: | ---: | ---: |'); for (const g of report.score.repeatStatistics) for (const source of ['maka', 'gpt']) { const s = g[source].preferredMatchesMean; if (s) lines.push(`| ${g.schemeId} | ${source} | ${s.mean} | ${s.min} | ${s.max} | ${s.runs} |`); } }
  if (report.score?.human) { lines.push('', '## Imported independent scores', '', '| Scheme | Run | Channel | Dimension | Imported / expected | Failures | Sum | Mean over all planned |', '| --- | ---: | --- | --- | ---: | ---: | ---: | ---: |'); for (const g of report.score.human.groups) lines.push(`| ${g.schemeId} | ${g.repeat} | ${g.channel} | ${g.dimension} | ${g.imported}/${g.expected} | ${g.failures} | ${g.rawScoreSum} | ${g.meanAllPlanned ?? 'missing labels'} |`); }
  lines.push('', '## Planned result coverage', '', '| Channel and status | N |', '| --- | ---: |'); for (const [key, n] of Object.entries(report.plannedStatus)) lines.push(`| ${key} | ${n} |`);
  lines.push('', '## Request latency by role (includes failed attempts)', '', '| Role | Attempts | Success | Failed | P50 ms | P95 ms |', '| --- | ---: | ---: | ---: | ---: | ---: |'); for (const [role, a] of Object.entries(report.attemptLatency)) lines.push(`| ${role} | ${a.expected} | ${a.success} | ${a.failed} | ${a.p50Ms ?? 'n/a'} | ${a.p95Ms ?? 'n/a'} |`);
  lines.push('', '## Estimated cost by scheme and run (all own roles included)', '', '| Scheme and run | Requests | Known estimate | Unknown attempts | Total |', '| --- | ---: | ---: | ---: | ---: |'); for (const [key, c] of Object.entries(report.accounting.bySchemeRun)) lines.push(`| ${key} | ${c.requests} | ${c.knownEstimatedCost} | ${c.unknownAttempts} | ${c.total ?? 'unknown'} |`);
  lines.push('', '## Actual invocation counts by scheme, run and channel', '', '| Scheme | Run | Channel | Planned denominator | Dispatched model requests | Simulated model requests | Tool calls | Mean tools |', '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |'); for (const g of report.decisionMetrics) lines.push(`| ${g.schemeId} | ${g.repeat} | ${g.channel} | ${g.plannedDecisions} | ${g.dispatchedModelRequests} | ${g.simulatedModelRequests} | ${g.toolCalls} | ${g.meanToolCallsPerPlannedDecision ?? 'n/a'} |`);
  lines.push('', `Label provenance: ${report.labelProvenance}`);
  lines.push('', 'Costs are estimates, not actual debit receipts. All recorded request roles remain in the JSON ledger.', '', ...report.limitations.map(x => `- ${x}`), '');
  return lines.join('\n');
}
function writeReport(directory, report) { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n'); fs.writeFileSync(path.join(directory, 'report.md'), markdown(report)); return report; }
module.exports = { createReport, markdown, writeReport, percentile };
