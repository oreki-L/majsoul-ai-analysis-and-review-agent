'use strict';
// Holdout-only routing. Baselines remain their original pure builders. No I/O,
// credentials, labels or fixed development opinions enter this adapter.
const Core = require('./core.cjs');
const Combo = require('./phase2-combinations.cjs');
const Next = require('./next-stage-context.cjs');
const Facts = require('./phase3-facts.cjs');
const VERSION = 'holdout-validation/1';
const POLICIES = Object.freeze(['EV-0', 'X-S', 'X-F', 'C-KM']);
function createAdapter(raw, generationPolicy) {
  const sources = structuredClone(raw), combo = Combo.createAdapter(sources);
  if (generationPolicy?.version !== 'summary-field-semantics/1' || Core.stableHash(generationPolicy.legend) !== generationPolicy.legendHash) throw Error('Hash-bound 2B field semantics required');
  return { version: 1, buildContext(input) {
    const policy = input.options?.policy ?? input.scheme.context.options.policy;
    if (!POLICIES.includes(policy)) throw Error('Unsupported holdout policy');
    if (policy !== 'C-KM') {
      const baseline = policy === 'EV-0' ? 'EV-0' : 'X-S';
      const context = combo.buildContext({ ...input, scheme: { ...input.scheme, id: baseline }, options: { ...input.options, policy: baseline, sourceMode: 'own-causal-history' } });
      return policy === 'X-F' ? Facts.attach(context, input.node, { claims: false }) : context;
    }
    const source = sources.rounds.find(r => r.id === input.node.roundId);
    if (!source?.nodeBindings.some(b => b.decisionId === input.node.id && b.position === input.node.position && b.snapshotHash === Core.stableHash(input.node.snapshot))) throw Error('Holdout C-KM source binding mismatch');
    const context = Next.build({ ...input, options: { ...input.options, policy, sourceMode: 'own-causal-history' } }, source);
    for (const d of context.summaryJobs) {
      if (d.watermark >= input.node.position || d.source.facts.some(f => f.position > d.watermark) || d.source.opinions.length) throw Error('C-KM summary cutoff violation');
      d.messages[0].content += '\n\n' + generationPolicy.legend;
      d.generationPolicy = { version: generationPolicy.version, legendHash: generationPolicy.legendHash };
    }
    const c = context.compression, latest = context.summaryJobs[0]?.watermark ?? c.summaryWatermark;
    c.summaryUse = c.summaryWatermark == null ? 'code-fallback' : latest > c.summaryWatermark ? 'old-ready-plus-code-tail' : 'latest-ready-plus-code-tail';
    c.testedLlmSummary = c.summaryWatermark != null;
    if (c.testedLlmSummary) {
      const message = context.messages.find(m => m.content.startsWith('已校验来源绑定的历史摘要'));
      const payload = JSON.parse(message.content.slice(message.content.indexOf('\n') + 1));
      const supplied = Array.isArray(input.summary) ? input.summary : Object.values(input.summary ?? {});
      const record = supplied.find(r => r.sourceHash === payload.sourceHash && r.watermark === c.summaryWatermark);
      if (!record) throw Error('C-KM consumed summary identity missing');
      const value = JSON.parse(record.text);
      c.summaryBinding = { id: record.id, sourceHash: record.sourceHash, watermark: record.watermark, responseTextHash: Core.stableHash(record.text), bodyHash: Core.stableHash({ schemaVersion: value.schemaVersion, facts: value.facts, opinions: value.opinions, limitations: value.limitations }) };
    }
    c.fallbackReason = c.fallback ? (context.summaryJobs.length ? 'eligible-summary-not-ready' : 'no-eligible-checkpoint') : null;
    c.onlineTiming = { version: VERSION, noForegroundWait: true, semanticAdmission: 'none-before-consumption; audit-separately', latestEligibleWatermark: latest, legendHash: generationPolicy.legendHash };
    context.sourceProvenance = { experiment: 'holdout-own-causal-history', sourceMode: 'own-causal-history', historyDecisionIds: context.sourceDecisionIds };
    return context;
  } };
}
module.exports = { VERSION, POLICIES, createAdapter };
