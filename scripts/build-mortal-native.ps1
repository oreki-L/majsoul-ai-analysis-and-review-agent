param(
  [Parameter(Mandatory=$true)][string]$SourceDir,
  [Parameter(Mandatory=$true)][string]$RustBin,
  [Parameter(Mandatory=$true)][string]$GccBin,
  [Parameter(Mandatory=$true)][string]$Python,
  [Parameter(Mandatory=$true)][string]$TargetDir,
  [Parameter(Mandatory=$true)][string]$CargoHome
)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$manifest=Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'agent/mortal-source.json') | ConvertFrom-Json
$sourceRoot=(Resolve-Path -LiteralPath $SourceDir).Path
if ((Get-FileHash -LiteralPath (Join-Path $sourceRoot 'Cargo.lock')).Hash.ToLower() -ne $manifest.native.cargoLockSha256) { throw 'CARGO_LOCK_MISMATCH' }
$rustRoot=Split-Path (Resolve-Path -LiteralPath $RustBin).Path -Parent
$env:PATH=$RustBin+';'+$GccBin+';'+$env:PATH
$env:CARGO_HOME=$CargoHome
$env:CARGO_TARGET_DIR=$TargetDir
$env:PYO3_PYTHON=$Python
# GNU ld cannot reliably read Chinese paths. Use an ASCII directory for TargetDir;
# use a subst drive for RustBin/GccBin if the checkout path is non-ASCII.
$env:RUSTFLAGS='--sysroot '+$rustRoot+' -C link-self-contained=yes'
& (Join-Path $RustBin 'cargo.exe') build --manifest-path (Join-Path $sourceRoot 'Cargo.toml') --release --locked -p libriichi --no-default-features --features pymod
if ($LASTEXITCODE -ne 0) { throw 'NATIVE_BUILD_FAILED' }
Get-FileHash -LiteralPath (Join-Path $TargetDir 'release/riichi.dll')
