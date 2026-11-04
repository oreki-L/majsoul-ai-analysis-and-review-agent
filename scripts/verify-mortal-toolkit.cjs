'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const nodeLock=require('./node-runtime-lock.json');
const {verifyRuntime}=require('./prepare-node-runtime.cjs');
async function verify(root,{strict=false}={}){
  root=await fs.realpath(root);const manifest=JSON.parse(await fs.readFile(path.join(root,'TOOLKIT-SHA256.json'),'utf8'));
  if(manifest.format!=='mortal-toolkit-sha256-v1'||!['bootstrap','voidshine-298k','yuchen-582500'].includes(manifest.profile)||!Array.isArray(manifest.files))throw new Error('INVALID_TOOLKIT_MANIFEST');
  if(manifest.nodeRuntime?.version!==nodeLock.version||manifest.nodeRuntime?.archiveSha256!==nodeLock.archive.sha256)throw new Error('NODE_RUNTIME_LOCK_MISMATCH');
  await verifyRuntime(path.join(root,'runtime'));
  const seen=new Set();
  for(const item of manifest.files){if(typeof item.path!=='string'||!item.path||seen.has(item.path)||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('INVALID_TOOLKIT_MANIFEST');seen.add(item.path);const file=path.resolve(root,item.path);if(!file.startsWith(root+path.sep)||await fs.realpath(file)!==file)throw new Error('TOOLKIT_PATH_REFUSED');
    if(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')!==item.sha256)throw new Error('TOOLKIT_HASH_MISMATCH: '+item.path);}
  const required=['runtime/node.exe','runtime/LICENSE','runtime/SHASUMS256.txt','scripts/node-runtime-lock.json','scripts/launch-model-manager.cjs','scripts/verify-mortal-toolkit.cjs','scripts/prepare-node-runtime.cjs','agent/model-manager.cjs','agent/manager-access.cjs','agent/model-manager-ui/index.html','agent/model-manager-ui/app.js','agent/model-manager-ui/style.css','start.cmd','NOTICE.txt','PROJECT-LICENSE'];
  if(manifest.profile!=='bootstrap')required.push('check.cmd','serve.cmd');
  for(const name of required)if(!seen.has(name))throw new Error('TOOLKIT_REQUIRED_FILE_MISSING: '+name);
  if(strict){
    async function walk(folder){for(const item of await fs.readdir(folder,{withFileTypes:true})){if(item.name==='__pycache__'||item.name.endsWith('.pyc'))continue;const file=path.join(folder,item.name),relative=path.relative(root,file).replaceAll('\\','/');if(item.isSymbolicLink())throw new Error('TOOLKIT_PATH_REFUSED');if(item.isDirectory())await walk(file);else if(relative!=='TOOLKIT-SHA256.json'&&!seen.has(relative))throw new Error('TOOLKIT_UNLISTED_FILE: '+relative);}}
    await walk(root);
  }
  console.log('Verified toolkit files: '+manifest.files.length);
  return manifest;
}
module.exports={verify};
if(require.main===module)verify(process.argv[2]||'.').catch(error=>{console.error(error.message);process.exitCode=1;});
