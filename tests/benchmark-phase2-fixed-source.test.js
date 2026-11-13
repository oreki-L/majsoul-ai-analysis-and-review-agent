'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Fixed = require('../benchmark/phase2-fixed-source.cjs');
const Core = require('../benchmark/core.cjs');
const Freeze = require('../benchmark/freeze.cjs');
const Next = require('../benchmark/next-stage-context.cjs');
const preparation = 'D:/雀魂插件/research/evidence/realtime-quality-20261031/phase2-planning/source-preparation';
const filename = path.join(preparation, 'r0-real-source.frozen.json');
const available = fs.existsSync(filename);
const realTest = (name, fn) => test(name, { skip: !available && 'Local real-source evidence is not installed' }, fn);
const load = () => JSON.parse(fs.readFileSync(filename, 'utf8'));
function inputFor(source, index = 4, policy = 'W-SA-K') {
  return { node: structuredClone(source.dataset.rounds[0].decisions[index]), scheme: { id: policy }, options: { policy, sourceMode: 'fixed-source-replay' }, channel: 'realtime', summary: [], history: [] };
}
test('materializer rejects a mock checkpoint even with an intact run contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-mock-'));
  try {
    const body = { runtime: { nodeMajor: Number(process.versions.node.split('.')[0]) }, files: {} };
    fs.writeFileSync(path.join(root, 'run.contract.json'), JSON.stringify({ ...body, hash: Core.stableHash(body) }));
    fs.writeFileSync(path.join(root, 'checkpoint.json'), JSON.stringify({ manifest: { mode: 'mock', synthetic: true } }));
    assert.throws(() => Fixed.materializeRun(root), /non-synthetic/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
realTest('all 29 exact R0 outputs remain bound to real run, dataset and snapshots', () => {
  const source = load();
  const extracted = Fixed.materializeRun('D:/雀魂插件/research/evidence/realtime-quality-20261031/preparation/run-phase1-live');
  assert.equal(extracted.hash, source.hash);
  assert.equal(Fixed.validateSource(source, source.hash).entries.length, 29);
  assert.equal(source.provenance.runId, '38eaae9e-c207-45c8-a49d-986717e4bc5e');
  for (const e of source.entries) assert.equal(Core.stableHash(e.answerText), e.answerTextHash);
});
realTest('rejects rewritten answer, missing source and mock provenance', () => {
  const source = load();
  for (const mutate of [s => { s.entries[0].answerText += 'rewritten'; }, s => { s.entries.pop(); }, s => { s.provenance.synthetic = true; }]) {
    const changed = structuredClone(source); mutate(changed);
    assert.throws(() => Fixed.createAdapter(changed, source.hash), /hash mismatch/);
  }
  for (const mutate of [s => { s.entries[0].position += 1000; }, s => { s.entries[0].evidence.simulatedModelRequests = 1; }]) {
    const changed = structuredClone(source); mutate(changed);
    const { hash, ...body } = changed; changed.hash = Core.stableHash(body);
    assert.throws(() => Fixed.validateSource(changed, changed.hash), /scope\/snapshot mismatch|mock\/fixture/);
  }
});
realTest('current node only receives same-domain strictly past R0 history; online outputs cannot contaminate it', () => {
  const source = load(), adapter = Fixed.createAdapter(source, source.hash), input = inputFor(source);
  input.history = [{ decisionId: 'new-generated-answer', position: 0, answerText: 'NEW-POISON' }];
  const result = adapter.buildContext(input);
  const expected = source.entries.filter(e => e.roundId === input.node.roundId && e.sessionId === input.node.sessionId && e.position < input.node.position).map(e => e.decisionId);
  assert.deepEqual(result.sourceProvenance.historyDecisionIds, expected);
  assert.ok(!expected.includes(input.node.id));
  assert.equal(result.requireFixedMainSource, undefined);
  assert.equal(result.sourceProvenance.currentAnswer, 'normal-new-model-request');
  assert.ok(!JSON.stringify(result).includes('NEW-POISON'));
  result.sourceProvenance.historyDecisionIds.push('mutated-result');
  input.history.push({ decisionId: 'another-online-answer' });
  assert.deepEqual(adapter.buildContext(input).sourceProvenance.historyDecisionIds, expected);
});
realTest('rejects cross-session, cross-round, authorization and future position substitution', () => {
  const source = load(), adapter = Fixed.createAdapter(source, source.hash);
  for (const mutate of [n => { n.sessionId += '-other'; }, n => { n.roundId = source.dataset.rounds[1].id; }, n => { n.authorization.selfSeat = 3; }, n => { n.position += 1; n.snapshot.lastStep += 1; }]) {
    const input = inputFor(source); mutate(input.node);
    assert.throws(() => adapter.buildContext(input), /current node/);
  }
  assert.equal(adapter.buildContext(inputFor(source, 0)).sourceProvenance.historyDecisionIds.length, 0);
});
realTest('Next direct fixed-source rejection remains; unready LLM summary remains blocked', () => {
  const source = load(), input = inputFor(source, 10, 'C-L');
  assert.throws(() => Next.build(input, source.rounds[0]), /explicitly bound frozen source adapter/);
  const adapter = Fixed.createAdapter(source, source.hash);
  assert.ok(adapter.previewContext(input).summaryJobs.length > 0);
  assert.throws(() => adapter.buildContext(input), /summary not ready|binding map not accepted/);
});
realTest('static wrapper graph includes actual JSON sidecar and works after dependency relocation', () => {
  const entry = path.join(preparation, 'context-adapter.cjs'), graph = Freeze.dependencyGraph([entry]);
  assert.ok([...graph.keys()].some(f => f.endsWith('r0-real-source.frozen.json')));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-relocated-'));
  const targets = new Map([...graph.keys()].map(f => [f, crypto.createHash('sha256').update(f).digest('hex') + path.extname(f)]));
  try {
    for (const [file, item] of graph) {
      let body = item.bytes.toString('utf8');
      for (const dep of item.dependencies) body = body.split(dep.specifier).join('./' + targets.get(fs.realpathSync(dep.target)));
      fs.writeFileSync(path.join(root, targets.get(file)), body);
    }
    const moved = require(path.join(root, targets.get(fs.realpathSync(entry))));
    assert.equal(moved.buildContext(inputFor(load())).sourceProvenance.sourceHash, load().hash);
  } finally { fs.rmSync(root, { recursive: true }); }
});
