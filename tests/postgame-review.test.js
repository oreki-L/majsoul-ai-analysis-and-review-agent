const { test } = require('node:test');
const assert = require('node:assert/strict');
const Review = require('../extension/postgame-review.js');
function record(id, identity = { matchId: 'match-a' }, patch = {}) {
  return { id, context: { identity, position: 12 }, snapshot: { selfSeat: 0, game: { round: { wind: 0, index: 0 }, honba: 0, players: [] } },
    analysis: { result: { decision: { action: 'fold', tile: '1m', reasons: ['当时建议弃和'] }, danger: [], efficiency: [] } }, chat: [], ...patch };
}
test('review isolates reliable match identities and never merges unrelated unidentified decisions', () => {
  const records = [record('a'), record('b', { matchId: 'match-b' }), record('c', {}), record('d', {}), record('e', { viewId: 'view-a' }), record('f', { viewId: 'view-a' })];
  const groups = Review.groups(records);
  assert.equal(groups.length, 5);
  assert.equal(groups.find(g => g.matchId === 'match-a').records.length, 1);
  assert.equal(groups.find(g => g.records.some(r => r.id === 'e')).verified, false);
  assert.equal(groups.find(g => g.records.some(r => r.id === 'e')).records.length, 2);
  assert.equal(Review.summarize([], groups[0].key), null);
});
test('review preserves stable decision IDs across same-turn events and separates samples from actual play', () => {
  const first = record('stable-a');
  const second = record('stable-b'); second.context.position = 13;
  second.snapshot.game.honba = 1;
  const summary = Review.summarize([first, second], Review.groupKey(first));
  assert.equal(summary.decisionCount, 2); assert.equal(summary.roundCount, 2);
  assert.equal(summary.actualActions, 'unknown');
  assert.deepEqual(summary.topics[0].references.map(ref => ref.decisionId), ['stable-a', 'stable-b']);
  assert.equal(summary.topics[0].references[0].source, '原分析建议');
  assert.equal('errorRate' in summary, false);
});
test('themes use original structured evidence and retain question completion status without inferring preferences', () => {
  const r = record('decision');
  r.snapshot.game.players = [{ riichi: true, melds: [{ tiles: ['1p','1p','1p'] }] }];
  r.analysis.result.efficiency = [{ tile: '2m', reasons: ['1 向听'] }];
  r.chat = [{ question: '我是否应该立直？', status: 'completed', response: { result: {} } }, { question: '失败问题', status: 'failed' }, { question: '<script>pending</script>', status: 'pending' }];
  const before = JSON.stringify(r), summary = Review.summarize([r], Review.groupKey(r));
  assert.equal(summary.questionCount, 3);
  assert.equal(summary.topics[1].references[0].content, '2m：1 向听');
  assert.match(summary.topics[2].references[0].content, /可见立直宣言记录；可见副露记录/);
  assert.deepEqual(summary.topics[3].references.map(ref => ref.source), ['用户问题 · 已回答', '用户问题 · 未完成', '用户问题 · 待回答']);
  assert.equal(JSON.stringify(r), before);
  assert.equal('preferences' in summary, false);
});
test('evicted records vanish on a new summary and no theme fabricates missing evidence', () => {
  const r = record('sparse'); r.analysis.result.decision.action = 'unknown';
  const summary = Review.summarize([r], Review.groupKey(r));
  assert.ok(summary.topics.every(topic => topic.references.length === 0));
  assert.equal(Review.summarize([], summary.key), null);
});
