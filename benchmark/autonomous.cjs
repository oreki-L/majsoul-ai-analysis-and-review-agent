'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { compileSuite, stableHash } = require('./core.cjs');
const { freezeRun, verifyRun } = require('./freeze.cjs');
const { validatePolicy } = require('./runtime.cjs');
const { createReviewQueue } = require('./review.cjs');
const { acquireLock, journal } = require('./durable.cjs');
async function executeFrozen(output, options = {}) {
  const contract = verifyRun(output);
  if (path.resolve(__dirname) !== path.resolve(output, 'bundle', 'benchmark')) return require(path.join(output, 'bundle', 'benchmark', 'autonomous.cjs')).executeFrozen(output, options);
  const suite = compileSuite(path.join(output, 'bundle', contract.suite)), checkpoint = path.join(output, 'checkpoint.json');
  const execution = JSON.parse(fs.readFileSync(path.join(output, 'bundle', 'execution.json'), 'utf8'));
  if (execution.mode && execution.mode !== options.mode) throw new Error('Frozen mode mismatch');
  const queue = createReviewQueue(output, contract.hash, contract.reviewRules ? JSON.parse(fs.readFileSync(path.join(output, contract.reviewRules.path), 'utf8')) : undefined);
  const runner = require(path.join(output, 'bundle', 'benchmark', 'runner.cjs'));
  const state = await runner.runSuite(suite, { ...options, authorization: execution.authorization, budgetFile: execution.budgetFile, mode: options.mode ?? 'mock', checkpoint, resume: fs.existsSync(checkpoint) || fs.existsSync(path.join(output, 'events.jsonl')), autonomousPolicy: { ...contract.policy, policyHash: stableHash(contract.policy) }, onProgress: run => queue.sync(run) });
  try { queue.sync(state); } catch { state.reviewExportPending = true; } await refresh(output, state, queue);
  return state;
}
async function refresh(output, state = null, queue = null, labels = null) {
  const contract = verifyRun(output);
  if (path.resolve(__dirname) !== path.resolve(output, 'bundle', 'benchmark')) return require(path.join(output, 'bundle', 'benchmark', 'autonomous.cjs')).refresh(output, state, null, labels);
  state ??= journal(path.join(output, 'events.jsonl')).latestState();
  if (!state) throw new Error('No durable execution snapshot');
  queue ??= createReviewQueue(output, contract.hash, contract.reviewRules ? JSON.parse(fs.readFileSync(path.join(output, contract.reviewRules.path), 'utf8')) : undefined); try { queue.sync(state); } catch { state.reviewExportPending = true; }
  const { createReport, writeReport } = require('./report.cjs');
  labels ??= contract.evaluation ? JSON.parse(fs.readFileSync(path.join(output, contract.evaluation.path), 'utf8')) : null;
  const score = labels ? require('./scoring.cjs').scoreRun(state, labels) : null;
  const report = createReport(state, score); report.generatedAt = new Date().toISOString(); report.snapshotHash = stableHash(JSON.parse(JSON.stringify(state))); report.contractHash = contract.hash; report.reviewQueue = queue.snapshot(); report.schemeDescriptions = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(output, 'bundle', contract.suite), 'utf8')).schemes.map(s => [s.id, s.description ?? JSON.stringify(s.context)]));
  report.reviewExportPending = !!state.reviewExportPending;
  report.notifications = state.status === 'complete' ? [{ category: 'execution-complete', action: 'Import independent reviews; reconcile provider billing separately.' }] : [safeFailure(state.stopReason === 'budget' ? 'budget' : state.status.includes('config') ? 'configuration' : state.status.includes('persistence') ? 'disk' : state.status.includes('liability') ? 'liability' : 'model-output')];
  report.phases = { execution: state.status, review: !state.results.some(r => r.status === 'success' && !r.sourceFixture && !r.canonicalResultId) ? 'no-evaluable-answers' : !state.reviewExportPending && report.reviewQueue.length === state.results.filter(r => r.status === 'success' && !r.sourceFixture && !r.canonicalResultId).length && report.reviewQueue.every(j => j.state === 'complete') ? 'complete' : 'pending', billing: state.ledger?.billingUnknownLiability ? 'reconciliation-pending' : 'usage-estimated-not-provider-reconciled' };
  require('./dashboard.cjs').enrich(report, state);
  writeReport(output, report); require('./dashboard.cjs').writeDashboard(output, report);
  return report;
}
function safeFailure(category) {
  const actions = { budget: 'The frozen budget is insufficient. Preserve this run; reconcile usage and authorize a new run or explicit budget amendment before sending more requests.', configuration: 'Fix the affected credential/model configuration in a new frozen run. Do not borrow another scheme credential.', disk: 'Restore writable disk space and permissions, then resume the same frozen run. Do not delete response or ledger logs.', liability: 'An unknown dispatched charge has no verified full exposure hold. Reconcile the provider charge before continuing.', integrity: 'The frozen package, event log or replay input does not match. Preserve evidence and inspect the mismatch; no automatic replay.', network: 'The bounded recovery policy was exhausted. Restore connectivity and inspect durable attempt evidence.', 'model-output': 'Execution finished with failed answers. Original failures remain in the denominator; inspect supplemental results separately.' };
  return { category, recoveryAction: actions[category] ?? actions.integrity, at: new Date().toISOString() };
}
function classifyFailure(error) {
  const text = String(error?.message ?? '');
  return safeFailure(/budget/i.test(text) ? 'budget' : /space|disk|ENOSPC|EACCES|EPERM|persistence/i.test(text) ? 'disk' : /unknown|liability|covered/i.test(text) ? 'liability' : /credential|configuration|model|authorization/i.test(text) ? 'configuration' : 'integrity');
}
async function start(options) {
  const output = path.resolve(options.output), policy = validatePolicy(options.policy);
  if (!options.resume) freezeRun(path.resolve(options.suite), output, policy, { mode: options.mode, authorization: options.authorization ?? null, budgetFile: options.budgetFile ? path.resolve(options.budgetFile) : null, credentialsFile: options.credentialsFile ? path.resolve(options.credentialsFile) : null, reviewRules: options.reviewRules ?? null });
  const contract = verifyRun(output);
  const frozenExecution = JSON.parse(fs.readFileSync(path.join(output, 'bundle', 'execution.json'), 'utf8'));
  if (frozenExecution.mode && frozenExecution.mode !== options.mode || options.authorization && stableHash(options.authorization) !== stableHash(frozenExecution.authorization) || options.budgetFile && path.resolve(options.budgetFile) !== frozenExecution.budgetFile || options.credentialsFile && path.resolve(options.credentialsFile) !== frozenExecution.credentialsFile || options.resume && options.policy && Object.keys(options.policy).length && stableHash(policy) !== stableHash(contract.policy)) throw new Error('Frozen configuration override is not permitted');
  const release = acquireLock(path.join(output, 'supervisor.lock'), true), log = journal(path.join(output, 'supervisor.jsonl'));
  try {
    for (let attempt = 0;; attempt++) {
      log.write('worker-start', { attempt, mode: options.mode });
      const args = [path.join(output, 'bundle', 'benchmark', 'autonomous.cjs'), 'worker', output, options.mode ?? 'mock'];
      // Credentials are passed by reference only, never read by the supervisor.
      if (frozenExecution.credentialsFile) args.push(frozenExecution.credentialsFile);
      const result = await new Promise(resolve => {
        const child = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
        child.once('error', () => resolve({ code: null, reason: 'spawn-failed' }));
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      log.write('worker-exit', { attempt, ...result });
      if (result.code === 0) return refresh(output);
      if (result.code === 2) { if (fs.existsSync(path.join(output, 'worker.status.json'))) { const failure = JSON.parse(fs.readFileSync(path.join(output, 'worker.status.json'), 'utf8')); if (failure.failure) throw Object.assign(new Error(failure.failure.recoveryAction), { safeFailure: failure.failure }); } return refresh(output); }
      if (result.code === 2 || attempt >= contract.policy.maxRestarts) throw new Error('Execution blocked; inspect durable events and supervisor log. No automatic policy expansion.');
      await new Promise(resolve => setTimeout(resolve, contract.policy.restartDelayMs));
    }
  } finally { release(); }
}
module.exports = { start, executeFrozen, refresh, safeFailure, classifyFailure };
if (require.main === module && process.argv[2] === 'worker') {
  executeFrozen(path.resolve(process.argv[3]), { mode: process.argv[4], credentialsFile: process.argv[5] }).then(state => { process.exitCode = ['complete', 'finished-with-failures'].includes(state.status) ? 0 : 2; }).catch(error => { const failure = classifyFailure(error); try { require('./runner.cjs').saveAtomic(path.join(path.resolve(process.argv[3]), 'worker.status.json'), { failure }); } catch { /* Severe disk failure may prevent even the safe terminal marker. */ } process.stderr.write(JSON.stringify(failure) + '\n'); process.exitCode = 2; });
}
