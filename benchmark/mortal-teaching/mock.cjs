'use strict';
const { stableHash } = require('../core.cjs');
const Mjai = require('../../extension/adapters/mjai.js');
const IDENTITY = { model: 'Yuchen1457-mortal-v4-582500', runtime: 'MOCK-NO-REAL-INFERENCE',
  checkpoint: '738e0d6e3c0ce9671629554ad39abd147d2ffbac676e80b194c83f2acc0fea20', sourceCommit: '0cff2b52982be5b1163aa9a62fb01f03ce91e0d2', modelRevision: '7386c9f5c751a3ea75efea99737cef5a5ef950f1' };
function createMock(data, { tools = true, failLlm = false } = {}) {
  const nodes = new Map(data.nodes.filter(n => n.compatible).map(n => [stableHash(n.message.engineRequest), n]));
  let engines = 0, llm = 0;
  return { counts: () => ({ engines, llm }), fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    if (new URL(url).hostname === '127.0.0.1') {
      engines++;
      const node = nodes.get(stableHash(body));
      if (!node) throw new Error('Unknown synthetic engine request');
      const tile = node.legalActions.find(a => a.action === 'discard')?.tile;
      return Response.json({ action: { type: 'dahai', actor: node.message.snapshot.selfSeat, pai: Mjai.tile(tile), tsumogiri: tile === node.message.snapshot.selfDrawnTile }, identity: IDENTITY });
    }
    llm++;
    if (failLlm) return Response.json({ error: 'mock failure' }, { status: 503 });
    const usage = { prompt_tokens: 100, completion_tokens: 30, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 };
    if (tools && body.tools?.length && !body.messages.some(m => m.role === 'tool')) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'mock-compare', type: 'function', function: { name: 'compare_discards', arguments: '{}' } }] } }], usage });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '仅用于验证链路的模拟教学。', reasons: ['模拟文本不构成真实教学质量证据。'], limitations: ['未调用真实模型。'] }) } }], usage });
  } };
}
module.exports = { createMock, IDENTITY };
