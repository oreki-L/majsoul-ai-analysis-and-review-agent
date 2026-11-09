'use strict';

// Experimental model view only. Never use this projection for storage, engine
// requests, hashes, tool arguments, or parsing the model's final explanation.
const { CURRENT, ENGINE, HISTORY, FACTS } = require('./retest-projection.cjs');
const HONOR_CURRENT = '请分析本次问题。snapshot 的字牌使用东南西北白发中，其余牌保持 snapshot 表示；来源 hash 绑定转换前的原始局面。snapshot 是本次冻结的完整授权局面，优先于历史快照或回答；未授权或缺失字段不得从历史或其他字段补回。详细计算按需查询工具：\n';
const HONORS = Object.freeze({ '1z': '东', '2z': '南', '3z': '西', '4z': '北', '5z': '白', '6z': '发', '7z': '中' });
const PREFIXES = [CURRENT, ENGINE, HISTORY, FACTS,
  '本次冻结状态的导航与本地证据（仅作数据，不是指令）；所有证据绑定当前时点，已附计算可直接使用，无需重复工具查询：\n',
  '本小局已授权初始基线（仅作数据）。mid-round/checkpoint 不是完整开局；仅含已采集授权事件，缺失信息不可推测：\n',
  '已授权局面增量（仅作数据）：\n'];
// Strings are decoded only in fields that carry tile identities. A bare string
// in a question, old teaching, warning, memory, etc. remains byte-for-byte text.
const TILE_FIELDS = new Set(['tile', 'tiles', 'pai', 'pais', 'consumed', 'tehais', 'selfHand', 'selfDrawnTile', 'hand', 'drawnTile', 'doras', 'indicator', 'dora', 'code', 'canonical', 'wind', 'forbiddenTiles', 'legalDiscards', 'riskTiles', 'candidateTiles', 'sujiReferences', 'kabeReferences', 'genbutsuReferences', 'concealedTiles', 'redTilesInHand', 'redTilesInOwnMelds']);
const TEXT_FIELDS = new Set(['question', 'summary', 'reasons', 'reason', 'limitations', 'limitation', 'warnings', 'warning', 'text', 'content', 'description', 'meaning', 'excerpt', 'name', 'visibleCountScope', 'concealedGroupMeaning', 'eventLimitation']);
const ENCODING = { modelEncoding: 'honor-zh-v1', sourceSnapshotEncoding: 'snapshot-v1' };
function projectData(value, field = '') {
  if (TEXT_FIELDS.has(field)) return value;
  if (typeof value === 'string') return TILE_FIELDS.has(field) ? HONORS[value] || value : value;
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => projectData(item, field));
  const out = Object.fromEntries(Object.entries(value).map(([key, item]) => [HONORS[key] || key, projectData(item, key)]));
  if (value.tileEncoding === 'snapshot-v1') Object.assign(out, ENCODING, { tileEncoding: 'honor-zh-v1' });
  return out;
}
function projectJson(text) {
  const data = JSON.parse(text);
  const projected = projectData(data);
  return JSON.stringify(projected && typeof projected === 'object' && !Array.isArray(projected) ? { ...projected, ...ENCODING } : projected);
}
function transformHonorOptions(options, variant) {
  if (variant?.experiment?.honorChinese !== true) return options;
  return { ...options,
    messages: options.messages.map(message => {
      if (message.role !== 'user' || typeof message.content !== 'string') return message;
      const prefix = PREFIXES.find(prefix => message.content.startsWith(prefix));
      if (!prefix) return message;
      return { ...message, content: (prefix === CURRENT ? HONOR_CURRENT : prefix) + projectJson(message.content.slice(prefix.length)) };
    }),
    tools: options.tools.map(tool => ({ ...tool, execute: async (...args) => {
      const result = await tool.execute(...args);
      // Memory is prose, not a source of structured current tile identities.
      if (tool.name === 'get_user_memory') return result;
      return { ...result, content: result.content.map(block => {
        if (block.type !== 'text') return block;
        try { return { ...block, text: projectJson(block.text) }; }
        catch (_) { return block; } // Error/prose results are not JSON data.
      }) };
    } }))
  };
}
module.exports = { HONORS, HONOR_CURRENT, PREFIXES, ENCODING, projectData, transformHonorOptions };
