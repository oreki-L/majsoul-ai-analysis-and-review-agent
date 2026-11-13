'use strict';
// Frozen first-answer rubric adapter. No model calls, labels or credentials.
const Analysis = require('../extension/analysis.js');
const Snapshot = require('../extension/contracts/snapshot.js');
const { stableHash, authorizationFor, cleanEvent } = require('./core.cjs');
const VERSION = 'first-answer/1.0.1';
const DIMENSIONS = ['factual_accuracy', 'explanation_grounding', 'legal_comparison', 'context_isolation', 'calibration', 'usability'];
const ANCHORS = {
  factual_accuracy: ['核心结论建立在不可能/非法状态上，或多项严重错误使回答失效', '严重错误影响核心理由或选择', '局部实质错误影响部分理由，主决策仍可理解', '仅轻微不影响结论的事实瑕疵', '所有实质可检验主张与独立校验一致，无客观错'],
  explanation_grounding: ['无可辨认依据，或依据完全错置于其他状态', '主要为套话、循环理由或缺乏局面联系', '有相关理由但关键因果或前提欠缺', '核心依据清楚，少量步骤省略', '从当前可见信息到选择的推理链清楚，前提与限制明确'],
  legal_comparison: ['未比较、拒答却无依据，或把已确认非法候选当作主要推荐', '仅提候选名称/单方面断言优劣', '比较不完整或尺度不一致，但能辨认主要取舍', '请求范围内候选有实质比较，少一项次要权衡', '覆盖请求的合法候选，按相同目标比较收益/代价/适用条件'],
  context_isolation: ['核心回答针对错误局面，或系统性使用未来/其他分支信息', '明确跨巡/跨局/跨分支串入事实并影响核心理由', '一项局部混淆但未主导选择', '仅措辞或指代小误，未引入错误状态', '正确区分分支、局、巡、旧决策；只使用允许时点信息'],
  calibration: ['关键不可知内容被断言确定，导致使用者无法识别核心限制', '多次将猜测当事实，或用无条件断言覆盖关键未知', '一项实质过度确信，或过度含糊影响判断', '总体匹配，少量绝对化措辞', '事实、推断、偏好与未知明确区分，确信程度与证据匹配'],
  usability: ['无法使用或未回答所问', '难以确定实际建议，重复/散乱严重', '能提取选择和理由，但费力或缺关键操作说明', '清楚可用，仅少量冗余或组织问题', '直接回答，结构清楚、可执行，细节足够且不掩盖关键条件']
};
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
const RULES = deepFreeze({
  version: 1, contractVersion: VERSION, requiredModel: 'gpt-6-sol', reasoningEffort: 'medium', dimensions: DIMENSIONS,
  minimum: 0, maximum: 4,
  semantics: Object.fromEntries(DIMENSIONS.map(d => [d, ANCHORS[d].map((text, n) => n + ': ' + text).join('; ')])), anchors: ANCHORS,
  source: { rubric: 'rubric.first-answer.v1.0.1.md', sha256: '970fe0631592e413e9c5c03684fb9e5d52db5ba389cc47de1e47c42d487d8aad' },
  scope: '实时首答，final与draft独立评分；本合同不评分追问承接。统计分母取本次冻结计划，不沿用旧轮638。',
  blindness: '只读本盲包的answer、facts、rules；禁止读方案映射、参考倾向标签、费用、Key、旧评审和未来节点；策略偏好不同本身不是事实错误。',
  obligations: ['合法明确首选；身份、手牌、主要数值与风险对象无重大错误；理由一致。',
    '普通首答至少比较一个有意义的合法备选；仅一个合法候选时据实说明限制。不要求逐牌覆盖全部合法集合；任务明确指定更多候选时才按指定范围。',
    '解释效率与风险的取舍和未知边界；全unknown、套话、空表不能代替义务。',
    '缺规则、计算或证据时列uncertain；涉及gate的实质争议必须needs_review，不推定通过。',
    '当前snapshot是时点权威，localCalculation是生产确定性计算而非独立第二算法、战略最优或精确牌山/风险概率。',
    '机器事实引用匹配、JSON结构有效或未列出严重错误均不等于质量通过；核对全部自然语言、原因和比较。'],
  gate: { primary: true, statuses: ['pass', 'fail', 'needs_review'], definition: '显式综合判定首答义务，不由错误数组为空或均分推导。major/critical必须fail；最终未交付不能pass。',
    severity: { minor: '局部可修正且不改变选择、核心理由或使用条件', major: '影响核心理由、重要比较、限制或状态恢复，可能改变使用者选择', critical: '非法核心行动、不可能关键状态，或未来/其他分支事实使核心判断失效' },
    factualCaps: { major: 2, critical: 1 } },
  citations: '六维分别输出status、score、evidence。数值分的evidence至少一条，quote必须逐字出现在本包answer，source与reason非空。无实质可核验事实记not_judgable，不给自动4；本首答六维均适用，不用not_applicable。错误逐项提供severity、quote、expectedFact、evidenceSource、impact、rootCause；相同主因不得重复计为独立错误。',
  resultContract: { identity: ['blindId', 'sourceHash', 'rulesHash', 'model', 'reasoningEffort'], rubricVersion: VERSION, target: '与包target一致，默认final',
    gate: '{pass:boolean,majorError:boolean,status:pass|fail|needs_review,reason:string}',
    dimensions: '全部六维，{status:scored|not_judgable,score:0..4|null,evidence:[{quote,source,reason}]}',
    errors: '[{severity:minor|major|critical,quote,expectedFact,evidenceSource,impact,rootCause}]',
    uncertain: '[]或[{issue:string,affectsGate:boolean,reason:string}]；影响gate的未决争议必须needs_review' }
});
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function invalid(message) { throw new Error('Invalid first-answer review: ' + message); }
function validateReviewResult(job, result) {
  if (!job?.packet || !result || result.blindId !== job.blindId || result.sourceHash !== job.sourceHash || result.rulesHash !== job.rulesHash || result.model !== job.packet.rules.requiredModel || result.reasoningEffort !== job.packet.rules.reasoningEffort) invalid('identity, source, rules or reviewer mismatch');
  const target = job.packet.target ?? 'final', answer = job.packet.answer;
  if (job.packet.rules.contractVersion !== VERSION || result.rubricVersion !== VERSION || result.target !== target || typeof answer !== 'string') invalid('rubric or target mismatch');
  const gate = result.gate;
  if (!gate || !['pass', 'fail', 'needs_review'].includes(gate.status) || typeof gate.pass !== 'boolean' || typeof gate.majorError !== 'boolean' || !nonempty(gate.reason) || gate.pass !== (gate.status === 'pass')) invalid('explicit gate status, pass and reason required');
  if (target === 'final' && (job.packet.delivered === false || !answer.trim()) && gate.pass) invalid('undelivered final cannot pass');
  if (!result.dimensions || Object.keys(result.dimensions).length !== DIMENSIONS.length || DIMENSIONS.some(d => !Object.hasOwn(result.dimensions, d))) invalid('all six dimensions required');
  const scores = {}, scoreStatuses = {};
  for (const dimension of DIMENSIONS) {
    const row = result.dimensions[dimension];
    if (!row || !['scored', 'not_judgable'].includes(row.status) || !Array.isArray(row.evidence)) invalid('invalid dimension status');
    if (row.status === 'scored') {
      if (!Number.isFinite(row.score) || row.score < 0 || row.score > 4 || !row.evidence.length) invalid('bounded numeric score and evidence required');
    } else if (row.score !== null) invalid('unjudgable score must stay null');
    if (row.evidence.some(e => !e || !nonempty(e.quote) || !answer.includes(e.quote) || !nonempty(e.source) || !nonempty(e.reason))) invalid('dimension evidence must quote this answer literally');
    scores[dimension] = row.score; scoreStatuses[dimension] = row.status;
  }
  if (!Array.isArray(result.errors)) invalid('explicit error array required');
  const roots = new Set();
  for (const error of result.errors) {
    if (!error || !['minor', 'major', 'critical'].includes(error.severity) || !['quote', 'expectedFact', 'evidenceSource', 'impact', 'rootCause'].every(k => nonempty(error[k])) || !answer.includes(error.quote)) invalid('error evidence missing or not in answer');
    if (roots.has(error.rootCause)) invalid('duplicate independent root cause');
    roots.add(error.rootCause);
  }
  const critical = result.errors.some(e => e.severity === 'critical'), major = critical || result.errors.some(e => e.severity === 'major');
  if ((major || gate.majorError) && (gate.status !== 'fail' || !gate.majorError)) invalid('major/critical errors must fail explicitly');
  if (major && (!Number.isFinite(scores.factual_accuracy) || scores.factual_accuracy > (critical ? 1 : 2))) invalid('objective error factual score cap exceeded');
  if (!Array.isArray(result.uncertain) || result.uncertain.some(u => !u || !nonempty(u.issue) || typeof u.affectsGate !== 'boolean' || !nonempty(u.reason))) invalid('uncertainty needs explicit gate relevance');
  if (result.uncertain.some(u => u.affectsGate) && gate.status === 'pass') invalid('unresolved gate dispute cannot pass');
  if (gate.pass && DIMENSIONS.some(d => scoreStatuses[d] !== 'scored')) invalid('unjudgable required dimension cannot establish pass');
  const scored = Object.values(scores).filter(Number.isFinite), mean = scored.length === DIMENSIONS.length ? scored.reduce((n, x) => n + x, 0) / DIMENSIONS.length : null;
  return { ...structuredClone(result), scores, scoreStatuses, mean, partialMean: scored.length ? scored.reduce((n, x) => n + x, 0) / scored.length : null,
    scoredDimensionCount: scored.length, gate: gate.pass, gateStatus: gate.status, gateDetails: structuredClone(gate),
    severeErrors: result.errors.filter(e => ['major', 'critical'].includes(e.severity)).map(e => e.rootCause) };
}
function scopedNode(raw, current) {
  if (!raw || raw.sessionId !== current.sessionId || raw.roundId !== current.roundId || !Number.isSafeInteger(raw.position) || raw.position > current.position) return null;
  const snapshot = Snapshot.cleanSnapshot(raw.snapshot), authorization = authorizationFor(snapshot);
  if (snapshot.lastStep !== raw.position || stableHash(authorization) !== stableHash(current.authorization) || raw.authorization && stableHash(raw.authorization) !== stableHash(authorization)) return null;
  return { decisionId: raw.id, asOf: raw.position, snapshot, legalActions: (raw.legalActions ?? []).map(a => ({ action: a.action, tile: a.tile })) };
}
function authorizedEvents(events, node) {
  const auth = node.authorization, found = new Map();
  for (const event of events) {
    if (!event || !Number.isSafeInteger(event.position) || event.position > node.position || event.position < 0 || event.roundId !== undefined && event.roundId !== node.roundId || event.sessionId !== undefined && event.sessionId !== node.sessionId) continue;
    const e = cleanEvent(event, node.roundId, node.sessionId);
    if (e.seat !== undefined && e.seat >= node.snapshot.playerCount) continue;
    if (['draw', 'deal', 'hand'].includes(e.kind) ? e.seat !== auth.selfSeat || !auth.selfHand : ['discard', 'riichi', 'riichi-accepted'].includes(e.kind) ? !auth.riverSeats.includes(e.seat) : !auth.game) continue;
    found.set(stableHash(e), e);
  }
  return [...found.values()].sort((a, b) => a.position - b.position || stableHash(a).localeCompare(stableHash(b)));
}
function buildBlindFacts(input, run = {}, options = {}) {
  const raw = input?.node;
  if (!raw || !nonempty(raw.id) || !nonempty(raw.roundId) || !nonempty(raw.sessionId) || !Number.isSafeInteger(raw.position)) throw new Error('Blind facts require a bound frozen decision');
  const snapshot = Snapshot.cleanSnapshot(raw.snapshot), authorization = authorizationFor(snapshot), node = { ...raw, snapshot, authorization };
  if (snapshot.lastStep !== node.position || raw.authorization && stableHash(raw.authorization) !== stableHash(authorization)) throw new Error('Blind facts cutoff/authorization mismatch');
  const legalActions = (raw.legalActions ?? []).map(a => ({ action: a.action, tile: a.tile }));
  if (!legalActions.length || legalActions.some(a => a.action !== 'discard' || !snapshot.selfHand?.includes(a.tile)) || new Set(legalActions.map(a => a.tile)).size !== legalActions.length) throw new Error('Blind facts require exact legal candidates');
  const localCalculation = Analysis.prepare(snapshot, 'combined').data.localAnalysis;
  if (localCalculation.efficiency?.candidates) localCalculation.efficiency.candidates = localCalculation.efficiency.candidates.filter(c => legalActions.some(a => a.tile === c.tile));
  const round = options.dataset?.rounds?.find(r => r.id === node.roundId);
  const candidates = round ? round.decisions : Object.values(run.requests ?? {}).map(r => r.frozenInput?.node).filter(Boolean);
  const history = new Map();
  for (const candidate of candidates) {
    const bound = scopedNode(candidate, node);
    if (bound && bound.asOf < node.position) history.set(stableHash(bound), bound);
  }
  const eventSources = round ? round.events : [input.events ?? [], ...Object.values(run.requests ?? {}).map(r => r.frozenInput?.events ?? [])].flat();
  const decisionContext = Object.fromEntries(['phase', 'actor', 'triggerPosition', 'rulesSource'].filter(k => raw.decisionContext?.[k] !== undefined).map(k => [k, raw.decisionContext[k]]));
  return { snapshot, legalActions, asOf: node.position, decisionContext,
    localCalculation, calculationBoundary: 'Production deterministic calculations from this authorized frozen snapshot; not independent strategic optimum, precise wall contents or risk probability.',
    historicalSnapshots: [...history.values()].sort((a, b) => a.asOf - b.asOf || a.decisionId.localeCompare(b.decisionId)),
    events: authorizedEvents(eventSources, node),
    evidenceCoverage: round ? 'common frozen dataset, authorization and current cutoff applied' : 'available frozen requests only; missing historical evidence is unknown, never proof of an error',
    evaluationBoundary: 'No prompts, scheme metadata, old model answers, summaries, correction feedback, machine-check verdicts, reference preferences or future nodes are evidence.' };
}
module.exports = { VERSION, DIMENSIONS, RULES, validateReviewResult, buildBlindFacts };
