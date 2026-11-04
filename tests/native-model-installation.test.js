'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const registry = require('../agent/engine-registry.cjs');
const catalog = require('../agent/mortal-catalog.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const id = 'akagi-v3-native';
async function fixture(t, entries = ['akagi-native.exe', 'sources/LICENSE'], afterDownload) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'native-install-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const zip = path.join(temporary, 'runtime.zip');
  const spec = path.join(temporary, 'entries.json');
  await fs.writeFile(spec, JSON.stringify(entries));
  const script = path.join(temporary, 'zip.ps1');
  await fs.writeFile(script, `param($Out,$Spec)
Add-Type -AssemblyName System.IO.Compression
$stream=[IO.File]::Open($Out,[IO.FileMode]::CreateNew)
$zip=New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create)
try { foreach($name in (Get-Content -LiteralPath $Spec -Raw | ConvertFrom-Json)) { $entry=$zip.CreateEntry($name); $output=$entry.Open(); try {$bytes=[Text.Encoding]::UTF8.GetBytes('native fixture');$output.Write($bytes,0,$bytes.Length)} finally {$output.Dispose()} } } finally {$zip.Dispose();$stream.Dispose()}
`);
  execFileSync('powershell.exe', ['-NoProfile', '-File', script, zip, spec], { windowsHide: true });
  const archive = await fs.readFile(zip), bytes = Buffer.from('native fixture');
  const source = { repository: 'https://github.com/shinkuan/Akagi', files: [{ name: 'akagi4p.safetensors', size: bytes.length, sha256: hash(bytes), url: 'https://fixture.invalid/weights' }], runtime: { id: catalog.models.find(p => p.id === id).runtimeFamily, buildId: 'fixture-only', executable: 'akagi-native.exe', archive: { name: 'runtime.zip', size: archive.length, sha256: hash(archive), url: 'https://fixture.invalid/runtime' }, files: ['akagi-native.exe', 'sources/LICENSE'].map(name => ({ name, size: bytes.length, sha256: hash(bytes) })) } };
  const originalSource = registry.sourceFor;
  t.mock.method(registry, 'sourceFor', profile => profile === id ? source : originalSource(profile));
  delete require.cache[require.resolve('../agent/model-installation.cjs')];
  const { createInstallation } = require('../agent/model-installation.cjs');
  const profile = catalog.models.find(p => p.id === id), previous = { ...profile };
  Object.assign(profile, { installable: true, status: 'verified-experimental' });
  t.after(() => Object.assign(profile, previous));
  const downloads = [], requests = [];
  const installation = createInstallation({ root: path.join(temporary, 'managed'), download: async (url, target, signal, options) => { downloads.push(url); requests.push(options); await fs.writeFile(target, url.endsWith('/runtime') ? archive : bytes, { flag: 'wx' }); await afterDownload?.(url, signal); } });
  return { temporary, installation, downloads, source, requests };
}
const windows = { skip: process.platform !== 'win32' };
test('native driver is explicit and rejects Python paths and unknown fallback', async () => {
  assert.equal(registry.driverFor(id).defaultPort, 17345);
  assert.equal(registry.driverFor(id).runtimeKind, 'native');
  assert.throws(() => registry.driverFor('future-model'), /UNKNOWN_PROFILE/);
  const installation = require('../agent/model-installation.cjs').createInstallation({ root: os.tmpdir() });
  assert.throws(() => installation.pythonFor(id), /RUNTIME_KIND_MISMATCH/);
});
test('native install downloads only its runtime and weight; reuse and delete preserve runtime and neighbours', windows, async t => {
  const { installation, downloads, source } = await fixture(t);
  assert.equal((await installation.inspect(id)).installed, false);
  assert.deepEqual(downloads, []);
  await installation.install(id);
  assert.deepEqual(downloads, ['https://fixture.invalid/runtime', 'https://fixture.invalid/weights']);
  assert.equal((await installation.inspect(id)).installed, true);
  await installation.verifyRuntime(id);
  const other = installation.modelDir('akagi-v2'); await fs.mkdir(other); await fs.writeFile(path.join(other, 'keep'), 'other-model');
  const runtime = installation.runtimeDir(id);
  assert.equal(JSON.parse(await fs.readFile(path.join(runtime, 'managed-runtime.json'))).format, 'managed-native-runtime-v1');
  await installation.remove(id);
  assert.equal((await installation.runtimeStatus(source.runtime.id)).installed, true);
  assert.equal(await fs.readFile(path.join(other, 'keep'), 'utf8'), 'other-model');
  await installation.install(id);
  assert.equal(downloads.filter(url => url.endsWith('/runtime')).length, 1);
  await installation.remove(id);
  await fs.writeFile(path.join(runtime, 'akagi-native.exe'), 'damaged');
  await assert.rejects(installation.verifyRuntime(id), /RUNTIME_INTEGRITY_FAILED/);
  const count = downloads.length;
  await assert.rejects(installation.install(id), /RUNTIME_INTEGRITY_FAILED/);
  assert.equal(downloads.length, count, 'damaged owned runtime must not trigger downloads or replacement');
  await assert.rejects(installation.remove('akagi-v2'));
});
test('native hash failure leaves no model or runtime and never falls back', windows, async t => {
  const { installation, source, downloads } = await fixture(t);
  source.runtime.archive.sha256 = '0'.repeat(64);
  await assert.rejects(installation.install(id), /DOWNLOAD_HASH_MISMATCH/);
  assert.deepEqual(downloads, ['https://fixture.invalid/runtime']);
  assert.deepEqual(await fs.readdir(path.join(installation.root, 'models')), []);
  assert.deepEqual(await fs.readdir(path.join(installation.root, 'runtimes')), []);
});
test('fixed GitHub Accept headers are bounded and never replace weight integrity checking', windows, async t => {
  const { installation, source, requests } = await fixture(t);
  const { downloadHeaders } = require('../agent/model-installation.cjs');
  assert.equal(downloadHeaders(undefined), undefined, 'legacy downloads keep their existing request defaults');
  for (const value of ['text/plain', 'application/json', "application/octet-stream';Write-Host secret", { Authorization: 'secret' }, null]) assert.throws(() => downloadHeaders(value), /DOWNLOAD_HEADER_REFUSED/);
  source.runtime.archive.accept = 'application/octet-stream';
  source.files[0].accept = 'application/vnd.github.raw+json';
  source.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(installation.install(id), /DOWNLOAD_HASH_MISMATCH/);
  assert.deepEqual(requests.map(item => item.headers), [
    { Accept: 'application/octet-stream', 'User-Agent': 'majsoul-model-manager' },
    { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'majsoul-model-manager' }
  ]);
  assert.deepEqual(await fs.readdir(path.join(installation.root, 'models')), []);
  await installation.verifyRuntime(id);
});
test('unsupported fixed Accept header fails before any native network request', windows, async t => {
  const { installation, source, downloads } = await fixture(t);
  source.runtime.archive.accept = 'application/json';
  await assert.rejects(installation.install(id), /DOWNLOAD_HEADER_REFUSED/);
  assert.deepEqual(downloads, []);
  assert.deepEqual(await fs.readdir(path.join(installation.root, 'runtimes')), []);
});
test('cancelled native model installation cleans staging while retaining the verified runtime', windows, async t => {
  const controller = new AbortController();
  const { installation, source } = await fixture(t, undefined, url => { if (url.endsWith('/weights')) controller.abort(); });
  await assert.rejects(installation.install(id, { signal: controller.signal }), /ABORTED/);
  assert.deepEqual(await fs.readdir(path.join(installation.root, 'models')), []);
  assert.equal((await installation.runtimeStatus(source.runtime.id)).installed, true);
  await installation.verifyRuntime(id);
});
test('native locked dotfiles are accepted but unsafe Windows names and aliases are refused', windows, async t => {
  const { installation, source, downloads } = await fixture(t);
  for (const name of ['../file', 'sources/CON.txt', 'sources/hidden.', 'sources/../file', 'akagi-native.EXE', 'managed-runtime.json']) {
    source.runtime.files.push({ name, size: 0, sha256: hash('') });
    await assert.rejects(installation.install(id), /NATIVE_RUNTIME_LOCK_INVALID/);
    source.runtime.files.pop();
  }
  assert.deepEqual(downloads, []);
  source.runtime.files.push({ name: 'akagi4p.safetensors', size: 0, sha256: hash('') });
  await assert.rejects(installation.install(id), /NATIVE_RUNTIME_WEIGHT_REFUSED/);
  source.runtime.files.pop();
  source.runtime.files.push({ name: 'sources/.cargo/config.toml', size: 0, sha256: hash('') });
  // The lock accepts this real Cargo source path; the fixture ZIP correctly
  // fails because it does not contain the newly declared file.
  await assert.rejects(installation.install(id), /SUBPROCESS_FAILED/);
});
test('native runtime junction is rejected without touching its destination', windows, async t => {
  const { installation, downloads, temporary } = await fixture(t);
  const outside = path.join(temporary, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep'), 'user');
  await fs.mkdir(path.join(installation.root, 'runtimes'), { recursive: true });
  await fs.symlink(outside, installation.runtimeDir(id), 'junction');
  await assert.rejects(installation.install(id), /MANAGED_PATH_REFUSED/);
  assert.deepEqual(downloads, []);
  assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'user');
});
for (const entry of ['../escape', 'akagi-native.exe', 'unknown.txt']) test('native ZIP refuses traversal, duplicates and unlisted assets: ' + entry, windows, async t => {
  const { installation } = await fixture(t, ['akagi-native.exe', 'sources/LICENSE', entry]);
  await assert.rejects(installation.install(id), /SUBPROCESS_FAILED/);
  assert.deepEqual(await fs.readdir(path.join(installation.root, 'models')), []);
  assert.deepEqual(await fs.readdir(path.join(installation.root, 'runtimes')), []);
});
