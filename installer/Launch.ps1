[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Resolve-DshHome {
  $candidate = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' } else { $env:DSH_HOME }
  return [IO.Path]::GetFullPath($candidate)
}

function Resolve-KimiHome {
  $configured = [string]$env:KIMI_CODE_HOME
  if (-not [string]::IsNullOrWhiteSpace($configured) -and [IO.Path]::IsPathRooted($configured)) {
    return [IO.Path]::GetFullPath($configured)
  }
  return Join-Path ([Environment]::GetFolderPath('UserProfile')) '.kimi-code'
}

function Test-TcpPort([int]$Port) {
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(300)) { $client.Close(); return $false }
    $client.EndConnect($async); $client.Close(); return $true
  } catch { return $false }
}

function Test-KimiHealth {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:58627/api/v1/healthz' -TimeoutSec 1
    return ($null -ne $health)
  } catch { return $false }
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
$tokenPath = Join-Path (Resolve-KimiHome) 'server.token'
if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) { throw 'KIMI_SERVER_TOKEN_NOT_FOUND：请先运行“配置额度登录.cmd”完成 kimi login' }
$token = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
if ([string]::IsNullOrWhiteSpace($token)) { throw 'KIMI_SERVER_TOKEN_INVALID：Kimi server token 为空，请重新运行 kimi login' }
$startedKimi = $false

try {
  $healthy = Test-KimiHealth
  if (-not $healthy) {
    if (Test-TcpPort 58627) { throw 'KIMI_SERVER_IDENTITY_FAILED：58627 已被非健康 Kimi 服务占用，未终止任何进程' }
    $kimi = Join-Path $toolsBin 'kimi.cmd'
    if (-not (Test-Path -LiteralPath $kimi -PathType Leaf)) { throw 'KIMI_CLI_MISSING：请先运行“补齐额度CLI.cmd”' }
    $process = Start-Process -FilePath $kimi -ArgumentList @('web', '--no-open', '--port', '58627') -WindowStyle Hidden -PassThru
    $startedKimi = $true
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 250
      $healthy = Test-KimiHealth
    } while (-not $healthy -and [DateTime]::UtcNow -lt $deadline -and -not $process.HasExited)
    if (-not $healthy) { throw 'KIMI_SERVER_START_FAILED：58627 未出现官方健康响应' }
  }

  $meta = Invoke-KimiJson 'Get' '/api/v1/meta' $token
  if ($null -eq $meta -or [int]$meta.code -ne 0) { throw 'KIMI_SERVER_IDENTITY_FAILED：58627 不是当前 OAuth 可认证的 Kimi 服务' }

  $file = [string]$state.dsh.executable
  $args = @($state.dsh.prefix) + @('web')
  & $file @args
  if ($LASTEXITCODE -ne 0) { throw "DSH_EXIT_$LASTEXITCODE" }
} finally {
  if ($startedKimi) {
    try {
      $shutdown = Invoke-KimiJson 'Post' '/api/v1/shutdown' $token
      if ($null -eq $shutdown -or [int]$shutdown.code -ne 0) { throw 'KIMI_SHUTDOWN_REJECTED' }
    } catch { Write-Warning '本启动器创建的 Kimi 服务未能通过官方 API 关闭，请检查 58627。' }
  }
}
