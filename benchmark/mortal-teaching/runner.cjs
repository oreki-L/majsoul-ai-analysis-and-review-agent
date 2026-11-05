'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { journal, acquireLock } = require('../durable.cjs');
const { redact, createCredentialResolver } = require('../accounting.cjs');
const { createHarness } = require('./harness.cjs');
const { createQueue } = require('./review.cjs');
const { checkDataset } = require('./dataset.cjs');
const { openBudget } = require('./budget.cjs');
const { loadPrompts } = require('./prompts.cjs');
const Engine = require('../../extension/engine-agent.js');
const Explanation = require('../../extension/contracts/engine-explanation.js');
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeNew(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function freeze(file, value) {
  if (fs.existsSync(file)) { if (stableHash(read(file)) !== stableHash(value)) throw new Error('Frozen file changed: ' + path.basename(file)); }
  else writeNew(file, value);
  return value;
}
function factsFor(node, engine, harness, question = '') {
  // Reconstruct only authorized facts, engine actions, history and observed local
  // tool results. Prompt/variant/model identity are deliberately absent.
  const normalized = engine?.action ? Explanation.forModel(engine) : {};
  return JSON.parse(JSON.stringify({ snapshot: node.message.snapshot, legalActions: node.legalActions, decisionContext: node.decisionContext,
    discardConstraints: node.discardConstraints, engine: { action: normalized.action, followUp: normalized.followUp, phase: normalized.phase, tileEncoding: 'snapshot-v1' },
    events: node.message.context.events, question,
    contextMessages: harness.traces.flatMap(t => t.messages).map(m => ({ role: m.role, content: stripAttribution(m.content) })),
    toolResults: harness.traces.flatMap(t => t.toolResults || []).map(m => ({ toolName: m.toolName, content: stripAttribution(m.content), isError: m.isError === true })) }));
}
function stripAttribution(content) {
  if (Array.isArray(content)) return content.map(stripAttribution);
  if (content && typeof content === 'object') return Object.fromEntries(Object.entries(content)
    .filter(([k]) => !['identity', 'engineIdentity', 'model', 'runtime', 'checkpoint', 'sourceCommit', 'modelRevision', 'workflow', 'provider'].includes(k))
    .map(([k, v]) => [k, stripAttribution(v)]));
  if (typeof content !== 'string') return content;
  const start = content.indexOf('{');
  if (start < 0) return content;
  try { return content.slice(0, start) + JSON.stringify(stripAttribution(JSON.parse(content.slice(start)))); }
  catch { return content; }
}
function delivery(outcome) { return outcome?.ok === true && outcome.explanation?.status === 'completed'; }
function schedule(data, variants, stage, winner) {
  const nodes = data.nodes.filter(n => n.compatible && n.split === (stage === 'development' ? 'development' : 'validation'));
  const selected = stage === 'development' ? variants : [variants[0], ...variants.filter(v => v.id === winner && v.id !== variants[0].id)];
  if (!selected.length || stage !== 'development' && !variants.some(v => v.id === winner)) throw new Error('Unknown frozen winner');
  return nodes.flatMap((node, index) => selected.map((_, i) => {
    const variant = selected[(i + index) % selected.length];
    return { id: stage + ':' + node.id + ':' + variant.id, nodeId: node.id, variant: variant.id, roundId: node.roundId };
  }));
}
async function cacheEngines({ output, engineConfig, fetchImpl = fetch }) {
  const unlock = acquireLock(path.join(output, 'experiment.lock'), true);
  try {
  const data = checkDataset(read(path.join(output, 'dataset.json'))), log = journal(path.join(output, 'engine-cache.jsonl'));
  const binding = { datasetHash: data.datasetHash, profile: engineConfig.engineProfile, endpoint: engineConfig.endpoint, model: engineConfig.model };
  freeze(path.join(output, 'engine-cache-contract.json'), binding);
  if (engineConfig.engineProfile !== 'yuchen-582500') throw new Error('Experiment engine must be Yuchen 582500');
  for (const node of data.nodes.filter(n => n.compatible && n.split === 'development')) {
    if (log.events.some(e => e.kind === 'dispatch' && e.payload.nodeId === node.id)) {
      if (!log.events.some(e => e.kind === 'result' && e.payload.nodeId === node.id)) throw new Error('Unfinished engine cache dispatch requires audit; no automatic replay');
      continue;
    }
    log.write('dispatch', { nodeId: node.id, inputHash: node.inputHash });
    try {
      const result = await Engine.run({ snapshot: node.message.snapshot, request: node.message.engineRequest, expectedProfile: 'yuchen-582500', timeoutMs: 25000,
        infer: async (request, { signal }) => {
          const response = await fetchImpl(engineConfig.endpoint, { method: 'POST', signal, redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + engineConfig.apiKey }, body: JSON.stringify(request) });
          if (!response.ok) throw new Error('Engine HTTP ' + response.status);
          return response.json();
        } });
      log.write('result', { nodeId: node.id, inputHash: node.inputHash, result });
    } catch { log.write('failure', { nodeId: node.id, error: 'engine-cache-failed; do not silently repeat this batch' }); throw new Error('Engine cache failed; inspect retained evidence'); }
  }
  return log.events.filter(e => e.kind === 'result').length;
  } finally { unlock(); }
}
async function runStage({ output, stage, winner, engineConfig, fetchImpl = fetch, mock = false }) {
  const data = checkDataset(read(path.join(output, 'dataset.json'))), { variants, manifestHash } = loadPrompts();
  const authorization = read(path.join(output, 'authorization.local.json')), pricing = read(path.join(output, 'pricing.json'));
  if (!['development', 'validation'].includes(stage)) throw new Error('Unknown experiment stage');
  const directory = path.join(output, mock ? 'mock' : 'live', stage);
  fs.mkdirSync(directory, { recursive: true });
  const unlock = acquireLock(path.join(output, 'experiment.lock'), true);
  let budget;
  try {
    const batchId = fs.existsSync(path.join(output, 'contract.json')) ? read(path.join(output, 'contract.json')).batchId : 'fixture';
    const jobs = schedule(data, variants, stage, winner).map(j => ({ ...j, id: batchId + ':' + j.id }));
    freeze(path.join(directory, 'schedule.json'), { datasetHash: data.datasetHash, manifestHash, stage, winner: winner || null, jobs });
    if (!mock && stage === 'validation') {
      const selection = read(path.join(output, 'selection.json'));
      if (selection.winner !== winner || selection.datasetHash !== data.datasetHash || selection.manifestHash !== manifestHash || !selection.evidence) throw new Error('Freeze reviewed development selection before validation');
    }
    const log = journal(path.join(directory, 'results.jsonl')), queue = createQueue(path.join(output, mock ? 'mock-review' : 'review'), data.datasetHash);
    const history = new Map(), cache = new Map();
    if (stage === 'development' && !mock) {
      for (const e of journal(path.join(output, 'engine-cache.jsonl')).events) if (e.kind === 'result') cache.set(e.payload.nodeId, e.payload);
      for (const job of jobs) if (!cache.has(job.nodeId)) throw new Error('Missing validated cached development engine action');
    }
    const llmKey = mock ? 'mock-secret' : await createCredentialResolver({ credentialsFile: authorization.credentialsFile, authorization })(authorization.allowedReferences[0]);
    if (!mock && engineConfig.engineProfile !== 'yuchen-582500') throw new Error('Experiment engine must be Yuchen 582500');
    if (!mock) budget = openBudget({ directory: authorization.budgetDirectory || path.join(output, 'billing'), authorization, pricing, fetchImpl, secrets: [llmKey, engineConfig.apiKey] });
    for (const job of jobs) {
      // A started job is never dispatched again. In-flight product history is
      // uncertain after a crash, so require audit/new batch instead of skipping.
      const old = log.events.find(e => e.kind === 'start' && e.payload.id === job.id);
      if (old) {
        if (!log.events.some(e => e.kind === 'result' && e.payload.id === job.id)) throw new Error('Unfinished logical job requires audit; no automatic replay');
        const result = log.events.find(e => e.kind === 'result' && e.payload.id === job.id).payload;
        if (result.reviewSource) queue.add(result.reviewSource);
        continue;
      }
      if (budget && (budget.snapshot().reservationCount || budget.snapshot().unknownLiability)) break;
      if (budget && budget.snapshot().budgetCommitted + (pricing.inputBound * Math.max(pricing.rates.cachedInput, pricing.rates.uncachedInput) + pricing.maxOutputTokens * pricing.rates.output) / 1e6 > 50) break;
      const node = data.nodes.find(n => n.id === job.nodeId), variant = variants.find(v => v.id === job.variant);
      log.write('start', { ...job, mock, inputHash: node.inputHash, promptHash: variant.sha256 });
      let ordinal = 0, piStarted, actionStageAt;
      const preparationStarted = performance.now(), audit = [];
      const persist = (kind, value) => {
        if (kind === 'pi-input') piStarted = performance.now();
        if (kind === 'action-stage') actionStageAt = performance.now();
        audit.push({ kind, value: structuredClone(value) });
        log.write('trace', { jobId: job.id, kind, value: redact(value, [llmKey, engineConfig.apiKey]) });
      };
      const branchKey = variant.id + ':' + node.roundId;
      let harness = history.get(branchKey);
      // A callback closes over currentJob, so an existing product branch gets
      // a per-job transport/persist slot without recreating its history.
      let slot = harness?._slot;
      const transport = async (url, options) => {
        if (url === engineConfig.endpoint) {
          if (stage === 'development' && !mock) {
            const cached = cache.get(node.id);
            if (cached.inputHash !== node.inputHash) throw new Error('Cached engine input changed');
            const { engine } = cached.result;
            return Response.json({ action: engine.action, ...(engine.followUp ? { followUp: engine.followUp } : {}), identity: engine.identity });
          }
          return fetchImpl(url, options);
        }
        const body = JSON.parse(options.body);
        // Benchmark-only fixed sampling, explicitly recorded in the wire trace.
        body.temperature = 0;
        const wire = { ...options, body: JSON.stringify(body) };
        ordinal++;
        if (mock) return fetchImpl(url, wire);
        return budget.request(url, wire, { jobId: job.id, role: ordinal === 1 ? 'initial' : 'tool-continuation', ordinal });
      };
      if (!harness || stage === 'development') {
        slot = { transport, persist };
        harness = createHarness({ variant, engineConfig, llmConfig: { endpoint: pricing.endpoint, model: pricing.model, apiKey: llmKey },
          directory: stage === 'validation' ? path.join(directory, 'branches', branchKey.replace(/:/g, '_')) : null,
          fetchModel: (...args) => slot.transport(...args), persist: (...args) => slot.persist(...args) });
        harness._slot = slot;
        if (stage === 'validation') history.set(branchKey, harness);
      } else { slot.transport = transport; slot.persist = persist; }
      const traceStart = harness.traces.length, stateBefore = harness.publicState();
      const started = performance.now();
      const outcome = await harness.worker.analyze(structuredClone(node.message), 'benchmark');
      const elapsedMs = performance.now() - started;
      const complete = delivery(outcome) && elapsedMs <= 25000;
      const record = { ...job, mock, inputHash: node.inputHash, promptHash: variant.sha256, delivered: complete,
        elapsedMs, preparationMs: started - preparationStarted, explanationMs: piStarted ? performance.now() - piStarted : null,
        actionStageMs: actionStageAt ? actionStageAt - started : null, physicalLlmAttempts: ordinal,
        outcome: redact(outcome, [llmKey, engineConfig.apiKey]), auditHash: stableHash(JSON.parse(JSON.stringify(audit))),
        stateBefore, stateAfter: harness.publicState(), firstPiInput: harness.traces[traceStart] ? { messages: harness.traces[traceStart].messages, promptHash: harness.traces[traceStart].promptHash } : null };
      if (complete) record.reviewSource = { resultId: (mock ? 'mock:' : '') + job.id,
        answer: harness.traces.at(-1).text, facts: factsFor(node, outcome.engine, { traces: harness.traces.slice(traceStart) }) };
      log.write('result', record);
      if (complete) queue.add(record.reviewSource);
    }
    queue.exportPackets();
    return { planned: jobs.length, attempted: log.events.filter(e => e.kind === 'start').length,
      delivered: log.events.filter(e => e.kind === 'result' && e.payload.delivered).length, billing: budget?.snapshot() || null, mock };
  } finally { budget?.close(); unlock(); }
}
module.exports = { runStage, cacheEngines, schedule, factsFor, stripAttribution, delivery, read, writeNew, freeze };
