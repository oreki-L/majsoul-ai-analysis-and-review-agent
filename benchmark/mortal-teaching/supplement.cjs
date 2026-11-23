'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { journal, readEvents, acquireLock } = require('../durable.cjs');
const { createCredentialResolver, redact } = require('../accounting.cjs');
const { createHarness } = require('./harness.cjs');
const { createQueue } = require('./review.cjs');
const { openBudget } = require('./budget.cjs');
const { loadPrompts } = require('./prompts.cjs');
const { read, freeze, factsFor, delivery } = require('./runner.cjs');
const QUESTIONS = ['说明这个动作最关键的可见依据，以及哪些判断仍不确定。', '为什么不选择另一个合法动作？如果没有有意义的备选，请直接说明。'];
const REPEAT_SELECTION = [
  ['east2-h0', 0, '庄家首摸：开局末张拆分', true],
  ['east2-h0', 68, '对手已立直、三副露与赤牌摸入'],
  ['east4-h0', 24, '首次鸣牌后的弃牌', true],
  ['east4-h0', 100, '较晚牌山、两副露与赤牌摸入'],
  ['south3-h0', 6, '早段闭手'],
  ['south3-h0', 58, '第二副露后的弃牌'],
  ['south4-h0', 48, '南四局鸣后、手持赤牌'],
  ['south4-h0', 64, '南四局对手已立直下的普通决策', true],
  ['south1-h0', 2, '非庄家早段闭手'],
  ['south1-h0', 68, '较晚首次鸣牌后的弃牌'],
  ['south1-h1', 10, '续本早段闭手'],
  ['south1-h1', 38, '续本第二副露后的弃牌'],
  ['south2-h0', 0, '庄家首摸且手持赤牌'],
  ['south2-h0', 62, '已有副露的中后段普通决策'],
  ['south2-h1', 0, '续本庄家字牌首摸'],
  ['south2-h1', 46, '续本鸣后且手持赤牌'],
  ['south4-h1', 4, '南四续本早段闭手、手持赤牌'],
  ['south4-h1', 52, '南四续本中段闭手、手持赤牌']
].map(([roundId, position, reason, followup = false]) => ({ roundId, position, reason, followup }));
const REPEAT_ROUNDS = [...new Set(REPEAT_SELECTION.map(s => s.roundId))];
function supplementPlan(data) {
  // Coordinates are selected from visible frozen states, never answers or scores.
  // Missing, incompatible or ambiguous anchors fail preparation; do not replace them.
  const samples = REPEAT_SELECTION.map(spec => {
    const selected = data.nodes.filter(n => n.roundId === spec.roundId && n.position === spec.position);
    if (selected.length !== 1 || !selected[0].compatible) throw new Error('Fixed representative decision missing, incompatible or ambiguous: ' + spec.roundId + ':' + spec.position);
    const node = selected[0], snapshot = node.message.snapshot, players = snapshot.game.players;
    return { ...spec, nodeId: node.id, type: node.type, visibleFacts: {
      selfSeat: snapshot.selfSeat, selfDrawnTile: snapshot.selfDrawnTile,
      remaining: snapshot.game.remaining,
      selfMeldCount: players.find(p => p.seat === snapshot.selfSeat).melds.length,
      opponentRiichiSeats: players.filter(p => p.seat !== snapshot.selfSeat && p.riichi).map(p => p.seat).sort((a, b) => a - b),
      redTilesInHand: snapshot.selfHand.filter(tile => /^0[mps]$/.test(tile))
    } };
  });
  if (new Set(samples.map(s => s.nodeId)).size !== samples.length) throw new Error('Representative decisions must have unique IDs');
  return { selection: 'fixed-nine-round-representative-v2', roundIds: REPEAT_ROUNDS, samples,
    repeatNodes: samples.map(s => s.nodeId), followupNodes: samples.filter(s => s.followup).map(s => s.nodeId), questions: QUESTIONS };
}
async function runSupplement({ output, winner, engineConfig, fetchImpl = fetch, mock = false, promptDirectory, regressionStage = 'validation' }) {
  const data = read(path.join(output, 'dataset.json')), plan = read(path.join(output, 'supplement-plan.json'));
  const variant = loadPrompts(promptDirectory).variants.find(v => v.id === winner);
  if (!variant) throw new Error('Unknown selected variant');
  const authorization = read(path.join(output, 'authorization.local.json')), pricing = read(path.join(output, 'pricing.json'));
  const unlock = acquireLock(path.join(output, 'experiment.lock'), true); let budget;
  try {
    if (!mock && read(path.join(output, 'selection.json')).winner !== winner) throw new Error('Supplement must use selected variant');
    const directory = path.join(output, mock ? 'mock' : 'live', 'supplement');
    const records = [...new Set(['development', regressionStage])].flatMap(stage => require('./reuse.cjs').mergedRows(output, path.join(output, mock ? 'mock' : 'live', stage), stage))
      .filter(row => row.variant === winner);
    const anchors = new Map(records.map(r => [r.nodeId, r]));
    const batchId = fs.existsSync(path.join(output, 'contract.json')) ? read(path.join(output, 'contract.json')).batchId : 'fixture';
    const jobs = [...plan.repeatNodes.map(nodeId => ({ id: batchId + ':repeat:' + nodeId + ':' + winner, kind: 'repeat', nodeId })),
      ...plan.followupNodes.flatMap(nodeId => plan.questions.map((question, index) => ({ id: batchId + ':followup:' + nodeId + ':' + winner + ':' + index, kind: 'followup', nodeId, question, index })))];
    freeze(path.join(directory, 'schedule.json'), { winner, datasetHash: data.datasetHash, jobs });
    const log = journal(path.join(directory, 'results.jsonl')), queue = createQueue(path.join(output, mock ? 'mock-review' : 'review'), data.datasetHash);
    const reuse = require('./reuse.cjs').loadReuse(output), reusedRows = reuse?.rows('supplement', winner) || [];
    const reusedById = new Map(reusedRows.map(r => [r.id, r]));
    reuse?.importReviews(queue, 'supplement', winner, mock);
    if (jobs.length && reusedRows.length === jobs.length) {
      queue.exportPackets();
      return { planned: jobs.length, reused: jobs.length, newlyAttempted: 0, attempted: jobs.length, delivered: reusedRows.filter(r => r.delivered).length, mock, billing: null };
    }
    const key = mock ? 'mock-secret' : await createCredentialResolver({ credentialsFile: authorization.credentialsFile, authorization })(authorization.allowedReferences[0]);
    if (!mock) budget = openBudget({ directory: authorization.budgetDirectory || path.join(output, 'billing'), authorization, pricing, fetchImpl, secrets: [key, engineConfig.apiKey] });
    const branches = new Map();
    for (const job of jobs) {
      if (reusedById.has(job.id)) {
        if (log.events.some(e => e.kind === 'start' && e.payload.id === job.id)) throw new Error('Reused supplement was dispatched again');
        continue;
      }
      const old = log.events.find(e => e.kind === 'start' && e.payload.id === job.id);
      if (old) {
        const finished = log.events.find(e => e.kind === 'result' && e.payload.id === job.id)?.payload;
        if (!finished) throw new Error('Unfinished supplemental job; audit required');
        if (finished.reviewSource) queue.add(finished.reviewSource);
        if (job.kind === 'followup') branches.set(job.nodeId, finished.stateAfter);
        continue;
      }
      if (budget && (budget.snapshot().reservationCount || budget.snapshot().unknownLiability || budget.snapshot().budgetCommitted + pricing.fullContextReservationCny > 50)) break;
      const source = anchors.get(job.nodeId), node = data.nodes.find(n => n.id === job.nodeId);
      if (!source?.delivered || !source.firstPiInput || !source.stateAfter) {
        log.write('start', job); log.write('result', { ...job, delivered: false, reason: 'original anchor not delivered; no replacement selected' }); continue;
      }
      log.write('start', job);
      let ordinal = 0;
      const traces = [], started = performance.now();
      const state = job.kind === 'repeat' ? source.stateBefore : branches.get(job.nodeId) || source.stateAfter;
      const harness = createHarness({ variant, engineConfig, initialState: state,
        llmConfig: { endpoint: pricing.endpoint, model: pricing.model, apiKey: key },
        persist: (kind, value) => {
          if (kind === 'pi-input' && job.kind === 'repeat' && (stableHash(value.messages) !== stableHash(source.firstPiInput.messages) || value.promptHash !== source.firstPiInput.promptHash)) throw new Error('Repeat input differs from original first request');
          traces.push({ kind, value }); log.write('trace', { jobId: job.id, kind, value: redact(value, [key, engineConfig.apiKey]) });
        },
        fetchModel: async (url, options) => {
          if (url === engineConfig.endpoint) {
            if (job.kind === 'followup') throw new Error('Follow-up must not rerun engine');
            const e = source.outcome.engine;
            return Response.json({ action: e.action, ...(e.followUp ? { followUp: e.followUp } : {}), identity: e.identity });
          }
          ordinal++; const body = JSON.parse(options.body); body.temperature = 0;
          const wire = { ...options, body: JSON.stringify(body) };
          return mock ? fetchImpl(url, wire) : budget.request(url, wire, { jobId: job.id, role: job.kind === 'followup' ? 'follow-up' : ordinal === 1 ? 'repeat' : 'tool-continuation', ordinal });
        } });
      let message = structuredClone(node.message);
      if (job.kind === 'followup') {
        const id = source.outcome.discussionRecord.id, token = job.id;
        await harness.discussions.ask(id, job.question, token);
        message = { provider: 'chat', discussionId: id, discussionToken: token, question: job.question, selection: { hand: true, game: true, rivers: 'all' } };
      }
      const outcome = await harness.worker.analyze(message, 'benchmark');
      const elapsedMs = performance.now() - started, delivered = delivery(outcome) && elapsedMs <= 25000;
      const result = { ...job, variant: winner, mock, delivered, elapsedMs, physicalLlmAttempts: ordinal,
        outcome: redact(outcome, [key, engineConfig.apiKey]), stateAfter: harness.publicState() };
      if (job.kind === 'followup') branches.set(job.nodeId, result.stateAfter);
      if (delivered) result.reviewSource = { resultId: (mock ? 'mock:' : '') + job.id, answer: harness.traces.at(-1).text,
        facts: factsFor(node, outcome.engine, harness, job.question || ''), questionRequiresComparison: job.kind === 'followup' && job.index === 1 };
      log.write('result', result);
      if (result.reviewSource) queue.add(result.reviewSource);
    }
    queue.exportPackets();
    return { planned: jobs.length, reused: reusedRows.length, newlyAttempted: log.events.filter(e => e.kind === 'start').length, attempted: reusedRows.length + log.events.filter(e => e.kind === 'start').length, delivered: reusedRows.filter(r => r.delivered).length + log.events.filter(e => e.kind === 'result' && e.payload.delivered).length, mock, billing: budget?.snapshot() || null };
  } finally { budget?.close(); unlock(); }
}
module.exports = { supplementPlan, runSupplement, QUESTIONS, REPEAT_ROUNDS, REPEAT_SELECTION };
