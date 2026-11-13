'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../benchmark/core.cjs');
const Fixed = require('../benchmark/phase2-fixed-source.cjs');
const Binding = require('../benchmark/summary-bindings.cjs');
const filename = 'D:/雀魂插件/research/evidence/realtime-quality-20261031/phase2-planning/source-preparation/r0-real-source.frozen.json';
const available = fs.existsSync(filename);
const localTest = (name, fn) => test(name, { skip: !available && 'Local source not installed' }, fn);
let cached;
function fixture() {
  if (cached) return structuredClone(cached);
  const source = JSON.parse(fs.readFileSync(filename,'utf8'));
  const adapter = Fixed.createAdapter(source,source.hash), descriptors = adapter.summaryDescriptors();
  const representatives = [...new Map(descriptors.map(d=>[Binding.contentHash(d),d])).values()];
  // Entirely offline fixture. Fabricated provenance exercises validation, never enters live artifacts.
  const generations = representatives.map((d,i)=> {
    const fact = d.source.facts[0];
    const rawText = JSON.stringify({schemaVersion:1,sourceHash:d.sourceHash,coveredSourceIds:d.coveredSourceIds,
      facts:[{sourceId:fact.sourceId,position:fact.position,text:'Offline test content with bound source.'}],opinions:[],limitations:['Unit fixture only.']});
    const rawResponseHash = Binding.rawHash(rawText);
    return { sharedContentHash:Binding.contentHash(d),descriptorSourceHash:d.sourceHash,rawText,rawResponseHash,
      provenance:{mode:'live',synthetic:false,runId:'unit-test-only',contractHash:'unit-contract',requestId:'unit-'+i,modelId:'unit-model',
        dispatchedModelRequests:1,simulatedModelRequests:0,sourceFixture:false,startedAt:'2026-11-01T00:00:00Z',finishedAt:'2026-11-01T00:00:01Z'},
      review:{accepted:true,rawResponseHash,reviewer:'unit-review-fixture',evidenceHash:'unit-evidence'} };
  });
  cached = { source,descriptors,generations,identity:adapter.sourceIdentity };
  return structuredClone(cached);
}
function input(node,policy) { return {node,scheme:{id:policy},options:{policy,sourceMode:'fixed-source-replay'},history:[],summary:[],channel:'realtime'}; }
function artifact(f) { return Binding.createArtifact(f.identity,f.descriptors,f.generations); }
function rehash(a) { const {hash,...body}=a; a.hash=Core.stableHash(body); return a; }
localTest('six unchanged raw bodies produce twelve scheme envelopes with identical prose and separate hashes',()=>{
  const f=fixture(),a=artifact(f);
  assert.equal(a.generations.length,6); assert.equal(a.bindings.length,12);
  for(const g of a.generations) {
    const records=a.bindings.filter(r=>r.sharedContentHash===g.sharedContentHash);
    assert.equal(records.length,2); assert.equal(records[0].bodyHash,records[1].bodyHash);
    assert.notEqual(records[0].sourceHash,records[1].sourceHash); assert.notEqual(records[0].envelopeHash,records[1].envelopeHash);
    for(const r of records) assert.deepEqual(Binding.bodyOf(JSON.parse(r.text)),Binding.bodyOf(JSON.parse(g.rawText)));
  }
  assert.deepEqual(Binding.validateArtifact(a,a.hash,f.identity,f.descriptors),a);
});
localTest('all 29 points explicitly distinguish eight warmups from 21 latest shared LLM consumers per scheme',()=>{
  const f=fixture(),a=artifact(f),bound=Fixed.createAdapter(f.source,f.source.hash,{summaryBindings:a,summaryBindingsHash:a.hash});
  for(const policy of ['C-L','C-KM']) {
    let warmup=0,consumed=0;
    for(const round of f.source.dataset.rounds) for(const node of round.decisions) {
      const result=bound.buildContext(input(node,policy));
      if(!result.compression.testedLlmSummary) {
        warmup++;assert.equal(result.compression.summaryUse,'code-warmup-no-eligible-checkpoint');
        assert.equal(result.compression.fallback,true); assert.equal(result.sourceProvenance.summaryBinding,undefined);
      } else {
        consumed++;assert.equal(result.compression.fallback,false);assert.equal(result.summaryJobs.length,0);
        const b=result.sourceProvenance.summaryBinding; assert.equal(b.artifactHash,a.hash);
        assert.deepEqual(result.compression.summaryBinding,b);
        assert.ok(b.watermark<node.position);assert.equal(b.watermark,result.compression.summaryWatermark);
        const latest=bound.previewContext(input(node,policy)).summaryJobs[0];assert.equal(b.sourceHash,latest.sourceHash);
      }
      assert.equal(result.sourceProvenance.currentAnswer,'normal-new-model-request');
      assert.equal(result.requireFixedMainSource,undefined);
    }
    assert.equal(warmup,8);assert.equal(consumed,21);
  }
});
localTest('no-checkpoint warmup allowed without artifact, eligible checkpoint fails closed despite supplied summaries',()=>{
  const f=fixture(),adapter=Fixed.createAdapter(f.source,f.source.hash),a=artifact(f);
  for(const policy of ['C-L','C-KM']) {
    assert.equal(adapter.buildContext(input(f.source.dataset.rounds[0].decisions[0],policy)).compression.testedLlmSummary,false);
    const i=input(f.source.dataset.rounds[0].decisions[10],policy);i.summary=a.bindings;
    assert.throws(()=>adapter.buildContext(i),/not ready/);
  }
  assert.throws(()=>Fixed.createAdapter(f.source,f.source.hash,{summaryBindings:a}),/expected hash/);
});
localTest('rejects rewritten envelope text, body/source/scope/watermark/hash even after outer artifact rehash',()=>{
  const f=fixture(),a=artifact(f);
  const mutations=[
    b=>{b.bindings[0].text=b.bindings[0].text.replace('Offline','Rewritten');},
    b=>{b.bindings[0].bodyHash='wrong';},b=>{b.bindings[0].sourceHash='wrong';},
    b=>{b.bindings[0].scope.roundId='wrong';},b=>{b.bindings[0].watermark+=1;},
    b=>{b.bindings[0].coveredSourceIds.pop();},b=>{b.bindings[0].envelopeHash='wrong';},
    b=>{b.generations[0].rawText+=' ';},b=>{b.sourceIdentity.hash='wrong';}
  ];
  for(const change of mutations) {const b=structuredClone(a);change(b);rehash(b);assert.throws(()=>Binding.validateArtifact(b,b.hash,f.identity,f.descriptors),/Summary bindings/);}
  assert.throws(()=>Binding.validateArtifact(a,'wrong',f.identity,f.descriptors),/expected hash/);
});
localTest('rejects incomplete/duplicate, mock provenance, unreviewed, malformed or future-position bodies',()=>{
  const f=fixture();
  const mutations=[
    g=>g.pop(),g=>{g[1]=structuredClone(g[0]);},g=>{g[0].provenance.synthetic=true;},
    g=>{g[0].provenance.simulatedModelRequests=1;},g=>{g[0].review.accepted=false;},
    g=>{g[0].review.rawResponseHash='wrong';},g=>{g[0].descriptorSourceHash='wrong';},
    g=>{g[0].provenance.finishedAt='2025-01-01T00:00:00Z';},
    g=>{const v=JSON.parse(g[0].rawText);v.facts[0].position+=999;g[0].rawText=JSON.stringify(v);g[0].rawResponseHash=Binding.rawHash(g[0].rawText);g[0].review.rawResponseHash=g[0].rawResponseHash;},
    g=>{const v=JSON.parse(g[0].rawText);v.facts=[];g[0].rawText=JSON.stringify(v);g[0].rawResponseHash=Binding.rawHash(g[0].rawText);g[0].review.rawResponseHash=g[0].rawResponseHash;}
  ];
  for(const change of mutations) {const g=structuredClone(f.generations);change(g);assert.throws(()=>Binding.createArtifact(f.identity,f.descriptors,g),/Summary bindings/);}
});
