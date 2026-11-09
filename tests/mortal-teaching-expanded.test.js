'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stableHash } = require('../benchmark/core.cjs');
const { subset, subsetHistory, budgetSummary, main } = require('../benchmark/mortal-teaching/expanded.cjs');
function dataFixture() {
  const body = { format: 'unit-fixture', nodes: ['previous84', 'additional43'].map((samplingCohort, index) => {
    const message = { snapshot: { selfSeat: 1 }, position: index };
    return { id: 'node-' + index, message, inputHash: stableHash(message), samplingCohort, split: 'development' };
  }) };
  return { ...body, datasetHash: stableHash(body) };
}
test('cohort datasets preserve requests and reject unrecognized or empty cohorts', () => {
  const data = dataFixture();
  for (const cohort of ['previous84', 'additional43']) {
    const selected = subset(data, cohort);
    assert.equal(selected.nodes.length, 1);
    assert.equal(selected.nodes[0].message, data.nodes.find(n => n.samplingCohort === cohort).message);
    assert.notEqual(selected.datasetHash, data.datasetHash);
  }
  assert.throws(() => subset(data, 'invented'), /Unknown or empty/);
});
test('historical references are rebound only for matching nodes; missing answers remain absent', () => {
  const data = dataFixture();
  const body = { datasetHash: data.datasetHash, scheme: 'X-F', rows: [{ nodeId: 'node-0', answer: 'original' }] };
  const history = { ...body, historyHash: stableHash(body) };
  assert.equal(subsetHistory(history, subset(data, 'previous84')).rows.length, 1);
  const additional = subsetHistory(history, subset(data, 'additional43'));
  assert.equal(additional.rows.length, 0);
  assert.equal(additional.datasetHash, subset(data, 'additional43').datasetHash);
  assert.equal(history.rows.length, 1);
  assert.throws(() => subsetHistory({ ...history, scheme: 'wrong' }, data), /archive changed/);
});
test('preparation reads the original ledger without rewriting it and rejects unknown liability', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expanded-offline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'authorization.local.json'), JSON.stringify({ approved: true, cap: 50, budgetDirectory: root }));
  const ledger = { cap: 50, currency: 'CNY', estimatedCost: 6.31, budgetCommitted: 6.31, reserved: 0, reservationCount: 0, records: [{ id: 1 }], unknownLiability: false };
  const file = path.join(root, 'budget.json'), bytes = JSON.stringify(ledger);
  fs.writeFileSync(file, bytes);
  assert.equal(budgetSummary(root).remainingCny, 43.69);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  fs.writeFileSync(file, JSON.stringify({ ...ledger, unknownLiability: true }));
  assert.throws(() => budgetSummary(root), /unsettled liability/);
});
test('offline CLI has no path that silently falls through to live execution', async () => {
  await assert.rejects(main(['prepare', '--out', 'irrelevant']), /Required --source and --evidence/);
});

test('supplement round counts include delivered and skipped rows without persisting synthetic round IDs', t => {
  const { journal } = require('../benchmark/durable.cjs');
  const { buildReport } = require('../benchmark/mortal-teaching/report.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expanded-supplement-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'mock', 'supplement'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'dataset.json'), JSON.stringify({ nodes: [{ id: 'n1', roundId: 'round-a' }, { id: 'n2', roundId: 'round-b' }] }));
  fs.writeFileSync(path.join(dir, 'schedule.json'), JSON.stringify({ datasetHash: 'fixture', winner: 'p0-release-v2', jobs: [{ id: 'j1', nodeId: 'n1' }, { id: 'j2', nodeId: 'n2' }] }));
  const log = journal(path.join(dir, 'results.jsonl'));
  log.write('result', { id: 'j1', nodeId: 'n1', delivered: true, elapsedMs: 10 });
  log.write('result', { id: 'j2', nodeId: 'n2', delivered: false, reason: 'anchor not delivered' });
  const before = fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8');
  const rounds = buildReport(root, 'supplement', true).groups['p0-release-v2'].rounds;
  assert.equal(rounds['round-a'].attempted, 1); assert.equal(rounds['round-a'].delivered, 1);
  assert.equal(rounds['round-b'].attempted, 1); assert.equal(rounds['round-b'].delivered, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8'), before);
});
