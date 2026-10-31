'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
async function runScale(output, { points = 120 } = {}) {
  if (!Number.isSafeInteger(points) || points < 100 || points > 2000) throw new Error('Scale smoke requires 100..2000 synthetic points');
  const suite = require('./core.cjs').compileSuite(path.join(__dirname, 'examples/suite.mock.json'));
  suite.id = 'synthetic-scale-' + points; suite.schemes = [suite.schemes[0]]; suite.execution.concurrency = 1; suite.execution.maxModelRequests = null; suite.execution.timeoutMs = 60000;
  const round = suite.dataset.rounds[0], template = round.decisions[0];
  round.globalTasks = []; round.events = [];
  round.decisions = Array.from({ length: points }, (_, i) => { const node = structuredClone(template); node.id = 'synthetic-scale-' + i; node.position = i + 1; node.snapshot.lastStep = i + 1; node.followups = []; return node; }); suite.dataset.rounds = [round];
  fs.mkdirSync(output, { recursive: true });
  const filename = name => path.join(output, name), size = name => fs.existsSync(filename(name)) ? fs.statSync(filename(name)).size : 0;
  let halfway = null; const start = performance.now(), rssBefore = process.memoryUsage().rss;
  const state = await require('./runner.cjs').runSuite(suite, { mode: 'mock', checkpoint: filename('checkpoint.json'), autonomousPolicy: require('./runtime.cjs').validatePolicy(), onProgress(run) { if (run.results.length === Math.floor(points / 2)) halfway = { eventBytes: size('events.jsonl'), objectBytes: size('events.jsonl.objects.jsonl'), rssBytes: process.memoryUsage().rss }; } });
  const resumeStarted = performance.now(); const resumed = await require('./runner.cjs').runSuite(suite, { mode: 'mock', checkpoint: filename('checkpoint.json'), resume: true, autonomousPolicy: require('./runtime.cjs').validatePolicy(), fetch: () => { throw new Error('Resume must not dispatch'); } }); if (resumed.results.length !== points) throw new Error('Scale resume lost results');
  const metrics = { resumeElapsedMs: performance.now() - resumeStarted, resumedResults: resumed.results.length, synthetic: true, points, completed: state.results.filter(r => r.status === 'success').length, elapsedMs: performance.now() - start, eventBytes: size('events.jsonl'), objectBytes: size('events.jsonl.objects.jsonl'), checkpointBytes: size('checkpoint.json'), rssBefore, rssAfter: process.memoryUsage().rss, peakRssBytes: process.resourceUsage().maxRSS * 1024, halfway, storageContract: 'Merkle objects stored once; state events contain only roots; checkpoint at 25 results or 10 seconds and start/final.' };
  metrics.logToCheckpointRatio = (metrics.eventBytes + metrics.objectBytes) / metrics.checkpointBytes;
  metrics.secondHalfGrowth = halfway ? (metrics.eventBytes + metrics.objectBytes) / (halfway.eventBytes + halfway.objectBytes) : null;
  fs.writeFileSync(filename('scale-metrics.json'), JSON.stringify(metrics, null, 2) + '\n'); return metrics;
}
module.exports = { runScale };
if (require.main === module) runScale(path.resolve(process.argv[2] ?? 'research/evidence/benchmark/scale-' + Date.now()), { points: Number(process.argv[3] ?? 120) }).then(metrics => console.log(JSON.stringify(metrics))).catch(() => { console.error('Synthetic scale smoke failed; inspect its dedicated output directory.'); process.exitCode = 1; });
