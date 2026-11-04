'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function verify(root){
  root=await fs.realpath(root);const manifest=JSON.parse(await fs.readFile(path.join(root,'TOOLKIT-SHA256.json'),'utf8'));
  if(manifest.format!=='mortal-toolkit-sha256-v1'||!['bootstrap','voidshine-298k','yuchen-582500'].includes(manifest.profile)||!Array.isArray(manifest.files))throw new Error('INVALID_TOOLKIT_MANIFEST');
  for(const item of manifest.files){const file=path.resolve(root,item.path);if(!file.startsWith(root+path.sep)||await fs.realpath(file)!==file)throw new Error('TOOLKIT_PATH_REFUSED');
    if(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')!==item.sha256)throw new Error('TOOLKIT_HASH_MISMATCH: '+item.path);}
  console.log('Verified toolkit files: '+manifest.files.length);
}
module.exports={verify};
if(require.main===module)verify(process.argv[2]||'.').catch(error=>{console.error(error.message);process.exitCode=1;});
