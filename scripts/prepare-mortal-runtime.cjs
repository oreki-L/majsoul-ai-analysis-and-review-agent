'use strict';
// Explicit, offline runtime preparation. No pip/global Python/Rust required.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const source=require('../agent/mortal-source.json');
const lock=require('../agent/mortal-runtime-lock.json');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
async function prepare({dir,archive,wheels}){
  if(process.platform!=='win32')throw new Error('WINDOWS_X64_REQUIRED');
  const root=path.resolve(dir),target=path.join(root,'python');
  if(digest(await fs.readFile(archive))!==source.pythonArchive.sha256)throw new Error('PYTHON_ARCHIVE_HASH_MISMATCH');
  for(const file of lock.wheels)if(digest(await fs.readFile(path.join(wheels,file.name)))!==file.sha256)throw new Error('WHEEL_HASH_MISMATCH: '+file.name);
  await fs.mkdir(root,{recursive:true});
  try { await fs.access(target);throw new Error('RUNTIME_ALREADY_EXISTS: use an empty runtime directory'); } catch(error){if(error.code!=='ENOENT')throw error;}
  const staging=await fs.mkdtemp(path.join(root,'.mortal-runtime-'));
  try{
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const extract=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(path.resolve(archive))} -DestinationPath ${quote(staging)}`],{windowsHide:true,encoding:'utf8',timeout:60000});
    if(extract.error||extract.status!==0)throw new Error('PYTHON_EXTRACT_FAILED');
    await fs.appendFile(path.join(staging,'python311._pth'),'\nLib/site-packages\n');
    const python=path.join(staging,'python.exe');
    const install=spawnSync(python,['-I','-c',
      'import json,sys,zipfile,pathlib\nroot=pathlib.Path(sys.argv[1]); wheels=pathlib.Path(sys.argv[2]); manifest=json.loads(pathlib.Path(sys.argv[3]).read_text())\nfor file in manifest["wheels"]:\n with zipfile.ZipFile(wheels/file["name"]) as z:\n  assert all(not pathlib.PurePosixPath(n).is_absolute() and ".." not in pathlib.PurePosixPath(n).parts for n in z.namelist())\n  z.extractall(root/"Lib"/"site-packages")',
      staging,path.resolve(wheels),path.join(__dirname,'../agent/mortal-runtime-lock.json')],{windowsHide:true,encoding:'utf8',timeout:120000});
    if(install.error||install.status!==0)throw new Error('WHEEL_EXTRACT_FAILED');
    const probe=spawnSync(python,['-I','-c','import torch,numpy,platform; assert platform.python_version()=="3.11.9"; assert torch.__version__=="2.7.0+cpu"; assert numpy.__version__=="1.26.2"'],{windowsHide:true,encoding:'utf8',timeout:60000});
    if(probe.error||probe.status!==0)throw new Error('RUNTIME_PROBE_FAILED');
    await fs.writeFile(path.join(staging,'mortal-runtime-lock.json'),JSON.stringify(lock,null,2));
    await fs.rename(staging,target);
  }finally{await fs.rm(staging,{recursive:true,force:true});}
  console.log('Verified portable CPU runtime: '+target);
}
async function main(args){const options={};while(args.length){const flag=args.shift();if(!['--dir','--archive','--wheels'].includes(flag)||!args.length)throw new Error('INVALID_ARGUMENTS');options[flag.slice(2)]=args.shift();}if(!options.dir||!options.archive||!options.wheels)throw new Error('Usage: node scripts/prepare-mortal-runtime.cjs --dir DIR --archive python.zip --wheels DIR');await prepare(options);}
module.exports={prepare};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
