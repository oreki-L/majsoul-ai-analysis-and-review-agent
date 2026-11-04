'use strict';
// Explicit maintainer packaging, never an extension build/install hook.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {verifyFiles,sourceForProfile}=require('../agent/mortal-local.cjs');
const source=require('../agent/mortal-source.json');
const lock=require('../agent/mortal-runtime-lock.json');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const REPO=path.resolve(__dirname,'..');
const AGENT_FILES=['mortal-local.cjs','mortal-process.cjs','mortal-worker.py','mortal-source.json','mortal-profile.cjs','mortal-runtime-lock.json','mortal-catalog.json','mortal-sample.cjs','mjai-python-wrapper.py','mjai-process.cjs','engine-server.cjs','akagi-local.cjs','akagi-local.py','akagi-source.json','model-manager.cjs','model-installation.cjs'];
const SCRIPT_FILES=['mortal-official-reference.py','prepare-mortal-runtime.cjs','package-mortal-toolkit.cjs','verify-mortal-toolkit.cjs','build-mortal-native.ps1'];
const DOC_FILES=['MORTAL_V4.md','MORTAL_V4_VALIDATION.md','MODEL_MANAGER.md'];
const TOOLCHAIN_NOTICE='Native Rust standard-library and GCC runtime notices: sources/toolchain-licenses/ (MIT/Apache-2.0 and GCC Runtime Library Exception).\n';
async function writeStart(out){await fs.writeFile(path.join(out,'start.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nnode scripts/verify-mortal-toolkit.cjs . && node agent/model-manager.cjs --toolkit . --root installations\r\n');}
async function writeGuide(out){
  await fs.writeFile(path.join(out,'README.md'),`# 雀魂本机模型管理工具（Windows x64）

发布资产：\`majsoul-model-manager-windows-x64-0.14.0.zip\`。此默认引导包不含模型权重或完整 Python；不用本地分析时无需安装本工具。

1. 从 https://nodejs.org/ 安装 Node.js 22.19 或更高版本，重新打开终端后用 \`node --version\` 确认。
2. 完整解压 ZIP 到可写目录，运行 \`start.cmd\`。它先校验文件，再启动本机管理页；保持终端运行。
3. 打开终端显示的地址，把终端中的**管理 Token**粘贴到页面并连接。刷新页面后需重新输入；Token 不写入 URL 或浏览器存储。
4. 选择所需模型并点击“安装”。只有这一步才下载选中权重和必要的固定 CPU 环境；可保持零模型，安装后也不会自动推理。
5. 点击“启动分析”，将页面显示的分析地址和**分析 Bearer Token**复制到扩展对应配置，保存并明确开启分析。管理 Token 与分析 Token 分开使用。
6. 用完在管理页停止分析，再关闭终端。删除模型保留共享运行环境；一次只运行一个模型。

安装数据保存在本目录 \`installations/\`。首次安装需要网络；已实际从官方源下载 Python 和全部10个固定 wheel 并安装、校验运行环境。本机连接 HF 权重源失败，因此完整在线模型安装尚未通过；完整模型离线安装已验证。下载受本机网络环境影响，网络或哈希校验失败会报错，不会改用其他模型。两个社区 v4 仅支持逐次确认四人半庄后的手动分析；真实整场兼容与牌力未认证。

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
  await fs.writeFile(path.join(out,'TOOLKIT-SHA256.json'),JSON.stringify({format:'mortal-toolkit-sha256-v1',profile,files},null,2)+'\n');
  return files.length;
}
async function refreshToolkit(out){
  out=path.resolve(out);const manifest=JSON.parse(await fs.readFile(path.join(out,'TOOLKIT-SHA256.json'),'utf8'));
  if(manifest.format!=='mortal-toolkit-sha256-v1')throw new Error('UNKNOWN_TOOLKIT_REFUSED');
  try{if((await fs.readdir(path.join(out,'installations'))).length)throw new Error('REFRESH_INSTALLED_TOOLKIT_REFUSED');}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const file of AGENT_FILES)await copy(path.join(REPO,'agent',file),path.join(out,'agent',file));
  await copy(path.join(REPO,'agent/model-manager-ui'),path.join(out,'agent/model-manager-ui'));
  for(const file of SCRIPT_FILES)await copy(path.join(REPO,'scripts',file),path.join(out,'scripts',file));
  for(const file of DOC_FILES)await copy(path.join(REPO,'docs',file),path.join(out,'docs',file));
  await copy(path.join(REPO,'extension/adapters/mjai.js'),path.join(out,'extension/adapters/mjai.js'));
  const noticePath=path.join(out,'NOTICE.txt'),notice=await fs.readFile(noticePath,'utf8');
  if(!notice.includes(TOOLCHAIN_NOTICE))await fs.writeFile(noticePath,notice+TOOLCHAIN_NOTICE);
  await writeStart(out);
  await writeGuide(out);
  console.log(JSON.stringify({refreshed:out,files:await writeManifest(out,manifest.profile)}));
}
async function packageToolkit({dir,runtime,out,offlineProfile,modelDir,withWheels=false}){
  dir=path.resolve(dir);out=path.resolve(out);
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
  await writeGuide(out);
  await fs.writeFile(path.join(out,'NOTICE.txt'),
    'Optional Mortal v4 bootstrap toolkit. Not part of the extension ZIP. Default package has no weights or Python environment.\n'+
    'Mortal framework/libriichi: AGPL-3.0-or-later; complete pinned source + Cargo.lock + vendored crates are under sources/.\n'+
    'When explicitly exported offline, model repository license/model card are retained under model/. Training data is never included.\n'+
    'Project bridge/scripts: see PROJECT-LICENSE. Upstream model.py/engine.py unmodified. Wrapper is project code; no training/GRP/autoload code invoked.\n'+
    'Python: model/python/LICENSE.txt (PSF). PyTorch, NumPy and other wheel notices remain under model/python/Lib/site-packages/*.dist-info/licenses and torch/LICENSE.\n'+
    TOOLCHAIN_NOTICE+'Process separation does not waive applicable license duties. No official Mortal 4.1 or strength certification.\n'+
    'Requires an explicitly installed Node.js >=22.19; requires no global Python/Rust to run. Check/serve are manual.\n');
  if(offlineProfile){
    await fs.writeFile(path.join(out,'check.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nnode scripts/verify-mortal-toolkit.cjs . && node agent/mortal-local.cjs check --profile '+offlineProfile+' --dir model\r\n');
    await fs.writeFile(path.join(out,'serve.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nnode scripts/verify-mortal-toolkit.cjs . && node agent/mortal-local.cjs serve --profile '+offlineProfile+' --dir model --port 17342\r\n');
  }
  console.log(JSON.stringify({out,files:await writeManifest(out,offlineProfile||'bootstrap'),profile:offlineProfile||'bootstrap',weightsIncluded:!!offlineProfile,pythonIncluded:!!offlineProfile,nativeSha256:source.native.sha256}));
}
async function main(args){if(args.length===2&&args[0]==='--refresh')return refreshToolkit(args[1]);const options={};while(args.length){const flag=args.shift();if(flag==='--with-wheels'){options.withWheels=true;continue;}if(!['--dir','--runtime','--out','--offline-profile','--model-dir'].includes(flag)||!args.length)throw new Error('INVALID_ARGUMENTS');options[({'offline-profile':'offlineProfile','model-dir':'modelDir'})[flag.slice(2)]||flag.slice(2)]=args.shift();}if(!options.dir||!options.out)throw new Error('Usage: node scripts/package-mortal-toolkit.cjs --dir NATIVE_SOURCE_DIR --out NEW_DIR [--with-wheels] [--offline-profile PROFILE --model-dir DIR --runtime PYTHON_DIR]');await packageToolkit(options);}
module.exports={packageToolkit,refreshToolkit,verifyVendor};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
