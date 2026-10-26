/* Deterministic index over retained decision samples. No model or network access. */
(function (root) {
  'use strict';
  const text = value => typeof value === 'string' ? value : '';
  function groupKey(record) {
    const identity = record.context?.identity || {};
    // Unidentified records cannot prove that they belong to the same game.
    return JSON.stringify(identity.matchId ? ['match', identity.matchId] : identity.viewId ? ['view', identity.viewId] : ['decision', record.id]);
  }
  function groups(records) {
    const result = new Map();
    for (const record of records || []) {
      if (!record?.id || !record.snapshot || !record.analysis?.result) continue;
      const key = groupKey(record), identity = record.context?.identity || {};
      if (!result.has(key)) result.set(key, { key, matchId: text(identity.matchId), verified: !!identity.matchId, records: [] });
      result.get(key).records.push(record);
    }
    return [...result.values()];
  }
  function summarize(records, key) {
    const group = groups(records).find(item => item.key === key);
    if (!group) return null;
    const topics = [
      { id: 'strategy', label: '攻守与风险', references: [] },
      { id: 'efficiency', label: '牌效率', references: [] },
      { id: 'calls', label: '鸣牌与立直局面', references: [] },
      { id: 'questions', label: '用户疑问', references: [] }
    ];
    const rounds = new Set(), decisions = new Set(); let questions = 0;
    const add = (index, record, source, content) => topics[index].references.push({ decisionId: record.id, source, content });
    for (const record of group.records) {
      if (decisions.has(record.id)) continue;
      decisions.add(record.id);
      const snapshot = record.snapshot, result = record.analysis.result, game = snapshot.game || {};
      rounds.add(JSON.stringify([record.context?.identity?.roundStartId, game.round, game.honba]));
      const advice = { attack: '进攻', defend: '防守', fold: '弃和', unknown: '未给出综合攻守结论' }[result.decision?.action] || '未知';
      const reasons = (result.decision?.reasons || []).filter(v => typeof v === 'string').join('；');
      if (['attack', 'defend', 'fold'].includes(result.decision?.action) || result.danger?.length) {
        add(0, record, '原分析建议', `${advice}${reasons ? '：' + reasons : ''}`);
      }
      if (result.efficiency?.length || record.analysis.localAnalysis?.efficiency) {
        const evidence = result.efficiency?.map(item => `${text(item.tile)}：${(item.reasons || []).filter(v => typeof v === 'string').join('；')}`).join(' / ');
        add(1, record, '原分析效率依据', evidence || '已保存本地向听与有效牌比较，点击查看原分析。');
      }
      const riichi = game.players?.some(player => player.riichi === true) || snapshot.rivers?.some(river => river.discards?.some(discard => discard.riichi === true));
      const melds = game.players?.some(player => player.melds?.length);
      if (riichi || melds) add(2, record, '当时快照', [riichi ? '可见立直宣言记录' : '', melds ? '可见副露记录' : ''].filter(Boolean).join('；') + '。仅描述该时点局面，不推断本决策实际选择。');
      for (const turn of record.chat || []) {
        questions++;
        add(3, record, turn.status === 'completed' ? '用户问题 · 已回答' : turn.status === 'pending' ? '用户问题 · 待回答' : '用户问题 · 未完成', text(turn.question));
      }
    }
    return { key, matchId: group.matchId, verified: group.verified, decisionCount: decisions.size, roundCount: rounds.size, questionCount: questions,
      actualActions: 'unknown', topics, decisionIds: [...decisions] };
  }
  const api = { groupKey, groups, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJPostgameReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
