'use strict';
// Explicit local-only acceptance runner. No downloads or paid LLM calls.
const { createRunner } = require('../agent/mjai-process.cjs');
const { verifyFiles, runtimeConfig, source } = require('../agent/akagi-local.cjs');
const State = require('../extension/state.js');
const Snapshot = require('../extension/collector/snapshot-adapter.js');
const Mjai = require('../extension/adapters/mjai.js');
const Engine = require('../extension/engine-agent.js');
const Agent = require('../extension/agent.js');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const [dir, python] = process.argv.slice(2);
  if (!dir || !python) throw Error('Usage: node scripts/validate-mortal-local.cjs ASSET_DIR PYTHON_EXE');
  await verifyFiles(dir);
  const context = vm.createContext({ AbortController, setTimeout, clearTimeout, structuredClone, performance, TextEncoder, TextDecoder });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/pi-runtime.js'),'utf8'), context);
  const runner = createRunner(runtimeConfig({ dir, python })), results = [];
  for (let seat = 0; seat < 4; seat++) {
    const hand = ['1z','6p','9m','8m','7z','2s','7m','2z','6m','1m','2z','3s','8m'];
    const events = [{ kind: 'NewRound', source: 'live', step: 0, wind: 0, round: seat, honba: 0, sticks: 0, scores: [25000,25000,25000,25000], remaining: 70, doras: ['2s'], hand },
      { kind: 'DealTile', source: 'live', step: 1, seat, tile: '1m', remaining: 69 }];
    const state = events.reduce((s,e) => State.apply(s,e), State.initial('live',seat));
    const snapshot = Snapshot.snapshot(state, { game: true, rivers: 'all', hand: true });
    const request = Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'live', state, events }, { hand: true });
    const started = Date.now();
    const engine = await Engine.run({ snapshot, request, infer: (payload, options) => runner.infer(payload, options), timeoutMs: 30000 });
    const teaching = await Agent.run({ snapshot, engineDecision: engine.engine, runtime: context.MJPiRuntime,
      transport: async () => ({ text: JSON.stringify({ summary: '本地动作已校验；此处仅用 mock 验证解释合同。', reasons: [], limitations: ['没有调用真实 LLM，不能证明教学质量。'] }) }) });
    results.push({ seat, action: engine.engine.action, followUp: engine.engine.followUp, elapsedMs: Date.now() - started, validated: true, explanationContract: !!teaching.explanation });
  }
  console.log(JSON.stringify({ profile: source.profile, commit: source.commit, llm: 'mock only, no paid HTTP', results }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
