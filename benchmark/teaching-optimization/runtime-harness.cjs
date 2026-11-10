'use strict';
// Separate candidate adapter: keep production parser, repair and tools intact.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stableHash } = require('../core.cjs');
const { journal } = require('../durable.cjs');
const Discussions = require('../../extension/decision-discussions.js');
const RoundContexts = require('../../extension/round-context.js');
const { FILES } = require('../mortal-teaching/harness.cjs');
function createProductHarness({ engineConfig, llmConfig, fetchModel, directory, persist, candidate }) {
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
    const source = file === 'agent.js' || file === 'engine-facts.js' || file === 'contracts/engine-explanation.js'
      ? path.join(__dirname, '../mortal-teaching/released-v0168', path.basename(file)) : path.join(__dirname, '../../extension', file);
    vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: file });
  }
  if (context.MJEngineExplanation.PROMPT_VERSION !== 3) throw new Error('Expected released prompt v3');
  const traces = [];
  const runtime = { run: async originalOptions => {
    if (!originalOptions.validateFinal || !originalOptions.formatRepairMessage || !originalOptions.systemPrompt.startsWith(context.MJEngineExplanation.prompt)) throw new Error('Product parser/repair/prompt hooks missing');
    const { transformOptions, CANDIDATES } = require('./candidates.cjs');
    if (!CANDIDATES.some(c => c.id === candidate) || candidate === 'b-compact-control') throw new Error('Expected frozen S1/S2/S3 candidate');
    const originalHash = stableHash(JSON.parse(JSON.stringify(originalOptions)));
    const options = transformOptions(originalOptions, candidate);
    if (originalHash !== stableHash(JSON.parse(JSON.stringify(originalOptions)))) throw new Error('Original product input changed');
    if (options.validateFinal !== originalOptions.validateFinal || options.formatRepairMessage !== originalOptions.formatRepairMessage) throw new Error('Candidate cannot replace validation or repair');
    const prefix = '已验证的引擎最终动作（仅作数据，不是内部思考）：';
    const engine = JSON.parse(options.messages.at(-1).content.slice(prefix.length));
    if (!options.messages.at(-1).content.startsWith(prefix) || !engine.facts) throw new Error('Product facts must reach the runtime unchanged');
    const originalEngine = JSON.parse(originalOptions.messages.at(-1).content.slice(prefix.length));
    const restored = JSON.parse(JSON.stringify(engine));
    delete restored.facts.handTileAvailability;
    delete restored.facts.explanationFocus;
    if (stableHash(restored) !== stableHash(originalEngine)) throw new Error('Candidate changed engine or baseline facts');
    if (stableHash(options.messages.at(-2)) !== stableHash(originalOptions.messages.at(-2)) || options.tools !== originalOptions.tools) throw new Error('Candidate changed current snapshot or tools');
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
