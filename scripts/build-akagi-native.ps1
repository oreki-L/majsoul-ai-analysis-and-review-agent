param(
  [Parameter(Mandatory=$true)][string]$RustBin,
  [string]$OutputDirectory = 'research/evidence/akagi-v3-implementation',
  [string]$Weights,
  [switch]$Test
)
$ErrorActionPreference='Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$resolvedOutput = [IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
$evidenceRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'research/evidence')) + [IO.Path]::DirectorySeparatorChar
if (!$resolvedOutput.StartsWith($evidenceRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Build output must stay inside research/evidence.' }
$rust = (Resolve-Path -LiteralPath $RustBin).Path
$lld = Join-Path $rust '../lib/rustlib/x86_64-pc-windows-gnu/bin/rust-lld.exe'
if (!(Test-Path -LiteralPath $lld)) {throw 'Rust GNU rust-lld.exe is required.'}
$drive=$null
foreach($letter in @('Z','Y','X','W','V','U','T','S')) { if(!(Test-Path ($letter+':/'))) { $drive=$letter;break } }
if(!$drive){throw 'No temporary drive letter available for ASCII GNU build paths.'}
$oldPath=$env:PATH;$oldCargo=$env:CARGO_HOME;$oldTarget=$env:CARGO_TARGET_DIR;$oldFlags=$env:RUSTFLAGS;$oldWeights=$env:AKAGI_WEIGHTS_PATH
try {
  & subst ($drive+':') $workspace
  if($LASTEXITCODE){throw 'Temporary build mapping failed.'}
  $mapped=$drive+':/'
  $relative=[IO.Path]::GetRelativePath($workspace,$resolvedOutput).Replace('\','/')
  $env:PATH=$rust+';'+$oldPath
  $env:CARGO_HOME=$mapped+$relative+'/cargo-home'
  $env:CARGO_TARGET_DIR=$mapped+$relative+'/target'
  $env:RUSTFLAGS='-C link-self-contained=yes -C linker-flavor=ld.lld -C linker='+$lld.Replace('\','/')+' --remap-path-prefix='+$workspace+'=/workspace --remap-path-prefix='+$drive+':=/workspace'
  $manifest=$mapped+'engines/akagi-native/Cargo.toml'
  & (Join-Path $rust 'cargo.exe') build --release --locked --manifest-path $manifest
  if($LASTEXITCODE){throw 'Native build failed.'}
  if($Test) {
    if(!$Weights){throw 'Explicit external -Weights is required for real-weight tests.'}
    $env:AKAGI_WEIGHTS_PATH=(Resolve-Path -LiteralPath $Weights).Path
    & (Join-Path $rust 'cargo.exe') test --release --locked --manifest-path $manifest --bin akagi-native
    if($LASTEXITCODE){throw 'Native stage-0 tests failed.'}
    & (Join-Path $rust 'cargo.exe') test --release --locked --manifest-path ($mapped+'engines/akagi-native/vendor/native_bot/Cargo.toml')
    if($LASTEXITCODE){throw 'Patched upstream tests failed.'}
  }
  Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $resolvedOutput 'target/release/akagi-native.exe')
} finally {
  if($drive){ & subst ($drive+':') /D }
  $env:PATH=$oldPath;$env:CARGO_HOME=$oldCargo;$env:CARGO_TARGET_DIR=$oldTarget;$env:RUSTFLAGS=$oldFlags;$env:AKAGI_WEIGHTS_PATH=$oldWeights
}
