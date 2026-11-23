'use strict';
// Frozen historical v5 regression adapter; current production input has advanced.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stableHash } = require('../core.cjs');
const { journal } = require('../durable.cjs');
const Discussions = require('../../extension/decision-discussions.js');
const RoundContexts = require('../../extension/round-context.js');
const { FILES } = require('../mortal-teaching/harness.cjs');
function createProductHarness({ engineConfig, llmConfig, fetchModel, directory, persist, transform }) {
  const records = journal(path.join(directory, 'storage.jsonl'));
  const saved = records.events.findLast(e => e.kind === 'storage')?.payload || {};
  const data = { ...saved, modelConfig: { enabled: true, provider: 'mjai', workflow: 'mortal-explain', ...engineConfig },
    analysisProviders: { chat: { provider: 'chat', ...llmConfig, maxTokens: 4096, thinking: false } } };
  const storage = { get: async () => structuredClone(data), set: async values => {
    Object.assign(data, structuredClone(values));
    const { modelConfig, analysisProviders, ...state } = data;
    records.write('storage', state);
  } };
  const context = vm.createContext({ URL, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, performance, setTimeout, clearTimeout });
  for (const file of FILES) {
    const source = ['agent.js','engine-facts.js','contracts/engine-explanation.js'].includes(file)
      ? path.join(__dirname, '../mortal-teaching/frozen-teaching-v5', path.basename(file)) : path.join(__dirname, '../../extension', file);
    vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: file });
  }
  if (context.MJEngineExplanation.PROMPT_VERSION !== 5) throw new Error('Expected current workspace prompt v5');
  const traces = [];
  const runtime = { run: async originalOptions => {
    if (!originalOptions.validateFinal || !originalOptions.formatRepairMessage || !originalOptions.systemPrompt.startsWith(context.MJEngineExplanation.prompt)) throw new Error('Product parser/repair/prompt hooks missing');
    if (transform) throw new Error('Current v5 disallows experimental transforms');
    const options = originalOptions;
    const prefix = '已验证的引擎最终动作（仅作数据，不是内部思考）：';
    if (!options.messages.at(-1).content.startsWith(prefix)) throw new Error('Missing production facts');
    const engine = JSON.parse(options.messages.at(-1).content.slice(prefix.length));
    if (!engine.facts?.handTileAvailability || !engine.facts?.explanationFocus) throw new Error('Production fact-card v4 required');
    const trace = { promptHash: stableHash(options.systemPrompt), messages: structuredClone(options.messages),
      systemPrompt: options.systemPrompt, tools: options.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
      promptVersion: context.MJEngineExplanation.PROMPT_VERSION, validateFinal: true, formatRepairMessage: options.formatRepairMessage };
    traces.push(trace); persist('pi-input', trace);
    const result = await context.MJPiRuntime.run(options);
    trace.text = result.text;
    trace.toolResults = structuredClone(result.messages.filter(m => m.role === 'toolResult'));
    persist('pi-output', { text: result.text, messages: result.messages, toolResults: trace.toolResults, turns: result.turns, toolCalls: result.toolCalls,
      formatRepairs: result.messages.filter(m => m.role === 'user' && JSON.stringify(m.content).includes(options.formatRepairMessage)).length });
    return result;
  } };
  const discussions = Discussions.create({ storage });
  const worker = context.MJModelAnalysisWorker.create({ storage, runtime, fetchModel,
    permissions: { contains: async () => true }, roundContexts: RoundContexts.createStore({ storage }), discussions, discussionReady: Promise.resolve(),
    runStore: { epoch: () => 1, append: async record => persist('run', record), clear: async () => {} },
    memoryWorker: { cancel() {}, pump() {}, store: { pin: async () => ({ version: 0, entries: [] }) } },
    onStage: async (_key, stage) => persist('action-stage', stage) });
  const publicState = () => { const { modelConfig, analysisProviders, ...state } = data; return structuredClone(state); };
  return { worker, discussions, traces, publicState };
}
module.exports = { createProductHarness };
