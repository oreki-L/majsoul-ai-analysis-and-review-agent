'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createLedger,createSharedLedger,normalizeUsage,deriveTrustedLiabilityContracts}=require('../benchmark/accounting.cjs');
const {stableHash}=require('../benchmark/core.cjs');
const rates={cachedInput:.04,uncachedInput:2,output:8,unit:'perMillion'}, contractHash='a'.repeat(64);
const models={flash:{provider:'openai-compatible',endpoint:'https://provider.invalid/chat/completions',model:'deepseek-flash',maxTokens:4096,liabilityBound:{inputTokens:1048576,outputTokens:4096,contractHash},rates:{...rates,currency:'CNY'}}};
const trustedLiabilityContracts=deriveTrustedLiabilityContracts(models), meta={modelId:'flash',modelVersion:'deepseek-flash',endpoint:models.flash.endpoint,requestId:'same-logical-id'};
const usage=normalizeUsage({prompt_tokens:1000,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:1000,completion_tokens:100});
function hold(snapshot,index=1,changes={}){return {recordIndex:index,recordHash:stableHash(snapshot.records[index]),contractHash,amount:2.12992,currency:'CNY',approved:true,reviewId:'explicit-independent-audit-v1',...changes};}
function fixture(cap=50){const ledger=createLedger({cap,currency:'CNY',trustedLiabilityContracts});let id=ledger.reserve({inputTokens:1048576,maxOutputTokens:4096,rates,meta});ledger.settle(id,usage);id=ledger.reserve({inputTokens:10000,maxOutputTokens:4096,rates,meta});ledger.settle(id,null);return ledger;}
test('reviewed full-context holds unblock only budget exposure while raw billing remains unknown',()=>{
 const ledger=fixture(),before=ledger.snapshot(),raw=stableHash(before.records);
 assert.equal(before.unboundedBudgetExposure,true);assert.equal(before.billingUnknownLiability,true);assert.throws(()=>ledger.reserve({inputTokens:1,maxOutputTokens:1,rates}),/liability/);
 ledger.addConservativeHold(hold(before));const s=ledger.snapshot();assert.equal(s.records.length,2);assert.equal(stableHash(s.records),raw);assert.equal(s.records[1].cost,null);assert.equal(s.records[1].usage,null);assert.equal(s.estimatedCost,.0028);assert.equal(s.confirmedUsageEstimate,.0028);assert.equal(s.conservativeUnknownHoldTotal,2.12992);assert.equal(s.budgetCommitted,.0028+2.12992);assert.equal(s.billingUnknownLiability,true);assert.equal(s.unboundedBudgetExposure,false);assert.equal(s.unknownLiability,false);assert.equal(s.unknownLiabilitySemantics,'unbounded-budget-exposure-v1');
 const id=ledger.reserve({inputTokens:1048576,maxOutputTokens:4096,rates,meta});ledger.settle(id,usage);assert.equal(ledger.snapshot().estimatedCost,.0056);assert.equal(ledger.snapshot().conservativeUnknownHoldTotal,2.12992);assert.equal(ledger.snapshot().records.length,3);
});
test('holds reject weak byte bounds, duplicates, tampering and unrelated model/contract/rates',()=>{
 const ledger=fixture(),s=ledger.snapshot();
 for(const bad of [hold(s,1,{amount:s.records[1].amount}),hold(s,1,{amount:2.129919999}),hold(s,1,{recordHash:'b'.repeat(64)}),hold(s,1,{contractHash:'b'.repeat(64)}),hold(s,1,{recordIndex:0}),hold(s,1,{approved:false}),hold(s,1,{reviewId:''}),hold(s,1,{currency:'USD'}),hold(s,1,{amount:Infinity})])assert.throws(()=>ledger.addConservativeHold(bad),/hold/);
 assert.equal(ledger.snapshot().conservativeHolds.length,0);ledger.addConservativeHold(hold(s));assert.throws(()=>ledger.addConservativeHold(hold(s)),/duplicate/);assert.equal(ledger.snapshot().conservativeHolds.length,1);
 const wrong=structuredClone(s);wrong.records[1].meta.modelVersion='other-model';wrong.conservativeHolds=[hold(wrong)];assert.throws(()=>createLedger({cap:50,currency:'CNY',initial:wrong,trustedLiabilityContracts}),/hold/);
 const noScope=structuredClone(s);delete noScope.records[1].meta.modelId;noScope.conservativeHolds=[hold(noScope)];assert.throws(()=>createLedger({cap:50,currency:'CNY',initial:noScope,trustedLiabilityContracts}),/hold/);
 const lower=structuredClone(trustedLiabilityContracts);lower[0].rates.output=1;const withHold={...s,conservativeHolds:[hold(s)]};assert.throws(()=>createLedger({cap:50,currency:'CNY',initial:withHold,trustedLiabilityContracts:lower}),/contract/);
});
test('unique record occurrence covers repeated logical IDs separately and unknown new attempts stop admission',()=>{
 const ledger=fixture();const first=ledger.snapshot();ledger.addConservativeHold(hold(first));const id=ledger.reserve({inputTokens:1048576,maxOutputTokens:4096,rates,meta});ledger.settle(id,null);const s=ledger.snapshot();assert.equal(s.records[1].meta.requestId,s.records[2].meta.requestId);assert.equal(s.unboundedBudgetExposure,true);assert.equal(s.conservativeUnknownHoldTotal,2.12992);assert.throws(()=>ledger.reserve({inputTokens:1,maxOutputTokens:1,rates}),/liability/);ledger.addConservativeHold(hold(s,2));assert.equal(ledger.snapshot().unboundedBudgetExposure,false);assert.equal(ledger.snapshot().conservativeUnknownHoldTotal,4.25984);assert.equal(ledger.snapshot().billingUnknownLiability,true);
});
test('shared hold survives every reopen without counting as HTTP and cannot be trusted by self declaration',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ledger-holds-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const filename=path.join(dir,'budget.json');const original=fixture().snapshot();fs.writeFileSync(filename,JSON.stringify(original));
 const open=()=>createSharedLedger({filename,cap:50,currency:'CNY',trustedLiabilityContracts});let ledger=open();ledger.addConservativeHold(hold(original));ledger.close();
 for(let n=0;n<3;n++){ledger=open();const s=ledger.snapshot();assert.equal(s.records.length,2);assert.equal(s.conservativeHolds.length,1);assert.equal(s.estimatedCost,.0028);assert.equal(s.conservativeUnknownHoldTotal,2.12992);assert.equal(s.billingUnknownLiability,true);assert.equal(s.unknownLiability,false);ledger.close();}
 const bytes=fs.readFileSync(filename,'utf8');assert.throws(()=>createSharedLedger({filename,cap:50,currency:'CNY'}),/untrusted/);assert.equal(fs.readFileSync(filename,'utf8'),bytes);
});
test('near-cap commitments include held unknown and all concurrent live reservations',()=>{
 const ledger=fixture(6.4);ledger.addConservativeHold(hold(ledger.snapshot()));const ids=[1,2].map(()=>ledger.reserve({inputTokens:1048576,maxOutputTokens:4096,rates,meta}));const s=ledger.snapshot();assert.equal(s.reservationCount,2);assert.equal(s.reserved,4.25984);assert.ok(s.budgetCommitted<6.4);assert.throws(()=>ledger.reserve({inputTokens:1048576,maxOutputTokens:4096,rates,meta}),/cap/);ledger.settle(ids[0],usage);ledger.release(ids[1]);assert.equal(ledger.snapshot().reserved,0);assert.equal(ledger.snapshot().estimatedCost,.0056);assert.equal(ledger.snapshot().conservativeUnknownHoldTotal,2.12992);
});
test('restored pending and overflow remain unbounded even if all null-cost records have holds',()=>{
 const ledger=fixture();ledger.addConservativeHold(hold(ledger.snapshot()));const s=ledger.snapshot();const pending={...s,reserved:2.12992,reservationCount:1};const restored=createLedger({cap:50,currency:'CNY',initial:pending,trustedLiabilityContracts});assert.equal(restored.snapshot().unboundedBudgetExposure,true);assert.throws(()=>restored.reserve({inputTokens:1,maxOutputTokens:1,rates}),/liability/);
 const small=fixture(3);assert.throws(()=>small.addConservativeHold(hold(s,1,{amount:4})),/cap/);assert.equal(small.snapshot().conservativeHolds.length,0);
});


test('near-cap summary cannot spend held exposure plus the next full-context foreground reservation',async()=>{
 const {createTransport}=require('../benchmark/transport.cjs');const ledger=fixture(4.5);ledger.addConservativeHold(hold(ledger.snapshot()));let dispatched=0;
 const tr=createTransport({mode:'real',ledger,model:{...models.flash,credentialAlias:'fake'},credentialResolver:async()=> 'local-fake-key',beforeRequest:({meta,ledger:s})=>{if(meta.role==='summary'&&s.budgetCommitted+2.12992>4.5){const error=new Error('foreground capacity');error.code='BENCHMARK_ADMISSION_DENIED';throw error;}},fetch:async()=>{dispatched++;return{ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:'done'}}],usage:{prompt_tokens:1000,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:1000,completion_tokens:100}})};}});
 await assert.rejects(tr.request({messages:[{role:'user',content:'summary'}],meta:{role:'summary'}}),e=>e.code==='BENCHMARK_ADMISSION_DENIED');assert.equal(dispatched,0);assert.equal(ledger.snapshot().blockedReason,null);assert.equal(ledger.snapshot().reserved,0);
 const answer=await tr.request({messages:[{role:'user',content:'foreground'}],meta:{role:'initial'}});assert.equal(answer.text,'done');assert.equal(dispatched,1);assert.equal(ledger.snapshot().billingUnknownLiability,true);assert.equal(ledger.snapshot().unboundedBudgetExposure,false);
});

test('runner foreground reserve uses documented full context and peak rates instead of short prompt bytes',async t=>{
 const {compileSuite}=require('../benchmark/core.cjs'),{runSuite}=require('../benchmark/runner.cjs');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'foreground-fullcontract-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const raw=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../benchmark/examples/suite.mock.json'),'utf8'));raw.schemes=[raw.schemes[0]];
 raw.models.synthetic={...models.flash,rates:{cachedInput:.01,uncachedInput:.5,output:2,currency:'CNY'},pricingSchedule:{timezone:'Asia/Shanghai',currency:'CNY',holidays:[],holidaysVerified:false,peak:{cachedInput:.04,uncachedInput:2,output:8},offPeak:{cachedInput:.01,uncachedInput:.5,output:2}}};
 const suite=compileSuite(raw,{baseDir:path.resolve(__dirname,'../benchmark/examples')});suite.dataset.rounds=[suite.dataset.rounds[0]];suite.dataset.rounds[0].globalTasks=[];suite.dataset.rounds[0].decisions=[suite.dataset.rounds[0].decisions[0]];suite.dataset.rounds[0].decisions[0].followups=[];
 const state=await runSuite(suite,{checkpoint:path.join(folder,'checkpoint.json'),mode:'mock'});assert.equal(state.foregroundReserve,2.12992);assert.equal(state.results[0].status,'success');
});
