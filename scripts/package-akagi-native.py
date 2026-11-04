#!/usr/bin/env python3
"""Package only a reviewed, externally built native runtime; never downloads or publishes."""
import argparse,hashlib,json,zipfile,tarfile,difflib,shutil
from pathlib import Path

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def dump(p,v): p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def zip_tree(root,dest):
    with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(root.rglob('*')):
            if p.is_file():
                info=zipfile.ZipInfo(p.relative_to(root).as_posix(),(2026,11,4,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16;z.writestr(info,p.read_bytes())
def main():
    a=argparse.ArgumentParser();a.add_argument('--evidence',required=True);a.add_argument('--upstream',required=True);a.add_argument('--rust-root',required=True);args=a.parse_args()
    workspace=Path(__file__).resolve().parents[1];evidence=Path(args.evidence).resolve();up=Path(args.upstream).resolve();rust=Path(args.rust_root).resolve()
    if (workspace/'research/evidence').resolve() not in [evidence,*evidence.parents]: raise ValueError('evidence path outside workspace research/evidence')
    binary=evidence/'target/release/akagi-native.exe';binary_sha=sha(binary);build='akagi-native-win64-cpu-jsonl-v1-p1-'+binary_sha[:16];family='akagi-v3-win64-cpu-jsonl-v1-p1-'+binary_sha[:16]
    package=evidence/family;package.mkdir(exist_ok=False);src=package/'source';src.mkdir();runtime=package/'runtime';runtime.mkdir();shutil.copyfile(binary,runtime/'akagi-native.exe')
    engine=workspace/'engines/akagi-native';files=[engine/'Cargo.toml',engine/'Cargo.lock',*sorted((engine/'src').glob('*.rs')),engine/'vendor/LICENSE.txt',engine/'vendor/NOTICE',engine/'vendor/native_bot/Cargo.toml',engine/'vendor/native_bot/Cargo.lock',engine/'vendor/native_bot/README.md',*sorted((engine/'vendor/native_bot/src').glob('*.rs')),*sorted((engine/'vendor/native_bot/tests').glob('*.rs')),*sorted((engine/'vendor/native_bot/tests/fixtures').glob('*.json'))]
    files += [workspace/'LICENSE',workspace/'scripts/build-akagi-native.ps1',workspace/'scripts/akagi-native-official-reference.rs',workspace/'scripts/validate-akagi-native.cjs',workspace/'scripts/package-akagi-native.py']
    files += [p for p in [engine/'PATCHES.md',engine/'README.md'] if p.exists()]
    records=[];patches=[]
    for p in files:
        target=src/p.relative_to(workspace);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
        rel=p.relative_to(engine).as_posix() if engine in p.parents else None
        original=None
        if rel and rel.startswith('vendor/native_bot/'): original=up/rel[len('vendor/'):]
        elif rel=='vendor/LICENSE.txt':original=up/'LICENSE.txt'
        elif rel=='vendor/NOTICE':original=up/'NOTICE'
        if rel=='vendor/native_bot/tests/fixtures/parity_4p.json': original=up/'native_bot/weights/parity_4p.json'
        if original and original.exists():
            changed=sha(p)!=sha(original);records.append({'path':str(original.relative_to(up)).replace('\\','/'),'upstreamSha256':sha(original),'localPath':p.relative_to(workspace).as_posix(),'localSha256':sha(p),'modified':changed})
            if changed:
                patches.extend(difflib.unified_diff(original.read_text(encoding='utf8').splitlines(True),p.read_text(encoding='utf-8-sig').splitlines(True),fromfile='upstream/'+original.relative_to(up).as_posix(),tofile=p.relative_to(workspace).as_posix()))
    dump(src/'UPSTREAM-FILES.json',{'repository':'https://github.com/shinkuan/Akagi','commit':'1fb16453ae0b7b0a820510ea1d3dbd01b6939082','files':records});(src/'LOCAL.patch').write_text(''.join(patches),encoding='utf8')
    meta=json.loads((evidence/'cargo-metadata.json').read_text(encoding='utf-8-sig'));ids={n['id'] for n in meta['resolve']['nodes']};deps=[]
    for p in meta['packages']:
        if p['id'] not in ids or not p['source']:continue
        archive=next((evidence/'cargo-home/registry/cache').glob('*/'+p['name']+'-'+p['version']+'.crate'));dest=src/'dependencies';dest.mkdir(exist_ok=True);omitted=[]
        with tarfile.open(archive) as t:
            for member in t.getmembers():
                name=Path(member.name)
                if name.is_absolute() or '..' in name.parts or member.issym() or member.islnk():raise ValueError('unsafe crate entry')
                if member.isfile() and name.suffix.lower() in ['.pt','.pth','.safetensors','.onnx']:
                    omitted.append(member.name);continue
                if member.isfile():
                    target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(t.extractfile(member).read())
        dep=dest/(p['name']+'-'+p['version'])
        for extra in (evidence/'upstream-licenses').glob(p['name']+'-LICENSE*'):
            shutil.copyfile(extra,dep/extra.name[len(p['name'])+1:])
        checks={x.relative_to(dep).as_posix():sha(x) for x in sorted(dep.rglob('*')) if x.is_file() and x.name!='.cargo-checksum.json'};dump(dep/'.cargo-checksum.json',{'files':checks,'package':sha(archive)})
        licenses=[x.relative_to(dep).as_posix() for x in dep.rglob('*') if x.is_file() and (x.name.upper().startswith(('LICENSE','NOTICE','COPYING','COPYRIGHT')) or x.name=='AUTHORS')]
        deps.append({'name':p['name'],'version':p['version'],'license':p['license'],'registryCrateSha256':sha(archive),'licenseFiles':licenses,'omittedNonInferenceTensorTestFixtures':omitted})
    config=src/'.cargo/config.toml';config.parent.mkdir();config.write_text('[source.crates-io]\nreplace-with="vendored-sources"\n[source.vendored-sources]\ndirectory="dependencies"\n',encoding='utf8');dump(src/'DEPENDENCIES.json',{'target':'x86_64-pc-windows-gnu','packages':deps})
    licensing=runtime/'licenses';licensing.mkdir();shutil.copyfile(engine/'vendor/LICENSE.txt',licensing/'Akagi-LICENSE.txt');shutil.copyfile(engine/'vendor/NOTICE',licensing/'Akagi-NOTICE');shutil.copyfile(workspace/'LICENSE',licensing/'wrapper-MIT-LICENSE')
    rtlic=licensing/'rust';rtlic.mkdir();
    for name in ['COPYRIGHT.html','COPYRIGHT-library.html']:
        shutil.copyfile(rust/'share/doc/rust'/name,rtlic/name)
    shutil.copytree(rust/'share/doc/rust/licenses',rtlic/'licenses')
    for name in ['LICENSE-APACHE','LICENSE-MIT','COPYRIGHT']:
        original=rust.parent/'rust-1.99.1-x86_64-pc-windows-gnu'/name
        if original.exists():shutil.copyfile(original,rtlic/name)
    # Dependency licenses are also available alongside every vendored dependency in sources.zip.
    dump(licensing/'DEPENDENCIES.json',{'packages':deps});shutil.copyfile(evidence/'pe-imports.txt',runtime/'pe-imports.txt')
    dump(runtime/'BUILD.json',{'buildId':build,'binarySha256':binary_sha,'upstreamCommit':'1fb16453ae0b7b0a820510ea1d3dbd01b6939082','rust':'1.99.1','target':'x86_64-pc-windows-gnu','cpu':'generic x86-64; runtime-dispatched library kernels','linker':'bundled rust-lld; ld.lld; link-self-contained=yes','weightsEmbedded':False,'protocol':'akagi-native-worker-v1','patchRevision':'p1','cargoLockSha256':sha(engine/'Cargo.lock'),'windowsSystemDlls':['api-ms-win-core-synch-l1-2-0.dll','KERNEL32.dll','msvcrt.dll','ntdll.dll','USERENV.dll','WS2_32.dll','bcryptprimitives.dll']})
    source_json=json.loads((workspace/'agent/akagi-native-source.json').read_text(encoding='utf8'));source_json['runtime']={'id':family,'buildId':build,'executable':'akagi-native.exe','archive':None,'files':[{'name':'akagi-native.exe','sha256':binary_sha,'size':binary.stat().st_size}]};dump(src/'MODEL-SOURCE.json',source_json)
    source_zip=runtime/'sources.zip';zip_tree(src,source_zip)
    # Scan the complete binary for exact weight payloads, not just file names.
    weights=up/'native_bot/weights'
    for weight in weights.glob('*.safetensors'):
        if weight.read_bytes() in binary.read_bytes():raise ValueError('embedded weights found')
    entries=[{'name':p.relative_to(runtime).as_posix(),'sha256':sha(p),'size':p.stat().st_size} for p in sorted(runtime.rglob('*')) if p.is_file()]
    archive=package/(family+'.zip');zip_tree(runtime,archive)
    lock={'id':family,'buildId':build,'executable':'akagi-native.exe','archive':{'name':archive.name,'url':None,'sha256':sha(archive),'size':archive.stat().st_size},'files':entries}
    dump(package/'runtime-lock.json',lock);dump(package/'source-archive.json',{'name':'sources.zip','sha256':sha(source_zip),'size':source_zip.stat().st_size,'dependencies':len(deps),'containsTrainedWeights':False,'omittedTensorFixtures':[d for d in deps if d['omittedNonInferenceTensorTestFixtures']]});print(json.dumps({'directory':str(package),'runtime':lock},ensure_ascii=False))
if __name__=='__main__':main()
