'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P2 = require('../benchmark/phase2-prompt.cjs');
test('P2 changes only first system content, preserves source metadata and rejects double injection', () => {
  const original = { messages: [{ role: 'system', content: 'BASE' }, { role: 'user', content: 'CURRENT' }], prepared: { responseSchema: { type: 'object' } }, compression: { summaryBinding: { bodyHash: 'real-body' } } };
  const before = structuredClone(original), actual = P2.apply(original, true);
  assert.deepEqual(original, before);
  assert.deepEqual({ ...actual, messages: original.messages }, original);
  assert.deepEqual(actual.messages.slice(1), original.messages.slice(1));
  assert.equal(actual.messages[0].content, 'BASE' + P2.SUFFIX);
  assert.equal(P2.RULES.length, 4);
  assert.equal(P2.apply(original, false), original);
  assert.throws(() => P2.apply(actual, true), /already appended/);
  assert.throws(() => P2.apply({ messages: [{ role: 'user', content: 'x' }] }, true), /system/);
});
test('paired schemes use identical base inputs and retain causal versus fixed-source semantics', () => {
  const seen = [], base = { messages: [{ role: 'system', content: 'BASE' }] };
  const fake = { buildContext: input => { seen.push(input); return base; } };
  const adapter = P2.createAdapter({ xs: fake, ckm: fake });
  for (const id of Object.keys(P2.POLICIES)) {
    const result = adapter.buildContext({ scheme: { id }, options: { policy: id }, history: ['owned-history'] });
    const spec = P2.POLICIES[id], input = seen.at(-1);
    assert.equal(input.scheme.id, spec.base);
    assert.equal(input.options.sourceMode, spec.base === 'X-S' ? 'own-causal-history' : 'fixed-source-replay');
    assert.deepEqual(input.history, ['owned-history']);
    assert.equal(result.messages[0].content, 'BASE' + (spec.p2 ? P2.SUFFIX : ''));
  }
  assert.throws(() => adapter.buildContext({ scheme: { id: 'unknown' } }), /Unsupported/);
});
