[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [switch]$ReproducibilityCheck
)

# dsh-turn-cost Windows 一键部署包构建。
# 版本唯一来源：插件版本 = package.json；部署固定项 = ../versions.json（本脚本不再内联任何版本号）。
# ZIP 组装为确定性实现（通用层 hashes.ps1 New-DeterministicZip）：条目排序 + 固定时间戳，
# -ReproducibilityCheck 连续构建两次并断言整包 SHA-256 相等（双构建哈希相等测试）。

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hashesLib = Join-Path $repo 'vendor\maintenance\hashes.ps1'
if (-not (Test-Path -LiteralPath $hashesLib -PathType Leaf)) {
  throw 'VENDOR_MISSING: 缺少 vendor\maintenance\hashes.ps1（先在 tool-library 侧执行 publish-vendor）'
}
. $hashesLib

$versions = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repo 'versions.json') | ConvertFrom-Json
$package = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repo 'package.json') | ConvertFrom-Json
$version = [string]$package.version

function Build-Once([string]$ZipPath) {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('dsh-turn-cost-installer-' + [Guid]::NewGuid().ToString('N'))
  $stage = Join-Path $tempRoot 'package'
  $payload = Join-Path $stage 'payload'
  try {
    New-Item -ItemType Directory -Force -Path $payload | Out-Null
    Push-Location $repo
    try {
      # 输出必须静默：任何泄漏进函数输出流的行都会污染 Build-Once 的返回值
      & node --test 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'TESTS_FAILED' }
      $packJson = & npm pack --ignore-scripts --json --cache (Join-Path $tempRoot 'npm-cache') --pack-destination $payload 2>$null
      if ($LASTEXITCODE -ne 0) { throw 'NPM_PACK_FAILED' }
    } finally { Pop-Location }
    $packResult = $packJson | ConvertFrom-Json
    $tgzName = [string]$packResult[0].filename
    $tgzPath = Join-Path $payload $tgzName
    if (-not (Test-Path -LiteralPath $tgzPath -PathType Leaf)) { throw 'PACK_OUTPUT_MISSING' }

    Get-ChildItem -LiteralPath (Join-Path $repo 'installer') -Force | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force
    }
    $pluginHash = Get-FileSha256 $tgzPath
    $kimiName = '@moonshot-ai/kimi-code'
    $manifest = [ordered]@{
      schemaVersion = 1
      installerVersion = $version
      dsh = [ordered]@{ package = [string]$versions.dsh.package; version = [string]$versions.dsh.version }
      plugin = [ordered]@{ name = 'dsh-turn-cost'; version = $version; file = $tgzName; sha256 = $pluginHash }
      tools = [ordered]@{
        kimi = ($kimiName + '@' + [string]$versions.tools.$kimiName)
        bailian = ('bailian-cli@' + [string]$versions.tools.'bailian-cli')
      }
      providers = @($versions.providers)
    }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'installer-manifest.json') -Encoding UTF8

    $files = @()
    foreach ($rel in (Get-RelativeFiles $stage)) {
      $files += [ordered]@{ path = $rel; sha256 = (Get-FileSha256 (Join-Path $stage ($rel.Replace('/', '\')))) }
    }
    [ordered]@{ schemaVersion = 1; files = $files } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'content-sha256.json') -Encoding UTF8

    # 确定性 ZIP（条目排序 + 固定时间戳）；content-sha256.json 需先于最终清单自身写入——
    # 它描述的是「除自身外」的条目集合，清单生成后再把它并入 stage，ZIP 含全部文件。
    $zipHash = New-DeterministicZip $stage $ZipPath
    return [pscustomobject]@{ zip = $ZipPath; sha256 = $zipHash; plugin = $tgzName; pluginSha256 = $pluginHash }
  } finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
  }
}

$out = [IO.Path]::GetFullPath($(if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { Join-Path $repo 'dist' } else { $OutputDirectory }))
New-Item -ItemType Directory -Force -Path $out | Out-Null
$zipPath = Join-Path $out "dsh-turn-cost-setup-$version-win-x64.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

$result = Build-Once $zipPath

if ($ReproducibilityCheck) {
  $secondZip = Join-Path ([IO.Path]::GetTempPath()) ('dsh-repro-' + [Guid]::NewGuid().ToString('N') + '.zip')
  try {
    $second = Build-Once $secondZip
    if ([string]$second.sha256 -ne [string]$result.sha256) {
      throw ('REPRODUCIBILITY_FAILED: 双构建整包哈希不等（' + [string]$result.sha256 + ' vs ' + [string]$second.sha256 + '）——按方案降级条款处理，不得宣称整包可复现')
    }
    Write-Output ("REPRODUCIBILITY: PROVEN（双构建整包哈希相等 " + [string]$result.sha256 + "）")
  } finally {
    if (Test-Path -LiteralPath $secondZip) { Remove-Item -LiteralPath $secondZip -Force }
  }
}

# 内容清单随制品留一份（验收依据：逐文件哈希）
$stagelessManifest = Join-Path $out 'content-sha256.json'
$extract = Join-Path ([IO.Path]::GetTempPath()) ('dsh-extract-' + [Guid]::NewGuid().ToString('N'))
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extract -Force
  Copy-Item -LiteralPath (Join-Path $extract 'content-sha256.json') -Destination $stagelessManifest -Force
} finally {
  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
}

[pscustomobject]@{ zip = $zipPath; sha256 = [string]$result.sha256; plugin = [string]$result.plugin; pluginSha256 = [string]$result.pluginSha256; contentManifest = $stagelessManifest } | ConvertTo-Json -Depth 4
