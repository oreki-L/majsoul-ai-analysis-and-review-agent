'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { sha256 } = require('./prompts.cjs');
const Mjai = require('../../extension/adapters/mjai.js');
const Engine = require('../../extension/engine-agent.js');
const DEV = ['south1-h0', 'south1-h1', 'south3-h0'];
const SOURCES = [
  ['realtime-quality-20261031/preparation/dataset.new45.frozen.json', '477224b5e5c9c8d7b6fb5e754f4983c485b103c84b0269aeee1232cb9f0d27d6'],
  ['realtime-quality-20261031/same-match-remaining-20261102/preparation/dataset.remaining.frozen.json', 'e226990f22437eb9d685ca6d560c43b9791bf1afd4becf4e15a8fa59e471a344'],
  ['maka-context-benchmark-20261025/raw/replay-observation.json', 'ef7c46a769b6cb1be00de1fce3190adca6131271fdc2615e47210bfd3e37d8d4'],
  ['maka-context-benchmark-20261025/mapping/expansion-public-positions.json', '0257edc984c5d1853d3e48ed5c2e4b404076c989602cbf813cee9d46625d2b43']
];
function mask(record, seat) {
  const out = structuredClone(record);
  if (out.kind === 'NewRound') out.hands = out.hands.map((h, i) => i === seat ? h : h.map(() => '?'));
  if (out.kind === 'DealTile' && out.seat !== seat) out.tile = '?';
  // Operations can encode private opponent choices. The request adapter needs
  // no operations; legal choices are computed by the current product contract.
  delete out.operation; delete out.operations;
  return out;
}
function contextEvents(prefix, seat) {
  return prefix.map((record, step) => {
    const e = { kind: record.kind, source: 'replay', step };
    for (const k of ['seat', 'tile', 'riichi', 'tsumogiri', 'type', 'tiles', 'froms', 'doras', 'wind', 'round', 'honba', 'sticks', 'scores', 'remaining']) if (record[k] !== undefined) e[k] = structuredClone(record[k]);
    if (e.kind === 'DealTile' && e.seat !== seat) delete e.tile;
    return e;
  });
}
async function prepareDataset(evidenceRoot) {
  const read = index => {
    const [relative, expected] = SOURCES[index], bytes = fs.readFileSync(path.join(evidenceRoot, relative));
    if (sha256(bytes) !== expected) throw new Error('Historical source hash mismatch: ' + relative);
    return JSON.parse(bytes);
  };
  const sets = [read(0), read(1)], raw = read(2), mapping = read(3), nodes = [];
  for (const set of sets) for (const round of set.rounds) {
    const openingConsumedCursor = mapping.rounds.find(r => r.key === round.id)?.baselinePosition;
    if (!Number.isSafeInteger(openingConsumedCursor) || raw.replayRecords[openingConsumedCursor - 1]?.kind !== 'NewRound') throw new Error('Opening cursor mismatch');
    for (const original of round.decisions) {
      const node = structuredClone(original), cursor = openingConsumedCursor + node.position;
      // Rebase recordIndex together with the sliced round, retaining the exact
      // original consumed cursor separately. No event is inserted or reordered.
      const prefix = raw.replayRecords.slice(openingConsumedCursor - 1, cursor).map((e, recordIndex) => ({ ...mask(e, node.snapshot.selfSeat), recordIndex }));
      if (prefix.length !== node.position + 1 || prefix.some((e, i) => i > 0 && e.kind === 'NewRound')) throw new Error('Decision prefix crosses a round');
      const message = { provider: 'mjai', task: 'combined', lane: 'live', clientRunId: node.id,
        snapshot: node.snapshot, context: { identity: { matchId: set.sessionId, roundStartId: round.id }, position: node.position,
          events: contextEvents(prefix, node.snapshot.selfSeat), historyComplete: true, eventWindowStart: 0 } };
      let compatible = false, reason = null, reachedInfer = false;
      try {
        message.engineRequest = Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'replay', state: { selfSeat: node.snapshot.selfSeat }, replayRecords: prefix, replayCursor: prefix.length }, { hand: true });
        await Engine.run({ snapshot: message.snapshot, request: message.engineRequest, infer: async () => { reachedInfer = true; throw new Error('PREPARATION_ONLY_NO_INFERENCE'); } });
      } catch (error) {
        if (reachedInfer && error.message === 'PREPARATION_ONLY_NO_INFERENCE') compatible = true;
        else reason = error.message;
      }
      nodes.push({ id: node.id, roundId: round.id, position: node.position, type: node.type,
        split: DEV.includes(round.id) ? 'development' : 'validation', compatible, reason,
        sourceConsumedCursor: cursor, inputHash: stableHash(message), message,
        legalActions: node.legalActions, decisionContext: node.decisionContext, discardConstraints: node.discardConstraints });
    }
  }
  if (nodes.length !== 84 || new Set(nodes.map(n => n.id)).size !== 84) throw new Error('Expected original 84 unique decisions');
  const data = { format: 'mortal-teaching-inputs-v1', simulation: 'authorized replay prefixes; not online live capture', sources: SOURCES.map(([file, sha256]) => ({ file, sha256 })), nodes };
  return { ...data, datasetHash: stableHash(data) };
}
function checkDataset(data) {
  const { datasetHash, ...body } = data;
  if (stableHash(body) !== datasetHash) throw new Error('Frozen dataset hash mismatch');
  for (const n of data.nodes) if (stableHash(n.message) !== n.inputHash) throw new Error('Frozen node input hash mismatch');
  return data;
}
module.exports = { prepareDataset, checkDataset, contextEvents, mask, DEV, SOURCES };
