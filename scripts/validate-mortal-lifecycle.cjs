'use strict';
// Explicit real-model lifecycle validation, excluded from npm test.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {createMortalRunner}=require('../agent/mortal-process.cjs');
const {runtimeConfig}=require('../agent/mortal-local.cjs');
const {sampleRequest}=require('../agent/mortal-sample.cjs');
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(r){const until=Date.now()+15000;while(!r.ready&&Date.now()<until)await delay(50);assert.equal(r.ready,true);}
async function rejectedServe(dir,python,port,token){
  const child=spawn(process.execPath,[path.join(__dirname,'../agent/mortal-local.cjs'),'serve','--dir',dir,'--python',python,'--port',String(port)],{windowsHide:true,stdio:'ignore',env:{...process.env,MJAI_ENGINE_TOKEN:token}});
  const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  await delay(800);
  const query=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter "ParentProcessId=${child.pid}" | Select-Object -ExpandProperty ProcessId`],{windowsHide:true,encoding:'utf8',timeout:10000});
  const pids=query.stdout.trim().split(/\s+/).filter(s=>/^\d+$/.test(s)).map(Number);
  let timer;try{const status=await Promise.race([completion,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('CLI_EXIT_TIMEOUT')),15000);})]);assert.notEqual(status,0);}
  finally{clearTimeout(timer);if(alive(child.pid))child.kill('SIGKILL');}
  for(const pid of pids)assert.equal(alive(pid),false,'startup worker leak '+pid);
  return pids;
}
async function main(){
  const dir=path.resolve(process.argv[2]||'research/evidence/voidshine-mortal-298k'),python=path.resolve(process.argv[3]||path.join(dir,'python/python.exe'));
  const r=createMortalRunner({...runtimeConfig({dir,python}),timeoutMs:1});const cleaned=[];
  try{
    await r.start();const timed=r.pid;await assert.rejects(r.infer(sampleRequest()),{code:'TIMEOUT'});assert.equal(alive(timed),false);cleaned.push(timed);
    await ready(r);const aborted=r.pid,controller=new AbortController();const waiting=r.infer(sampleRequest(),{signal:controller.signal});controller.abort();await assert.rejects(waiting,{name:'AbortError'});assert.equal(alive(aborted),false);cleaned.push(aborted);
    await ready(r);cleaned.push(r.pid);
  }finally{await r.close();}
  for(const pid of cleaned)assert.equal(alive(pid),false);
  const invalidTokenPids=await rejectedServe(dir,python,0,'invalid\ntoken');
  const occupied=net.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
  let occupiedPortPids;try{occupiedPortPids=await rejectedServe(dir,python,occupied.address().port,'valid-test-token');}finally{await new Promise(resolve=>occupied.close(resolve));}
  const result={at:new Date().toISOString(),realTimeoutAndCancel:true,restartedAndClosed:true,cleanedWorkerPids:cleaned,invalidTokenPids,occupiedPortPids,startupFailuresExited:true};
  await fs.writeFile(path.join(dir,'lifecycle-validation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
