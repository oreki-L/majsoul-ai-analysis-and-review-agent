'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Discussions = require('../../extension/decision-discussions.js');
const RoundContexts = require('../../extension/round-context.js');
const { FILES } = require('../mortal-teaching/harness.cjs');

function createProductHarness({ engineConfig, llmConfig, fetchModel, frozenHistory, persist = () => {}, versions = { prompt: 7, facts: 6 } }) {
  if (typeof fetchModel !== 'function') throw new Error('An explicit transport is required');
  const data = {
    modelConfig: { enabled: true, provider: 'mjai', workflow: 'mortal-explain', ...engineConfig },
    analysisProviders: { chat: { provider: 'chat', ...llmConfig, maxTokens: 4096, thinking: false } } };
  const storage = { get: async () => structuredClone(data), set: async values => { Object.assign(data, structuredClone(values)); } };
  const context = vm.createContext({ URL, TextEncoder, TextDecoder, Uint8Array, AbortController, structuredClone, performance, setTimeout, clearTimeout });
  for (const file of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension', file), 'utf8'), context, { filename: file });
  if (context.MJEngineExplanation.PROMPT_VERSION !== versions.prompt) throw new Error(`Expected workspace prompt v${versions.prompt}`);
  const traces = [];
  const runtime = { run: async prepared => {
    // Keep the original authorized history while production builds both current messages.
    const options = frozenHistory === undefined ? prepared : { ...prepared,
      messages: [...structuredClone(frozenHistory), ...prepared.messages.slice(-2)] };
    if (!options.validateFinal || !options.formatRepairMessage || !options.systemPrompt.startsWith(context.MJEngineExplanation.prompt)) throw new Error('Production parser, repair or prompt missing');
    const prefix = '已验证的引擎最终动作（仅作数据，不是内部思考）：';
    const message = options.messages.at(-1).content;
    if (!message.startsWith(prefix)) throw new Error('Production facts missing');
    const { facts } = JSON.parse(message.slice(prefix.length));
    if (facts?.format !== `mortal-teaching-fact-card-v${versions.facts}`) throw new Error(`Expected production fact card v${versions.facts}`);
    const trace = { messages: structuredClone(options.messages), systemPrompt: options.systemPrompt,
      promptVersion: context.MJEngineExplanation.PROMPT_VERSION, validateFinal: true, formatRepairMessage: options.formatRepairMessage, facts };
    traces.push(trace);
    const result = await context.MJPiRuntime.run(options);
    trace.text = result.text;
    trace.toolResults = structuredClone(result.messages.filter(m => m.role === 'toolResult'));
    return result;
  } };
  const discussions = Discussions.create({ storage });
  const worker = context.MJModelAnalysisWorker.create({ storage, runtime, fetchModel,
    permissions: { contains: async () => true }, roundContexts: RoundContexts.createStore({ storage }), discussions, discussionReady: Promise.resolve(),
    runStore: { epoch: () => 1, append: async record => persist('run', record), clear: async () => {} },
    memoryWorker: { cancel() {}, pump() {}, store: { pin: async () => ({ version: 0, entries: [] }) } },
    onStage: async (_key, stage) => persist('action-stage', stage) });
  return { worker, traces };
}
module.exports = { createProductHarness };
