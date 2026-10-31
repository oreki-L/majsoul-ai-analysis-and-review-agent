'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compileSuite, stableHash } = require('../benchmark/core.cjs');
const { buildContext } = require('../benchmark/context.cjs');
const { buildCampaignContext, VERSION } = require('../benchmark/campaign-policies.cjs');
const Discussion = require('../benchmark/discussion-policies.cjs');
const Global = require('../benchmark/global-policies.cjs');
const { runJobs, jobFingerprint, validatePreparedJobs } = require('../benchmark/job-runner.cjs');
const { runSuite } = require('../benchmark/runner.cjs');
function fixture() {
  const suite = compileSuite(path.join(__dirname, '../benchmark/examples/suite.mock.json')), round = suite.dataset.rounds[0], node = round.decisions[0], baseline = buildContext({ scheme: { id: 'fixture', context: {} }, node, history: [], events: [] });
  const initial = structuredClone(node.snapshot); initial.lastStep = 0;
  const source = { id: round.id, baseline: { position: 0, snapshot: initial, origin: 'round-start' }, events: [], states: [{ position: node.position, snapshot: node.snapshot }] };
  const answer = { task: 'combined', danger: [], efficiency: [], decision: { action: 'unknown', tile: node.legalActions[0].tile, reasons: ['风险未知，保留条件。'] }, limitations: [] };
  const pairs = Array.from({ length: 11 }, (_, i) => ({ decisionId: node.id, roundId: node.roundId, sessionId: node.sessionId, position: node.position, authorization: node.authorization, question: `问题${i + 1}，请解释条件。`, answer: JSON.stringify(answer) }));
  function input(variant) { return { scheme: { id: `branch-${variant}`, context: {} }, node, prepared: baseline.prepared, originalAnswer: answer, channel: 'decision-discussion', question: '请继续解释。', branchHistory: pairs, history: [], summary: [], options: { version: VERSION, policy: 'H4', discussionVersion: Discussion.VERSION, branchVariant: variant, recent: 4, trigger: 1 } }; }
  function base(i) { return buildCampaignContext({ ...i, branchHistory: [] }, source); }
  return { node, answer, pairs, input, base, suite };
}
test('all five long-branch variants use one frozen baseline, raw paired history and scoped same-source prefix', () => {
  const f = fixture(), outputs = {};
  for (const variant of Discussion.VARIANTS) { const input = f.input(variant); outputs[variant] = Discussion.buildDiscussionContext(input, f.base(input)); assert.equal(outputs[variant].qaResponseFormat, 'analysis-json'); assert.equal(outputs[variant].historyPolicy.currentSnapshotCompressed, false); assert.equal(outputs[variant].messages[1].content, outputs['baseline-fullbranch'].messages[1].content); }
  assert.equal(outputs['baseline-fullbranch'].summaryJobs.length, 0); assert.equal(outputs['baseline-fullbranch'].compression.branch.rawItems, 11);
  assert.equal(outputs['K-code'].compression.branch.transformedItems, 7);
  const free = outputs['KM-code+freetext'].summaryJobs[0], typed = outputs['H7-code+typed'].summaryJobs[0];
  assert.deepEqual(free.source, typed.source); assert.deepEqual(free.coveredDecisionIds, typed.coveredDecisionIds);
  for (const variant of ['M-freetext', 'KM-code+freetext', 'H7-code+typed']) {
    const raw = outputs[variant], job = raw.summaryJobs[0], input = f.input(variant), text = job.mockText ?? '仅保留历史意见与条件。'; input.summary = [{ ...job, text }];
    const ready = Discussion.buildDiscussionContext(input, f.base(input)); assert.equal(ready.compression.branch.summarizedItems, 7); assert.equal(ready.compression.branch.rawItems, 4); assert.equal(ready.summaryJobs.length, 0);
    assert.equal(ready.messages.filter(m => m.content === f.pairs[0].question).length, 0);
  }
  const invalid = f.input('K-code'); invalid.branchHistory[0] = { ...invalid.branchHistory[0], roundId: 'different' };
  assert.throws(() => Discussion.buildDiscussionContext(invalid, f.base({ ...invalid, branchHistory: [] })), /scope/);
});
test('typed branch summary requires exact user quotation, scoped sources and verifiable frozen fact paths', () => {
  const f = fixture(), input = f.input('H7-code+typed'), job = Discussion.buildDiscussionContext(input, f.base(input)).summaryJobs[0], value = JSON.parse(job.mockText);
  value.explicitUserGoals.push({ sourceIds: [job.coveredDecisionIds[0]], text: '请解释条件。' });
  value.verifiedFacts.push({ sourceSnapshotHash: stableHash(f.node.snapshot), path: ['selfHand', 0], value: f.node.snapshot.selfHand[0] });
  assert.deepEqual(Discussion.validateTypedSummary(JSON.stringify(value), job), value);
  value.verifiedFacts[0].value = '9z'; assert.throws(() => Discussion.validateTypedSummary(JSON.stringify(value), job), /frozen authority/);
  value.verifiedFacts = []; value.explicitUserGoals[0].text = '用户长期喜欢激进'; assert.throws(() => Discussion.validateTypedSummary(JSON.stringify(value), job), /quote/);
  value.explicitUserGoals[0] = { sourceIds: ['other-branch'], text: '条件' }; assert.throws(() => Discussion.validateTypedSummary(JSON.stringify(value), job), /source/);
});
test('three global policies share explicit cross-round asOf projection and tools reject all out-of-scope nodes', async () => {
  const f = fixture(), rounds = f.suite.dataset.rounds.map(r => ({ ...r, productionEvents: [{ kind: 'DealTile', source: r.decisions[0].snapshot.source, position: r.decisions[0].position, seat: (r.decisions[0].snapshot.selfSeat + 1) % 4, tile: '9m' }, { kind: 'DiscardTile', source: r.decisions[0].snapshot.source, position: 99999, seat: r.decisions[0].snapshot.selfSeat, tile: '1m' }] }));
  const scope = { id: 'two-selected-rounds', rounds: rounds.map(r => ({ roundId: r.id, asOf: r.decisions[0].position })) };
  const projected = Global.projectScope(rounds, scope); assert.equal(projected.length, 2); assert.ok(projected.every(r => r.events.every(e => e.position <= r.asOf && e.tile !== '9m')));
  const input = { ...f.input('unused'), channel: 'global-analysis', branchHistory: [], globalHistory: [], question: '请比较选定小局。' }, initial = {};
  for (const variant of Global.VARIANTS) { initial[variant] = Global.buildGlobalContext({ ...input, options: { globalVersion: Global.VERSION, globalVariant: variant, recent: 4, trigger: 1 } }, rounds, scope); assert.equal(initial[variant].scopeHash, initial['Global-Full'].scopeHash); }
  const tools = initial['Global-Code'].tools, get = tools.find(t => t.name === 'get_scoped_decision');
  await assert.rejects(get.execute('fake', { decisionId: rounds[0].decisions[1].id }), /outside/);
  const allowed = await get.execute('allowed', { decisionId: rounds[0].decisions[0].id }); assert.ok(allowed.content[0].text.includes(rounds[0].decisions[0].id));
  const limited = structuredClone(projected); limited[0].decisions[0].legalActions = [limited[0].decisions[0].legalActions[0]];
  const calculation = await Global.createGlobalTools(limited).find(t => t.name === 'get_scoped_calculations').execute('legal', { decisionId: limited[0].decisions[0].id });
  const candidates = JSON.parse(calculation.content[0].text).calculations.efficiency.candidates;
  assert.ok(candidates.length > 0); assert.ok(candidates.every(c => c.tile === limited[0].decisions[0].legalActions[0].tile));

  const history = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, question: `问题${i}`, answer: `意见${i}`, scopeHash: initial['Global-Code'].scopeHash }));
  const hybridInput = { ...input, globalHistory: history, options: { globalVersion: Global.VERSION, globalVariant: 'Global-Hybrid', recent: 4, trigger: 1 } }, raw = Global.buildGlobalContext(hybridInput, rounds, scope), job = raw.summaryJobs[0];
  const ready = Global.buildGlobalContext({ ...hybridInput, summary: [{ ...job, text: '历史global意见，非事实。' }] }, rounds, scope);
  assert.equal(ready.compression.global.summarizedItems, 6); assert.equal(ready.compression.global.rawItems, 4);
  const wrong = [...history]; wrong[0] = { ...wrong[0], scopeHash: 'other-scope' }; assert.throws(() => Global.buildGlobalContext({ ...hybridInput, globalHistory: wrong }, rounds, scope), /scope/);
});
test('cold summary preparation is explicitly synthetic in mock, persists/resumes, and never resolves credentials or fetches', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-cold-jobs-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = fixture(), input = f.input('H7-code+typed'), descriptor = Discussion.buildDiscussionContext(input, f.base(input)).summaryJobs[0];
  const manifest = { schemaVersion: 1, id: 'cold-mock-only', sourceFreezeHash: 'frozen-source-fixture', budget: { cap: 50, currency: 'CNY' }, models: { mock: { provider: 'mock', model: 'synthetic', maxTokens: 4096 } }, jobs: [{ id: descriptor.id, schemeId: input.scheme.id, decisionId: f.node.id, modelId: 'mock', credentialAlias: 'alias:plan21', descriptor }] };
  const state = await runJobs(manifest, { output: dir, mode: 'mock', fetch: () => { throw new Error('Never fetch'); }, credentialResolver: () => { throw new Error('Never resolve'); } });
  assert.equal(state.status, 'complete'); assert.equal(state.synthetic, true); assert.equal(state.results[0].actualOnlineLatency, false); assert.equal(state.requests[descriptor.id].attempts[0].dispatched, false);
  const resumed = await runJobs(manifest, { output: dir, mode: 'mock', resume: true }); assert.equal(resumed.results.length, 1);
  // Explicitly synthetic in-memory fixture exercises the evidence validator without any live request.
  const evidence = structuredClone(state); evidence.mode = 'live'; evidence.synthetic = false;
  evidence.fingerprint = jobFingerprint(manifest, 'live', evidence.authorizationHash);
  evidence.results[0].synthetic = false;
  Object.assign(evidence.requests[descriptor.id].attempts[0], { dispatched: true, mock: false, status: 'success', usage: { inputTokens: 1, outputTokens: 1 } });
  const prepared = { synthetic: false, status: 'complete', sourceFreezeHash: manifest.sourceFreezeHash, jobManifestHash: stableHash(manifest), summaries: structuredClone(evidence.results) };
  assert.equal(validatePreparedJobs(manifest, prepared, evidence), prepared);
  const edited = structuredClone(prepared); edited.summaries[0].text += ' altered';
  assert.throws(() => validatePreparedJobs(manifest, edited, evidence), /checkpoint raw response/);
  const changedCode = structuredClone(evidence); changedCode.fingerprint = 'wrong';
  assert.throws(() => validatePreparedJobs(manifest, prepared, changedCode), /fingerprint/);
  const changedStored = structuredClone(evidence); changedStored.results[0].text += ' altered';
  assert.throws(() => validatePreparedJobs(manifest, { ...prepared, summaries: changedStored.results }, changedStored), /checkpoint raw response/);

  const pending = JSON.parse(fs.readFileSync(path.join(dir, 'checkpoint.json'), 'utf8')); pending.requests[descriptor.id].status = 'pending'; fs.writeFileSync(path.join(dir, 'checkpoint.json'), JSON.stringify(pending));
  await assert.rejects(runJobs(manifest, { output: dir, mode: 'mock', resume: true }), /unresolved/);
});

test('controlled runner replays a frozen real-shaped QA prefix, bills only measured suffix, and preserves it on resume', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-controlled-runner-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = fixture(), suite = f.suite; suite.schemes = [suite.schemes[0]]; suite.dataset.rounds = [suite.dataset.rounds[0]]; suite.dataset.rounds[0].globalTasks = []; suite.dataset.rounds[0].decisions = [suite.dataset.rounds[0].decisions[0]];
  const node = suite.dataset.rounds[0].decisions[0]; node.followups = Array.from({ length: 4 }, (_, i) => ({ id: `suffix-${i + 9}`, question: `固定后续问题${i + 9}` }));
  const modulePath = path.join(dir, 'controlled.cjs'), discussionPath = require.resolve('../benchmark/discussion-policies.cjs');
  fs.writeFileSync(modulePath, `'use strict'; const D=require(${JSON.stringify(discussionPath)}); module.exports={version:1,buildContext(input){ const base={...input.baseline,requireFixedMainSource:true}; if(input.channel==='realtime')return base; return D.buildDiscussionContext({...input,options:{discussionVersion:D.VERSION,branchVariant:'K-code',recent:4,trigger:1}}, {...base,messages:input.baseline.messages.filter((m,i)=>i<2).concat([{role:'assistant',content:JSON.stringify(input.originalAnswer)},{role:'user',content:input.question}])}); }};`);
  suite.schemes[0].context.module = modulePath;
  const seeds = { [node.id]: f.pairs.slice(0, 8) }, answers = { [node.id]: f.answer }, checkpoint = path.join(dir, 'checkpoint.json');
  const result = await runSuite(suite, { checkpoint, mode: 'mock', fixedMainAnswers: answers, seededBranches: seeds, campaignKind: 'branch' });
  assert.equal(result.results.filter(r => r.sourceFixture).length, 1); assert.equal(Object.values(result.requests).length, 4);
  assert.ok(result.results.filter(r => r.channel === 'branch').every(r => r.status === 'success' && r.answer && r.compression.branch.transformedItems >= 4));
  assert.equal(Object.values(result.branches)[0].length, 12); assert.equal(Object.values(result.requests).filter(r => r.role === 'initial').length, 0);
  const restored = await runSuite(suite, { checkpoint, mode: 'mock', resume: true, fixedMainAnswers: answers, seededBranches: seeds, campaignKind: 'branch' });
  assert.equal(Object.values(restored.branches)[0].length, 12); assert.equal(restored.modelRequests, result.modelRequests);
});
