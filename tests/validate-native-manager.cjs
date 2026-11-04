'use strict';
// Explicit real-asset acceptance only; never loaded by npm test or app startup.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const { createInstallation, sha256 } = require('../agent/model-installation.cjs');
const { createManager, startBridge } = require('../agent/model-manager.cjs');
const source = require('../agent/akagi-native-source.json');
const catalog = require('../agent/mortal-catalog.json');
const native = 'akagi-v3-native';
async function main(argv) {
  const options = {};
  while (argv.length) {
    const flag = argv.shift();
    if (['--online', '--allow-pending-validation', '--with-legacy'].includes(flag)) { options[flag.slice(2)] = true; continue; }
    if (!['--root', '--toolkit', '--out'].includes(flag) || !argv.length) throw new Error('INVALID_ARGUMENTS');
    options[flag.slice(2)] = argv.shift();
  }
  if (!options.root || !options.out || (!options.online && !options.toolkit)) throw new Error('Required: --root ISOLATED_MANAGED_DIR --out REPORT.json (--toolkit DIR | --online) [--with-legacy] [--allow-pending-validation]');
  if (options.online && options.toolkit) throw new Error('ONLINE_VALIDATION_REFUSES_LOCAL_TOOLKIT');
  if (options.online) {
    if (options['with-legacy']) throw new Error('ONLINE_VALIDATION_REQUIRES_EMPTY_ROOT');
    try { if ((await fs.readdir(options.root)).length) throw new Error('ONLINE_VALIDATION_REQUIRES_EMPTY_ROOT'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assert.ok(source.runtime.archive?.sha256 && source.runtime.files.length, 'real runtime lock required; no invented source override');
  const profile = catalog.models.find(p => p.id === native), originalProfile = { ...profile };
  const pendingOverride = !profile.installable || !['verified-experimental', 'verified'].includes(profile.status);
  if (pendingOverride) {
    if (!options['allow-pending-validation']) throw new Error('PROFILE_NOT_VERIFIED');
    Object.assign(profile, { installable: true, status: 'verified-experimental' });
  }
  const installation = createInstallation({ root: options.root, toolkit: options.toolkit, ...(options.online ? {} : { download: async () => { throw new Error('OFFLINE_VALIDATION_NETWORK_REFUSED'); } }) });
  let manager, current, failure;
  const starts = [], operations = [], results = [];
  const report = { format: 'native-manager-real-acceptance-v1', root: installation.root, online: !!options.online, toolkit: options.toolkit || null, pendingCatalogOverride: pendingOverride, sourceOverride: false, sourceCommit: source.sourceCommit, runtimeId: source.runtime.id, runtimeBuildId: source.runtime.buildId, runtimeArchiveSha256: source.runtime.archive.sha256, binarySha256: source.runtime.files.find(file => file.name === source.runtime.executable)?.sha256, checkpointSha256: source.files.find(f => f.name === source.weightAsset).sha256 };
  const gone = pid => { if (pid) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); };
  async function api(url, method = 'POST') {
    const response = await fetch('http://127.0.0.1:' + manager.server.address().port + url, { method, headers: { Authorization: 'Bearer ' + manager.token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
    const body = await response.json(); assert.ok(response.ok, JSON.stringify(body)); return body;
  }
  async function operate(action, id) {
    const began = Date.now(); await api(action === 'stop' ? '/api/stop' : `/api/models/${id}/${action}`);
    for (let poll = 0; poll < 10000; poll++) {
      const state = await api('/api/status', 'GET');
      if (state.operation.state !== 'running') {
        assert.equal(state.operation.state, 'succeeded', JSON.stringify(state.operation));
        operations.push({ action, profile: id || null, elapsedMs: Date.now() - began }); return state;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('MANAGER_OPERATION_TIMEOUT');
  }
  async function infer(id) {
    const status = manager.status(); assert.equal(status.runningModelId, id);
    assert.equal(status.models.filter(model => model.state === 'running').length, 1);
    const request = id === 'akagi-v2' ? require('../agent/akagi-local.cjs').sampleRequest() : require('../agent/mortal-sample.cjs').sampleRequest();
    const response = await fetch(status.bridge.url, { method: 'POST', headers: { Authorization: 'Bearer ' + status.bridge.token, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.action.type, 'dahai'); assert.equal(result.action.actor, request.seat);
    const own = request.events[1].tehais[request.seat].concat(request.events.at(-1).pai); assert.ok(own.includes(result.action.pai));
    const expected = installation.sourceFor(id); assert.equal(result.identity.model, id === 'akagi-v2' ? expected.profile : expected.model);
    if (id === native) assert.deepEqual(result.identity, require('../agent/akagi-native-local.cjs').identity());
    results.push({ profile: id, identity: result.identity, action: result.action });
  }
  try {
    manager = await createManager({ installation, port: 0, bridgeFactory: async (...args) => {
      gone(current?.pid);
      const stages = [], callback = args[3].onStage;
      args[3] = { onStage(stage) { stages.push(stage); callback(stage); } };
      current = await startBridge(...args); starts.push({ profile: args[1], pid: current.pid || null, stages }); return current;
    } });
    assert.equal(manager.status().bridge.state, 'stopped');
    assert.equal(manager.status().models.find(p => p.id === native).installed, false, 'use a root without installed v3 weights');
    const legacy = options['with-legacy'] ? ['yuchen-582500', 'voidshine-298k', 'akagi-v2'] : [];
    for (const id of legacy) assert.equal(manager.status().models.find(p => p.id === id).installed, true, 'prepare legacy assets first');
    const retained = [];
    for (const id of legacy) retained.push({ id, modelMarker: await sha256(path.join(installation.modelDir(id), 'managed-install.json')), runtimeMarker: await sha256(path.join(installation.runtimeDir(id), 'managed-runtime.json')) });
    await operate('install', native); assert.equal(starts.length, 0, 'install must not run inference');
    const nativeMarker = await sha256(path.join(installation.runtimeDir(native), 'managed-runtime.json'));
    await operate('start', native); await infer(native);
    for (const id of legacy) { await operate('start', id); await infer(id); await operate('start', native); await infer(native); }
    await operate('stop'); gone(current.pid);
    await operate('remove', native);
    assert.equal(manager.status().models.find(p => p.id === native).installed, false);
    assert.equal(manager.status().runtimes.find(r => r.id === source.runtime.id).installed, true);
    assert.equal(await sha256(path.join(installation.runtimeDir(native), 'managed-runtime.json')), nativeMarker);
    await installation.verifyRuntime(native);
    for (const before of retained) {
      assert.equal((await installation.inspect(before.id)).installed, true);
      assert.equal(await sha256(path.join(installation.modelDir(before.id), 'managed-install.json')), before.modelMarker);
      assert.equal(await sha256(path.join(installation.runtimeDir(before.id), 'managed-runtime.json')), before.runtimeMarker);
    }
    Object.assign(report, { success: true, modelsCoexisted: legacy.length > 0, singleModelAtATime: true, nativeRemoved: true, runtimesRetained: true, legacyUnchanged: legacy.length ? true : null });
  } catch (error) { failure = error; Object.assign(report, { success: false, failure: error.code || error.message }); }
  finally {
    try {
      if (manager) await manager.close();
      for (const entry of starts) gone(entry.pid);
      report.processesCleaned = true;
    } catch (error) {
      failure ||= error;
      Object.assign(report, { success: false, processesCleaned: false, cleanupFailure: error.code || error.message });
    }
    Object.assign(profile, originalProfile);
    Object.assign(report, { operations, starts, results, completedAt: new Date().toISOString() });
    await fs.writeFile(options.out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  }
  if (failure) throw failure;
}
module.exports = { main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
