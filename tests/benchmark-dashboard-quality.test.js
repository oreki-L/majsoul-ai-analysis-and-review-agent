'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { enrich, writeDashboard } = require('../benchmark/dashboard.cjs');
function setup() {
  const rows = ['pass', 'fail', 'needs', 'missing', 'blocked'].map((name, i) => ({ id: name, schemeId: 'W-C', repeat: 0, channel: 'main', status: i === 4 ? 'blocked' : 'success', latencyMs: 100 + i }));
  const run = { manifest: { mode: 'live', schemeIds: ['W-C', 'W-V'] }, results: rows,
    requests: Object.fromEntries(rows.slice(0, 4).map(r => [r.id, { dispatchedModelRequests: 1 }])),
    ledger: { records: rows.slice(0, 4).map(r => ({ cost: 1, meta: { schemeId: 'W-C', repeat: 0, channel: 'realtime' } })) } };
  const review = (resultId, gateStatus, mean) => ({ resultId, state: 'complete', review: { gate: gateStatus === 'pass', gateStatus, mean } });
  const report = { reviewQueue: [review('pass', 'pass', 4), review('fail', 'fail', 2), review('needs', 'needs_review', null)],
    phases: { execution: 'complete', review: 'pending', billing: 'estimated' }, schemeDescriptions: { 'W-C': 'Typed citation <test>', 'W-V': 'Paired correction' }, accounting: { sentinel: 4 } };
  return { run, report };
}

test('quality gate uses all planned slots and keeps fail/needs-review/missing separate', () => {
  const { run, report } = setup(); enrich(report, run);
  const row = report.presentation[0];
  assert.equal(row.qualityPassRate, .2); assert.equal(row.qualityPassed, 1); assert.equal(row.reviewPlanned, 5);
  assert.equal(row.qualityFailed, 1); assert.equal(row.qualityNeedsReview, 1); assert.equal(row.qualityMissing, 2);
  assert.equal(row.qualityMean, 3); assert.equal(row.qualityMeanCount, 2); assert.equal(row.reviewed, 3);
  assert.equal(report.channelMetrics[0].qualityMean, 3); assert.equal(report.channelMetrics[0].qualityPassRate, .2);
  assert.equal(report.presentation[1].qualityMean, null); assert.equal(report.presentation[1].qualityPassRate, null);
});

test('unscored review mean never silently becomes zero', () => {
  const { run, report } = setup(); report.reviewQueue.forEach(j => { j.review.mean = null; });
  enrich(report, run); assert.equal(report.presentation[0].qualityMean, null); assert.equal(report.presentation[0].qualityMeanCount, 0);
});

test('paired standalone estimates include shared drafts, no-op drafts and correction costs without adding to ledger', () => {
  const { run, report } = setup();
  run.results.push({ id: 'paired-pass', schemeId: 'W-V', channel: 'main', status: 'success', sharedDraftRequestId: 'pass', latencyMs: 140,
    costAttribution: { sharedDraftUsageEstimate: 1, incrementalUsageEstimate: .5, standaloneUsageEstimate: 1.5 } },
  { id: 'paired-noop', schemeId: 'W-V', channel: 'main', status: 'success', sharedDraftRequestId: 'fail', latencyMs: 120,
    costAttribution: { sharedDraftUsageEstimate: 1, incrementalUsageEstimate: 0, standaloneUsageEstimate: 1 } });
  run.requests['paired-pass'] = { dispatchedModelRequests: 1 }; run.requests['paired-noop'] = { dispatchedModelRequests: 0 };
  run.ledger.records.push({ cost: .5, meta: { schemeId: 'W-V', repeat: 0, channel: 'realtime', role: 'evidence-correction' } });
  const before = JSON.stringify(run.ledger), accounting = JSON.stringify(report.accounting);
  enrich(report, run); const row = report.presentation[1];
  assert.equal(row.pairedCosts.standaloneCost, 2.5); assert.equal(row.pairedCosts.standaloneMeanCostPerSourceDispatch, 1.25);
  assert.equal(row.pairedCosts.protocolIncrementalCost, .5); assert.equal(row.protocolTotalCost, .5);
  assert.equal(row.pairedCosts.sourceDispatched, 2); assert.equal(row.dispatched, 1);
  assert.equal(JSON.stringify(run.ledger), before); assert.equal(JSON.stringify(report.accounting), accounting);
});

test('unknown or missing paired attribution stays unknown; known protocol cost is not standalone cost', () => {
  const { run, report } = setup();
  run.results.push({ id: 'pair', schemeId: 'W-V', channel: 'main', status: 'failed', sharedDraftRequestId: 'pass',
    costAttribution: { sharedDraftUsageEstimate: 1, incrementalUsageEstimate: null, standaloneUsageEstimate: null } });
  run.requests.pair = { dispatchedModelRequests: 1 };
  run.ledger.records.push({ cost: null, meta: { schemeId: 'W-V', repeat: 0, channel: 'realtime' } });
  enrich(report, run); const row = report.presentation[1];
  assert.equal(row.pairedCosts.standaloneCost, null); assert.equal(row.pairedCosts.standaloneMeanCostPerSourceDispatch, null);
  assert.equal(row.protocolTotalCost, null); assert.equal(row.pairedCosts.sharedDraftKnownCost, 1);
  delete run.results.at(-1).costAttribution;
  enrich(report, run); assert.equal(report.presentation[1].pairedCosts.standaloneCost, null);
});

test('HTML and markdown foreground quality gate, hide six-dimension detail and distinguish paired costs', () => {
  const { run, report } = setup();
  run.results.push({ id: 'pair', schemeId: 'W-V', channel: 'main', status: 'success', sharedDraftRequestId: 'pass', latencyMs: 120,
    costAttribution: { sharedDraftUsageEstimate: 1, incrementalUsageEstimate: 0, standaloneUsageEstimate: 1 } });
  enrich(report, run);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-dashboard-quality-'));
  try {
    writeDashboard(directory, report);
    const html = fs.readFileSync(path.join(directory, 'report.html'), 'utf8'), markdown = fs.readFileSync(path.join(directory, 'report.md'), 'utf8');
    assert.match(html, /质量通过率（主指标）/); assert.match(html, /20\.0%/); assert.match(html, /未通过 1 · 待裁定 1 · 缺评 2/);
    assert.match(html, /综合均分 3\.000/); assert.match(html, /共享草案＋纠错合计 1\.000/); assert.match(html, /本协议仅计增量 0\.000/);
    assert.match(html, /<details><summary>六维评分/); assert.match(html, /Typed citation &lt;test&gt;/);
    assert.match(markdown, /质量通过率（通过\/计划）/); assert.match(markdown, /20\.0%（1\/5）/);
    assert.match(markdown, /独立估算均费 1\.000/); assert.match(markdown, /不能将独立估算重复加入总账/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8')).presentation[0].qualityMean, 3);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
