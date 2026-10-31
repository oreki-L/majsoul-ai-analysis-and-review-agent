'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Core = require('../benchmark/core.cjs');
const Context = require('../benchmark/context.cjs');
const fixture = require('../benchmark/examples/dataset.synthetic.json');
const copy = value => structuredClone(value);
const dataset = () => Core.validateDataset(copy(fixture));
function setup(mode = 'raw') {
  const d = dataset(), round = d.rounds[0], node = round.decisions[2];
  const history = round.decisions.slice(0, 2).map(n => ({ ...n, decisionId: n.id, answer: { decision: { action: 'attack', tile: n.legalActions[0].tile, reasons: ['旧模型意见'] } }, request: { secret: 'STALE_REQUEST_SNAPSHOT' }, result: { secret: 'STALE_TOOL_RESULT' } }));
  const scheme = { id: 'test', context: { current: 'full', events: 'all', snapshots: { mode }, advice: { mode } } };
  return { scheme, node, history, events: round.events };
}
function payload(output) { return JSON.parse(output.messages[1].content); }
test('suite validates explicitly, normalizes defaults and compiles relative paths', () => {
  const raw = { schemaVersion: 1, id: 'test', dataset: 'examples/dataset.synthetic.json', models: { mock: { provider: 'mock' } }, schemes: [{ id: 'baseline', modelId: 'mock', context: { current: 'compact' } }] };
  const suite = Core.validateSuite(raw);
  assert.equal(suite.execution.maxModelRequests, null);
  assert.equal(suite.execution.maxToolCalls, null);
  assert.equal(suite.execution.budget.cap, null);
  assert.equal(Core.compileSuite(raw, { baseDir: path.resolve(__dirname, '../benchmark') }).dataset.rounds.length, 2);
  assert.throws(() => Core.validateSuite({ ...raw, apiKey: 'DO_NOT_ECHO' }), e => !e.message.includes('DO_NOT_ECHO'));
  assert.throws(() => Core.validateSuite({ ...raw, schemes: [{ id: 'x', modelId: 'unknown' }] }), /unknown model/);
  assert.throws(() => Core.validateContext({ advice: { mode: 'magic' } }), /unsupported/);
  assert.throws(() => Core.validateContext({ snapshots: { mode: 'raw', magic: true } }), /unsupported/);
  assert.throws(() => Core.validateContext({ implicitSummary: true }), /unsupported/);
  assert.equal(suite.execution.backgroundPolicy, 'defer');
  assert.throws(() => Core.validateSuite({ ...raw, execution: { backgroundPolicy: 'independent-quota' } }), /distinct explicit quota/);
  const independent = { ...raw, models: { mock: { provider: 'mock' }, summary: { provider: 'mock' } }, schemes: [{ id: 'background', modelId: 'mock', summaryModelId: 'summary', context: { advice: 'llm' } }], execution: { backgroundPolicy: 'independent-quota', foregroundQuotaId: 'foreground', summaryQuotaId: 'background' } };
  assert.equal(Core.validateSuite(independent).execution.summaryQuotaId, 'background');
  independent.schemes[0].summaryModelId = 'mock'; assert.throws(() => Core.validateSuite(independent), /distinct summary model/);
});
test('dataset removes hidden hands/unknown snapshot fields and rejects gold labels', () => {
  const d = copy(fixture), n = d.rounds[0].decisions[0];
  n.snapshot.opponentHands = ['HIDDEN']; n.snapshot.game.players[1].hand = ['HIDDEN'];
  n.snapshot.secret = 'SECRET';
  assert.doesNotMatch(JSON.stringify(Core.validateDataset(d)), /HIDDEN|SECRET/);
  n.gold = '1m'; assert.throws(() => Core.validateDataset(d), /unsupported field/);
});
test('dataset rejects duplicates, unordered decisions, wrong phase, illegal and incomplete constrained actions', () => {
  for (const mutate of [
    d => { d.rounds[0].decisions[1].id = d.rounds[0].decisions[0].id; },
    d => { d.rounds[0].decisions[1].position = 0; },
    d => { d.rounds[0].decisions[0].snapshot.phase = 'waiting'; },
    d => { d.rounds[0].decisions[0].legalActions[0].tile = '9s'; },
    d => { d.rounds[0].decisions[0].legalActions.pop(); },
    d => { d.rounds[0].decisions[2].legalActions.push({ action: 'discard', tile: '1z' }); },
    d => { d.rounds[0].decisions[0].snapshot.game.players[0].riichi = true; },
    d => { d.rounds[0].events.reverse(); },
    d => { d.rounds[0].events[0].kind = 'unrecognized-private-event'; },
    d => { delete d.rounds[0].decisions[2].discardConstraints; },
    d => { d.rounds[0].decisions[0].decisionContext = { phase: 'unknown' }; },
    d => { d.rounds[0].decisions[0].decisionContext = { triggerPosition: 999 }; },
    d => { d.rounds[0].decisions[0].decisionContext = { actor: 1 }; },
    d => { d.rounds[0].globalTasks[0].nodeId = d.rounds[1].decisions[0].id; }
  ]) { const d = copy(fixture); mutate(d); assert.throws(() => Core.validateDataset(d)); }
});
test('current and historical snapshots share the exact decision position coordinate', () => {
  for (const step of [null, 0, 100]) {
    const d = copy(fixture); d.rounds[0].decisions[0].snapshot.lastStep = step;
    assert.throws(() => Core.validateDataset(d), /lastStep must equal decision position/);
  }
  const current = setup(); current.node.snapshot.lastStep = 100;
  assert.throws(() => Context.buildContext(current), /lastStep must equal decision position/);
  const historical = setup(); historical.history[0].snapshot.lastStep = 100;
  assert.throws(() => Context.buildContext(historical), /historical snapshot lastStep must equal exchange position/);
  historical.history[0].snapshot.lastStep = 1; historical.history[0].position = 0;
  assert.throws(() => Context.buildContext(historical), /historical snapshot lastStep must equal exchange position/);
});
test('realtime fact cutoff and scope binding exclude future, other round, session, authorization and private opponent draw', () => {
  const input = setup();
  input.node = dataset().rounds[0].decisions[1];
  input.history.push({ ...input.history[0], decisionId: 'other-round', roundId: 'different' }, { ...input.history[0], decisionId: 'other-session', sessionId: 'different' },
    { ...input.history[0], decisionId: 'other-auth', authorization: { ...input.node.authorization, selfHand: false } });
  input.events.push({ position: 1, kind: 'draw', source: 'synthetic', seat: 1, tile: '8z' }, { position: 999, kind: 'discard', source: 'synthetic', seat: 1, tile: 'FUTURE' });
  // Invalid future events are never parsed or exposed; in-scope malformed data fails.
  input.events = input.events.filter(e => e.tile !== '8z');
  input.events.push({ position: 1, kind: 'draw', source: 'synthetic', seat: 1, tile: '8s' });
  const out = Context.buildContext(input), p = payload(out);
  assert.deepEqual(out.sourceDecisionIds, ['synthetic-d1']);
  assert.ok(p.events.every(e => e.position <= 3));
  assert.ok(!p.events.some(e => e.kind === 'draw'));
  assert.doesNotMatch(JSON.stringify(out.messages), /FUTURE|other-round|other-session|other-auth|STALE_REQUEST|STALE_TOOL/);
  assert.deepEqual(out.snapshot, input.node.snapshot);
});
test('current compact is distinct, preserves exact tiles and never changes authoritative snapshot', () => {
  const input = setup('none'), before = JSON.stringify(input), full = Context.buildContext(input);
  input.scheme.context.current = 'compact'; const compact = Context.buildContext(input), p = payload(compact);
  assert.equal(p.current.format, 'benchmark-compact-v1');
  assert.deepEqual(p.current.selfHand, input.node.snapshot.selfHand);
  assert.deepEqual(compact.snapshot, full.snapshot);
  assert.equal(p.current.rivers, undefined); assert.equal(p.current.game.players, undefined);
  assert.deepEqual(p.current.selfMelds, input.node.snapshot.game.players[0].melds);
  assert.deepEqual(payload(full).current, input.node.snapshot);
  assert.equal(JSON.stringify({ ...input, scheme: { ...input.scheme, context: { ...input.scheme.context, current: 'full' } } }), before);
});
test('all deterministic compression modes are independent for snapshots and opinions, with recent window', () => {
  for (const mode of ['none', 'raw', 'truncate', 'extract', 'code']) {
    const input = setup(mode); input.scheme.context.snapshots.recent = 1; input.scheme.context.snapshots.maxChars = 40;
    const p = payload(Context.buildContext(input));
    assert.equal(p.historicalSnapshots.length, mode === 'none' ? 0 : mode === 'truncate' ? 1 : 2);
    assert.equal(p.historicalModelOpinions.length, mode === 'none' ? 0 : 2);
    if (mode !== 'none') assert.deepEqual(p.historicalSnapshots.at(-1).value, input.history[1].snapshot);
    if (mode === 'truncate') { const stats = Context.buildContext(input).compression.snapshots; assert.deepEqual(stats.droppedDecisionIds, ['synthetic-d1']); assert.equal(stats.recentExceedsBudget, true); }
    if (mode === 'code') assert.equal(p.historicalSnapshots[0].value.format, 'benchmark-code-v1');
    if (mode === 'extract') assert.match(p.historicalSnapshots[0].value.representation, /extraction/);
    if (mode !== 'none') assert.match(p.historicalModelOpinions[0].source, /not fact/);
  }
  const input = setup(); input.scheme.context.advice.mode = 'none'; assert.equal(payload(Context.buildContext(input)).historicalSnapshots.length, 2); assert.equal(payload(Context.buildContext(input)).historicalModelOpinions.length, 0);
});
test('LLM and hybrid summaries retain raw until ready, replace only bound prefix, reject unrelated summary', () => {
  for (const mode of ['llm', 'hybrid']) {
    const input = setup(mode); input.scheme.context.snapshots.recent = 1; input.scheme.context.advice.mode = 'none';
    const pending = Context.buildContext(input), job = pending.summaryJobs[0];
    assert.equal(job.kind, 'snapshots'); assert.deepEqual(job.coveredDecisionIds, ['synthetic-d1']);
    assert.deepEqual(payload(pending).historicalSnapshots[0].value, input.history[0].snapshot);
    input.summary = [{ id: job.id, text: 'READY_SUMMARY', coveredDecisionIds: job.coveredDecisionIds, sourceHash: job.sourceHash, scope: job.scope }];
    const ready = Context.buildContext(input), history = payload(ready).historicalSnapshots;
    assert.equal(history.length, 2); assert.equal(history[0].text, 'READY_SUMMARY');
    assert.deepEqual(history[1].value, input.history[1].snapshot);
    assert.equal(ready.summaryJobs.length, 0);
    input.summary[0].coveredDecisionIds = ['synthetic-d2'];
    assert.equal(payload(Context.buildContext(input)).historicalSnapshots[0].text, undefined);
    input.scheme.id = 'different-scheme';
    assert.doesNotMatch(JSON.stringify(Context.buildContext(input).messages), /READY_SUMMARY/);
  }
});
test('event strategies and current active cards use authorized bounded source', () => {
  const input = setup('none');
  input.scheme.context.events = 'none'; assert.equal(payload(Context.buildContext(input)).events.length, 0);
  input.scheme.context.events = 'important'; assert.equal(payload(Context.buildContext(input)).events.length, 2);
  input.scheme.context.events = 'related'; input.scheme.context.relatedSeats = [3]; assert.equal(payload(Context.buildContext(input)).events.length, 2);
  input.scheme.context.events = 'all'; input.scheme.context.eventWindow = 1; input.scheme.context.activeCards = true;
  const p = payload(Context.buildContext(input)); assert.equal(p.events.length, 1); assert.equal(p.activeCards.efficiency.status, 'available');
});
test('event aliases share one authorization projection and start events cannot carry concealed tiles', () => {
  const input = setup('none'); input.scheme.context.events = 'important';
  input.events.push({ position: 5, kind: 'tsumo', source: 'synthetic', seat: 1, tile: '8s' },
    { position: 5, kind: 'reach_accepted', source: 'synthetic', seat: 1 }, { position: 5, kind: 'start_kyoku', source: 'synthetic' });
  const out = Context.buildContext(input), p = payload(out);
  assert.ok(!out.events.some(e => e.kind === 'draw' && e.seat === 1));
  assert.ok(p.events.some(e => e.kind === 'riichi-accepted'));
  assert.ok(p.events.some(e => e.kind === 'round-start'));
  input.events.push({ position: 5, kind: 'start_kyoku', source: 'synthetic', tiles: ['8s'] });
  assert.throws(() => Context.buildContext(input), /tiles not supported/);
  const partial = setup('none'); partial.node.snapshot.rivers = partial.node.snapshot.rivers.filter(r => r.seat !== 1); partial.node.authorization = Core.authorizationFor(partial.node.snapshot);
  partial.events.push({ position: 5, kind: 'dahai', source: 'synthetic', seat: 1, tile: '8s' });
  assert.ok(!Context.buildContext(partial).events.some(e => e.seat === 1 && e.kind === 'discard'));
});
test('truncate drops only oldest complete items under a total character window', () => {
  const input = setup('truncate'); input.scheme.context.advice.mode = 'none';
  const last = { decisionId: input.history[1].decisionId, position: input.history[1].position, source: 'authorized historical snapshot', value: input.history[1].snapshot };
  input.scheme.context.snapshots.maxChars = Core.canonicalStringify(last).length;
  const out = Context.buildContext(input), p = payload(out);
  assert.equal(p.historicalSnapshots.length, 1); assert.deepEqual(p.historicalSnapshots[0], last);
  assert.deepEqual(out.compression.snapshots.droppedDecisionIds, ['synthetic-d1']);
  assert.equal(out.compression.snapshots.recentExceedsBudget, false);
});
test('decision discussion keeps frozen node, original answer and paired QA with strict branch isolation', () => {
  const input = setup('none');
  Object.assign(input, { channel: 'decision-discussion', question: '追问', originalAnswer: '原建议', branchId: 'branch-a', branchHistory: [{ decisionId: input.node.id, position: input.node.position, roundId: input.node.roundId, sessionId: input.node.sessionId, authorization: input.node.authorization, branchId: 'branch-a', question: '前问', answer: '前答' }] });
  const out = Context.buildContext(input);
  assert.deepEqual(out.messages.slice(-3), [{ role: 'user', content: '前问' }, { role: 'assistant', content: '前答' }, { role: 'user', content: '追问' }]);
  assert.equal(payload(out).originalAnswer.value, '原建议'); assert.equal(payload(out).asOf, input.node.position);
  input.branchHistory[0].branchId = 'branch-b'; assert.throws(() => Context.buildContext(input), /scope mismatch/);
  input.branchHistory[0].branchId = 'branch-a'; input.branchHistory[0].decisionId = 'other'; assert.throws(() => Context.buildContext(input), /scope mismatch/);
});
test('global analysis is separately scoped with asOf and excludes discussion turns', () => {
  const input = setup('raw'); input.channel = 'global-analysis'; input.question = '全局分析';
  const p = payload(Context.buildContext(input)); assert.equal(p.channel, 'global-analysis'); assert.equal(p.asOf, input.node.position); assert.equal(p.originalAnswer, undefined);
  input.originalAnswer = 'discussion leak'; assert.throws(() => Context.buildContext(input), /isolated/);
  assert.throws(() => Context.buildContext({ ...setup(), unsupported: true }), /unsupported/);
});
test('direct builders enforce frozen constrained legality and summary reuse never duplicates an older covered prefix', () => {
  const bad = setup(); bad.node.legalActions.push({ action: 'discard', tile: '1z' });
  assert.throws(() => Context.buildContext(bad), /illegal discard/);
  const input = setup('llm'); input.scheme.context.advice.mode = 'none';
  input.scheme.context.snapshots.recent = 1;
  const earlier = Context.buildContext(input).summaryJobs[0];
  input.scheme.context.snapshots.recent = 0;
  input.summary = [{ ...earlier, text: 'PREFIX_READY' }];
  const out = Context.buildContext(input), p = payload(out);
  assert.equal(p.historicalSnapshots.length, 2);
  assert.equal(p.historicalSnapshots[0].text, 'PREFIX_READY');
  assert.deepEqual(p.historicalSnapshots[1].value, input.history[1].snapshot);
  assert.deepEqual(out.summaryJobs[0].coveredDecisionIds, ['synthetic-d1', 'synthetic-d2']);
});
test('trusted custom context modules use explicit local versioned protocol and scoped baseline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-benchmark-context-'));
  try {
    fs.writeFileSync(path.join(dir, 'custom.cjs'), "exports.version=1;exports.buildContext=input=>({messages:[{role:'user',content:JSON.stringify({position:input.node.position,options:input.options,events:input.events})}]});");
    const input = setup('none'); input.scheme.context.module = './custom.cjs'; input.scheme.context.options = { tag: 'custom' };
    assert.throws(() => Context.buildContext(input), /loadContextBuilder/);
    const builder = Context.loadContextBuilder(input.scheme, { baseDir: dir }), out = builder(input);
    assert.equal(JSON.parse(out.messages[0].content).options.tag, 'custom'); assert.deepEqual(out.snapshot, input.node.snapshot);
    fs.writeFileSync(path.join(dir, 'bad.cjs'), 'exports.version=2;exports.buildContext=()=>({messages:[]});');
    assert.throws(() => Context.loadContextBuilder({ context: { module: './bad.cjs' } }, { baseDir: dir }), /version 1/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('canonical hashing is key-order stable and rejects invalid/non-JSON values', () => {
  assert.equal(Core.stableHash({ a: 1, b: 2 }), Core.stableHash({ b: 2, a: 1 }));
  assert.throws(() => Core.canonicalStringify({ value: Infinity }));
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => Core.stableHash(cyclic));
});
