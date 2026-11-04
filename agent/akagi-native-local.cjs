'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const source = require('./akagi-native-source.json');
const {sampleRequest}=require('./mortal-sample.cjs');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function identity() {
  if (!source.runtime.buildId) throw new Error('NATIVE_RUNTIME_UNAVAILABLE');
  return { model: source.model, runtime: source.runtime.buildId, checkpoint: source.files.find(x=>x.role==='weights').sha256, sourceCommit: source.sourceCommit };
}
function runtimeConfig({dir,runtimeDir}) {
  return {command:path.resolve(runtimeDir,source.runtime.executable),args:['--weights',path.resolve(dir,source.weightAsset)],identity:identity()};
}
async function verifyFiles(dir,runtimeDir) {
  if (!source.runtime.files.length) throw new Error('NATIVE_RUNTIME_UNAVAILABLE');
  for (const [base,files] of [[dir,source.files],[runtimeDir,source.runtime.files]]) for (const file of files) {
    const data=await fs.readFile(path.join(base,file.name));
    if (data.length!==file.size || hash(data)!==file.sha256) throw new Error('SOURCE_HASH_MISMATCH');
  }
}
function validateWarmup(request,result) {
  const own=request.events[1].tehais[request.seat],draw=request.events.at(-1);
  if (result.action?.type!=='dahai' || result.action.actor!==request.seat || !own.concat(draw.pai).includes(result.action.pai)) throw new Error('REAL_INFERENCE_INVALID_ACTION');
}
async function check(options,keep=false) {
  await verifyFiles(options.dir,options.runtimeDir);
  const {createAkagiNativeRunner}=require('./akagi-native-process.cjs');
  const runner=createAkagiNativeRunner(runtimeConfig(options));
  let retained=false;
  try {await runner.start();const sample=sampleRequest();const result=await runner.infer(sample);validateWarmup(sample,result);if(keep){retained=true;return runner;}return result;}
  finally {if(!retained)await runner.close();}
}
async function main(argv) {
  const args=[...argv],mode=args.shift(),options={port:17345};
  if(mode==='catalog'){console.log(JSON.stringify(source));return;}
  if(!['check','serve'].includes(mode))throw new Error('Usage: node agent/akagi-native-local.cjs check|serve --dir MODEL_DIR --runtimeDir RUNTIME_DIR [--port 17345]');
  while(args.length){const k=args.shift();if(!['--dir','--runtimeDir','--port'].includes(k)||!args.length)throw new Error('INVALID_ARGUMENTS');options[k.slice(2)]=k==='--port'?Number(args.shift()):args.shift();}
  if(!options.dir||!options.runtimeDir)throw new Error('INVALID_ARGUMENTS');
  const value=await check(options,mode==='serve');
  if(mode==='check'){console.log(JSON.stringify(value));return;}
  const {createEngineServer}=require('./engine-server.cjs');let service;
  try {service=createEngineServer({runner:value,token:process.env.MJAI_ENGINE_TOKEN});await new Promise((r,j)=>{service.server.once('error',j);service.server.listen(options.port,'127.0.0.1',r);});}
  catch(e){await value.close();throw e;}
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>service.close().catch(()=>{process.exitCode=1;}));
  console.log(`Engine bridge: http://127.0.0.1:${service.server.address().port}/analyze`);console.log(`Bearer token: ${service.token}`);
}
module.exports={source,identity,runtimeConfig,verifyFiles,sampleRequest,validateWarmup,check,main};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(/^[A-Z_]+$/.test(error.message)?error.message:'AKAGI_NATIVE_FAILED');process.exitCode=1;});
