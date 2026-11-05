'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {verifyShasums,verifyRuntime,prepare}=require('../scripts/prepare-node-runtime.cjs');
const {packageToolkit,refreshToolkit,writeLauncher,copyDocs}=require('../scripts/package-mortal-toolkit.cjs');
const {defaultRoot,childEnvironment}=require('../scripts/launch-model-manager.cjs');
const lock=require('../scripts/node-runtime-lock.json');
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'portable-model-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('portable Node pin requires the exact official archive checksum',()=>{
  assert.doesNotThrow(()=>verifyShasums(lock.archive.sha256+'  '+lock.archive.name+'\r\n'));
  assert.throws(()=>verifyShasums('0'.repeat(64)+'  '+lock.archive.name),/NODE_OFFICIAL_SHASUM_MISMATCH/);
  assert.throws(()=>verifyShasums(lock.archive.sha256+'  node-other.zip'),/NODE_OFFICIAL_SHASUM_MISMATCH/);
});
test('model cache survives extraction location changes and refuses missing local data directory',()=>{
  assert.equal(defaultRoot({LOCALAPPDATA:'C:\\Users\\中文 User\\AppData\\Local'}),'C:\\Users\\中文 User\\AppData\\Local\\MajsoulAgent\\models');
  for(const value of [undefined,'relative',''])assert.throws(()=>defaultRoot({LOCALAPPDATA:value}),/LOCALAPPDATA_REQUIRED/);
});
test('portable child environment adds only built-in Windows tools before the original PATH',()=>{
  const original={SystemRoot:'C:\\Windows',Path:'D:\\user tools',LOCALAPPDATA:'C:\\local'};
  const result=childEnvironment(original);
  assert.equal(result.PATH,'C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;D:\\user tools');
  assert.equal(result.Path,undefined);assert.equal(original.Path,'D:\\user tools');
  assert.equal(childEnvironment({SystemRoot:'C:\\Windows',PATH:''}).PATH,'C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0');
  assert.throws(()=>childEnvironment({SystemRoot:'relative'}),/SYSTEMROOT_REQUIRED/);
});
test('runtime preparation refuses existing destinations before attempting network',async t=>{
  const dir=await temporary(t);if(process.platform==='win32'&&process.arch==='x64')await assert.rejects(prepare(dir),/NODE_OUTPUT_EXISTS/);
  await fs.writeFile(path.join(dir,'node.exe'),'untrusted');await assert.rejects(verifyRuntime(dir),/NODE_RUNTIME_HASH_MISMATCH/);
});
test('packaging does not silently obtain a runtime and refresh refuses old unknown packages',async t=>{
  const dir=await temporary(t);await assert.rejects(packageToolkit({dir,out:path.join(dir,'out')}),/NODE_RUNTIME_REQUIRED/);
  await fs.writeFile(path.join(dir,'TOOLKIT-SHA256.json'),JSON.stringify({format:'mortal-toolkit-sha256-v1',profile:'bootstrap',files:[]}));
  await fs.writeFile(path.join(dir,'keep.txt'),'unknown');await assert.rejects(refreshToolkit(dir),/NODE_RUNTIME_LOCK_MISMATCH/);
  assert.equal(await fs.readFile(path.join(dir,'keep.txt'),'utf8'),'unknown');
  await fs.mkdir(path.join(dir,'installations'));await fs.writeFile(path.join(dir,'installations','keep.txt'),'installed');
  await assert.rejects(refreshToolkit(dir),/REFRESH_INSTALLED_TOOLKIT_REFUSED/);
});
test('all command launchers quote package-local Node and preserve readable failure',async t=>{
  const dir=await temporary(t);
  for(const name of ['start','check','serve']){await writeLauncher(dir,name);const text=await fs.readFile(path.join(dir,name+'.cmd'),'utf8');assert.match(text,/"%~dp0runtime\\node.exe" "%~dp0scripts\\launch-model-manager.cjs"/);assert.match(text,/pause\r\nexit \/b %TOOLKIT_EXIT%/);assert.doesNotMatch(text,/\r\nnode /);}
});

test('portable documentation includes canonical bodies and working legacy entry points',async t=>{
  const dir=await temporary(t);
  await copyDocs(dir);
  for(const [name,group] of [['MODEL_MANAGER','guides'],['MORTAL_V4','guides'],['MORTAL_V4_VALIDATION','validation'],['AKAGI_V3_VALIDATION','validation']]){
    const target=path.join('docs',group,name+'.md');
    assert.equal(await fs.readFile(path.join(dir,target),'utf8'),await fs.readFile(path.join(__dirname,'..',target),'utf8'));
    const entry=await fs.readFile(path.join(dir,'docs',name+'.md'),'utf8');
    assert.ok(entry.includes(']('+group+'/'+name+'.md)'));
    // Every retained old-section link must resolve to a body shipped in the package.
    for(const match of entry.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)){
      assert.ok((await fs.stat(path.resolve(dir,'docs',match[1]))).isFile());
    }
  }
});
