[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = 'help',
  [switch]$Json,
  [string]$Skip = '',
  [string]$ReportOut = '',
  [switch]$ReproducibilityCheck
)
# maintenance.ps1 — dsh-turn-cost 维护入口（薄路由）
# 核心层在 vendor/maintenance/（由 tool-library publish-vendor 从干净提交发布，禁止手改）。
# 适配层在 maintenance/adapter.ps1（本项目专属：探测/安装器/生命周期/回滚/项目 manifest）。
# 注意：param 块之前必须全 ASCII（PS5.1 对 param 前非 ASCII 注释会破坏 switch 绑定）
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$validCommands = @('verify', 'build', 'acceptance', 'doctor', 'selftest', 'sync-versions', 'help')
if ($validCommands -notcontains $Command) {
  Write-Host ("USAGE_ERROR: 未知子命令 '" + $Command +"'；可用：" + ($validCommands -join ', '))
  exit 2
}
$core = Join-Path $PSScriptRoot 'vendor\maintenance\core.ps1'
if (-not (Test-Path -LiteralPath $core -PathType Leaf)) {
  throw 'VENDOR_MISSING: vendor\maintenance\core.ps1 不存在（在 tool-library 仓库运行 publish-vendor -Target 本仓库）'
}
# 命名参数转发必须用哈希表 splat（数组 splat 是位置绑定，switch 名会变成位置参数而绑定失败）
$forward = @{}
if ($Json) { $forward['Json'] = $true }
if ($ReproducibilityCheck) { $forward['ReproducibilityCheck'] = $true }
& $core -Command $Command -Adapter (Join-Path $PSScriptRoot 'maintenance\adapter.ps1') -Skip $Skip -ReportOut $ReportOut @forward
exit $LASTEXITCODE
