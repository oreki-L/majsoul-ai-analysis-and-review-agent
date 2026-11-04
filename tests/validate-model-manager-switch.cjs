'use strict';
// Explicit offline, multi-model acceptance; never runs with npm test.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createManager, startBridge } = require('../agent/model-manager.cjs');
const { createInstallation, sha256 } = require('../agent/model-installation.cjs');
const { sampleRequest } = require('../agent/mortal-sample.cjs');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const profiles = ['yuchen-582500', 'voidshine-298k', 'akagi-v2'];
async function main(argv) {
  const options = {};
  while (argv.length) { const flag = argv.shift(); if (!['--root', '--toolkit', '--out', '--seed-runtime', '--mode'].includes(flag) || !argv.length) throw new Error('INVALID_ARGUMENTS'); options[flag.slice(2)] = argv.shift(); }
  if (!options.root || !options.toolkit || !options.out || !['prepare', 'verify'].includes(options.mode)) throw new Error('Required: --mode prepare|verify --root DIR --toolkit OFFLINE_DIR --out REPORT.json [--seed-runtime EXISTING_V4_RUNTIME_DIR]');
  const installation = createInstallation({ root: options.root, toolkit: options.toolkit, download: async () => { throw new Error('OFFLINE_VALIDATION_NETWORK_REFUSED'); } });
  if (options.mode === 'prepare' && options['seed-runtime']) {
    const target = path.dirname(path.dirname(installation.pythonFor('voidshine-298k')));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(options['seed-runtime'], target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    await installation.verifyRuntime('voidshine-298k');
  }
  let latestBridge = null;
  const starts = [], operations = [];
  const managedPythonPids = async () => {
    if (process.platform !== 'win32') return null;
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    const command = `$needle=${quote(path.resolve(options.root))}; @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`;
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000 });
    const value = stdout.trim() ? JSON.parse(stdout) : []; return Array.isArray(value) ? value : [value];
  };
  const manager = await createManager({ port: 0, installation, bridgeFactory: async (...args) => {
    for (const previous of starts.filter(s => s.pid)) assert.throws(() => process.kill(previous.pid, 0), { code: 'ESRCH' }, 'previous worker must be gone before starting replacement');
    const stages = [], original = args[3]?.onStage;
    args[3] = { onStage(stage) { stages.push({ stage, at: Date.now() }); original?.(stage); } };
    latestBridge = await startBridge(...args); starts.push({ profile: args[1], pid: latestBridge.pid || null, stages }); return latestBridge;
  } });
  const base = 'http://127.0.0.1:' + manager.server.address().port;
  const api = async (url, method = 'GET') => {
    const response = await fetch(base + url, { method, headers: { Authorization: 'Bearer ' + manager.token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  };
  const operate = async (action, profile) => {
    const started = Date.now(); await api(action === 'stop' ? '/api/stop' : `/api/models/${profile}/${action}`, 'POST');
    for (;;) { const status = await api('/api/status'); if (status.operation.state !== 'running') { assert.equal(status.operation.state, 'succeeded', JSON.stringify(status.operation)); operations.push({ action, profile: profile || null, elapsedMs: Date.now() - started }); return status; } await new Promise(r => setTimeout(r, 100)); }
  };
  const runtimeSnapshot = async profile => {
    const root = path.dirname(path.dirname(installation.pythonFor(profile))), marker = path.join(root, 'managed-runtime.json');
    const stat = await fs.stat(marker); return { root, markerHash: await sha256(marker), markerMtimeMs: stat.mtimeMs, pythonHash: await sha256(installation.pythonFor(profile)), pythonMtimeMs: (await fs.stat(installation.pythonFor(profile))).mtimeMs };
  };
  const infer = async expected => {
    const status = await api('/api/status'); assert.equal(status.bridge.state, 'running'); assert.equal(status.bridge.profile, expected);
    assert.equal(status.models.filter(p => p.state === 'running').length, 1);
    const sample = expected === 'akagi-v2' ? require('../agent/akagi-local.cjs').sampleRequest() : sampleRequest();
    const response = await fetch(status.bridge.url, { method: 'POST', headers: { Authorization: 'Bearer ' + status.bridge.token, 'Content-Type': 'application/json' }, body: JSON.stringify(sample) });
    const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.action.type, 'dahai'); assert.equal(result.action.actor, 0);
    const source = installation.sourceFor(expected); assert.equal(result.identity.model, expected === 'akagi-v2' ? source.profile : source.model);
    const pids = await managedPythonPids(); if (pids) assert.equal(pids.length, expected === 'akagi-v2' ? 0 : 1, 'v2 request must finish cleanup; v4 has exactly one persistent worker');
    return { profile: expected, identity: result.identity, action: result.action, activeWorkerPids: pids };
  };
  try {
    assert.equal(manager.status().bridge.state, 'stopped');
    if (options.mode === 'prepare') {
      for (const profile of profiles) { if (!manager.status().models.find(p => p.id === profile).installed) await operate('install', profile); }
      assert.equal(starts.length, 0);
      const report = { mode: 'prepare', offline: true, noInference: true, operations, runtimeV4: await runtimeSnapshot('voidshine-298k'), runtimeV2: await runtimeSnapshot('akagi-v2'), models: manager.status().models.map(p => ({ id: p.id, installed: p.installed })) };
      await fs.writeFile(options.out, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); return;
    }
    for (const profile of profiles) assert.equal(manager.status().models.find(p => p.id === profile).installed, true);
    const runtimeBefore = await runtimeSnapshot('voidshine-298k'), runtimeV2 = await runtimeSnapshot('akagi-v2'); assert.notEqual(runtimeBefore.root, runtimeV2.root);
    const results = [];
    await operate('start', 'yuchen-582500'); results.push(await infer('yuchen-582500'));
    await operate('start', 'voidshine-298k'); results.push(await infer('voidshine-298k'));
    assert.ok(manager.status().models.filter(p => ['voidshine-298k', 'yuchen-582500'].includes(p.id)).every(p => p.installed));
    await operate('remove', 'yuchen-582500'); results.push(await infer('voidshine-298k'));
    await operate('stop'); await operate('start', 'voidshine-298k'); results.push(await infer('voidshine-298k'));
    assert.deepEqual(await runtimeSnapshot('voidshine-298k'), runtimeBefore);
    await operate('start', 'akagi-v2'); results.push(await infer('akagi-v2'));
    await operate('remove', 'akagi-v2'); assert.equal(manager.status().bridge.state, 'stopped');
    assert.equal(manager.status().models.find(p => p.id === 'voidshine-298k').installed, true);
    await operate('start', 'voidshine-298k'); results.push(await infer('voidshine-298k')); await operate('remove', 'voidshine-298k');
    assert.deepEqual(await runtimeSnapshot('voidshine-298k'), runtimeBefore); assert.deepEqual(await runtimeSnapshot('akagi-v2'), runtimeV2);
    for (const entry of starts.filter(s => s.pid)) assert.throws(() => process.kill(entry.pid, 0), { code: 'ESRCH' });
    const remainingPythonPids = await managedPythonPids(); if (remainingPythonPids) assert.deepEqual(remainingPythonPids, []);
    assert.ok(manager.status().runtimes.filter(r => r.models.some(id => profiles.includes(id))).every(r => r.installed));
    const report = { mode: 'verify', offline: true, profiles, operations, results, starts, runtimeBefore, runtimeAfter: await runtimeSnapshot('voidshine-298k'), v2Runtime: runtimeV2, runtimeUnchanged: true, modelsCoexisted: true, singleModelAtATime: true, deletedModelDidNotAffectRemaining: true, allWeightsRemoved: true, runtimesRetained: true, remainingPythonPids, completedAt: new Date().toISOString() };
    await fs.writeFile(options.out, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  } finally { await manager.close(); }
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e); process.exitCode = 1; });
