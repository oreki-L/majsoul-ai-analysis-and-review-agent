'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stableHash } = require('../core.cjs');
const { journal } = require('../durable.cjs');
const Discussions = require('../../extension/decision-discussions.js');
const RoundContexts = require('../../extension/round-context.js');
const { transformOptions, transformBody } = require('./retest-projection.cjs');
const { transformHonorOptions } = require('./honor-chinese.cjs');
const FILES = ['contracts/snapshot.js', 'adapters/model-endpoint.js', 'adapters/engine-endpoint.js', 'adapters/mjai.js', 'mahjong-analysis.js', 'analysis.js', 'harness.js', 'contracts/engine-explanation.js', 'xf-context.js', 'engine-facts.js', 'agent.js', 'pi-runtime.js', 'model-usage.js', 'model-session-transport.js', 'contracts/engine-result.js', 'engine-agent.js', 'model-analysis-worker.js'];
function createHarness({ variant, engineConfig, llmConfig, fetchModel, directory, initialState, persist = () => {} }) {
  const records = directory ? journal(path.join(directory, 'storage.jsonl')) : null;
  // Never persist API keys, configuration or the in-memory storage envelope.
  const saved = records?.events.findLast(e => e.kind === 'storage')?.payload || initialState || {};
  const data = { ...saved, modelConfig: { enabled: true, provider: 'mjai', workflow: 'mortal-explain', ...engineConfig },
    analysisProviders: { chat: { provider: 'chat', ...llmConfig, maxTokens: 4096, thinking: false } } };
  const storage = { get: async () => structuredClone(data), set: async values => {
    Object.assign(data, structuredClone(values));
    const { modelConfig, analysisProviders, ...publicState } = data;
    records?.write('storage', publicState);
  } };
  const context = vm.createContext({ URL, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, performance, setTimeout, clearTimeout });
  for (const file of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension', file), 'utf8'), context, { filename: file });
  // This harness reproduces the v2 experiment; product v3 facts/repair are separate treatments.
  const parseExplanation = context.MJEngineExplanation.parse;
  context.MJEngineExplanation.PROMPT_VERSION = 2;
  context.MJEngineExplanation.parse = content => ({ ...parseExplanation(content), promptVersion: 2 });
  const traces = [], stages = [], runs = [];
  const runtime = { run: async options => {
    const { validateFinal, formatRepairMessage, ...legacyOptions } = options;
    const messages = options.messages.slice(), last = messages.at(-1);
    const prefix = '已验证的引擎最终动作（仅作数据，不是内部思考）：';
    if (last?.role !== 'user' || !last.content.startsWith(prefix)) throw new Error('Missing bound experiment engine action');
    const engine = JSON.parse(last.content.slice(prefix.length));
    delete engine.facts;
    messages[messages.length - 1] = { ...last, content: prefix + JSON.stringify(engine) };
    options = transformOptions({ ...legacyOptions, messages }, variant);
    options = transformHonorOptions(options, variant);
    const original = context.MJEngineExplanation.prompt;
    if (!options.systemPrompt.startsWith(original)) throw new Error('Unexpected product explanation prompt');
    const replaced = variant.text + options.systemPrompt.slice(original.length);
    traces.push({ promptHash: stableHash(replaced), candidateSha256: variant.sha256, messages: structuredClone(options.messages), tools: options.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) });
    persist('pi-input', traces.at(-1));
    const trace = traces.at(-1);
    const result = await context.MJPiRuntime.run({ ...options, systemPrompt: replaced });
    trace.text = result.text;
    trace.toolResults = structuredClone(result.messages.filter(m => m.role === 'toolResult'));
    persist('pi-output', { text: trace.text, toolResults: trace.toolResults, turns: result.turns, toolCalls: result.toolCalls });
    return result;
  } };
  const discussions = Discussions.create({ storage });
  // Only explicitly opted-in experiments alter model HTTP bodies. Engine HTTP
  // requests keep their product bytes, including when endpoints share a host.
  const experimentFetch = variant.experiment?.jsonObject === true ? (url, options) => {
    const body = JSON.parse(options.body);
    return fetchModel(url, Array.isArray(body.messages)
      ? { ...options, body: JSON.stringify(transformBody(body, variant)) } : options);
  } : fetchModel;
  const worker = context.MJModelAnalysisWorker.create({ storage, runtime, fetchModel: experimentFetch,
    permissions: { contains: async () => true }, roundContexts: RoundContexts.createStore({ storage }),
    discussions, discussionReady: Promise.resolve(),
    runStore: { epoch: () => 1, append: async record => { runs.push(structuredClone(record)); persist('run', record); }, clear: async () => {} },
    memoryWorker: { cancel() {}, pump() {}, store: { pin: async () => ({ version: 0, entries: [] }) } },
    onStage: async (_key, stage) => { stages.push(structuredClone(stage)); persist('action-stage', stage); }
  });
  // Component runs also use the product worker/Pi/transport/parser, with one
  // cached validated engine response. The caller chooses fresh per-point stores
  // or keeps this harness/store for a candidate's development/round history.
  const publicState = () => { const { modelConfig, analysisProviders, ...state } = data; return structuredClone(state); };
  return { worker, discussions, traces, stages, runs, data, publicState };
}
module.exports = { createHarness, FILES };
