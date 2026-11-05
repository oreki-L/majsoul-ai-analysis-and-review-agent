'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const source = require('./mortal-source.json');
const {sourceForProfile}=require('./mortal-profile.cjs');
const catalog = require('./mortal-catalog.json');
const { createMortalRunner } = require('./mortal-process.cjs');
const { createEngineServer } = require('./engine-server.cjs');
const { sampleRequest } = require('./mortal-sample.cjs');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function runtimeConfig({ dir, python, profile = source.profile }) {
  sourceForProfile(profile);
  return { command: python || path.resolve(dir, 'python/python.exe'), args: ['-B', '-I', path.join(__dirname, 'mortal-worker.py'), '--dir', path.resolve(dir), '--profile', profile], profile };
}
async function verifyFiles(dir, profile = source.profile) {
  const source = sourceForProfile(profile);
  for (const item of source.files) {
    const data = await fs.readFile(path.join(dir, item.name));
    if (hash(data) !== item.sha256 || (item.size && data.length !== item.size)) throw new Error('SOURCE_HASH_MISMATCH: ' + item.name);
  }
  const build = JSON.parse(await fs.readFile(path.join(dir, 'libriichi-build.json'), 'utf8'));
  if (build.sourceCommit !== source.sourceCommit || build.sha256 !== source.native.sha256 || build.abi !== source.native.abi || JSON.stringify(build.features) !== '["pymod"]' || hash(await fs.readFile(path.join(dir, 'libriichi.pyd'))) !== build.sha256) throw new Error('NATIVE_BUILD_MISMATCH');
}
async function download(url, target) {
  if (process.platform === 'win32') {
    const quote = s => "'" + s.replaceAll("'", "''") + "'";
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri ${quote(url)} -OutFile ${quote(target)} -TimeoutSec 180`],
    { windowsHide: true, encoding: 'utf8', timeout: 190000 });
    if (result.error || result.status !== 0) throw new Error('DOWNLOAD_FAILED');
  } else {
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('DOWNLOAD_FAILED');
    await fs.writeFile(target, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
  }
}
async function setup(dir, { profile = source.profile } = {}) {
  const source = sourceForProfile(profile);
  await fs.mkdir(dir, { recursive: true });
  for (const item of source.files) {
    const target = path.join(dir, item.name);
    try {
      if (hash(await fs.readFile(target)) !== item.sha256) throw new Error('EXISTING_FILE_MISMATCH: ' + item.name);
      continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(dir, '.mortal-download-' + crypto.randomUUID());
    try {
      await download(item.url || `https://raw.githubusercontent.com/Equim-chan/Mortal/${source.sourceCommit}/${item.upstream}`, temporary);
      const data = await fs.readFile(temporary);
      if (hash(data) !== item.sha256 || (item.size && data.length !== item.size)) throw new Error('DOWNLOAD_HASH_MISMATCH');
      // link is atomic and refuses to replace a competing/unknown destination.
      await fs.link(temporary, target);
    } finally { await fs.rm(temporary, { force: true }); }
    console.log('Verified: ' + item.name);
  }
  console.log('Model/source setup complete. Runtime/native library must be explicitly prepared separately; see docs/guides/MORTAL_V4.md.');
}
async function check(options, keep = false) {
  await verifyFiles(options.dir, options.profile);
  const runner = createMortalRunner(runtimeConfig(options));
  const started = Date.now();
  try {
    const identity = await runner.start();
    const loadedMs = Date.now() - started;
    const results = [];
    for (let seat = 0; seat < 4; seat++) {
      const request = sampleRequest(), hand = request.events[1].tehais[0];
      request.seat = seat; request.events[0].id = seat; request.events[1].oya = seat; request.events[1].kyoku = seat + 1;
      request.events[1].tehais = Array.from({ length: 4 }, (_, n) => n === seat ? hand : Array(13).fill('?'));
      request.events[2].actor = seat;
      const result = await runner.infer(request);
      if (result.action.actor !== seat || result.action.type !== 'dahai' || !hand.concat('1m').includes(result.action.pai)) throw new Error('REAL_INFERENCE_INVALID_ACTION');
      results.push(result.action);
    }
    console.log(JSON.stringify({ identity, inferenceVerified: true, loadedMs, elapsedMs: Date.now() - started, actions: results }));
    if (keep) return runner;
  } catch (error) { await runner.close(); throw error; }
  if (!keep) await runner.close();
}
async function main(argv) {
  const args = [...argv], mode = args.shift(), options = { port: 17342, profile: 'voidshine-298k' };
  if (!mode || mode === '--help') {
    console.log('Usage: npm run engine:mortal -- catalog\n       npm run engine:mortal -- setup|check|serve --profile voidshine-298k|yuchen-582500 --dir DIR [--python PYTHON_EXE] [--port 17342]\nInstall/remove management: npm run engine:manager -- --toolkit DIR --root INSTALL_ROOT\nExplicit opt-in only. No model/environment downloads during install/build/test. serve prints a local bearer token.'); return;
  }
  if (mode === 'catalog') { console.log(JSON.stringify(catalog)); return; }
  if (!['setup', 'check', 'serve'].includes(mode)) throw new Error('INVALID_COMMAND');
  while (args.length) {
    const flag = args.shift();
    if (!['--dir', '--python', '--port', '--profile'].includes(flag) || !args.length) throw new Error('INVALID_ARGUMENTS');
    options[flag.slice(2)] = flag === '--port' ? Number(args.shift()) : args.shift();
  }
  sourceForProfile(options.profile);
  if (!options.dir || !Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('INVALID_ARGUMENTS');
  options.dir = path.resolve(options.dir);
  if (mode === 'setup') return setup(options.dir, options);
  const runner = await check(options, mode === 'serve');
  if (mode !== 'serve') return;
  let service;
  try {
    service = createEngineServer({ runner, token: process.env.MJAI_ENGINE_TOKEN });
    await new Promise((resolve, reject) => { service.server.once('error', reject); service.server.listen(options.port, '127.0.0.1', resolve); });
  }
  catch (error) { await runner.close(); throw error; }
  const { server, token, close } = service;
  server.once('close', () => { runner.close().catch(() => {}); });
  const shutdown = () => { close().catch(() => { process.exitCode = 1; }); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
  console.log(`Engine bridge: http://127.0.0.1:${server.address().port}/analyze`);
  console.log(`Bearer token: ${token}`);
}
module.exports = { source, sourceForProfile, catalog, runtimeConfig, verifyFiles, download, setup, check, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(/^[A-Z_]+(?::|$)/.test(error.message) ? error.message : 'MORTAL_PROFILE_FAILED'); process.exitCode = 1; });
