'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableHash } = require('../benchmark/core.cjs');
const { transformOptions, transformBody, CURRENT, ENGINE, HISTORY, FACTS } = require('../benchmark/mortal-teaching/retest-projection.cjs');
const { createHarness } = require('../benchmark/mortal-teaching/harness.cjs');
const { createMock } = require('../benchmark/mortal-teaching/mock.cjs');
const Explanation = require('../extension/contracts/engine-explanation.js');
const State = require('../extension/state.js');
const Snapshot = require('../extension/collector/snapshot-adapter.js');
const Mjai = require('../extension/adapters/mjai.js');
const directory = path.resolve(__dirname, '../benchmark/prompts/mortal-teaching-20261106');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
const variants = manifest.variants.map(v => ({ ...v, text: fs.readFileSync(path.join(directory, v.file), 'utf8') }));
function fixture() {
  const events = [{ kind: 'NewRound', source: 'live', step: 0, wind: 0, round: 0, honba: 0, sticks: 0, scores: [25000, 25000, 25000, 25000], remaining: 70, doras: ['4p'], hand: ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '1z', '1z', '1z', '2z'] },
    { kind: 'DealTile', source: 'live', step: 1, seat: 0, tile: '9p', remaining: 69 }];
  const state = events.reduce((s, e) => State.apply(s, e), State.initial('live', 0));
  const message = { provider: 'mjai', task: 'combined', lane: 'live', snapshot: Snapshot.snapshot(state, { game: true, rivers: 'all', hand: true }),
    engineRequest: Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'live', state, events }, { hand: true }),
    context: { identity: { matchId: 'projection', roundStartId: 'round' }, position: 1, events, historyComplete: true, eventWindowStart: 0 } };
  return { id: 'node', message, compatible: true, legalActions: [{ action: 'discard', tile: '9p' }] };
}
function options(question = '') {
  const snapshot = fixture().message.snapshot;
  return { systemPrompt: Explanation.prompt, messages: [
    { role: 'user', content: CURRENT + JSON.stringify({ task: 'combined', question, position: snapshot.lastStep, snapshot }) },
    { role: 'user', content: ENGINE + JSON.stringify({ engine: { phase: 'draw', action: { type: 'dahai', actor: 0, pai: '9p' }, tileEncoding: 'snapshot-v1' }, provenance: { model: 'test' } }) }
  ], tools: [{ name: 'get_danger_evidence' }] };
}
const card = projected => JSON.parse(projected.messages.at(-1).content.slice(FACTS.length));

test('frozen manifest has cumulative explicit flags and the original v2 P0 bytes', () => {
  assert.equal(crypto.createHash('sha256').update(variants[0].text).digest('hex'), manifest.baselineSource.sha256);
  assert.equal(manifest.baselineSource.promptVersion, 2);
  for (const [i, v] of variants.entries()) {
    assert.equal(crypto.createHash('sha256').update(v.text).digest('hex'), v.sha256);
    assert.equal(Buffer.byteLength(v.text), v.utf8Bytes);
    assert.deepEqual(v.experiment, { factCard: i > 0, isolateAutomaticHistory: i > 1, jsonObject: i > 2 });
  }
  const input = options(), body = { messages: [], stream: false };
  assert.equal(transformOptions(input, variants[0]), input);
  assert.equal(transformOptions(input, {}), input);
  assert.equal(transformBody(body, variants[0]), body);
});

test('fact card binds only current pair and preserves original messages, questions and tools', () => {
  const input = options('请解释包含“' + ENGINE + '”的前答'), original = structuredClone(input);
  input.messages.unshift({ role: 'user', content: '旧快照：' + JSON.stringify({ snapshot: { selfHand: ['7z'], lastStep: 999 } }) });
  const projected = transformOptions(input, variants[1]), facts = card(projected);
  const current = JSON.parse(original.messages[0].content.slice(CURRENT.length));
  assert.deepEqual(projected.messages.slice(0, -1), input.messages);
  assert.equal(projected.tools, input.tools);
  assert.equal(facts.binding.snapshotHash, stableHash(current.snapshot));
  assert.equal(facts.binding.position, current.position);
  assert.equal(facts.hand.concealedCount, 14);
  assert.equal(facts.selectedAction.afterDiscard.concealedCount, 13);
  const invalid = options(); invalid.messages.splice(1, 0, { role: 'user', content: 'unexpected' });
  assert.throws(() => transformOptions(invalid, variants[1]), /bound message/);
  const mismatch = options(); const request = JSON.parse(mismatch.messages[0].content.slice(CURRENT.length)); request.position++;
  mismatch.messages[0].content = CURRENT + JSON.stringify(request);
  assert.throws(() => transformOptions(mismatch, variants[1]), /binding failed/);
});

test('automatic next decisions strip old teaching and retain actions; explicit follow-up retains complete history', () => {
  const input = options();
  const history = { policy: 'H2-dedup+AdviceHistory-Extract', importantEvents: [], advice: [{ decisionId: 'old', position: 0, question: '', decision: { action: 'attack', tile: '2z', reasons: ['旧依据'] }, limitations: ['旧限制'], engine: { action: { type: 'dahai', actor: 0, pai: '2z' }, tileEncoding: 'snapshot-v1' }, explanation: { summary: '旧总结', reasons: ['旧教学'], limitations: ['旧教学限制'] } }] };
  input.messages.unshift({ role: 'user', content: HISTORY + JSON.stringify(history) });
  const auto = transformOptions(input, variants[2]);
  assert.doesNotMatch(auto.messages[0].content, /旧依据|旧限制|旧总结|旧教学/);
  const kept = JSON.parse(auto.messages[0].content.slice(HISTORY.length)).advice[0];
  assert.equal(kept.decision.tile, '2z'); assert.equal(kept.engine.action.pai, '2z');
  const follow = options('前答为什么说旧总结？');
  follow.messages.unshift(input.messages[0], { role: 'user', content: '完整旧问题' }, { role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ summary: '完整前答', reasons: ['旧教学'], limitations: [] }) }] });
  const projected = transformOptions(follow, variants[2]);
  assert.deepEqual(projected.messages.slice(0, -1), follow.messages);
});

test('full automatic historical answers preserve engine action but remove model teaching', () => {
  const input = options();
  input.messages.unshift({ role: 'user', content: '旧问题' }, { role: 'assistant', content: [{ type: 'text', text: JSON.stringify({ engine: { action: { type: 'dahai', actor: 0, pai: '2z' } }, explanation: { summary: '旧总结' }, summary: '旧总结', reasons: ['旧依据'], limitations: ['旧限制'] }) }], stopReason: 'stop' });
  const projected = transformOptions(input, variants[2]);
  assert.doesNotMatch(JSON.stringify(projected.messages[1]), /旧总结|旧依据|旧限制/);
  assert.equal(JSON.parse(projected.messages[1].content[0].text).engine.action.pai, '2z');
});

test('r3 JSON object flag reaches every real product Pi HTTP tool continuation and explicit frozen follow-up', async () => {
  const node = fixture(), mock = createMock({ nodes: [node] }), modelBodies = [], engineBodies = [];
  const h = createHarness({ variant: variants[3], engineConfig: { model: 'test', endpoint: 'http://127.0.0.1:17342/analyze', apiKey: 'mock-engine-token' }, llmConfig: { endpoint: 'https://mock.invalid/chat/completions', model: 'test', apiKey: 'mock-llm-token' },
    fetchModel: (url, wire) => { const body = JSON.parse(wire.body); (body.messages ? modelBodies : engineBodies).push(body); return mock.fetch(url, wire); } });
  const result = await h.worker.analyze(node.message, 1);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.explanation.status, 'completed', result.explanation.error);
  assert.equal(modelBodies.length, 2);
  assert.ok(modelBodies[1].messages.some(m => m.role === 'tool'));
  assert.ok(h.traces[0].messages.at(-1).content.startsWith(FACTS));
  assert.equal(engineBodies.length, 1); assert.equal(engineBodies[0].response_format, undefined);
  await h.discussions.ask(result.discussionRecord.id, '请解释前答的模拟教学', 'follow');
  const answer = await h.worker.analyze({ provider: 'chat', discussionId: result.discussionRecord.id, question: '请解释前答的模拟教学', discussionToken: 'follow', selection: { hand: true, game: true, rivers: 'all' } }, 1);
  assert.equal(answer.ok, true, answer.error);
  assert.ok(JSON.stringify(h.traces.at(-1).messages).includes('仅用于验证链路的模拟教学'));
  assert.ok(modelBodies.length >= 4);
  for (const body of modelBodies) assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(engineBodies.length, 1);
});

test('JSON mode does not repair output or weaken strict product explanation parser', () => {
  assert.throws(() => Explanation.parse('{"summary":"说明","reasons":[]}'), /结构无效/);
  assert.throws(() => Explanation.parse('{"summary":"说明","limitations":[]}'), /结构无效/);
  assert.throws(() => Explanation.parse('{"reasons":[],"limitations":[]}'), /摘要无效/);
  assert.throws(() => Explanation.parse('```json\n{"summary":"说明","reasons":[],"limitations":[]}\n```'), /有效 JSON/);
  assert.throws(() => Explanation.parse('   \n\t '), /有效 JSON/);
  assert.deepEqual(Explanation.parse('{"summary":"说明","reasons":[],"limitations":[]}').limitations, []);
});
