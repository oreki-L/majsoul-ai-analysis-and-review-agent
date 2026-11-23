'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {stableHash}=require('../benchmark/core.cjs');
const {createProductHarness}=require('../benchmark/teaching-optimization/runtime-harness.cjs');
const {createMock}=require('../benchmark/mortal-teaching/mock.cjs');
const State=require('../extension/state.js'),Snapshot=require('../extension/collector/snapshot-adapter.js'),Mjai=require('../extension/adapters/mjai.js');
function fixture(){
 const events=[{kind:'NewRound',source:'live',step:0,wind:0,round:0,honba:0,sticks:0,scores:[25000,25000,25000,25000],remaining:70,doras:['4p'],hand:['1m','2m','3m','1p','2p','3p','1s','2s','3s','1z','1z','1z','2z']},{kind:'DealTile',source:'live',step:1,seat:0,tile:'9p',remaining:69}];
 const state=events.reduce((s,e)=>State.apply(s,e),State.initial('live',0));
 const message={provider:'mjai',task:'combined',lane:'live',snapshot:Snapshot.snapshot(state,{game:true,rivers:'all',hand:true}),engineRequest:Mjai.fromObservation({format:'mj-observer-v1',mode:'live',state,events},{hand:true}),context:{identity:{matchId:'fixture',roundStartId:'round'},position:1,events,historyComplete:true,eventWindowStart:0}};
 return {id:'node',roundId:'round',position:1,compatible:true,message,inputHash:stableHash(message),legalActions:[{action:'discard',tile:'9p'}]};
}
function harness(t,candidate,mode){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'teaching-optimization-'));
 t.after(()=>{const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('teaching-optimization-'));fs.rmSync(resolved,{recursive:true,force:true});});
 const node=fixture(),mock=createMock({nodes:[node]},{tools:mode==='tools'}),requests=[];let llm=0;
 const fetchModel=async(url,options)=>{
  if(!url.startsWith('http://127.0.0.1')){llm++;requests.push(JSON.parse(options.body));
   if((mode==='repair'||mode==='repair-fails')&&(llm===1||mode==='repair-fails'))return Response.json({choices:[{finish_reason:'stop',message:{content:'{"summary":"missing arrays"}'}}],usage:{prompt_tokens:100,completion_tokens:20}});
   if(mode==='forbidden')return Response.json({choices:[{finish_reason:'stop',message:{content:'{"summary":"invalid override","reasons":[],"limitations":[],"action":"dahai"}'}}],usage:{prompt_tokens:100,completion_tokens:20}});
  }
  return mock.fetch(url,options);
 };
 const h=createProductHarness({candidate,directory,persist:()=>{},engineConfig:{model:'Yuchen1457-mortal-v4-582500',engineProfile:'yuchen-582500',endpoint:'http://127.0.0.1:17342/analyze',apiKey:'mock-engine'},llmConfig:{model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions',apiKey:'mock-llm'},fetchModel});
 return {h,node,requests,count:()=>llm};
}
test('all new candidates reach production Worker/Pi and preserve tool continuation and final action',async t=>{
 for(const candidate of ['s1-semantics','s2-action-focus','s3-history-isolation']){
  const {h,node,requests,count}=harness(t,candidate,'tools'),r=await h.worker.analyze(node.message,'test');
  assert.equal(r.explanation.status,'completed',r.explanation.error);assert.equal(r.result.decision.tile,'9p');assert.equal(count(),2);assert.equal(h.traces[0].toolResults.length,1);
  assert.ok(requests[1].messages.some(m=>m.role==='tool'));assert.ok(h.traces[0].validateFinal);assert.ok(h.traces[0].formatRepairMessage);
 }
});
test('one format repair recovers missing arrays for every candidate through the original parser',async t=>{
 for(const candidate of ['s1-semantics','s2-action-focus','s3-history-isolation']){
  const {h,node,count}=harness(t,candidate,'repair'),r=await h.worker.analyze(node.message,'test');
  assert.equal(r.explanation.status,'completed',r.explanation.error);assert.equal(count(),2);assert.equal(r.result.decision.tile,'9p');
 }
});
test('unrepaired invalid JSON structure stops after one repair and retains the Mortal action',async t=>{
 const {h,node,count}=harness(t,'s2-action-focus','repair-fails'),r=await h.worker.analyze(node.message,'test');
 assert.equal(r.explanation.status,'failed');assert.equal(count(),2);assert.equal(r.result.decision.tile,'9p');
});
test('forbidden action field stays a delivery failure and is never accepted as a candidate action',async t=>{
 const {h,node,count}=harness(t,'s3-history-isolation','forbidden'),r=await h.worker.analyze(node.message,'test');
 assert.equal(r.explanation.status,'failed');assert.equal(count(),1);assert.equal(r.result.decision.tile,'9p');
});
