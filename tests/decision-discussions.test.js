const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../extension/decision-discussions.js');
const S = require('../extension/state.js');
const C = require('../extension/collector/snapshot-adapter.js');
function fixture(options) {
  let saved = {}, fail = false;
  const storage = { async get() { return structuredClone(saved); }, async set(value) { await new Promise(r => setImmediate(r)); if (fail) throw Error('disk'); saved = structuredClone(value); } };
  return { storage, store: D.create({ storage, ...options }), fail: value => fail = value };
}
function input(position = 1, type = 'combined') {
  const state = S.initial('live', 1);
  Object.assign(state, { round: { wind: 0, index: 0 }, scores: [25000,25000,25000,25000], phase: 'playing', lastStep: position,
    selfHand: ['1m','2m','3m','4m','5m','6m','7m','8m','9m','1s','2s','3s','4z','4z'] });
  return { snapshot: C.snapshot(state, { game: true, hand: true, rivers: 'all' }),
    context: { identity: { matchId: 'match', roundStartId: 'start' }, position }, type,
    analysis: { model: 'fixture', result: { danger: [], efficiency: [], decision: { action: 'attack', tile: '1m', reasons: ['original'] }, limitations: [] } } };
}
test('same turn distinct event/type/round/match are separate; original snapshot and analysis are immutable', async () => {
  const { store } = fixture();
  const a = input(), b = input(2), c = input(1, 'danger'), d = input(), e = input();
  d.context.identity.matchId = 'another'; e.context.identity.roundStartId = 'second';
  const records = await Promise.all([a,b,c,d,e].map(x => store.save(x)));
  assert.equal(new Set(records.map(r => r.id)).size, 5);
  a.analysis.result.decision.reasons = ['changed']; a.snapshot.selfHand = [];
  const original = await store.save({ ...input(), analysis: a.analysis });
  assert.equal(original.analysis.result.decision.reasons[0], 'original');
  assert.equal(original.snapshot.selfHand.length, 14);
});
test('cross-turn branches only include original snapshot and that decision chat, even after restart', async () => {
  const f = fixture(), a = await f.store.save(input()), b = await f.store.save(input(2));
  await f.store.ask(a.id, 'why old?', 'a');
  await f.store.answer(a.id, 'a', { ok: true, result: { decision: { reasons: ['old answer'] } } });
  await f.store.ask(b.id, 'why new?', 'b');
  const restored = D.create({ storage: f.storage });
  const branch = await restored.context(a.id);
  assert.equal(branch.baseline.snapshot.lastStep, 1);
  assert.match(JSON.stringify(branch), /why old/);
  assert.doesNotMatch(JSON.stringify(branch), /why new/);
  assert.equal((await restored.get(a.id)).chat[0].status, 'completed');
});
test('collapse, remove and late answers preserve history without repinning; reopen resumes it', async () => {
  const { store } = fixture(), a = await store.save(input());
  await store.ask(a.id, 'why?', 'q');
  await store.patch(a.id, { collapsed: true });
  assert.equal((await store.get(a.id)).chat.length, 1);
  await store.patch(a.id, { panel: false });
  const completed = await store.answer(a.id, 'q', { ok: true, result: input().analysis.result });
  assert.equal(completed.panel, false); assert.equal(completed.collapsed, true);
  assert.equal(completed.removed, true);
  await store.patch(a.id, { panel: true, collapsed: false });
  assert.equal((await store.get(a.id)).chat[0].status, 'completed');
  assert.equal((await store.get(a.id)).removed, false);
});
test('concurrent writes do not lose cards, chat or panel removals and survive loading', async () => {
  const f = fixture(), cards = await Promise.all(Array.from({length: 12}, (_, i) => f.store.save(input(i))));
  await Promise.all(cards.map((c,i) => f.store.ask(c.id, 'question ' + i, String(i))));
  await Promise.all(cards.flatMap((c,i) => [f.store.patch(c.id, { panel: false }), f.store.answer(c.id, String(i), { ok: true, result: input().analysis.result })]));
  const loaded = await D.create({ storage: f.storage }).list();
  assert.equal(loaded.length, 12); assert.ok(loaded.every(r => !r.panel && r.chat[0].status === 'completed'));
});
test('worker restart turns unfinished questions into retryable failures without erasing completed chat', async () => {
  const f = fixture(), a = await f.store.save(input());
  await f.store.ask(a.id, 'interrupted', 'q');
  const restored = D.create({ storage: f.storage }); await restored.recover();
  const record = await restored.get(a.id);
  assert.equal(record.panel, true); assert.equal(record.chat[0].status, 'failed');
  assert.match(record.chat[0].error, /重启/);
  await restored.ask(a.id, 'retry', 'q2');
  assert.equal((await restored.get(a.id)).chat.length, 2);
});
test('capacity evicts only unasked old analyses and rolls back if all records have chat', async () => {
  const { store } = fixture({ maxRecords: 2 });
  const a = await store.save(input()), b = await store.save(input(2));
  await store.ask(a.id, 'keep forever within local capacity', 'a');
  const c = await store.save(input(3));
  assert.deepEqual((await store.list()).map(r => r.id), [a.id,c.id]);
  await store.ask(c.id, 'keep too', 'c');
  await assert.rejects(store.save(input(4)), /空间已满/);
  assert.equal((await store.list()).length, 2); assert.equal((await store.get(a.id)).chat.length, 1);
  assert.notEqual(b.id, c.id);
});
test('failed writes roll back in-memory mutation; subsequent writes succeed', async () => {
  const f = fixture(), a = await f.store.save(input()); f.fail(true);
  await assert.rejects(f.store.ask(a.id, 'not saved', 'q'), /disk/);
  assert.equal((await f.store.get(a.id)).chat.length, 0);
  f.fail(false); await f.store.ask(a.id, 'saved', 'q2');
  assert.equal((await D.create({ storage: f.storage }).get(a.id)).chat[0].question, 'saved');
});
test('storage whitelists snapshots and identity and excludes arbitrary context/events secrets', async () => {
  const { store } = fixture(), raw = input();
  raw.snapshot.secret = 'secret'; raw.context.apiKey = 'secret'; raw.context.events = [{ tile: '9p', secret: 'secret' }]; raw.context.identity.apiKey = 'secret';
  const record = await store.save(raw);
  assert.doesNotMatch(JSON.stringify(record), /secret/);
});

test('explicit clear removes history including asked cards on subsequent startup', async () => {
  const f = fixture(), a = await f.store.save(input());
  await f.store.ask(a.id, 'clear this too', 'q');
  await f.store.clear();
  assert.deepEqual(await D.create({ storage: f.storage }).list(), []);
});


test('engine actions survive storage reload and remain structured in follow-up context without upstream metadata', async () => {
  const { store, storage } = fixture(); const raw = input();
  raw.analysis.engine = { format: 'majsoul-engine-result-v1', phase: 'response', action: { type: 'chi', actor: 1, target: 0, pai: '3m', consumed: ['1m','2m'], meta: { secret: 'PRIVATE' } }, followUp: null, meta: 'PRIVATE', limitations: ['已校验'] };
  raw.analysis.result.decision.tile = null;
  const saved = await store.save(raw); const restored = D.create({ storage });
  const records = await restored.list(); assert.equal(records[0].analysis.engine.action.type, 'chi');
  const context = await restored.context(saved.id); const answer = JSON.parse(context.timeline[0].answer);
  assert.deepEqual(answer.engine.action, { type: 'chi', actor: 1, target: 0, pai: '3m', consumed: ['1m','2m'] });
  assert.equal(answer.engine.phase, 'response'); assert.doesNotMatch(context.timeline[0].answer, /PRIVATE|meta/);
});
