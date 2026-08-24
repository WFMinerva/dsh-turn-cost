[CmdletBinding()]
param(
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $repo 'dist' }
$package = Get-Content -Raw -LiteralPath (Join-Path $repo 'package.json') | ConvertFrom-Json
$version = [string]$package.version
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('dsh-turn-cost-installer-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $tempRoot 'package'
$payload = Join-Path $stage 'payload'

try {
  New-Item -ItemType Directory -Force -Path $payload | Out-Null
  Push-Location $repo
  try {
    & node --test
    if ($LASTEXITCODE -ne 0) { throw 'TESTS_FAILED' }
    $packJson = & npm pack --ignore-scripts --json --cache (Join-Path $tempRoot 'npm-cache') --pack-destination $payload
    if ($LASTEXITCODE -ne 0) { throw 'NPM_PACK_FAILED' }
  } finally { Pop-Location }
  $packResult = $packJson | ConvertFrom-Json
  $tgzName = [string]$packResult[0].filename
  $tgzPath = Join-Path $payload $tgzName
  if (-not (Test-Path -LiteralPath $tgzPath -PathType Leaf)) { throw 'PACK_OUTPUT_MISSING' }

  Get-ChildItem -LiteralPath (Join-Path $repo 'installer') -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force
  }
  $pluginHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $tgzPath).Hash.ToUpperInvariant()
  $manifest = [ordered]@{
    schemaVersion = 1
    installerVersion = $version
    dsh = [ordered]@{ package = '@deepseek-ai/dsh'; version = '0.1.1-rc.2' }
    plugin = [ordered]@{ name = 'dsh-turn-cost'; version = $version; file = $tgzName; sha256 = $pluginHash }
    tools = [ordered]@{ kimi = '@moonshot-ai/kimi-code@0.38.0'; bailian = 'bailian-cli@1.17.0' }
    providers = @('deepseek-official', 'kimi-coding', 'qwen-token-plan-cn', 'qwen-token-plan')
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'installer-manifest.json') -Encoding UTF8

  $content = @()
  Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    $content += [ordered]@{ path = $relative; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToUpperInvariant() }
  }
  [ordered]@{ schemaVersion = 1; files = $content } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'content-sha256.json') -Encoding UTF8

  $out = [IO.Path]::GetFullPath($OutputDirectory)
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $zip = Join-Path $out "dsh-turn-cost-setup-$version-win-x64.zip"
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
  [pscustomobject]@{ zip = $zip; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToUpperInvariant(); plugin = $tgzName; pluginSha256 = $pluginHash } | ConvertTo-Json -Depth 4
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
