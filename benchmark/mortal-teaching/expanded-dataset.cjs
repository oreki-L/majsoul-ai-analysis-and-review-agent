'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { stableHash } = require('../core.cjs');
const { sha256 } = require('./prompts.cjs');
const Base = require('./dataset.cjs');
const State = require('../../extension/state.js');
const Snapshot = require('../../extension/collector/snapshot-adapter.js');
const Analysis = require('../../extension/mahjong-analysis.js');
const Mjai = require('../../extension/adapters/mjai.js');
const Engine = require('../../extension/engine-agent.js');

// Pure in-memory rule probes: no transport, runtime, model, or network is used.
async function legalDiscards(snapshot, request) {
  const analysis = Analysis.analyze(snapshot).efficiency;
  if (analysis.status !== 'available' || !analysis.canDiscard) throw new Error('Expanded decision cannot discard');
  const legalActions = [], forbiddenTiles = [];
  let phase;
  for (const { tile } of analysis.candidates) {
    let validatedRequest = false;
    try {
      const result = await Engine.run({ snapshot, request, infer: async () => {
        validatedRequest = true;
        return { action: { type: 'dahai', actor: snapshot.selfSeat, pai: Mjai.tile(tile), tsumogiri: tile === snapshot.selfDrawnTile } };
      } });
      phase = result.engine.phase;
      legalActions.push({ action: 'discard', tile });
    } catch (error) {
      // Only the formal result contract may reject an individual candidate.
      if (!validatedRequest || error.message !== '专业引擎结果无效或当前动作不受支持。') throw error;
      forbiddenTiles.push(tile);
    }
  }
  if (!legalActions.length || !['draw', 'post-call-discard', 'reach-discard'].includes(phase)) throw new Error('No supported expanded legal discard');
  return { legalActions, phase, forbiddenTiles };
}

async function prepareExpandedDataset(evidenceRoot, previousData) {
  Base.checkDataset(previousData);
  if (previousData.format !== 'mortal-teaching-inputs-v2' || previousData.nodes.length !== 84) throw new Error('Expanded preparation requires original v2 84 decisions');
  // prepareDataset verifies all four fixed source hashes and original rule compatibility.
  const rebuilt = await Base.prepareDataset(evidenceRoot);
  const previous = new Map(previousData.nodes.map(n => [n.sourceConsumedCursor, n]));
  if (previous.size !== 84 || rebuilt.nodes.some(n => stableHash(n) !== stableHash(previous.get(n.sourceConsumedCursor)))) throw new Error('Original 84 dataset differs from fixed sources');
  const read = index => {
    const [file, expected] = Base.SOURCES[index], bytes = fs.readFileSync(path.join(evidenceRoot, file));
    if (sha256(bytes) !== expected) throw new Error('Expanded source hash mismatch: ' + file);
    return JSON.parse(bytes);
  };
  const raw = read(2), mapping = read(3), seat = mapping.selfAbsoluteSeat;
  if (seat !== 1 || mapping.rounds.length !== 12 || raw.replayRecords.length !== 1014) throw new Error('Unexpected expanded source inventory');
  const nodes = [], rounds = [], seen = new Set();
  const matchId = previousData.nodes[0].message.context.identity.matchId;
  for (let i = 0; i < mapping.rounds.length; i++) {
    const round = mapping.rounds[i], start = round.baselinePosition - 1;
    const end = mapping.rounds[i + 1]?.baselinePosition - 1 || raw.replayRecords.length;
    const records = raw.replayRecords.slice(start, end);
    if (records[0]?.kind !== 'NewRound') throw new Error('Expanded round opening mismatch');
    let state = State.initial('replay', seat), previousCount = 0, additionalCount = 0;
    const prefix = [];
    for (let position = 0; position < records.length; position++) {
      const event = { ...Base.mask(records[position], seat), recordIndex: position };
      prefix.push(event);
      state = State.apply(state, event);
      const ownTrigger = event.kind === 'NewRound' && event.round === seat || event.seat === seat && ['DealTile', 'ChiPengGang'].includes(event.kind);
      if (!ownTrigger) continue;
      const snapshot = Snapshot.snapshot(state, { game: true, rivers: 'all', hand: true });
      if (snapshot.selfHand.length % 3 !== 2) continue; // Open kan requires its replacement draw.
      snapshot.lastStep = position;
      const cursor = start + position + 1, old = previous.get(cursor);
      if (old) {
        if (old.roundId !== round.key || old.position !== position || stableHash(old.message.snapshot) !== stableHash(snapshot)) throw new Error('Original expanded position mismatch');
        nodes.push({ ...structuredClone(old), split: 'development', samplingCohort: 'previous84' });
        previousCount++; seen.add(cursor);
        continue;
      }
      const id = `expanded-${round.key}-p${position}`;
      const request = Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'replay', state: { selfSeat: seat }, replayRecords: prefix, replayCursor: prefix.length }, { hand: true });
      const legal = await legalDiscards(snapshot, request);
      const message = { provider: 'mjai', task: 'combined', lane: 'live', clientRunId: id, snapshot,
        context: { identity: { matchId, roundStartId: round.key }, position,
          events: Base.contextEvents(prefix, seat), historyComplete: true, eventWindowStart: 0 }, engineRequest: request };
      const rulesSource = 'formal-engine-agent-engine-result-visible-prefix-v1';
      nodes.push({ id, roundId: round.key, position,
        type: legal.phase === 'post-call-discard' ? 'post-call-discard' : 'ordinary-discard',
        split: 'development', samplingCohort: 'additional43', compatible: true, reason: null,
        sourceConsumedCursor: cursor, inputHash: stableHash(message), message,
        snapshotProvenance: { method: 'dealer-opening-final-tile-v1', originalSnapshot: structuredClone(snapshot),
          originalSnapshotHash: stableHash(snapshot), testSnapshotHash: stableHash(snapshot), changes: [] },
        legalActions: legal.legalActions,
        decisionContext: { phase: legal.phase, actor: seat, triggerPosition: position, rulesSource },
        discardConstraints: { forbiddenTiles: legal.forbiddenTiles, rulesSource } });
      additionalCount++;
    }
    const discardCount = records.filter(e => e.kind === 'DiscardTile' && e.seat === seat).length;
    if (previousCount + additionalCount !== discardCount) throw new Error('Expanded decision/discard inventory differs');
    rounds.push({ roundId: round.key, sourceOpeningConsumedCursor: start + 1, previous84: previousCount, additional43: additionalCount, total: discardCount });
  }
  if (nodes.length !== 127 || seen.size !== 84 || new Set(nodes.map(n => n.id)).size !== 127 || nodes.filter(n => n.samplingCohort === 'additional43').length !== 43) throw new Error('Expanded 127 unique decision inventory mismatch');
  const coverage = { previous84: 84, additional43: 43, total: 127, rounds,
    independentMatches: 1, previousRounds: 9, additionalRounds: 3,
    historicalExposure: { knownPreviouslyBenchmarked: 29,
      evidence: 'realtime-quality-20261031/preparation/dataset.old29.frozen.json',
      knownRounds: [{ roundId: 'east3-h0', decisions: 11 }, { roundId: 'south2-h2', decisions: 18 }],
      otherRounds: [{ roundId: 'east1-h0', decisions: 14, status: 'No exposure established in inspected records; full historical exposure is unknown' }],
      claim: 'additional43 relative to previous84 only; not an unseen or held-out dataset' },
    limitation: 'Additional means absent from the preceding 84-point experiment; these rounds have historical benchmark exposure and are not an unseen-match holdout.' };
  const data = { format: 'mortal-teaching-inputs-v2', simulation: 'authorized replay prefixes; not online live capture',
    sources: structuredClone(rebuilt.sources), previousDatasetHash: previousData.datasetHash,
    coverage, inventory: { replayRecords: 1014, selfSeat: seat, rounds: 12, compatibleDecisions: 127, sources: structuredClone(rebuilt.sources) }, nodes };
  return Base.checkDataset({ ...data, datasetHash: stableHash(data) });
}
module.exports = { prepareExpandedDataset };
