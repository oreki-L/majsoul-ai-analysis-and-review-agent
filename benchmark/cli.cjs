#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compileSuite } = require('./core.cjs');
const { runSuite, dryRun, loadCheckpoint } = require('./runner.cjs');
const { loadLabels, scoreRun } = require('./scoring.cjs');
const { createReport, writeReport } = require('./report.cjs');
const HELP = `Usage: node benchmark/cli.cjs <command> [options]
  validate --suite FILE               Validate only; no network or credentials
  dry-run --suite FILE                Compile balanced causal schedule, no requests
  run --suite FILE --mock             Explicit synthetic execution
  run --suite FILE --live             Explicit paid execution (cap/rates/limits required)
  resume --suite FILE --mock|--live    Resume exact manifest, never replay pending HTTP
  score --checkpoint FILE --labels FILE [--human FILE]
  report --checkpoint FILE [--labels FILE] [--human FILE]
  contract-hash --contract FILE       Validate offline verified ceiling proof and print SHA256
  autonomous --suite FILE --mock|--live --out DIR [--policy FILE] [--review-rules FILE]
  autonomous-resume --mock|--live --out DIR
  review-import --out DIR --human FILE [--labels FILE]
  autonomous-report --out DIR [--labels FILE]
  summary-jobs --jobs FILE --mock|--live --out DIR [--resume]
Options: --out DIR (default research/evidence/benchmark/<suite-id>)
         --checkpoint FILE --credentials FILE (only read during --live requests)
         --budget-file FILE (one cumulative ledger shared across campaign stages)
         --authorization FILE (explicit scoped credential-reference authorization)
         --campaign-kind KIND (main/shared-setup/probe/branch/global attribution)
         --fixed-source FILE (actual frozen shared-source answers for branch/global)
         --seed-branches FILE (actual frozen shared raw QA prefix, controlled branch only)
Autonomous execution freezes independent labels separately from the model runtime package.
Every scheme is configurable; a trusted context.module may extend the builder.
The current 32 realtime / 5 branch / 3 global campaign is NOT frozen by this engine.
Production B-current/full state adapters require an explicit trusted plugin.
Mock is synthetic, scores are reference agreement, and costs are estimates.
`;
function parseArgs(args) { const parsed = { command: args[0] }; for (let i = 1; i < args.length; i++) { const arg = args[i]; if (!arg.startsWith('--')) throw new Error('Expected named option'); const k = arg.slice(2); if (['mock', 'live', 'help', 'resume'].includes(k)) parsed[k] = true; else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value'); parsed[k] = args[++i]; } } return parsed; }
async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args[0] === 'help') { console.log(HELP); return; }
  const a = parseArgs(args);
  if (a.command === 'contract-hash') { if (!a.contract) throw new Error('--contract FILE required'); const proof = JSON.parse(fs.readFileSync(a.contract, 'utf8')); require('./runtime.cjs').validateLiabilityProof(proof); console.log(require('./core.cjs').stableHash(proof)); return; }
  if (['autonomous', 'autonomous-resume'].includes(a.command)) {
    if (Boolean(a.mock) === Boolean(a.live) || !a.out || a.command === 'autonomous' && !a.suite) throw new Error('Autonomous execution requires --out, suite on first start, and explicit mode');
    const report = await require('./autonomous.cjs').start({ suite: a.suite, output: a.out, mode: a.live ? 'live' : 'mock', resume: a.command === 'autonomous-resume', credentialsFile: a.credentials, authorization: a.authorization ? JSON.parse(fs.readFileSync(a.authorization, 'utf8')) : undefined, budgetFile: a['budget-file'], reviewRules: a['review-rules'] ? JSON.parse(fs.readFileSync(a['review-rules'], 'utf8')) : undefined, policy: a.policy ? JSON.parse(fs.readFileSync(a.policy, 'utf8')) : {} });
    console.log(JSON.stringify({ phases: report.phases, out: path.resolve(a.out) })); return;
  }
  if (['review-import', 'autonomous-report'].includes(a.command)) {
    if (!a.out) throw new Error('--out run directory required');
    const output = path.resolve(a.out), contract = require('./freeze.cjs').verifyRun(output);
    const release = require('./durable.cjs').acquireLock(path.join(output, 'review.lock'), true);
    try {
      const queue = require('./review.cjs').createReviewQueue(output, contract.hash);
      if (a.command === 'review-import') { if (!a.human) throw new Error('--human independent review file required'); queue.importResults(JSON.parse(fs.readFileSync(a.human, 'utf8')).results); }
      await require('./autonomous.cjs').refresh(output, null, queue, a.labels ? loadLabels(a.labels) : null);
    } finally { release(); }
    console.log('Report refreshed: ' + path.join(output, 'report.html')); return;
  }
  if (a.command === 'summary-jobs') {
    if (!a.jobs || Boolean(a.mock) === Boolean(a.live)) throw new Error('Summary jobs require --jobs and explicit mode');
    const state = await require('./job-runner.cjs').runJobs(JSON.parse(fs.readFileSync(a.jobs, 'utf8')), { mode: a.live ? 'live' : 'mock', output: a.out, resume: !!a.resume, credentialsFile: a.credentials, budgetFile: a['budget-file'] ? path.resolve(a['budget-file']) : undefined, authorization: a.authorization ? JSON.parse(fs.readFileSync(a.authorization, 'utf8')) : undefined });
    console.log(JSON.stringify({ status: state.status, summaries: state.results.length, synthetic: state.synthetic })); return;
  }
  if (['score', 'report'].includes(a.command)) {
    if (!a.checkpoint) throw new Error('--checkpoint required');
    const run = loadCheckpoint(path.resolve(a.checkpoint));
    const human = a.human ? JSON.parse(fs.readFileSync(a.human, 'utf8')) : null;
    const score = a.labels ? scoreRun(run, loadLabels(a.labels), { human }) : null;
    if (a.command === 'score') { if (!score) throw new Error('--labels required'); const out = path.resolve(a.out ?? path.dirname(a.checkpoint)); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'score.json'), JSON.stringify(score, null, 2) + '\n'); console.log(JSON.stringify(score, null, 2)); }
    else { const out = path.resolve(a.out ?? path.dirname(a.checkpoint)); writeReport(out, createReport(run, score)); console.log('Report written: ' + path.join(out, 'report.md')); }
    return;
  }
  if (!['validate', 'dry-run', 'run', 'resume'].includes(a.command)) throw new Error('Unknown command');
  if (!a.suite) throw new Error('--suite required');
  const suite = compileSuite(path.resolve(a.suite));
  if (a.command === 'validate') { console.log(JSON.stringify({ valid: true, suiteId: suite.id, schemes: suite.schemes.length, decisions: suite.dataset.rounds.reduce((n, r) => n + r.decisions.length, 0), network: false, credentialsRead: false })); return; }
  if (a.command === 'dry-run') { console.log(JSON.stringify(dryRun(suite), null, 2)); return; }
  if (Boolean(a.mock) === Boolean(a.live)) throw new Error('Choose exactly one of --mock or --live');
  const out = path.resolve(a.out ?? path.join('research/evidence/benchmark', suite.id));
  const source = a['fixed-source'] ? JSON.parse(fs.readFileSync(a['fixed-source'], 'utf8')) : null;
  if (source && (source.synthetic || !source.sourceAnswersFrozen || !source.answers)) throw new Error('Only actual frozen source answers can be used as fixed main fixtures');
  const seeds = a['seed-branches'] ? JSON.parse(fs.readFileSync(a['seed-branches'], 'utf8')) : null;
  if (seeds && (seeds.synthetic || !seeds.sourceQaFrozen || !seeds.branches || !source || seeds.sourceFreezeHash !== require('./core.cjs').stableHash(source))) throw new Error('Seeded branches require matching actual source QA and original answer freeze');
  const state = await runSuite(suite, { mode: a.live ? 'live' : 'mock', resume: a.command === 'resume', checkpoint: path.resolve(a.checkpoint ?? path.join(out, 'checkpoint.json')), credentialsFile: a.credentials, budgetFile: a['budget-file'] ? path.resolve(a['budget-file']) : undefined, authorization: a.authorization ? JSON.parse(fs.readFileSync(a.authorization, 'utf8')) : undefined, campaignKind: a['campaign-kind'], fixedMainAnswers: source?.answers, seededBranches: seeds?.branches });
  writeReport(out, createReport(state));
  console.log(JSON.stringify({ status: state.status, synthetic: state.manifest.synthetic, results: state.results.length, modelRequests: state.modelRequests, estimatedCost: state.ledger.estimatedCost, out }));
}
module.exports = { main, parseArgs, HELP };
if (require.main === module) main().catch(error => { console.error(error.safeFailure ? JSON.stringify(error.safeFailure) : error.code === 'BENCHMARK_LOCKED' ? 'Benchmark checkpoint is locked. Reconcile pending requests before manually removing a stale lock.' : 'Benchmark failed. Check suite, explicit mode, budget and private checkpoint; pending HTTP is never replayed.'); process.exitCode = 1; });
