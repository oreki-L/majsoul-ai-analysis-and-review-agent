'use strict';
// Explicit real v2 baseline using exactly the v4 performance fixture set.
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const {createRunner}=require('../agent/mjai-process.cjs');
const {runtimeConfig}=require('../agent/akagi-local.cjs');
const {fixtures}=require('./validate-mortal-v4.cjs');
const {createEngineServer}=require('../agent/engine-server.cjs');
const Agent=require('../extension/engine-agent.js');
async function main(){
  const dir=path.resolve(process.argv[2]),python=path.resolve(process.argv[3]);
  const service=createEngineServer({runner:createRunner(runtimeConfig({dir,python})),token:'local-v2-baseline'});
  await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
  const timings=[],actions=[],errors=[];
  try{
    for(const [index,c] of fixtures().entries()){
      const begin=performance.now();
      try{const output=await Agent.run({...c,timeoutMs:30000,infer:async request=>{
        const response=await fetch(`http://127.0.0.1:${service.server.address().port}/analyze`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer local-v2-baseline'},body:JSON.stringify(request)});
        if(!response.ok)throw new Error('HTTP_'+response.status);return response.json();
      }});actions.push({index,action:output.engine.action});}
      catch(error){errors.push({index,error:error.message});}
      timings.push(performance.now()-begin);
      if((index+1)%10===0)console.log('v2 baseline completed: '+(index+1));
    }
  }finally{await service.close();}
  const sorted=[...timings].sort((a,b)=>a-b),result={at:new Date().toISOString(),cpu:os.cpus()[0].model,requests:100,accepted:actions.length,errors,p50Ms:sorted[49],p95Ms:sorted[94],maxMs:sorted.at(-1),actions};
  await fs.writeFile(path.join(dir,'v4-fixture-baseline.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,actions:undefined}));
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
