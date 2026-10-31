'use strict';
// The append log is authoritative. Checkpoints and reports are disposable indexes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { stableHash } = require('./core.cjs');
const RETRYABLE = new Set(['EBUSY', 'EPERM', 'EACCES']);
function localWrite(operation, retries = 5) {
  for (let n = 0;; n++) try { return operation(); } catch (error) {
    if (!RETRYABLE.has(error.code) || n >= retries) throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(250, 10 * 2 ** n));
  }
}
function append(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  // Retry open only: repeating a partially written append could duplicate bytes.
  const fd = localWrite(() => fs.openSync(filename, 'a', 0o600));
  try { let offset = 0; while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function readEvents(filename, { repairTail = false } = {}) {
  if (!fs.existsSync(filename)) return [];
  const bytes = fs.readFileSync(filename), end = bytes.lastIndexOf(10) + 1;
  if (end !== bytes.length && repairTail) { const tail = bytes.subarray(end); fs.writeFileSync(filename + '.tail.' + crypto.randomUUID(), tail, { mode: 0o600 }); fs.truncateSync(filename, end); }
  const rows = bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean).map(JSON.parse), out = [];
  let previous = null;
  for (const row of rows) {
    if (out.at(-1)?.hash === row.hash) continue;
    const { hash, ...body } = row;
    if (body.sequence !== out.length + 1 || body.previous !== previous || stableHash(body) !== hash) throw new Error('Event log corruption; admission blocked');
    out.push(row); previous = hash;
  }
  return out;
}
function journal(filename) {
  const events = readEvents(filename, { repairTail: true });
  let objects;
  function store() { return objects ??= objectStore(filename + '.objects.jsonl'); }
  return { events, write(kind, payload) {
    if (kind === 'state' && payload.state) payload = { event: payload.event, stateRoot: store().encode(payload.state) };
    if (kind === 'budget' && payload.snapshot) payload = { snapshotRoot: store().encode(payload.snapshot) };
    const body = { sequence: events.length + 1, previous: events.at(-1)?.hash ?? null, kind, at: new Date().toISOString(), payload: JSON.parse(JSON.stringify(payload)) };
    const row = { ...body, hash: stableHash(body) }; append(filename, row); events.push(row); return row;
  }, latestState() { const last = events.findLast(e => e.kind === 'state'); return last?.payload.stateRoot ? store().decode(last.payload.stateRoot) : last?.payload.state ?? null; }, latestBudget() { const last = events.findLast(e => e.kind === 'budget'); return last?.payload.snapshotRoot ? store().decode(last.payload.snapshotRoot) : last?.payload.snapshot ?? null; } };
}
// A persistent Merkle tree stores unchanged prompts/snapshots once. Hash buckets and
// chunked vectors prevent growing job maps/history arrays from becoming full snapshots.
// The in-memory index retains byte offsets only, not old decoded run states.
function objectStore(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const index = new Map(), signatures = new Map(), frozenRefs = new WeakMap(); let size = 0;
  if (fs.existsSync(filename)) {
    const bytes = fs.readFileSync(filename), end = bytes.lastIndexOf(10) + 1;
    if (end !== bytes.length) { fs.writeFileSync(filename + '.tail.' + crypto.randomUUID(), bytes.subarray(end)); fs.truncateSync(filename, end); }
    for (let start = 0; start < end;) {
      const next = bytes.indexOf(10, start), row = JSON.parse(bytes.subarray(start, next).toString('utf8'));
      if (stableHash(row.node) !== row.hash) throw new Error('Durable object corruption; admission blocked');
      index.set(row.hash, { offset: start, length: next - start }); signatures.set(JSON.stringify(row.node), row.hash); start = next + 1;
    }
    size = end;
  }
  function encode(value) {
    const pending = new Map(), frozenPending = [];
    function node(data) { const signature = JSON.stringify(data); let hash = signatures.get(signature); if (!hash) { hash = stableHash(data); signatures.set(signature, hash); } if (!index.has(hash)) pending.set(hash, data); return { ref: hash }; }
    function object(entries, depth = 0) {
      if (entries.length <= 16) return node({ type: 'object', entries: entries.map(([key, item]) => [key, visit(item)]) });
      const buckets = new Map();
      for (const entry of entries) { const bucket = crypto.createHash('sha256').update(entry[0]).digest('hex')[depth]; const list = buckets.get(bucket) ?? []; list.push(entry); buckets.set(bucket, list); }
      return node({ type: 'map', buckets: [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, bucket]) => [key, object(bucket, depth + 1)]) });
    }
    function vector(items) {
      if (items.length <= 32) return node({ type: 'array', items });
      const chunks = []; for (let i = 0; i < items.length; i += 32) chunks.push(node({ type: 'array', items: items.slice(i, i + 32) }));
      return node({ type: 'concat', chunks: vector(chunks) });
    }
    function visit(item) {
      if (item && typeof item === 'object' && Object.isFrozen(item)) { const cached = frozenRefs.get(item); if (cached && index.has(cached.ref)) return cached; }
      const result = visitValue(item);
      if (item && typeof item === 'object' && Object.isFrozen(item)) frozenPending.push([item, result]);
      return result;
    }
    function visitValue(item) {
      if (typeof item === 'string' && item.length > 256) return node({ type: 'string', value: item });
      if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) return { value: item };
      if (Array.isArray(item)) return vector(item.map(visit));
      return object(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
    }
    const root = visit(value);
    if (pending.size) {
      const fd = localWrite(() => fs.openSync(filename, 'a', 0o600)); const offsets = [];
      try {
        for (const [hash, data] of pending) {
          const bytes = Buffer.from(JSON.stringify({ hash, node: data }) + '\n'); let offset = 0;
          while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
          offsets.push([hash, { offset: size, length: bytes.length - 1 }]); size += bytes.length;
        }
        fs.fsyncSync(fd); offsets.forEach(([hash, position]) => index.set(hash, position));
      } finally { fs.closeSync(fd); }
    }
    frozenPending.forEach(([value, reference]) => frozenRefs.set(value, reference));
    return root;
  }
  function decode(root) {
    const fd = fs.openSync(filename, 'r'), cache = new Map();
    function visit(reference) {
      if (Object.hasOwn(reference, 'value')) return reference.value;
      if (cache.has(reference.ref)) return structuredClone(cache.get(reference.ref));
      const position = index.get(reference.ref); if (!position) throw new Error('Missing durable object; admission blocked');
      const bytes = Buffer.alloc(position.length); fs.readSync(fd, bytes, 0, bytes.length, position.offset); const row = JSON.parse(bytes);
      if (row.hash !== reference.ref || stableHash(row.node) !== row.hash) throw new Error('Durable object hash mismatch');
      const data = row.node;
      const result = data.type === 'string' ? data.value : data.type === 'array' ? data.items.map(visit) : data.type === 'concat' ? visit(data.chunks).flat() : data.type === 'map' ? Object.assign({}, ...data.buckets.map(([, r]) => visit(r))) : Object.fromEntries(data.entries.map(([key, r]) => [key, visit(r)]));
      cache.set(reference.ref, result); return result;
    }
    try { return visit(root); } finally { fs.closeSync(fd); }
  }
  return { encode, decode };
}
function processIdentity(pid) {
  try {
    if (process.platform === 'win32') return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(' ').slice(21, 22).join('');
  } catch { return null; }
}
function acquireLock(filename, recover = false) {
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error('Cannot establish process identity');
  if (fs.existsSync(filename)) {
    let old; try { old = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { throw new Error('Unrecognized lock; manual inspection required'); }
    if (!recover || !Number.isSafeInteger(old.pid) || !old.identity || !old.token) throw new Error('Run locked');
    const current = processIdentity(old.pid);
    // A live PID with a different creation time is a reused PID, not this owner.
    if (current === old.identity) throw new Error('Run already active');
    if (!current) { try { process.kill(old.pid, 0); throw new Error('Owner identity unavailable'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    fs.renameSync(filename, filename + '.stale.' + crypto.randomUUID());
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const owner = { pid: process.pid, identity, token: crypto.randomUUID() }, fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return () => { if (JSON.parse(fs.readFileSync(filename, 'utf8')).token === owner.token) fs.unlinkSync(filename); };
}
module.exports = { localWrite, append, readEvents, journal, objectStore, acquireLock, processIdentity };
