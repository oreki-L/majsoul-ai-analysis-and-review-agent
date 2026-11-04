'use strict';
// Explicit offline integration check; excluded from ordinary *.test.js runs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createManager, startBridge } = require('../agent/model-manager.cjs');
const { createInstallation } = require('../agent/model-installation.cjs');
const { sampleRequest } = require('../agent/mortal-sample.cjs');
async function main(argv) {
  const options = {};
  while (argv.length) { const flag = argv.shift(); if (!['--root', '--toolkit', '--profile', '--out'].includes(flag) || !argv.length) throw new Error('INVALID_ARGUMENTS'); options[flag.slice(2)] = argv.shift(); }
  if (!options.root || !options.toolkit || !options.out) throw new Error('Explicit --root NEW_MANAGED_DIR --toolkit OFFLINE_TOOLKIT_DIR --out REPORT.json required');
  options.profile ||= 'voidshine-298k';
  try { await fs.access(options.root); throw new Error('VALIDATION_REQUIRES_NEW_ROOT'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let starts = 0, bridgeService;
  const manager = await createManager({ root: options.root, toolkit: options.toolkit, port: 0,
    installation: createInstallation({ root: options.root, toolkit: options.toolkit, download: async () => { throw new Error('OFFLINE_VALIDATION_NETWORK_REFUSED'); } }),
    bridgeFactory: async (...args) => { starts++; bridgeService = await startBridge(...args); return bridgeService; } });
  const timings = {}, base = 'http://127.0.0.1:' + manager.server.address().port;
  const api = async (url, method = 'GET') => { const response = await fetch(base + url, { method, headers: { Authorization: 'Bearer ' + manager.token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) }); const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value; };
  const operate = async (action, profile = options.profile) => {
    const started = Date.now(); await api(action === 'stop' ? '/api/stop' : `/api/models/${profile}/${action}`, 'POST');
    for (;;) { const status = await api('/api/status'); if (status.operation.state !== 'running') { assert.equal(status.operation.state, 'succeeded', JSON.stringify(status.operation)); timings[action] = Date.now() - started; return status; } await new Promise(r => setTimeout(r, 100)); }
  };
  const pids = [];
  try {
    assert.equal(starts, 0); assert.equal(manager.status().bridge.state, 'stopped');
    let status = await operate('install'); assert.equal(starts, 0); assert.ok(status.models.find(p => p.id === options.profile).installed);
    status = await operate('start'); if (bridgeService.pid) pids.push(bridgeService.pid);
    const response = await fetch(status.bridge.url, { method: 'POST', headers: { Authorization: 'Bearer ' + status.bridge.token, 'Content-Type': 'application/json' }, body: JSON.stringify(sampleRequest()) });
    const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.action.actor, 0); assert.equal(result.action.type, 'dahai');
    assert.notEqual(status.bridge.token, manager.token);
    await operate('stop');
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await operate('start'); if (bridgeService.pid) pids.push(bridgeService.pid);
    status = await operate('remove'); assert.equal(status.bridge.state, 'stopped'); assert.equal(status.models.find(p => p.id === options.profile).installed, false);
    const family = status.models.find(p => p.id === options.profile).runtimeFamily; assert.equal(status.runtimes.find(r => r.id === family).installed, true);
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const report = { profile: options.profile, offline: true, zeroStartupDownloadsAndInference: true, timings, action: result.action, identity: result.identity, starts, cleanedWorkerPids: pids, modelRemoved: true, runtimeRetained: true, completedAt: new Date().toISOString() };
    await fs.mkdir(path.dirname(options.out), { recursive: true }); await fs.writeFile(options.out, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  } finally { await manager.close(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e); process.exitCode = 1; });
