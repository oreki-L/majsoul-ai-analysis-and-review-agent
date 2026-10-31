'use strict';
const { stableHash, canonicalStringify } = require('./core.cjs');
const { makeDescriptor, readyFor } = require('./campaign-policies.cjs');
const VERSION = 'controlled-discussion/1';
const VARIANTS = new Set(['baseline-fullbranch', 'K-code', 'M-freetext', 'KM-code+freetext', 'H7-code+typed']);
const TYPED_FIELDS = ['userQuestion', 'modelOpinion', 'conditionsAndScope', 'verifiedFacts', 'unresolvedItems', 'explicitUserGoals'];
function typedSchema() { return { type: 'object', additionalProperties: false, required: TYPED_FIELDS, properties: Object.fromEntries(TYPED_FIELDS.map(k => [k, { type: 'array' }])) }; }
function codePairs(pairs) {
  const dictionary = [], seen = new Map();
  function ref(text) { if (!seen.has(text)) { seen.set(text, dictionary.length); dictionary.push(text); } return seen.get(text); }
  return { format: 'discussion-verbatim-dictionary-v1', dictionary, exchanges: pairs.map(p => ({ id: p.id, sourcePosition: p.position, questionRef: ref(p.question), answerRef: ref(p.answer), answerMeaning: 'historical model opinion, not fact' })) };
}
function validateTypedSummary(text, descriptor) {
  let value; try { value = JSON.parse(text); } catch { throw new Error('Typed summary is not JSON'); }
  if (!value || Array.isArray(value) || Object.keys(value).length !== TYPED_FIELDS.length || TYPED_FIELDS.some(k => !Array.isArray(value[k]))) throw new Error('Typed summary fields mismatch');
  const ids = new Set(descriptor.coveredDecisionIds), pairs = descriptor.source.pairs, snapshot = descriptor.source.frozenSnapshot;
  for (const field of TYPED_FIELDS.filter(k => k !== 'verifiedFacts')) for (const row of value[field]) {
    if (!row || Object.keys(row).sort().join() !== ['sourceIds', 'text'].sort().join() || !Array.isArray(row.sourceIds) || !row.sourceIds.length || row.sourceIds.some(id => !ids.has(id)) || typeof row.text !== 'string' || !row.text.trim()) throw new Error('Typed summary contains unsupported source references');
    if (['userQuestion', 'explicitUserGoals'].includes(field) && !row.sourceIds.some(id => pairs.find(p => p.id === id)?.question.includes(row.text))) throw new Error('User goals/questions must quote source user text');
  }
  for (const fact of value.verifiedFacts) {
    if (!fact || Object.keys(fact).sort().join() !== ['sourceSnapshotHash', 'path', 'value'].sort().join() || fact.sourceSnapshotHash !== descriptor.source.frozenSnapshotHash || !Array.isArray(fact.path) || fact.path.some(k => typeof k !== 'string' && !Number.isInteger(k))) throw new Error('Typed fact source mismatch');
    let actual = snapshot;
    for (const key of fact.path) { if (['__proto__', 'constructor', 'prototype'].includes(key) || !actual || !Object.hasOwn(actual, key)) throw new Error('Typed fact path unsupported'); actual = actual[key]; }
    if (canonicalStringify(actual) !== canonicalStringify(fact.value)) throw new Error('Typed fact does not match frozen authority');
  }
  return value;
}
function buildDiscussionContext(input, frozenBase) {
  const variant = input.options.branchVariant;
  if (!VARIANTS.has(variant) || input.options.discussionVersion !== VERSION || input.channel !== 'decision-discussion') throw new Error('Unsupported explicit discussion variant');
  const recent = input.options.recent ?? 4, trigger = input.options.trigger ?? 1;
  if (!Number.isSafeInteger(recent) || recent < 1 || !Number.isSafeInteger(trigger) || trigger < 1) throw new Error('Invalid discussion window');
  const pairs = (input.branchHistory ?? []).map((p, i) => {
    if (p.decisionId !== input.node.id || p.position !== input.node.position || p.roundId !== input.node.roundId || p.sessionId !== input.node.sessionId || stableHash(p.authorization) !== stableHash(input.node.authorization)) throw new Error('Discussion source scope mismatch');
    return { id: `${input.node.id}:qa:${i + 1}`, position: p.position, question: p.question, answer: p.answer };
  });
  const prefix = pairs.slice(0, Math.max(0, pairs.length - recent)), jobs = [], messages = frozenBase.messages.slice(0, -1);
  let covered = 0, summary = null;
  const llm = ['M-freetext', 'KM-code+freetext', 'H7-code+typed'].includes(variant);
  function descriptor(entries) {
    const source = { pairs: entries, frozenSnapshot: input.node.snapshot, frozenSnapshotHash: stableHash(input.node.snapshot), authority: 'Only frozenSnapshot supports verified facts. Answers are model opinions; user goals require verbatim quotations.' };
    const job = makeDescriptor(variant === 'H7-code+typed' ? 'branch-typed' : 'branch-freetext', source, input, entries.map(p => p.id));
    if (variant === 'H7-code+typed') {
      job.outputSchema = typedSchema();
      job.messages[0].content += '\n只输出JSON对象，六字段均为数组：userQuestion/modelOpinion/conditionsAndScope/unresolvedItems/explicitUserGoals条目{sourceIds:[真实QA id],text:文字}；userQuestion和explicitUserGoals必须逐字引用用户问题。verifiedFacts条目{sourceSnapshotHash,path:[真实字段路径],value:原值}，只能由冻结snapshot核验；没有可核实项用空数组。未知不编造。';
      job.mockText = JSON.stringify(Object.fromEntries(TYPED_FIELDS.map(k => [k, []])));
    }
    return job;
  }
  if (llm && prefix.length >= trigger) {
    for (let count = prefix.length; count >= trigger; count--) { const job = descriptor(prefix.slice(0, count)), ready = readyFor(job, input.summary); if (ready) { if (job.outputSchema) validateTypedSummary(ready.text, job); covered = count; summary = { sourceHash: job.sourceHash, coveredDecisionIds: job.coveredDecisionIds, text: ready.text, meaning: 'historical discussion summary; not authority' }; break; } }
    if (covered !== prefix.length) jobs.push(descriptor(prefix));
  }
  if (variant === 'K-code' && prefix.length) covered = prefix.length;
  if (covered && ['K-code', 'KM-code+freetext', 'H7-code+typed'].includes(variant)) messages.push({ role: 'user', content: '代码讨论来源/事实骨架（非当前事实替代）：\n' + JSON.stringify(variant === 'K-code' ? codePairs(prefix.slice(0, covered)) : { sourceIds: prefix.slice(0, covered).map(p => p.id), frozenSnapshotHash: stableHash(input.node.snapshot), source: 'current immutable snapshot remains separately included; no old model opinion promoted to fact' }) });
  if (summary) messages.push({ role: 'user', content: '后台本branch讨论摘要（非权威事实）：\n' + JSON.stringify(summary) });
  for (const p of pairs.slice(covered)) messages.push({ role: 'user', content: p.question }, { role: 'assistant', content: p.answer });
  messages.push({ role: 'user', content: input.question });
  return { ...frozenBase, messages, summaryJobs: jobs, qaResponseFormat: 'analysis-json', compression: { branch: { mode: variant, inputItems: pairs.length, rawItems: pairs.length - covered, transformedItems: covered, summarizedItems: summary ? covered : 0, recent } }, sourceDecisionIds: [input.node.id], historyPolicy: { discussionVersion: VERSION, variant, frozenDecisionId: input.node.id, sourceIds: pairs.map(p => p.id), eligibleSourceIds: prefix.map(p => p.id), coveredDecisionIds: pairs.slice(0, covered).map(p => p.id), currentSnapshotCompressed: false } };
}
module.exports = { VERSION, VARIANTS, buildDiscussionContext, validateTypedSummary, codePairs, typedSchema };
