'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableHash } = require('./core.cjs');
const { journal } = require('./durable.cjs');
const DIMENSIONS = ['factual_accuracy', 'explanation_grounding', 'legal_comparison', 'context_isolation', 'calibration', 'usability'];
const RULES = Object.freeze({ version: 1, requiredModel: 'gpt-6-sol', reasoningEffort: 'medium', dimensions: DIMENSIONS, minimum: 0, maximum: 4, semantics: { factual_accuracy: 'Claims match cited frozen facts; missing evidence is not evidence of safety.', legal_comparison: 'Action respects exact legal tiles and constraints and compares at least one substantive legal alternative, stating the evidence and conditions that favor each; naming a tile without a tradeoff is insufficient.', explanation_grounding: 'Reasons support the stated action without contradictions.', usability: 'Understandable and concise explanation.', context_isolation: 'Uses only this authorized frozen context and addresses this decision or question.', calibration: 'Distinguishes known facts, model opinion and uncertainty.' }, citations: 'At least one exact quotation with target answer or facts; quotes must occur literally in that target. Severe errors require citations. Do not use reference preferences or other answers.' });
function validateReviewRules(rules) {
  if (!rules || !Number.isSafeInteger(rules.version) || rules.version < 1 || typeof rules.requiredModel !== 'string' || !rules.requiredModel || typeof rules.reasoningEffort !== 'string' || !Array.isArray(rules.dimensions) || rules.dimensions.length !== DIMENSIONS.length || rules.dimensions.some((d, i) => d !== DIMENSIONS[i]) || rules.minimum !== 0 || rules.maximum !== 4 || DIMENSIONS.some(d => typeof rules.semantics?.[d] !== 'string' || !rules.semantics[d]) || typeof rules.citations !== 'string') throw new Error('Invalid frozen six-dimension review rules');
  return rules;
}
function createReviewQueue(output, contractHash, rules = RULES) {
  validateReviewRules(rules);
  const directory = path.join(output, 'review'), log = journal(path.join(directory, 'queue.jsonl')), jobs = new Map();
  for (const event of log.events) if (event.kind === 'job') jobs.set(event.payload.resultId, event.payload);
  function save(job) { log.write('job', job); jobs.set(job.resultId, structuredClone(job)); }
  function materialize(job) { fs.mkdirSync(path.join(directory, 'blind'), { recursive: true }); const target = path.join(directory, 'blind', job.blindId + '.json'); if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify({ ...job.packet, sourceHash: job.sourceHash, rulesHash: job.rulesHash }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  function sync(run) {
    for (const job of jobs.values()) materialize(job);
    for (const result of run.results ?? []) {
      if (result.status !== 'success' || result.statisticalRole === 'supplemental-never-replaces-original' || result.sourceFixture || result.canonicalResultId || jobs.has(result.id)) continue;
      const request = run.requests[result.id], input = request?.frozenInput;
      if (!input) continue;
      const blindId = crypto.randomUUID(), answer = request.response?.text ?? result.text ?? JSON.stringify(result.answer);
      const packet = { schemaVersion: 1, blindId, rules, answer, facts: { snapshot: input.node.snapshot, legalActions: input.node.legalActions, asOf: input.node.position, decisionContext: input.node.decisionContext, messages: input.messages.map(m => ({ role: m.role, content: m.content })) } };
      // Scheme metadata is absent from builders' normal messages; reject explicit metadata
      // rather than trying to guess/redact a free-text scheme name inside a factual tile.
      const text = JSON.stringify(packet);
      if (/"(?:schemeId|credentialAlias|keyAlias|rates|preferred|candidateWeights)"\s*:/.test(text)) throw new Error('Blind packet contains forbidden attribution');
      const sourceHash = stableHash(packet), job = { resultId: result.id, blindId, sourceHash, rulesHash: stableHash(rules), contractHash, state: 'pending', attempts: 0, packet };
      save(job);
      materialize(job);
    }
  }
  function validate(job, result) {
    if (result.blindId !== job.blindId || result.sourceHash !== job.sourceHash || result.rulesHash !== job.rulesHash || result.model !== job.packet.rules.requiredModel || result.reasoningEffort !== job.packet.rules.reasoningEffort) throw new Error('Review identity, source hash, rubric or model mismatch');
    if (!result.scores || Object.keys(result.scores).length !== DIMENSIONS.length || DIMENSIONS.some(d => !Number.isFinite(result.scores[d]) || result.scores[d] < 0 || result.scores[d] > 4)) throw new Error('Review must score all six dimensions within 0..4');
    if (!Array.isArray(result.citations) || !result.citations.length || result.citations.some(c => !['answer', 'facts'].includes(c.target) || typeof c.quote !== 'string' || !c.quote.length || !(c.target === 'answer' ? job.packet.answer : JSON.stringify(job.packet.facts)).includes(c.quote))) throw new Error('Review citation is missing or not in this blind source');
    if (!Array.isArray(result.severeErrors) || result.severeErrors.some(e => typeof e !== 'string' || !e.trim())) throw new Error('Review severeErrors must be explicit');
    return { ...result, mean: DIMENSIONS.reduce((n, d) => n + result.scores[d], 0) / DIMENSIONS.length, gate: result.severeErrors.length === 0 };
  }
  function importResults(results) {
    const pending = [], seen = new Set();
    // Validate the full batch before appending any score.
    for (const result of results) {
      const job = [...jobs.values()].find(j => j.blindId === result.blindId);
      if (!job || seen.has(result.blindId)) throw new Error('Unknown or duplicate blind review');
      seen.add(result.blindId);
      const review = validate(job, result);
      if (job.state === 'complete') { if (stableHash(job.review) !== stableHash(review)) throw new Error('A completed review cannot be overwritten'); continue; }
      pending.push({ ...job, review, state: 'complete' });
    }
    pending.forEach(save);
  }
  async function drain(execute, { concurrency = 2, retries = 1 } = {}) {
    if (typeof execute !== 'function') return;
    const pending = [...jobs.values()].filter(j => j.state !== 'complete' && j.attempts <= retries);
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      for (;;) {
        const job = pending[cursor++]; if (!job) return;
        while (job.attempts <= retries && job.state !== 'complete') {
          job.state = 'running'; job.attempts++; save(job);
          try { const result = await execute(structuredClone({ ...job.packet, sourceHash: job.sourceHash, rulesHash: job.rulesHash })); job.review = validate(job, result); job.state = 'complete'; save(job); }
          catch { job.state = 'pending'; job.reason = 'review-unavailable-or-invalid'; save(job); }
        }
      }
    }));
  }
  return { sync, importResults, drain, snapshot: () => [...jobs.values()].map(({ packet, ...job }) => job), directory };
}
module.exports = { createReviewQueue, validateReviewRules, RULES, DIMENSIONS };
