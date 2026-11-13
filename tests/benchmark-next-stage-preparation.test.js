'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../benchmark/next-stage-preparation.cjs');

test('next preparation preserves original slot ordering and isolation without reading credentials', () => {
  const mapping = P.makeKeyMapping({ credentialsFile: 'does-not-exist.private.json' });
  assert.equal(mapping.credentialsRead, false);
  assert.equal(mapping.assigned[0].schemeId, 'R0');
  assert.equal(mapping.assigned[0].credentialAlias, 'group:A');
  assert.equal(mapping.assigned[13].credentialAlias, 'group:H3');
  assert.equal(mapping.assigned[14].credentialAlias, 'alias:plan15');
  assert.deepEqual(mapping.assigned.slice(-2).map(r => [r.schemeId, r.credentialAlias]), [['W-C', 'alias:plan18'], ['W-V', 'alias:plan19']]);
  assert.deepEqual(mapping.reserved.map(r => r.credentialAlias), ['alias:plan20', 'alias:plan21', 'alias:plan22']);
  assert.equal(mapping.unused.length, 12);
  assert.equal(P.validateMapping(mapping), mapping);
  const changed = structuredClone(mapping); changed.assigned[2].credentialAlias = changed.assigned[0].credentialAlias;
  assert.throws(() => P.validateMapping(changed), /mapping changed/);
});

test('next stage counts distinguish conditional paired outputs and final single-pass validation', () => {
  const mapping = P.makeKeyMapping({ credentialsFile: 'none.private.json' });
  const plan = P.stagePlan(mapping);
  assert.equal(plan.maximumOutputOpportunities, 1079);
  assert.deepEqual(plan.cancelledSchemeIds, ['R2', 'R4']);
  assert.equal(plan.stages.find(s => s.id === 'phase3-facts').independentDrafts, 29);
  assert.equal(plan.stages.find(s => s.id === 'phase4').repetitions, 1);
  assert.deepEqual(plan.selectedCandidates, []);
  assert.equal(plan.executionMode, 'prepare-only');
  assert.equal(plan.stages.filter(s => s.id === 'phase2b')[0].repetitions, 2);
});

test('budget authorization records the human cap and exact original key scope without granting dispatch', () => {
  const approval = P.approval(P.makeKeyMapping({ credentialsFile: 'none.private.json' }));
  assert.equal(approval.cap, 70);
  assert.equal(approval.oldCampaignBalanceTransferred, false);
  assert.equal(approval.allowedReferences.length, 22);
  assert.match(approval.phaseGate, /prepare-only/);
  assert.equal(JSON.stringify(approval).includes('apiKey'), false);
});

test('frozen phase suite retains causal realtime-only policies and shared aggregate cap', () => {
  const mapping = P.makeKeyMapping({ credentialsFile: 'none.private.json' });
  const model = { provider: 'mock', model: 'synthetic', maxTokens: 4096, rates: { input: 0, output: 0, cachedInput: 0, currency: 'CNY' } };
  const suite = P.phaseSuite({ stageId: 'phase1', dataset: 'old29.json', labels: 'labels.json', contextModule: './adapter.cjs', model, mapping });
  assert.deepEqual(suite.schemes.map(s => s.id), P.CORE);
  assert.equal(suite.execution.budget.cap, 70);
  assert.equal(suite.execution.maxModelRequests, null);
  assert.equal(suite.execution.maxToolCalls, null);
  assert.equal(suite.schemes.find(s => s.id === 'R7').summaryModelId, 'deepseek-flash');
  const replay = P.phaseSuite({ stageId: 'phase2a', dataset: 'old29.json', labels: 'labels.json', contextModule: './adapter.cjs', model, mapping });
  assert.ok(replay.schemes.every(s => s.context.options.sourceMode === 'fixed-source-replay'));
  assert.throws(() => P.phaseSuite({ stageId: 'phase3-facts', mapping }), /candidate lock/);
});

test('cost envelope never turns historical averages into a guaranteed completion price', () => {
  const costs = P.pricingEnvelope({ rates: { cachedInput: .04, uncachedInput: 2, output: 8 }, liabilityBound: { inputTokens: 1048576, outputTokens: 4096 } });
  assert.equal(costs.outputOpportunities, 1079);
  assert.equal(costs.fullRunCostGuaranteedWithinCap, false);
  assert.equal(costs.exactHttpCount, null);
  assert.equal(costs.upperBound.amount, null);
  assert.equal(costs.inheritedUnknownRequestHold, 2.12992);
  assert.equal(costs.historicalMeanScenarioOnly.total.length, 2);
});

test('preparation manifest fails closed after a frozen artifact changes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-stage-preparation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'safe.json'), '{"ready":false}\n');
  const manifest = P.freezePreparation(dir, ['safe.json'], { network: false, credentialsRead: false });
  assert.equal(P.verifyPreparation(dir).hash, manifest.hash);
  fs.writeFileSync(path.join(dir, 'safe.json'), '{"ready":true}\n');
  assert.throws(() => P.verifyPreparation(dir), /artifact mismatch/);
  assert.throws(() => P.freezePreparation(dir, ['../escape.json']), /path escape/);
});
