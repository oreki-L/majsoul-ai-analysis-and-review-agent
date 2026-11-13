'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Online=require('../benchmark/phase2-summary-online.cjs'),Core=require('../benchmark/core.cjs');
const plan='D:/雀魂插件/research/evidence/realtime-quality-20261031/phase2-planning';
const sourceFile=path.join(plan,'source-preparation/r0-real-source.frozen.json');
const available=fs.existsSync(sourceFile)&&fs.existsSync(path.join(plan,'summary-online-launch-20261101/field-semantics.v3.json'));
const realTest=(name,fn)=>test(name,{skip:!available&&'Local R0 preparation absent'},fn);
function fixture(){const source=JSON.parse(fs.readFileSync(sourceFile));const semantics=JSON.parse(fs.readFileSync(path.join(plan,'summary-online-launch-20261101/field-semantics.v3.json')));return {source,semantics,adapter:Online.createAdapter(source,source.hash,semantics,semantics.legendHash)};}
function input(source,node,policy='C-L',summary=[]){return {node,scheme:{id:policy},options:{policy,sourceMode:'fixed-source-replay'},summary,history:[],channel:'realtime'};}
function ready(d){return {...d,status:'ready',text:JSON.stringify({schemaVersion:1,sourceHash:d.sourceHash,coveredSourceIds:d.coveredSourceIds,facts:[{sourceId:d.source.facts[0].sourceId,position:d.source.facts[0].position,text:'OFFLINE SYNTHETIC source-bound mock; no quality claim'}],opinions:[],limitations:['SYNTHETIC']})};}
realTest('2B never blocks main for an eligible but missing summary and preserves strict R0 prefix',()=>{
 const {source,adapter,semantics}=fixture();let checked=0;
 for(const r of source.dataset.rounds)for(const n of r.decisions)for(const p of Online.POLICIES){const i=input(source,n,p);i.history=[{answerText:'POISON-ONLINE-ANSWER'}];const c=adapter.buildContext(i);assert.equal(c.requireFixedMainSource,undefined);assert.ok(!JSON.stringify(c).includes('POISON-ONLINE-ANSWER'));assert.equal(c.compression.testedLlmSummary,false);
 for(const d of c.summaryJobs){assert.ok(d.watermark<n.position);assert.ok(d.source.facts.every(f=>f.position<=d.watermark));assert.equal(d.source.opinions.length,0);assert.ok(d.messages[0].content.endsWith(semantics.legend));}checked++;}assert.equal(checked,87);
});
realTest('old ready summary is consumed with exact uncovered code tail; invalid/future/cross-round cannot enter',()=>{
 const {source,adapter}=fixture(),r=source.dataset.rounds[0];const contexts=r.decisions.map(n=>adapter.buildContext(input(source,n)));
 const first=contexts.find(c=>c.summaryJobs.length).summaryJobs[0],record=ready(first);
 const index=contexts.findIndex(c=>c.summaryJobs[0]?.watermark>first.watermark);assert.ok(index>=0);
 const n=r.decisions[index],c=adapter.buildContext(input(source,n,'C-L',[record]));
 assert.equal(c.compression.summaryUse,'old-ready-plus-code-tail');assert.equal(c.compression.summaryWatermark,first.watermark);assert.ok(c.compression.codeTailSourceIds.length);assert.ok(c.compression.coveredSourceIds.every(id=>!c.compression.codeTailSourceIds.includes(id)));
 const expected=require('../benchmark/next-stage-context.cjs').stateEntries(n,source.rounds.find(x=>x.id===r.id)).map(e=>e.sourceId);
 assert.deepEqual(new Set([...c.compression.coveredSourceIds,...c.compression.codeTailSourceIds]),new Set(expected));
 const bad=structuredClone(record);bad.text=bad.text.replace(first.sourceHash,'invalid');assert.equal(adapter.buildContext(input(source,n,'C-L',[bad])).compression.testedLlmSummary,false);
 const earlier=r.decisions.find(n=>n.position<=first.watermark);assert.equal(adapter.buildContext(input(source,earlier,'C-L',[record])).compression.testedLlmSummary,false);
 const other=source.dataset.rounds[1].decisions.at(-1);assert.equal(adapter.buildContext(input(source,other,'C-L',[record])).compression.testedLlmSummary,false);
});
realTest('v3 semantics and source must be hash-bound; 2A ready artifact is never a constructor option',()=>{
 const {source,semantics}=fixture();assert.throws(()=>Online.createAdapter(source,source.hash,{...semantics,legend:semantics.legend+'bad'},semantics.legendHash),/v3/);
 const changed=structuredClone(source);changed.entries[0].answerText+='bad';assert.throws(()=>Online.createAdapter(changed,source.hash,semantics,semantics.legendHash),/hash/);
 assert.equal(Core.stableHash(semantics.legend),semantics.legendHash);
});
