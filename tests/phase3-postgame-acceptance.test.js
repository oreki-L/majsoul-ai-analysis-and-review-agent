'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Review = require('../extension/postgame-review.js');
const S = require('../extension/state.js');
const C = require('../extension/collector/snapshot-adapter.js');
function worker() {
  let listener; const requests=[], storage={modelConfig:{enabled:true,model:'mock',endpoint:'https://provider.example/v1/chat/completions',apiKey:'PRIVATE'}};
  const context=vm.createContext({URL,TextEncoder,TextDecoder,Uint8Array,AbortController,DOMException,structuredClone,performance,setTimeout,clearTimeout,
    chrome:{storage:{local:{setAccessLevel(){},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in storage).map(k=>[k,structuredClone(storage[k])]));},async set(value){Object.assign(storage,structuredClone(value));}},onChanged:{addListener(){}}},permissions:{contains:async()=>true},tabs:{query:async()=>[],sendMessage:async()=>{}},runtime:{id:'phase3',getURL:p=>'chrome-extension://phase3/'+p,onMessage:{addListener:fn=>listener=fn}}},
    fetch:async(...args)=>{requests.push(args);throw Error('unexpected external request');}});
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',file),'utf8'),context,{filename:file}));
  vm.runInContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8'),context);
  const sender={id:'phase3',tab:{id:3},frameId:0,url:'https://game.maj-soul.com/1/'};
  const call=(message,from=sender)=>new Promise(resolve=>{if(listener(message,from,response=>resolve(structuredClone(response)))!==true)resolve(undefined);});
  return {requests,storage,call,sender};
}
function input(match,round,position) {
  const s=S.initial('live',0); Object.assign(s,{round:{wind:0,index:round},scores:[25000,25000,25000,25000],phase:'playing',lastStep:position,selfHand:['1m','2m']});
  return {snapshot:C.snapshot(s,{game:true,hand:true,rivers:'all'}),context:{identity:{matchId:match,roundStartId:match+'-'+round},position},type:'combined',analysis:{model:'offline',result:{task:'combined',danger:[],efficiency:[],decision:{action:'fold',tile:null,reasons:[match+'-'+round]},limitations:[]}}};
}
test('phase3 independent: actual worker local summary/open operations never call model and isolate retained games', async()=>{
  const w=worker(), a=(await w.call({type:'discussion:save',record:input('A',0,5)})).record;
  const b=(await w.call({type:'discussion:save',record:input('A',1,5)})).record;
  await w.call({type:'discussion:save',record:input('B',0,5)});
  await w.call({type:'discussion:ask',id:b.id,question:'only A second round',token:'q'});
  const records=(await w.call({type:'discussion:list'})).records;
  const summary=Review.summarize(records,Review.groupKey(a));
  assert.equal(summary.decisionCount,2);assert.equal(summary.roundCount,2);assert.equal(summary.questionCount,1);
  assert.equal(summary.actualActions,'unknown'); assert.deepEqual(summary.decisionIds,[a.id,b.id]);
  assert.equal(summary.topics[3].references[0].decisionId,b.id);
  assert.equal((await w.call({type:'discussion:patch',id:b.id,patch:{panel:true,collapsed:false}})).record.id,b.id);
  assert.equal(w.requests.length,0);
});
test('phase3 independent: options-only clear removes asked records; stale reference fails without network',async()=>{
  const w=worker(), a=(await w.call({type:'discussion:save',record:input('A',0,5)})).record;
  await w.call({type:'discussion:ask',id:a.id,question:'must be cleared',token:'q'});
  assert.equal(await w.call({type:'agent:clear-data'}),undefined);
  assert.equal((await w.call({type:'discussion:list'})).records.length,1);
  assert.equal((await w.call({type:'agent:clear-data'},{id:'phase3',url:'chrome-extension://phase3/options.html'})).ok,true);
  assert.deepEqual((await w.call({type:'discussion:list'})).records,[]);
  assert.equal(Review.summarize([],Review.groupKey(a)),null);
  assert.equal((await w.call({type:'discussion:patch',id:a.id,patch:{panel:true}})).ok,false);
  assert.equal((await w.call({type:'discussion:ask',id:a.id,question:'stale',token:'stale'})).ok,false);
  assert.equal(w.requests.length,0);assert.equal(w.storage.modelConfig.apiKey,'PRIVATE');
});
test('phase3 independent: untrusted game sender cannot read, mutate or clear retained decision references',async()=>{
  const w=worker();await w.call({type:'discussion:save',record:input('A',0,5)});
  for(const sender of [{...w.sender,id:'other'},{...w.sender,frameId:1},{...w.sender,url:'https://evil.example/'}])assert.equal(await w.call({type:'discussion:list'},sender),undefined);
  assert.equal((await w.call({type:'discussion:list'})).records.length,1);assert.equal(w.requests.length,0);
});
