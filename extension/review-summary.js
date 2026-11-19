(function (root) {
  'use strict';
  const Review = typeof module !== 'undefined' && module.exports ? require('./postgame-review.js') : root.MJPostgameReview;
  const settled = snapshot => snapshot?.phase === 'ended' && ['Hule', 'NoTile', 'LiuJu'].includes(snapshot.result?.kind);
  const roundKey = snapshot => JSON.stringify([snapshot?.round?.wind, snapshot?.round?.index, snapshot?.honba]);
  const topicOrder = ['strategy', 'efficiency', 'calls', 'questions'];

  function create({ listDiscussions, readHistory }) {
    return async function readReviewSummary(groupKey) {
      if (typeof groupKey !== 'string' || groupKey.length > 512) return null;
      const [records, history] = await Promise.all([listDiscussions(), readHistory()]);
      const group = Review.groups(records).find(value => value.key === groupKey);
      if (!group?.matchId || !Array.isArray(history)) return null;
      const match = history.find(value => value?.id === group.matchId);
      if (!match || !['live', 'replay'].includes(match.source) || !Array.isArray(match.rounds)) return null;
      const last = match.rounds.at(-1)?.snapshot;
      if (match.source === 'live' && (!match.id.startsWith('live-') || match.closed !== true ||
        last?.source !== 'live' || !settled(last) || last.result.gameEnded !== true)) return null;
      if (match.source === 'replay' && !/^replay-[a-f0-9]{64}$/.test(match.id)) return null;
      const eligible = new Set(match.rounds.map(round => round?.snapshot)
        .filter(snapshot => settled(snapshot) && snapshot.source === match.source).map(roundKey));
      const rounds = new Set(), decisions = new Set(), topics = new Set();
      for (const record of group.records) {
        const snapshot = record.snapshot, game = snapshot.game;
        if (decisions.has(record.id) || snapshot.source !== match.source || !game || !eligible.has(roundKey(game))) continue;
        decisions.add(record.id);
        rounds.add(roundKey(game));
        const result = record.analysis.result;
        if (['attack', 'defend', 'fold'].includes(result.decision?.action) || result.danger?.length) topics.add('strategy');
        if (result.efficiency?.length || record.analysis.localAnalysis?.efficiency) topics.add('efficiency');
        if (game.players?.some(player => player.riichi === true || player.melds?.length) ||
          snapshot.rivers?.some(river => river.discards?.some(discard => discard.riichi === true))) topics.add('calls');
        if (record.chat?.length) topics.add('questions');
      }
      return decisions.size ? { version: 1, scope: 'retained-decisions', roundCount: rounds.size, decisionCount: decisions.size,
        topics: topicOrder.filter(topic => topics.has(topic)) } : null;
    };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJReviewSummary = api;
})(globalThis);
