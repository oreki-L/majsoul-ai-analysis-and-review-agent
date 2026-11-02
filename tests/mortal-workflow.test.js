'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const State = require('../extension/state.js');
const Snapshot = require('../extension/collector/snapshot-adapter.js');
const Mjai = require('../extension/adapters/mjai.js');
const Discussions = require('../extension/decision-discussions.js');
function input() {
  const events = [{ kind: 'NewRound', source: 'live', step: 0, wind: 0, round: 0, honba: 0, sticks: 0,
    scores: [25000,25000,25000,25000], remaining: 70, doras: ['4p'], hand: ['1m','2m','3m','1p','2p','3p','1s','2s','3s','1z','1z','1z','2z'] },
  { kind: 'DealTile', source: 'live', step: 1, seat: 0, tile: '9p', remaining: 69 }];
  const state = events.reduce((s,e) => State.apply(s,e), State.initial('live',0));
  return { provider: 'mjai', task: 'combined', clientRunId: 'test', snapshot: Snapshot.snapshot(state, { game: true, rivers: 'all', hand: true }),
    engineRequest: Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'live', state, events }, { hand: true }),
    context: { identity: { matchId: 'fixture', roundStartId: 'round' }, position: 1 } };
}
function setup(llm, stage = () => {}, memory = { version: 0, entries: [] }) {
  const data = { modelConfig: { enabled: true, provider: 'mjai', workflow: 'mortal-explain', model: 'weak-example', endpoint: 'http://127.0.0.1:17341/analyze', apiKey: 'engine-secret' },
    analysisProviders: { chat: { provider: 'chat', endpoint: 'https://llm.example/v1', model: 'teaching', apiKey: 'llm-secret' } } };
  const storage = { get: async () => structuredClone(data), set: async values => Object.assign(data, structuredClone(values)) };
  const discussions = Discussions.create({ storage }), requests = [], runs = [];
  const context = vm.createContext({ URL, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, performance, setTimeout, clearTimeout });
  for (const file of ['contracts/snapshot.js','adapters/model-endpoint.js','adapters/engine-endpoint.js','adapters/mjai.js','mahjong-analysis.js','analysis.js','harness.js','contracts/engine-explanation.js','xf-context.js','agent.js','pi-runtime.js','model-usage.js','model-session-transport.js','contracts/engine-result.js','engine-agent.js','model-analysis-worker.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8'), context);
  const service = context.MJModelAnalysisWorker.create({ storage, permissions: { contains: async () => true }, runtime: context.MJPiRuntime,
    fetchModel: async (url, options) => { requests.push({ url, options }); return url.includes('127.0.0.1') ? Response.json({ action: { type: 'dahai', actor: 0, pai: '9p', tsumogiri: true } }) : llm(url, options); },
    roundContexts: require('../extension/round-context.js').createStore({ storage }), runStore: { epoch: () => 1, append: async record => runs.push(record), clear: async () => {} },
    discussions, discussionReady: Promise.resolve(), memoryWorker: { cancel() {}, pump() {}, store: { pin: async () => structuredClone(memory) } }, onStage: stage });
  return { service, data, discussions, requests, runs };
}
const answer = () => Response.json({ choices: [{ message: { content: JSON.stringify({ summary: '基于可见牌效率解释该弃牌。', reasons: ['引擎首选保留。'], limitations: ['不是内部思考。'] }) } }], usage: { prompt_tokens: 20, completion_tokens: 10 } });

test('a different tab cannot retry or mark a running explanation failed', async () => {
  let release, started;
  const begun = new Promise(resolve => { started = resolve; });
  const w = setup(async () => { started(); return new Promise(resolve => { release = resolve; }); });
  const first = w.service.analyze(input(), 1); await begun;
  const id = (await w.discussions.list())[0].id;
  const second = await w.service.analyze({ provider: 'chat', discussionId: id, retryExplanation: true, selection: { hand: true, game: true, rivers: 'all' } }, 2);
  assert.equal(second.ok, false); assert.match(second.error, /正在进行/);
  assert.equal((await w.discussions.get(id)).analysis.explanation.status, 'pending');
  assert.equal(w.requests.filter(r => r.url.includes('llm.example')).length, 1);
  release(answer()); assert.equal((await first).explanation.status, 'completed');
});

test('two simultaneous cross-tab retries atomically grant one explanation attempt', async () => {
  let hold = false, started, release;
  const begun = new Promise(resolve => { started = resolve; });
  const w = setup(async () => hold ? (started(), new Promise(resolve => { release = resolve; })) : Response.json({ error: 'synthetic failure' }, { status: 503 }));
  const original = await w.service.analyze(input(), 1);
  assert.equal(original.explanation.status, 'failed'); hold = true;
  const retry = { provider: 'chat', discussionId: original.discussionRecord.id, retryExplanation: true, selection: { hand: true, game: true, rivers: 'all' } };
  const pending = [w.service.analyze(retry, 2), w.service.analyze(retry, 3)];
  const rejected = await Promise.race(pending); await begun;
  assert.equal(rejected.ok, false); assert.match(rejected.error, /正在进行/);
  assert.equal(w.requests.filter(r => r.url.includes('llm.example')).length, 2, 'one original failure plus one retry');
  release(answer());
  const outcomes = await Promise.all(pending);
  assert.equal(outcomes.filter(r => r.ok).length, 1);
  assert.equal((await w.discussions.get(retry.discussionId)).analysis.explanation.status, 'completed');
});

test('a cancelled late transport cannot overwrite a newer retry', async () => {
  const releases = [], begun = [];
  let notify;
  const w = setup(async () => { begun.push(true); notify?.(); return new Promise(resolve => releases.push(resolve)); });
  const first = w.service.analyze(input(), 1);
  if (!begun.length) await new Promise(resolve => { notify = resolve; });
  w.service.cancel(1); const cancelled = await first;
  assert.equal(cancelled.explanation.status, 'interrupted');
  const retry = w.service.analyze({ provider: 'chat', discussionId: cancelled.discussionRecord.id, retryExplanation: true, selection: { hand: true, game: true, rivers: 'all' } }, 2);
  if (begun.length < 2) await new Promise(resolve => { notify = resolve; });
  releases[0](answer()); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await w.discussions.get(cancelled.discussionRecord.id)).analysis.explanation.status, 'pending');
  releases[1](answer()); assert.equal((await retry).explanation.status, 'completed');
});

test('persistent explanation ownership rejects cancelled and repeated writes after a new claim', async () => {
  const w = setup(answer), first = await w.service.analyze(input(), 1), id = first.discussionRecord.id;
  await w.discussions.claimExplanation(id, 'old-attempt');
  await w.discussions.explain(id, { status: 'interrupted' }, null, 'old-attempt');
  await w.discussions.claimExplanation(id, 'new-attempt');
  await assert.rejects(w.discussions.explain(id, { status: 'failed' }, null, 'old-attempt'), /状态已变化/);
  assert.equal((await w.discussions.get(id)).analysis.explanation.status, 'pending');
  await w.discussions.explain(id, { status: 'completed', summary: 'new' }, null, 'new-attempt');
  await assert.rejects(w.discussions.explain(id, { status: 'interrupted' }, null, 'new-attempt'), /状态已变化/);
  assert.equal((await w.discussions.get(id)).analysis.explanation.summary, 'new');
});
test('Mortal action is published before LLM; distinct credentials and immutable action survive teaching', async () => {
  let stage;
  const w = setup(async (_url, options) => { assert.ok(stage); assert.match(options.body, /engine/); assert.doesNotMatch(options.body, /engine-secret|llm-secret/); return answer(); }, (_key, value) => { stage = value; });
  const result = await w.service.analyze(input(), 1);
  assert.equal(result.ok, true, result.error); assert.equal(stage.analysis.result.decision.tile, '9p');
  assert.equal(result.result.decision.tile, '9p'); assert.equal(result.result.decision.action, 'unknown'); assert.equal(result.explanation.status, 'completed');
  assert.equal(w.requests[0].options.headers.Authorization, 'Bearer engine-secret'); assert.equal(w.requests[1].options.headers.Authorization, 'Bearer llm-secret');
  assert.equal(result.calls, 1); assert.equal(result.engineCalls, 1); assert.equal(w.runs.length, 2);
});
test('conflicting explanation contract and HTTP failure retain action; explicit retry never reruns engine', async () => {
  let fail = true;
  const w = setup(async () => fail ? Response.json({ choices: [{ message: { content: '{"summary":"bad","decision":{"tile":"1m"},"reasons":[],"limitations":[]}' } }] }) : answer());
  const first = await w.service.analyze(input(), 1);
  assert.equal(first.ok, true); assert.equal(first.result.decision.tile, '9p'); assert.equal(first.explanation.status, 'failed'); assert.equal(first.calls, 1);
  fail = false;
  const retry = await w.service.analyze({ provider: 'chat', discussionId: first.discussionRecord.id, retryExplanation: true, selection: { hand: true, game: true, rivers: 'all' } }, 1);
  assert.equal(retry.ok, true, retry.error); assert.equal(retry.explanation.status, 'completed'); assert.equal(w.requests.filter(x => x.url.includes('127.0.0.1')).length, 1);
  assert.equal((await w.discussions.get(first.discussionRecord.id)).analysis.explanation.status, 'completed');
});
test('cancelled paid explanation retains action, accounts unknown usage, cannot resurrect cleared history', async () => {
  let started;
  const begun = new Promise(resolve => { started = resolve; });
  const w = setup(async () => { started(); return new Promise(() => {}); });
  const pending = w.service.analyze(input(), 1); await begun;
  w.service.cancel(1); const result = await pending;
  assert.equal(result.result.decision.tile, '9p'); assert.equal(result.explanation.status, 'interrupted'); assert.equal(result.calls, 1);
  assert.equal(w.runs.at(-1).status, 'cancelled'); assert.equal(result.usage.inputTokens, null);
  await w.discussions.clear(); assert.deepEqual(await w.discussions.list(), []);
});



test('recovery marks unfinished teaching billing unknown without any transport, deletion rejects late append', async () => {
  const w = setup(answer); let saved;
  const data = input();
  saved = await w.discussions.save({ snapshot: data.snapshot, context: data.context, analysis: { result: { decision: { action: 'unknown', tile: '9p', reasons: [] }, danger: [], efficiency: [], limitations: [] }, engine: { format: 'majsoul-engine-result-v1', action: { type: 'dahai', actor: 0, pai: '9p' } }, workflow: 'mortal-explain', explanation: { status: 'pending' } } });
  await w.discussions.recover();
  const r = await w.discussions.get(saved.id); assert.equal(r.analysis.explanation.status, 'interrupted'); assert.equal(r.analysis.explanation.billing, 'unknown'); assert.equal(w.requests.length, 0);
  await w.discussions.clear(); await assert.rejects(w.discussions.explain(saved.id, { status: 'completed' }), /找不到/);
});


test('imported official history explains and follows up on its frozen visible snapshot without engine or future report data', async () => {
  const w = setup(answer), data = input(); data.snapshot.source = 'replay';
  const record = await w.discussions.save({ snapshot: data.snapshot, context: data.context, analysis: { workflow: 'official-mortal-review', runId: 'report-1:0', model: 'mortal3-demo', engineIdentity: { model: 'mortal3-demo', runtime: 'classic-1.5.3' },
    officialSource: { model: 'mortal3-demo', raw: 'FUTURE_HIDDEN_SENTINEL' }, engine: { format: 'majsoul-engine-result-v1', phase: 'draw', action: { type: 'dahai', actor: 0, pai: '9p', tsumogiri: true } },
    explanation: { status: 'not-requested' }, result: { task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: '9p', reasons: ['官方历史动作'] }, limitations: [] } } });
  const explained = await w.service.analyze({ provider: 'chat', discussionId: record.id, retryExplanation: true, selection: { hand: true, game: true, rivers: 'all' } }, 1);
  assert.equal(explained.ok, true, explained.error); assert.equal(explained.workflow, 'official-mortal-review'); assert.equal(explained.result.decision.tile, '9p');
  await w.discussions.ask(record.id, '为什么当时不打1m？', 'followup');
  const followup = await w.service.analyze({ provider: 'chat', discussionId: record.id, discussionToken: 'followup', question: '为什么当时不打1m？', selection: { hand: true, game: true, rivers: 'all' } }, 1);
  assert.equal(followup.ok, true, followup.error);
  assert.equal(w.requests.length, 2); assert.ok(w.requests.every(r => r.url.includes('llm.example')));
  assert.doesNotMatch(w.requests.map(r => r.options.body).join(''), /FUTURE_HIDDEN_SENTINEL/);
  assert.match(w.requests.at(-1).options.body, /mortal3-demo/);
  assert.equal((await w.discussions.get(record.id)).chat[0].status, 'completed');
});


test('two follow-ups retain the original teaching and previous teaching answer with sanitized source only', async () => {
  let n = 0;
  const w = setup(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'TEACHING_' + (++n), reasons: [], limitations: [] }) } }] }));
  const first = await w.service.analyze(input(), 1); const id = first.discussionRecord.id;
  for (const token of ['first-followup', 'second-followup']) {
    await w.discussions.ask(id, token, token);
    const response = await w.service.analyze({ provider: 'chat', discussionId: id, discussionToken: token, question: token, selection: { hand: true, game: true, rivers: 'all' } }, 1);
    assert.equal(response.ok, true, response.error);
  }
  const body = w.requests.at(-1).options.body;
  assert.match(body, /TEACHING_1/); assert.match(body, /TEACHING_2/); assert.match(body, /weak-example/);
  const original = (await w.discussions.get(id)).analysis;
  assert.equal(original.explanation.summary, 'TEACHING_1'); assert.equal(original.result.decision.tile, '9p');
});

test('first hybrid teaching receives isolated live history and pinned memory, engine never sees either', async () => {
  let stage = 0;
  const memory = { version: 7, entries: [{ id: 'pinned', kind: 'explicit', text: 'PINNED_TEACHING_PREFERENCE', scope: 'explanation' }] };
  const w = setup(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (++stage === 1) {
      assert.ok(body.tools.some(t => t.function.name === 'get_user_memory'));
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'memory', type: 'function', function: { name: 'get_user_memory', arguments: '{}' } }] } }] });
    }
    return answer();
  }, () => {}, memory);
  const data = input(); data.lane = 'live'; data.context.historyComplete = true; data.context.eventWindowStart = 0;
  data.context.events = [{ kind: 'DealTile', source: 'live', step: 1, seat: 0, tile: '9p' }, { kind: 'DealTile', source: 'live', step: 999, seat: 1, tile: 'FUTURE' }];
  const result = await w.service.analyze(data, 1); assert.equal(result.ok, true, result.error);
  assert.equal(result.result.decision.tile, '9p');
  assert.doesNotMatch(w.requests[0].options.body, /PINNED_TEACHING|FUTURE|timeline|explanation/);
  assert.match(w.requests.at(-1).options.body, /PINNED_TEACHING_PREFERENCE/); assert.doesNotMatch(w.requests.at(-1).options.body, /FUTURE/);
  assert.match(w.requests[1].options.body, /本小局历史参考/);
  // A manual lane never pins live memory; it has a distinct round-context identity.
  stage = 0;
  const manual = input(); manual.lane = 'manual-review';
  const other = setup(async (_url, options) => { assert.ok(!JSON.parse(options.body).tools.some(t => t.function.name === 'get_user_memory')); return answer(); }, () => {}, memory);
  assert.equal((await other.service.analyze(manual, 2)).ok, true);
});
