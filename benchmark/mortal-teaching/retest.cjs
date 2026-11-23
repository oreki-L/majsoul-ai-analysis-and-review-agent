'use strict';
// A separate preparation lineage; the first campaign's frozen evidence is never rewritten.
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { journal, readEvents, acquireLock } = require('../durable.cjs');
const { createCredentialResolver, redact } = require('../accounting.cjs');
const { read, freeze, runStage, cacheEngines, validateEngineCache, delivery } = require('./runner.cjs');
const { checkDataset } = require('./dataset.cjs');
const { loadPrompts, sha256 } = require('./prompts.cjs');
const { RULES, createQueue } = require('./review.cjs');
const { fingerprint } = require('./cli.cjs');
const repositoryRoot = path.resolve(__dirname, '../..');
const legacyPromptDirectory = path.resolve(__dirname, '../prompts/mortal-teaching-20261106');
const promptDirectory = path.resolve(__dirname, '../prompts/mortal-teaching-20261106-honors');
function contractPromptDirectory(contract) {
  if (contract.promptDirectory === undefined) return legacyPromptDirectory;
  const allowed = [legacyPromptDirectory, promptDirectory].map(directory => path.relative(repositoryRoot, directory).replace(/\\/g, '/'));
  if (!allowed.includes(contract.promptDirectory)) throw new Error('Unknown frozen retest prompt directory');
  return path.resolve(repositoryRoot, contract.promptDirectory);
}
const COPIED = ['dataset.json', 'history-xf.json', 'supplement-plan.json', 'authorization.local.json', 'pricing.json'];
function byteHashes(directory) { return Object.fromEntries(COPIED.map(f => [f, sha256(fs.readFileSync(path.join(directory, f)))])); }
function verify(output, code = false) {
  const contract = read(path.join(output, 'contract.json')), data = checkDataset(read(path.join(output, 'dataset.json'))), prompts = loadPrompts(contractPromptDirectory(contract));
  if (contract.kind !== 'mortal-teaching-retest-v1' || contract.datasetHash !== data.datasetHash || contract.manifestHash !== prompts.manifestHash || contract.rulesHash !== stableHash(RULES) || stableHash(contract.sourceBytes) !== stableHash(byteHashes(output)) || stableHash(contract.experiments) !== stableHash(prompts.variants.map(v => ({ id: v.id, experiment: v.experiment || {} })))) throw new Error('Frozen retest contract changed');
  if (contract.reusePlanHash) require('./reuse.cjs').loadReuse(output);
  if (contract.unified && (contract.plannedScheduleHash !== stableHash(read(path.join(output, 'planned-schedule.json'))) || contract.missingScheduleHash !== stableHash(read(path.join(output, 'missing-schedule.json'))))) throw new Error('Unified schedule changed');
  if (code && stableHash(contract.code) !== stableHash(fingerprint())) throw new Error('Prepared code changed; create a new sibling preparation');
  return { contract, data, prompts };
}
function engineConfiguration(file) {
  if (!file) throw new Error('Requires --engine-config PRIVATE_JSON');
  const config = read(file), url = new URL(config.endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/analyze' || !config.apiKey || config.engineProfile !== 'yuchen-582500') throw new Error('Expected authenticated yuchen-582500 loopback engine');
  return config;
}
async function prepare(source, output) {
  source = path.resolve(source);
  if (source === output || path.dirname(source) !== path.dirname(output)) throw new Error('Retest output must be a new sibling of source');
  if (fs.existsSync(output)) throw new Error('Retest output already exists; inspect or choose a new sibling');
  const data = checkDataset(read(path.join(source, 'dataset.json'))), prior = read(path.join(source, 'contract.json'));
  const authorization = read(path.join(source, 'authorization.local.json')), pricing = read(path.join(source, 'pricing.json'));
  const history = read(path.join(source, 'history-xf.json')), { historyHash, ...historyBody } = history;
  if (prior.manifestHash !== loadPrompts().manifestHash || prior.datasetHash !== data.datasetHash || prior.rulesHash !== stableHash(RULES) || prior.authorizationHash !== stableHash(authorization) || prior.pricingHash !== stableHash(pricing) || prior.supplementPlanHash !== stableHash(read(path.join(source, 'supplement-plan.json'))) || prior.historyHash !== historyHash || historyHash !== stableHash(historyBody) || history.datasetHash !== data.datasetHash) throw new Error('Source preparation identity mismatch');
  if (!authorization.budgetDirectory || !fs.existsSync(path.join(authorization.budgetDirectory, 'budget.json'))) throw new Error('Existing shared campaign billing is required; never reset it');
  const key = await createCredentialResolver({ credentialsFile: authorization.credentialsFile, authorization })(authorization.allowedReferences[0]);
  if (!key) throw new Error('Previously configured credential unavailable');
  const budget = require('./budget.cjs').openBudget({ directory: authorization.budgetDirectory, authorization, pricing, fetchImpl: async () => { throw new Error('Preparation must never dispatch'); } });
  budget.close();
  const prompts = loadPrompts(promptDirectory);
  if (prompts.variants.map(v => v.id).join(',') !== 'p0-release-v2,r1-facts,r2-history,r3-json,r4-honors-zh') throw new Error('Expected five frozen retest candidates');
  const counts = { development: data.nodes.filter(n => n.compatible && n.split === 'development').length, regression: data.nodes.filter(n => n.compatible && n.split === 'validation').length };
  if (counts.development !== 24 || counts.regression !== 60) throw new Error('Expected the already-examined 24 + 60 dataset');
  const sourceBytes = byteHashes(source), code = fingerprint();
  const contract = { kind: 'mortal-teaching-retest-v1', promptDirectory: path.relative(repositoryRoot, promptDirectory).replace(/\\/g, '/'), source: { directory: source, contractSha256: sha256(fs.readFileSync(path.join(source, 'contract.json'))) }, sourceBytes,
    datasetHash: data.datasetHash, manifestHash: prompts.manifestHash, rulesHash: stableHash(RULES), code,
    experiments: prompts.variants.map(v => ({ id: v.id, experiment: v.experiment || {} })),
    sampling: prior.sampling, counts, candidateCount: prompts.variants.length, stages: { development: '24 already-examined nodes x five candidates; common cached engine actions; persistent variant/round history in ascending position order', regression: '60 already-examined nodes; concurrent P0 + selected winner, or P0 only', supplement: 'original fixed 18 repeats + 6 followups for selected winner' },
    smokeGate: { candidate: 'r3-json', required: 'real JSON-object HTTP + tool-call continuation + strict JSON delivery + reconciled usage; mock cannot pass', initialState: 'pending' },
    comparison: 'New results only; all 84 decisions were previously examined. This is development/regression, never held-out validation.',
    billing: 'Original authorization/pricing bytes; original shared ledger, including prior spend; no reset',
    selection: 'Unchanged report.cjs development and regression adoption gates; completed blinded gpt-6.1-sol medium review required' };
  contract.batchId = stableHash(contract).slice(0, 16);
  fs.mkdirSync(output, { recursive: true });
  for (const file of COPIED) fs.copyFileSync(path.join(source, file), path.join(output, file), fs.constants.COPYFILE_EXCL);
  freeze(path.join(output, 'contract.json'), contract);
  // Copy cache bytes only after validating source binding, inputs, identity and completion.
  if (fs.existsSync(path.join(source, 'engine-cache-contract.json'))) {
    const binding = read(path.join(source, 'engine-cache-contract.json'));
    validateEngineCache(source, data, { engineProfile: binding.profile, model: binding.model, endpoint: binding.endpoint });
    for (const file of ['engine-cache-contract.json', 'engine-cache.jsonl']) fs.copyFileSync(path.join(source, file), path.join(output, file), fs.constants.COPYFILE_EXCL);
  }
  return { prepared: true, ...counts, developmentJobs: 120, regressionJobs: '120 (60 if P0 selected)', supplementJobs: 24, paidRequests: 0, smoke: 'pending', sharedBilling: authorization.budgetDirectory };
}
function smokePassed(output, contract) {
  if (contract.reusedSmoke) return require('./reuse.cjs').inheritedSmoke(output, contract);
  const proof = read(path.join(output, 'json-smoke.json'));
  const events = readEvents(path.join(output, 'json-smoke.jsonl'));
  if (proof.passed !== true || proof.mock !== false || proof.batchId !== contract.batchId || proof.manifestHash !== contract.manifestHash || proof.logHash !== stableHash(events) || !events.some(e => e.kind === 'result' && e.payload.passed === true)) throw new Error('Real r3 JSON/tool compatibility smoke is pending or invalid');
  return proof;
}
function retestReport(output, stage, mock = false) {
  const report = require('./report.cjs').buildReport(output, stage, mock);
  const directory = path.join(output, mock ? 'mock' : 'live', stage);
  const planFile = path.join(directory, 'schedule.json');
  const plan = read(!fs.existsSync(planFile) && stage === 'development' && fs.existsSync(path.join(output, 'reuse-plan.json')) ? path.join(output, 'planned-schedule.json') : planFile);
  const rows = require('./reuse.cjs').mergedRows(output, directory, stage, plan.winner);
  const reviewMap = new Map(createQueue(path.join(output, mock ? 'mock-review' : 'review'), report.datasetHash).snapshot().map(j => [j.resultId, j.review]));
  function metrics(jobs) {
    const ids = new Set(jobs.map(j => j.id)), delivered = rows.filter(r => ids.has(r.id) && r.delivered);
    const reviews = delivered.map(r => reviewMap.get((mock ? 'mock:' : '') + r.id)).filter(Boolean);
    const sum = reviews.reduce((total, r) => total + r.commonMean, 0);
    const attempted = rows.filter(r => ids.has(r.id)).length;
    return { planned: jobs.length, reused: rows.filter(r => ids.has(r.id) && r.reuseProvenance).length, newlyAttempted: rows.filter(r => ids.has(r.id) && !r.reuseProvenance).length, attempted, delivered: delivered.length, scored: reviews.length,
      qualityPass: reviews.filter(r => r.gate === 'pass').length, qualityPassRate: jobs.length ? reviews.filter(r => r.gate === 'pass').length / jobs.length : null,
      contentMean: reviews.length ? sum / reviews.length : null,
      commonMean: reviews.length ? sum / reviews.length : null,
      endToEndCommonMean: attempted === jobs.length && reviews.length === delivered.length && jobs.length ? sum / jobs.length : null };
  }
  for (const [variant, group] of Object.entries(report.groups)) {
    const jobs = plan.jobs.filter(j => (j.variant || plan.winner) === variant);
    Object.assign(group, metrics(jobs));
    if (stage === 'supplement') group.byKind = Object.fromEntries(['repeat', 'followup'].map(kind => [kind, metrics(jobs.filter(j => j.kind === kind))]));
  }
  if (stage === 'development' && ['r1-facts', 'r4-honors-zh'].every(id => plan.jobs.some(j => j.variant === id))) {
    const source = 'r1-facts', target = 'r4-honors-zh';
    const comparison = { source, target, wins: 0, losses: 0, ties: 0, pending: 0, actionMismatch: 0,
      sourceMetrics: metrics(plan.jobs.filter(j => j.variant === source)), targetMetrics: metrics(plan.jobs.filter(j => j.variant === target)) };
    const pairedMeans = [];
    for (const job of plan.jobs.filter(j => j.variant === target)) {
      const sourceJob = plan.jobs.find(j => j.variant === source && j.nodeId === job.nodeId);
      const a = rows.find(r => r.id === sourceJob?.id), b = rows.find(r => r.id === job.id);
      const ar = a && reviewMap.get((mock ? 'mock:' : '') + a.id), br = b && reviewMap.get((mock ? 'mock:' : '') + b.id);
      const engineAction = row => ({ action: row.outcome.engine.action, followUp: row.outcome.engine.followUp ?? null });
      if (a?.outcome?.engine && b?.outcome?.engine && stableHash(engineAction(a)) !== stableHash(engineAction(b))) { comparison.actionMismatch++; continue; }
      if (!a || !b || !a.outcome?.engine || !b.outcome?.engine || a.delivered && !ar || b.delivered && !br || ar?.gate === 'needs_review' || br?.gate === 'needs_review') { comparison.pending++; continue; }
      const apass = ar?.gate === 'pass', bpass = br?.gate === 'pass';
      if (bpass && !apass) comparison.wins++; else if (apass && !bpass) comparison.losses++; else comparison.ties++;
      if (ar && br) pairedMeans.push(br.commonMean - ar.commonMean);
    }
    comparison.pairedScored = pairedMeans.length;
    comparison.pairedCommonMeanDelta = pairedMeans.length ? pairedMeans.reduce((sum, value) => sum + value, 0) / pairedMeans.length : null;
    comparison.interpretation = 'R4 versus R1 isolates model-side Chinese honor encoding and its encoding guidance. Original P0 selection gates remain unchanged; P0 differences cannot be attributed to honor encoding.';
    report.encodingComparison = comparison;
  }
  if (stage === 'supplement') {
    // Different questions and repetition have separate denominators and means.
    for (const group of Object.values(report.groups)) for (const key of ['commonMean', 'contractMean', 'contentMean', 'endToEndCommonMean', 'qualityPassRate']) delete group[key];
  }
  report.scoreSemantics = { contentMean: 'Delivered and scored answers only; commonMean has the same content-only denominator.', endToEndCommonMean: 'All planned opportunities; nondelivery is zero only when attempts and delivered-answer scoring are complete, otherwise null.', supplement: 'repeat and followup are reported separately in byKind; no pooled score or pass rate.' };
  report.alreadyExamined = true;
  report.manifestHash = read(path.join(output, 'contract.json')).manifestHash;
  return report;
}
async function smokeJson({ output, engineConfig, fetchImpl = fetch }) {
  const { contract, data, prompts } = verify(output, true);
  const unlock = acquireLock(path.join(output, 'experiment.lock'), true); let budget;
  try {
    const log = journal(path.join(output, 'json-smoke.jsonl'));
    if (log.events.length) throw new Error('Smoke was already started; audit retained evidence, never automatically retry');
    validateEngineCache(output, data, engineConfig);
    const node = data.nodes.find(n => n.compatible && n.split === 'development'), variant = prompts.variants.find(v => v.id === 'r3-json');
    const cached = readEvents(path.join(output, 'engine-cache.jsonl')).find(e => e.kind === 'result' && e.payload.nodeId === node.id).payload;
    const authorization = read(path.join(output, 'authorization.local.json')), pricing = read(path.join(output, 'pricing.json'));
    const key = await createCredentialResolver({ credentialsFile: authorization.credentialsFile, authorization })(authorization.allowedReferences[0]);
    const secrets = [key, engineConfig.apiKey];
    budget = require('./budget.cjs').openBudget({ directory: authorization.budgetDirectory, authorization, pricing, fetchImpl, secrets });
    log.write('start', { batchId: contract.batchId, nodeId: node.id, inputHash: node.inputHash, variant: variant.id, mock: false });
    const requests = [], responses = []; let ordinal = 0;
    const harness = require('./harness.cjs').createHarness({ variant, engineConfig, llmConfig: { endpoint: pricing.endpoint, model: pricing.model, apiKey: key },
      persist: (kind, value) => log.write('trace', { kind, value: redact(value, secrets) }),
      fetchModel: async (url, options) => {
        if (url === engineConfig.endpoint) { const engine = cached.result.engine; return Response.json({ action: engine.action, ...(engine.followUp ? { followUp: engine.followUp } : {}), identity: engine.identity }); }
        const body = JSON.parse(options.body); body.temperature = 0;
        if (ordinal === 0) body.tool_choice = { type: 'function', function: { name: 'get_self_hand' } };
        else if (body.tools?.length) body.tool_choice = 'auto';
        else delete body.tool_choice;
        if (ordinal === 0 && !body.tools?.some(t => t.function?.name === 'get_self_hand')) throw new Error('Required smoke tool unavailable');
        ordinal++; requests.push(body); log.write('wire-request', { ordinal, body: redact(body, secrets) });
        const response = await budget.request(url, { ...options, body: JSON.stringify(body) }, { jobId: contract.batchId + ':json-smoke', role: ordinal === 1 ? 'initial' : 'tool-continuation', ordinal });
        const payload = await response.clone().json().catch(() => null); responses.push({ status: response.status, payload });
        log.write('wire-response', { ordinal, status: response.status, body: redact(payload, secrets) }); return response;
      } });
    const outcome = await harness.worker.analyze(structuredClone(node.message), 'benchmark');
    let strictJson = false;
    try { const parsed = JSON.parse(harness.traces.at(-1)?.text); strictJson = !!parsed && !Array.isArray(parsed) && typeof parsed === 'object'; } catch { /* proof remains false */ }
    const settled = budget.log.events.filter(e => e.kind === 'response' && budget.log.events.some(d => d.kind === 'dispatch' && d.payload.attemptId === e.payload.attemptId && d.payload.identity.jobId === contract.batchId + ':json-smoke'));
    const checks = { delivered: delivery(outcome), strictJson, jsonModeEveryRequest: requests.length >= 2 && requests.every(r => r.response_format?.type === 'json_object'),
      realToolCall: responses.some(r => r.status >= 200 && r.status < 300 && r.payload?.choices?.some(c => c.message?.tool_calls?.some(t => t.function?.name === 'get_self_hand'))),
      toolContinuation: requests.slice(1).some(r => r.messages?.some(m => m.role === 'tool')) && harness.traces.some(t => t.toolResults?.some(r => r.toolName === 'get_self_hand' && !r.isError)),
      reconciledUsage: settled.length === requests.length && settled.every(r => r.payload.estimatedCost !== null) && !budget.snapshot().reservationCount && !budget.snapshot().unknownLiability };
    const passed = Object.values(checks).every(Boolean);
    log.write('result', { passed, checks, outcome: redact(outcome, secrets) });
    const proof = { batchId: contract.batchId, manifestHash: contract.manifestHash, mock: false, passed, checks, physicalRequests: ordinal, logHash: stableHash(log.events) };
    freeze(path.join(output, 'json-smoke.json'), proof);
    return proof;
  } finally { budget?.close(); unlock(); }
}
async function main(argv) {
  const [command, ...rest] = argv, args = {};
  for (let i = 0; i < rest.length; i += 2) { if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new Error('Expected --name value'); args[rest[i].slice(2)] = rest[i + 1]; }
  if (!args.out) throw new Error('Required --out DIRECTORY');
  const output = path.resolve(args.out);
  if (command === 'prepare') { if (!args.source) throw new Error('Required --source OLD_PREPARED'); return prepare(args.source, output); }
  const { contract, data } = verify(output, !['status', 'report', 'review-export', 'review-import'].includes(command));
  const promptDirectory = contractPromptDirectory(contract);
  const queue = () => createQueue(path.join(output, args.mock === 'true' ? 'mock-review' : 'review'), data.datasetHash);
  if (command === 'review-export') return { file: queue().exportPackets() };
  if (command === 'review-import') { const imported = read(args.file); queue().importResults(imported.results, imported.attestation); return { imported: imported.results.length }; }
  if (command === 'status') return { datasetHash: data.datasetHash, alreadyExamined: true, counts: contract.counts,
    smoke: fs.existsSync(path.join(output, 'json-smoke.json')) ? read(path.join(output, 'json-smoke.json')) : 'pending',
    billing: read(path.join(read(path.join(output, 'authorization.local.json')).budgetDirectory, 'budget.json')),
    reviews: queue().snapshot().map(j => ({ resultId: j.resultId, state: j.state, gate: j.review?.gate })) };
  if (command === 'report') { const stage = args.stage || 'development'; if (!['development', 'regression', 'supplement'].includes(stage)) throw new Error('Use development, regression or supplement'); return retestReport(output, stage, args.mock === 'true'); }
  if (command === 'select') { smokePassed(output, contract); return require('./report.cjs').select(output, args.winner, promptDirectory); }
  if (command === 'mock') {
    const stage = args.stage || 'development'; if (!['development', 'regression', 'supplement'].includes(stage)) throw new Error('Unknown mock stage');
    const mock = require('./mock.cjs').createMock(data), engineConfig = { model: 'Yuchen1457-mortal-v4-582500', engineProfile: 'yuchen-582500', endpoint: 'http://127.0.0.1:17342/analyze', apiKey: 'mock-engine-secret' };
    const common = { output, winner: args.winner || 'r1-facts', engineConfig, fetchImpl: mock.fetch, mock: true, promptDirectory, developmentHistory: true };
    const result = stage === 'supplement' ? await require('./supplement.cjs').runSupplement({ ...common, regressionStage: 'regression' }) : await runStage({ ...common, stage });
    return { ...result, transports: mock.counts(), paidRequests: 0, compatibilityEvidence: false };
  }
  const engineConfig = engineConfiguration(args['engine-config']);
  if (command === 'cache-engines') return { cached: await cacheEngines({ output, engineConfig }) };
  if (command === 'smoke-json') return smokeJson({ output, engineConfig });
  smokePassed(output, contract);
  if (command === 'run-development') return runStage({ output, stage: 'development', engineConfig, promptDirectory, developmentHistory: true });
  if (command === 'run-regression') return runStage({ output, stage: 'regression', winner: args.winner, engineConfig, promptDirectory });
  if (command === 'run-supplement') {
    return require('./supplement.cjs').runSupplement({ output, winner: args.winner, engineConfig, promptDirectory, regressionStage: 'regression' });
  }
  throw new Error('Unknown retest command');
}
if (require.main === module) main(process.argv.slice(2)).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error('Retest blocked: ' + error.message + '. No automatic retry.'); process.exitCode = 1; });
module.exports = { main, prepare, verify, smokeJson, smokePassed, retestReport, engineConfiguration, promptDirectory, legacyPromptDirectory, contractPromptDirectory, COPIED };
