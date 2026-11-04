'use strict';
// Explicit real-weight acceptance. Never called from npm test/check/build.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {createMortalRunner}=require('../agent/mortal-process.cjs');
const {runtimeConfig,verifyFiles,sourceForProfile}=require('../agent/mortal-local.cjs');
const {createEngineServer}=require('../agent/engine-server.cjs');
const State=require('../extension/state.js');
const Snapshot=require('../extension/collector/snapshot-adapter.js');
const Mjai=require('../extension/adapters/mjai.js');
const Agent=require('../extension/engine-agent.js');
const hand=['1m','3m','4m','5m','6m','1p','2p','3p','1s','2s','3s','1z','1z'];
const drop=(seat,tile,extra={})=>({kind:'DiscardTile',seat,tile,riichi:false,tsumogiri:false,...extra});
const draw=(seat,tile='?',extra={})=>({kind:'DealTile',seat,tile,...extra});
const call=(seat,meldType,tiles,froms)=>({kind:'ChiPengGang',seat,meldType,tiles,froms});
function situation(actions,tiles=hand,seat=1,{honba=0,round=0,scores=[25000,25000,25000,25000],actionsAvailable}={}){
  let remaining=70;
  const events=[{kind:'NewRound',source:'live',step:0,wind:0,round,honba,sticks:0,scores,remaining:70,doras:['7z'],hand:tiles.slice()},
    ...actions.map((e,i)=>({source:'live',step:i+1,...(e.kind==='DealTile'?{remaining:--remaining}:{}),...e}))];
  const state=events.reduce((s,e)=>State.apply(s,e),State.initial('live',seat));
  if(actionsAvailable)state.availableActions={seat,lastStep:events.length-1,types:actionsAvailable};
  const snapshot=Snapshot.snapshot(state,{game:true,rivers:'all',hand:true});
  const request=Mjai.fromObservation({format:'mj-observer-v1',mode:'live',state,events},{hand:true});
  return {snapshot,request};
}
function fixtures(){
  const samples=[];
  for(let n=0;n<100;n++){
    const seat=n%4,cycles=Math.floor(n/4)%5,events=[];
    for(let cycle=0;cycle<cycles;cycle++)for(let step=0;step<4;step++){
      const actor=(seat+step)%4,tile=(9-cycle)+'p';events.push(draw(actor,actor===seat?tile:'?'),drop(actor,tile,{tsumogiri:true}));
    }
    events.push(draw(seat,'9s'));
    samples.push(situation(events,hand,seat,{round:seat,honba:Math.floor(n/20),scores:[25000+n*100,25000-n*100,25000,25000]}));
  }
  return samples;
}
function keyFixtures(){
  const chi=[drop(0,'2m'),call(1,0,['1m','2m','3m'],[1,0,1])];
  const red=['0p','5p',...hand.slice(2)];
  const kan=['5p','0p','5p',...hand.slice(3)];
  const ready=['1m','2m','3m','1p','2p','3p','1s','2s','3s','1z','1z','1z','2z'];
  const reachReady=ready.map(t=>t==='1z'?'9m':t);
  const ankan=['0m','5m','5m','7m','8m','9m','1p','2p','3p','1s','2s','3s','1z'];
  const kakan=[draw(0),drop(0,'5p'),call(1,1,['0p','5p','5p'],[1,0,1]),drop(1,'4m'),draw(2),drop(2,'8p'),draw(3),drop(3,'8p'),draw(0),drop(0,'8p'),draw(1,'5p')];
  const reach=[draw(0,'9p'),drop(0,'9p',{riichi:true,tsumogiri:true}),draw(1,'?',{riichiSuccess:{seat:0,score:24000,sticks:1,failed:false}})];
  const declaration=situation([draw(0,'9p')],reachReady,0);
  declaration.request.events.push({type:'reach',actor:0});declaration.snapshot.game.players[0].riichi=true;
  return [
    ['response',situation([draw(0),drop(0,'9p')]),'accepted'],
    ['chi-response',situation([draw(0),drop(0,'4m')]),'accepted'],
    ['post-chi',situation([draw(0),...chi]),'accepted'],
    ['red-pon-response',situation([draw(0),drop(0,'5p')],red),'accepted'],
    ['post-pon',situation([draw(0),drop(0,'5p'),call(1,1,['5p','0p','5p'],[0,1,1])],red),'accepted'],
    ['daiminkan-response',situation([draw(0),drop(0,'5p')],kan),'accepted'],
    ['kan-replacement',situation([draw(0),drop(0,'5p'),call(1,2,['5p','5p','0p','5p'],[0,1,1,1]),draw(1,'9s',{doras:['7z','2z']})],kan),'accepted'],
    ['ankan-candidate',situation([draw(0),drop(0,'9p'),draw(1,'5m')],ankan),'accepted'],
    ['ankan-replacement',situation([draw(0),drop(0,'9p'),draw(1,'5m'),{kind:'AnGangAddGang',seat:1,meldType:3,tile:'5m'},draw(1,'9s',{doras:['7z','3z']})],ankan),'accepted'],
    ['kakan-candidate',situation(kakan,red),'accepted'],
    ['kakan-replacement',situation([...kakan,{kind:'AnGangAddGang',seat:1,meldType:2,tile:'5p'},draw(1,'9s',{doras:['7z','3z']})],red),'accepted'],
    ['reach-candidate',situation([draw(0,'9p')],reachReady,0),'accepted'],
    ['reach-declaration-discard',declaration,'accepted'],
    ['riichi-accepted-draw',situation([...reach,drop(1,'8p'),draw(2),drop(2,'8p'),draw(3),drop(3,'8p'),draw(0,'9s')],ready,0),'accepted'],
    ['riichi-accepted-ron',situation([...reach,drop(1,'2z',{operation:{seat:0,types:[9]}})],ready,0),'accepted'],
    ['tsumo-qualified',situation([draw(0,'2z',{operation:{seat:0,types:[8]}})],ready,0),'accepted'],
    ['ron-qualified',situation([draw(0),drop(0,'2z',{operation:{seat:1,types:[9]}})],ready),'accepted'],
    ['tsumo-qualification-missing',situation([draw(0,'2z')],ready,0),'rejected'],
    ['ron-qualification-missing',situation([draw(0),drop(0,'2z')],ready),'rejected']
  ];
}
async function main(){
  const dir=path.resolve(process.argv[2]||'research/evidence/voidshine-mortal-298k');
  const args=process.argv.slice(3),options={dir,profile:'voidshine-298k'};
  while(args.length){const flag=args.shift();if(!['--profile','--python'].includes(flag)||!args.length)throw new Error('INVALID_ARGUMENTS');options[flag.slice(2)]=args.shift();}
  const source=sourceForProfile(options.profile);await verifyFiles(dir,options.profile);
  const r=createMortalRunner(runtimeConfig(options)),start=performance.now();
  const service=createEngineServer({runner:r,token:'local-real-model-validation'}),{server}=service;
  try{
    await r.start();const coldMs=performance.now()-start;
    await r.infer(fixtures()[0].request); // Explicit warm-up, excluded from hot timing.
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const endpoint=`http://127.0.0.1:${server.address().port}/analyze`;
    const infer=async request=>{const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer local-real-model-validation'},body:JSON.stringify(request)});assert.equal(res.status,200);return res.json();};
    const latency=[],records=[],pid=r.pid;
    for(const [index,c] of fixtures().entries()){
      const begin=performance.now(),result=await Agent.run({...c,infer,expectedProfile:options.profile});latency.push(performance.now()-begin);
      records.push({index,seat:c.request.seat,eventCount:c.request.events.length,action:result.engine.action,followUp:result.engine.followUp});
      assert.equal(r.pid,pid);
    }
    const keyCases=keyFixtures(),keys=[];
    const reference=spawnSync(runtimeConfig(options).command,['-I',path.join(__dirname,'mortal-official-reference.py'),'--dir',dir,'--checkpoint',source.files[0].name],{input:keyCases.map(([,c])=>JSON.stringify(c.request)).join('\n')+'\n',encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
    assert.equal(reference.status,0,reference.stderr);
    const official=reference.stdout.trim().split('\n').map(line=>JSON.parse(line));assert.equal(official.length,keyCases.length);
    for(const [index,[name,c,expected]] of keyCases.entries()){
      const raw=await infer(c.request),ref=official[index];
      assert.deepEqual(raw.action,ref.action,name+' official action');assert.deepEqual(raw.followUp||null,ref.followUp,name+' official follow-up');
      const run=()=>Agent.run({...c,infer:async()=>raw,expectedProfile:options.profile});
      if(expected==='rejected'){
        await assert.rejects(run(),/专业引擎结果无效/);keys.push({name,status:'rejected',reason:'missing same-step win qualification',officialAction:raw.action});
      }else{
        let response; try { response=await run(); } catch(error) { throw new Error(name+': '+error.message); }
        keys.push({name,status:'accepted',action:response.engine.action,followUp:response.engine.followUp,numericsSha256:ref.numericsSha256,lastNumerics:ref.lastNumerics});
        if(name==='reach-candidate'){assert.equal(response.engine.action.type,'reach');assert.equal(response.engine.followUp.type,'dahai');}
        if(name==='reach-declaration-discard')assert.equal(response.engine.action.type,'dahai');
        if(name.includes('qualified')||name==='riichi-accepted-ron')assert.equal(response.engine.action.type,'hora');
      }
    }
    const a=fixtures()[0],b=fixtures()[19];const first=await infer(a.request);await infer(b.request);assert.deepEqual(await infer(a.request),first);
    const announcementChecks=[];
    const reached=situation([draw(0,'9p'),drop(0,'9p',{riichi:true,tsumogiri:true}),draw(1,'?',{riichiSuccess:{seat:0,score:24000,sticks:1,failed:false}})],hand.map((t,i)=>['1m','2m','3m','1p','2p','3p','1s','2s','3s','1z','1z','1z','2z'][i]),0).request;
    reached.events.pop();
    const kan=structuredClone(keyCases.find(([name])=>name==='ankan-replacement')[1].request);kan.events.pop();
    for(const [name,request] of [['trailing-reach-accepted',reached],['trailing-dora',kan]]){
      await assert.rejects(r.infer(request),{code:'UNSUPPORTED_TRAILING_ANNOUNCEMENT'});
      assert.equal(r.pid,pid);await infer(a.request);announcementChecks.push({name,status:'explicitly-rejected',workerPreserved:true});
    }
    let workingSetBytes=null;
    if(process.platform==='win32'){
      const usage=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${pid}).WorkingSet64`],{encoding:'utf8',windowsHide:true,timeout:10000});
      if(usage.status===0&&/^\d+$/.test(usage.stdout.trim()))workingSetBytes=Number(usage.stdout.trim());
    }
    const sorted=[...latency].sort((a,b)=>a-b);
    const result={format:'mortal-real-validation-v1',at:new Date().toISOString(),identity:r.identity,cpu:os.cpus()[0].model,memoryBytes:os.totalmem(),coldMs,
      hotRequests:records.length,distinctRequests:new Set(fixtures().map(c=>JSON.stringify(c.request))).size,p50Ms:sorted[49],p95Ms:sorted[94],maxMs:sorted.at(-1),timeouts:0,accepted:records.length,
      requestIsolation:'A-B-A identical; four seats; same worker PID',workingSetBytes,announcementChecks,keys,records};
    await fs.writeFile(path.join(dir,'real-validation.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({...result,records:undefined}));
  }finally{await service.close();}
}
module.exports={situation,fixtures,keyFixtures};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
