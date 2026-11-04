'use strict';
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {verify}=require('./verify-mortal-toolkit.cjs');
function defaultRoot(env=process.env){
  if(!env.LOCALAPPDATA||!path.win32.isAbsolute(env.LOCALAPPDATA))throw new Error('LOCALAPPDATA_REQUIRED: Cannot locate the managed model directory.');
  return path.win32.join(env.LOCALAPPDATA,'MajsoulAgent','models');
}
function childEnvironment(env=process.env){
  const windows=env.SystemRoot||env.SYSTEMROOT||'C:\\Windows';
  if(!path.win32.isAbsolute(windows))throw new Error('SYSTEMROOT_REQUIRED');
  const key=Object.keys(env).find(key=>key.toLowerCase()==='path');
  const tail=key?env[key]:'';
  const result={...env};for(const key of Object.keys(result))if(key.toLowerCase()==='path')delete result[key];
  // Per-process only: Python extraction and shutdown use Windows built-in tools.
  // Node always comes from the absolute package-local executable below.
  result.PATH=[path.win32.join(windows,'System32'),path.win32.join(windows,'System32','WindowsPowerShell','v1.0'),tail].filter(Boolean).join(';');
  return result;
}
async function launch(command){
  const root=path.resolve(__dirname,'..');
  await verify(root);
  let args;
  if(command==='start')args=[path.join(root,'agent/model-manager.cjs'),'--toolkit',root,'--root',defaultRoot(),'--open'];
  else if(['check','serve'].includes(command)){
    const manifest=require(path.join(root,'TOOLKIT-SHA256.json'));
    if(manifest.profile==='bootstrap')throw new Error('OFFLINE_MODEL_REQUIRED');
    args=[path.join(root,'agent/mortal-local.cjs'),command,'--profile',manifest.profile,'--dir',path.join(root,'model')];
    if(command==='serve')args.push('--port','17342');
  }else throw new Error('INVALID_LAUNCH_COMMAND');
  const result=spawnSync(path.join(root,'runtime/node.exe'),args,{cwd:root,stdio:'inherit',windowsHide:false,env:childEnvironment()});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}
module.exports={defaultRoot,childEnvironment,launch};
if(require.main===module)launch(process.argv[2]).catch(error=>{console.error('Model manager could not start: '+error.message);process.exitCode=1;});
