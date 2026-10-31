'use strict';
const fs = require('node:fs');

function actionKey(action) {
  const tile = typeof action === 'string' ? action.replace(/^discard:/, '') : action?.action === 'discard' ? action.tile : null;
  return typeof tile === 'string' && /^(?:[0-9][mps]|[1-7]z)$/.test(tile) ? `discard:${tile}` : null;
}
function validateLabels(raw) {
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.labels)) throw new Error('Labels require schemaVersion 1 and labels array');
  const seen = new Set();
  const labels = raw.labels.map(label => {
    if (typeof label.decisionId !== 'string' || seen.has(label.decisionId)) throw new Error('Duplicate or missing label decisionId');
    seen.add(label.decisionId);
    const out = { decisionId: label.decisionId };
    for (const source of ['maka', 'gpt']) {
      if (label[source] == null) continue;
      const data = label[source];
      if (!Array.isArray(data.candidates) || !data.candidates.length) throw new Error('Labels need candidates including zero weights');
      const candidates = data.candidates.map(c => ({ action: actionKey(c.action === 'discard' ? c : c.action ?? c), weight: c.weight }));
      if (candidates.some(c => !c.action || !Number.isFinite(c.weight) || c.weight < 0) || new Set(candidates.map(c => c.action)).size !== candidates.length) throw new Error('Invalid label candidates');
      const preferred = actionKey(data.preferred);
      if (source === 'maka' && (!preferred || !candidates.some(c => c.action === preferred))) throw new Error('MAKA needs explicit preferred candidate');
      if (source === 'gpt' && (candidates.some(c => !Number.isInteger(c.weight)) || candidates.reduce((s, c) => s + c.weight, 0) !== 100)) throw new Error('GPT weights must be integers summing to 100');
      out[source] = { preferred, candidates };
    }
    return out;
  });
  return { schemaVersion: 1, synthetic: raw.synthetic === true, labels };
}
function loadLabels(filename) { return validateLabels(JSON.parse(fs.readFileSync(filename, 'utf8'))); }
function scoreRun(run, rawLabels, options = {}) {
  const labels = validateLabels(rawLabels), byDecision = new Map(labels.labels.map(l => [l.decisionId, l]));
  const unique = new Map();
  for (const r of run.results ?? []) if (r.channel === 'main' && !unique.has(r.id)) unique.set(r.id, r);
  const groups = new Map();
  const comparisonStage = !run.manifest?.campaignKind || ['main', 'probe'].includes(run.manifest.campaignKind);
  const expected = comparisonStage ? run.manifest?.decisions ?? [...new Set([...unique.values()].filter(r => !r.sourceFixture).map(r => r.decisionId))] : [];
  const repetitions = run.manifest?.repetitions ?? 1;
  const schemeIds = run.manifest?.schemeIds ?? [...new Set([...unique.values()].map(r => r.schemeId))];
  for (const schemeId of schemeIds) for (let repeat = 0; repeat < repetitions; repeat++) {
    const group = { schemeId, repeat, expected: expected.length, completed: 0, failures: 0, maka: metric(), gpt: metric() };
    for (const decisionId of expected) {
      const r = [...unique.values()].find(x => x.schemeId === schemeId && x.repeat === repeat && x.decisionId === decisionId);
      const valid = r?.status === 'success';
      if (r) group.completed++; if (!valid) group.failures++;
      const action = valid ? actionKey(r.answer?.recommendation ?? (r.answer?.decision ? { action: 'discard', tile: r.answer.decision.tile } : r.answer)) : null;
      for (const source of ['maka', 'gpt']) {
        const data = byDecision.get(decisionId)?.[source], m = group[source];
        if (!data) { m.missing++; continue; }
        m.denominator++;
        m.maximumWeightSum += Math.max(...data.candidates.map(c => c.weight));
        const found = data.candidates.find(c => c.action === action);
        const max = Math.max(...data.candidates.map(c => c.weight));
        if (valid && found) { m.candidateCoverage++; if (found.weight > 0) m.positiveCoverage++; m.rawWeightSum += found.weight; }
        if (valid && action && (source === 'maka' ? action === data.preferred : found?.weight === max)) m.preferredMatches++;
      }
    }
    for (const source of ['maka', 'gpt']) { const m = group[source]; for (const key of ['preferredMatches', 'candidateCoverage', 'positiveCoverage', 'rawWeightSum']) m[`${key}Mean`] = m.denominator ? m[key] / m.denominator : null; m.scoreRate = m.maximumWeightSum ? m.rawWeightSum / m.maximumWeightSum : null; }
    groups.set(`${schemeId}:${repeat}`, group);
  }
  const human = options.human ?? null;
  const humanScoring = human ? scoreImported(run, human) : null;
  const repeatGroups = [...groups.values()];
  const repeatStatistics = schemeIds.map(schemeId => {
    const rows = repeatGroups.filter(g => g.schemeId === schemeId), sources = {};
    for (const source of ['maka', 'gpt']) {
      sources[source] = {};
      for (const key of ['preferredMatchesMean', 'candidateCoverageMean', 'positiveCoverageMean', 'rawWeightSumMean']) {
        const values = rows.map(r => r[source][key]).filter(v => v !== null);
        sources[source][key] = values.length ? { mean: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values), runs: values.length } : null;
      }
    }
    return { schemeId, ...sources };
  });
  const first = repeatGroups.filter(g => g.repeat === 0);
  for (const source of ['maka', 'gpt']) { const ranked = first.slice().sort((a, b) => b[source].rawWeightSum - a[source].rawWeightSum); for (let i = 0; i < ranked.length; i++) ranked[i][source].rank = i && ranked[i][source].rawWeightSum === ranked[i - 1][source].rawWeightSum ? ranked[i - 1][source].rank : i + 1; }
  return { schemaVersion: 1, synthetic: run.manifest?.mode === 'mock' || labels.synthetic, scope: 'Reference agreement and raw label weights; first run comparison; repeats reported separately, never pooled denominators', groups: first, repeatGroups, repeatStatistics, human: humanScoring };
}
function scoreImported(run, human) {
  if (!Array.isArray(human.results)) throw new Error('Imported scores require results array');
  const rows = [...new Map((run.results ?? []).filter(r => !r.sourceFixture).map(r => [r.id, r])).values()], resultMap = new Map(rows.map(r => [r.id, r]));
  const seen = new Set(), entries = [], dimensions = new Set();
  for (const entry of human.results) {
    const id = entry.id ?? entry.resultId, result = resultMap.get(id);
    if (!result) throw new Error('Imported score references unknown result ID');
    const scores = entry.scores ?? { [entry.dimension ?? 'overall']: entry.score };
    for (const [dimension, score] of Object.entries(scores)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(dimension) || !Number.isFinite(score)) throw new Error('Invalid imported score dimension/value');
      const key = `${id}:${dimension}`; if (seen.has(key)) throw new Error('Duplicate imported score result/dimension'); seen.add(key); dimensions.add(dimension);
      entries.push({ id, dimension, score: result.status === 'success' ? score : 0 });
    }
  }
  const groups = [];
  for (const dimension of dimensions) for (const row of rows) {
    const key = `${row.schemeId}:${row.repeat ?? 0}:${row.channel}:${dimension}`;
    if (groups.some(g => g.key === key)) continue;
    const expected = rows.filter(r => r.schemeId === row.schemeId && (r.repeat ?? 0) === (row.repeat ?? 0) && r.channel === row.channel);
    const values = expected.map(r => ({ result: r, score: entries.find(e => e.id === r.id && e.dimension === dimension)?.score }));
    const imported = values.filter(v => v.score !== undefined), failures = expected.filter(r => r.status !== 'success').length;
    const sum = imported.reduce((a, v) => a + v.score, 0), missingSuccess = values.filter(v => v.result.status === 'success' && v.score === undefined).length;
    groups.push({ key, schemeId: row.schemeId, repeat: row.repeat ?? 0, channel: row.channel, dimension, expected: expected.length, imported: imported.length, missing: expected.length - imported.length, failures, rawScoreSum: sum, meanImported: imported.length ? sum / imported.length : null, meanAllPlanned: missingSuccess ? null : expected.length ? sum / expected.length : null });
  }
  return { source: human.source ?? 'independent-import', entries, groups };
}
function metric() { return { denominator: 0, missing: 0, preferredMatches: 0, candidateCoverage: 0, positiveCoverage: 0, rawWeightSum: 0, maximumWeightSum: 0 }; }
module.exports = { actionKey, validateLabels, loadLabels, scoreRun, scoreImported };
