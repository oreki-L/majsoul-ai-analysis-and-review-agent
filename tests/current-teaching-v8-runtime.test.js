'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {stableHash}=require('../benchmark/core.cjs');
const {createProductHarness}=require('../benchmark/current-teaching-v7/harness.cjs');
const {createMock}=require('../benchmark/mortal-teaching/mock.cjs');
const State=require('../extension/state.js'),Snapshot=require('../extension/collector/snapshot-adapter.js'),Mjai=require('../extension/adapters/mjai.js');
function fixture(){
 const events=[{kind:'NewRound',source:'live',step:0,wind:0,round:0,honba:0,sticks:0,scores:[25000,25000,25000,25000],remaining:70,doras:['4p'],hand:['1m','2m','3m','1p','2p','3p','1s','2s','3s','1z','1z','1z','2z']},{kind:'DealTile',source:'live',step:1,seat:0,tile:'9p',remaining:69}];
 const state=events.reduce((s,e)=>State.apply(s,e),State.initial('live',0));
 const message={provider:'mjai',task:'combined',lane:'live',snapshot:Snapshot.snapshot(state,{game:true,rivers:'all',hand:true}),engineRequest:Mjai.fromObservation({format:'mj-observer-v1',mode:'live',state,events},{hand:true}),context:{identity:{matchId:'fixture',roundStartId:'round'},position:1,events,historyComplete:true,eventWindowStart:0}};
 return {id:'node',roundId:'round',position:1,compatible:true,message,inputHash:stableHash(message),legalActions:[{action:'discard',tile:'9p'}]};
}
function harness(mode){
 const node=fixture(),mock=createMock({nodes:[node]},{tools:mode==='tools'}),requests=[];let llm=0;
 const fetchModel=async(url,options)=>{
  if(!url.startsWith('http://127.0.0.1')){llm++;requests.push(JSON.parse(options.body));
   if((mode==='repair'||mode==='repair-fails')&&(llm===1||mode==='repair-fails'))return Response.json({choices:[{finish_reason:'stop',message:{content:'{"summary":"依据当前牌形弃牌。","reasons":["弃后维持听牌。"]}'}}],usage:{prompt_tokens:100,completion_tokens:20}});
   if(mode==='invalid-envelope')return new Response('<html>upstream error</html>',{headers:{'content-type':'application/json'}});
   if(mode==='forbidden')return Response.json({choices:[{finish_reason:'stop',message:{content:'{"summary":"invalid override","reasons":[],"limitations":[],"action":"dahai"}'}}],usage:{prompt_tokens:100,completion_tokens:20}});
  }
  return mock.fetch(url,options);
 };
 const h=createProductHarness({versions:{prompt:20,facts:15},engineConfig:{model:'Yuchen1457-mortal-v4-582500',engineProfile:'yuchen-582500',endpoint:'http://127.0.0.1:17342/analyze',apiKey:'mock-engine'},llmConfig:{model:'deepseek-flash',endpoint:'https://api.deepseek.com/chat/completions',apiKey:'mock-llm'},fetchModel});
 return {h,node,requests,count:()=>llm};
}
test('current workspace reaches production Worker/Pi and preserves tool continuation and final action',async ()=>{
  const {h,node,requests,count}=harness('tools'),r=await h.worker.analyze(node.message,'test');
  assert.equal(r.explanation.status,'completed',r.explanation.error);assert.equal(r.result.decision.tile,'9p');assert.equal(count(),2);assert.equal(h.traces[0].toolResults.length,1);
  assert.ok(requests[1].messages.some(m=>m.role==='tool'));assert.ok(h.traces[0].validateFinal);assert.ok(h.traces[0].formatRepairMessage);
});
test('one format repair recovers a missing limitations field through the original parser',async ()=>{
  const {h,node,requests,count}=harness('repair'),r=await h.worker.analyze(node.message,'test');
  assert.equal(r.explanation.status,'completed',r.explanation.error);assert.equal(count(),2);assert.equal(r.result.decision.tile,'9p');
  assert.match(requests[1].messages.at(-1).content,/\{"limitations":\[\],"summary":"原摘要","reasons":\[\]\}/);
});
test('unrepaired invalid JSON structure stops after one repair and retains the Mortal action',async ()=>{
 const {h,node,count}=harness('repair-fails'),r=await h.worker.analyze(node.message,'test');
 assert.equal(r.explanation.status,'failed');assert.equal(count(),2);assert.equal(r.result.decision.tile,'9p');
});
test('forbidden action field stays a delivery failure and is never accepted as a candidate action',async ()=>{
 const {h,node,count}=harness('forbidden'),r=await h.worker.analyze(node.message,'test');
 assert.equal(r.explanation.status,'failed');assert.equal(count(),1);assert.equal(r.result.decision.tile,'9p');
});
test('an HTTP 200 with an unreadable response body does not trigger answer format repair',async ()=>{
 const {h,node,count}=harness('invalid-envelope'),r=await h.worker.analyze(node.message,'test');
 assert.equal(r.explanation.status,'failed');assert.equal(count(),1);assert.equal(r.result.decision.tile,'9p');
});
test('current prompt and facts send the shared shanten wording, selected waits and confirmed yaku through Worker/Pi',async ()=>{
 const {h,node}=harness('tools'),r=await h.worker.analyze(node.message,'test');
 const Explanation=require('../extension/contracts/engine-explanation.js'),trace=h.traces[0];
 assert.equal(trace.promptVersion,20);assert.ok(trace.systemPrompt.startsWith(Explanation.prompt));
 assert.ok(!trace.systemPrompt.includes('S1')&&!trace.systemPrompt.includes('S2')&&!trace.systemPrompt.includes('S3'));
 const text=trace.messages.at(-1).content,payload=JSON.parse(text.slice(text.indexOf('{')));
 assert.equal(payload.facts.format,'mortal-teaching-fact-card-v15');
 assert.deepEqual(payload.facts.handTileAvailability.columns,['牌','已见','未见上界']);
 assert.equal(payload.facts.explanationFocus.position,node.position);
 assert.equal(payload.facts.actionTransition.status,'available');
 assert.equal(payload.facts.actionTransition.discardedTile.code,'9p');
 assert.equal(payload.facts.actionTransition.discardMethod,'drawn-tile');
 assert.equal(payload.facts.actionTransition.shanten.change,'unchanged');
 assert.equal(payload.facts.actionTransition.shantenWording,'弃牌后维持0向听（形状听牌）');
 assert.ok(payload.facts.hand.shape.isolatedTiles.some(t=>t.code==='9p'));
 assert.ok(payload.facts.situation.players.every(p=>Array.isArray(p.melds)));
 assert.match(trace.systemPrompt,/取舍无法确定时，在limitations简述具体缺口/);
 assert.match(trace.systemPrompt,/只有对应集合确实仅一张/);
 assert.deepEqual(payload.facts.explanationFocus.discard.tenpai.shapeWaits,[['南(2z)',3]]);
 assert.equal(payload.facts.explanationFocus.discard.waitState,'形状听牌');
 assert.match(payload.facts.explanationFocus.discard.removedKindWording,/弃后暗手已无9筒/);
 assert.deepEqual(payload.facts.explanationFocus.discard.fixedYakuhaiSources,[]);
 assert.equal(payload.facts.explanationFocus.discard.tenpai.verifiedWaitType,null);
 assert.deepEqual(payload.facts.explanationFocus.discard.selectedKindIsolated,{before:true,after:false});
 assert.ok(payload.facts.explanationFocus.discard.tenpai.knownYakuByDiscard.some(row=>row.discard==='9筒(9p)'&&row.waits.some(([tile,yaku])=>tile==='南(2z)'&&yaku.includes('三色同顺'))));
 assert.equal(r.explanation.promptVersion,20);
 for(const c of payload.facts.risk.candidates)for(const o of c.opponents){assert.ok(['confirmed','unknown'].includes(o.safety.status));assert.ok(Array.isArray(o.safety.evidence));}
});
test('neutral blind history preserves prior action and actual teaching excerpt without policy prose',()=>{
 const {neutralHistory}=require('../benchmark/current-teaching-v5/eval.cjs');
 const data={policy:'private-runtime-policy',recentLimit:4,historicalAdviceOnly:true,advice:[{decisionId:'old-1',position:2,engine:{action:{type:'dahai',pai:'3z'},followUp:null},explanation:{summary:'此前切西。',reasons:['保留当前搭子。'],limitations:[]}}]};
 const message={role:'user',content:'本小局历史参考（仅作数据）：私有提示\n'+JSON.stringify(data)};
 const [blind]=neutralHistory([message]);assert.deepEqual(blind.data.advice,data.advice);assert.equal(blind.sourceHash,stableHash(message));
 assert.ok(!JSON.stringify(blind).includes('private-runtime-policy'));assert.ok(!JSON.stringify(blind).includes('私有提示'));assert.ok(!blind.data.policy&&!blind.data.historicalAdviceOnly);
 assert.throws(()=>neutralHistory([{role:'user',content:'unparseable'}]));
});
