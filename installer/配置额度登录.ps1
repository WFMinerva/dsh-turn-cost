[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$dshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
  Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'
} else { [IO.Path]::GetFullPath($env:DSH_HOME) }
$toolsBin = Join-Path $dshHome 'turn-cost-tools\node_modules\.bin'
$kimi = Join-Path $toolsBin 'kimi.cmd'
$bl = Join-Path $toolsBin 'bl.cmd'
if (-not (Test-Path -LiteralPath $kimi -PathType Leaf) -or -not (Test-Path -LiteralPath $bl -PathType Leaf)) {
  throw 'CLI_MISSING：请先运行“补齐额度CLI.cmd”'
}

Write-Host '[dsh-turn-cost] 第一步：完成 Kimi Code OAuth。浏览器中的账号确认必须由你本人操作。'
& $kimi login
$kimiExit = $LASTEXITCODE
$configuredKimiHome = [string]$env:KIMI_CODE_HOME
$kimiHome = if (-not [string]::IsNullOrWhiteSpace($configuredKimiHome) -and [IO.Path]::IsPathRooted($configuredKimiHome)) {
  [IO.Path]::GetFullPath($configuredKimiHome)
} else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.kimi-code' }
$tokenPath = Join-Path $kimiHome 'server.token'
$token = if (Test-Path -LiteralPath $tokenPath -PathType Leaf) { (Get-Content -Raw -LiteralPath $tokenPath).Trim() } else { '' }
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "KIMI_LOGIN_FAILED：未生成有效 server.token，exit=$kimiExit"
}
$kimiPending = $kimiExit -ne 0
if ($kimiPending) { Write-Warning 'Kimi CLI 在 Windows 退出阶段返回非零；server.token 非空，但 OAuth 有效性仍须由启动器真实认证探测。' }

Write-Host '[dsh-turn-cost] 第二步：完成百炼控制台 OAuth。若 CLI 未自动打开浏览器，请复制它打印的完整 https:// 链接到浏览器。'
& $bl auth login --console --console-site domestic
if ($LASTEXITCODE -ne 0) { throw "BLAUTH_LOGIN_FAILED：exit=$LASTEXITCODE" }

Write-Host '[dsh-turn-cost] 验证百炼 Token Plan 额度读取……'
& $bl usage token-plan --output json
if ($LASTEXITCODE -ne 0) { throw "BL_USAGE_FAILED：请确认浏览器已登录正确的百炼账号后重试，exit=$LASTEXITCODE" }
if ($kimiPending) {
  Write-Host '[dsh-turn-cost] AUTH_PENDING：百炼 Token Plan 已可读取；Kimi token 已落盘，但须运行日常启动器完成真实认证探测。'
} else {
  Write-Host '[dsh-turn-cost] AUTH_OK：Kimi OAuth 已落盘，百炼 Token Plan 已可读取。'
}
