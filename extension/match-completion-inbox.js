(function (root) {
  'use strict';
  const KEY = 'matchCompletionInboxV1', MAX_PENDING = 20, TTL = 24 * 60 * 60 * 1000;
  const END_REASONS = { Hule: 'win', NoTile: 'exhaustive_draw', LiuJu: 'abortive_draw' };
  const matchId = value => typeof value === 'string' && /^live-[a-zA-Z0-9:_-]{0,155}$/.test(value);
  const timestamp = value => Number.isSafeInteger(value) && value > 0;
  const playerCountValid = value => value === 3 || value === 4;
  const sourceValid = source => Number.isSafeInteger(source?.tabId) && source.tabId >= 0 &&
    typeof source.documentId === 'string' && source.documentId.length > 0 && source.documentId.length <= 160;
  const settled = snapshot => snapshot?.phase === 'ended' && Object.hasOwn(END_REASONS, snapshot.result?.kind);
  const validScores = (scores, count) => Array.isArray(scores) && scores.length === count &&
    [...scores].every(score => Number.isSafeInteger(score) && Math.abs(score) <= 1000000);

  function matchResult(match) {
    if (!matchId(match?.id) || match.source !== 'live' || match.closed !== true || match.droppedRounds !== 0 ||
        !Array.isArray(match.rounds)) return null;
    const first = match.rounds[0]?.snapshot, last = match.rounds.at(-1)?.snapshot;
    const playerCount = first?.startScores?.length;
    if (first?.round?.wind !== 0 || first.round.index !== 0 || first.honba !== 0 || !playerCountValid(playerCount) ||
        !settled(last) || last.result.gameEnded !== true || !match.rounds.every(round => round?.snapshot?.source === 'live' &&
          settled(round.snapshot) && round.snapshot.startScores?.length === playerCount && round.snapshot.turnProgress?.status === 'known')) return null;
    const { kind, scores, scoresKnown } = last.result;
    return { playerCount, roundCount: match.rounds.length, endReason: END_REASONS[kind],
      ...(kind !== 'LiuJu' && scoresKnown === true && validScores(scores, playerCount) ? { finalScores: scores.slice() } : {}) };
  }

  function createEntry(match, raw, observedStartAt, sender) {
    const committedAt = Date.now(), sourceRef = { tabId: sender.tab?.id, documentId: sender.documentId };
    if (!sourceValid(sourceRef) || !timestamp(observedStartAt) || observedStartAt !== match.startedAt || observedStartAt > committedAt) return null;
    const data = matchResult(match);
    if (!data) return null;
    const rawResult = raw.rounds.at(-1)?.snapshot?.result;
    if (data.finalScores && (rawResult?.scoresKnown !== true || !validScores(rawResult.scores, data.playerCount))) delete data.finalScores;
    return { matchId: match.id, event: { version: 1, id: root.crypto.randomUUID(), observedStartAt, committedAt, sourceRef, data } };
  }

  function parse(entries) {
    if (entries === undefined) return [];
    const ids = new Set(), matches = new Set();
    if (!Array.isArray(entries) || entries.length > MAX_PENDING || ![...entries].every(entry => {
      const event = entry?.event, data = event?.data;
      if (!matchId(entry?.matchId) || matches.has(entry.matchId) || event?.version !== 1 ||
          typeof event.id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(event.id) || ids.has(event.id) ||
          !timestamp(event.observedStartAt) || !timestamp(event.committedAt) || event.observedStartAt > event.committedAt ||
          !sourceValid(event.sourceRef) || !playerCountValid(data?.playerCount) || !Number.isInteger(data.roundCount) ||
          data.roundCount < 1 || data.roundCount > 100 || !Object.values(END_REASONS).includes(data.endReason) ||
          (data.finalScores !== undefined && (data.endReason === 'abortive_draw' || !validScores(data.finalScores, data.playerCount)))) return false;
      ids.add(event.id);
      matches.add(entry.matchId);
      return true;
    })) throw new Error('Invalid match completion inbox');
    return entries;
  }

  function committed(entry, history) {
    const { event } = entry;
    const match = history.find(match => match?.id === entry.matchId && match.completionEventId === event.id &&
      match.startedAt === event.observedStartAt);
    const data = matchResult(match);
    return !!data && data.playerCount === event.data.playerCount && data.roundCount === event.data.roundCount &&
      data.endReason === event.data.endReason && (!event.data.finalScores || event.data.finalScores.every((score, seat) => score === data.finalScores?.[seat]));
  }

  function publicEvent({ event }) {
    const { version, id, observedStartAt, committedAt, sourceRef: { tabId, documentId },
      data: { playerCount, roundCount, endReason, finalScores } } = event;
    return { version, id, observedStartAt, committedAt, sourceRef: { tabId, documentId },
      data: { playerCount, roundCount, endReason, ...(finalScores ? { finalScores: finalScores.slice() } : {}) } };
  }

  root.MJMatchCompletionInbox = Object.freeze({ KEY, MAX_PENDING, parse, unexpired: (entry, now) => now - entry.event.committedAt < TTL,
    committed, publicEvent, createEntry });
})(globalThis);
