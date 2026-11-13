'use strict';
// 2B only: reuse the fixed R0 boundary and existing runner scheduler; no I/O/provider.
const Core = require('./core.cjs');
const Fixed = require('./phase2-fixed-source.cjs');
const VERSION = 'phase2-summary-online/1';
const POLICIES = ['C-K', 'C-L', 'C-KM'];
function createAdapter(source, expectedHash, generationPolicy, expectedLegendHash) {
  if (generationPolicy?.version !== 'summary-field-semantics/1' ||
      !expectedLegendHash || generationPolicy.legendHash !== expectedLegendHash ||
      Core.stableHash(generationPolicy.legend) !== expectedLegendHash) throw new Error('2B requires hash-bound v3 field semantics');
  const fixed = Fixed.createAdapter(source, expectedHash);
  const legend = generationPolicy.legend;
  function buildContext(input) {
    const policy = input.options?.policy ?? input.scheme?.context?.options?.policy ?? input.scheme?.id;
    if (!POLICIES.includes(policy)) throw new Error('2B policy required');
    // previewContext preserves strict fixed R0 history while allowing ordinary online
    // ready/old-ready/code-tail selection. 2A buildContext requires preaccepted bodies.
    const context = fixed.previewContext(input);
    for (const d of context.summaryJobs) {
      if (d.watermark >= input.node.position || d.source.facts.some(f => f.position > d.watermark) || d.source.opinions.length) throw new Error('2B summary cutoff violation');
      d.messages[0].content += '\n\n' + legend;
      d.generationPolicy = { version: generationPolicy.version, legendHash: expectedLegendHash };
    }
    const c = context.compression;
    const latest = context.summaryJobs[0]?.watermark ?? c.summaryWatermark;
    c.summaryUse = policy === 'C-K' ? 'code-control' : c.summaryWatermark == null ? 'code-fallback' : latest > c.summaryWatermark ? 'old-ready-plus-code-tail' : 'latest-ready-plus-code-tail';
    c.testedLlmSummary = policy !== 'C-K' && c.summaryWatermark != null;
    if (c.testedLlmSummary) {
      const message = context.messages.find(m => m.content.startsWith('已校验来源绑定的历史摘要'));
      const payload = JSON.parse(message.content.slice(message.content.indexOf('\n') + 1));
      const supplied = Array.isArray(input.summary) ? input.summary : Object.values(input.summary ?? {});
      const record = supplied.find(r => r.sourceHash === payload.sourceHash && r.watermark === c.summaryWatermark);
      if (!record) throw new Error('2B consumed summary identity missing');
      const value = JSON.parse(record.text);
      c.summaryBinding = { id: record.id, sourceHash: record.sourceHash, watermark: record.watermark,
        responseTextHash: Core.stableHash(record.text), bodyHash: Core.stableHash({ schemaVersion: value.schemaVersion, facts: value.facts, opinions: value.opinions, limitations: value.limitations }) };
    }
    c.fallbackReason = c.fallback ? (context.summaryJobs.length ? 'eligible-summary-not-ready' : 'no-eligible-checkpoint') : null;
    c.onlineTiming = { version: VERSION, noForegroundWait: true, semanticAdmission: 'none-before-consumption; audit-separately', latestEligibleWatermark: latest, legendHash: expectedLegendHash };
    context.sourceProvenance.experiment = '2B-online-independent-generations';
    return context;
  }
  return { version: 1, buildContext, sourceIdentity: fixed.sourceIdentity };
}
module.exports = { VERSION, POLICIES, createAdapter };
