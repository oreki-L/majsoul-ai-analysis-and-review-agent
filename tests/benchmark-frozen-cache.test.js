'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {compileSuite,stableHash}=require('../benchmark/core.cjs');
const Runner=require('../benchmark/runner.cjs'),{createTransport}=require('../benchmark/transport.cjs');
function baselineRunner(folder){const dir=path.resolve(__dirname,'../benchmark');let source=fs.readFileSync(path.join(dir,'runner.cjs'),'utf8');source=source.replace(/\s*\/\* FROZEN_CACHE_GC_START \*\/[\s\S]*?\/\* FROZEN_CACHE_GC_END \*\//,'');source=source.replace(/require\((['"])(\.{1,2}\/[^'"]+)\1\)/g,(_m,_q,file)=>'require('+JSON.stringify(path.resolve(dir,file))+')').replaceAll('__dirname',JSON.stringify(dir));const file=path.join(folder,'baseline-runner.cjs');fs.writeFileSync(file,source);return require(file);}
function recording(messages){return options=>{const transport=createTransport(options),run=transport.runModel;transport.runModel=args=>{messages.push({id:args.meta.requestId,role:args.meta.role,messages:JSON.stringify(args.messages)});return run(args);};return transport;};}

test('frozen cache GC preserves all43 production B main/QA bytes, final histories and completed resume while reducing checkpoint size',async t=>{
 const campaign=path.resolve(__dirname,'../research/evidence/context-optimization-20261026/campaign'),suiteFile=path.join(campaign,'suite.realtime.proposed.json');if(!fs.existsSync(suiteFile)){t.skip('Private43 campaign fixture unavailable');return;}
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'frozen-gc43-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const raw=JSON.parse(fs.readFileSync(suiteFile,'utf8'));raw.schemes=[raw.schemes.find(s=>s.id==='rt-B')];Object.assign(raw.schemes[0].context.options,{requiresSourceFreeze:false,requiresBranchSourceFreeze:false});
 const suite=compileSuite(raw,{baseDir:campaign}),baseline=baselineRunner(folder),beforeMessages=[],afterMessages=[];
 assert.equal(suite.dataset.rounds.flatMap(r=>r.decisions).length,43);assert.equal(suite.dataset.rounds.flatMap(r=>r.decisions).reduce((n,d)=>n+d.followups.length,0),86);
 const beforePath=path.join(folder,'before','checkpoint.json'),afterPath=path.join(folder,'after','checkpoint.json');
 const before=await baseline.runSuite(suite,{checkpoint:beforePath,mode:'mock',transportFactory:recording(beforeMessages)});
 const after=await Runner.runSuite(suite,{checkpoint:afterPath,mode:'mock',transportFactory:recording(afterMessages)});
 assert.equal(beforeMessages.length,129);assert.deepEqual(afterMessages,beforeMessages);assert.equal(stableHash(after.histories),stableHash(before.histories));assert.equal(stableHash(after.branches),stableHash(before.branches));assert.ok(after.results.every(r=>r.status==='success'));
 assert.equal(Object.keys(before.frozen).length,43);assert.equal(Object.keys(after.frozen).length,0);
 const beforeBytes=fs.statSync(beforePath).size,afterBytes=fs.statSync(afterPath).size;assert.ok(afterBytes<beforeBytes*.65);
 const resumed=await Runner.runSuite(suite,{checkpoint:afterPath,resume:true,mode:'mock',transportFactory:()=>{throw Error('No completed request may replay');}});assert.equal(stableHash(resumed.histories),stableHash(after.histories));assert.equal(stableHash(resumed.branches),stableHash(after.branches));
 // A legacy-shaped completed checkpoint under this fingerprint is read without needing cached bodies.
 fs.writeFileSync(afterPath,JSON.stringify({...after,frozen:before.frozen}));const legacy=await Runner.runSuite(suite,{checkpoint:afterPath,resume:true,mode:'mock',transportFactory:()=>{throw Error('No legacy completed request may replay');}});assert.equal(Object.keys(legacy.frozen).length,0);assert.equal(stableHash(legacy.histories),stableHash(after.histories));
 t.diagnostic(JSON.stringify({nodes:43,questions:86,byteIdenticalRequests:129,beforeBytes,afterBytes,reduction:1-afterBytes/beforeBytes,legacyAndCurrentResume:true}));
});

test('interrupted question sequence retains frozen array and resumes against original prefix without future history',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'frozen-gc-interrupted-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const suite=compileSuite(path.resolve(__dirname,'../benchmark/examples/suite.mock.json'));suite.schemes=[suite.schemes[0]];suite.dataset.rounds=[suite.dataset.rounds[0]];const round=suite.dataset.rounds[0];round.globalTasks=[];round.decisions=round.decisions.slice(0,2);for(const node of round.decisions)node.followups=[{id:node.id+'.q1',question:'why1'},{id:node.id+'.q2',question:'why2'}];
 const baseline=baselineRunner(folder),checkpoint=path.join(folder,'checkpoint.json'),messages=[];const full=await baseline.runSuite(suite,{checkpoint,mode:'mock',transportFactory:recording(messages)});
 const last=round.decisions[1],key='0:'+encodeURIComponent(suite.schemes[0].id),id=key+':'+encodeURIComponent(last.id)+':main',qid=key+':'+encodeURIComponent(last.id)+':branch:'+encodeURIComponent(last.followups[1].id);
 const partial=structuredClone(full);partial.results=partial.results.filter(r=>r.id!==qid);delete partial.requests[qid];partial.branches[key+':'+encodeURIComponent(last.id)].pop();partial.status='running';
 // Rebase completed earlier-node cache exactly as GC would; unfinished node keeps its original array.
 for(const frozenId of Object.keys(partial.frozen))if(frozenId!==id)delete partial.frozen[frozenId];fs.writeFileSync(checkpoint,JSON.stringify(partial));
 const resumedMessages=[];const resumed=await Runner.runSuite(suite,{checkpoint,resume:true,mode:'mock',transportFactory:recording(resumedMessages)});
 assert.equal(resumedMessages.length,1);assert.equal(resumedMessages[0].id,qid);assert.equal(resumedMessages[0].messages,messages.find(m=>m.id===qid).messages);assert.equal(Object.keys(resumed.frozen).length,0);assert.equal(stableHash(resumed.histories),stableHash(full.histories));assert.equal(stableHash(resumed.branches),stableHash(full.branches));
});
