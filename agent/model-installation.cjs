'use strict';
// Only the explicit model manager invokes these operations. No install/build hook.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { killTree } = require('./mortal-process.cjs');
const catalog = require('./mortal-catalog.json');
const lock = require('./mortal-runtime-lock.json');
const fail = code => Object.assign(new Error(code), { code });
function downloadHeaders(accept) {
  if (accept === undefined) return undefined;
  if (!['application/vnd.github.raw+json', 'application/octet-stream'].includes(accept)) throw fail('DOWNLOAD_HEADER_REFUSED');
  return { Accept: accept, 'User-Agent': 'majsoul-model-manager' };
}
async function sha256(file) { const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
const { driverFor, sourceFor } = require('./engine-registry.cjs');
async function run(command, args, signal, timeoutMs = 240000) {
  if (signal?.aborted) throw fail('ABORTED');
  const child = spawn(command, args, { windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore' });
  let timer, abort;
  try { await new Promise((resolve, reject) => {
    let settling = false;
    const finish = async (error, cleanup = false) => {
      if (settling) return; settling = true;
      clearTimeout(timer);
      try { if (cleanup) await killTree(child); }
      catch { error = fail('CLEANUP_TIMEOUT'); }
      if (error) reject(error); else resolve();
    };
    abort = () => { finish(fail('ABORTED'), true); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { finish(fail('SUBPROCESS_TIMEOUT'), true); }, timeoutMs);
    child.once('error', () => { finish(fail('SUBPROCESS_FAILED'), true); });
    child.once('close', code => { finish(code === 0 ? null : fail('SUBPROCESS_FAILED')); });
    if (signal?.aborted) abort();
  }); } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
async function safeDirectory(root, target, allowMissing = false) {
  const resolvedRoot = path.resolve(root), relative = path.relative(resolvedRoot, path.resolve(target));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw fail('MANAGED_PATH_REFUSED');
  // Compare paths in the caller's namespace before canonicalizing. Windows realpath
  // expands 8.3 aliases and normalizes casing, so string-prefix comparison with it
  // rejects valid temporary directories. Reject links independently of spelling.
  let ancestor = path.parse(resolvedRoot).root;
  for (const part of path.relative(ancestor, resolvedRoot).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, part);
    const stat = await fs.lstat(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('MANAGED_PATH_REFUSED');
  }
  const base = await fs.realpath(resolvedRoot);
  let current = base;
  for (const part of relative.split(path.sep)) {
    const parent = current;
    current = path.join(parent, part);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('MANAGED_PATH_REFUSED');
      current = await fs.realpath(current);
      if (path.relative(parent, path.dirname(current))) throw fail('MANAGED_PATH_REFUSED');
    }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return; throw error; }
  }
}
async function inventory(root, relative = '') {
  const files = [], result = [];
  async function walk(folder) {
    for (const entry of await fs.readdir(path.join(root, folder), { withFileTypes: true })) {
      const name = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw fail('MANAGED_PATH_REFUSED');
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) files.push(name);
      else throw fail('UNKNOWN_ASSET_REFUSED');
    }
  }
  await walk(relative);
  let cursor = 0;
  // Bound disk concurrency while verifying every byte; large runtimes contain many small files.
  const checks = await Promise.allSettled(Array.from({ length: Math.min(8, files.length) }, async () => {
    while (cursor < files.length) { const name = files[cursor++]; result.push({ name: name.replaceAll('\\', '/'), sha256: await sha256(path.join(root, name)) }); }
  }));
  const rejected = checks.find(check => check.status === 'rejected'); if (rejected) throw rejected.reason;
  return result.sort((a,b) => a.name.localeCompare(b.name));
}
async function verifyOwned(root, dir, profile) {
  await safeDirectory(root, dir);
  const marker = JSON.parse(await fs.readFile(path.join(dir, 'managed-install.json'), 'utf8'));
  if (marker.format !== 'managed-model-install-v1' || marker.profile !== profile || !Array.isArray(marker.files)) throw fail('UNKNOWN_ASSET_REFUSED');
  const actual = (await inventory(dir)).filter(f => f.name !== 'managed-install.json');
  if (JSON.stringify(actual) !== JSON.stringify(marker.files)) throw fail('ASSET_INTEGRITY_FAILED');
  const source = sourceFor(profile);
  const expectedNames = source.files.map(f => f.name).concat(source.native ? ['libriichi.pyd', 'libriichi-build.json'] : []);
  if (actual.length !== expectedNames.length || actual.some(f => !expectedNames.includes(f.name))) throw fail('UNKNOWN_ASSET_REFUSED');
  for (const file of source.files) if (!actual.some(f => f.name === file.name && f.sha256 === file.sha256)) throw fail('SOURCE_HASH_MISMATCH');
  if (source.native) {
    if (!actual.some(f => f.name === 'libriichi.pyd' && f.sha256 === source.native.sha256)) throw fail('NATIVE_BUILD_MISMATCH');
    const build = JSON.parse(await fs.readFile(path.join(dir, 'libriichi-build.json'), 'utf8'));
    if (build.sha256 !== source.native.sha256 || build.sourceCommit !== source.sourceCommit || build.abi !== source.native.abi || JSON.stringify(build.features) !== JSON.stringify(source.native.features)) throw fail('NATIVE_BUILD_MISMATCH');
  }
  return marker;
}
async function verifyRuntime(root, dir) {
  await safeDirectory(root, dir);
  const marker = JSON.parse(await fs.readFile(path.join(dir, 'managed-runtime.json'), 'utf8'));
  if (marker.format !== 'managed-runtime-v1' || JSON.stringify(marker.lock) !== JSON.stringify(lock)) throw fail('RUNTIME_LOCK_MISMATCH');
  if (JSON.stringify((await inventory(dir)).filter(f => f.name !== 'managed-runtime.json')) !== JSON.stringify(marker.files)) throw fail('RUNTIME_INTEGRITY_FAILED');
}
function createInstallation({ root, toolkit, download } = {}) {
  root = path.resolve(root); toolkit = toolkit && path.resolve(toolkit);
  const modelDir = id => path.join(root, 'models', id);
  const profile = id => { const p = catalog.models.find(p => p.id === id); if (!p) throw fail('UNKNOWN_PROFILE'); return p; };
  async function fetchFile(item, target, signal) {
    if (signal?.aborted) throw fail('ABORTED');
    const headers = downloadHeaders(item.accept);
    if (toolkit) {
      for (const folder of [...(item.profile ? ['models/' + item.profile, 'model/' + item.profile] : []), ...(item.runtime ? ['runtimes/' + item.runtime] : []), 'native', 'model', 'bootstrap', 'wheels', '']) {
        const candidate = path.join(toolkit, folder, item.name);
        try { if (await sha256(candidate) === item.sha256) { if (item.size && (await fs.stat(candidate)).size !== item.size) throw fail('DOWNLOAD_HASH_MISMATCH'); await fs.copyFile(candidate, target, 1); if (signal?.aborted) throw fail('ABORTED'); return; } } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'EISDIR') throw e; }
      }
    }
    if (!item.url) throw fail('TOOLKIT_ASSET_REQUIRED');
    if (download) await download(item.url, target, signal, { headers });
    else if (process.platform === 'win32') {
      const quote = s => "'" + s.replaceAll("'", "''") + "'";
      const headerArgument = headers ? ` -Headers @{Accept=${quote(headers.Accept)};'User-Agent'='majsoul-model-manager'}` : '';
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri ${quote(item.url)} -OutFile ${quote(target)} -TimeoutSec 600${headerArgument}`], signal, 610000);
    } else {
      const { pipeline } = require('node:stream/promises'); const { Readable } = require('node:stream'); const { createWriteStream } = require('node:fs');
      const response = await fetch(item.url, { ...(headers ? { headers } : {}), signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(600000)]) });
      if (!response.ok) throw fail('DOWNLOAD_FAILED');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { flags: 'wx' }), { signal });
    }
    if (await sha256(target) !== item.sha256 || (item.size && (await fs.stat(target)).size !== item.size)) throw fail('DOWNLOAD_HASH_MISMATCH');
  }
  function nativeLock(p) {
    const runtime = sourceFor(p.id).runtime;
    if (!runtime || runtime.id !== p.runtimeFamily || !runtime.buildId || !runtime.executable || !Array.isArray(runtime.files) || !runtime.files.length) throw fail('NATIVE_RUNTIME_NOT_READY');
    const names = new Set();
    for (const file of runtime.files) {
      if (/(?:^|\/)weights(?:\/|$)|\.(?:pth|safetensors)$/i.test(file.name)) throw fail('NATIVE_RUNTIME_WEIGHT_REFUSED');
      if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(file.name) || file.name.split('/').some(part => part === '..' || part === '.' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || names.has(file.name.toLowerCase()) || ['managed-runtime.json', '.runtime.zip', '.runtime-lock.json'].includes(file.name.toLowerCase()) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) throw fail('NATIVE_RUNTIME_LOCK_INVALID');
      names.add(file.name.toLowerCase());
    }
    const archive = runtime.archive;
    if (!archive || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(archive.name) || !/^[a-f0-9]{64}$/.test(archive.sha256) || !Number.isSafeInteger(archive.size) || archive.size <= 0 || (archive.url !== null && !/^https:\/\//.test(archive.url || ''))) throw fail('NATIVE_RUNTIME_NOT_READY');
    if (!runtime.files.some(file => file.name === runtime.executable)) throw fail('NATIVE_RUNTIME_LOCK_INVALID');
    return runtime;
  }
  async function verifyNativeRuntime(p, dir, full = true) {
    const runtime = nativeLock(p);
    await safeDirectory(root, dir);
    const marker = JSON.parse(await fs.readFile(path.join(dir, 'managed-runtime.json'), 'utf8'));
    if (marker.format !== 'managed-native-runtime-v1' || JSON.stringify(marker.lock) !== JSON.stringify(runtime)) throw fail('RUNTIME_LOCK_MISMATCH');
    if (full) {
      const actual = (await inventory(dir)).filter(file => file.name !== 'managed-runtime.json');
      const expected = runtime.files.map(({ name, sha256 }) => ({ name, sha256 })).sort((a,b) => a.name.localeCompare(b.name));
      if (JSON.stringify(actual) !== JSON.stringify(expected) || JSON.stringify(marker.files) !== JSON.stringify(expected)) throw fail('RUNTIME_INTEGRITY_FAILED');
      for (const file of runtime.files) if ((await fs.stat(path.join(dir, file.name))).size !== file.size) throw fail('RUNTIME_INTEGRITY_FAILED');
    }
    await fs.access(path.join(dir, runtime.executable));
  }
  async function ensureNativeRuntime(p, signal) {
    const runtime = nativeLock(p), dir = path.join(root, 'runtimes', p.runtimeFamily);
    await safeDirectory(root, dir, true);
    let exists = false;
    try { await fs.lstat(dir); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) { await verifyNativeRuntime(p, dir); return; }
    await fs.mkdir(path.join(root, 'runtimes'), { recursive: true });
    const stage = await fs.mkdtemp(path.join(root, 'runtimes', '.install-native-'));
    try {
      const archive = path.join(stage, '.runtime.zip'), manifest = path.join(stage, '.runtime-lock.json');
      await fetchFile({ ...runtime.archive, runtime: runtime.id }, archive, signal);
      await fs.writeFile(manifest, JSON.stringify(runtime));
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../scripts/extract-native-runtime.ps1'), '-Archive', archive, '-Manifest', manifest, '-Destination', stage], signal);
      await fs.rm(archive); await fs.rm(manifest);
      const expected = runtime.files.map(({ name, sha256 }) => ({ name, sha256 })).sort((a,b) => a.name.localeCompare(b.name));
      if (JSON.stringify(await inventory(stage)) !== JSON.stringify(expected)) throw fail('RUNTIME_INTEGRITY_FAILED');
      await fs.writeFile(path.join(stage, 'managed-runtime.json'), JSON.stringify({ format: 'managed-native-runtime-v1', lock: runtime, files: await inventory(stage) }));
      if (signal?.aborted) throw fail('ABORTED');
      await safeDirectory(root, dir, true);
      await fs.rename(stage, dir);
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }
  async function ensureRuntime(p, signal) {
    if (driverFor(p.id).runtimeKind === 'native') return ensureNativeRuntime(p, signal);
    const family = p.runtimeFamily, dir = path.join(root, 'runtimes', family);
    await safeDirectory(root, dir, true);
    try {
      await fs.access(dir);
      await verifyRuntime(root, dir);
      return path.join(dir, 'python', 'python.exe');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(path.join(root, 'runtimes'), { recursive: true });
    const stage = await fs.mkdtemp(path.join(root, 'runtimes', '.install-'));
    try {
      const source = require('./mortal-source.json');
      await fs.mkdir(path.join(stage, 'wheels'));
      const archive = path.join(stage, 'python.zip');
      await fetchFile({ ...source.pythonArchive, name: 'python-3.11.9-embed-amd64.zip' }, archive, signal);
      for (const wheel of lock.wheels) await fetchFile(wheel, path.join(stage, 'wheels', wheel.name), signal);
      await run(process.execPath, [path.join(__dirname, '../scripts/prepare-mortal-runtime.cjs'), '--dir', stage, '--archive', archive, '--wheels', path.join(stage, 'wheels')], signal);
      await fs.rm(archive); await fs.rm(path.join(stage, 'wheels'), { recursive: true });
      await fs.writeFile(path.join(stage, 'managed-runtime.json'), JSON.stringify({ format: 'managed-runtime-v1', lock, files: await inventory(stage) }));
      if (signal?.aborted) throw fail('ABORTED');
      await fs.rename(stage, dir);
      return path.join(dir, 'python', 'python.exe');
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }
  return {
    root, modelDir, profile, sourceFor,
    runtimeDir(id) { return path.join(root, 'runtimes', profile(id).runtimeFamily); },
    pythonFor(id) { if (driverFor(id).runtimeKind !== 'python') throw fail('RUNTIME_KIND_MISMATCH'); return path.join(root, 'runtimes', profile(id).runtimeFamily, 'python', 'python.exe'); },
    async verifyRuntime(id) { const p = profile(id), dir = this.runtimeDir(id); if (driverFor(id).runtimeKind === 'native') await verifyNativeRuntime(p, dir); else await verifyRuntime(root, dir); },
    async runtimeStatus(family) {
      const dir = path.join(root, 'runtimes', family);
      try {
        const p = catalog.models.find(p => p.runtimeFamily === family);
        if (!p) throw fail('UNKNOWN_PROFILE');
        if (driverFor(p.id).runtimeKind === 'native') { await safeDirectory(root, dir); await verifyNativeRuntime(p, dir, false); return { installed: true, state: 'installed', error: null, integrityRecheckedOnStart: true }; }
        await safeDirectory(root, dir);
        const marker = JSON.parse(await fs.readFile(path.join(dir, 'managed-runtime.json'), 'utf8'));
        if (marker.format !== 'managed-runtime-v1' || JSON.stringify(marker.lock) !== JSON.stringify(lock)) throw fail('RUNTIME_LOCK_MISMATCH');
        await fs.access(path.join(dir, 'python', 'python.exe'));
        return { installed: true, state: 'installed', error: null, integrityRecheckedOnStart: true };
      } catch (e) { return { installed: false, state: e.code === 'ENOENT' ? 'not-installed' : 'invalid', error: e.code === 'ENOENT' ? null : publicCode(e) }; }
    },
    async inspect(id) {
      profile(id);
      try { const marker = await verifyOwned(root, modelDir(id), id); if (driverFor(id).runtimeKind === 'python') await fs.access(this.pythonFor(id)); else await verifyNativeRuntime(profile(id), this.runtimeDir(id), false); return { installed: true, state: 'installed', error: null, installedAt: marker.installedAt }; }
      catch (e) { return { installed: false, state: e.code === 'ENOENT' ? 'not-installed' : 'invalid', error: e.code === 'ENOENT' ? null : (e.code || 'ASSET_INTEGRITY_FAILED') }; }
    },
    async install(id, { signal } = {}) {
      const p = profile(id); if (p.installable === false || p.status === 'unverified' || p.status === 'pending') throw fail('PROFILE_NOT_VERIFIED');
      const source = sourceFor(id);
      await fs.mkdir(root, { recursive: true }); await safeDirectory(root, modelDir(id), true);
      try { await fs.lstat(modelDir(id)); throw fail('MODEL_ALREADY_EXISTS'); } catch(e) { if (e.code !== 'ENOENT') throw e; }
      // The native component is supplied only by the separately obtained toolkit.
      if (source.native && !toolkit) throw fail('TOOLKIT_REQUIRED');
      await fs.mkdir(path.join(root, 'models'), { recursive: true });
      const stage = await fs.mkdtemp(path.join(root, 'models', '.install-'));
      try {
        if (source.native) {
          await fetchFile({ name: 'libriichi.pyd', sha256: source.native.sha256 }, path.join(stage, 'libriichi.pyd'), signal);
          let build;
          for (const folder of ['native', 'model', '']) {
            try { build = JSON.parse(await fs.readFile(path.join(toolkit, folder, 'libriichi-build.json'), 'utf8')); break; }
            catch (e) { if (e.code !== 'ENOENT') throw e; }
          }
          if (!build) throw fail('TOOLKIT_ASSET_REQUIRED');
          if (build.sha256 !== source.native.sha256 || build.sourceCommit !== source.sourceCommit || build.abi !== source.native.abi) throw fail('NATIVE_BUILD_MISMATCH');
          await fs.writeFile(path.join(stage, 'libriichi-build.json'), JSON.stringify(build));
        }
        await ensureRuntime(p, signal);
        for (const item of source.files) await fetchFile({ ...item, profile: id, url: item.url }, path.join(stage, item.name), signal);
        const files = await inventory(stage);
        await fs.writeFile(path.join(stage, 'managed-install.json'), JSON.stringify({ format: 'managed-model-install-v1', profile: id, installedAt: new Date().toISOString(), files }));
        if (signal?.aborted) throw fail('ABORTED');
        await safeDirectory(root, modelDir(id), true); await fs.rename(stage, modelDir(id));
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
    },
    async remove(id) { profile(id); await verifyOwned(root, modelDir(id), id); await fs.rm(modelDir(id), { recursive: true }); }
  };
}
module.exports = { createInstallation, sha256, verifyOwned, safeDirectory, inventory, run, sourceFor, downloadHeaders };
function publicCode(error) { return /^[A-Z][A-Z0-9_]{1,70}$/.test(error.code || error.message) ? (error.code || error.message) : 'RUNTIME_INVALID'; }
