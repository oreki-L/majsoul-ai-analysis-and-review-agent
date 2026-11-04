'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createManager } = require('../agent/model-manager.cjs');
const { createInstallation, verifyOwned, inventory, sha256, run } = require('../agent/model-installation.cjs');
function request(manager, method, url, { token = manager.token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: manager.server.address().port, method, path: url, headers: { Authorization: 'Bearer ' + token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => { let value; try { value = JSON.parse(text); } catch { value = text; } resolve({ code: res.statusCode, value, headers: res.headers }); });
    }); req.on('error', reject); req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
async function fixture(t, overrides = {}) {
  const states = new Map(); let installs = 0, removes = 0, starts = 0, stops = 0;
  const installation = { root: 'managed-test-root', sourceFor: () => ({}), async inspect(id) { return { installed: states.get(id) || false, state: states.get(id) ? 'installed' : 'not-installed', error: null }; },
    async install(id, options) { installs++; if (overrides.install) await overrides.install(options); states.set(id, true); }, async remove(id) { removes++; states.delete(id); } };
  const manager = await createManager({ port: 0, installation, bridgeFactory: async (_installation, id, signal) => { starts++; if (overrides.start) await overrides.start(signal); return { url: 'http://127.0.0.1:1234/analyze', token: 'separate-engine-token', async close() { stops++; } }; } });
  t.after(() => manager.close());
  return { manager, states, counts: () => ({ installs, removes, starts, stops }) };
}
async function settled(manager) {
  for (let n = 0; n < 200; n++) { const status = manager.status(); if (status.operation?.state !== 'running') return status; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('operation did not settle');
}
test('manager is explicitly idle; authentication, host and origin bind every API', async t => {
  const { manager, counts } = await fixture(t);
  assert.deepEqual(counts(), { installs: 0, removes: 0, starts: 0, stops: 0 });
  assert.equal(manager.status().bridge.state, 'stopped');
  assert.equal((await request(manager, 'GET', '/api/status', { token: 'bad' })).code, 401);
  assert.equal((await request(manager, 'GET', '/api/status', { headers: { Origin: 'https://evil.invalid' } })).code, 403);
  assert.equal((await request(manager, 'GET', '/api/status', { headers: { Host: 'evil.invalid' } })).code, 403);
  assert.equal((await request(manager, 'GET', '/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).code, 403);
  const response = await request(manager, 'GET', '/api/status'); assert.equal(response.code, 200); assert.equal(response.value.format, 'local-model-manager-v1');
  assert.equal(response.headers['cache-control'], 'no-store');
});
test('fixed commands reject unverified profiles, arbitrary body and oversized requests', async t => {
  const { manager } = await fixture(t);
  for (const model of require('../agent/mortal-catalog.json').models.filter(model => model.installable === false)) assert.equal((await request(manager, 'POST', '/api/models/' + model.id + '/install', { body: {} })).code, 400);
  assert.equal((await request(manager, 'POST', '/api/models/unknown/install', { body: {} })).code, 400);
  assert.equal((await request(manager, 'POST', '/api/models/voidshine-298k/install', { body: { url: 'https://evil.invalid' } })).code, 400);
  assert.equal((await request(manager, 'POST', '/api/models/voidshine-298k/install', { body: ' '.repeat(1025) })).code, 413);
  assert.equal((await request(manager, 'POST', '/api/models/voidshine-298k/start', { body: {} })).value.error, 'MODEL_NOT_INSTALLED');
});
test('install is observable and mutually exclusive; switch retains weights, delete stops only running model', async t => {
  let release; const barrier = new Promise(r => { release = r; });
  const { manager, counts } = await fixture(t, { install: () => barrier });
  const accepted = await request(manager, 'POST', '/api/models/voidshine-298k/install', { body: {} }); assert.equal(accepted.code, 202); assert.equal(accepted.value.operation.state, 'running');
  assert.equal((await request(manager, 'POST', '/api/stop', { body: {} })).code, 409);
  release(); await settled(manager);
  await request(manager, 'POST', '/api/models/akagi-v2/install', { body: {} }); await settled(manager);
  await request(manager, 'POST', '/api/models/voidshine-298k/start', { body: {} }); await settled(manager);
  assert.equal(manager.status().bridge.token, 'separate-engine-token'); assert.notEqual(manager.status().bridge.token, manager.token);
  await request(manager, 'POST', '/api/models/akagi-v2/start', { body: {} }); await settled(manager);
  assert.equal(counts().stops, 1); assert.equal(manager.status().models.find(p => p.id === 'voidshine-298k').installed, true);
  await request(manager, 'POST', '/api/models/voidshine-298k/remove', { body: {} }); await settled(manager); assert.equal(counts().stops, 1);
  await request(manager, 'POST', '/api/models/akagi-v2/remove', { body: {} }); await settled(manager); assert.equal(counts().stops, 2); assert.equal(manager.status().bridge.state, 'stopped');
});
test('failure is visible and shutdown aborts an active start', async t => {
  const f = await fixture(t, { install: async () => { throw Object.assign(new Error('sensitive path'), { code: 'DOWNLOAD_HASH_MISMATCH' }); } });
  await request(f.manager, 'POST', '/api/models/voidshine-298k/install', { body: {} }); const failed = await settled(f.manager);
  assert.equal(failed.operation.error, 'DOWNLOAD_HASH_MISMATCH'); assert.equal(failed.models.find(p => p.id === 'voidshine-298k').state, 'error');
  let aborted = false;
  const g = await fixture(t, { start: signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('ABORTED'), { code: 'ABORTED' })); }, { once: true })) });
  await request(g.manager, 'POST', '/api/models/voidshine-298k/install', { body: {} }); await settled(g.manager);
  await request(g.manager, 'POST', '/api/models/voidshine-298k/start', { body: {} });
  await g.manager.close(); assert.equal(aborted, true); assert.equal(g.manager.status().bridge.state, 'stopped');
});
test('managed deletion refuses unknown assets, symlinks and changed pinned weights', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-manager-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const install = createInstallation({ root });
  const dir = install.modelDir('akagi-v2'); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'arbitrary.txt'), 'keep');
  await assert.rejects(install.remove('akagi-v2'));
  await fs.writeFile(path.join(dir, 'managed-install.json'), JSON.stringify({ format: 'managed-model-install-v1', profile: 'akagi-v2', files: await inventory(dir) }));
  await assert.rejects(verifyOwned(root, dir, 'akagi-v2'), /UNKNOWN_ASSET_REFUSED/);
  assert.equal(await sha256(path.join(dir, 'arbitrary.txt')), '6ca7ea2feefc88ecb5ed6356ed963f47dc9137f82526fdd25d618ea626d0803f');
  assert.equal(await fs.readFile(path.join(dir, 'arbitrary.txt'), 'utf8'), 'keep');
});
test('failed native prerequisite leaves no partial model and never starts runtime or downloads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-atomic-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const toolkit = path.join(root, 'toolkit'); await fs.mkdir(toolkit);
  let downloads = 0; const install = createInstallation({ root: path.join(root, 'managed'), toolkit, download: async () => { downloads++; } });
  await assert.rejects(install.install('voidshine-298k'), /TOOLKIT_ASSET_REQUIRED/);
  assert.equal(downloads, 0);
  assert.deepEqual(await fs.readdir(path.join(root, 'managed', 'models')), []);
  await assert.rejects(fs.access(path.join(root, 'managed', 'runtimes')), { code: 'ENOENT' });
});
test('managed profile symlink cannot target an outside directory for deletion', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-symlink-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outside = path.join(root, 'outside'), managed = path.join(root, 'managed');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'user-data.txt'), 'keep'); await fs.mkdir(path.join(managed, 'models'), { recursive: true });
  await fs.symlink(outside, path.join(managed, 'models', 'akagi-v2'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createInstallation({ root: managed }).remove('akagi-v2'), /MANAGED_PATH_REFUSED/);
  assert.equal(await fs.readFile(path.join(outside, 'user-data.txt'), 'utf8'), 'keep');
});
for (const mode of ['abort', 'timeout']) test('installer subprocess ' + mode + ' awaits child and grandchild cleanup', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-process-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = path.join(root, 'pids.json');
  const code = "const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});fs.writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000)";
  const controller = new AbortController();
  const operation = run(process.execPath, ['-e', code, record], controller.signal, mode === 'timeout' ? 800 : 20000);
  const failure = assert.rejects(operation, new RegExp(mode === 'timeout' ? 'SUBPROCESS_TIMEOUT' : 'ABORTED'));
  let pids;
  for (let n = 0; n < 100; n++) { try { pids = JSON.parse(await fs.readFile(record, 'utf8')); break; } catch {} await new Promise(r => setTimeout(r, 5)); }
  assert.ok(pids, 'subprocess wrote both PIDs before cancellation');
  if (mode === 'abort') controller.abort();
  await failure;
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'PID ' + pid + ' must be gone when operation settles');
});
