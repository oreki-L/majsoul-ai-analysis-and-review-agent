/* Teaching text has no authority to select or mutate an engine action. */
(function (root) {
  'use strict';
  const PROMPT_VERSION = 1;
  const prompt = '你是麻将教学解释器，不是决策器。引擎最终动作已通过本地校验，不得更换首选、鸣牌对象、实体用牌或立直弃牌。只根据冻结可见事实与只读工具解释取舍；不是引擎内部思考。不要编造分数、放铳率或未来信息。只输出 JSON {"summary":"简短解释","reasons":["可核查的取舍"],"limitations":["解释限制"]}，不输出 action、decision 或 tile 字段。';
  function parse(content) {
    let value; try { value = JSON.parse(content); } catch (_) { throw new Error('解释未返回有效 JSON。'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['summary', 'reasons', 'limitations'].includes(k))) throw new Error('解释合同不接受动作或首选字段。');
    const texts = (items, max) => {
      if (!Array.isArray(items) || items.length > max || items.some(t => typeof t !== 'string' || !t.trim() || t.length > 1000)) throw new Error('解释文本结构无效。');
      return items.slice();
    };
    if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1000) throw new Error('解释摘要无效。');
    return { summary: value.summary, reasons: texts(value.reasons, 8), limitations: texts(value.limitations, 8), promptVersion: PROMPT_VERSION };
  }
  const api = { parse, prompt, PROMPT_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJEngineExplanation = api;
})(globalThis);
