'use strict';
// Explicit opt-in validation with real weights; never part of ordinary test/build.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {fixtures,keyFixtures}=require('./validate-mortal-v4.cjs');
const source=require('../agent/akagi-native-source.json');
const {createAkagiNativeRunner}=require('../agent/akagi-native-process.cjs');
const {createEngineServer}=require('../agent/engine-server.cjs');
const Agent=require('../extension/engine-agent.js');
async function main(){
 const [exe,weights,reference,outDir]=process.argv.slice(2);assert(exe&&weights&&reference&&outDir,'EXE WEIGHTS REFERENCE_EXE OUT_DIR required');
 const samples=fixtures(),keys=keyFixtures();const all=[...samples.map((c,i)=>['sample-'+i,c]),...keys.map(([n,c])=>[n,c])];
 const input=all.map(([name,c])=>JSON.stringify({protocol:source.protocol,requestId:name,seat:c.request.seat,events:c.request.events})).join('\n')+'\n';
 await fs.mkdir(outDir,{recursive:true});await fs.writeFile(path.join(outDir,'reference-input.jsonl'),input);
 const run=(cmd,args)=>{const r=spawnSync(cmd,args,{input,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,timeout:120000});assert.equal(r.status,0,r.stderr);return r.stdout.trim().split('\n').map(x=>JSON.parse(x));};
 const official=run(reference,[weights]),native=run(exe,['--weights',weights,'--audit']);const identity=native.shift().identity;
 assert.equal(native.length,all.length);assert.equal(official.length,all.length);
 const comparisons=[];
 for(let i=0;i<all.length;i++){
  const a=native[i],b=official[i],name=all[i][0];assert.equal(a.type,'result',name+':'+a.code);
  assert.deepEqual(a.audit.observation,b.audit.observation,name+' observation');
  const maxDiff=Math.max(...a.audit.logits.map((x,j)=>Math.abs(x-b.audit.logits[j])));assert(maxDiff<2e-3,name+' logits');
  const maskSame=JSON.stringify(a.audit.mask)===JSON.stringify(b.audit.mask);
  const actionSame=JSON.stringify(a.action)===JSON.stringify(b.action)&&JSON.stringify(a.followUp||null)===JSON.stringify(b.followUp||null);
  comparisons.push({name,observationSame:true,maskSame,maxLogitDiff:maxDiff,actionSame,action:a.action,officialAction:b.action,followUp:a.followUp||null,officialFollowUp:b.followUp||null});
 }
 const runner=createAkagiNativeRunner({command:exe,args:['--weights',weights],identity}),start=performance.now();
 const service=createEngineServer({runner,token:'akagi-native-explicit-validation'});
 try {await runner.start();const coldMs=performance.now()-start;await runner.infer(samples[0].request);
  await new Promise(r=>service.server.listen(0,'127.0.0.1',r));
  const endpoint=`http://127.0.0.1:${service.server.address().port}/analyze`;
  const infer=async request=>{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer akagi-native-explicit-validation'},body:JSON.stringify(request)});assert.equal(r.status,200);return r.json();};
  const timings=[],records=[],pid=runner.pid;
  for(const [i,c] of samples.entries()){const t=performance.now();const result=await Agent.run({...c,infer,expectedProfile:source.profile});timings.push(performance.now()-t);assert.equal(runner.pid,pid);records.push({index:i,seat:c.request.seat,eventCount:c.request.events.length,action:result.engine.action});}
  const keyResults=[];
  for(const [name,c] of keys){const raw=await infer(c.request);try {const result=await Agent.run({...c,infer:async()=>raw,expectedProfile:source.profile});keyResults.push({name,status:'accepted',action:result.engine.action,followUp:result.engine.followUp});}catch(e){keyResults.push({name,status:'rejected',rawAction:raw.action,reason:e.message});}}
  const a=await infer(samples[0].request);await infer(samples[19].request);assert.deepEqual(await infer(samples[0].request),a);
  timings.sort((a,b)=>a-b);
  const report={format:'akagi-native-real-validation-v1',at:new Date().toISOString(),identity,cpu:os.cpus()[0].model,hotRequests:samples.length,distinctRequests:new Set(samples.map(c=>JSON.stringify(c.request))).size,coldMs,p50Ms:timings[49],p95Ms:timings[94],maxMs:timings.at(-1),timeouts:0,accepted:records.length,isolation:'A-B-A; four seats; same PID',comparisons,keyResults,records};
  assert(report.p95Ms<=2000,'p95 budget');await fs.writeFile(path.join(outDir,'real-validation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,comparisons:undefined,keyResults:undefined,records:undefined}));
  console.log(JSON.stringify(keyResults));console.log(JSON.stringify(comparisons.filter(x=>!x.maskSame||!x.actionSame)));
 }finally{await service.close();}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
