'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const source = require('./akagi-source.json');
const { createRunner } = require('./mjai-process.cjs');
const { startEngineServer } = require('./engine-server.cjs');

function sampleRequest() {
  return { format: 'majsoul-mjai-v1', seat: 0, events: [
    { type: 'start_game', id: 0, names: ['Player 0', 'Player 1', 'Player 2', 'Player 3'] },
    { type: 'start_kyoku', bakaze: 'E', dora_marker: '2s', kyoku: 1, honba: 0, kyotaku: 0, oya: 0,
      scores: [25000, 25000, 25000, 25000], tehais: [
        ['E', '6p', '9m', '8m', 'C', '2s', '7m', 'S', '6m', '1m', 'S', '3s', '8m'],
        ...Array.from({ length: 3 }, () => Array(13).fill('?'))] },
    { type: 'tsumo', actor: 0, pai: '1m' }
  ] };
}
function runtimeConfig({ dir, python }) {
  return { command: python, args: ['-I', path.join(__dirname, 'akagi-local.py'), '--dir', path.resolve(dir)], timeoutMs: 30000 };
}
async function verifyFiles(dir) {
  for (const file of source.files) {
    let data;
    try { data = await fs.readFile(path.join(dir, file.name)); } catch { throw new Error('FILES_MISSING: run setup first'); }
    if (crypto.createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error('SOURCE_HASH_MISMATCH: ' + file.name);
  }
}
async function setup(dir) {
  await fs.mkdir(dir, { recursive: true });
  console.log('Downloading the Akagi v2 weak Mortal example from its pinned GitHub source.');
  console.log('Third-party license: ' + source.license + '. No third-party files enter the extension package.');
  for (const file of source.files) {
    const target = path.join(dir, file.name);
    try {
      const existing = await fs.readFile(target);
      if (crypto.createHash('sha256').update(existing).digest('hex') === file.sha256) continue;
      throw new Error('EXISTING_FILE_MISMATCH: use an empty directory or restore ' + file.name);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const url = `https://raw.githubusercontent.com/shinkuan/Akagi/${source.commit}/${file.path}`;
    // Windows PowerShell uses the OS certificate/proxy configuration; Node's
    // fetch does not consistently inherit that configuration on supported Node 22.
    const temporary = path.join(dir, '.akagi-download-' + crypto.randomUUID());
    let data;
    try {
      if (process.platform === 'win32') {
        const quote = value => "'" + value.replaceAll("'", "''") + "'";
        const download = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri ${quote(url)} -OutFile ${quote(temporary)} -TimeoutSec 60`],
        { windowsHide: true, encoding: 'utf8', timeout: 65000 });
        if (download.error || download.status !== 0) throw new Error('DOWNLOAD_FAILED: ' + file.name + '; check GitHub access and Windows certificate/proxy settings');
        data = await fs.readFile(temporary);
      } else {
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error('DOWNLOAD_FAILED: ' + file.name);
        data = Buffer.from(await response.arrayBuffer());
      }
    } finally { await fs.rm(temporary, { force: true }); }
    if (crypto.createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error('DOWNLOAD_HASH_MISMATCH: ' + file.name);
    await fs.writeFile(target, data, { flag: 'wx' });
    console.log('Verified: ' + file.name);
  }
  await verifyFiles(dir);
  console.log('Setup complete. Install Python dependencies, then run check.');
}
async function check(options) {
  await verifyFiles(options.dir);
  const probeCode = 'import sys,platform\nif sys.version_info[:2]!=(3,11) or platform.system()!="Windows" or platform.machine().lower() not in ("amd64","x86_64"):\n print("PYTHON_VERSION_UNSUPPORTED");sys.exit(2)\ntry:\n import torch,numpy\n print(torch.__version__,numpy.__version__)\nexcept Exception:\n print("PYTHON_DEPENDENCIES_FAILED");sys.exit(3)';
  const probe = spawnSync(options.python, ['-I', '-c', probeCode], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (probe.error?.code === 'ENOENT') throw new Error('PYTHON_NOT_FOUND: pass the full path to Python 3.11 python.exe');
  if (probe.error) throw new Error('PYTHON_START_FAILED: check Python executable and runtime');
  if (probe.status === 2) throw new Error('PYTHON_VERSION_UNSUPPORTED: Windows x64 Python 3.11 required');
  if (probe.status !== 0) throw new Error('PYTHON_DEPENDENCIES_FAILED: install torch==2.7.0 and numpy==1.26.2 in the selected Python environment');
  const started = Date.now();
  let result;
  try { result = await createRunner(runtimeConfig(options)).infer(sampleRequest()); }
  catch (error) { throw new Error('REAL_INFERENCE_FAILED: ' + (error.code || 'UNKNOWN') + '; verify source files, Python dependencies and Windows runtime'); }
  const hand = sampleRequest().events[1].tehais[0].concat('1m');
  if (result.action.type !== 'dahai' || result.action.actor !== 0 || !hand.includes(result.action.pai)) throw new Error('REAL_INFERENCE_INVALID_ACTION');
  console.log(JSON.stringify({ profile: source.profile, commit: source.commit, inferenceVerified: true,
    pythonDependencies: probe.stdout.trim(), elapsedMs: Date.now() - started, action: result.action }));
  return result;
}
async function main(argv) {
  const args = [...argv], mode = args.shift();
  if (!mode || mode === '--help') {
    console.log('Usage: npm run engine:akagi -- setup --dir DIR\n       npm run engine:akagi -- check --dir DIR --python PYTHON_EXE\n       npm run engine:akagi -- serve --dir DIR --python PYTHON_EXE [--port 17341]\nWindows x64 / Python 3.11. Weak example model; not official online Mortal weights.\nserve prints a random local bearer token (or uses MJAI_ENGINE_TOKEN).'); return;
  }
  if (!['setup', 'check', 'serve'].includes(mode)) throw new Error('INVALID_COMMAND');
  const options = { port: 17341 };
  while (args.length) {
    const flag = args.shift();
    if (!['--dir', '--python', '--port'].includes(flag) || !args.length) throw new Error('INVALID_ARGUMENTS');
    options[flag.slice(2)] = flag === '--port' ? Number(args.shift()) : args.shift();
  }
  if (!options.dir || (mode !== 'setup' && !options.python)) throw new Error('MISSING_ARGUMENTS: --dir and --python required (setup only needs --dir)');
  options.dir = path.resolve(options.dir);
  if (mode === 'setup') return setup(options.dir);
  await check(options);
  if (mode === 'serve') {
    let started;
    try { started = await startEngineServer({ config: runtimeConfig(options), port: options.port, token: process.env.MJAI_ENGINE_TOKEN }); }
    catch (error) { throw new Error(error.code === 'EADDRINUSE' ? 'PORT_IN_USE: stop the other bridge or select --port' : 'SERVER_START_FAILED: check --port and MJAI_ENGINE_TOKEN'); }
    const { server, token } = started;
    console.log(`Engine bridge: http://127.0.0.1:${server.address().port}/analyze`);
    console.log(`Bearer token: ${token}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  }
}
module.exports = { source, sampleRequest, runtimeConfig, verifyFiles, setup, check, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(/^[A-Z_]+(?::|$)/.test(error.message) ? error.message : 'LOCAL_PROFILE_FAILED: check model directory, permissions and GitHub access');
  process.exitCode = 1;
});
