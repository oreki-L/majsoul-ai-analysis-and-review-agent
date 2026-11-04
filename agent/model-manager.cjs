'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const catalog = require('./mortal-catalog.json');
const { createInstallation, verifyOwned } = require('./model-installation.cjs');
const { createEngineServer } = require('./engine-server.cjs');
const fail = code => Object.assign(new Error(code), { code });
function publicError(e) { return /^[A-Z][A-Z0-9_]{1,70}$/.test(e.code || e.message) ? (e.code || e.message) : 'MODEL_OPERATION_FAILED'; }
async function startBridge(installation, id, signal, { onStage = () => {} } = {}) {
  const dir = installation.modelDir(id), python = installation.pythonFor(id);
  onStage('verify-model');
  await verifyOwned(installation.root, dir, id);
  onStage('verify-runtime');
  await installation.verifyRuntime(id);
  onStage('load-model');
  let runner, identity;
  if (id === 'akagi-v2') {
    const local = require('./akagi-local.cjs');
    const config = local.runtimeConfig({ dir, python }); config.args.unshift('-B');
    const inner = require('./mjai-process.cjs').createRunner(config);
    const controllers = new Set(); let closed = false;
    runner = { async infer(request, { signal: external } = {}) {
      if (closed) throw fail('CLOSED'); const controller = new AbortController(); controllers.add(controller);
      try { return await inner.infer(request, { signal: external ? AbortSignal.any([external, controller.signal]) : controller.signal }); }
      finally { controllers.delete(controller); }
    }, async close() { closed = true; for (const controller of controllers) controller.abort(); while (controllers.size) await new Promise(r => setTimeout(r, 10)); } };
    const source = local.source;
    try {
      const request = local.sampleRequest(), result = await runner.infer(request, { signal });
      if (result.action.type !== 'dahai' || result.action.actor !== 0 || !request.events[1].tehais[0].concat('1m').includes(result.action.pai)) throw fail('REAL_INFERENCE_INVALID_ACTION');
    } catch (e) { await runner.close(); throw e; }
    identity = { model: source.profile, runtime: 'windows-py311-torch2.7.0', checkpoint: source.files.find(f => f.name === 'mortal.pth').sha256, sourceCommit: source.commit };
  } else {
    const local = require('./mortal-local.cjs');
    const config = local.runtimeConfig({ dir, python, profile: id }); config.args.unshift('-B');
    runner = require('./mortal-process.cjs').createMortalRunner(config);
    const abort = () => { runner.close().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try { await runner.start(); onStage('warmup'); await runner.infer(require('./mortal-sample.cjs').sampleRequest(), { signal }); }
    catch (e) { await runner.close(); throw e; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  if (signal?.aborted) { await runner.close(); throw fail('ABORTED'); }
  const service = createEngineServer({ runner, identity });
  onStage('listen');
  try { await new Promise((resolve, reject) => { service.server.once('error', reject); service.server.listen(id === 'akagi-v2' ? 17341 : id === 'voidshine-298k' ? 17342 : 17344, '127.0.0.1', resolve); }); }
  catch (e) { await service.close(); throw e; }
  return { ...service, get pid() { return runner.pid; }, get ready() { return runner.ready !== false; }, url: `http://127.0.0.1:${service.server.address().port}/analyze` };
}
async function createManager({ root = path.join(__dirname, '../research/evidence/managed-models'), toolkit, port = 17343, token = crypto.randomBytes(32).toString('hex'), installation, bridgeFactory = startBridge } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || typeof token !== 'string' || token.length < 16 || /[\r\n]/.test(token)) throw fail('INVALID_CONFIGURATION');
  installation ||= createInstallation({ root, toolkit });
  let operation = null, bridge = { state: 'stopped', profile: null, url: null, token: null, error: null }, active = null, pending = null, closing = false;
  const states = new Map();
  const runtimeStates = new Map();
  async function refreshRuntimes() { for (const family of new Set(catalog.models.map(p => p.runtimeFamily).filter(Boolean))) runtimeStates.set(family, installation.runtimeStatus ? await installation.runtimeStatus(family) : { installed: false, state: 'not-installed' }); }
  for (const p of catalog.models) states.set(p.id, await installation.inspect(p.id));
  await refreshRuntimes();
  const secret = Buffer.from('Bearer ' + token);
  function status() {
    const currentBridge = bridge.state === 'running' && active?.ready === false ? { ...bridge, state: 'error', error: 'ENGINE_UNAVAILABLE' } : bridge;
    return { format: 'local-model-manager-v1', defaultEnabled: false, root: installation.root, dataDir: installation.root, runningModelId: currentBridge.state === 'running' ? bridge.profile : null,
      models: catalog.models.map(p => {
        let source = {}; try { source = installation.sourceFor(p.id); } catch {}
        const weight = source.files?.find(f => /\.pth$/.test(f.name));
        return { ...p, installable: p.installable !== false && ['verified-experimental', 'verified'].includes(p.status), ...states.get(p.id), weightBytes: weight?.size || p.weightBytes || null, sourceUrl: source.repository?.startsWith('https:') ? source.repository : source.repository ? 'https://huggingface.co/' + source.repository : null, license: source.license || null, scope: p.scope || (p.id === 'akagi-v2' ? '四麻弱示例' : ['verified-experimental', 'verified'].includes(p.status) ? '四人半庄' : '适用范围待验证'), runtimeId: p.runtimeFamily || null, verification: p.status };
      }), runtimes: [...runtimeStates].map(([id, state]) => ({ id, ...state, models: catalog.models.filter(p => p.runtimeFamily === id).map(p => p.id), retainedOnModelDelete: true })), operation, bridge: { ...currentBridge } };
  }
  async function stop() { bridge = { ...bridge, state: active ? 'stopping' : 'stopped' }; if (active) await active.close(); active = null; bridge = { state: 'stopped', profile: null, url: null, token: null, error: null }; }
  function begin(action, id) {
    if (closing) throw fail('MANAGER_CLOSING');
    if (pending) throw fail('MANAGER_BUSY');
    const p = id && catalog.models.find(p => p.id === id);
    if (id && !p) throw fail('UNKNOWN_PROFILE');
    if (['install', 'start'].includes(action) && (p.installable === false || !['verified-experimental', 'verified'].includes(p.status))) throw fail('PROFILE_NOT_VERIFIED');
    if (action === 'start' && !states.get(id)?.installed) throw fail('MODEL_NOT_INSTALLED');
    const controller = new AbortController();
    operation = { id: crypto.randomUUID(), profile: id || null, action, state: 'running', error: null };
    if (id) states.set(id, { ...states.get(id), state: { install: 'installing', remove: 'removing', start: 'starting' }[action], error: null });
    pending = { controller, promise: null };
    pending.promise = (async () => {
      // Yield so the accepted response always exposes the running operation.
      await new Promise(resolve => setImmediate(resolve));
      let outcome = 'succeeded', failure = null;
      try {
        if (action === 'stop') await stop();
        else if (action === 'install') await installation.install(id, { signal: controller.signal });
        else if (action === 'remove') { if (bridge.profile === id) await stop(); await installation.remove(id); }
        else if (action === 'start') {
          await stop(); bridge = { state: 'starting', profile: id, url: null, token: null, error: null };
          active = await bridgeFactory(installation, id, controller.signal, { onStage(stage) { operation = { ...operation, stage, stageStartedAt: Date.now() }; } });
          bridge = { state: 'running', profile: id, url: active.url, token: active.token, error: null };
        }
      } catch (e) {
        const error = publicError(e); outcome = 'failed'; failure = error;
        if (id) states.set(id, { ...states.get(id), state: 'error', error });
        if (action === 'start') bridge = { state: 'error', profile: id, url: null, token: null, error };
      } finally {
        await refreshRuntimes();
        if (id && outcome !== 'failed') states.set(id, await installation.inspect(id));
        if (bridge.state === 'running') states.set(bridge.profile, { ...states.get(bridge.profile), state: 'running' });
        for (const [profile, state] of states) if (state.state === 'running' && bridge.profile !== profile) states.set(profile, { ...state, state: 'installed' });
        operation = { ...operation, state: outcome, error: failure }; pending = null;
      }
    })();
  }
  const server = http.createServer(async (req, res) => {
    const reply = (code, data, type = 'application/json') => {
      const body = type === 'application/json' ? JSON.stringify(data) : data;
      if (Buffer.byteLength(body) > 1024 * 1024) { res.writeHead(500); res.end(); return; }
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" }); res.end(body);
    };
    const host = '127.0.0.1:' + server.address().port;
    if (req.headers.host !== host || (req.headers.origin !== undefined && req.headers.origin !== 'http://' + host) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) { reply(403, { error: 'ORIGIN_REJECTED' }); return; }
    if (req.url.startsWith('/api/')) {
      const given = Buffer.from(req.headers.authorization || '');
      if (given.length !== secret.length || !crypto.timingSafeEqual(secret, given)) { reply(401, { error: 'UNAUTHORIZED' }); return; }
      if (req.method === 'GET' && req.url === '/api/status') { reply(200, status()); return; }
      if (req.method !== 'POST') { reply(405, { error: 'METHOD_NOT_ALLOWED' }); return; }
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') { reply(415, { error: 'JSON_REQUIRED' }); return; }
      try {
        let bytes = 0, text = '';
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024) { reply(413, { error: 'BODY_LIMIT' }); return; } text += chunk; }
        const body = JSON.parse(text); if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) { reply(400, { error: 'EMPTY_OBJECT_REQUIRED' }); return; }
        const match = /^\/api\/models\/([a-z0-9-]+)\/(install|remove|delete|start)$/.exec(req.url);
        if (req.url === '/api/stop') begin('stop');
        else if (match) begin(match[2] === 'delete' ? 'remove' : match[2], match[1]);
        else { reply(404, { error: 'NOT_FOUND' }); return; }
        reply(202, status());
      } catch (e) { const code = publicError(e); reply(code === 'MANAGER_BUSY' ? 409 : 400, { error: code }); }
      return;
    }
    const resources = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
    if (req.method !== 'GET' || !Object.hasOwn(resources, req.url)) { reply(404, { error: 'NOT_FOUND' }); return; }
    try { const [file, type] = resources[req.url]; reply(200, await fs.readFile(path.join(__dirname, 'model-manager-ui', file)), type); }
    catch { reply(404, { error: 'RESOURCE_NOT_FOUND' }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, token, status, async close() {
    closing = true; pending?.controller.abort(); if (pending) await pending.promise; await stop();
    server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve));
  } };
}
async function main(argv) {
  const options = {};
  if (argv.includes('--help')) { console.log('Usage: node agent/model-manager.cjs [--root MANAGED_DIR] [--toolkit LOCAL_TOOLKIT_DIR] [--port 17343]\nExplicit local manager only; no downloads or inference until requested in the UI.'); return; }
  while (argv.length) { const flag = argv.shift(); if (!['--root', '--toolkit', '--port'].includes(flag) || !argv.length) throw fail('INVALID_ARGUMENTS'); options[flag.slice(2)] = flag === '--port' ? Number(argv.shift()) : argv.shift(); }
  const manager = await createManager(options);
  console.log(`Model manager: http://127.0.0.1:${manager.server.address().port}/`);
  console.log(`Management bearer token (paste manually; not saved): ${manager.token}`);
  let stopping = false; const shutdown = () => { if (stopping) return; stopping = true; manager.close().catch(() => { process.exitCode = 1; }); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
}
module.exports = { createManager, startBridge, main };
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(publicError(e)); process.exitCode = 1; });
