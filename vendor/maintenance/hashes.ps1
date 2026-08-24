# hashes.ps1 — 统一维护基础设施 · SHA-256 清单与确定性 ZIP（通用层）
# 范式来源：TL-075 generate_baseline_manifest.py（双空格清单）、TL-076 compare（三态比对）、
# TL-072 build_release.py（固定条目元数据的确定性 ZIP）。

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Assert-ChildPath([string]$Root, [string]$Path) {
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $pathFull = [IO.Path]::GetFullPath($Path)
  if (-not $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "PATH_OUTSIDE_ROOT: 拒绝操作根之外的路径"
  }
  return $pathFull
}

function Get-RelativeFiles([string]$Dir) {
  $dirFull = [IO.Path]::GetFullPath($Dir)
  Get-ChildItem -LiteralPath $Dir -Recurse -File | ForEach-Object {
    $_.FullName.Substring($dirFull.Length + 1).Replace('\', '/')
  } | Sort-Object
}

function New-DirManifest([string]$Dir) {
  $lines = @()
  foreach ($rel in Get-RelativeFiles $Dir) {
    $hash = Get-FileSha256 (Join-Path $Dir ($rel.Replace('/', '\')))
    $lines += "$hash  $rel"
  }
  return ($lines -join "`n") + "`n"
}

function Test-DirManifest([string]$Dir, [string]$ManifestPath) {
  $expected = @{}
  foreach ($line in (Get-Content -LiteralPath $ManifestPath)) {
    if (-not $line.Trim()) { continue }
    $hash, $rel = $line -split '\s\s', 2
    $expected[$rel] = $hash.ToUpperInvariant()
  }
  $actual = @{}
  foreach ($rel in Get-RelativeFiles $Dir) {
    $actual[$rel] = Get-FileSha256 (Join-Path $Dir ($rel.Replace('/', '\')))
  }
  $missing = @($expected.Keys | Where-Object { -not $actual.ContainsKey($_) } | Sort-Object)
  $extra = @($actual.Keys | Where-Object { -not $expected.ContainsKey($_) } | Sort-Object)
  $mismatch = @($expected.Keys | Where-Object { $actual.ContainsKey($_) -and $actual[$_] -ne $expected[$_] } | Sort-Object)
  return @{ ok = ($missing.Count -eq 0 -and $extra.Count -eq 0 -and $mismatch.Count -eq 0); missing = $missing; extra = $extra; mismatch = $mismatch }
}

function New-DeterministicZip([string]$SourceDir, [string]$OutZip) {
  # TL-072 模式：条目按路径排序 + 固定时间戳/属性 → 同一输入整包 SHA-256 可复现
  Add-Type -AssemblyName System.IO.Compression
  $outFull = [IO.Path]::GetFullPath($OutZip)
  if (Test-Path -LiteralPath $outFull) { Remove-Item -LiteralPath $outFull -Force }
  $fixedTime = New-Object DateTimeOffset(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
  $stream = [IO.File]::Open($outFull, [IO.FileMode]::Create)
  try {
    $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
      foreach ($rel in Get-RelativeFiles $SourceDir) {
        $entry = $archive.CreateEntry($rel, [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $fixedTime
        $entryStream = $entry.Open()
        try {
          $bytes = [IO.File]::ReadAllBytes((Join-Path $SourceDir ($rel.Replace('/', '\'))))
          $entryStream.Write($bytes, 0, $bytes.Length)
        } finally { $entryStream.Dispose() }
      }
    } finally { $archive.Dispose() }
  } finally { $stream.Dispose() }
  return (Get-FileSha256 $outFull)
}
