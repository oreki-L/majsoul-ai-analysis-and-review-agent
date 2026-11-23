'use strict';
// Experimental presentation only: reuse the product's visible-tile calculation.
const Analysis = require('../../extension/mahjong-analysis.js');
const Snapshot = require('../../extension/contracts/snapshot.js');
const { CURRENT, ENGINE } = require('./retest-projection.cjs');
const valid = code => typeof code === 'string' && /^(?:[1-9][mps]|0[mps]|[1-7]z)$/.test(code);
const allowed = (code, players) => players !== 3 || !/^[2-8]m$/.test(code);
const PROMPT_SUFFIX = '\n本次facts.handTileAvailability是程序整理的手牌同种计数简表，依columns读取rows：已见包含自家暗手，五含赤五，未见上界不是牌山实剩。直接引用程序数量，不把弃后手里0张说成全场见尽；partial不作全场见尽断言，invalid/unavailable不推算缺失数量。';
function buildCompactCounts(snapshot, facts) {
  const s = snapshot || {}, visible = facts?.localAnalysis?.visibleTiles;
  if (!facts?.binding || facts.binding.position !== (s.lastStep ?? null) || facts.binding.selfSeat !== (s.selfSeat ?? null)) throw new Error('Compact counts: snapshot/facts binding mismatch');
  const hand = Array.isArray(s.selfHand) ? s.selfHand : [];
  const codes = [...new Set(hand.filter(valid).map(Analysis.canonical))].filter(c => allowed(c, s.playerCount));
  const reasons = [];
  let status;
  if (![3, 4].includes(s.playerCount) || !Array.isArray(s.selfHand) || !visible || typeof visible.counts !== 'object' || visible.counts === null || Array.isArray(visible.counts) || typeof visible.partial !== 'boolean' || typeof visible.invalid !== 'boolean') status = 'unavailable';
  else if (visible.invalid || hand.some(t => t !== '?' && (!valid(t) || !allowed(Analysis.canonical(t), s.playerCount))) || Object.entries(visible.counts).some(([t,n]) => !valid(t) || Analysis.canonical(t) !== t || !allowed(t, s.playerCount) || !Number.isInteger(n) || n < 0 || n > 4) || codes.some(c => (visible.counts[c] || 0) < hand.filter(t => Analysis.canonical(t) === c).length)) status = 'invalid';
  else status = visible.partial || hand.includes('?') ? 'partial' : 'complete';
  if (status !== 'complete') reasons.push(...(visible?.reasons || []).filter(r => typeof r === 'string'));
  if (status === 'unavailable') reasons.push('牌种规则、手牌或程序已见计数不可用。');
  if (status === 'invalid') reasons.push('计数冲突或含规则不允许的牌，不输出数量。');
  const available = status === 'complete' || status === 'partial';
  return { status, columns: ['牌', '已见', '未见上界'], rows: codes.map(code => {
    const seen = available ? visible.counts[code] || 0 : null;
    return [Snapshot.label(code) + '(' + code + ')', seen, seen === null ? null : 4 - seen];
  }), meaning: '仅列当前手牌同种牌；已见含自家暗手和公开牌，五含赤五。未见上界含对手暗手、牌山和王牌，非牌山实剩；partial不代表全场完整计数。', ...(reasons.length ? { reasons: [...new Set(reasons)] } : {}) };
}
function parse(message, prefix) {
  if (message?.role !== 'user' || typeof message.content !== 'string' || !message.content.startsWith(prefix)) throw new Error('Compact counts: current snapshot/engine pair missing');
  return JSON.parse(message.content.slice(prefix.length));
}
function transformOptions(options) {
  const messages = options.messages;
  if (!Array.isArray(messages) || messages.length < 2 || typeof options.systemPrompt !== 'string') throw new Error('Compact counts: current input missing');
  const current = parse(messages.at(-2), CURRENT), engine = parse(messages.at(-1), ENGINE);
  if (!current.snapshot || current.position !== current.snapshot.lastStep || !engine.engine?.action || engine.engine.action.actor !== current.snapshot.selfSeat || engine.engine.tileEncoding !== 'snapshot-v1' || !engine.facts || JSON.stringify(engine.facts.selectedAction?.action) !== JSON.stringify(engine.engine.action)) throw new Error('Compact counts: snapshot/engine binding mismatch');
  if (Object.hasOwn(engine.facts, 'handTileAvailability')) throw new Error('Compact counts: already applied');
  engine.facts.handTileAvailability = buildCompactCounts(current.snapshot, engine.facts);
  return { ...options, systemPrompt: options.systemPrompt + PROMPT_SUFFIX, messages: [...messages.slice(0, -1), { ...messages.at(-1), content: ENGINE + JSON.stringify(engine) }] };
}
module.exports = { buildCompactCounts, transformOptions, PROMPT_SUFFIX };
