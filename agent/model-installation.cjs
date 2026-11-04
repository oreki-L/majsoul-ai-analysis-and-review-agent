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
async function sha256(file) { const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
function sourceFor(id) {
  if (id === 'akagi-v2') { const s = require('./akagi-source.json'); return { ...s, files: s.files.map(f => ({ ...f, url: `https://raw.githubusercontent.com/shinkuan/Akagi/${s.commit}/${f.path}` })) }; }
  const local = require('./mortal-local.cjs');
  if (local.getSource) return local.getSource(id);
  if (local.sourceForProfile) return local.sourceForProfile(id);
  if (id === local.source.profile) return local.source;
  throw fail('PROFILE_NOT_VERIFIED');
}
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
  const expected = path.resolve(target), base = await fs.realpath(root);
  if (!expected.startsWith(base + path.sep)) throw fail('MANAGED_PATH_REFUSED');
  let current = base;
  for (const part of path.relative(base, expected).split(path.sep)) {
    current = path.join(current, part);
    try { const stat = await fs.lstat(current); if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(current) !== current) throw fail('MANAGED_PATH_REFUSED'); }
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
    if (toolkit) {
      for (const folder of [...(item.profile ? ['models/' + item.profile, 'model/' + item.profile] : []), 'native', 'model', 'bootstrap', 'wheels', '']) {
        const candidate = path.join(toolkit, folder, item.name);
        try { if (await sha256(candidate) === item.sha256) { await fs.copyFile(candidate, target, 1); return; } } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'EISDIR') throw e; }
      }
    }
    if (!item.url) throw fail('TOOLKIT_ASSET_REQUIRED');
    if (download) await download(item.url, target, signal);
    else if (process.platform === 'win32') {
      const quote = s => "'" + s.replaceAll("'", "''") + "'";
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri ${quote(item.url)} -OutFile ${quote(target)} -TimeoutSec 600`], signal, 610000);
    } else {
      const { pipeline } = require('node:stream/promises'); const { Readable } = require('node:stream'); const { createWriteStream } = require('node:fs');
      const response = await fetch(item.url, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(600000)]) });
      if (!response.ok) throw fail('DOWNLOAD_FAILED');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target, { flags: 'wx' }), { signal });
    }
    if (await sha256(target) !== item.sha256 || (item.size && (await fs.stat(target)).size !== item.size)) throw fail('DOWNLOAD_HASH_MISMATCH');
  }
  async function ensureRuntime(p, signal) {
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
    pythonFor(id) { return path.join(root, 'runtimes', profile(id).runtimeFamily, 'python', 'python.exe'); },
    async verifyRuntime(id) { await verifyRuntime(root, path.join(root, 'runtimes', profile(id).runtimeFamily)); },
    async runtimeStatus(family) {
      const dir = path.join(root, 'runtimes', family);
      try {
        await safeDirectory(root, dir);
        const marker = JSON.parse(await fs.readFile(path.join(dir, 'managed-runtime.json'), 'utf8'));
        if (marker.format !== 'managed-runtime-v1' || JSON.stringify(marker.lock) !== JSON.stringify(lock)) throw fail('RUNTIME_LOCK_MISMATCH');
        await fs.access(path.join(dir, 'python', 'python.exe'));
        return { installed: true, state: 'installed', error: null, integrityRecheckedOnStart: true };
      } catch (e) { return { installed: false, state: e.code === 'ENOENT' ? 'not-installed' : 'invalid', error: e.code === 'ENOENT' ? null : publicCode(e) }; }
    },
    async inspect(id) {
      profile(id);
      try { const marker = await verifyOwned(root, modelDir(id), id); await fs.access(this.pythonFor(id)); return { installed: true, state: 'installed', error: null, installedAt: marker.installedAt }; }
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
        for (const item of source.files) await fetchFile({ ...item, profile: id, url: item.url || `https://raw.githubusercontent.com/Equim-chan/Mortal/${source.sourceCommit}/${item.upstream}` }, path.join(stage, item.name), signal);
        const files = await inventory(stage);
        await fs.writeFile(path.join(stage, 'managed-install.json'), JSON.stringify({ format: 'managed-model-install-v1', profile: id, installedAt: new Date().toISOString(), files }));
        if (signal?.aborted) throw fail('ABORTED');
        await safeDirectory(root, modelDir(id), true); await fs.rename(stage, modelDir(id));
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
    },
    async remove(id) { profile(id); await verifyOwned(root, modelDir(id), id); await fs.rm(modelDir(id), { recursive: true }); }
  };
}
module.exports = { createInstallation, sha256, verifyOwned, safeDirectory, inventory, run, sourceFor };
function publicCode(error) { return /^[A-Z][A-Z0-9_]{1,70}$/.test(error.code || error.message) ? (error.code || error.message) : 'RUNTIME_INVALID'; }
