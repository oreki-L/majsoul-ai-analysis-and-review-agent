'use strict';
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function createTools({ snapshot, events = [], prepared, node = {} }) {
  const input = freeze(structuredClone(snapshot));
  const position = node.position ?? input.lastStep;
  const frozenEvents = freeze(structuredClone(events.filter(e => Number.isSafeInteger(e.position) && e.position <= position)));
  const local = freeze(structuredClone(prepared?.data?.localAnalysis ?? prepared?.localAnalysis ?? {}));
  const legalActions = freeze(structuredClone(node.legalActions ?? null));
  const efficiency = local.efficiency ? structuredClone(local.efficiency) : null;
  if (efficiency?.candidates && legalActions) efficiency.candidates = efficiency.candidates.filter(c => legalActions.some(a => a.action === 'discard' && a.tile === c.tile));
  function tool(name, description, read, properties = {}, required = []) {
    return { name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
      execute: async (_id, args) => {
        if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !Object.hasOwn(properties, k)) || required.some(k => !Object.hasOwn(args, k))) throw new Error('Invalid tool arguments');
        if ('seat' in args && (!Number.isInteger(args.seat) || args.seat < 0 || args.seat >= input.playerCount)) throw new Error('Invalid seat');
        if ('since' in args && (!Number.isSafeInteger(args.since) || args.since < 0)) throw new Error('Invalid since');
        if ('limit' in args && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 64)) throw new Error('Invalid limit');
        return { content: [{ type: 'text', text: JSON.stringify(read(args)) }] };
      } };
  }
  return [
    tool('get_self_hand', '读取当前冻结的已授权自家手牌与副露。', () => ({ selfSeat: input.selfSeat, hand: input.selfHand ?? null, drawnTile: input.selfDrawnTile ?? null, melds: input.game?.players?.[input.selfSeat]?.melds ?? null })),
    tool('get_table_state', '读取冻结的公开桌面及当前合法动作；鸣后仅可使用legalActions列明的动作。', () => ({ game: input.game ?? null, phase: input.phase, source: input.source, warnings: input.warnings, legalActions })),
    tool('get_player_discards', '读取指定座位已授权的公开牌河。', args => ({ seat: args.seat, discards: input.rivers?.find(r => r.seat === args.seat)?.discards ?? null }), { seat: { type: 'integer', minimum: 0, maximum: input.playerCount - 1 } }, ['seat']),
    tool('get_round_events', '读取截至冻结时点已授权的局内事件；可能不连续，limit最多64。', args => ({ position, events: frozenEvents.filter(e => args.since === undefined || e.position > args.since).slice(-(args.limit ?? 64)), limitation: '仅含已授权和已采集事件，不保证完整。' }), { since: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 64 } }),
    tool('compare_discards', '读取本地向听与进张；鸣后合法候选须与legalActions交集。', () => ({ efficiency, legalActions })),
    tool('get_danger_evidence', '读取公开信息推导的现物、筋、壁；不提供放铳概率。', () => local.danger ?? null)
  ];
}
module.exports = { createTools };
