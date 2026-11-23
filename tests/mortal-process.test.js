'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createMortalRunner, validateIdentity } = require('../agent/mortal-process.cjs');
const { sampleRequest } = require('../agent/akagi-local.cjs');
const source = require('../agent/mortal-source.json');
const runner = (mode, extra = {}) => createMortalRunner({ command: process.execPath, args: [path.join(__dirname, 'fixtures/mortal-worker.cjs'), mode], startupMs: 5000, restartLimit: 0, ...extra });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
test('persistent protocol validates provenance and reuses one process across fresh requests', async t => {
  const r = runner('valid'); t.after(() => r.close());
  await r.start(); const pid = r.pid;
  assert.equal(r.identity.model, source.model);
  for (let i=0;i<4;i++) assert.equal((await r.infer(sampleRequest())).action.pai,'C');
  assert.equal(r.pid,pid); await r.close(); assert.equal(alive(pid),false);
});
for (const [mode,code] of [['crash','WORKER_EXIT'],['hang','TIMEOUT'],['wrong-id','PROTOCOL_MISMATCH'],['malformed','INVALID_OUTPUT'],['oversized','OUTPUT_LIMIT']]) {
  test('persistent protocol cleans process after '+mode, async t => {
    const r=runner(mode,{timeoutMs:mode==='hang'?80:5000}); t.after(()=>r.close()); await r.start(); const pid=r.pid;
    await assert.rejects(r.infer(sampleRequest()),{code}); assert.equal(r.ready,false); assert.equal(alive(pid),false);
  });
}
test('persistent cancellation cleans before rejecting and never accepts concurrent or pre-ready requests',async t=>{
  const r=runner('hang'); t.after(()=>r.close());
  await assert.rejects(r.infer(sampleRequest()),{code:'UNAVAILABLE'});
  await r.start();const pid=r.pid,controller=new AbortController();
  const waiting=r.infer(sampleRequest(),{signal:controller.signal});
  await assert.rejects(r.infer(sampleRequest()),{code:'BUSY'});
  controller.abort();await assert.rejects(waiting,{name:'AbortError'}); assert.equal(alive(pid),false);
});
test('known identity rejects missing or wrong model, revision, checkpoint and runtime',()=>{
  const good={model:source.model,sourceCommit:source.sourceCommit,modelRevision:source.modelRevision,checkpoint:source.files[0].sha256,runtime:'win64-py3119-torch270cpu-np1262-'+source.native.sha256.slice(0,16)};
  assert.deepEqual(validateIdentity(good),good);
  for(const key of Object.keys(good)) assert.throws(()=>validateIdentity({...good,[key]:'wrong'}),{code:'IDENTITY_MISMATCH'});
  assert.throws(()=>validateIdentity({...good,runtime:'win64-py3119-torch270cpu-np1262-0000000000000000'}),{code:'IDENTITY_MISMATCH'});
});
async function ready(r,timeout=5000){const until=Date.now()+timeout;while(!r.ready&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(r.ready,true);}
test('successful inference resets recovery budget so later independent crashes can recover',async t=>{
  const r=runner('valid',{restartLimit:1});t.after(()=>r.close());await r.start();
  for(let n=0;n<4;n++){
    await r.infer(sampleRequest());const old=r.pid;process.kill(old,'SIGKILL');
    // Wait until close invalidates old identity, then wait for the bounded restart.
    const end=Date.now()+3000;while(r.pid===old&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));
    await ready(r);assert.notEqual(r.pid,old);assert.equal(alive(old),false);
  }
});
test('continuous startup crashes stop after exactly the configured retries and all workers exit',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mj-mortal-retry-'));
  const log=path.join(dir,'starts.txt');
  const r=runner('boot-crash',{restartLimit:2,args:[path.join(__dirname,'fixtures/mortal-worker.cjs'),'boot-crash',log]});
  t.after(async()=>{await r.close();await fs.rm(dir,{recursive:true,force:true});});
  const launches=async()=>{try{return (await fs.readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(Number);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
  await assert.rejects(r.start(),{code:'WORKER_EXIT'});
  // Observe all three real launches and their cleanup, rather than assuming
  // process startup/Windows taskkill complete within a fixed two-second sleep.
  const deadline=Date.now()+15000;
  let pids=[];
  while(Date.now()<deadline){
    pids=await launches();
    assert.ok(pids.length<=3,'restart budget exceeded');
    if(pids.length===3&&r.pid===undefined&&pids.every(pid=>!alive(pid)))break;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(pids.length,3,'initial launch plus exactly two retries');
  assert.equal(r.pid,undefined);assert.equal(r.ready,false);
  assert.ok(pids.every(pid=>!alive(pid)),'all attempted workers must exit');
  // A forbidden third retry would be scheduled after 250 * 2**2 ms.
  await new Promise(resolve=>setTimeout(resolve,1250));
  assert.deepEqual(await launches(),pids,'no further launch after the retry budget');
  assert.equal(r.pid,undefined);assert.equal(r.ready,false);
});
