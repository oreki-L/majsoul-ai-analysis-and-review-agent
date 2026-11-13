'use strict';
// Pure context construction. No credentials, provider dispatch, source loading or I/O.
const Next = require('./next-stage-context.cjs');
const Core = require('./core.cjs');
const VERSION = 'phase2-combinations/1';
const POLICIES = Object.freeze(['EV-0', 'X-S', 'E0-S', 'E0-SA']);
const BASE = Object.freeze({ 'EV-0': 'EV-0', 'X-S': 'X-S', 'E0-S': 'X-S', 'E0-SA': 'X-SA' });
const MAPPING = Object.freeze([
  Object.freeze({ schemeId: 'EV-0', slot: 10, credentialAlias: 'group:M', status: 'existing' }),
  Object.freeze({ schemeId: 'X-S', slot: 7, credentialAlias: 'group:G', status: 'existing' }),
  Object.freeze({ schemeId: 'E0-S', slot: 23, credentialAlias: 'alias:plan23', status: 'proposed-unapproved' }),
  Object.freeze({ schemeId: 'E0-SA', slot: 24, credentialAlias: 'alias:plan24', status: 'proposed-unapproved' })
]);
function build(input, source) {
  const options = input.options ?? input.scheme?.context?.options ?? {};
  const policy = options.policy ?? input.scheme.id;
  if (!POLICIES.includes(policy)) throw new Error('Unsupported combination policy');
  if (options.sourceMode && options.sourceMode !== 'own-causal-history') throw new Error('Combinations require own causal history');
  const result = Next.build({ ...input, options: { ...options, policy: BASE[policy] } }, source);
  if (policy === 'EV-0' || policy === 'X-S') return result;
  // Match the exact R0 extra-event title. Current rivers/public state, calculations,
  // legal candidates and old fact representations are deliberately untouched.
  result.messages = result.messages.filter(m => !m.content.startsWith('已授权历史事件'));
  result.historyPolicy = { ...result.historyPolicy, combinationVersion: VERSION, combinationPolicy: policy };
  result.compression = { ...result.compression, eventTreatment: 'none-extra' };
  return result;
}
function createAdapter(raw) {
  const sources = structuredClone(raw);
  return { version: 1, buildContext(input) {
    const source = sources.rounds.find(r => r.id === input.node.roundId);
    if (!source || !source.nodeBindings.some(b => b.decisionId === input.node.id && b.position === input.node.position && b.snapshotHash === Core.stableHash(input.node.snapshot))) throw new Error('Frozen combination source binding mismatch');
    return build(input, source);
  } };
}
function proposedSuite(original, adapter = './context-adapter.cjs') {
  const suite = structuredClone(original);
  suite.id = 'realtime-next-phase2-combinations-proposed';
  suite.schemes = MAPPING.map(row => ({ id: row.schemeId, modelId: 'deepseek-flash', credentialAlias: row.credentialAlias,
    context: { module: adapter, options: { policy: row.schemeId, sourceSet: 'old29', stage: 'phase2-combinations', sourceMode: 'own-causal-history' } } }));
  suite.execution.repetitions = 1;
  Core.validateSuite(suite);
  return suite;
}
module.exports = { VERSION, POLICIES, BASE, MAPPING, build, createAdapter, proposedSuite };
