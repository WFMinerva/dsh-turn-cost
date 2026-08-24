[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Resolve-DshHome {
  $candidate = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' } else { $env:DSH_HOME }
  return [IO.Path]::GetFullPath($candidate)
}

function Invoke-KimiJson([string]$Method, [string]$Path, [string]$Token) {
  $headers = @{ Authorization = "Bearer $Token" }
  if ($Method -eq 'Post') {
    return Invoke-RestMethod -Method $Method -Uri "http://127.0.0.1:58627$Path" -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 3
  }
  return Invoke-RestMethod -Method $Method -Uri "http://127.0.0.1:58627$Path" -Headers $headers -TimeoutSec 3
}

$dshHome = Resolve-DshHome
$statePath = Join-Path $dshHome 'turn-cost-installer\state.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw 'STATE_NOT_FOUND：请先运行安装器' }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$toolsBin = Join-Path $dshHome 'turn-cost-tools\node_modules\.bin'
$env:Path = "$toolsBin;$($env:Path)"
$tokenPath = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.kimi-code\server.token'
$startedKimi = $false

try {
  $healthy = $false
  try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:58627/api/v1/healthz' -TimeoutSec 1; $healthy = ($null -ne $health) } catch { $healthy = $false }
  if (-not $healthy) {
    $kimi = Join-Path $toolsBin 'kimi.cmd'
    if (-not (Test-Path -LiteralPath $kimi)) { throw 'KIMI_CLI_MISSING：请先运行“补齐额度CLI.cmd”' }
    $process = Start-Process -FilePath $kimi -ArgumentList @('web', '--no-open', '--port', '58627') -WindowStyle Hidden -PassThru
    $startedKimi = $true
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 250
      try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:58627/api/v1/healthz' -TimeoutSec 1; $healthy = ($null -ne $health) } catch { $healthy = $false }
    } while (-not $healthy -and [DateTime]::UtcNow -lt $deadline -and -not $process.HasExited)
    if (-not $healthy) { throw 'KIMI_SERVER_START_FAILED：58627 未出现官方健康响应' }
  }
  if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) { throw 'KIMI_SERVER_TOKEN_NOT_FOUND：请先运行 kimi login' }
  $token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
  $meta = Invoke-KimiJson 'Get' '/api/v1/meta' $token
  if ($null -eq $meta -or [int]$meta.code -ne 0) { throw 'KIMI_SERVER_IDENTITY_FAILED：端口不是可认证的 Kimi 服务' }

  $file = [string]$state.dsh.executable
  $args = @($state.dsh.prefix) + @('web')
  & $file @args
  if ($LASTEXITCODE -ne 0) { throw "DSH_EXIT_$LASTEXITCODE" }
} finally {
  if ($startedKimi -and (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    try {
      $token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
      $shutdown = Invoke-KimiJson 'Post' '/api/v1/shutdown' $token
      if ($null -eq $shutdown -or [int]$shutdown.code -ne 0) { throw 'KIMI_SHUTDOWN_REJECTED' }
    } catch { Write-Warning '本启动器创建的 Kimi 服务未能通过官方 API 关闭，请检查 58627。' }
  }
}
