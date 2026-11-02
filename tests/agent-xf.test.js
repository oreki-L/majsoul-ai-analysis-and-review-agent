'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Agent = require('../extension/agent.js');
const X = require('../extension/xf-context.js');
const A = require('../extension/analysis.js');
const C = require('../extension/contracts/snapshot.js');
const { createStore } = require('../extension/round-context.js');
const { fixture } = require('../agent/eval.cjs');
const parse = m => JSON.parse(m.content.slice(m.content.indexOf('\n') + 1));
function snapshot(position) {
  const s = fixture('123m123p123s111z20p'); s.source = 'live'; s.lastStep = position; s.selfDrawnTile = '0p'; s.game.remaining = 70 - position;
  return s;
}
async function capture(s, context, options = {}) {
  let sent;
  const task = options.task || 'combined';
  const result = await Agent.run({ snapshot: s, task, contextPolicy: 'live-xf', sessionContext: context, ...options,
    transport: async () => { throw Error('No model network expected'); }, runtime: { run: async request => {
      sent = request;
      return { text: JSON.stringify({ task, danger: [], efficiency: [], decision: { action: 'unknown', tile: null, reasons: ['仅模拟响应'] }, limitations: [] }), turns: 1, toolCalls: 0 };
    } } });
  return { sent, result };
}
const session = s => ({ id: 'synthetic-round', lane: 'live', baseline: { snapshot: snapshot(0), position: 0, origin: 'round-start' }, checkpoint: { position: s.lastStep }, capturedStates: [], events: [], timeline: [] });

test('X-F hashes match SHA-256 canonical JSON in Node and browser globals', () => {
  const browser = { TextEncoder, structuredClone, MJSnapshotContract: C, MJAnalysis: A };
  vm.runInNewContext(readFileSync(require.resolve('../extension/xf-context.js'), 'utf8'), browser);
  for (const value of ['', '中文🀄', { z: [1, null, true], a: 'x' }, Array.from({ length: 200 }, (_, i) => i)]) {
    const canonical = require('../benchmark/core.cjs').canonicalStringify(value);
    const expected = crypto.createHash('sha256').update(canonical).digest('hex');
    assert.equal(X.stableHash(value), expected); assert.equal(browser.MJXfContext.stableHash(value), expected);
  }
});

test('X-F retains every captured old fact, important state differences and current catalog without old opinions or future states', async () => {
  const s = snapshot(12), ctx = session(s);
  ctx.capturedStates = Array.from({ length: 14 }, (_, i) => ({ position: i, snapshot: snapshot(i) }));
  ctx.capturedStates[5].snapshot.game.doras = ['2p'];
  ctx.timeline = [{ type: 'exchange', answer: 'PRIVATE_OLD_OPINION', request: 'PRIVATE_OLD_REQUEST' }];
  ctx.events = [{ kind: 'DiscardTile', source: 'live', position: 5, seat: 1, tile: '1m', riichi: true },
    { kind: 'DiscardTile', source: 'live', position: 13, seat: 2, tile: '7z', riichi: true }];
  const before = structuredClone(ctx), { sent, result } = await capture(s, ctx);
  assert.deepEqual(ctx, before);
  const facts = parse(sent.messages.find(m => m.content.startsWith('全部旧局面代码事实')));
  assert.deepEqual(facts.states.map(v => v.position), Array.from({ length: 12 }, (_, i) => i));
  assert.ok(facts.fieldDictionary.some(f => f.path.join('/') === 'game/remaining' && f.value === 69));
  const events = parse(sent.messages[0]);
  assert.ok(events.some(e => e.kind === 'dora-change' && e.position === 5));
  assert.ok(events.some(e => e.kind === 'DiscardTile' && e.position === 5));
  assert.ok(events.every(e => e.position <= 12));
  const current = parse(sent.messages.at(-2)), catalog = parse(sent.messages.at(-1));
  assert.deepEqual(current.snapshot, C.cleanSnapshot(s));
  assert.equal(catalog.version, 'phase3-compact-facts/1');
  assert.equal(catalog.binding.position, 12);
  assert.ok(Object.values(catalog.facts).some(v => Array.isArray(v) && v.includes('0p')));
  assert.equal(result.sessionTurn.request, sent.messages.at(-2).content);
  assert.doesNotMatch(JSON.stringify(sent.messages), /PRIVATE_OLD|factClaims|"position":13/);
  assert.deepEqual(sent.budget, { maxTurns: 3, maxToolCalls: 4, maxTokens: 131072, timeoutMs: 25000 });
});

test('round storage exposes all captured states beyond its eight navigation checkpoints', async () => {
  const store = createStore(); let handle;
  for (let i = 0; i < 12; i++) handle = await store.observe({ snapshot: snapshot(i), lane: 'live', task: 'combined', identity: { matchId: 'synthetic-match', roundStartId: 'round', viewId: 'view' } });
  const ctx = await store.getContext(handle);
  assert.equal(ctx.checkpoints.length, 8); assert.equal(ctx.capturedStates.length, 12);
  const { sent } = await capture(snapshot(11), ctx);
  assert.equal(parse(sent.messages.find(m => m.content.startsWith('全部旧局面代码事实'))).states.length, 11);
});

test('historical operation eligibility is stripped and authorization mismatches fail before dispatch', async () => {
  const s = snapshot(2), ctx = session(s);
  ctx.baseline.snapshot.availableActions = { seat: 0, lastStep: 0, types: [1] };
  const { sent } = await capture(s, ctx);
  assert.doesNotMatch(JSON.stringify(sent.messages), /availableActions/);
  ctx.baseline.snapshot.rivers.pop();
  await assert.rejects(capture(s, ctx), /authorization/);
});

test('unsupported tasks and revoked fields use NED; manual and question lanes retain full context', async () => {
  const s = snapshot(2);
  const danger = await capture(s, session(s), { task: 'danger' });
  assert.match(danger.sent.messages[0].content, /本次冻结状态的导航与本地证据/);
  const revoked = structuredClone(s); delete revoked.selfHand;
  const { sent } = await capture(revoked, session(s));
  assert.doesNotMatch(JSON.stringify(sent.messages), /事实目录|全部旧局面/);
  assert.equal(parse(sent.messages.at(-1)).snapshot.selfHand, undefined);
  for (const options of [{ question: '为什么？' }, { sessionContext: { ...session(s), lane: 'manual-review' } }]) {
    const { sent } = await capture(s, session(s), options);
    assert.match(sent.messages[0].content, /本小局已授权初始基线/);
    assert.doesNotMatch(JSON.stringify(sent.messages), /当前确定性事实目录/);
  }
});
