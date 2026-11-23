'use strict';
// Offline input preparation only: no credentials, HTTP, generation or score reuse.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const { stableHash }=require('../core.cjs');
const { readEvents }=require('../durable.cjs');
const { verify }=require('../mortal-teaching/product-eval.cjs');
const { ENGINE }=require('../mortal-teaching/retest-projection.cjs');
const { CANDIDATES,transformOptions }=require('./candidates.cjs');
const root=path.resolve(__dirname,'../..');
function prepare({source,out}) {
  source=path.resolve(source);out=path.resolve(out);
  const evidence=path.join(root,'research/evidence'),relative=path.relative(evidence,out);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Preparation output must be a new directory inside ignored research/evidence');
  if(fs.existsSync(out))throw Error('Refusing to overwrite an existing experiment');
  const {contract}=verify(source);
  const audit=JSON.parse(fs.readFileSync(path.join(source,'FINAL_AUDIT.json'),'utf8'));
  if(!audit.passed||audit.scored!==251)throw Error('Expected completed source evaluation');
  const traces=readEvents(path.join(source,'live/results.jsonl')).filter(e=>e.kind==='trace'&&e.payload.kind==='pi-input'&&e.payload.jobId.endsWith(':a-release-v0168'));
  assert.equal(traces.length,127);assert.equal(new Set(traces.map(e=>e.payload.jobId)).size,127);
  const groups=Object.fromEntries(CANDIDATES.map(c=>[c.id,{inputs:0,totalInputBytes:0,totalDeltaFromCompactBytes:0,historyBytesRemoved:0,historyChanged:0}])),inputs=[];
  for(const {payload:{jobId,value:options}} of traces) {
    const before=stableHash(options),baseline=transformOptions(options,'b-compact-control');
    const bytes=o=>Buffer.byteLength(JSON.stringify({systemPrompt:o.systemPrompt,messages:o.messages,tools:o.tools}));
    for(const candidate of CANDIDATES) {
      const projected=transformOptions(options,candidate.id),p=JSON.parse(projected.messages.at(-1).content.slice(ENGINE.length)),original=JSON.parse(options.messages.at(-1).content.slice(ENGINE.length));
      assert.deepEqual(p.engine,original.engine);delete p.facts.handTileAvailability;delete p.facts.explanationFocus;
      assert.deepEqual(p,original);assert.deepEqual(projected.messages.at(-2),options.messages.at(-2));
      assert.equal(projected.validateFinal,options.validateFinal);assert.equal(projected.formatRepairMessage,options.formatRepairMessage);assert.equal(projected.tools,options.tools);
      const g=groups[candidate.id];g.inputs++;g.totalInputBytes+=bytes(projected);g.totalDeltaFromCompactBytes+=bytes(projected)-bytes(baseline);
      const oldHistory=JSON.stringify(options.messages.slice(0,-2)),newHistory=JSON.stringify(projected.messages.slice(0,-2));
      if(oldHistory!==newHistory){assert.equal(candidate.id,'s3-history-isolation');g.historyChanged++;g.historyBytesRemoved+=Buffer.byteLength(oldHistory)-Buffer.byteLength(newHistory);}
      inputs.push({nodeId:jobId.slice(contract.batchId.length+1,-':a-release-v0168'.length),candidate:candidate.id,inputHash:stableHash(projected),options:projected});
    }
    assert.equal(stableHash(options),before);
  }
  for(const g of Object.values(groups)){g.meanInputBytes=g.totalInputBytes/g.inputs;g.meanDeltaFromCompactBytes=g.totalDeltaFromCompactBytes/g.inputs;g.meanHistoryBytesRemoved=g.historyBytesRemoved/g.inputs;}
  const codeFiles=['candidates.cjs','prepare.cjs'].map(f=>path.join(__dirname,f));
  const manifest={kind:'teaching-optimization-offline-input-rehearsal-v1',createdAt:new Date().toISOString(),sourceBatchId:contract.batchId,datasetHash:contract.datasetHash,sourceFingerprintVerified:true,code:Object.fromEntries(codeFiles.map(f=>[path.relative(root,f).replace(/\\/g,'/'),stableHash(fs.readFileSync(f,'utf8'))])),candidates:CANDIDATES,groups,inputCount:inputs.length,paidHttp:0,estimatedCostCny:0,productModified:false,limitations:['Offline input transformation only; no new model answer, quality score or runtime success is claimed.','Historical release-A contexts are used only for projection rehearsal. A real test must rebuild separate fresh candidate histories, not replay these old answers as candidate results.','Existing released product harness accepts only old A/B transforms. A separately frozen live runner must admit these candidates before paid execution.','All original facts remain available; S2 adds a focused index rather than reducing the complete facts payload.','Safety index only summarizes positive own-river evidence; temporal pass-after-riichi safety is not newly computed.']};
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'inputs.jsonl'),inputs.map(x=>JSON.stringify(x)).join('\n')+'\n');
  manifest.inputsHash=stableHash(inputs);fs.writeFileSync(path.join(out,'OFFLINE_AUDIT.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest,null,2));return manifest;
}
if(require.main===module){const [source,out]=process.argv.slice(2);if(!source||!out)throw Error('Usage: node benchmark/teaching-optimization/prepare.cjs SOURCE_BATCH NEW_OUTPUT_DIRECTORY');prepare({source,out});}
module.exports={prepare};
