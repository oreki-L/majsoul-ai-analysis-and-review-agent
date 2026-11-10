'use strict';
// Experimental transforms only. Production prompts, parsing and engine actions stay frozen.
const Analysis = require('../../extension/mahjong-analysis.js');
const { stableHash } = require('../core.cjs');
const { buildFactCard } = require('../mortal-teaching/released-v0168/engine-facts.js');
const Compact = require('../mortal-teaching/compact-counts.cjs');
const { CURRENT, ENGINE, HISTORY } = require('../mortal-teaching/retest-projection.cjs');
const SEMANTIC_RULES = [
  '本轮解释规则：直接引用当前程序事实；summary也必须与reasons、当前手牌和场况一致。',
  '数量：未见上界0只表示没有未见的同种牌；不能据此否定已持有的对子/刻子、其他牌能完成的搭子或现物安全价值。计数完整且已见4时可以说同种牌已全见；partial/invalid/unavailable不作此断言。弃牌前后手牌数量分开，摸牌不再追加。',
  '牌形：单张不等于孤张；例如8索可与9索成89边搭，3筒可同时作为123顺子或35嵌张的可选材料。可选组合可以共用实体牌，不能据选定分组否认其他局部联系，也不能把重叠组合相加。三张同牌可成刻子，不得说没有任何面子。',
  '数值：形状向听是程序计算值，未见进张枚数才是上界。比较必须使用对应候选的数值；不要求比较备选。现物必须绑定对手；本人牌河未找到不能推出无任何安全证据，立直后通过证据仍须核实时序。',
  '输出：只写summary、reasons、limitations。summary为非空字符串，后两项始终为字符串数组，无内容用[]；不得写action、decision、tile或其他键。限制只写实际未知事项，不用通用免责声明覆盖已知事实。'
].join('\n');
const FOCUS_RULES = 'facts.explanationFocus是程序生成的当前动作索引，优先核对它；计数与关系均为当前时点，可选关系不等于引擎动机。ownRiverSafeTo仅汇总本人的牌河证据，未列座位不代表不安全；立直后通过需查事件。不复述整张卡，选1–3条相关事实教学。';
const HISTORY_RULES = '自动分析的历史教学正文已移除，只保留历史动作和时点。当前事实仍以冻结snapshot及facts为准，不从历史动作推断当前手牌或引擎理由。用户追问保留历史上下文。';
const CANDIDATES = Object.freeze([
  { id: 'b-compact-control', title: '上轮三列表对照', parent: null },
  { id: 's1-semantics', title: '数量含义与输出约束', parent: 'b-compact-control' },
  { id: 's2-action-focus', title: '当前动作证据聚焦', parent: 's1-semantics' },
  { id: 's3-history-isolation', title: '自动分析历史教学隔离', parent: 's2-action-focus' }
]);
function bound(options) {
  const messages = options.messages;
  if (!Array.isArray(messages) || messages.length < 2) throw Error('Optimization: current pair missing');
  const parse = (message, prefix) => {
    if (message?.role !== 'user' || typeof message.content !== 'string' || !message.content.startsWith(prefix)) throw Error('Optimization: unrecognized current pair');
    return JSON.parse(message.content.slice(prefix.length));
  };
  const current = parse(messages.at(-2), CURRENT), payload = parse(messages.at(-1), ENGINE);
  if (!Number.isInteger(current.position) || current.position !== current.snapshot?.lastStep || typeof current.question !== 'string' || payload.engine?.action?.actor !== current.snapshot?.selfSeat || payload.engine?.tileEncoding !== 'snapshot-v1' || payload.facts?.binding?.position !== current.position || payload.facts?.binding?.selfSeat !== current.snapshot.selfSeat) throw Error('Optimization: binding mismatch');
  // Recompute only from authorized current data; reject stale or edited source facts.
  const fresh = buildFactCard(current.snapshot, payload.engine);
  if (stableHash(fresh) !== stableHash(payload.facts)) throw Error('Optimization: source facts mismatch');
  return { current, payload };
}
const name = tile => tile?.code ? `${tile.name}(${tile.code})` : null;
function shapeView(shape) {
  if (!shape) return null;
  return { sameTileGroups: shape.sameTileGroups.map(g => [name(g.tile), g.count]), sequences: shape.possibleSequences };
}
function links(shape, tile) {
  if (!shape || !tile) return null;
  return shape.possibleIncompleteSequences.filter(pair => pair.includes(Analysis.canonical(tile)));
}
function buildFocus(current, payload) {
  const f = payload.facts, selected = f.selectedAction, after = selected.afterDiscard, tile = selected.discard?.code;
  const safety = f.risk.candidates?.find(c => c.tile === tile);
  return { position: current.position,
    round: { prevailingWind: name(f.round.prevailingWind), selfWind: name(f.round.selfWind), dealerSeat: f.round.dealerSeat },
    concealedSize: [f.hand.concealedCount, after?.concealedCount ?? null],
    availableGroups: { before: shapeView(f.hand.shape), after: shapeView(after?.shape) },
    discard: tile ? { tile: name(selected.discard), status: selected.discardStatus,
      ownSameTile: [f.hand.shape ? f.hand.canonicalCounts?.[Analysis.canonical(tile)] ?? 0 : null, after?.shape ? after.sameTileInOwnConcealedHand.canonical : null],
      localLinks: { before: links(f.hand.shape, tile), after: links(after?.shape, tile) },
      efficiency: after?.efficiency ? { shanten: after.efficiency.shanten, effective: after.efficiency.effectiveTiles } : null,
      ownRiverSafeTo: safety?.opponents.filter(o => o.genbutsu).map(o => ({ seat: o.seat, relativeName: o.relativeName, riverIndices: o.genbutsuRiverIndices?.map(r => r.index) ?? null })) ?? [],
      safetyScope: '本人牌河的正向证据；未列出不代表不安全，不覆盖立直后通过证据。' } : null,
    scope: '仅索引当前动作；对子/刻子/顺子为可选局部组合，可能重叠；null为未知或不适用。' };
}
function actionOnly(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Optimization: invalid history item');
  const out = {};
  for (const key of ['decisionId', 'position', 'task']) if (Object.hasOwn(value, key)) out[key] = value[key];
  const decision = value.decision || value.result?.decision;
  if (decision) out.decision = { action: decision.action, tile: decision.tile };
  if (value.engine) {
    out.engine = {};
    for (const key of ['phase', 'action', 'followUp', 'tileEncoding']) if (Object.hasOwn(value.engine, key)) out.engine[key] = value.engine[key];
  }
  return out;
}
function isolateHistory(messages, position) {
  return messages.slice(0, -2).map(message => {
    if (message.role === 'user' && typeof message.content === 'string' && message.content.startsWith(HISTORY)) {
      const h = JSON.parse(message.content.slice(HISTORY.length));
      if (h.policy !== 'H2-dedup+AdviceHistory-Extract' || !Array.isArray(h.advice) || h.advice.some(a => !Number.isInteger(a.position) || a.position > position)) throw Error('Optimization: unknown or future history');
      return { ...message, content: HISTORY + JSON.stringify({ ...h, advice: h.advice.map(actionOnly) }) };
    }
    if (message.role === 'assistant') {
      if (!Array.isArray(message.content) || message.content.length !== 1 || message.content[0].type !== 'text') throw Error('Optimization: unknown historical assistant');
      return { ...message, content: [{ type: 'text', text: JSON.stringify(actionOnly(JSON.parse(message.content[0].text))) }] };
    }
    // Keep authorized old snapshots, explicit questions and other evidence unchanged.
    return message;
  }).concat(messages.slice(-2));
}
function transformOptions(options, candidateId) {
  if (!CANDIDATES.some(c => c.id === candidateId)) throw Error('Optimization: unknown candidate');
  const { current, payload } = bound(options);
  const out = Compact.transformOptions(options);
  if (candidateId === 'b-compact-control') return out;
  out.systemPrompt += '\n' + SEMANTIC_RULES;
  if (candidateId !== 's1-semantics') {
    const projected = JSON.parse(out.messages.at(-1).content.slice(ENGINE.length));
    projected.facts.explanationFocus = buildFocus(current, payload);
    out.messages = [...out.messages.slice(0, -1), { ...out.messages.at(-1), content: ENGINE + JSON.stringify(projected) }];
    out.systemPrompt += '\n' + FOCUS_RULES;
  }
  if (candidateId === 's3-history-isolation' && current.question === '') {
    out.messages = isolateHistory(out.messages, current.position);
    out.systemPrompt += '\n' + HISTORY_RULES;
  }
  return out;
}
module.exports = { CANDIDATES, SEMANTIC_RULES, FOCUS_RULES, HISTORY_RULES, transformOptions, buildFocus };
