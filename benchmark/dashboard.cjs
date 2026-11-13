'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { percentile } = require('./report.cjs');
const mean = values => { const scored = values.filter(Number.isFinite); return scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null; };
function qualityMetrics(rows, jobs) {
  const reviewed = jobs.filter(j => j.state === 'complete' && rows.some(r => r.id === j.resultId));
  const statuses = reviewed.map(j => j.review.gateStatus ?? (j.review.gate === true ? 'pass' : j.review.gate === false ? 'fail' : null));
  const qualityPassed = statuses.filter(s => s === 'pass').length, qualityFailed = statuses.filter(s => s === 'fail').length, qualityNeedsReview = statuses.filter(s => s === 'needs_review').length;
  return { qualityPassed, qualityFailed, qualityNeedsReview, qualityMissing: rows.length - qualityPassed - qualityFailed - qualityNeedsReview,
    qualityPassRate: rows.length ? qualityPassed / rows.length : null, qualityMean: mean(reviewed.map(j => j.review.mean)),
    qualityMeanCount: reviewed.filter(j => Number.isFinite(j.review.mean)).length, reviewed: reviewed.length, reviewPlanned: rows.length };
}
const dispatched = request => request?.dispatchedModelRequests > 0 || request?.simulatedModelRequests > 0;
function pairedCosts(rows, run, protocolIncrementalCost) {
  const paired = rows.filter(r => r.sharedDraftRequestId);
  if (!paired.length) return null;
  const attributions = paired.map(r => r.costAttribution), complete = attributions.every(a => Number.isFinite(a?.standaloneUsageEstimate));
  const sourceDispatched = paired.filter(r => dispatched(run.requests[r.sharedDraftRequestId])).length;
  const standaloneCost = complete ? attributions.reduce((n, a) => n + a.standaloneUsageEstimate, 0) : null;
  return { opportunities: paired.length, attributedOpportunities: attributions.filter(Boolean).length, sourceDispatched,
    sharedDraftKnownCost: attributions.reduce((n, a) => n + (Number.isFinite(a?.sharedDraftUsageEstimate) ? a.sharedDraftUsageEstimate : 0), 0),
    incrementalKnownCost: attributions.reduce((n, a) => n + (Number.isFinite(a?.incrementalUsageEstimate) ? a.incrementalUsageEstimate : 0), 0),
    standaloneCost, standaloneMeanCostPerSourceDispatch: standaloneCost !== null && sourceDispatched ? standaloneCost / sourceDispatched : null,
    protocolIncrementalCost, accountingBoundary: 'Standalone comparison includes the shared source draft plus correction; protocol ledger bills source draft only once. Never sum standalone costs into the protocol ledger.' };
}
function enrich(report, run) {
  report.presentation = (run.manifest.schemeIds ?? []).map(schemeId => {
    const rows = run.results.filter(r => r.schemeId === schemeId && !r.canonicalResultId && !r.sourceFixture), main = rows.filter(r => r.channel === 'main');
    const primary = main.filter(r => (r.repeat ?? 0) === 0);
    const jobs = (report.reviewQueue ?? []).filter(j => rows.some(r => r.id === j.resultId));
    const protocolLedger = (run.ledger?.records ?? []).filter(r => r.meta?.schemeId === schemeId && (r.meta?.repeat ?? 0) === 0);
    const ledger = protocolLedger.filter(r => r.meta?.role !== 'supplemental' && ['realtime', 'summary'].includes(r.meta?.channel)), known = ledger.reduce((n, r) => n + (r.cost ?? 0), 0), unknown = ledger.filter(r => r.cost === null).length;
    const costs = ledger.length ? unknown ? null : known : run.manifest.mode === 'mock' ? 0 : null;
    const latencies = primary.filter(r => r.status === 'success' && !r.recoveryOutsideDeadline).map(r => r.latencyMs).filter(Number.isFinite), score = report.score?.groups?.find(g => g.schemeId === schemeId);
    const maka = score?.maka ?? null, gpt = score?.gpt ?? null;
    const protocolTotalCost = protocolLedger.some(r => !Number.isFinite(r.cost)) ? null : protocolLedger.reduce((n, r) => n + r.cost, 0);
    return { schemeId, protocolTotalCost, pairedCosts: pairedCosts(primary, run, protocolTotalCost), failedMeanMs: mean(primary.filter(r => r.status === 'failed').map(r => r.latencyMs)), recoveredOutsideDeadline: primary.filter(r => r.recoveryOutsideDeadline).length, planned: primary.length, dispatched: primary.filter(r => dispatched(run.requests[r.id])).length, delivered: primary.filter(r => r.status === 'success').length, ...qualityMetrics(primary, jobs), channel: 'main', repeat: 0, endToEndMeanMs: mean(latencies), endToEndP95Ms: percentile(latencies, .95), knownEstimatedCost: known, unknownAttempts: unknown, totalCost: costs, meanCostPerDispatched: costs === null ? null : primary.filter(r => dispatched(run.requests[r.id])).length ? costs / primary.filter(r => dispatched(run.requests[r.id])).length : null, maka, gpt, averageScoreRate: maka?.scoreRate != null && gpt?.scoreRate != null ? (maka.scoreRate + gpt.scoreRate) / 2 : null };
  });
  report.channelMetrics = [...new Set(run.results.map(r => JSON.stringify([r.schemeId, r.repeat ?? 0, r.channel])))].map(key => { const [schemeId, repeat, channel] = JSON.parse(key), rows = run.results.filter(r => r.schemeId === schemeId && (r.repeat ?? 0) === repeat && r.channel === channel && !r.sourceFixture && !r.canonicalResultId), costs = (run.ledger?.records ?? []).filter(r => r.meta?.schemeId === schemeId && (r.meta?.repeat ?? 0) === repeat && (r.meta.channel === channel || ({main: 'realtime', branch: 'decision-discussion', global: 'global-analysis'})[channel] === r.meta.channel)); return { schemeId, repeat, channel, planned: rows.length, dispatched: rows.filter(r => dispatched(run.requests[r.id])).length, delivered: rows.filter(r => r.status === 'success').length, ...qualityMetrics(rows, report.reviewQueue ?? []), cost: costs.some(c => !Number.isFinite(c.cost)) ? null : costs.reduce((n, c) => n + c.cost, 0) }; });
  report.supplemental = run.supplemental ?? [];
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = value => value === null || value === undefined ? '未知 / 待评' : Number(value).toFixed(3);
const percent = value => Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : '待评';
function qualityCell(row) {
  return `<strong>质量通过率 ${percent(row.qualityPassRate)}</strong><div class="bar"><i style="width:${(row.qualityPassRate ?? 0) * 100}%"></i></div>通过 ${row.qualityPassed} / 计划 ${row.reviewPlanned}<br>未通过 ${row.qualityFailed} · 待裁定 ${row.qualityNeedsReview} · 缺评 ${row.qualityMissing}<br>综合均分 ${number(row.qualityMean)} / 4（${row.qualityMeanCount} 份六维可评）`;
}
function costCell(row) {
  if (row.pairedCosts) return `独立运行估算均费 ${number(row.pairedCosts.standaloneMeanCostPerSourceDispatch)}<br>共享草案＋纠错合计 ${number(row.pairedCosts.standaloneCost)}<br>本协议仅计增量 ${number(row.pairedCosts.protocolIncrementalCost)}<br>独立运行估算不重复加入总账`;
  return `${number(row.meanCostPerDispatched)}<br>未知账 ${row.unknownAttempts}`;
}
function writeDashboard(output, report) {
  const rows = report.presentation ?? [];
  const table = rows.map(r => `<tr><td><details><summary>${escape(r.schemeId)}</summary><p>${escape(report.schemeDescriptions?.[r.schemeId])}</p></details></td><td>${qualityCell(r)}</td><td>${number(r.maka?.scoreRate)} / ${number(r.gpt?.scoreRate)}<br>平均得分率 ${r.averageScoreRate === null ? '待标签' : (r.averageScoreRate * 100).toFixed(1) + '%'}</td><td>${number(r.maka?.preferredMatchesMean)} / ${number(r.gpt?.preferredMatchesMean)}<br>${number(r.maka?.candidateCoverageMean)} / ${number(r.gpt?.candidateCoverageMean)}</td><td>${number(r.endToEndMeanMs)} / ${number(r.endToEndP95Ms)} ms<br>失败均时 ${number(r.failedMeanMs)} ms</td><td>${costCell(r)}</td><td>${r.delivered} / ${r.planned}</td></tr>`).join('');
  const details = { reviews: report.reviewQueue, accounting: report.accounting, validation: report.validationReport, summaries: report.summaryStates, supplemental: report.supplemental, channelMetrics: report.channelMetrics };
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Benchmark 执行报告</title><style>body{font:15px system-ui;background:#f3f5f8;color:#182638;margin:40px}main{max-width:1400px;margin:auto}h1{font-size:30px}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:18px 12px;border-bottom:1px solid #dde2ea;vertical-align:top}th{font-size:13px;color:#526277}.bar{height:8px;background:#e8edf5;margin:9px 0}.bar i{display:block;height:100%;background:#2b708c}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#526277}</style><main><h1>Benchmark 执行报告</h1><p>${report.synthetic ? '合成模拟；不能用于比较模型效果。' : '参考一致与评分；不代表牌力或正确率。'}</p><p>执行：${escape(report.phases.execution)} · 评审：${escape(report.phases.review)} · 账单：${escape(report.phases.billing)}</p><small>生成 ${escape(report.generatedAt)}<br>快照 ${escape(report.snapshotHash)}<br>运行合同 ${escape(report.contractHash)}</small><p>费用包含摘要、失败和全部物理尝试；未知费用保留未知。得分率为所选动作权重总和 / 每点参考最高可得权重总和。质量与延迟默认展示实时首轮。质量通过率为通过/全部计划，未通过、待裁定、缺评分开；综合均分只统计六维均可评分的回答，不把缺分转为零；实时均费含同轮实时请求及摘要和失败，除以实时已派发点；追问/global/补测单列且计入总协议预算。成功端到端均时/P95与失败耗时分列；恢复超时另记。W-V独立运行估算包括共享W-C草案及纠错，实际协议账仅计一次共享草案；独立运行估算不得累加进总账。首选和候选覆盖分别列 MAKA / GPT。</p><table><thead><tr><th>方案（点击说明）</th><th>质量通过率（主指标）与综合均分</th><th>MAKA / GPT 得分率</th><th>首选一致 / 候选覆盖</th><th>成功端到端平均 / P95</th><th>每已派发点均费 / 配对独立估算</th><th>交付 / 计划</th></tr></thead><tbody>${table}</tbody></table><details><summary>六维评分、gate、账本、摘要与补测明细</summary><pre>${escape(JSON.stringify(details, null, 2))}</pre></details></main></html>`;
  const { saveAtomic } = require('./runner.cjs');
  // Each artifact binds the same report snapshot. Interrupted generation is safe to repeat.
  const temporary = path.join(output, 'report.html.tmp'); fs.writeFileSync(temporary, html); require('./durable.cjs').localWrite(() => fs.renameSync(temporary, path.join(output, 'report.html')));
  const lines = ['# Benchmark 执行报告', '', report.synthetic ? '**合成模拟，不能用于比较模型效果。**' : '参考一致与独立评审，不代表牌力或正确率。', '', `执行：${report.phases.execution}；评审：${report.phases.review}；账单：${report.phases.billing}`, '', `生成：${report.generatedAt}；快照：${report.snapshotHash}`, '', '| 方案 | 质量通过率（通过/计划） | 未通过/待裁定/缺评 | 质量均分 / 4（六维可评数） | MAKA / GPT 得分率 | 两者平均 | 首选一致 MAKA/GPT | 候选覆盖 MAKA/GPT | 成功平均 / P95 ms | 实时含摘要失败均费 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |', ...rows.map(r => `| ${r.schemeId} | ${percent(r.qualityPassRate)}（${r.qualityPassed}/${r.reviewPlanned}） | ${r.qualityFailed}/${r.qualityNeedsReview}/${r.qualityMissing} | ${number(r.qualityMean)}（${r.qualityMeanCount}） | ${number(r.maka?.scoreRate)} / ${number(r.gpt?.scoreRate)} | ${number(r.averageScoreRate)} | ${number(r.maka?.preferredMatchesMean)} / ${number(r.gpt?.preferredMatchesMean)} | ${number(r.maka?.candidateCoverageMean)} / ${number(r.gpt?.candidateCoverageMean)} | ${number(r.endToEndMeanMs)} / ${number(r.endToEndP95Ms)} | ${r.pairedCosts ? `独立估算均费 ${number(r.pairedCosts.standaloneMeanCostPerSourceDispatch)}；共享草案＋纠错 ${number(r.pairedCosts.standaloneCost)}；协议增量 ${number(r.pairedCosts.protocolIncrementalCost)}` : number(r.meanCostPerDispatched)} |`), '', '质量通过率为主要指标；综合均分过滤缺分。W-V独立估算含共享草案与纠错，协议总账只计一次共享草案，不能将独立估算重复加入总账。未知费用不按零计算。MAKA/GPT 各项与所有六维、gate 明细见同快照 report.json / report.html。', '', '<details><summary>六维、gate 与执行明细</summary>', '', '```json', JSON.stringify(details, null, 2), '```', '</details>'];
  fs.writeFileSync(path.join(output, 'report.md.tmp'), lines.join('\n') + '\n'); require('./durable.cjs').localWrite(() => fs.renameSync(path.join(output, 'report.md.tmp'), path.join(output, 'report.md')));
  saveAtomic(path.join(output, 'report.json'), report);
}
module.exports = { enrich, writeDashboard };
