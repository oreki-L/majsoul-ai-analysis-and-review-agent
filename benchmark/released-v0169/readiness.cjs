'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {verify}=require('./eval.cjs');
const {readEvents}=require('../durable.cjs');
const {stableHash}=require('../core.cjs');
const {sha256}=require('../mortal-teaching/prompts.cjs');
const {buildFactCard}=require('../../extension/engine-facts.js');
const {CURRENT,ENGINE}=require('../mortal-teaching/retest-projection.cjs');
function audit(output){
 output=path.resolve(output);const {contract,data}=verify(output),read=f=>JSON.parse(fs.readFileSync(path.join(output,f),'utf8'));
 const summary=read('mock/summary.json'),events=readEvents(path.join(output,'mock/results.jsonl'));
 assert.equal(summary.mock,true);assert.equal(summary.generationComplete,true);assert.equal(summary.unattempted,0);
 const results=events.filter(e=>e.kind==='result').map(e=>e.payload),traces=events.filter(e=>e.kind==='trace'&&e.payload.kind==='pi-input');
 assert.equal(results.length,127);assert.equal(traces.length,127);assert.equal(new Set(results.map(r=>r.nodeId)).size,127);
 assert.ok(results.every(r=>r.delivered&&r.mock));
 const previous=new Map();for(const j of read('schedule.json').jobs){const n=data.nodes.find(n=>n.id===j.nodeId);assert.equal(j.roundId,n.roundId);assert.ok((previous.get(j.roundId)??-1)<n.position);previous.set(j.roundId,n.position);}
 let histories=0;for(const e of traces){
  const t=e.payload.value,p=JSON.parse(t.messages.at(-1).content.slice(ENGINE.length)),c=JSON.parse(t.messages.at(-2).content.slice(CURRENT.length)),r=results.find(r=>r.id===e.payload.jobId),n=data.nodes.find(n=>n.id===r.nodeId);
  assert.equal(c.position,n.position);assert.equal(t.promptVersion,4);assert.ok(t.validateFinal&&t.formatRepairMessage);
  assert.equal(stableHash(p.facts),stableHash(buildFactCard(c.snapshot,p.engine,undefined,{events:n.message.context.events.map(ev=>({...ev,position:ev.position??ev.step}))})));
  assert.deepEqual(p.facts.handTileAvailability.columns,['牌','已见','未见上界']);
  const f=r.reviewSource.facts;assert.ok(!f.contextMessages&&!f.engineFacts);assert.deepEqual(f.events,n.message.context.events);
  assert.equal(f.authorizedHistory.length,t.messages.length-2);if(f.authorizedHistory.length)histories++;
  for(const h of f.authorizedHistory){assert.ok(h.sourceHash);for(const a of h.data.advice||[])assert.ok(a.position<n.position);}
 }
 const starts=events.filter(e=>e.kind==='http-start').map(e=>e.payload),repair=starts.filter(e=>e.role==='format-repair').length,tools=starts.filter(e=>e.role==='tool-continuation').length;
 assert.ok(repair>0&&tools>0);
 const {createQueue}=require('../mortal-teaching/review.cjs'),jobs=createQueue(path.join(output,'mock/review'),contract.datasetHash).snapshot();assert.equal(jobs.length,127);assert.ok(jobs.every(j=>j.state==='pending'));
 const auth=read('authorization.local.json');assert.equal(sha256(fs.readFileSync(path.join(auth.budgetDirectory,'budget.json'))),contract.budgetLedgerSha256);assert.equal(summary.newPhysicalRequests,0);assert.equal(summary.newEstimatedCostCny,0);assert.ok(!fs.existsSync(path.join(output,'live')));
 const report={passed:true,checkedAt:new Date().toISOString(),batchId:contract.batchId,contractHash:stableHash(contract),planned:127,mockDelivered:127,mockBlindPackets:127,histories,formatRepairs:repair,toolContinuations:tools,chronologicalPerRound:true,productionFactsUnchanged:true,neutralBlindFacts:true,actualAuthorizedHistoryAndToolsPreserved:true,paidRequestsDuringPreparation:0,sharedBudgetUnchanged:true,budget:summary.budget,reviewExecution:'Independent gpt-6.1-sol / medium after generation',qualityScore:null};
 fs.writeFileSync(path.join(output,'READY_AUDIT.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));return report;
}
if(require.main===module)audit(process.argv[2]);module.exports={audit};
