'use strict';
// Explicit online acceptance of a standalone default bootstrap. Never part of npm test.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
async function main(argv) {
  if (process.platform !== 'win32') throw new Error('WINDOWS_ONLINE_ACCEPTANCE_ONLY');
  const options = {};
  while (argv.length) { const flag = argv.shift(); if (!['--bootstrap', '--root', '--out'].includes(flag) || !argv.length) throw new Error('INVALID_ARGUMENTS'); options[flag.slice(2)] = path.resolve(argv.shift()); }
  if (!options.bootstrap || !options.root || !options.out) throw new Error('Required --bootstrap DEFAULT_BOOTSTRAP --root NEW_DIR --out REPORT.json');
  try { await fs.access(options.root); throw new Error('NEW_ROOT_REQUIRED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const name of ['model', 'models', 'python', 'wheels', 'bootstrap']) await assert.rejects(fs.access(path.join(options.bootstrap, name)), { code: 'ENOENT' });
  const { createManager } = require(path.join(options.bootstrap, 'agent/model-manager.cjs'));
  const manager = await createManager({ root: options.root, toolkit: options.bootstrap, port: 0 });
  const base = 'http://127.0.0.1:' + manager.server.address().port, timeline = [], started = Date.now();
  const api = async (url, method = 'GET') => {
    const response = await fetch(base + url, { method, headers: { Authorization: 'Bearer ' + manager.token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  const downloadUrl = async () => {
    const quote = s => "'" + s.replaceAll("'", "''") + "'";
    const command = `$needle=${quote(options.root)}; @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($needle) -and $_.CommandLine.Contains('Invoke-WebRequest') } | ForEach-Object { if ($_.CommandLine -match "-Uri '([^']+)'") { $matches[1] } }) | ConvertTo-Json -Compress`;
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000 });
    const parsed = stdout.trim() ? JSON.parse(stdout) : []; return (Array.isArray(parsed) ? parsed : [parsed]).filter(url => typeof url === 'string' && /^https:\/\//.test(url));
  };
  async function assets(folder = options.root) {
    const result = [];
    let entries; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch(e) { if (e.code === 'ENOENT') return result; throw e; }
    for (const entry of entries) { const file = path.join(folder, entry.name); if (entry.isDirectory()) { if (entry.name !== 'python' && entry.name !== 'Lib') result.push(...await assets(file)); } else { const stat = await fs.stat(file).catch(() => null); if (stat) result.push({ name: path.relative(options.root, file), bytes: stat.size }); } }
    return result;
  }
  let finalStatus, check = null, failure = null, lastSignature = '', lastUrls = [];
  try {
    assert.equal(manager.status().bridge.state, 'stopped'); assert.ok(manager.status().models.every(p => !p.installed));
    await api('/api/models/voidshine-298k/install', 'POST'); console.log('Official online install accepted; no offline assets or download override.');
    for (;;) {
      const status = await api('/api/status'), urls = await downloadUrl(); if (urls.length) lastUrls = urls;
      const files = await assets(), snapshot = { elapsedMs: Date.now() - started, operation: status.operation, downloadUrls: urls, files };
      const signature = JSON.stringify({ state: status.operation.state, urls, files });
      if (signature !== lastSignature) { timeline.push(snapshot); lastSignature = signature; console.log(JSON.stringify({ elapsedMs: snapshot.elapsedMs, state: status.operation.state, downloadDomains: urls.map(url => new URL(url).hostname), assetCount: files.length, lastAsset: files.at(-1) || null })); }
      if (status.operation.state !== 'running') { finalStatus = status; break; }
      if (Date.now() - started > 30 * 60 * 1000) throw new Error('ACCEPTANCE_DEADLINE');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (finalStatus.operation.state === 'succeeded') {
      const installation = require(path.join(options.bootstrap, 'agent/model-installation.cjs')).createInstallation({ root: options.root, toolkit: options.bootstrap });
      await installation.verifyRuntime('voidshine-298k');
      const local = require(path.join(options.bootstrap, 'agent/mortal-local.cjs'));
      await local.check({ dir: installation.modelDir('voidshine-298k'), python: installation.pythonFor('voidshine-298k'), profile: 'voidshine-298k' });
      check = { inferenceVerified: true, seats: 4 };
    } else failure = { error: finalStatus.operation.error, lastDownloadUrls: lastUrls, domains: lastUrls.map(url => new URL(url).hostname), stage: lastUrls.some(url => /\.pth$/.test(new URL(url).pathname)) ? 'model-weight-download' : 'runtime-dependency-download-or-preparation' };
  } catch(e) { failure = { error: e.code || e.message, lastDownloadUrls: lastUrls, domains: lastUrls.map(url => new URL(url).hostname) }; }
  finally { await manager.close(); }
  const quote = s => "'" + s.replaceAll("'", "''") + "'";
  const command = `$needle=${quote(options.root)}; @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($needle) -and $_.Name -in @('python.exe','powershell.exe') } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`;
  const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000 });
  const report = { bootstrap: options.bootstrap, root: options.root, officialDefaultOnlineFlow: true, offlineFixture: false, downloadOverride: false, success: !failure && !!check, elapsedMs: Date.now() - started, failure, check, timeline, finalModels: finalStatus?.models.map(p => ({ id: p.id, installed: p.installed, state: p.state, error: p.error })), finalRuntimes: finalStatus?.runtimes, remainingOwnedProcesses: stdout.trim() ? JSON.parse(stdout) : [], remainingAssets: await assets(), completedAt: new Date().toISOString() };
  await fs.writeFile(options.out, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ success: report.success, elapsedMs: report.elapsedMs, failure, check, report: options.out, remainingOwnedProcesses: report.remainingOwnedProcesses }));
  if (!report.success) process.exitCode = 1;
}
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e); process.exitCode = 1; });
