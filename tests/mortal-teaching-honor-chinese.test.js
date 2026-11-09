'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectData, transformHonorOptions, HONORS, HONOR_CURRENT, PREFIXES } = require('../benchmark/mortal-teaching/honor-chinese.cjs');
const { transformOptions, CURRENT, ENGINE, HISTORY, FACTS } = require('../benchmark/mortal-teaching/retest-projection.cjs');
const { createHarness } = require('../benchmark/mortal-teaching/harness.cjs');
const { createMock } = require('../benchmark/mortal-teaching/mock.cjs');
const { stableHash } = require('../benchmark/core.cjs');
const Explanation = require('../extension/contracts/engine-explanation.js');
const State = require('../extension/state.js');
const Snapshot = require('../extension/collector/snapshot-adapter.js');
const Mjai = require('../extension/adapters/mjai.js');
const variant = { text: Explanation.prompt, sha256: 'synthetic-honor-test', experiment: { factCard: true, honorChinese: true } };
function fixture() {
  const events = [{ kind: 'NewRound', source: 'live', step: 0, wind: 0, round: 0, honba: 0, sticks: 0, scores: [25000, 25000, 25000, 25000], remaining: 70, doras: ['4z'], hand: ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '1z', '1z', '1z', '2z'] },
    { kind: 'DealTile', source: 'live', step: 1, seat: 0, tile: '5z', remaining: 69 }];
  const state = events.reduce((s, e) => State.apply(s, e), State.initial('live', 0));
  const message = { provider: 'mjai', task: 'combined', lane: 'live', snapshot: Snapshot.snapshot(state, { game: true, rivers: 'all', hand: true }),
    engineRequest: Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'live', state, events }, { hand: true }),
    context: { identity: { matchId: 'honor', roundStartId: 'round' }, position: 1, events, historyComplete: true, eventWindowStart: 0 } };
  return { id: 'honor', compatible: true, message, legalActions: [{ action: 'discard', tile: '5z' }] };
}
test('all seven honor values and dictionary keys agree; unknown, numeric seats/winds, suits and red fives survive', () => {
  const raw = { selfHand: [...Object.keys(HONORS), '0m', '0p', '0s', '5m', '9p', '1s', '?', '8z'], counts: Object.fromEntries(Object.keys(HONORS).map(t => [t, 2])), wind: 1, seat: 2, unknown: '2z', question: '2z', summary: '2z', reasons: ['2z'], limitations: ['1z是东，2z是南'] };
  const before = structuredClone(raw), p = projectData(raw);
  assert.deepEqual(p.selfHand, [...Object.values(HONORS), ...raw.selfHand.slice(7)]);
  assert.deepEqual(Object.keys(p.counts), Object.values(HONORS));
  assert.ok(Object.values(p.counts).every(n => n === 2));
  for (const key of ['wind', 'seat', 'unknown', 'question', 'summary', 'reasons', 'limitations']) assert.deepEqual(p[key], raw[key]);
  assert.deepEqual(raw, before);
  const fields = ['tiles', 'pais', 'consumed', 'tehais', 'selfHand', 'hand', 'doras', 'forbiddenTiles', 'legalDiscards', 'riskTiles', 'candidateTiles', 'sujiReferences', 'kabeReferences', 'genbutsuReferences', 'concealedTiles', 'redTilesInHand', 'redTilesInOwnMelds'];
  const arrays = Object.fromEntries(fields.map(key => [key, Object.keys(HONORS)]));
  assert.deepEqual(projectData(arrays), Object.fromEntries(fields.map(key => [key, Object.values(HONORS)])));
  for (const key of ['tile', 'pai', 'selfDrawnTile', 'drawnTile', 'indicator', 'dora', 'code', 'canonical', 'wind']) for (const [code, name] of Object.entries(HONORS)) assert.equal(projectData({ [key]: code })[key], name);
});
test('only known structured prefixes project; fact hash binds raw snapshot and old prose remains verbatim', () => {
  const snapshot = fixture().message.snapshot, question = '前答说“2z是西”，为何？{"tile":"2z"}';
  const old = { role: 'assistant', content: [{ type: 'text', text: '{"summary":"旧教学2z","reasons":["2z"],"limitations":[]}' }] };
  const untrusted = { role: 'user', content: '请看 {"tile":"2z"}' };
  const input = { systemPrompt: 'keep 2z', tools: [], messages: [untrusted, old,
    { role: 'user', content: HISTORY + JSON.stringify({ advice: [{ question: '2z', decision: { tile: '2z', reasons: ['2z'] }, explanation: { summary: '2z' } }] }) },
    { role: 'user', content: CURRENT + JSON.stringify({ snapshot, question, position: snapshot.lastStep }) },
    { role: 'user', content: ENGINE + JSON.stringify({ engine: { action: { type: 'dahai', actor: snapshot.selfSeat, pai: '5z' }, tileEncoding: 'snapshot-v1' } }) }] };
  const p = transformHonorOptions(transformOptions(input, variant), variant);
  assert.equal(p.systemPrompt, input.systemPrompt);
  assert.equal(p.messages[0], untrusted); assert.equal(p.messages[1], old);
  const history = JSON.parse(p.messages[2].content.slice(HISTORY.length));
  assert.equal(history.advice[0].decision.tile, '南'); assert.equal(history.advice[0].decision.reasons[0], '2z'); assert.equal(history.advice[0].explanation.summary, '2z');
  assert.ok(p.messages[3].content.startsWith(HONOR_CURRENT));
  const current = JSON.parse(p.messages[3].content.slice(HONOR_CURRENT.length));
  assert.equal(current.question, question); assert.ok(current.snapshot.selfHand.includes('南')); assert.equal(current.modelEncoding, 'honor-zh-v1');
  const engine = JSON.parse(p.messages[4].content.slice(ENGINE.length));
  assert.equal(engine.engine.action.pai, '白'); assert.equal(engine.engine.tileEncoding, 'honor-zh-v1'); assert.equal(engine.engine.sourceSnapshotEncoding, 'snapshot-v1');
  const facts = JSON.parse(p.messages.at(-1).content.slice(FACTS.length));
  assert.equal(facts.binding.snapshotHash, stableHash(snapshot)); assert.equal(facts.sourceSnapshotEncoding, 'snapshot-v1');
  assert.equal(facts.hand.exactCounts['南'], 1); assert.equal(facts.selectedAction.discard.code, '白');
  for (const prefix of PREFIXES.slice(4)) {
    const result = transformHonorOptions({ tools: [], messages: [{ role: 'user', content: prefix + JSON.stringify({ initialSnapshot: snapshot, events: [{ tile: '2z' }] }) }] }, variant);
    const data = JSON.parse(result.messages[0].content.slice(prefix.length));
    assert.equal(data.events[0].tile, '南'); assert.ok(data.initialSnapshot.selfHand.includes('南'));
  }
});
test('all tool JSON results share encoding while parameters, descriptions and memory text stay original', async () => {
  const calls = [], args = { tile: '2z', seat: 1 };
  const tools = ['get_self_hand', 'compare_discards', 'get_danger_evidence', 'future_tool', 'get_user_memory'].map(name => ({ name, description: '样例2z', parameters: { tile: '2z' }, execute: async (...values) => { calls.push(values); return { content: [{ type: 'text', text: JSON.stringify({ hand: ['2z'], candidates: [{ tile: '2z' }], counts: { '2z': 2 }, summary: '2z' }) }] }; } }));
  const result = transformHonorOptions({ messages: [], tools }, variant);
  for (const tool of result.tools) {
    assert.equal(tool.description, '样例2z'); assert.equal(tool.parameters, tools.find(t => t.name === tool.name).parameters);
    const output = JSON.parse((await tool.execute('id', args)).content[0].text);
    assert.equal(output.hand[0], tool.name === 'get_user_memory' ? '2z' : '南');
    assert.equal(output.summary, '2z');
    if (tool.name !== 'get_user_memory') { assert.equal(output.candidates[0].tile, '南'); assert.equal(output.counts['南'], 2); }
  }
  assert.ok(calls.every(call => call[1] === args)); assert.equal(args.tile, '2z');
});
test('real Worker/Pi mock HTTP calls and follow-up use Chinese, preserving engine request, snapshot and strict output', async () => {
  const node = fixture(), before = structuredClone(node.message), mock = createMock({ nodes: [node] }), models = [], engines = [];
  const h = createHarness({ variant, engineConfig: { model: 'test', endpoint: 'http://127.0.0.1:17342/analyze', apiKey: 'synthetic' }, llmConfig: { endpoint: 'https://mock.invalid/chat/completions', model: 'test', apiKey: 'synthetic' },
    fetchModel: (url, wire) => {
      const body = JSON.parse(wire.body);
      if (!body.messages) { engines.push(wire.body); return mock.fetch(url, wire); }
      models.push(body);
      if (body.tools?.length && !body.messages.some(m => m.role === 'tool')) return Promise.resolve(Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: ['get_self_hand', 'compare_discards', 'get_danger_evidence'].map((name, i) => ({ id: 'honor-' + i, type: 'function', function: { name, arguments: '{}' } })) } }] }));
      return mock.fetch(url, wire);
    } });
  const result = await h.worker.analyze(node.message, 1);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.explanation.status, 'completed', result.explanation.error);
  assert.equal(engines.length, 1); assert.equal(engines[0], JSON.stringify(node.message.engineRequest));
  assert.deepEqual(node.message, before); assert.equal(result.engine.action.pai, 'P');
  assert.ok(models[1].messages.filter(m => m.role === 'tool').length >= 3);
  const toolTexts = h.traces[0].toolResults.map(m => m.content.filter(b => b.type === 'text').map(b => b.text).join(''));
  assert.ok(toolTexts.length >= 3); assert.ok(toolTexts.every(t => t.includes('南') && !t.includes('"2z"')));
  const traceCurrent = h.traces[0].messages.find(m => typeof m.content === 'string' && m.content.startsWith(HONOR_CURRENT));
  assert.ok(JSON.parse(traceCurrent.content.slice(HONOR_CURRENT.length)).snapshot.selfHand.includes('南'));
  const question = '请解释前答的2z和模拟教学';
  await h.discussions.ask(result.discussionRecord.id, question, 'follow');
  const answer = await h.worker.analyze({ provider: 'chat', discussionId: result.discussionRecord.id, question, discussionToken: 'follow', selection: { hand: true, game: true, rivers: 'all' } }, 1);
  assert.equal(answer.ok, true, answer.error); assert.equal(answer.explanation.status, 'completed');
  assert.ok(JSON.stringify(h.traces.at(-1).messages).includes(question)); assert.equal(engines.length, 1);
  assert.throws(() => Explanation.parse('{"summary":"说明","reasons":[],"limitations":[],"tile":"南"}'), /不接受动作或首选字段/);
});
test('existing P0 and four previous experiment variants never trigger Chinese behavior', () => {
  const options = { messages: [{ role: 'user', content: CURRENT + '{"snapshot":{"selfHand":["2z"]}}' }], tools: [] };
  for (const experiment of [undefined, { factCard: false }, { factCard: true }, { factCard: true, isolateAutomaticHistory: true }, { factCard: true, isolateAutomaticHistory: true, jsonObject: true }]) assert.equal(transformHonorOptions(options, { experiment }), options);
});
