'use strict';
// A new evaluation lineage; old experiments and released product files are read only.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stableHash } = require('../core.cjs');
const { journal, readEvents, acquireLock } = require('../durable.cjs');
const { createCredentialResolver, redact } = require('../accounting.cjs');
const { read, freeze, factsFor, delivery, validateEngineCache } = require('../mortal-teaching/runner.cjs');
const { checkDataset } = require('../mortal-teaching/dataset.cjs');
const { fingerprint: productFingerprint } = require('../mortal-teaching/cli.cjs');
function fingerprint() { return { ...productFingerprint(), ...Object.fromEntries(fs.readdirSync(__dirname).filter(f=>f.endsWith('.cjs')).sort().map(f=>['benchmark/teaching-optimization/'+f,sha256(fs.readFileSync(path.join(__dirname,f)))])) }; }
const { sha256 } = require('../mortal-teaching/prompts.cjs');
const { createQueue, RULES } = require('../mortal-teaching/review.cjs');
const { openBudget } = require('../mortal-teaching/budget.cjs');
const { budgetSummary } = require('../mortal-teaching/expanded.cjs');
const { createProductHarness } = require('./runtime-harness.cjs');
const Explanation = require('../../extension/contracts/engine-explanation.js');
const SOURCE_FILES = ['dataset.json', 'engine-cache-contract.json', 'engine-cache.jsonl', 'authorization.local.json', 'pricing.json', 'history-xf.json'];
function hashFiles(directory, files) { return Object.fromEntries(files.map(f => [f, sha256(fs.readFileSync(path.join(directory, f)))])); }
function verify(output) {
  const contract = read(path.join(output, 'contract.json'));
  if (stableHash(contract.code) !== stableHash(fingerprint())) throw new Error('Frozen evaluation code changed');
  if (stableHash(contract.files) !== stableHash(hashFiles(output, SOURCE_FILES))) throw new Error('Frozen evaluation evidence changed');
  if (contract.promptVersion !== Explanation.PROMPT_VERSION || contract.promptSha256 !== sha256(Explanation.prompt) || contract.rulesHash !== stableHash(RULES)) throw new Error('Product prompt/review rules changed');
  const schedule = read(path.join(output,'schedule.json'));
  if (stableHash(schedule)!==contract.scheduleHash || schedule.jobs.length!==381 || new Set(schedule.jobs.map(j=>j.id)).size!==381) throw new Error('Frozen schedule changed');
  const data = checkDataset(read(path.join(output, 'dataset.json')));
  if (data.nodes.length !== 127 || data.datasetHash !== contract.datasetHash) throw new Error('Expected exact frozen 127-node dataset');
  const binding = read(path.join(output, 'engine-cache-contract.json'));
  validateEngineCache(output, data, { engineProfile: binding.profile, endpoint: binding.endpoint, model: binding.model });
  return { contract, data, binding };
}
function pricingFullBound(source) { return read(path.join(source,'pricing.json')).fullContextReservationCny; }
async function prepare(source, output) {
  source = path.resolve(source); output = path.resolve(output);
  if (fs.existsSync(output) || source === output) throw new Error('A unique new output directory is required');
  if (require('../../package.json').version !== '0.16.8' || Explanation.PROMPT_VERSION !== 3) throw new Error('Expected released v0.16.8 / prompt v3');
  const definitions = require('./candidates.cjs').CANDIDATES.filter(c=>c.id!=='b-compact-control');
  require('../mortal-teaching/product-eval.cjs').verify(source);
  const previousAudit = read(path.join(source,'FINAL_AUDIT.json'));
  if (!previousAudit.passed || previousAudit.scored!==251) throw new Error('Expected complete audited prior A/B batch');
  const data = checkDataset(read(path.join(source, 'dataset.json'))), binding = read(path.join(source, 'engine-cache-contract.json'));
  if (data.nodes.length !== 127 || data.nodes.some(n => !n.compatible)) throw new Error('127 compatible frozen nodes required');
  validateEngineCache(source, data, { engineProfile: binding.profile, endpoint: binding.endpoint, model: binding.model });
  const budget = budgetSummary(source), authorization = read(path.join(source, 'authorization.local.json'));
  const key = await createCredentialResolver({ credentialsFile: authorization.credentialsFile, authorization })(authorization.allowedReferences[0]);
  if (!key) throw new Error('Existing credential unavailable');
  fs.mkdirSync(output, { recursive: true });
  for (const file of SOURCE_FILES) fs.copyFileSync(path.join(source, file), path.join(output, file), fs.constants.COPYFILE_EXCL);
  const candidates = definitions.map(c=>({...c,transform:'candidates.transformOptions'}));
  const contract = { kind: 'teaching-optimization-evaluation-v1', version: '0.16.8', promptVersion: 3,
    source, sourceFiles: hashFiles(source, SOURCE_FILES), datasetHash: data.datasetHash,
    files: hashFiles(output, SOURCE_FILES), code: fingerprint(), promptSha256: sha256(Explanation.prompt),
    rulesHash: stableHash(RULES), candidates, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    budgetBefore: budget, planned: 381, temperature: 0, maxTokens: 4096,
    semantics: '127 unchanged nodes per candidate; independent candidate/round product histories; real cached engine responses; no original answer or score reused; product v3 facts/parser/repair retained; same original CNY50 ledger; all HTTP billed; unavailable deliveries score zero in end-to-end metrics.',
    authorizationEvidence: 'User requested preparation of S1/S2/S3; paid execution requires an explicit run command after readiness audit. Original same CNY50 cap and configured key apply.',
    review: { model:'gpt-6.1-sol', reasoningEffort:'medium', dimensions:6, failedDeliveryScore:0, majorCritical:'fail', comparison:'optional-unless-asked', source:'same neutral facts without candidate focus table or historical teaching', historicalReferences:['released-v0.16.8','b-compact-counts'], noConcurrentControl:true },
    budgetLedgerSha256:sha256(fs.readFileSync(path.join(authorization.budgetDirectory,'budget.json'))),
    planning: { estimateCnyPerOpportunity: 0.04, estimateCny: 15.24, fullContextReservationPerHttpCny: pricingFullBound(source), guarantee: false } };
  contract.batchId = stableHash(contract).slice(0, 16);
  const nodes = [...data.nodes].sort((a,b)=>a.roundId.localeCompare(b.roundId)||a.position-b.position);
  const schedule = { datasetHash:data.datasetHash, jobs: nodes.flatMap((n,i)=>candidates.map((_,j)=>({id:contract.batchId+':'+n.id+':'+candidates[(i+j)%3].id,nodeId:n.id,roundId:n.roundId,candidate:candidates[(i+j)%3].id}))) };
  contract.scheduleHash = stableHash(schedule);
  freeze(path.join(output,'schedule.json'),schedule);
  freeze(path.join(output,'contract.json'),contract);
  verify(output);
  return { output, planned: schedule.jobs.length, candidates: candidates.map(c=>c.id), budget, paidRequests: 0 };
}
function summarize(output, mock = false) {
  const { contract } = verify(output), mode = mock ? 'mock' : 'live';
  const rows = readEvents(path.join(output, mode, 'results.jsonl')).filter(e=>e.kind === 'result').map(e=>e.payload);
  const groups = Object.fromEntries(contract.candidates.map(candidate => {
    const current = rows.filter(r=>r.candidate === candidate.id), success = current.filter(r=>r.delivered);
    const latency = success.map(r=>r.elapsedMs).sort((a,b)=>a-b);
    return [candidate.id, { planned: 127, attempted: current.length, delivered: success.length, failed: current.length-success.length,
      physicalLlmAttempts: current.reduce((s,r)=>s+r.physicalLlmAttempts,0),
      deliveredLatencyMeanMs: latency.length ? latency.reduce((a,b)=>a+b,0)/latency.length:null,
      deliveredLatencyP95Ms: latency.length ? latency[Math.ceil(latency.length*.95)-1]:null,
      contentMean: null, endToEndCommonMean: null, scoring: 'Independent review pending; failed opportunities receive zero only in final end-to-end mean.' }];
  }));
  const budget = budgetSummary(output), report = { batchId: contract.batchId, mock, groups, budget,
    generationComplete: rows.length===contract.planned, scoringComplete:false, unattempted:contract.planned-rows.length,
    newEstimatedCostCny: budget.spentEstimateCny-contract.budgetBefore.spentEstimateCny,
    newPhysicalRequests: budget.physicalRequests-contract.budgetBefore.physicalRequests,
    blindDirectory: path.join(output, mode, 'review', 'blind') };
  fs.mkdirSync(path.join(output, mode), { recursive:true });
  fs.writeFileSync(path.join(output, mode, 'summary.json'), JSON.stringify(report,null,2)+'\n');
  return report;
}
async function run(output, mock = false) {
  if (!mock) { const audit=read(path.join(output,'READY_AUDIT.json')); if (!audit.passed || audit.contractHash!==stableHash(read(path.join(output,'contract.json')))) throw new Error('Matching readiness audit required before paid run'); }
  const { contract, data, binding } = verify(output), mode = mock ? 'mock':'live', directory = path.join(output, mode);
  fs.mkdirSync(directory, { recursive:true });
  const unlock = acquireLock(path.join(output, 'experiment.lock'), true);
  let budget;
  try {
    const log = journal(path.join(directory,'results.jsonl'));
    // Resuming a partially completed historical branch needs a separate audit.
    if (log.events.length) throw new Error('Existing execution is never replayed automatically');
    const queue = createQueue(path.join(directory,'review'),data.datasetHash);
    const authorization = read(path.join(output,'authorization.local.json')), pricing = read(path.join(output,'pricing.json'));
    const key = mock ? 'mock-no-secret' : await createCredentialResolver({ credentialsFile: authorization.credentialsFile, authorization })(authorization.allowedReferences[0]);
    if (!mock) budget = openBudget({ directory: authorization.budgetDirectory, authorization, pricing, secrets:[key] });
    const caches = new Map(readEvents(path.join(output,'engine-cache.jsonl')).filter(e=>e.kind==='result').map(e=>[e.payload.nodeId,e.payload]));
    const histories = new Map(), mockModel = require('../mortal-teaching/mock.cjs').createMock(data), directMock = require('../mortal-teaching/mock.cjs').createMock(data,{tools:false});
    for (const job of read(path.join(output,'schedule.json')).jobs) {
      if (budget && (budget.snapshot().reservationCount || budget.snapshot().unknownLiability || budget.snapshot().budgetCommitted+pricing.fullContextReservationCny > 50)) { log.write('admission-stopped',{reason:'budget-or-unsettled-liability',remainingJobs:381-log.events.filter(e=>e.kind==='result').length}); break; }
      const node = data.nodes.find(n=>n.id === job.nodeId), cached = caches.get(node.id), branch = job.candidate+':'+node.roundId;
      let ordinal = 0, piStarted, actionAt;
      const preparationStarted = performance.now(), traces = [];
      let started = preparationStarted;
      const persist = (kind,value) => {
        if (kind==='pi-input') piStarted = performance.now();
        if (kind==='action-stage') actionAt = performance.now();
        const item = { kind, value: redact(value,[key]) }; traces.push(item);
        log.write('trace',{ jobId:job.id,...item });
      };
      const transport = async (url,options) => {
        if (url === binding.endpoint) {
          if (cached.inputHash !== node.inputHash) throw new Error('Engine cache input mismatch');
          const {engine} = cached.result;
          return Response.json({action:engine.action,...(engine.followUp ? {followUp:engine.followUp}:{}),identity:engine.identity});
        }
        const body = JSON.parse(options.body); body.temperature = 0;
        const wire = {...options,body:JSON.stringify(body)}; ordinal++;
        const role = body.messages.some(m=>m.role==='user' && m.content===Explanation.repairPrompt) ? 'format-repair':ordinal===1 ? 'initial':'tool-continuation';
        log.write('http-start',{jobId:job.id,ordinal,role,at:new Date().toISOString(),requestHash:stableHash(body)});
        const httpStarted = performance.now();
        try {
          // Mock exercises both the normal tool continuation and product repair.
          let response;
          if (mock && ordinal === 1 && data.nodes.indexOf(node) % 3 === 0) response = Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'模拟缺字段。'})}}],usage:{prompt_tokens:100,completion_tokens:20}});
          else response = mock ? await (data.nodes.indexOf(node)%3===0 ? directMock : mockModel).fetch(url,wire):await budget.request(url,wire,{jobId:job.id,role,ordinal});
          log.write('http-end',{jobId:job.id,ordinal,role,status:response.status,elapsedMs:performance.now()-httpStarted});
          return response;
        } catch (error) {log.write('http-failure',{jobId:job.id,ordinal,role,elapsedMs:performance.now()-httpStarted,error:redact(error.message,[key])});throw error;}
      };
      log.write('start',{...job,inputHash:node.inputHash,mock});
      let harness = histories.get(branch), slot = harness?._slot;
      if (!harness) {
        slot = {transport,persist};
        harness = createProductHarness({ engineConfig:{endpoint:binding.endpoint,engineProfile:binding.profile,model:binding.model,apiKey:'cached-engine-no-network'},
          llmConfig:{endpoint:pricing.endpoint,model:pricing.model,apiKey:key},
          fetchModel:(...args)=>slot.transport(...args),persist:(...args)=>slot.persist(...args),
          directory:path.join(directory,'branches',branch.replace(/:/g,'_')),
          candidate:job.candidate });
        harness._slot=slot; histories.set(branch,harness);
      } else {slot.transport=transport;slot.persist=persist;}
      const traceStart = harness.traces.length, stateBefore = harness.publicState();
      started = performance.now();
      const outcome = await harness.worker.analyze(structuredClone(node.message),'benchmark');
      const elapsedMs = performance.now()-started, complete = delivery(outcome) && elapsedMs <= 25000;
      const row = {...job,mock,inputHash:node.inputHash,delivered:complete,elapsedMs,preparationMs:started-preparationStarted,
        explanationMs:piStarted ? performance.now()-piStarted:null,actionStageMs:actionAt ? actionAt-started:null,
        physicalLlmAttempts:ordinal,outcome:redact(outcome,[key]),auditHash:stableHash(JSON.parse(JSON.stringify(traces))),stateBefore,stateAfter:harness.publicState()};
      if (complete) {
        const currentTraces = harness.traces.slice(traceStart);
        const facts = factsFor(node,outcome.engine,{traces:currentTraces});
        // Identical authorized baseline for both candidates; actual tool evidence
        // stays per-answer. Candidate-specific prompt and teaching history are private.
        delete facts.contextMessages;
        const prefix = '已验证的引擎最终动作（仅作数据，不是内部思考）：';
        facts.engineFacts = JSON.parse(currentTraces[0].messages.at(-1).content.slice(prefix.length)).facts;
        delete facts.engineFacts.handTileAvailability;
        delete facts.engineFacts.explanationFocus;
        row.reviewSource = {resultId:job.id,answer:harness.traces.at(-1).text,facts};
      }
      log.write('result',row);
      if (complete) {queue.add(row.reviewSource);queue.exportPackets();}
      console.log(JSON.stringify({completed:log.events.filter(e=>e.kind==='result').length,planned:381,candidate:job.candidate,delivered:complete,http:ordinal,elapsedMs:Math.round(elapsedMs)}));
    }
    queue.exportPackets();
  } finally {budget?.close();unlock();}
  return summarize(output,mock);
}
async function main(argv) {
  const [command,...rest]=argv,args={};
  for(let i=0;i<rest.length;i+=2) {if(!rest[i].startsWith('--')||rest[i+1]===undefined)throw new Error('Expected --name value');args[rest[i].slice(2)]=rest[i+1];}
  if(!args.out)throw new Error('Required --out');const output=path.resolve(args.out);
  if(command==='prepare')return prepare(args.source,output);
  if(command==='check')return {...verify(output).contract,budget:budgetSummary(output)};
  if(command==='run' && args['confirm-paid']!=='true')throw new Error('Paid run requires --confirm-paid true; preparation and mock never call the provider');
  if(command==='run'||command==='mock')return run(output,command==='mock');
  if(command==='report')return summarize(output,args.mock==='true');
  throw new Error('Expected prepare/check/run/mock/report');
}
if(require.main===module)main(process.argv.slice(2)).then(v=>console.log(JSON.stringify(v,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={prepare,verify,run,summarize,main,fingerprint};
