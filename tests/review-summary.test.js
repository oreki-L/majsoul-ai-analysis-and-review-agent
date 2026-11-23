const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { create } = require('../extension/review-summary.js');

const liveId = 'live-private-id', replayId = 'replay-' + 'a'.repeat(64);
const groupKey = id => JSON.stringify(['match', id]);
const game = (index = 0, honba = 0) => ({ round: { wind: 0, index }, honba, players: [{ melds: ['PRIVATE_MELD'] }] });
const round = (source, index, gameEnded = true) => ({ snapshot: { ...game(index), source, phase: 'ended',
  result: { kind: 'Hule', gameEnded, scores: [12345] } } });
const discussion = (matchId, source, index = 0, id = 'private-decision', honba = 0) => ({ id,
  context: { identity: { matchId, viewId: 'PRIVATE_VIEW' } },
  snapshot: { source, game: game(index, honba), hand: ['PRIVATE_HAND'] },
  analysis: { result: { decision: { action: 'defend', reasons: ['PRIVATE_REASON'] }, efficiency: ['PRIVATE_EFFICIENCY'] } },
  chat: [{ question: 'PRIVATE_QUESTION' }]
});
const summary = (records, history) => create({ listDiscussions: async () => records, readHistory: async () => history });

test('browser summary port returns only versioned counts and canonical topic IDs across settled rounds', async () => {
  const context = vm.createContext({});
  for (const file of ['postgame-review.js', 'review-summary.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../extension/' + file), 'utf8'), context);
  }
  const first = discussion(liveId, 'live');
  const records = [first, first, discussion(liveId, 'live', 0, 'second'), discussion(liveId, 'live', 1, 'third'),
    discussion(liveId, 'replay', 1, 'other-source'), discussion(liveId, 'live', 1, 'other-honba', 1), discussion('live-other', 'live')];
  const history = [{ id: liveId, closed: true, source: 'live', rounds: [round('live', 0, false), round('live', 1)] }];
  const readReviewSummary = context.MJReviewSummary.create({ listDiscussions: async () => records, readHistory: async () => history });
  assert.deepEqual(structuredClone(await readReviewSummary(groupKey(liveId))), {
    version: 1, scope: 'retained-decisions', roundCount: 2, decisionCount: 3,
    topics: ['strategy', 'efficiency', 'calls', 'questions']
  });
  records.length = 0;
  assert.equal(await readReviewSummary(groupKey(liveId)), null);
});

test('summary fails closed without a matching settled live or hashed replay history', async () => {
  const live = { id: liveId, closed: true, source: 'live', rounds: [round('live', 0)] };
  const record = discussion(liveId, 'live');
  for (const history of [[], [{ ...live, closed: false }], [{ ...live, rounds: [round('live', 0, false)] }],
    [{ ...live, rounds: [round('replay', 0)] }], [{ ...live, rounds: [round('live', 1)] }],
    [{ ...live, rounds: [{ snapshot: { ...round('live', 0).snapshot, result: { kind: 'Interrupted', gameEnded: true } } }] }]]) {
    assert.equal(await summary([record], history)(groupKey(liveId)), null);
  }
  const viewOnly = { ...record, context: { identity: { viewId: 'view-only' } } };
  assert.equal(await summary([viewOnly], [live])(JSON.stringify(['view', 'view-only'])), null);
  const replay = { id: replayId, source: 'replay', rounds: [round('replay', 0, false)] };
  assert.equal((await summary([discussion(replayId, 'replay')], [replay])(groupKey(replayId))).decisionCount, 1);
  const ephemeral = 'replay:ephemeral';
  assert.equal(await summary([discussion(ephemeral, 'replay')], [{ ...replay, id: ephemeral }])(groupKey(ephemeral)), null);
  const read = create({ listDiscussions: assert.fail, readHistory: assert.fail });
  for (const key of [undefined, {}, 'x'.repeat(513)]) assert.equal(await read(key), null);
});
