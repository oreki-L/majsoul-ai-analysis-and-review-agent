'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { createCredentialResolver } = require('../accounting.cjs');
const { prepareDataset, checkDataset } = require('./dataset.cjs');
const { loadPrompts, sha256 } = require('./prompts.cjs');
const { createQueue, RULES } = require('./review.cjs');
const { read, freeze, runStage, cacheEngines } = require('./runner.cjs');
const { createMock } = require('./mock.cjs');
const { FILES } = require('./harness.cjs');
function fingerprint() {
  return Object.fromEntries([...FILES.map(f => path.resolve(__dirname, '../../extension', f)),
    'extension/round-context.js', 'extension/decision-discussions.js', 'benchmark/accounting.cjs', 'benchmark/durable.cjs', 'benchmark/core.cjs',
    ...fs.readdirSync(__dirname).filter(f => f.endsWith('.cjs')).map(f => path.join(__dirname, f))]
    .map(f => { const absolute = path.resolve(__dirname, '../..', f); return [path.relative(path.resolve(__dirname, '../..'), absolute).replace(/\\/g, '/'), sha256(fs.readFileSync(absolute))]; }));
}
async function main(argv) {
  const [command, ...rest] = argv, args = {};
  for (let i = 0; i < rest.length; i += 2) { if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new Error('Expected --name value'); args[rest[i].slice(2)] = rest[i + 1]; }
  if (!args.out) throw new Error('Required: --out EVIDENCE_DIRECTORY');
  const output = path.resolve(args.out);
  if (command === 'prepare') {
    if (!args.evidence || !args.credentials || !args['pricing-html']) throw new Error('prepare requires --evidence --credentials --pricing-html');
    const data = await prepareDataset(path.resolve(args.evidence)), prompts = loadPrompts();
    const history = require('./history.cjs').prepareHistory(path.resolve(args.evidence), data);
    const html = fs.readFileSync(args['pricing-html']);
    const text = html.toString('utf8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    // This dated price contract is deliberately not a generic HTML price parser.
    for (const value of ['deepseek-flash', 'DeepSeek-V4.1-Flash-1017', '1M', '0.04元', '2元', '8元']) if (!text.includes(value)) throw new Error('Expected published pricing evidence not found');
    const authorization = { manifestId: 'mortal-teaching-20261105', approved: true, cap: 50, currency: 'CNY',
      approvalSource: 'User: 本轮费用上限50元，用之前配置好的api key',
      allowedReferences: ['group:G'], credentialsFile: path.resolve(args.credentials),
      budgetDirectory: path.resolve(output, '../billing'),
      scope: 'all paid teaching, continuation, retry, follow-up and API review attempts in this round; no old budget reuse; no credential rotation',
      reviewExecution: 'export/import gpt-6.1-sol medium; a paid evaluator adapter requires frozen CNY rates and admission through this same total budget' };
    const key = await createCredentialResolver({ credentialsFile: authorization.credentialsFile, authorization })('group:G');
    if (!key) throw new Error('Previously configured credential unavailable');
    const pricing = { model: 'deepseek-flash', modelVersion: 'DeepSeek-V4.1-Flash-1017', endpoint: 'https://api.deepseek.com/chat/completions',
      currency: 'CNY', rates: { cachedInput: 0.04, uncachedInput: 2, output: 8, unit: 'perMillion' }, inputBound: 1048576, maxOutputTokens: 4096,
      sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing', sourceSha256: sha256(html),
      pricingBasis: '2026-11-05 verified peak upper-rate estimate, not provider bill; no independent Search/Fetch API',
      fullContextReservationCny: 2.12992 };
    freeze(path.join(output, 'dataset.json'), data);
    freeze(path.join(output, 'history-xf.json'), history);
    const supplementPlan = require('./supplement.cjs').supplementPlan(data);
    freeze(path.join(output, 'supplement-plan.json'), supplementPlan);
    freeze(path.join(output, 'authorization.local.json'), authorization);
    freeze(path.join(output, 'pricing.json'), pricing);
    const code = fingerprint(), batchId = stableHash({ datasetHash: data.datasetHash, manifestHash: prompts.manifestHash, code }).slice(0, 16);
    freeze(path.join(output, 'contract.json'), { batchId, datasetHash: data.datasetHash, manifestHash: prompts.manifestHash, rulesHash: stableHash(RULES), code,
      authorizationHash: stableHash(authorization), pricingHash: stableHash(pricing), historyHash: history.historyHash,
      supplementPlanHash: stableHash(supplementPlan),
      sampling: { temperature: 0, maxTokens: 4096, thinking: false }, runtime: 'released product Worker + Pi 1.4.0; replay simulation; benchmark-only prompt substitution',
      historicalControl: 'X-F original first pass only; no concurrent pure LLM',
      openingCompatibility: 'deferred; never bypass validation' });
    const budget = require('./budget.cjs').openBudget({ directory: authorization.budgetDirectory, authorization, pricing,
      fetchImpl: async () => { throw new Error('Preparation must never dispatch'); } });
    budget.close();
    return { prepared: true, total: data.nodes.length, compatible: data.nodes.filter(n => n.compatible).length,
      development: data.nodes.filter(n => n.compatible && n.split === 'development').length,
      validation: data.nodes.filter(n => n.compatible && n.split === 'validation').length,
      historicalXf: { opportunities: history.rows.length, delivered: history.rows.filter(r => r.answer).length, repeatedAnswersUsed: 0 },
      credentialResolvable: true, credentialValuesCopied: false, paidRequests: 0, capCny: 50 };
  }
  const data = checkDataset(read(path.join(output, 'dataset.json')));
  const contract = read(path.join(output, 'contract.json'));
  if (contract.datasetHash !== data.datasetHash || contract.manifestHash !== loadPrompts().manifestHash || contract.rulesHash !== stableHash(RULES) || contract.authorizationHash !== stableHash(read(path.join(output, 'authorization.local.json'))) || contract.pricingHash !== stableHash(read(path.join(output, 'pricing.json')))) throw new Error('Frozen input/prompt/rules/pricing contract changed');
  if (contract.supplementPlanHash !== stableHash(read(path.join(output, 'supplement-plan.json')))) throw new Error('Frozen supplemental sample or questions changed');
  if (command === 'report') return require('./report.cjs').buildReport(output, args.stage || 'development', args.mock === 'true');
  if (command === 'select') return require('./report.cjs').select(output, args.winner);
  if (command === 'review-history') {
    const history = read(path.join(output, 'history-xf.json')), { historyHash, ...body } = history;
    if (stableHash(body) !== historyHash || historyHash !== contract.historyHash || history.datasetHash !== data.datasetHash) throw new Error('Historical source hash mismatch');
    const queue = createQueue(path.join(output, 'review'), data.datasetHash);
    for (const row of history.rows) if (row.answer) queue.add({ resultId: 'history:' + row.nodeId, answer: row.answer, facts: row.facts });
    return { firstPassAnswers: history.rows.filter(r => r.answer).length, file: queue.exportPackets(), originalScoresPreserved: true };
  }
  if (command === 'review-export') return { file: createQueue(path.join(output, 'review'), data.datasetHash).exportPackets() };
  if (command === 'review-import') {
    const imported = read(args.file), queue = createQueue(path.join(output, 'review'), data.datasetHash);
    queue.importResults(imported.results, imported.attestation); return { imported: imported.results.length };
  }
  if (command === 'status') {
    const f = path.join(read(path.join(output, 'authorization.local.json')).budgetDirectory, 'budget.json');
    return { datasetHash: data.datasetHash, planned: data.nodes.length, compatible: data.nodes.filter(n => n.compatible).length, billing: fs.existsSync(f) ? read(f) : { cap: 50, currency: 'CNY', paidAttempts: 0, estimatedCost: 0 }, reviews: createQueue(path.join(output, 'review'), data.datasetHash).snapshot().map(j => ({ resultId: j.resultId, state: j.state, gate: j.review?.gate })) };
  }
  if (stableHash(contract.code) !== stableHash(fingerprint())) throw new Error('Prepared runtime code changed; create a new preparation directory');
  if (command === 'mock') {
    const mock = createMock(data), engineConfig = { model: 'Yuchen1457-mortal-v4-582500', engineProfile: 'yuchen-582500', endpoint: 'http://127.0.0.1:17342/analyze', apiKey: 'mock-engine-secret' };
    const result = args.stage === 'supplement' ? await require('./supplement.cjs').runSupplement({ output, winner: args.winner || 'p1-grounding', engineConfig, fetchImpl: mock.fetch, mock: true })
      : await runStage({ output, stage: args.stage || 'development', winner: args.winner || 'p1-grounding', engineConfig, fetchImpl: mock.fetch, mock: true });
    return { ...result, transports: mock.counts(), paidRequests: 0 };
  }
  if (!args['engine-config']) throw new Error('Requires --engine-config PRIVATE_JSON (endpoint/model/engineProfile/apiKey); do not put token in command line');
  const engineConfig = read(args['engine-config']);
  const url = new URL(engineConfig.endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/analyze' || !engineConfig.apiKey) throw new Error('Expected authenticated loopback engine');
  if (command === 'cache-engines') return { cached: await cacheEngines({ output, engineConfig }) };
  if (command === 'run-development') return runStage({ output, stage: 'development', engineConfig });
  if (command === 'run-validation') return runStage({ output, stage: 'validation', winner: args.winner, engineConfig });
  if (command === 'run-supplement') return require('./supplement.cjs').runSupplement({ output, winner: args.winner, engineConfig });
  throw new Error('Commands: prepare, mock, cache-engines, run-development, run-validation, run-supplement, report, select, review-export, review-import, review-history, status');
}
if (require.main === module) main(process.argv.slice(2)).then(value => console.log(JSON.stringify(value, null, 2))).catch(() => { console.error('Experiment command failed; inspect the frozen contract, inputs and retained evidence. No automatic retry.'); process.exitCode = 1; });
module.exports = { main, fingerprint };
