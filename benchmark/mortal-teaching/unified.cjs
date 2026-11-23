'use strict';
// A single 127-node matrix: keep completed cells and dispatch only missing cells.
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { readEvents } = require('../durable.cjs');
const { read, freeze, schedule } = require('./runner.cjs');
const { checkDataset } = require('./dataset.cjs');
const { sha256 } = require('./prompts.cjs');
const { RULES, createQueue } = require('./review.cjs');
const { fingerprint } = require('./cli.cjs');
const { subsetHistory, budgetSummary } = require('./expanded.cjs');
const { loadReuse } = require('./reuse.cjs');
const retest = require('./retest.cjs');
const SOURCE_FILES = ['contract.json', 'dataset.json', 'engine-cache-contract.json', 'engine-cache.jsonl', 'live/development/schedule.json', 'live/development/results.jsonl', 'live/regression/schedule.json', 'live/regression/results.jsonl', 'live/supplement/schedule.json', 'live/supplement/results.jsonl', 'review/queue.jsonl', 'json-smoke.json', 'json-smoke.jsonl', 'COMPLETION_AUDIT.json'];
function resultRows(source, stage) {
  return readEvents(path.join(source, 'live', stage, 'results.jsonl')).filter(e => e.kind === 'result').map(e => e.payload);
}
function assertRuntimeCompatibility(previous, current) {
  const benchmarkRuntime = ['harness.cjs', 'fact-card.cjs', 'honor-chinese.cjs', 'retest-projection.cjs', 'prompts.cjs'].map(f => 'benchmark/mortal-teaching/' + f);
  const keys = Object.keys(previous).filter(f => f.startsWith('extension/') || benchmarkRuntime.includes(f));
  if (!keys.length || benchmarkRuntime.some(f => !keys.includes(f)) || keys.some(f => previous[f] !== current[f])) throw new Error('Product/prompt runtime changed; old results require a new compatibility assessment');
  return keys.length;
}
function assertWholeBranches(nodes, specs) {
  const branches = new Map();
  for (const spec of specs) {
    const key = spec.variant + ':' + spec.roundId;
    if (!branches.has(key)) branches.set(key, new Set());
    if (branches.get(key).has(spec.nodeId)) throw new Error('Duplicate reused node/variant');
    branches.get(key).add(spec.nodeId);
  }
  for (const [key, ids] of branches) {
    const roundId = key.slice(key.indexOf(':') + 1);
    const expected = nodes.filter(n => n.roundId === roundId);
    if (ids.size !== expected.length || expected.some(n => !ids.has(n.id))) throw new Error('Partially reused history branch requires explicit history restoration: ' + key);
  }
}
async function prepare(source, output, evidenceRoot) {
  source = path.resolve(source); output = path.resolve(output);
  if (path.dirname(source) !== path.dirname(output) || source === output || fs.existsSync(output)) throw new Error('Choose a new sibling preparation');
  const { contract: previous, data: old, prompts } = retest.verify(source, false);
  retest.smokePassed(source, previous);
  if (old.nodes.length !== 84 || prompts.variants.length !== 5) throw new Error('Expected the five-candidate completed source');
  const budget = budgetSummary(source);
  const pool = await require('./expanded-dataset.cjs').prepareExpandedDataset(path.resolve(evidenceRoot), old);
  const nodes = pool.nodes.map(({ samplingCohort, ...node }) => node);
  const coverage = { uniqueDecisions: 127, rounds: pool.coverage.rounds.map(r => ({ roundId: r.roundId, decisions: r.total })), independentMatches: 1, selfSeat: 1,
    historicalExposure: pool.coverage.historicalExposure, interpretation: 'One unified matrix; no development/confirmation split. Existing cells retained, missing cells filled.' };
  const dataBody = { format: pool.format, simulation: pool.simulation, sources: pool.sources, previousDatasetHash: old.datasetHash, coverage, nodes };
  const data = checkDataset({ ...dataBody, datasetHash: stableHash(dataBody) });
  const code = fingerprint();
  const compatibleRuntimeFiles = assertRuntimeCompatibility(previous.code, code);
  const sourceFiles = Object.fromEntries(SOURCE_FILES.map(file => [file, sha256(fs.readFileSync(path.join(source, file)))]));
  const batchId = stableHash({ kind: 'unified-reuse', datasetHash: data.datasetHash, manifestHash: prompts.manifestHash, sourceFiles, code }).slice(0, 16);
  const sourceReviews = new Map();
  for (const event of readEvents(path.join(source, 'review/queue.jsonl'))) if (event.kind === 'job') sourceReviews.set(event.payload.resultId, event.payload);
  function spec(row, stage, variant) {
    const node = nodes.find(n => n.id === row.nodeId), prompt = prompts.variants.find(v => v.id === variant);
    if (!node || !prompt || row.mock !== false && stage !== 'supplement' || row.inputHash && row.inputHash !== node.inputHash || row.promptHash && row.promptHash !== prompt.sha256 || !row.id) throw new Error('Original result does not match unified input/prompt');
    const review = sourceReviews.get(row.id);
    if (row.delivered && (!review?.review || review.state !== 'complete' || review.packet.answer !== row.reviewSource?.answer || stableHash(review.packet.facts) !== stableHash(row.reviewSource?.facts))) throw new Error('Delivered reused result lacks its exact completed review');
    const id = stage !== 'supplement' ? batchId + ':development:' + row.nodeId + ':' + variant : batchId + ':' + row.kind + ':' + row.nodeId + ':' + variant + (row.kind === 'followup' ? ':' + row.index : '');
    return { id, nodeId: row.nodeId, variant, roundId: node.roundId, file: 'live/' + stage + '/results.jsonl', sourceId: row.id, sourceHash: stableHash(row), sourceReviewHash: review ? stableHash(review) : null };
  }
  const main = ['development', 'regression'].flatMap(stage => {
    const rows = resultRows(source, stage), sourceSchedule = read(path.join(source, 'live', stage, 'schedule.json'));
    const events = readEvents(path.join(source, 'live', stage, 'results.jsonl'));
    if (rows.length !== sourceSchedule.jobs.length || sourceSchedule.jobs.some(j => events.filter(e => e.kind === 'start' && e.payload.id === j.id).length !== 1 || rows.filter(r => r.id === j.id).length !== 1)) throw new Error('Source stage is unfinished or duplicated');
    return rows.map(row => spec(row, stage, row.variant));
  });
  if (main.length !== 180 || main.filter(s => s.sourceReviewHash).length !== 174 || new Set(main.map(s => s.id)).size !== main.length) throw new Error('Expected 180 reused main opportunities and 174 reviews');
  assertWholeBranches(nodes, main);
  const cacheRows = readEvents(path.join(source, 'engine-cache.jsonl')).filter(e => e.kind === 'result').map(e => e.payload);
  const engines = cacheRows.map(row => ({ nodeId: row.nodeId, inputHash: row.inputHash, file: 'engine-cache.jsonl', sourceHash: stableHash(row) }));
  engines.push(...resultRows(source, 'regression').map(row => ({ nodeId: row.nodeId, inputHash: row.inputHash, file: 'live/regression/results.jsonl', sourceId: row.id, sourceHash: stableHash(row) })));
  if (engines.length !== 84 || new Set(engines.map(e => e.nodeId)).size !== 84 || engines.some(e => nodes.find(n => n.id === e.nodeId)?.inputHash !== e.inputHash)) throw new Error('Original 84 engine results cannot be reused');
  const supplementWinner = read(path.join(source, 'live/supplement/schedule.json')).winner;
  const supplement = resultRows(source, 'supplement').map(row => spec(row, 'supplement', supplementWinner));
  if (supplement.length !== 24 || supplement.filter(s => s.sourceReviewHash).length !== 18) throw new Error('Original supplement inventory changed');
  const plan = { kind: 'mortal-teaching-reuse-v1', sourceDirectory: source, sourceFiles, datasetHash: data.datasetHash, manifestHash: prompts.manifestHash,
    rulesHash: stableHash(RULES), main, engines, supplement, supplementWinner,
    interpretation: 'Completed failures are retained as failures; no retry, no regenerated answer, no new review. Original evidence and billing stay at their source.' };
  const jobs = schedule(data, prompts.variants, 'development', undefined, true).map(j => ({ ...j, id: batchId + ':' + j.id }));
  const reusedIds = new Set(main.map(s => s.id)), missingJobs = jobs.filter(j => !reusedIds.has(j.id));
  if (jobs.length !== 635 || missingJobs.length !== 455) throw new Error('Expected 635 total cells, 180 reused, 455 missing');
  const planning = { totalMain: 635, reusedMain: 180, retainedDeliveredAndScored: 174, retainedFailures: 6, newMain: 455,
    engineReused: 84, newEngine: 43, reusedRealSmoke: true, newSmokeRequests: 0,
    supplement: { opportunities: 24, reusableIfSelected: supplementWinner, reusedWhenP0Selected: 24, newWhenOtherSelected: 24 },
    planningCnyPerLogicalJob: 0.04, projectedNewMainCny: 18.2, optionalNewSupplementAllowanceCny: 0.96, projectedMaximumNewCny: 19.16,
    semantics: 'Planning estimate, not bill or guarantee; reused HTTP cost already in original ledger, not charged twice. Each actual future HTTP still subject to original CNY50 full-context reservation.' };
  if (planning.projectedMaximumNewCny > budget.remainingCny) throw new Error('Insufficient planning budget');
  fs.mkdirSync(output, { recursive: true });
  freeze(path.join(output, 'dataset.json'), data);
  freeze(path.join(output, 'history-xf.json'), subsetHistory(read(path.join(source, 'history-xf.json')), data));
  for (const file of ['supplement-plan.json', 'authorization.local.json', 'pricing.json']) fs.copyFileSync(path.join(source, file), path.join(output, file), fs.constants.COPYFILE_EXCL);
  freeze(path.join(output, 'reuse-plan.json'), plan);
  freeze(path.join(output, 'planned-schedule.json'), { datasetHash: data.datasetHash, manifestHash: prompts.manifestHash, stage: 'development', winner: null, developmentHistory: true, jobs });
  freeze(path.join(output, 'missing-schedule.json'), { datasetHash: data.datasetHash, jobs: missingJobs });
  const contract = { kind: 'mortal-teaching-retest-v1', batchId, promptDirectory: previous.promptDirectory,
    source: { directory: source, contractSha256: sourceFiles['contract.json'] },
    sourceBytes: Object.fromEntries(retest.COPIED.map(file => [file, sha256(fs.readFileSync(path.join(output, file)))])),
    datasetHash: data.datasetHash, manifestHash: prompts.manifestHash, rulesHash: stableHash(RULES), code,
    experiments: prompts.variants.map(v => ({ id: v.id, experiment: v.experiment || {} })), sampling: previous.sampling,
    counts: { total: 127, development: 127, regression: 0, compatible: 127 }, candidateCount: 5, unified: true,
    plannedScheduleHash: stableHash(read(path.join(output, 'planned-schedule.json'))), missingScheduleHash: stableHash(read(path.join(output, 'missing-schedule.json'))),
    reusePlanHash: stableHash(plan), reusedSmoke: { sourceBatchId: previous.batchId, sourceFile: 'json-smoke.json', sourceSha256: sourceFiles['json-smoke.json'], protocolAndPromptUnchanged: true },
    planning, budgetAtPreparation: budget, compatibleRuntimeFiles,
    comparison: 'One unified 127-node / five-candidate matrix. Reuse original 180 opportunities and 174 completed scores, retain six failures; fill only 455 missing cells. No cohort split.',
    stages: { development: '635 cells, 180 read-only reused + 455 new; each missing variant/round branch starts fresh and is complete, ordered by position.' },
    selection: 'Original candidate selection gates applied once to the unified completed matrix.', billing: 'Same original CNY50 ledger, original incurred cost is not incurred again.' };
  freeze(path.join(output, 'contract.json'), contract);
  const reuse = loadReuse(output);
  const queue = createQueue(path.join(output, 'review'), data.datasetHash); reuse.importReviews(queue);
  queue.exportPackets();
  if (queue.snapshot().length !== 174 || reuse.engines().length !== 84) throw new Error('Reuse import failed');
  retest.verify(output, true); retest.smokePassed(output, contract);
  return { prepared: true, output, planning, paidRequests: 0, budget };
}
async function main(argv) {
  const [command, ...rest] = argv, args = {};
  for (let i = 0; i < rest.length; i += 2) { if (!rest[i].startsWith('--') || rest[i+1] === undefined) throw new Error('Expected --name value'); args[rest[i].slice(2)] = rest[i+1]; }
  if (!args.out) throw new Error('Required --out DIRECTORY');
  const output = path.resolve(args.out);
  if (command === 'prepare') { if (!args.source || !args.evidence) throw new Error('Required --source and --evidence'); return prepare(args.source, output, args.evidence); }
  const { contract, data } = retest.verify(output, true);
  if (!contract.unified) throw new Error('Expected unified reuse preparation');
  if (command === 'check') return { prepared: true, notStarted: !fs.existsSync(path.join(output, 'live')), planning: contract.planning, importedScores: createQueue(path.join(output,'review'),data.datasetHash).snapshot().filter(j=>j.reviewOrigin).length, smoke: retest.smokePassed(output, contract), budget: budgetSummary(output) };
  if (command === 'report') return retest.retestReport(output, args.stage || 'development', args.mock === 'true');
  if (command === 'mock') return retest.main(['mock','--out',output,'--stage','development']);
  throw new Error('Offline unified CLI supports only prepare/check/report/mock');
}
if (require.main === module) main(process.argv.slice(2)).then(value => console.log(JSON.stringify(value,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports = { prepare, main, assertWholeBranches, assertRuntimeCompatibility, SOURCE_FILES };
