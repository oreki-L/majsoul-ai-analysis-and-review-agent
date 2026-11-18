'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),d=path.resolve(process.argv[2]);
const {readEvents}=require(path.join(root,'benchmark/durable.cjs'));
const {verify}=require(path.join(root,'benchmark/current-teaching-v5/eval.cjs'));
const c=verify(d).contract;
const auth=JSON.parse(fs.readFileSync(path.join(d,'authorization.local.json')));
const budget=JSON.parse(fs.readFileSync(path.join(auth.budgetDirectory,'budget.json')));
const events=readEvents(path.join(d,'live/results.jsonl'));
const attempts=readEvents(path.join(auth.budgetDirectory,'attempts.jsonl'));
const dispatch=attempts.filter(e=>e.kind==='dispatch'&&e.payload.identity.jobId.startsWith(c.batchId+':'));
const ids=new Set(dispatch.map(e=>e.payload.attemptId));
const responses=attempts.filter(e=>e.kind==='response'&&ids.has(e.payload.attemptId));
const unknown=attempts.filter(e=>e.kind==='unknown'&&ids.has(e.payload.attemptId));
const rows=events.filter(e=>e.kind==='result').map(e=>e.payload);
const groups=Object.fromEntries(c.candidates.map(({id})=>{
 const rs=rows.filter(r=>r.candidate===id),http=events.filter(e=>e.kind==='http-start'&&e.payload.jobId.endsWith(':'+id)),ds=dispatch.filter(e=>e.payload.identity.jobId.endsWith(':'+id)),aids=new Set(ds.map(e=>e.payload.attemptId)),res=responses.filter(e=>aids.has(e.payload.attemptId));
 const latency=rs.filter(r=>r.delivered).map(r=>r.elapsedMs).sort((a,b)=>a-b);
 const outputs=events.filter(e=>e.kind==='trace'&&e.payload.jobId.endsWith(':'+id)&&e.payload.kind==='pi-output');
 return [id,{planned:127,attempted:rs.length,delivered:rs.filter(r=>r.delivered).length,failed:rs.filter(r=>!r.delivered).length,http:ds.length,httpRoles:Object.fromEntries(['initial','format-repair','tool-continuation'].map(role=>[role,http.filter(e=>e.payload.role===role).length])),actualToolCalls:outputs.reduce((s,e)=>s+(Array.isArray(e.payload.value.toolCalls)?e.payload.value.toolCalls.length:Number(e.payload.value.toolCalls)||0),0),actualToolResults:outputs.reduce((s,e)=>s+(e.payload.value.toolResults?.length||0),0),responseModels:[...new Set(res.map(e=>e.payload.body?.model??null))],httpStatusCounts:res.reduce((o,e)=>(o[e.payload.status]=(o[e.payload.status]||0)+1,o),{}),estimatedCostCny:res.reduce((s,e)=>s+(e.payload.estimatedCost||0),0),deliveredLatencyMeanMs:latency.length?latency.reduce((s,x)=>s+x,0)/latency.length:null,deliveredLatencyP95Ms:latency.length?latency[Math.ceil(latency.length*.95)-1]:null}];
}));
const assert=require('node:assert/strict'),Explanation=require(path.join(root,'extension/contracts/engine-explanation.js')),{stableHash}=require(path.join(root,'benchmark/core.cjs'));
const data=JSON.parse(fs.readFileSync(path.join(d,'dataset.json'))),cache=new Map(readEvents(path.join(d,'engine-cache.jsonl')).filter(e=>e.kind==='result').map(e=>[e.payload.nodeId,e.payload]));
let actionMismatches=0,hiddenDraws=0,futureEvents=0,historyAdviceRecords=0;
for(const r of rows){const n=data.nodes.find(n=>n.id===r.nodeId),expected=Explanation.forModel(cache.get(n.id).result.engine),actual=Explanation.forModel(r.outcome.engine);
 if(stableHash(expected.action)!==stableHash(actual.action)||stableHash(expected.followUp??null)!==stableHash(actual.followUp??null))actionMismatches++;
 assert.equal(r.inputHash,n.inputHash);
 if(!r.delivered)continue;
 const f=r.reviewSource.facts;
 for(const e of f.events){if(e.kind==='DealTile'&&e.seat!==n.message.snapshot.selfSeat&&e.tile&&e.tile!=='?')hiddenDraws++;if((e.position??e.step)>n.position)futureEvents++;}
 for(const h of f.authorizedHistory)for(const a of h.data.advice||[]){assert.ok(a.position<n.position);historyAdviceRecords++;}
 assert.equal(stableHash(f.snapshot),stableHash(n.message.snapshot));
}
const blindDir=path.join(d,'live/review/blind');
const report={checkedAt:new Date().toISOString(),batchId:c.batchId,frozenVerifyPassed:true,planned:127,attempted:rows.length,delivered:rows.filter(r=>r.delivered).length,unattempted:127-rows.length,groups,newHttp:dispatch.length,responseCount:responses.length,unknownResponseEvents:unknown.length,newEstimatedCostCny:responses.reduce((s,e)=>s+(e.payload.estimatedCost||0),0),budget:{capCny:budget.cap,spentEstimateCny:budget.estimatedCost,committedCny:budget.budgetCommitted,remainingCny:50-budget.budgetCommitted,reservedCny:budget.reserved,reservationCount:budget.reservationCount,unknownLiability:budget.unknownLiability,billingUnknownLiability:budget.billingUnknownLiability,unknownHoldCny:budget.conservativeUnknownHoldTotal,physicalRequests:budget.records.length},blindPackets:fs.existsSync(blindDir)?fs.readdirSync(blindDir).filter(f=>f.endsWith('.json')).length:0,generationWriterClosed:!fs.existsSync(path.join(d,'experiment.lock')),generationComplete:rows.length===127,scoringComplete:false,noQualityReviewPerformed:true,actionMismatches,hiddenDraws,futureEvents,historyAdviceRecords,denominator:127,qualityScore:null};
let emptyRoundHistories=0,historyContinuityChecks=0;const seen=new Map();
for(const row of rows){if(!seen.has(row.roundId)){assert.deepEqual(row.stateBefore,{});emptyRoundHistories++;}else {assert.equal(stableHash(row.stateBefore),stableHash(seen.get(row.roundId).stateAfter));historyContinuityChecks++;}seen.set(row.roundId,row);
 const http=events.filter(e=>e.kind==='http-start'&&e.payload.jobId===row.id);assert.ok(http.filter(e=>e.payload.role==='format-repair').length<=1);assert.equal(http.length,row.physicalLlmAttempts);if(row.delivered)assert.ok(row.elapsedMs<=25000);}
report.newEmptyRoundHistories=emptyRoundHistories;report.historyContinuityChecks=historyContinuityChecks;report.oneFormatRepairMaximum=true;
if(process.argv.includes('--final')){
 const expected=JSON.parse(fs.readFileSync(path.join(d,'schedule.json'))).jobs.map(j=>j.id);
 report.exactScheduleMatched=rows.length===127&&rows.every((r,i)=>r.id===expected[i])&&new Set(rows.map(r=>r.id)).size===127;
 report.passed=report.exactScheduleMatched&&actionMismatches===0&&hiddenDraws===0&&futureEvents===0&&report.generationWriterClosed&&report.newHttp===report.responseCount&&report.unknownResponseEvents===0&&!budget.reservationCount&&!budget.reserved&&!budget.unknownLiability&&!budget.billingUnknownLiability&&!budget.conservativeUnknownHoldTotal&&report.blindPackets===report.delivered&&emptyRoundHistories===12&&historyContinuityChecks===115;
 assert.equal(report.passed,true);for(const [file,hash] of Object.entries(c.sourceFiles))assert.equal(require('../mortal-teaching/prompts.cjs').sha256(fs.readFileSync(path.join(c.source,file))),hash);
 fs.writeFileSync(path.join(d,'LIVE_AUDIT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const sourceFiles=['contract.json','schedule.json','READY_AUDIT.json','PREFLIGHT_AUDIT.json','LIVE_AUDIT.json','live/results.jsonl','live/review/queue.jsonl'];
 const final={passed:true,at:new Date().toISOString(),batchId:c.batchId,lineage:c.lineage,opportunities:127,attempted:rows.length,delivered:report.delivered,newEmptyRoundHistories:emptyRoundHistories,historyContinuityChecks,oneFormatRepairMaximum:true,originalEvidenceUnchanged:true,generationWriterClosed:report.generationWriterClosed,sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,require('../mortal-teaching/prompts.cjs').sha256(fs.readFileSync(path.join(d,f)))])),contentQualityScored:false,reviewStatus:'Independent parent-managed review pending; no quality scores consumed by generator.'};
 fs.writeFileSync(path.join(d,'GENERATION_FINAL_AUDIT.json'),JSON.stringify(final,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify(report,null,2));
