'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Snapshot = require('../extension/contracts/snapshot.js');
const Analysis = require('../extension/mahjong-analysis.js');

function fail(where, reason) { throw new Error(`Benchmark ${where}: ${reason}`); }
function object(value, where) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'expected object'); return value; }
function keys(value, allowed, where) { object(value, where); if (Object.keys(value).some(key => !allowed.includes(key))) fail(where, 'unsupported field'); }
function id(value, where) { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:+-]{0,127}$/.test(value)) fail(where, 'invalid identifier'); return value; }
function integer(value, where, min = 0) { if (!Number.isSafeInteger(value) || value < min) fail(where, 'invalid integer'); return value; }
function enumeration(value, allowed, where) { if (!allowed.includes(value)) fail(where, 'unsupported value'); return value; }
function text(value, where) { if (typeof value !== 'string' || !value.length || value.length > 1000000) fail(where, 'invalid text'); return value; }
function canonicalStringify(value) {
  const seen = new Set();
  function visit(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== 'object' || seen.has(item)) throw new Error('Benchmark canonical data must be finite JSON');
    seen.add(item);
    const out = Array.isArray(item) ? `[${item.map(visit).join(',')}]` : `{${Object.keys(item).sort().map(k => `${JSON.stringify(k)}:${visit(item[k])}`).join(',')}}`;
    seen.delete(item); return out;
  }
  return visit(value);
}
function stableHash(value) { return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
const MODES = ['none', 'raw', 'truncate', 'extract', 'code', 'llm', 'hybrid'];
const EVENT_KINDS = ['draw', 'deal', 'hand', 'discard', 'riichi', 'riichi-accepted', 'reach', 'meld', 'chi', 'pon', 'kan', 'ankan', 'kakan', 'daiminkan', 'dora', 'call', 'north', 'score', 'round-start', 'round-end', 'round_start', 'round_end', 'game-start', 'game-end', 'win', 'exhaustive-draw', 'tsumo', 'dahai', 'hora', 'ryukyoku', 'reach_accepted', 'start_kyoku', 'end_kyoku', 'start_game', 'end_game', 'nukidora'];
const EVENT_ALIASES = { tsumo: 'draw', dahai: 'discard', reach: 'riichi', reach_accepted: 'riichi-accepted', start_kyoku: 'round-start', round_start: 'round-start', end_kyoku: 'round-end', round_end: 'round-end', start_game: 'game-start', end_game: 'game-end', hora: 'win', ryukyoku: 'exhaustive-draw', nukidora: 'north' };
function compressionSpec(raw, where) {
  if (raw === undefined) return { mode: 'none', recent: 0, trigger: 1, maxChars: 2000 };
  if (typeof raw === 'string') raw = { mode: raw };
  keys(raw, ['mode', 'recent', 'trigger', 'maxChars'], where);
  return { mode: enumeration(raw.mode, MODES, where), recent: integer(raw.recent ?? 0, where), trigger: integer(raw.trigger ?? 1, where, 1), maxChars: integer(raw.maxChars ?? 2000, where, 1) };
}
function validateContext(raw = {}) {
  keys(raw, ['current', 'events', 'snapshots', 'advice', 'module', 'options', 'activeCards', 'eventWindow', 'importantKinds', 'relatedSeats'], 'context');
  if (raw.module !== undefined) text(raw.module, 'context.module');
  if (raw.options !== undefined && !raw.module) fail('context.options', 'requires module');
  if (raw.options !== undefined) canonicalStringify(raw.options);
  if (raw.activeCards !== undefined && typeof raw.activeCards !== 'boolean') fail('context.activeCards', 'expected boolean');
  for (const key of ['importantKinds', 'relatedSeats']) if (raw[key] !== undefined && !Array.isArray(raw[key])) fail(`context.${key}`, 'expected array');
  if (raw.importantKinds) raw.importantKinds.forEach(x => enumeration(x, EVENT_KINDS, 'context.importantKinds'));
  if (raw.relatedSeats) raw.relatedSeats.forEach(x => { integer(x, 'context.relatedSeats'); if (x > 3) fail('context.relatedSeats', 'invalid seat'); });
  return { current: enumeration(raw.current ?? 'full', ['full', 'compact'], 'context.current'), events: enumeration(raw.events ?? 'none', ['none', 'important', 'all', 'related'], 'context.events'),
    snapshots: compressionSpec(raw.snapshots, 'context.snapshots'), advice: compressionSpec(raw.advice, 'context.advice'), activeCards: raw.activeCards ?? false,
    ...(raw.eventWindow !== undefined ? { eventWindow: integer(raw.eventWindow, 'context.eventWindow', 1) } : {}),
    ...(raw.importantKinds ? { importantKinds: raw.importantKinds.map(k => EVENT_ALIASES[k] ?? k) } : {}), ...(raw.relatedSeats ? { relatedSeats: raw.relatedSeats.slice() } : {}),
    ...(raw.module ? { module: raw.module, options: raw.options ?? {} } : {}) };
}
function validateSuite(raw) {
  keys(raw, ['schemaVersion', 'id', 'dataset', 'labels', 'schemes', 'models', 'execution', 'description'], 'suite');
  if (raw.schemaVersion !== 1) fail('suite', 'unsupported schemaVersion');
  id(raw.id, 'suite.id'); text(raw.dataset, 'suite.dataset');
  if (raw.labels !== undefined) text(raw.labels, 'suite.labels');
  object(raw.models, 'suite.models');
  const models = Object.create(null);
  for (const [name, model] of Object.entries(raw.models)) {
    id(name, 'model id'); keys(model, ['provider', 'endpoint', 'model', 'rates', 'credentialAlias', 'temperature', 'maxTokens', 'usageSemantics', 'thinking', 'pricingSchedule', 'liabilityBound'], 'model');
    if (model.liabilityBound !== undefined) {
      keys(model.liabilityBound, ['inputTokens', 'outputTokens', 'contractHash'], 'model.liabilityBound');
      integer(model.liabilityBound.inputTokens, 'model.liabilityBound.inputTokens', 1);
      integer(model.liabilityBound.outputTokens, 'model.liabilityBound.outputTokens', 1);
      if (typeof model.liabilityBound.contractHash !== 'string' || !/^[a-f0-9]{64}$/.test(model.liabilityBound.contractHash)) fail('model.liabilityBound.contractHash', 'expected SHA256');
      if (model.maxTokens > model.liabilityBound.outputTokens) fail('model.liabilityBound', 'output exceeds contract ceiling');
    }
    if (model.usageSemantics !== undefined) {
      keys(model.usageSemantics, ['inputIncludesCached', 'noCache'], 'model.usageSemantics');
      for (const value of Object.values(model.usageSemantics)) if (typeof value !== 'boolean') fail('model.usageSemantics', 'expected boolean values');
    }
    enumeration(model.provider, ['mock', 'openai-compatible'], 'model.provider');
    if (model.credentialAlias !== undefined) id(model.credentialAlias, 'model.credentialAlias');
    if (model.provider === 'openai-compatible') {
      text(model.endpoint, 'model.endpoint'); text(model.model, 'model.model');
      let url; try { url = new URL(model.endpoint); } catch { fail('model.endpoint', 'invalid URL'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('model.endpoint', 'expected credential-free HTTP URL');
    }
    if (model.rates !== undefined) {
      keys(model.rates, ['input', 'uncachedInput', 'output', 'cachedInput', 'currency', 'unit', 'perTokens', 'inputPerMillion', 'outputPerMillion', 'cachedInputPerMillion'], 'model.rates');
      for (const [key, val] of Object.entries(model.rates)) if (!['currency', 'unit'].includes(key) && (typeof val !== 'number' || !Number.isFinite(val) || val < 0)) fail('model.rates', 'invalid rate');
      if (model.rates.currency !== undefined) enumeration(model.rates.currency, ['CNY', 'USD'], 'model.rates.currency');
      if (model.rates.unit !== undefined) enumeration(model.rates.unit, ['perMillion'], 'model.rates.unit');
    }
    if (model.pricingSchedule !== undefined) {
      const p = model.pricingSchedule; keys(p, ['timezone', 'peak', 'offPeak', 'currency', 'holidays', 'holidaysVerified'], 'model.pricingSchedule');
      enumeration(p.timezone, ['Asia/Shanghai'], 'model.pricingSchedule.timezone'); enumeration(p.currency, ['CNY'], 'model.pricingSchedule.currency');
      for (const period of ['peak', 'offPeak']) { keys(p[period], ['cachedInput', 'uncachedInput', 'output', 'unit'], 'model.pricingSchedule.' + period); for (const rate of ['cachedInput', 'uncachedInput', 'output']) if (!Number.isFinite(p[period][rate]) || p[period][rate] < 0) fail('model.pricingSchedule', 'invalid rate'); if (p[period].unit !== undefined && p[period].unit !== 'perMillion') fail('model.pricingSchedule', 'invalid unit'); }
      if (p.holidays !== undefined && (!Array.isArray(p.holidays) || p.holidays.some(x => typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)))) fail('model.pricingSchedule.holidays', 'invalid dates');
      if (p.holidaysVerified !== undefined && typeof p.holidaysVerified !== 'boolean') fail('model.pricingSchedule.holidaysVerified', 'expected boolean');
    }
    if (model.thinking !== undefined) { keys(model.thinking, ['type'], 'model.thinking'); enumeration(model.thinking.type, ['disabled', 'enabled'], 'model.thinking.type'); }
    if (model.temperature !== undefined && (!Number.isFinite(model.temperature) || model.temperature < 0)) fail('model.temperature', 'invalid number');
    if (model.maxTokens !== undefined) integer(model.maxTokens, 'model.maxTokens', 1);
    models[name] = JSON.parse(canonicalStringify(model));
  }
  if (!Array.isArray(raw.schemes) || !raw.schemes.length) fail('suite.schemes', 'expected nonempty array');
  const seen = new Set();
  const schemes = raw.schemes.map(s => {
    keys(s, ['id', 'modelId', 'credentialAlias', 'context', 'review', 'summaryModelId', 'description', 'aliasOf'], 'scheme');
    id(s.id, 'scheme.id'); if (seen.has(s.id)) fail('scheme.id', 'duplicate'); seen.add(s.id);
    if (!Object.hasOwn(models, s.modelId)) fail('scheme.modelId', 'unknown model');
    if (s.summaryModelId !== undefined && !Object.hasOwn(models, s.summaryModelId)) fail('scheme.summaryModelId', 'unknown model');
    if (s.credentialAlias !== undefined) id(s.credentialAlias, 'scheme.credentialAlias');
    if (s.aliasOf !== undefined) id(s.aliasOf, 'scheme.aliasOf');
    if (s.review !== undefined && typeof s.review !== 'boolean') fail('scheme.review', 'expected boolean');
    return { ...s, context: validateContext(s.context), review: s.review ?? false };
  });
  for (const s of schemes) if (s.aliasOf && (!schemes.some(t => t.id === s.aliasOf && !t.aliasOf) || s.aliasOf === s.id)) fail('scheme.aliasOf', 'requires a distinct canonical scheme');
  const e = raw.execution ?? {};
  keys(e, ['repetitions', 'seed', 'concurrency', 'timeoutMs', 'maxModelRequests', 'maxToolCalls', 'budget', 'backgroundPolicy', 'foregroundQuotaId', 'summaryQuotaId'], 'execution');
  const b = e.budget ?? {}; keys(b, ['cap', 'currency'], 'execution.budget');
  if (b.cap !== undefined && b.cap !== null && (!Number.isFinite(b.cap) || b.cap < 0)) fail('execution.budget.cap', 'invalid number');
  const execution = { repetitions: integer(e.repetitions ?? 1, 'execution.repetitions', 1), seed: integer(e.seed ?? 1, 'execution.seed'), concurrency: integer(e.concurrency ?? 1, 'execution.concurrency', 1), timeoutMs: integer(e.timeoutMs ?? 60000, 'execution.timeoutMs', 1),
    maxModelRequests: e.maxModelRequests == null ? null : integer(e.maxModelRequests, 'execution.maxModelRequests'), maxToolCalls: e.maxToolCalls == null ? null : integer(e.maxToolCalls, 'execution.maxToolCalls'),
    budget: { cap: b.cap ?? null, currency: enumeration(b.currency ?? 'CNY', ['CNY', 'USD'], 'execution.budget.currency') },
    backgroundPolicy: enumeration(e.backgroundPolicy ?? 'defer', ['defer', 'independent-quota', 'shared-quota'], 'execution.backgroundPolicy'),
    ...(e.foregroundQuotaId !== undefined ? { foregroundQuotaId: id(e.foregroundQuotaId, 'execution.foregroundQuotaId') } : {}),
    ...(e.summaryQuotaId !== undefined ? { summaryQuotaId: id(e.summaryQuotaId, 'execution.summaryQuotaId') } : {}) };
  if (execution.backgroundPolicy === 'independent-quota') {
    if (!execution.foregroundQuotaId || !execution.summaryQuotaId || execution.foregroundQuotaId === execution.summaryQuotaId) fail('execution', 'independent background requires distinct explicit quota identifiers');
    for (const s of schemes) if (['llm', 'hybrid'].includes(s.context.snapshots.mode) || ['llm', 'hybrid'].includes(s.context.advice.mode)) {
      if (!s.summaryModelId || s.summaryModelId === s.modelId) fail('scheme.summaryModelId', 'independent background requires distinct summary model');
    }
  }
  return { schemaVersion: 1, id: raw.id, dataset: raw.dataset, ...(raw.labels ? { labels: raw.labels } : {}), schemes, models, execution };
}
function authorizationFor(snapshot) { return { game: !!snapshot.game, riverSeats: (snapshot.rivers ?? []).map(x => x.seat).sort(), selfHand: !!snapshot.selfHand, selfSeat: snapshot.selfSeat }; }
function cleanEvent(raw, roundId, sessionId) {
  keys(raw, ['id', 'position', 'kind', 'source', 'seat', 'tile', 'tiles', 'fromSeat', 'tsumogiri', 'riichi', 'called', 'important', 'roundId', 'sessionId'], 'event');
  integer(raw.position, 'event.position'); enumeration(raw.kind, EVENT_KINDS, 'event.kind'); id(raw.source, 'event.source');
  for (const key of ['seat', 'fromSeat']) if (raw[key] !== undefined) { integer(raw[key], `event.${key}`); if (raw[key] > 3) fail('event', 'invalid seat'); }
  if (raw.roundId !== undefined && raw.roundId !== roundId || raw.sessionId !== undefined && raw.sessionId !== sessionId) fail('event', 'scope mismatch');
  const kind = EVENT_ALIASES[raw.kind] ?? raw.kind;
  const out = { position: raw.position, kind, source: raw.source, roundId, sessionId };
  if (raw.id !== undefined) out.id = id(raw.id, 'event.id');
  for (const key of ['seat', 'fromSeat']) if (raw[key] !== undefined) out[key] = raw[key];
  const privateKinds = ['draw', 'deal', 'hand'], publicTileKinds = ['discard', 'riichi', 'riichi-accepted', 'meld', 'chi', 'pon', 'kan', 'ankan', 'kakan', 'daiminkan', 'dora', 'call', 'north'];
  if (raw.tile !== undefined) {
    if (![...privateKinds, ...publicTileKinds].includes(kind)) fail('event.tile', 'tile not supported for this event kind');
    if (Snapshot.tile(raw.tile) === '?' && !(raw.tile === '?' && privateKinds.includes(kind))) fail('event.tile', 'invalid tile'); out.tile = raw.tile;
  }
  if (raw.tiles !== undefined) {
    if (![...privateKinds, 'meld', 'chi', 'pon', 'kan', 'ankan', 'kakan', 'daiminkan', 'call'].includes(kind)) fail('event.tiles', 'tiles not supported for this event kind');
    if (!Array.isArray(raw.tiles) || raw.tiles.some(t => Snapshot.tile(t) === '?' && !(t === '?' && privateKinds.includes(kind)))) fail('event.tiles', 'invalid tiles'); out.tiles = raw.tiles.slice();
  }
  for (const key of ['tsumogiri', 'riichi', 'called', 'important']) if (raw[key] !== undefined) { if (typeof raw[key] !== 'boolean' && raw[key] !== null) fail('event', 'invalid flag'); out[key] = raw[key]; }
  return out;
}
function validateDataset(raw) {
  keys(raw, ['schemaVersion', 'id', 'sessionId', 'rounds', 'description', 'provenance'], 'dataset');
  if (raw.schemaVersion !== 1) fail('dataset', 'unsupported schemaVersion');
  const datasetId = id(raw.id, 'dataset.id'), sessionId = id(raw.sessionId ?? datasetId, 'dataset.sessionId');
  if (!Array.isArray(raw.rounds) || !raw.rounds.length) fail('dataset.rounds', 'expected nonempty array');
  const roundIds = new Set(), decisionIds = new Set(), followupIds = new Set();
  const rounds = raw.rounds.map(r => {
    keys(r, ['id', 'events', 'decisions', 'globalTasks', 'description'], 'round'); const roundId = id(r.id, 'round.id');
    if (roundIds.has(roundId)) fail('round.id', 'duplicate'); roundIds.add(roundId);
    if (!Array.isArray(r.events) || !Array.isArray(r.decisions) || !r.decisions.length) fail('round', 'expected events and decisions arrays');
    const events = r.events.map(e => cleanEvent(e, roundId, sessionId));
    for (let i = 1; i < events.length; i++) if (events[i].position < events[i - 1].position) fail('events', 'positions must be ordered');
    let lastPosition = -1;
    const decisions = r.decisions.map(d => {
      keys(d, ['id', 'position', 'type', 'snapshot', 'legalActions', 'followups', 'discardConstraints', 'decisionContext', 'roundId', 'sessionId', 'authorization'], 'decision');
      const decisionId = id(d.id, 'decision.id'); if (decisionIds.has(decisionId)) fail('decision.id', 'duplicate'); decisionIds.add(decisionId);
      const position = integer(d.position, 'decision.position'); if (position <= lastPosition) fail('decisions', 'positions must increase'); lastPosition = position;
      enumeration(d.type, ['ordinary-discard', 'post-call-discard'], 'decision.type');
      if (d.roundId !== undefined && d.roundId !== roundId || d.sessionId !== undefined && d.sessionId !== sessionId) fail('decision', 'scope mismatch');
      let snapshot; try { snapshot = Snapshot.cleanSnapshot(d.snapshot); } catch { fail('decision.snapshot', 'invalid snapshot'); }
      // Dataset positions and snapshot steps use the same frozen, round-local coordinate.
      // Adapters must normalize their source coordinates before constructing this contract.
      if (snapshot.lastStep !== position) fail('decision.snapshot', 'lastStep must equal decision position');
      const local = Analysis.analyze(snapshot).efficiency;
      if (!local || local.status !== 'available' || !local.canDiscard || snapshot.phase !== 'playing') fail('decision', 'snapshot cannot discard');
      const dc = d.decisionContext ?? {};
      keys(dc, ['phase', 'actor', 'triggerPosition', 'rulesSource'], 'decisionContext');
      const decisionContext = { phase: enumeration(dc.phase ?? (d.type === 'post-call-discard' ? 'post-call-discard' : 'draw'), d.type === 'post-call-discard' ? ['post-call-discard'] : ['draw', 'reach-discard'], 'decisionContext.phase'),
        actor: integer(dc.actor ?? snapshot.selfSeat, 'decisionContext.actor'), triggerPosition: integer(dc.triggerPosition ?? position, 'decisionContext.triggerPosition'), rulesSource: id(dc.rulesSource ?? 'dataset-declared', 'decisionContext.rulesSource') };
      if (decisionContext.actor !== snapshot.selfSeat || decisionContext.triggerPosition > position) fail('decisionContext', 'actor or cutoff mismatch');
      // The benchmark is not a rule inference engine: adapters must declare post-call restrictions.
      if (d.type === 'post-call-discard' && !d.discardConstraints) fail('decision', 'post-call legality unknown; explicit discardConstraints required');
      const constraints = d.discardConstraints ?? {}; keys(constraints, ['forbiddenTiles', 'forcedTile', 'rulesSource'], 'discardConstraints');
      if (constraints.rulesSource !== undefined) id(constraints.rulesSource, 'discardConstraints.rulesSource');
      const forbidden = constraints.forbiddenTiles ?? [];
      if (!Array.isArray(forbidden) || forbidden.some(t => Snapshot.tile(t) === '?')) fail('discardConstraints', 'invalid forbidden tiles');
      if (constraints.forcedTile !== undefined && Snapshot.tile(constraints.forcedTile) === '?') fail('discardConstraints', 'invalid forced tile');
      if (d.type === 'post-call-discard' && !snapshot.game?.players[snapshot.selfSeat]?.melds.length) fail('decision', 'post-call requires own meld');
      const canonicalTile = t => /^0[mps]$/.test(t) ? '5' + t[1] : t;
      const allowed = local.candidates.map(c => c.tile).filter(t => !forbidden.map(canonicalTile).includes(canonicalTile(t)) && (!constraints.forcedTile || constraints.forcedTile === t));
      if (!Array.isArray(d.legalActions) || !d.legalActions.length) fail('legalActions', 'expected nonempty array');
      const actionKeys = new Set();
      const legalActions = d.legalActions.map(a => { keys(a, ['action', 'tile'], 'legalAction'); if (a.action !== 'discard' || !allowed.includes(a.tile)) fail('legalAction', 'illegal discard'); if (actionKeys.has(a.tile)) fail('legalAction', 'duplicate'); actionKeys.add(a.tile); return { action: 'discard', tile: a.tile }; });
      if (allowed.length !== legalActions.length) fail('legalActions', 'must enumerate the complete constrained legal set');
      const authorization = authorizationFor(snapshot);
      if (d.authorization !== undefined && stableHash(d.authorization) !== stableHash(authorization)) fail('decision.authorization', 'scope mismatch');
      const followups = (d.followups ?? []).map(f => { keys(f, ['id', 'question'], 'followup'); id(f.id, 'followup.id'); if (followupIds.has(f.id)) fail('followup.id', 'duplicate'); followupIds.add(f.id); return { id: f.id, question: text(f.question, 'followup.question') }; });
      return { id: decisionId, position, type: d.type, roundId, sessionId, authorization, snapshot, legalActions, followups, decisionContext,
        ...(d.discardConstraints ? { discardConstraints: { ...constraints, forbiddenTiles: forbidden.slice(), rulesSource: constraints.rulesSource ?? decisionContext.rulesSource } } : {}) };
    });
    const globalTasks = (r.globalTasks ?? []).map(t => {
      keys(t, ['id', 'nodeId', 'question'], 'globalTask'); id(t.id, 'globalTask.id');
      if (followupIds.has(t.id)) fail('globalTask.id', 'duplicate'); followupIds.add(t.id);
      if (!decisions.some(d => d.id === t.nodeId)) fail('globalTask.nodeId', 'must refer to decision in same round');
      return { id: t.id, nodeId: t.nodeId, question: text(t.question, 'globalTask.question') };
    });
    return { id: roundId, sessionId, events, decisions, globalTasks };
  });
  return { schemaVersion: 1, id: datasetId, sessionId, rounds };
}
function readJSON(filename, kind) { try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { fail(kind, 'cannot read valid JSON'); } }
function loadSuite(filename) { return validateSuite(readJSON(filename, 'suite')); }
function loadDataset(filename) { return validateDataset(readJSON(filename, 'dataset')); }
function compileSuite(input, options = {}) {
  const suite = typeof input === 'string' ? loadSuite(input) : validateSuite(input);
  const baseDir = path.resolve(options.baseDir ?? (typeof input === 'string' ? path.dirname(input) : process.cwd()));
  const datasetPath = path.resolve(baseDir, suite.dataset);
  const dataset = options.dataset ? validateDataset(options.dataset) : loadDataset(datasetPath);
  return { ...suite, dataset, datasetPath, ...(suite.labels ? { labelsPath: path.resolve(baseDir, suite.labels) } : {}), baseDir };
}
module.exports = { validateSuite, validateDataset, loadSuite, loadDataset, compileSuite, stableHash, canonicalStringify, validateContext, authorizationFor, cleanEvent };
