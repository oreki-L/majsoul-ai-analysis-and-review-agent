'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {verify}=require('./runtime-eval.cjs');
const {readEvents}=require('../durable.cjs');
const {stableHash}=require('../core.cjs');
const {sha256}=require('../mortal-teaching/prompts.cjs');
const {buildFactCard}=require('../../extension/engine-facts.js');
const {CURRENT,ENGINE}=require('../mortal-teaching/retest-projection.cjs');
function audit(output){
 output=path.resolve(output);const {contract,data}=verify(output),read=f=>JSON.parse(fs.readFileSync(path.join(output,f),'utf8'));
 const schedule=read('schedule.json').jobs,summary=read('mock/summary.json'),events=readEvents(path.join(output,'mock/results.jsonl'));
 assert.equal(summary.mock,true);assert.equal(summary.generationComplete,true);assert.equal(summary.unattempted,0);
 const results=events.filter(e=>e.kind==='result').map(e=>e.payload),traces=events.filter(e=>e.kind==='trace'&&e.payload.kind==='pi-input');
 assert.equal(results.length,381);assert.equal(traces.length,381);assert.equal(new Set(results.map(r=>r.id)).size,381);
 const previous=new Map();for(const j of schedule){const n=data.nodes.find(n=>n.id===j.nodeId);assert.equal(j.roundId,n.roundId);const branch=j.candidate+':'+j.roundId;assert.ok((previous.get(branch)??-1)<n.position);previous.set(branch,n.position);}
 const groups={};for(const {id} of contract.candidates){const rs=results.filter(r=>r.candidate===id),starts=events.filter(e=>e.kind==='http-start'&&rs.some(r=>r.id===e.payload.jobId)).map(e=>e.payload);assert.equal(rs.length,127);assert.ok(rs.every(r=>r.delivered&&r.mock));assert.equal(new Set(rs.map(r=>r.nodeId)).size,127);
 const repair=starts.filter(e=>e.role==='format-repair').length,tools=starts.filter(e=>e.role==='tool-continuation').length;assert.ok(repair>0&&tools>0);groups[id]={planned:127,delivered:127,http:starts.length,formatRepair:repair,toolContinuation:tools};}
 for(const e of traces){const t=e.payload.value,p=JSON.parse(t.messages.at(-1).content.slice(ENGINE.length)),c=JSON.parse(t.messages.at(-2).content.slice(CURRENT.length)),r=results.find(r=>r.id===e.payload.jobId);assert.equal(c.position,data.nodes.find(n=>n.id===r.nodeId).position);const f=structuredClone(p.facts);delete f.handTileAvailability;delete f.explanationFocus;assert.equal(stableHash(f),stableHash(buildFactCard(c.snapshot,p.engine)));assert.ok(t.validateFinal&&t.formatRepairMessage);assert.ok(p.facts.handTileAvailability);assert.equal(!!p.facts.explanationFocus,r.candidate!=='s1-semantics');
  const h=t.messages.slice(0,-2);if(r.candidate==='s3-history-isolation')assert.ok(h.every(m=>typeof m.content!=='string'||!m.content.includes('模拟文本不构成真实教学质量证据')));
 }
 const {createQueue}=require('../mortal-teaching/review.cjs'),jobs=createQueue(path.join(output,'mock/review'),contract.datasetHash).snapshot();assert.equal(jobs.length,381);assert.ok(jobs.every(j=>j.state==='pending'));for(const j of jobs){assert.ok(!Object.hasOwn(j.packet.facts,'contextMessages'));assert.ok(!Object.hasOwn(j.packet.facts.engineFacts,'handTileAvailability'));assert.ok(!Object.hasOwn(j.packet.facts.engineFacts,'explanationFocus'));}
 const auth=read('authorization.local.json');assert.equal(sha256(fs.readFileSync(path.join(auth.budgetDirectory,'budget.json'))),contract.budgetLedgerSha256);assert.equal(summary.newPhysicalRequests,0);assert.equal(summary.newEstimatedCostCny,0);assert.ok(!fs.existsSync(path.join(output,'live')));
 const report={passed:true,checkedAt:new Date().toISOString(),batchId:contract.batchId,contractHash:stableHash(contract),sourceFingerprintVerified:true,groups,planned:381,mockDelivered:381,mockBlindPackets:381,neutralBlindFacts:true,chronologicalPerCandidateRound:true,paidRequestsDuringPreparation:0,newEstimatedCostCny:0,sharedBudgetUnchanged:true,budget:summary.budget,reviewExecution:'gpt-6.1-sol / medium, independent blind review after real generation',note:'Mock quality is not real model quality; original and new candidate facts remain identical after removing the two allowed added views. Paid generation is not started.'};
 fs.writeFileSync(path.join(output,'READY_AUDIT.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));return report;
}
if(require.main===module)audit(process.argv[2]);module.exports={audit};
