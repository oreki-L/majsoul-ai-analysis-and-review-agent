'use strict';
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const Mjai = require('../extension/adapters/mjai.js');
const source = require('./mortal-source.json');
const {sourceForProfile}=require('./mortal-profile.cjs');
const fail = code => Object.assign(new Error(code), { code, ...(code === 'ABORTED' ? { name: 'AbortError' } : {}) });

async function killTree(child) {
  if (!child?.pid) return;
  let timer;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      const done = () => { clearTimeout(timer); resolve(); };
      timer = setTimeout(() => { killer.kill(); done(); }, 3000);
      killer.once('error', done); killer.once('close', done);
    });
  } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      timer = setTimeout(() => { child.removeListener('close', done); reject(fail('CLEANUP_TIMEOUT')); }, 2000);
      child.once('close', done);
    });
  }
}

function validateIdentity(identity, profile = source.profile) {
  const source = sourceForProfile(profile);
  if (!identity || identity.model !== source.model || identity.checkpoint !== source.files[0].sha256 ||
      identity.modelRevision !== source.modelRevision || identity.sourceCommit !== source.sourceCommit ||
      identity.runtime !== 'win64-py3119-torch270cpu-np1262-' + source.native.sha256.slice(0,16)) throw fail('IDENTITY_MISMATCH');
  return Object.freeze({ ...identity });
}

function createMortalRunner({ command, args, profile = source.profile, timeoutMs = 20000, startupMs = 120000, maxOutputBytes = 65536, restartLimit = 3 } = {}) {
  const source = sourceForProfile(profile);
  if (typeof command !== 'string' || !Array.isArray(args) || args.some(a => typeof a !== 'string') ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 || !Number.isInteger(startupMs) || startupMs < 1 || startupMs > 300000) throw fail('INVALID_CONFIG');
  let child = null, pending = null, boot = null, closed = false, identity = null, stopping = null, restarts = 0, restartTimer;
  const schedule = () => {
    if (closed || restarts >= restartLimit) return;
    restartTimer = setTimeout(() => { restarts++; start().catch(() => {}); }, 250 * 2 ** restarts);
  };
  async function stop(error = fail('UNAVAILABLE')) {
    if (stopping) return stopping;
    identity = null;
    const old = child; child = null;
    const current = pending, starting = boot; pending = null; boot = null;
    clearTimeout(current?.timer); clearTimeout(starting?.timer);
    current?.signal?.removeEventListener('abort', current.abort);
    stopping = killTree(old).catch(() => { closed = true; error = fail('CLEANUP_TIMEOUT'); }).finally(() => {
      stopping = null; current?.reject(error); starting?.reject(error);
    });
    return stopping;
  }
  function start() {
    if (closed) return Promise.reject(fail('CLOSED'));
    if (identity) return Promise.resolve(identity);
    if (boot) return boot.promise;
    if (stopping) return stopping.then(start);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    boot = { promise, resolve, reject, timer: setTimeout(() => { stop(fail('STARTUP_TIMEOUT')).then(schedule); }, startupMs) };
    let bytes = 0, text = '';
    const processChild = spawn(command, args, { windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child = processChild;
    const broken = code => { if (child === processChild) stop(fail(code)).then(schedule); };
    processChild.once('error', () => broken('SPAWN_FAILED'));
    processChild.once('close', () => broken('WORKER_EXIT'));
    processChild.stdin.on('error', () => broken('INPUT_FAILED'));
    processChild.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > maxOutputBytes) broken('OUTPUT_LIMIT'); });
    processChild.stdout.setEncoding('utf8');
    processChild.stdout.on('data', chunk => {
      if (child !== processChild) return;
      bytes += Buffer.byteLength(chunk); text += chunk;
      if (bytes > maxOutputBytes) { broken('OUTPUT_LIMIT'); return; }
      while (text.includes('\n')) {
        const index = text.indexOf('\n'), line = text.slice(0, index); text = text.slice(index + 1);
        try {
          const value = JSON.parse(line);
          if (value.protocol !== source.protocol) throw fail('PROTOCOL_MISMATCH');
          if (boot) {
            if (value.type !== 'ready') throw fail('PROTOCOL_MISMATCH');
            identity = validateIdentity(value.identity, profile);
            const ready = boot; boot = null; clearTimeout(ready.timer); bytes = 0; ready.resolve(identity);
          } else {
            if (pending && value.type === 'error' && value.requestId === pending.id && value.code === 'UNSUPPORTED_TRAILING_ANNOUNCEMENT') {
              const current = pending; pending = null; clearTimeout(current.timer); current.signal?.removeEventListener('abort', current.abort);
              bytes = 0; current.reject(fail(value.code)); continue;
            }
            if (!pending || value.type !== 'result' || value.requestId !== pending.id || !value.action || typeof value.action.type !== 'string' ||
                (value.followUp && (value.action.type !== 'reach' || value.followUp.type !== 'dahai' || value.followUp.actor !== value.action.actor))) throw fail('PROTOCOL_MISMATCH');
            const current = pending; pending = null; clearTimeout(current.timer); current.signal?.removeEventListener('abort', current.abort);
            bytes = 0; restarts = 0; current.resolve({ action: value.action, ...(value.followUp ? { followUp: value.followUp } : {}), identity });
          }
        } catch (error) { broken(error.code || 'INVALID_OUTPUT'); return; }
      }
    });
    return promise;
  }
  return {
    start,
    get identity() { return identity; },
    get pid() { return child?.pid; },
    get ready() { return !!identity && !stopping; },
    async infer(raw, { signal } = {}) {
      const request = Mjai.validateRequest(raw);
      if (signal?.aborted) throw fail('ABORTED');
      if (!identity || stopping || closed) throw fail('UNAVAILABLE');
      if (pending) throw fail('BUSY');
      const id = crypto.randomUUID(), input = JSON.stringify({ protocol: source.protocol, requestId: id, seat: request.seat, events: request.events }) + '\n';
      if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw fail('INPUT_LIMIT');
      return new Promise((resolve, reject) => {
        const abort = () => { restarts = 0; stop(fail('ABORTED')).then(schedule); };
        pending = { id, resolve, reject, signal, abort, timer: setTimeout(() => { stop(fail('TIMEOUT')).then(schedule); }, timeoutMs) };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        child.stdin.write(input);
      });
    },
    async close() { closed = true; clearTimeout(restartTimer); await stop(fail('CLOSED')); }
  };
}
module.exports = { createMortalRunner, validateIdentity, killTree };
