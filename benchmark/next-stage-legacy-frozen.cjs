'use strict';
// Reproduce only the prepared contract used by the 2026-10-30 old controls.
// Original analysis dependencies are static copies, without runtime patching.
const Current = require('./context.cjs');
const Analysis = require('./next-stage-legacy/extension/analysis.js');
function buildContext(input) {
  const base = Current.buildContext(input), prepared = Analysis.prepare(input.node.snapshot, 'combined');
  prepared.data.outputConstraints.legalDiscards = input.node.legalActions.map(a => a.tile);
  if (prepared.data.localAnalysis.efficiency?.candidates) prepared.data.localAnalysis.efficiency.candidates = prepared.data.localAnalysis.efficiency.candidates.filter(c => prepared.data.outputConstraints.legalDiscards.includes(c.tile));
  prepared.userPrompt = '请分析以下已授权局面数据：\n' + JSON.stringify(prepared.data);
  prepared.responseSchema.properties.decision.properties.tile.enum = [null, ...prepared.data.outputConstraints.legalDiscards];
  prepared.systemPrompt = prepared.systemPrompt.split('\n输出JSON Schema：\n')[0] + '\n' + Current.ANALYSIS_JSON_CONTRACT + '\n输出JSON Schema：\n' + JSON.stringify(prepared.responseSchema);
  return { ...base, prepared };
}
module.exports = { buildContext };
