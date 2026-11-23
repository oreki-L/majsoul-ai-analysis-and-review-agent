'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { stableHash } = require('../core.cjs');
const { journal, acquireLock } = require('../durable.cjs');
const { createCredentialResolver, redact } = require('../accounting.cjs');
const { read } = require('../mortal-teaching/runner.cjs');
const { createQueue } = require('../mortal-teaching/review.cjs');
const { openBudget } = require('../mortal-teaching/budget.cjs');
const { plan, replay } = require('./regression.cjs');
const RoundBudget = require('./round-budget.cjs');

function verifyReady(source, output, makePlan = plan) {
  const frozen = read(path.join(output, 'manifest.json'));
  const prepared = makePlan(source, output, frozen.budget?.cap), hash = stableHash(prepared.manifest), report = read(path.join(output, 'offline-report.json'));
  assert.equal(stableHash(frozen), hash);
  const ledger = read(path.join(prepared.manifest.budget.directory, 'budget.json'));
  assert.equal(ledger.cap, frozen.budget.cap);
  assert.equal(ledger.currency, frozen.budget.currency);
  assert.ok(report.manifestHash === hash && report.passed && report.realApiRequests === 0 &&
    report.tested === prepared.cases.length && report.delivered === prepared.cases.length);
  return { ...prepared, hash, ledger };
}

async function runLive(source, output, maxPoints, makePlan = plan) {
  const { cases, binding, hash, manifest } = verifyReady(source, output, makePlan);
  assert.ok(Number.isSafeInteger(maxPoints) && maxPoints >= 1 && maxPoints <= cases.length, 'Choose an explicit maximum number of points');
  const budgetOptions = RoundBudget.bindings(source, manifest), { authorization, pricing } = budgetOptions;
  const directory = path.join(output, 'live');
  fs.mkdirSync(directory, { recursive: true });
  const unlock = acquireLock(path.join(directory, 'run.lock'));
  let budget;
  try {
    const log = journal(path.join(directory, 'results.jsonl'));
    const attempted = new Set(log.events.filter(e => e.kind === 'start').map(e => e.payload.nodeId));
    const results = log.events.filter(e => e.kind === 'result').map(e => e.payload);
    assert.deepEqual(attempted, new Set(results.map(r => r.nodeId)), 'An interrupted attempt requires reconciliation');
    const queue = createQueue(path.join(directory, 'review'), hash);
    for (const r of results.filter(r => r.delivered)) queue.add({ resultId: r.id, ...r.reviewSource });
    queue.exportPackets();
    const planned = cases.filter(c => !attempted.has(c.node.id)).slice(0, maxPoints);
    if (!planned.length) return { attempted: 0, delivered: 0, stop: 'complete' };
    budget = openBudget(budgetOptions);
    const admissible = () => {
      const b = budget.snapshot();
      return !b.reservationCount && !b.unknownLiability && !b.blockedReason &&
        b.budgetCommitted + manifest.budget.fullContextReservationCny <= b.cap + 1e-12;
    };
    if (!admissible()) return { attempted: 0, delivered: 0, stop: 'budget' };
    const key = await createCredentialResolver({ credentialsFile: authorization.credentialsFile, authorization })(authorization.allowedReferences[0]);
    const rows = [];
    for (const entry of planned) {
      if (!admissible()) break;
      const nodeId = entry.node.id, id = hash.slice(0, 16) + ':' + nodeId;
      log.write('start', { id, nodeId, inputHash: entry.node.inputHash });
      const result = redact(await replay(entry, binding, { llmConfig: { endpoint: pricing.endpoint, model: pricing.model, apiKey: key },
        versions: { prompt: manifest.promptVersion, facts: manifest.factCardVersion },
        request: (url, wire, attempt) => {
          if (!admissible()) throw new Error('Ledger cannot admit an additional request');
          return budget.request(url, wire, { jobId: id, ...attempt });
        } }), [key]);
      log.write('result', { id, ...result });
      if (result.delivered) queue.add({ resultId: id, ...result.reviewSource });
      rows.push(result);
    }
    queue.exportPackets();
    return { attempted: rows.length, delivered: rows.filter(r => r.delivered).length,
      unattempted: cases.length - attempted.size - rows.length, stop: rows.length < planned.length ? 'budget' : 'requested-limit' };
  } finally { budget?.close(); unlock(); }
}
module.exports = { verifyReady, runLive };

if (require.main === module) {
  const [mode, source, output, maxPoints, ...extra] = process.argv.slice(2);
  if (!source || !output || extra.length || !['verify', '--dispatch'].includes(mode) || (mode === 'verify' && maxPoints !== undefined))
    throw new Error('Usage: node live.cjs verify SOURCE OUTPUT | --dispatch SOURCE OUTPUT MAX_POINTS');
  const paths = [path.resolve(source), path.resolve(output)];
  if (mode === 'verify') { const p = verifyReady(...paths); console.log(JSON.stringify({ ready: true, points: p.cases.length, manifestHash: p.hash,
    capCny: p.ledger.cap, committedCny: p.ledger.budgetCommitted, remainingCny: p.ledger.cap - p.ledger.budgetCommitted })); }
  else runLive(...paths, Number(maxPoints)).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
