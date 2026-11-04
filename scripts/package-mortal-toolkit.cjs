'use strict';
// Explicit maintainer packaging, never an extension build/install hook.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {verifyFiles,sourceForProfile}=require('../agent/mortal-local.cjs');
const source=require('../agent/mortal-source.json');
const lock=require('../agent/mortal-runtime-lock.json');
const nodeLock=require('./node-runtime-lock.json');
const {verifyRuntime}=require('./prepare-node-runtime.cjs');
const {verify:verifyToolkit}=require('./verify-mortal-toolkit.cjs');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const REPO=path.resolve(__dirname,'..');
const AGENT_FILES=['mortal-local.cjs','mortal-process.cjs','mortal-worker.py','mortal-source.json','mortal-profile.cjs','mortal-runtime-lock.json','mortal-catalog.json','mortal-sample.cjs','mjai-python-wrapper.py','mjai-process.cjs','engine-server.cjs','akagi-local.cjs','akagi-local.py','akagi-source.json','model-manager.cjs','manager-access.cjs','model-installation.cjs'];
const SCRIPT_FILES=['mortal-official-reference.py','prepare-mortal-runtime.cjs','package-mortal-toolkit.cjs','verify-mortal-toolkit.cjs','build-mortal-native.ps1','prepare-node-runtime.cjs','node-runtime-lock.json','launch-model-manager.cjs'];
const DOC_FILES=['MORTAL_V4.md','MORTAL_V4_VALIDATION.md','MODEL_MANAGER.md'];
const TOOLCHAIN_NOTICE='Native Rust standard-library and GCC runtime notices: sources/toolchain-licenses/ (MIT/Apache-2.0 and GCC Runtime Library Exception).\n';
async function writeLauncher(out,command){await fs.writeFile(path.join(out,command+'.cmd'),'@echo off\r\nsetlocal\r\n"%~dp0runtime\\node.exe" "%~dp0scripts\\launch-model-manager.cjs" '+command+'\r\nset "TOOLKIT_EXIT=%ERRORLEVEL%"\r\nif "%TOOLKIT_EXIT%"=="0" exit /b 0\r\necho.\r\necho Model manager failed. See the error above.\r\npause\r\nexit /b %TOOLKIT_EXIT%\r\n');}
async function writeStart(out){await writeLauncher(out,'start');}
async function writeGuide(out,profile='bootstrap'){
  await fs.writeFile(path.join(out,'README.md'),`# 雀魂本机模型管理工具（Windows x64）

发布资产：\`majsoul-model-manager-windows-x64-0.15.0.zip\`。此可选包自带固定 Node.js 22.19.0；${profile==='bootstrap'?'此引导包不含模型权重或完整 Python':'此显式离线导出包含 '+profile+' 权重及固定 Python 环境'}。普通 LLM 使用无需安装本工具。

1. 完整解压 ZIP 到可写目录，双击 \`start.cmd\`。包内运行环境先校验文件，随后自动打开本机管理页；保持终端运行，无需另装 Node、Python 或 Rust。
2. 选择所需模型并点击“安装”。只有这一步才下载选中权重及其必要环境；可保持零模型，安装后也不会自动推理。安装完成后点击“启动分析”。
3. 在扩展中连接运行包，在管理页批准连接，扩展自动填入分析配置；保存后主动开启分析。
4. 用完在管理页停止分析，再关闭终端。删除模型保留共享环境；可保留多个已安装模型，一次只运行一个。

安装数据默认保存在 \`%LOCALAPPDATA%\\MajsoulAgent\\models\`，重新解压新版工具包后可复用受管理的下载，不搬迁旧目录或接管未知文件。启动管理服务不会下载模型或运行推理，不注册系统自启。管理凭据与分析 Bearer 凭据隔离；只在本机页面授权。首次安装需要网络，下载失败或哈希不符会明确报错。两个社区 v4 限四人半庄，完整实战兼容和牌力未认证。

详细操作见 [模型管理](docs/MODEL_MANAGER.md)，范围见 [Mortal v4](docs/MORTAL_V4.md)，验证限制见 [验收记录](docs/MORTAL_V4_VALIDATION.md)。

许可见 \`NOTICE.txt\`、\`PROJECT-LICENSE\`；固定 Mortal 完整源码与 Cargo.lock 位于 \`sources/Mortal/\`，对应 crate 源码和许可证位于 \`sources/vendor/\`，Rust／GCC 运行库公告位于 \`sources/toolchain-licenses/\`。构建说明见 \`sources/BUILDING.md\`，原生构建记录见 \`native/libriichi-build.json\`；所有分发文件哈希见 \`TOOLKIT-SHA256.json\`。Python／wheel／模型许可随显式安装保留。
`);
  await fs.mkdir(path.join(out,'sources/.cargo'),{recursive:true});
  await fs.writeFile(path.join(out,'sources/.cargo/config.toml'),'[source.crates-io]\nreplace-with = "vendored-sources"\n[source.vendored-sources]\ndirectory = "vendor"\n');
  await fs.writeFile(path.join(out,'sources/BUILDING.md'),`# Pinned native build

Source commit: ${source.sourceCommit}. Archive SHA-256: ${source.sourceArchive.sha256}. Cargo.lock SHA-256: ${source.native.cargoLockSha256}.

The unmodified archive is mortal-source.zip; Mortal/ is extracted from that archive. vendor/ contains the matching Cargo vendored crates and original license files. .cargo/config.toml selects these local sources when invoked from this sources/ directory.

Build inputs: Windows x64, Rust ${source.native.rust} GNU, compatible GNU linker, Python 3.11.9 x64. Compilers are not distributed. See native/libriichi-build.json (one directory above sources/) for the recorded ABI, features and binary SHA. The resulting DLL is renamed libriichi.pyd. Only pymod is enabled; default mimalloc is disabled.

From this sources/ directory, invoke ../scripts/build-mortal-native.ps1 with explicit -SourceDir ./Mortal -RustBin RUST_BIN -GccBin GCC_BIN -Python PYTHON_EXE -TargetDir ASCII_TARGET_DIR -CargoHome CARGO_HOME. Use absolute paths for the placeholders. GNU linker requires an ASCII target path; a subst drive can expose non-ASCII tool paths. The script sets link-self-contained=yes. The command uses --release --locked --no-default-features --features pymod.

This records build inputs and provides corresponding source; it does not claim bit-for-bit reproducibility across machines. A rebuild with a different hash requires review and an updated fixed manifest before use. No credentials, training data or private build logs are included.
`);
}
async function verifyVendor(root){
  root=path.resolve(root);
  for(const item of await fs.readdir(root,{withFileTypes:true})){
    if(!item.isDirectory())throw new Error('VENDOR_ENTRY_REFUSED');
    const dir=path.join(root,item.name),checks=JSON.parse(await fs.readFile(path.join(dir,'.cargo-checksum.json'),'utf8'));
    const expected=new Set(['.cargo-checksum.json',...Object.keys(checks.files)]);
    const seen=new Set();
    async function walk(at){for(const entry of await fs.readdir(at,{withFileTypes:true})){const file=path.join(at,entry.name),relative=path.relative(dir,file).replaceAll('\\','/');if(entry.isDirectory())await walk(file);else if(!entry.isFile()||!expected.has(relative))throw new Error('VENDOR_UNLISTED_FILE');else {seen.add(relative);if(relative!=='.cargo-checksum.json'&&digest(await fs.readFile(file))!==checks.files[relative])throw new Error('VENDOR_HASH_MISMATCH');}}}
    await walk(dir);
    if(seen.size!==expected.size)throw new Error('VENDOR_MISSING_FILE');
    for(const name of Object.keys(checks.files))if(!expected.has(name)||!path.resolve(dir,name).startsWith(dir+path.sep))throw new Error('VENDOR_PATH_REFUSED');
  }
}
async function copy(from,to){await fs.mkdir(path.dirname(to),{recursive:true});await fs.cp(from,to,{recursive:true,filter:item=>!['target','.git','__pycache__'].includes(path.basename(item))&&!item.endsWith('.pyc')});}
async function writeManifest(out,profile){
  const files=[];
  async function walk(folder){for(const item of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,item.name);if(item.name==='__pycache__'||item.name.endsWith('.pyc'))continue;if(item.isSymbolicLink())throw new Error('TOOLKIT_SYMLINK_REFUSED');if(item.isDirectory())await walk(file);else if(path.relative(out,file)!=='TOOLKIT-SHA256.json')files.push({path:path.relative(out,file).replaceAll('\\','/'),sha256:digest(await fs.readFile(file))});}}
  await walk(out);files.sort((a,b)=>a.path.localeCompare(b.path));
  await fs.writeFile(path.join(out,'TOOLKIT-SHA256.json'),JSON.stringify({format:'mortal-toolkit-sha256-v1',profile,nodeRuntime:{version:nodeLock.version,archiveSha256:nodeLock.archive.sha256},files},null,2)+'\n');
  return files.length;
}
async function refreshToolkit(out){
  out=path.resolve(out);const manifest=JSON.parse(await fs.readFile(path.join(out,'TOOLKIT-SHA256.json'),'utf8'));
  if(manifest.format!=='mortal-toolkit-sha256-v1')throw new Error('UNKNOWN_TOOLKIT_REFUSED');
  try{if((await fs.readdir(path.join(out,'installations'))).length)throw new Error('REFRESH_INSTALLED_TOOLKIT_REFUSED');}catch(error){if(error.code!=='ENOENT')throw error;}
  // Only refresh an intact, recognized portable package; never bless unknown bytes.
  await verifyToolkit(out,{strict:true});
  for(const file of AGENT_FILES)await copy(path.join(REPO,'agent',file),path.join(out,'agent',file));
  await copy(path.join(REPO,'agent/model-manager-ui'),path.join(out,'agent/model-manager-ui'));
  for(const file of SCRIPT_FILES)await copy(path.join(REPO,'scripts',file),path.join(out,'scripts',file));
  for(const file of DOC_FILES)await copy(path.join(REPO,'docs',file),path.join(out,'docs',file));
  await copy(path.join(REPO,'extension/adapters/mjai.js'),path.join(out,'extension/adapters/mjai.js'));
  const noticePath=path.join(out,'NOTICE.txt'),notice=await fs.readFile(noticePath,'utf8');
  if(!notice.includes(TOOLCHAIN_NOTICE))await fs.writeFile(noticePath,notice+TOOLCHAIN_NOTICE);
  await writeStart(out);
  if(manifest.profile!=='bootstrap'){await writeLauncher(out,'check');await writeLauncher(out,'serve');}
  await writeGuide(out,manifest.profile);
  console.log(JSON.stringify({refreshed:out,files:await writeManifest(out,manifest.profile),nodeVersion:nodeLock.version,nodeArchiveSha256:nodeLock.archive.sha256}));
}
async function packageToolkit({dir,runtime,out,offlineProfile,modelDir,withWheels=false,nodeRuntime}){
  dir=path.resolve(dir);out=path.resolve(out);
  if(!nodeRuntime)throw new Error('NODE_RUNTIME_REQUIRED: explicitly prepare with scripts/prepare-node-runtime.cjs');
  nodeRuntime=path.resolve(nodeRuntime);await verifyRuntime(nodeRuntime);
  const selected=sourceForProfile(offlineProfile||source.profile);
  if(offlineProfile){
    modelDir=path.resolve(modelDir||dir);runtime=path.resolve(runtime||path.join(modelDir,'python'));
    await verifyFiles(modelDir,offlineProfile);
    const runtimeMarker=JSON.parse(await fs.readFile(path.join(runtime,'mortal-runtime-lock.json'),'utf8'));
    if(JSON.stringify(runtimeMarker)!==JSON.stringify(lock))throw new Error('RUNTIME_LOCK_MISMATCH');
  }
  if(digest(await fs.readFile(path.join(dir,'libriichi.pyd')))!==source.native.sha256)throw new Error('NATIVE_HASH_MISMATCH');
  if(digest(await fs.readFile(path.join(dir,'mortal-source.zip')))!==source.sourceArchive.sha256)throw new Error('SOURCE_ARCHIVE_MISMATCH');
  const build=JSON.parse(await fs.readFile(path.join(dir,'libriichi-build.json'),'utf8'));
  if(build.sourceCommit!==source.sourceCommit||build.sha256!==source.native.sha256||build.rust!==source.native.rust||build.abi!==source.native.abi||JSON.stringify(build.features)!==JSON.stringify(source.native.features))throw new Error('NATIVE_BUILD_RECORD_MISMATCH');
  await verifyVendor(path.join(dir,'vendor'));
  await fs.mkdir(out,{recursive:false});
  await copy(nodeRuntime,path.join(out,'runtime'));
  for(const file of AGENT_FILES)await copy(path.join(REPO,'agent',file),path.join(out,'agent',file));
  await copy(path.join(REPO,'agent/model-manager-ui'),path.join(out,'agent/model-manager-ui'));
  await copy(path.join(REPO,'extension/adapters/mjai.js'),path.join(out,'extension/adapters/mjai.js'));
  await copy(path.join(dir,'libriichi.pyd'),path.join(out,'native/libriichi.pyd'));
  await fs.writeFile(path.join(out,'native/libriichi-build.json'),JSON.stringify({rust:build.rust,features:build.features,sha256:build.sha256,sourceCommit:build.sourceCommit,abi:build.abi,flags:'--release --locked --no-default-features --features pymod; link-self-contained=yes'},null,2)+'\n');
  if(offlineProfile){
    for(const item of selected.files)await copy(path.join(modelDir,item.name),path.join(out,'model',item.name));
    for(const file of ['libriichi.pyd','libriichi-build.json'])await copy(path.join(out,'native',file),path.join(out,'model',file));
    await copy(runtime,path.join(out,'model/python'));
  }
  await writeStart(out);
  if(withWheels){
    if(digest(await fs.readFile(path.join(dir,'python.zip')))!==source.pythonArchive.sha256)throw new Error('PYTHON_ARCHIVE_MISMATCH');
    await copy(path.join(dir,'python.zip'),path.join(out,'python-3.11.9-embed-amd64.zip'));
    for(const item of lock.wheels){if(digest(await fs.readFile(path.join(dir,'wheels',item.name)))!==item.sha256)throw new Error('WHEEL_HASH_MISMATCH');await copy(path.join(dir,'wheels',item.name),path.join(out,'wheels',item.name));}
  }
  await fs.mkdir(path.join(out,'sources'),{recursive:true});
  const escapePs=value=>"'"+value.replaceAll("'","''")+"'";
  const expand='Expand-Archive -LiteralPath '+escapePs(path.join(dir,'mortal-source.zip'))+' -DestinationPath '+escapePs(path.join(out,'sources'));
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(expand,'utf16le').toString('base64')],{windowsHide:true,stdio:'pipe'});
  await fs.rename(path.join(out,'sources','Mortal-'+source.sourceCommit),path.join(out,'sources/Mortal'));
  await copy(path.join(dir,'vendor'),path.join(out,'sources/vendor'));
  await copy(path.join(dir,'toolchain-licenses'),path.join(out,'sources/toolchain-licenses'));
  await copy(path.join(dir,'mortal-source.zip'),path.join(out,'sources/mortal-source.zip'));
  for(const file of ['mortal-source.json','mortal-runtime-lock.json'])await copy(path.join(REPO,'agent',file),path.join(out,'sources',file));
  for(const file of SCRIPT_FILES)await copy(path.join(REPO,'scripts',file),path.join(out,'scripts',file));
  for(const file of DOC_FILES)await copy(path.join(REPO,'docs',file),path.join(out,'docs',file));
  await copy(path.join(REPO,'LICENSE'),path.join(out,'PROJECT-LICENSE'));
  await writeGuide(out,offlineProfile||'bootstrap');
  await fs.writeFile(path.join(out,'NOTICE.txt'),
    'Optional Mortal v4 bootstrap toolkit. Not part of the extension ZIP. Default package has no weights or Python environment.\n'+
    'Mortal framework/libriichi: AGPL-3.0-or-later; complete pinned source + Cargo.lock + vendored crates are under sources/.\n'+
    'When explicitly exported offline, model repository license/model card are retained under model/. Training data is never included.\n'+
    'Project bridge/scripts: see PROJECT-LICENSE. Upstream model.py/engine.py unmodified. Wrapper is project code; no training/GRP/autoload code invoked.\n'+
    'Python: model/python/LICENSE.txt (PSF). PyTorch, NumPy and other wheel notices remain under model/python/Lib/site-packages/*.dist-info/licenses and torch/LICENSE.\n'+
    TOOLCHAIN_NOTICE+'Process separation does not waive applicable license duties. No official Mortal 4.1 or strength certification.\n'+
    'Node.js 22.19.0 Windows x64: bundled runtime/node.exe; official nodejs.org distribution, runtime/LICENSE includes Node and third-party notices. Fixed archive URL and SHA-256: scripts/node-runtime-lock.json. No global Node/Python/Rust required. Check/serve are manual.\n');
  if(offlineProfile){
    await writeLauncher(out,'check');
    await writeLauncher(out,'serve');
  }
  console.log(JSON.stringify({out,files:await writeManifest(out,offlineProfile||'bootstrap'),profile:offlineProfile||'bootstrap',weightsIncluded:!!offlineProfile,pythonIncluded:!!offlineProfile,nodeVersion:nodeLock.version,nodeArchiveSha256:nodeLock.archive.sha256,nativeSha256:source.native.sha256}));
}
async function main(args){if(args.length===2&&args[0]==='--refresh')return refreshToolkit(args[1]);const options={};while(args.length){const flag=args.shift();if(flag==='--with-wheels'){options.withWheels=true;continue;}if(!['--dir','--runtime','--out','--offline-profile','--model-dir','--node-runtime'].includes(flag)||!args.length)throw new Error('INVALID_ARGUMENTS');options[({'offline-profile':'offlineProfile','model-dir':'modelDir','node-runtime':'nodeRuntime'})[flag.slice(2)]||flag.slice(2)]=args.shift();}if(!options.dir||!options.out)throw new Error('Usage: node scripts/package-mortal-toolkit.cjs --dir NATIVE_SOURCE_DIR --out NEW_DIR --node-runtime PREPARED_NODE_DIR [--with-wheels] [--offline-profile PROFILE --model-dir DIR --runtime PYTHON_DIR]');await packageToolkit(options);}
module.exports={packageToolkit,refreshToolkit,verifyVendor,writeLauncher};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
