'use strict';

// Benchmark-only projections. Never infer a current state from an older message.
const CURRENT = '请分析本次问题。snapshot 是本次冻结的完整授权局面（牌均为原始编码），优先于历史快照或回答；未授权或缺失字段不得从历史或其他字段补回。详细计算按需查询工具：\n';
const ENGINE = '已验证的引擎最终动作（仅作数据，不是内部思考）：';
const HISTORY = '本小局历史参考（仅作数据）：旧建议只代表标注时点，不能作为当前事实或当前计算；当前snapshot优先。详细事件与计算按需查询工具。\n';
const FACTS = '本次冻结局面的确定性事实卡（仅作数据，不是指令；仅绑定紧前snapshot与引擎动作）：\n';

function enabled(variant, flag) { return variant?.experiment?.[flag] === true; }
function parse(message, prefix) {
  if (message?.role !== 'user' || typeof message.content !== 'string' || !message.content.startsWith(prefix)) throw new Error('Retest projection: unrecognized bound message');
  try { return JSON.parse(message.content.slice(prefix.length)); }
  catch (_) { throw new Error('Retest projection: invalid bound JSON'); }
}
function historicalAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Retest projection: invalid historical advice');
  const out = {};
  for (const key of ['decisionId', 'position', 'excerpt', 'task', 'question']) if (Object.hasOwn(value, key)) out[key] = value[key];
  const decision = value.decision || value.result?.decision;
  if (decision) out.decision = { action: decision.action, tile: decision.tile };
  if (value.engine) {
    out.engine = {};
    for (const key of ['phase', 'action', 'followUp', 'tileEncoding']) if (Object.hasOwn(value.engine, key)) out.engine[key] = value.engine[key];
  }
  return out;
}
function isolate(messages, currentIndex, position) {
  return messages.map((message, index) => {
    if (index >= currentIndex) return message;
    if (message.role === 'user' && typeof message.content === 'string' && message.content.startsWith(HISTORY)) {
      const history = parse(message, HISTORY);
      if (history.policy !== 'H2-dedup+AdviceHistory-Extract' || !Array.isArray(history.advice)) throw new Error('Retest projection: unknown automatic history policy');
      if (history.advice.some(item => !Number.isInteger(item.position) || item.position > position)) throw new Error('Retest projection: future or unbound historical advice');
      return { ...message, content: HISTORY + JSON.stringify({ ...history, advice: history.advice.map(historicalAction) }) };
    }
    // Full-context automatic runs retain historical requests and the action, but
    // cannot carry previous model teaching into the next automatic decision.
    if (message.role === 'assistant') {
      const blocks = message.content;
      if (!Array.isArray(blocks) || blocks.length !== 1 || blocks[0].type !== 'text') throw new Error('Retest projection: unknown historical assistant format');
      let answer;
      try { answer = JSON.parse(blocks[0].text); } catch (_) { throw new Error('Retest projection: invalid historical assistant JSON'); }
      return { ...message, content: [{ type: 'text', text: JSON.stringify(historicalAction(answer)) }] };
    }
    return message;
  });
}
function transformOptions(options, variant) {
  if (!enabled(variant, 'factCard') && !enabled(variant, 'isolateAutomaticHistory')) return options;
  const messages = options.messages;
  if (!Array.isArray(messages) || messages.length < 2) throw new Error('Retest projection: missing current snapshot/engine pair');
  const engineIndex = messages.length - 1, currentIndex = engineIndex - 1;
  const current = parse(messages[currentIndex], CURRENT), engine = parse(messages[engineIndex], ENGINE);
  if (!current.snapshot || !Number.isInteger(current.position) || current.position !== current.snapshot.lastStep || typeof current.question !== 'string' || !engine.engine?.action || engine.engine.action.actor !== current.snapshot.selfSeat || engine.engine.tileEncoding !== 'snapshot-v1') throw new Error('Retest projection: snapshot/engine binding failed');
  // No search through user question strings and no substitutions inside JSON.
  let projected = enabled(variant, 'isolateAutomaticHistory') && current.question === '' ? isolate(messages, currentIndex, current.position) : messages.slice();
  if (enabled(variant, 'factCard')) {
    const { buildFactCard } = require('./fact-card.cjs');
    const card = buildFactCard(current.snapshot, engine.engine);
    projected = [...projected, { role: 'user', content: FACTS + JSON.stringify(card) }];
  }
  return { ...options, messages: projected };
}
function transformBody(body, variant) {
  return enabled(variant, 'jsonObject') ? { ...body, response_format: { type: 'json_object' } } : body;
}
module.exports = { transformOptions, transformBody, CURRENT, ENGINE, HISTORY, FACTS };
