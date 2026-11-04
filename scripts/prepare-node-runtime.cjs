'use strict';
// Explicit maintainer command. Never invoked by build, test, install, or launch.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const lock=require('./node-runtime-lock.json');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
function verifyShasums(text){
  const found=text.split(/\r?\n/).find(line=>line.trim().split(/\s+/)[1]===lock.archive.name);
  if(!found||found.trim().split(/\s+/)[0]!==lock.archive.sha256)throw new Error('NODE_OFFICIAL_SHASUM_MISMATCH');
}
async function verifyRuntime(dir){
  for(const item of lock.files){const file=path.join(dir,item.name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||digest(await fs.readFile(file))!==item.sha256)throw new Error('NODE_RUNTIME_HASH_MISMATCH: '+item.name);}
  verifyShasums(await fs.readFile(path.join(dir,'SHASUMS256.txt'),'utf8'));
  const names=(await fs.readdir(dir)).sort();
  if(JSON.stringify(names)!==JSON.stringify([...lock.files.map(item=>item.name),'SHASUMS256.txt'].sort()))throw new Error('NODE_RUNTIME_UNLISTED_FILE');
  if((await fs.lstat(dir)).isSymbolicLink())throw new Error('NODE_RUNTIME_PATH_REFUSED');
}
async function download(url){const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error('NODE_DOWNLOAD_FAILED: '+response.status);return Buffer.from(await response.arrayBuffer());}
async function prepare(out){
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('WINDOWS_X64_REQUIRED');
  out=path.resolve(out);try{await fs.lstat(out);throw new Error('NODE_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  const sums=(await download(lock.shasumsUrl)).toString('utf8');verifyShasums(sums);
  const archive=await download(lock.archive.url);if(digest(archive)!==lock.archive.sha256)throw new Error('NODE_ARCHIVE_HASH_MISMATCH');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'majsoul-node-'));
  try{
    const zip=path.join(temp,lock.archive.name);await fs.writeFile(zip,archive);
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const command='Expand-Archive -LiteralPath '+quote(zip)+' -DestinationPath '+quote(path.join(temp,'expanded'));
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,stdio:'pipe'});
    await fs.mkdir(out,{recursive:true});
    for(const item of lock.files)await fs.copyFile(path.join(temp,'expanded',lock.archive.directory,item.name),path.join(out,item.name));
    await fs.writeFile(path.join(out,'SHASUMS256.txt'),sums);await verifyRuntime(out);
    console.log(JSON.stringify({out,version:lock.version,url:lock.archive.url,archiveSha256:lock.archive.sha256,files:lock.files}));
  }finally{await fs.rm(temp,{recursive:true,force:true});}
}
module.exports={prepare,verifyRuntime,verifyShasums};
if(require.main===module){const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--out'){console.error('Usage: node scripts/prepare-node-runtime.cjs --out NEW_RUNTIME_DIR');process.exitCode=1;}else prepare(args[1]).catch(error=>{console.error(error.message);process.exitCode=1;});}
