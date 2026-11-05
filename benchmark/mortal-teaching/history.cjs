'use strict';
// Read only the original X-F first-pass run roots. The repeat campaign is never
// searched and cannot supply replacement answers for original failures.
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { sha256 } = require('./prompts.cjs');
const { stripAttribution } = require('./runner.cjs');
const ROOTS = [
  'realtime-quality-20261031/phase2-planning/holdout45-preparation-20261102/runs',
  'realtime-quality-20261031/same-match-remaining-20261102/preparation/runs'
];
function prepareHistory(evidenceRoot, data) {
  const rows = [], sources = [];
  for (const roundId of [...new Set(data.nodes.map(n => n.roundId))]) {
    const candidates = ROOTS.map(root => path.join(evidenceRoot, root, 'x-f-' + roundId, 'checkpoint.json')).filter(f => fs.existsSync(f));
    if (candidates.length !== 1) throw new Error('Expected one original X-F campaign for ' + roundId);
    const filename = candidates[0], bytes = fs.readFileSync(filename), run = JSON.parse(bytes);
    const requestFile = path.join(path.dirname(filename), 'requests.private.jsonl'), requestBytes = fs.readFileSync(requestFile);
    const wires = requestBytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
    const reviewFile = path.join(path.dirname(filename), 'review/queue.jsonl'), reviews = new Map();
    for (const event of readEvents(reviewFile)) if (event.kind === 'job') reviews.set(event.payload.resultId, event.payload);
    sources.push({ file: path.relative(evidenceRoot, filename).replace(/\\/g, '/'), sha256: sha256(bytes),
      reviewFile: path.relative(evidenceRoot, reviewFile).replace(/\\/g, '/'), reviewSha256: sha256(fs.readFileSync(reviewFile)),
      requestFile: path.relative(evidenceRoot, requestFile).replace(/\\/g, '/'), requestSha256: sha256(requestBytes) });
    for (const node of data.nodes.filter(n => n.roundId === roundId)) {
      const matches = run.results.filter(r => r.schemeId === 'X-F' && r.decisionId === node.id && r.repeat === 0 && r.channel === 'main');
      if (matches.length !== 1) throw new Error('Original X-F first answer missing or ambiguous');
      const result = matches[0], request = run.requests[result.id];
      if (stableHash(request.frozenInput.node.snapshot) !== stableHash(node.message.snapshot)) throw new Error('Historical frozen snapshot differs');
      const answer = result.status === 'success' ? request.response?.text : null;
      if (result.status === 'success' && !answer) throw new Error('Successful history has no original raw answer');
      const observedTools = new Map();
      for (const wire of wires.filter(w => w.requestId === result.id)) {
        const names = new Map(wire.body.messages.flatMap(m => (m.tool_calls || []).map(c => [c.id, c.function?.name])));
        for (const m of wire.body.messages.filter(m => m.role === 'tool')) {
          const tool = { toolName: names.get(m.tool_call_id) || 'unknown', content: stripAttribution(m.content) };
          observedTools.set(stableHash(tool), tool);
        }
      }
      const facts = { snapshot: node.message.snapshot, legalActions: node.legalActions, decisionContext: node.decisionContext,
        discardConstraints: node.discardConstraints,
        contextMessages: request.frozenInput.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: stripAttribution(m.content) })),
        toolResults: [...observedTools.values()],
        question: '' };
      rows.push({ nodeId: node.id, roundId, resultId: result.id, status: result.status, answer, facts,
        sourceIndex: sources.length - 1, originalReview: reviews.get(result.id)?.review || null });
    }
  }
  if (rows.length !== 84 || rows.filter(r => r.answer).length !== 83) throw new Error('Expected original 84 X-F opportunities / 83 delivered answers');
  const history = { format: 'x-f-original-first-pass-v1', scheme: 'X-F', selection: 'original repeat=0 main channel; no replacement from reruns', datasetHash: data.datasetHash, sources, rows };
  return { ...history, historyHash: stableHash(history) };
}
module.exports = { prepareHistory, ROOTS };
