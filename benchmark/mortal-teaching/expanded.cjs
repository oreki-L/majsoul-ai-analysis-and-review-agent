'use strict';
// Offline preparation only. Live execution remains in the existing retest runner.
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { read, freeze, schedule } = require('./runner.cjs');
const { checkDataset } = require('./dataset.cjs');
const { sha256 } = require('./prompts.cjs');
const { RULES } = require('./review.cjs');
const { fingerprint } = require('./cli.cjs');
const retest = require('./retest.cjs');
const COHORTS = ['previous84', 'additional43'];
function subset(data, cohort) {
  const { datasetHash, ...body } = data;
  const nodes = body.nodes.filter(n => n.samplingCohort === cohort);
  if (!COHORTS.includes(cohort) || !nodes.length) throw new Error('Unknown or empty expansion cohort');
  const selected = { ...body, nodes };
  return checkDataset({ ...selected, datasetHash: stableHash(selected) });
}
function subsetHistory(history, data) {
  const { historyHash, ...body } = history;
  if (stableHash(body) !== historyHash) throw new Error('Historical archive changed');
  const ids = new Set(data.nodes.map(n => n.id));
  const selected = { ...body, datasetHash: data.datasetHash, rows: body.rows.filter(r => ids.has(r.nodeId)),
    expansionReference: 'Only archived released X-F first-pass answers; absent nodes have no historical reference.' };
  return { ...selected, historyHash: stableHash(selected) };
}
function budgetSummary(source) {
  const authorization = read(path.join(source, 'authorization.local.json'));
  const budget = read(path.join(authorization.budgetDirectory, 'budget.json'));
  if (authorization.approved !== true || authorization.cap !== 50 || budget.cap !== 50 || budget.currency !== 'CNY' || budget.reserved || budget.reservationCount || budget.unknownLiability) throw new Error('Original CNY50 ledger is unavailable or has unsettled liability');
  return { directory: authorization.budgetDirectory, capCny: 50, spentEstimateCny: budget.estimatedCost,
    committedCny: budget.budgetCommitted, remainingCny: 50 - budget.budgetCommitted,
    physicalRequests: budget.records.length, unknownLiability: budget.unknownLiability };
}
function freezeCohort(source, output, data, previous, prompts, code, cohort) {
  fs.mkdirSync(output, { recursive: true });
  freeze(path.join(output, 'dataset.json'), data);
  freeze(path.join(output, 'history-xf.json'), subsetHistory(read(path.join(source, 'history-xf.json')), data));
  for (const file of ['authorization.local.json', 'pricing.json']) fs.copyFileSync(path.join(source, file), path.join(output, file), fs.constants.COPYFILE_EXCL);
  freeze(path.join(output, 'supplement-plan.json'), cohort === 'previous84' ? read(path.join(source, 'supplement-plan.json')) :
    { selection: 'no-supplement-in-additional-cohort', repeatNodes: [], followupNodes: [], questions: [] });
  const sourceBytes = Object.fromEntries(retest.COPIED.map(f => [f, sha256(fs.readFileSync(path.join(output, f)))]));
  const contract = { kind: 'mortal-teaching-retest-v1', promptDirectory: previous.promptDirectory,
    source: { directory: source, contractSha256: sha256(fs.readFileSync(path.join(source, 'contract.json'))) }, sourceBytes,
    datasetHash: data.datasetHash, manifestHash: prompts.manifestHash, rulesHash: stableHash(RULES), code,
    experiments: prompts.variants.map(v => ({ id: v.id, experiment: v.experiment || {} })), sampling: previous.sampling,
    counts: { total: data.nodes.length, development: data.nodes.length, regression: 0, compatible: data.nodes.filter(n => n.compatible).length },
    candidateCount: prompts.variants.length, expansionCohort: cohort,
    stages: { development: 'All five frozen candidates, common engine cache, persistent variant/round history ordered by position. The development stage name is a runner implementation detail; no unseen-data claim.' },
    smokeGate: { candidate: 'r3-json', required: 'New real JSON/tool continuation proof required before live comparison', initialState: 'pending' },
    comparison: 'Same-match expanded comparison, not held-out validation. Cohorts and rounds reported separately.',
    billing: 'Original shared CNY50 campaign ledger; never reset.',
    selection: 'Unchanged development selection gates. Freeze previous84 selection before inspecting additional43 answers; execute all five on additional43 regardless of selection.' };
  contract.batchId = stableHash(contract).slice(0, 16);
  freeze(path.join(output, 'contract.json'), contract);
  const jobs = schedule(data, prompts.variants, 'development', undefined, true).map(j => ({ ...j, id: contract.batchId + ':' + j.id }));
  freeze(path.join(output, 'planned-schedule.json'), { datasetHash: data.datasetHash, manifestHash: prompts.manifestHash, stage: 'development', developmentHistory: true, jobs });
  retest.verify(output, true);
  return { directory: path.basename(output), datasetHash: data.datasetHash, contractHash: stableHash(contract), nodes: data.nodes.length, jobs: jobs.length,
    historyReferences: read(path.join(output, 'history-xf.json')).rows.length, scheduleHash: stableHash(jobs) };
}
async function prepare(source, output, evidenceRoot) {
  source = path.resolve(source); output = path.resolve(output);
  if (path.dirname(source) !== path.dirname(output) || source === output || fs.existsSync(output)) throw new Error('Choose a new sibling preparation directory');
  const { contract: previous, data: old, prompts } = retest.verify(source, false);
  if (old.nodes.length !== 84 || prompts.variants.length !== 5) throw new Error('Expected previous 84-node five-candidate experiment');
  const budget = budgetSummary(source);
  const data = await require('./expanded-dataset.cjs').prepareExpandedDataset(path.resolve(evidenceRoot), old);
  const inventory = { ...data.inventory, coverage: data.coverage };
  checkDataset(data);
  const counts = Object.fromEntries(COHORTS.map(c => [c, data.nodes.filter(n => n.samplingCohort === c).length]));
  if (data.nodes.length !== 127 || counts.previous84 !== 84 || counts.additional43 !== 43 || new Set(data.nodes.map(n => n.id)).size !== 127 || data.nodes.some(n => !n.compatible || n.split !== 'development')) throw new Error('Expansion inventory does not match 84 + 43 compatible unique nodes');
  // All old public requests must remain byte-equivalent under stable hashing.
  for (const node of old.nodes) {
    const expanded = data.nodes.find(n => n.id === node.id);
    if (!expanded || expanded.inputHash !== node.inputHash || stableHash(expanded.message) !== stableHash(node.message)) throw new Error('Expansion changed an original request');
  }
  const planning = { mainJobs: 635, supplementJobs: 24, smokeCount: 2, planningCnyPerLogicalJob: 0.04,
    smokeAllowanceCny: 0.2, projectedAdditionalCny: 659 * 0.04 + 0.2,
    semantics: 'Planning estimate only, approximately twice prior per-job cost; multiple tool HTTP calls are possible. Every physical HTTP attempt remains subject to full-context reservation in the shared ledger.' };
  if (planning.projectedAdditionalCny > budget.remainingCny) throw new Error('Planning estimate exceeds remaining campaign budget');
  const code = fingerprint();
  fs.mkdirSync(output, { recursive: true });
  const cohorts = Object.fromEntries(COHORTS.map(cohort => [cohort, freezeCohort(source, path.join(output, cohort), subset(data, cohort), previous, prompts, code, cohort)]));
  freeze(path.join(output, 'inventory.json'), inventory);
  freeze(path.join(output, 'all-dataset.json'), data);
  const contract = { kind: 'mortal-teaching-expanded-v1', preparedDate: '2026-11-09', status: 'prepared-not-started',
    source: { directory: source, contractHash: stableHash(previous) }, manifestHash: prompts.manifestHash, rulesHash: stableHash(RULES), code,
    datasetHash: data.datasetHash, inventoryHash: stableHash(inventory), cohorts, budgetAtPreparation: budget, planning,
    order: ['previous84 comparison and complete blind review', 'freeze previous84 selection', 'additional43 comparison of every candidate and complete blind review', '18 repeats + 6 followups on selected previous84 variant'],
    inference: 'One local Yuchen582500 action per unique node, cached and shared by all five candidates; no new engine cache has been generated during preparation.',
    limitations: ['Only one match and one self seat; 127 correlated decisions across 12 rounds.', 'Old 84 already examined; additional 43 are new to the preceding Mortal/LLM run, not globally unseen data.', 'No concurrent pure-LLM group. Only existing released X-F first-pass references.', 'Ordinary discard comparison is optional; unchanged six-dimension gpt-6.1-sol/medium review.', 'No prompt or product changes and no paid request during preparation.'] };
  freeze(path.join(output, 'expansion-contract.json'), contract);
  return { prepared: true, output, cohorts, uniqueNodes: 127, mainJobs: 635, supplementJobs: 24, paidRequests: 0, budget, planning };
}
function verify(output) {
  const contract = read(path.join(output, 'expansion-contract.json'));
  if (contract.kind !== 'mortal-teaching-expanded-v1' || stableHash(contract.code) !== stableHash(fingerprint()) || contract.inventoryHash !== stableHash(read(path.join(output, 'inventory.json'))) || contract.datasetHash !== checkDataset(read(path.join(output, 'all-dataset.json'))).datasetHash) throw new Error('Expanded preparation changed');
  for (const cohort of COHORTS) {
    const directory = path.join(output, cohort), child = retest.verify(directory, true), expected = contract.cohorts[cohort];
    if (stableHash(child.contract) !== expected.contractHash || child.data.datasetHash !== expected.datasetHash || child.prompts.manifestHash !== contract.manifestHash || stableHash(read(path.join(directory, 'planned-schedule.json')).jobs) !== expected.scheduleHash) throw new Error('Expanded child binding changed');
  }
  return contract;
}
async function main(argv) {
  const [command, ...rest] = argv, args = {};
  for (let i = 0; i < rest.length; i += 2) { if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new Error('Expected --name value'); args[rest[i].slice(2)] = rest[i + 1]; }
  if (!args.out) throw new Error('Required --out DIRECTORY');
  const output = path.resolve(args.out);
  if (command === 'prepare') { if (!args.source || !args.evidence) throw new Error('Required --source and --evidence'); return prepare(args.source, output, args.evidence); }
  const contract = verify(output);
  if (command === 'check') return { prepared: true, status: contract.status, mainJobs: contract.planning.mainJobs, cohorts: contract.cohorts, budget: budgetSummary(path.join(output, 'previous84')), paidRequests: 0 };
  if (command === 'mock') {
    if (!COHORTS.includes(args.cohort)) throw new Error('Choose previous84 or additional43');
    return retest.main(['mock', '--out', path.join(output, args.cohort), '--stage', 'development']);
  }
  throw new Error('Offline preparation supports only prepare, check and mock; no live dispatch here');
}
if (require.main === module) main(process.argv.slice(2)).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { COHORTS, subset, subsetHistory, budgetSummary, prepare, verify, main };
