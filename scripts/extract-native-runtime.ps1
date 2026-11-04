param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Manifest, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($Destination)
$lock = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$expected = @{}
$directories = @{}
foreach ($file in $lock.files) {
  if ($expected.ContainsKey($file.name)) { throw 'NATIVE_ARCHIVE_DUPLICATE' }
  $expected[$file.name] = $file
  $parent = [IO.Path]::GetDirectoryName($file.name.Replace('/', '\'))
  while ($parent) { $directories[$parent.Replace('\', '/') + '/'] = $true; $parent = [IO.Path]::GetDirectoryName($parent) }
}
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $seen = @{}
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName
    if ($seen.ContainsKey($name) -or $name.Contains('\') -or $name.StartsWith('/') -or $name -match '(^|/)\.{1,2}(/|$)' -or $name -match '[:\x00-\x1f]') { throw 'NATIVE_ARCHIVE_PATH_REFUSED' }
    $seen[$name] = $true
    $mode = ($entry.ExternalAttributes -shr 16) -band 0xF000
    if (($mode -ne 0 -and $mode -ne 0x8000 -and $mode -ne 0x4000) -or ($entry.ExternalAttributes -band 0x400)) { throw 'NATIVE_ARCHIVE_LINK_REFUSED' }
    if ($name.EndsWith('/')) { if (!$directories.ContainsKey($name) -or $entry.Length -ne 0) { throw 'NATIVE_ARCHIVE_UNLISTED' }; continue }
    if (!$expected.ContainsKey($name) -or $entry.Length -ne $expected[$name].size) { throw 'NATIVE_ARCHIVE_UNLISTED' }
  }
  foreach ($name in $expected.Keys) { if (!$seen.ContainsKey($name)) { throw 'NATIVE_ARCHIVE_MISSING' } }
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName.EndsWith('/')) { continue }
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $entry.FullName))
    if (!$target.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'NATIVE_ARCHIVE_PATH_REFUSED' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    $inputStream = $entry.Open()
    try {
      $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew)
      try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
    } finally { $inputStream.Dispose() }
  }
} finally { $zip.Dispose() }
