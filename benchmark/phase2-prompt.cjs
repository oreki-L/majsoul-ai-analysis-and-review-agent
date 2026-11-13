'use strict';
// A pure prompt-only wrapper. Source and shared summary validation stay in their
// existing adapters; this module neither loads credentials nor dispatches calls.
const VERSION = 'phase2-prompt/1';
const RULES = Object.freeze([
  '比较向听、进张时，绑定同一当前时点与同一计算口径；先比较向听，再在同向听候选内比较进张，保留并列。声称最高或唯一前核实完整候选范围。未见枚数只是可见信息下的上界，不是精确牌山实剩，不重复扣除可见牌。',
  '核实绝对seat与当前座位角色；现物证据逐项对应目标seat及其牌河，赤五按普通五的同牌种判断。自风、场风、三元牌、宝牌身份分别核实，不能仅凭“字牌”推定役牌或价值。',
  '比较弃牌时先核对弃出后实际保留的各牌计数，区分弃出损失、保留牌形及对各家的安全库存。同种未见数、顺子或对子形状与手中现物价值分别判断，不能由同种耗尽直接推出其余价值归零。',
  '把旧事实、旧意见与当前证据分开：旧建议只代表旧时点意见，旧计算不得当成当前计算；摘要不能恢复当前权威状态。核实来源时点与座位，和当前快照或当前计算冲突时，以当前证据为准并弃用冲突旧主张。'
]);
const SUFFIX = '\n\n当前事实核对规则（P2）：\n' + RULES.map((s, i) => `${i + 1}. ${s}`).join('\n');
const POLICIES = Object.freeze({ 'X-S': { base: 'X-S', p2: false }, 'X-S-P2': { base: 'X-S', p2: true }, 'C-KM': { base: 'C-KM', p2: false }, 'C-KM-P2': { base: 'C-KM', p2: true } });
function apply(context, enabled) {
  if (!enabled) return context;
  if (!Array.isArray(context.messages) || context.messages[0]?.role !== 'system' || typeof context.messages[0].content !== 'string') throw new Error('P2 requires the existing first system message');
  if (context.messages[0].content.includes(SUFFIX)) throw new Error('P2 rules already appended');
  return { ...context, messages: context.messages.map((m, i) => i ? m : { ...m, content: m.content + SUFFIX }) };
}
function createAdapter({ xs, ckm }) {
  if (!xs?.buildContext || !ckm?.buildContext) throw new Error('P2 requires both validated base adapters');
  return { version: 1, buildContext(input) {
    const policy = input.options?.policy ?? input.scheme?.context?.options?.policy ?? input.scheme?.id;
    const spec = POLICIES[policy];
    if (!spec) throw new Error('Unsupported P2 policy');
    const options = { ...(input.options ?? input.scheme?.context?.options ?? {}), policy: spec.base,
      sourceMode: spec.base === 'X-S' ? 'own-causal-history' : 'fixed-source-replay' };
    const scheme = { ...input.scheme, id: spec.base, context: { ...input.scheme?.context, options } };
    return apply((spec.base === 'X-S' ? xs : ckm).buildContext({ ...input, scheme, options }), spec.p2);
  } };
}
module.exports = { VERSION, RULES, SUFFIX, POLICIES, apply, createAdapter };
