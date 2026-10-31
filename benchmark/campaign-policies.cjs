'use strict';
// Versioned, composable policies. This file contains no dataset, labels or credentials.
const { stableHash, canonicalStringify, authorizationFor } = require('./core.cjs');
const { compactSnapshot } = require('./context.cjs');
const Snapshot = require('../extension/contracts/snapshot.js');
const Production = require('./production-v010.cjs');
const VERSION = 'context-campaign/2.6.0-adapter.1';
const POLICIES = new Set(['A', 'B', 'B-current', 'B-dedup', 'D', 'E', 'G', 'K', 'M', 'KM', 'H1', 'H2', 'H2-dedup', 'H3', 'H4', 'H4-advice', 'H5', 'H6', 'H7', 'H8', 'Factorial-S1A0', 'Factorial-S1A1', ...['SnapshotHistory', 'AdviceHistory'].flatMap(c => ['Truncate', 'Extract', 'CodeCompress', 'LLMCompress', 'Hybrid'].map(t => `${c}-${t}`))]);
const IMPORTANT = new Set(['NewRound', 'ChiPengGang', 'AnGangAddGang', 'BaBei', 'riichi', 'riichi-declaration', 'riichi-accepted', 'dora-change', 'score-or-stick-change', 'round-start', 'meld', 'kan', 'north-extraction']);
const clone = v => structuredClone(v);
function same(a, b) { return canonicalStringify(a) === canonicalStringify(b); }
function projectBaseline(raw, node) {
  if (!raw?.snapshot || !Number.isSafeInteger(raw.position) || raw.position > node.position) throw new Error('Exact production baseline is required');
  const snapshot = Snapshot.cleanSnapshot(raw.snapshot); delete snapshot.availableActions;
  if (!node.snapshot.selfHand) { delete snapshot.selfHand; snapshot.selfDrawnTile = null; }
  if (!node.snapshot.game) delete snapshot.game;
  if (snapshot.rivers) snapshot.rivers = snapshot.rivers.filter(r => node.snapshot.rivers?.some(c => c.seat === r.seat));
  return { position: raw.position, snapshot, origin: raw.origin, ...(raw.reason ? { reason: raw.reason } : {}) };
}
function importantEvents(events) { return events.filter(e => IMPORTANT.has(e.kind) || e.riichi === true); }
function importantFacts(roundSource, node, initial, events) {
  const out = [{ kind: 'round-start', position: initial.position, source: 'authorized-round-baseline', snapshotHash: stableHash(initial.snapshot), game: initial.snapshot.game ? { round: initial.snapshot.game.round, honba: initial.snapshot.game.honba, sticks: initial.snapshot.game.sticks, scores: initial.snapshot.game.scores, doras: initial.snapshot.game.doras } : null }];
  for (const event of importantEvents(events).filter(e => e.kind !== 'NewRound')) out.push(event);
  let before = initial.snapshot;
  for (const state of (roundSource.states ?? []).filter(s => s.position <= node.position).sort((a, b) => a.position - b.position)) {
    const after = Snapshot.cleanSnapshot(state.snapshot);
    if (!same(authorizationFor(after), node.authorization)) throw new Error('Important state-difference authorization mismatch');
    for (const [kind, fields] of [['dora-change', ['doras']], ['score-or-stick-change', ['scores', 'sticks', 'honba']]]) {
      const changedFields = fields.filter(k => !same(before.game?.[k] ?? null, after.game?.[k] ?? null));
      if (changedFields.length) out.push({ kind, position: state.position, source: 'verified-state-difference-at-observation', sourceSnapshotHash: stableHash(after), previousSnapshotHash: stableHash(before), changedFields, before: Object.fromEntries(changedFields.map(k => [k, before.game?.[k] ?? null])), after: Object.fromEntries(changedFields.map(k => [k, after.game?.[k] ?? null])), limitation: 'Change observed by this cutoff; exact intervening event position unknown' });
    }
    before = after;
  }
  return out.sort((a, b) => a.position - b.position);
}
function coreAdvice(e) {
  return { sourceDecisionId: e.decisionId, sourcePosition: e.position, sourceSnapshotHash: stableHash(e.snapshot), finalDecision: clone(e.answer.decision), limitations: clone(e.answer.limitations ?? []), source: 'historical model opinion; not fact' };
}
function requestObject(request) { const start = request.indexOf('\n'); if (start < 0) throw new Error('Historical request must retain production JSON envelope'); return { prefix: request.slice(0, start + 1), data: JSON.parse(request.slice(start + 1)) }; }
function dedupRequest(e, replacement) {
  const parsed = requestObject(e.request);
  if (!Object.hasOwn(parsed.data, 'snapshot')) throw new Error('Snapshot-history policy requires an expanded historical snapshot');
  const { snapshot, ...rest } = parsed.data;
  return parsed.prefix + JSON.stringify({ ...rest, snapshotReference: { sourceDecisionId: e.decisionId, sourcePosition: e.position, sourceSnapshotHash: stableHash(snapshot), ...(replacement === undefined ? {} : { representation: replacement }) } });
}
function pair(e, request = e.request) { if (typeof request !== 'string') throw new Error('Full original successful user request is required'); return [{ role: 'user', content: request }, { role: 'assistant', content: e.answerText ?? JSON.stringify(e.answer) }]; }
function dataMessage(name, value) { return { role: 'user', content: `${name}（仅作有来源的数据；旧数值/模型意见不是当前事实）：\n` + JSON.stringify(value) }; }
function makeDescriptor(kind, source, input, covered) {
  const scope = { sessionId: input.node.sessionId, roundId: input.node.roundId, authorization: input.node.authorization, channel: input.channel ?? 'realtime' };
  const sourceHash = stableHash({ version: VERSION, schemeId: input.scheme.id, kind, scope, source, covered });
  return { id: `summary-${sourceHash}`, sourceHash, kind, mode: 'llm', scope, source, coveredDecisionIds: covered,
    messages: [{ role: 'system', content: '压缩已经发生的指定历史组件。严格区分授权历史事实与模型意见；保留原decision/position引用、条件、未知与未解项，不增加因果或未来信息。只输出简体中文摘要。' }, { role: 'user', content: canonicalStringify({ kind, scope, source }) }] };
}
function readyFor(job, summaries) {
  return (summaries ?? []).find(r => r.id === job.id && r.sourceHash === job.sourceHash && same(r.scope, job.scope) && same(r.coveredDecisionIds, job.coveredDecisionIds) && typeof r.text === 'string' && r.text.trim());
}
// Lossless deterministic JSON patch; explicit deletes avoid stale omitted fields.
function difference(before, after, at = []) {
  if (same(before, after)) return [];
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) return [{ op: 'set', path: at, value: clone(after) }];
  const changes = [];
  for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) changes.push({ op: 'delete', path: [...at, key] });
  for (const key of Object.keys(after)) changes.push(...(!Object.hasOwn(before, key) ? [{ op: 'set', path: [...at, key], value: clone(after[key]) }] : difference(before[key], after[key], [...at, key])));
  return changes;
}
function codeFacts(entries) {
  if (!entries.length) return { format: 'snapshot-delta-v1', entries: [] };
  return { format: 'snapshot-delta-v1', legend: 'First snapshot is complete; later path arrays apply set/delete in order. Historical authorized facts, never current state.', entries: entries.map((e, i) => ({ decisionId: e.decisionId, position: e.position, snapshotHash: stableHash(e.snapshot), ...(i ? { changes: difference(entries[i - 1].snapshot, e.snapshot) } : { snapshot: e.snapshot }) })) };
}
function extractFacts(e, node) {
  const s = e.snapshot, threatened = node.snapshot.game?.players.filter(p => p.riichi || p.melds.length >= 2).map(p => p.seat) ?? [];
  return { decisionId: e.decisionId, position: e.position, snapshotHash: stableHash(s), representation: 'fixed field extraction; omitted fields unknown', selfHand: s.selfHand, selfDrawnTile: s.selfDrawnTile, ownMelds: s.game?.players[s.selfSeat]?.melds, round: s.game?.round, scores: s.game?.scores, remaining: s.game?.remaining, doras: s.game?.doras, threats: (s.game?.players ?? []).filter(p => threatened.includes(p.seat)), rivers: (s.rivers ?? []).filter(r => threatened.includes(r.seat)) };
}
function codeAdvice(entries) {
  const reasons = [], refs = new Map();
  const items = entries.map(e => { const a = coreAdvice(e); return { ...a, finalDecision: { ...a.finalDecision, reasons: a.finalDecision.reasons.map(reason => { if (!refs.has(reason)) { refs.set(reason, reasons.length); reasons.push(reason); } return { reasonRef: refs.get(reason) }; }) } }; });
  return { format: 'opinion-dictionary-v1', reasonDictionary: reasons, entries: items, meaning: 'Verbatim reason dictionary, no generated causal claims' };
}
function relatedEvents(events, node, window) {
  const candidates = new Set(node.legalActions.map(a => a.tile)), threats = new Set(node.snapshot.game?.players.filter(p => p.riichi || p.melds.length >= 2).map(p => p.seat) ?? []);
  return events.filter(e => !importantEvents([e]).length && (candidates.has(e.tile) || threats.has(e.seat) || (e.tiles ?? []).some(t => candidates.has(t)))).slice(-window);
}
function currentRequest(prepared, node, kind, question = '', deltaEvents = []) {
  const request = Production.messagesFor(prepared, node.snapshot, { checkpoint: { position: node.position } }, question).at(-1).content;
  if (kind === 'full') return request;
  const parsed = requestObject(request); delete parsed.data.snapshot;
  if (kind === 'compact') parsed.data.snapshot = compactSnapshot(node.snapshot);
  else parsed.data.incremental = { events: deltaEvents, sourceSnapshotHash: stableHash(node.snapshot), factAuthority: 'baseline plus ordered authorized events; tools provide current frozen facts' };
  return parsed.prefix + JSON.stringify(parsed.data);
}
function scopedHistory(input) {
  return (input.history ?? []).filter(e => e.roundId === input.node.roundId && e.sessionId === input.node.sessionId && e.position < input.node.position && same(e.authorization, input.node.authorization)).map(e => {
    if (e.snapshot.lastStep !== e.position || !same(authorizationFor(e.snapshot), input.node.authorization)) throw new Error('History scope/cutoff mismatch');
    return e;
  });
}

function buildCampaignContext(input, roundSource) {
  const p = { recent: 4, trigger: 1, ordinaryEventWindow: 12, checkpointEvery: 4, extractLimit: 4, ...input.options }, policy = p.policy;
  if (!POLICIES.has(policy) || p.version !== VERSION) throw new Error('Explicit supported versioned campaign policy is required');
  for (const key of ['recent', 'trigger', 'ordinaryEventWindow', 'checkpointEvery', 'extractLimit']) if (!Number.isSafeInteger(p[key]) || p[key] < 1) throw new Error('Campaign policy window parameters must be positive integers');
  const node = input.node, prepared = input.prepared, history = scopedHistory(input), jobs = [], stats = { policy, version: VERSION, recent: p.recent, priorCount: history.length, sourceIds: history.map(e => e.decisionId), snapshots: { inputItems: history.length, rawItems: 0, summarizedItems: 0, transformedItems: 0 }, advice: { inputItems: history.length, rawItems: 0, summarizedItems: 0 }, retainedDroppedCounts: {}, summarySourceIds: [] };
  const initial = projectBaseline(roundSource?.baseline, node);
  const allEvents = Production.authorizedEvents(node.snapshot, roundSource.events ?? [], node.position);
  const isImportant = importantFacts(roundSource, node, initial, allEvents), scoped = { ...input, history };
  const system = prepared.systemPrompt + Production.TOOL_SYSTEM_SUFFIX;
  if (input.channel === 'decision-discussion') {
    const messages = [{ role: 'system', content: system }, ...Production.messagesFor(prepared, node.snapshot, { baseline: { position: node.position, snapshot: node.snapshot, origin: 'mid-round', reason: 'frozen-decision-discussion' }, checkpoint: { position: node.position }, events: allEvents, timeline: [] }, '')];
    messages.push({ role: 'assistant', content: JSON.stringify(input.originalAnswer) });
    for (const q of input.branchHistory ?? []) messages.push({ role: 'user', content: q.question }, { role: 'assistant', content: q.answer });
    messages.push({ role: 'user', content: input.question });
    return { messages, summaryJobs: [], qaResponseFormat: 'analysis-json', compression: stats, sourceDecisionIds: [], historyPolicy: { version: VERSION, channel: 'decision-discussion', freeze: node.id, productionDuplicateSnapshot: true } };
  }
  if (input.channel !== 'realtime') throw new Error('This policy only implements realtime and production-frozen natural QA; global uses a separate scope adapter');
  const continuous = ['B', 'B-current', 'B-dedup', 'D', 'K', 'M', 'KM', 'H7'].includes(policy) || policy.startsWith('SnapshotHistory-');
  const h4 = ['H4', 'H4-advice', 'H5', 'H6', 'H8'].includes(policy) || policy.startsWith('AdviceHistory-') || policy.startsWith('Factorial-');
  const timeline = [];
  // Reproduce production event segmentation: all observations between successful
  // exchanges, including observations belonging to failed analysis points.
  let after = initial.position - 1;
  function observations(until) {
    const groups = roundSource.observations ?? allEvents.map(e => ({ position: e.position, events: [e] }));
    for (const group of groups.filter(g => g.position > after && g.position <= until)) timeline.push({ type: 'observation', position: group.position, events: Production.authorizedEvents(node.snapshot, group.events, group.position) });
    after = until;
  }
  for (const e of history) { observations(e.position); timeline.push({ type: 'exchange', ...e, answer: e.answerText ?? JSON.stringify(e.answer) }); }
  observations(node.position);
  const production = Production.messagesFor(prepared, node.snapshot, { baseline: initial, checkpoint: { position: node.position }, events: allEvents, timeline }, '');
  if (policy === 'B' || policy === 'B-current') return { messages: [{ role: 'system', content: system }, ...production.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(c => c.text).join('') }))], summaryJobs: [], compression: stats, sourceDecisionIds: history.map(e => e.decisionId), historyPolicy: { version: VERSION, policy, baselineHash: stableHash(initial), exactProduction: false, productionEnvelopeExact: true, promptBaseline: 'v0.10 plus benchmark common analysis-json contract' } };
  const messages = [{ role: 'system', content: system }];
  const currentKind = ['E', 'G'].includes(policy) ? 'compact' : policy === 'D' ? 'delta' : 'full';
  let current = currentRequest(prepared, node, currentKind, '', allEvents.filter(e => e.position > (history.at(-1)?.position ?? initial.position)));
  if (continuous) messages.push(production[0]);
  let selectedEvents = h4 ? isImportant : allEvents;
  if (['G', 'H3'].includes(policy)) {
    const ordinal = Math.max(0, Math.floor((history.length - 1) / p.checkpointEvery) * p.checkpointEvery), checkpoint = history[ordinal];
    const pos = checkpoint?.position ?? initial.position;
    messages.push(dataMessage('确定性授权checkpoint', { coveredPosition: pos, snapshot: checkpoint?.snapshot ?? initial.snapshot, snapshotHash: stableHash(checkpoint?.snapshot ?? initial.snapshot), sourceDecisionId: checkpoint?.decisionId ?? null }));
    selectedEvents = allEvents.filter(e => e.position > pos && (importantEvents([e]).length || allEvents.slice(-p.ordinaryEventWindow).includes(e)));
  }
  if (policy === 'A') selectedEvents = [];
  if (policy === 'H6') selectedEvents = [...new Map([...isImportant, ...relatedEvents(allEvents, node, p.ordinaryEventWindow)].map(e => [JSON.stringify(e), e])).values()].sort((a, b) => a.position - b.position);
  const sourcePrefix = history.slice(0, Math.max(0, history.length - p.recent)), recent = history.slice(sourcePrefix.length);
  const snapshots = policy.startsWith('SnapshotHistory-'), advice = policy.startsWith('AdviceHistory-');
  const treatment = snapshots || advice ? policy.split('-').slice(1).join('-') : null;
  let covered = 0, transformed = null, activeSummary = null;
  if (policy === 'B-dedup') covered = history.length;
  const summaryKind = policy === 'M' ? 'mixed-history' : ['KM', 'H7'].includes(policy) ? 'opinions-only' : snapshots ? 'snapshot-facts-only' : 'core-advice-only';
  const llm = ['M', 'KM', 'H7'].includes(policy) || ['LLMCompress', 'Hybrid'].includes(treatment);
  function summarySource(entries) {
    if (summaryKind === 'mixed-history') return entries.map((e, i) => ({ decisionId: e.decisionId, position: e.position, snapshot: e.snapshot, events: allEvents.filter(ev => ev.position > (entries[i - 1]?.position ?? initial.position) && ev.position <= e.position), question: requestObject(e.request).data.question, answer: e.answer }));
    if (snapshots) return entries.map(e => ({ decisionId: e.decisionId, position: e.position, snapshot: e.snapshot }));
    if (summaryKind === 'opinions-only') return entries.map(e => ({ sourceDecisionId: e.decisionId, sourcePosition: e.position, sourceSnapshotHash: stableHash(e.snapshot), question: requestObject(e.request).data.question, answer: e.answer, source: 'historical model opinion; not fact' }));
    return entries.map(coreAdvice);
  }
  if (llm && sourcePrefix.length >= p.trigger) {
    // Prefer the longest exactly matching prefix; old valid shorter summaries are reusable.
    for (let count = sourcePrefix.length; count >= p.trigger; count--) {
      const entries = sourcePrefix.slice(0, count), source = summarySource(entries);
      const descriptor = makeDescriptor(summaryKind, source, scoped, entries.map(e => e.decisionId));
      const ready = readyFor(descriptor, input.summary);
      if (ready) { covered = count; activeSummary = { representation: 'derived historical summary; not authoritative', text: ready.text, sourceHash: descriptor.sourceHash, coveredDecisionIds: descriptor.coveredDecisionIds, kind: summaryKind }; break; }
    }
    const source = summarySource(sourcePrefix);
    if (covered !== sourcePrefix.length) jobs.push(makeDescriptor(summaryKind, source, scoped, sourcePrefix.map(e => e.decisionId)));
  }
  if (['K', 'KM', 'H7'].includes(policy) && sourcePrefix.length) {
    // KM fallback must retain the raw not-yet-summarized source, never silently drop it.
    const codeEntries = policy === 'K' ? sourcePrefix : sourcePrefix.slice(0, covered);
    if (codeEntries.length) { messages.push(dataMessage('代码历史事实骨架', { ...codeFacts(codeEntries), events: allEvents.filter(e => e.position <= codeEntries.at(-1).position) })); covered = codeEntries.length; if (policy === 'K') messages.push(dataMessage('代码历史意见摘录', codeAdvice(codeEntries))); }
  }
  if (activeSummary) { messages.push(dataMessage('后台历史摘要', activeSummary)); stats.summarySourceIds = activeSummary.coveredDecisionIds; if (snapshots) stats.snapshots.summarizedItems = covered; else stats.advice.summarizedItems = covered; }
  if (snapshots || advice) {
    if (treatment === 'Truncate') { covered = sourcePrefix.length; transformed = { omittedDecisionIds: sourcePrefix.map(e => e.decisionId), rule: 'retain recent complete component records only' }; }
    if (treatment === 'Extract') { covered = sourcePrefix.length; transformed = snapshots ? sourcePrefix.map(e => extractFacts(e, node)) : sourcePrefix.filter((e, i, all) => i >= all.length - p.extractLimit || e.answer.decision.action === 'defend' || e.answer.decision.action === 'fold').map(coreAdvice); }
    if (treatment === 'CodeCompress') { covered = sourcePrefix.length; transformed = snapshots ? codeFacts(sourcePrefix) : codeAdvice(sourcePrefix); }
    if (treatment === 'Hybrid' && covered) messages.push(dataMessage(snapshots ? 'snapshot代码事实骨架' : 'advice代码来源骨架', snapshots ? codeFacts(sourcePrefix.slice(0, covered)) : codeAdvice(sourcePrefix.slice(0, covered))));
    if (transformed && sourcePrefix.length) messages.push(dataMessage(`${snapshots ? 'SnapshotHistory' : 'AdviceHistory'}-${treatment}`, transformed));
  }
  if (continuous) {
    if (policy === 'B-dedup' || snapshots || policy === 'D') {
      const replacements = new Map(history.map((e, i) => [e.request, policy === 'B-dedup' || snapshots && i < covered ? dedupRequest(e) : e.request]));
      for (const original of production.slice(1, -1)) messages.push({ role: original.role, content: typeof original.content === 'string' ? replacements.get(original.content) ?? original.content : original.content.map(c => c.text).join('') });
      messages.push({ role: 'user', content: current });
      stats.snapshots.transformedItems = covered; stats.snapshots.rawItems = history.length - covered;
      stats.retainedDroppedCounts = { source: history.length, transformedPrefix: covered, retainedRecent: recent.length, fallbackPrefix: sourcePrefix.length - covered, droppedComponents: treatment === 'Truncate' ? covered : 0 };
      return { messages, summaryJobs: jobs, compression: stats, sourceDecisionIds: history.map(e => e.decisionId), historyPolicy: { version: VERSION, policy, eligibleSourceIds: sourcePrefix.map(e => e.decisionId), coveredDecisionIds: history.slice(0, covered).map(e => e.decisionId), recentSourceIds: recent.map(e => e.decisionId), baselineHash: stableHash(initial), currentKind } };
    }
    if (['K', 'M', 'KM', 'H7'].includes(policy) && covered) selectedEvents = selectedEvents.filter(e => e.position > sourcePrefix[covered - 1].position);
    if (selectedEvents.length) messages.push(dataMessage('已授权历史事件', selectedEvents));
    if (policy === 'D') for (const e of history) messages.push(...pair(e));
    else if (policy === 'B-dedup') for (const e of history) messages.push(...pair(e, dedupRequest(e)));
    else if (snapshots) for (let i = 0; i < history.length; i++) messages.push(...pair(history[i], i < covered ? dedupRequest(history[i]) : history[i].request));
    else for (const e of history.slice(covered)) messages.push(...pair(e));
  } else {
    if (selectedEvents.length) messages.push(dataMessage('已授权历史事件', selectedEvents));
    if (['H2', 'H2-dedup', 'G'].includes(policy)) for (const e of history.slice(-p.recent)) messages.push(...pair(e, policy === 'H2-dedup' ? dedupRequest(e) : e.request));
    if (policy === 'H4-advice' || advice) {
      const raw = advice ? history.slice(covered) : history;
      if (raw.length) messages.push(dataMessage('过去自动实时核心建议', raw.map(coreAdvice)));
    }
    if ((policy === 'Factorial-S1A0' || policy === 'Factorial-S1A1') && history.length) messages.push(dataMessage('旧巡授权snapshot组件', history.map(e => ({ decisionId: e.decisionId, position: e.position, snapshotHash: stableHash(e.snapshot), snapshot: e.snapshot }))));
    if (policy === 'Factorial-S1A1' && history.length) messages.push(dataMessage('过去自动实时核心建议', history.map(coreAdvice)));
    if (policy === 'H5') messages.push(dataMessage('当前全部合法候选事实卡', { stateId: node.id, position: node.position, snapshotHash: stableHash(node.snapshot), rules: node.decisionContext, constraints: node.discardConstraints ?? null, source: 'deterministic local tools; unseen counts are upper bounds', legalActions: node.legalActions, calculations: prepared.data.localAnalysis }));
  }
  messages.push({ role: 'user', content: current });
  stats.snapshots.transformedItems = covered; stats.snapshots.rawItems = history.length - covered; stats.advice.rawItems = history.length - covered;
  stats.retainedDroppedCounts = { source: history.length, transformedPrefix: covered, retainedRecent: recent.length, fallbackPrefix: sourcePrefix.length - covered, droppedComponents: treatment === 'Truncate' ? covered : 0 };
  return { messages, summaryJobs: jobs, compression: stats, sourceDecisionIds: history.map(e => e.decisionId), historyPolicy: { version: VERSION, policy, eligibleSourceIds: sourcePrefix.map(e => e.decisionId), coveredDecisionIds: history.slice(0, covered).map(e => e.decisionId), recentSourceIds: recent.map(e => e.decisionId), baselineHash: stableHash(initial), currentKind } };
}
module.exports = { VERSION, buildCampaignContext, currentRequest, dedupRequest, coreAdvice, codeFacts, codeAdvice, difference, projectBaseline, makeDescriptor, readyFor };
