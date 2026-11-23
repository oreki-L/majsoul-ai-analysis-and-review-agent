'use strict';
// A new evaluation lineage; old experiments and released product files are read only.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stableHash } = require('../core.cjs');
const { journal, readEvents, acquireLock } = require('../durable.cjs');
const { createCredentialResolver, redact } = require('../accounting.cjs');
const { read, freeze, factsFor, delivery, validateEngineCache } = require('./runner.cjs');
const { checkDataset } = require('./dataset.cjs');
const { fingerprint } = require('./cli.cjs');
const { sha256 } = require('./prompts.cjs');
const { createQueue, RULES } = require('./review.cjs');
const { openBudget } = require('./budget.cjs');
const { budgetSummary } = require('./expanded.cjs');
const { createProductHarness } = require('./product-harness.cjs');
const Explanation = require('../../extension/contracts/engine-explanation.js');
const SOURCE_FILES = ['dataset.json', 'engine-cache-contract.json', 'engine-cache.jsonl', 'authorization.local.json', 'pricing.json', 'history-xf.json'];
function hashFiles(directory, files) { return Object.fromEntries(files.map(f => [f, sha256(fs.readFileSync(path.join(directory, f)))])); }
function verify(output) {
  const contract = read(path.join(output, 'contract.json'));
  if (stableHash(contract.code) !== stableHash(fingerprint())) throw new Error('Frozen evaluation code changed');
  if (stableHash(contract.files) !== stableHash(hashFiles(output, SOURCE_FILES))) throw new Error('Frozen evaluation evidence changed');
  if (contract.promptVersion !== Explanation.PROMPT_VERSION || contract.promptSha256 !== sha256(Explanation.prompt) || contract.rulesHash !== stableHash(RULES)) throw new Error('Product prompt/review rules changed');
  const data = checkDataset(read(path.join(output, 'dataset.json')));
  if (data.nodes.length !== 127 || data.datasetHash !== contract.datasetHash) throw new Error('Expected exact frozen 127-node dataset');
  const binding = read(path.join(output, 'engine-cache-contract.json'));
  validateEngineCache(output, data, { engineProfile: binding.profile, endpoint: binding.endpoint, model: binding.model });
  return { contract, data, binding };
}
async function prepare(source, output) {
  source = path.resolve(source); output = path.resolve(output);
  if (fs.existsSync(output) || source === output) throw new Error('A unique new output directory is required');
  if (require('../../package.json').version !== '0.16.8' || Explanation.PROMPT_VERSION !== 3) throw new Error('Expected released v0.16.8 / prompt v3');
  const compact = require('./compact-counts.cjs');
  if (typeof compact.transformOptions !== 'function' || !compact.PROMPT_SUFFIX) throw new Error('Compact candidate is not ready');
  const data = checkDataset(read(path.join(source, 'dataset.json'))), binding = read(path.join(source, 'engine-cache-contract.json'));
  if (data.nodes.length !== 127 || data.nodes.some(n => !n.compatible)) throw new Error('127 compatible frozen nodes required');
  validateEngineCache(source, data, { engineProfile: binding.profile, endpoint: binding.endpoint, model: binding.model });
  const budget = budgetSummary(source), authorization = read(path.join(source, 'authorization.local.json'));
  const key = await createCredentialResolver({ credentialsFile: authorization.credentialsFile, authorization })(authorization.allowedReferences[0]);
  if (!key) throw new Error('Existing credential unavailable');
  fs.mkdirSync(output, { recursive: true });
  for (const file of SOURCE_FILES) fs.copyFileSync(path.join(source, file), path.join(output, file), fs.constants.COPYFILE_EXCL);
  const candidates = [{ id: 'a-release-v0168', transform: null, promptSha256: sha256(Explanation.prompt) },
    { id: 'b-compact-counts', transform: 'compact-counts.transformOptions', suffixSha256: sha256(compact.PROMPT_SUFFIX) }];
  const contract = { kind: 'released-product-evaluation-v1', version: '0.16.8', promptVersion: 3,
    source, sourceFiles: hashFiles(source, SOURCE_FILES), datasetHash: data.datasetHash,
    files: hashFiles(output, SOURCE_FILES), code: fingerprint(), promptSha256: sha256(Explanation.prompt),
    rulesHash: stableHash(RULES), candidates, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    budgetBefore: budget, planned: 254, temperature: 0, maxTokens: 4096,
    semantics: '127 unchanged nodes per candidate; independent candidate/round product histories; real cached engine responses; no original answer or score reused; product v3 facts/parser/repair retained; same original CNY50 ledger; all HTTP billed; unavailable deliveries score zero in end-to-end metrics.',
    authorizationEvidence: 'Parent task: user explicitly authorized current release and compact-count table, original key and original total CNY50 cap.',
    planning: { estimateCnyPerOpportunity: 0.04, estimateCny: 10.16, fullContextReservationPerHttpCny: 2.12992, guarantee: false } };
  contract.batchId = stableHash(contract).slice(0, 16);
  freeze(path.join(output, 'contract.json'), contract);
  const nodes = [...data.nodes].sort((a,b) => a.roundId.localeCompare(b.roundId) || a.position-b.position);
  const jobs = nodes.flatMap((n,i) => candidates.map((_,j) => ({ id: contract.batchId + ':' + n.id + ':' + candidates[(i+j)%2].id,
    nodeId: n.id, roundId: n.roundId, candidate: candidates[(i+j)%2].id })));
  freeze(path.join(output, 'schedule.json'), { datasetHash: data.datasetHash, jobs });
  verify(output);
  return { output, planned: jobs.length, candidates: candidates.map(c=>c.id), budget, paidRequests: 0 };
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
    newEstimatedCostCny: budget.spentEstimateCny-contract.budgetBefore.spentEstimateCny,
    newPhysicalRequests: budget.physicalRequests-contract.budgetBefore.physicalRequests,
    blindDirectory: path.join(output, mode, 'review', 'blind') };
  fs.mkdirSync(path.join(output, mode), { recursive:true });
  fs.writeFileSync(path.join(output, mode, 'summary.json'), JSON.stringify(report,null,2)+'\n');
  return report;
}
async function run(output, mock = false) {
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
    const histories = new Map(), mockModel = require('./mock.cjs').createMock(data);
    for (const job of read(path.join(output,'schedule.json')).jobs) {
      if (budget && (budget.snapshot().reservationCount || budget.snapshot().unknownLiability || budget.snapshot().budgetCommitted+pricing.fullContextReservationCny > 50)) break;
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
          if (mock && ordinal === 1 && node.position % 2 === 0) response = Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'模拟缺字段。'})}}],usage:{prompt_tokens:100,completion_tokens:20}});
          else response = mock ? await mockModel.fetch(url,wire):await budget.request(url,wire,{jobId:job.id,role,ordinal});
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
          transform:job.candidate==='b-compact-counts' ? require('./compact-counts.cjs').transformOptions:undefined });
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
        row.reviewSource = {resultId:job.id,answer:harness.traces.at(-1).text,facts};
      }
      log.write('result',row);
      if (complete) {queue.add(row.reviewSource);queue.exportPackets();}
      console.log(JSON.stringify({completed:log.events.filter(e=>e.kind==='result').length,planned:254,candidate:job.candidate,delivered:complete,http:ordinal,elapsedMs:Math.round(elapsedMs)}));
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
  if(command==='run'||command==='mock')return run(output,command==='mock');
  if(command==='report')return summarize(output,args.mock==='true');
  throw new Error('Expected prepare/check/run/mock/report');
}
if(require.main===module)main(process.argv.slice(2)).then(v=>console.log(JSON.stringify(v,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={prepare,verify,run,summarize,main};
