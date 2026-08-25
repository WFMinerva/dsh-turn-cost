[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = 'help',
  [string]$Target = '',
  [switch]$Json,
  [string]$Skip = '',
  [string]$ReportOut = '',
  [switch]$ReproducibilityCheck,
  [string]$Adapter = ''
)
# core.ps1 — 统一维护基础设施 · 通用层核心（Windows PowerShell 5.1 兼容）
# 命令契约与退出码语义见 docs/使用说明-统一维护入口.md：
#   0=过；1=有 SKIP 或 WARN（必须看报告）；2=有 FAIL 或用法错误。
# 注意：param 块之前必须全 ASCII（PS5.1 对 param 前非 ASCII 注释会破坏 switch 绑定）

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$script:ValidCommands = @('verify', 'build', 'acceptance', 'doctor', 'selftest', 'publish-vendor', 'sync-versions', 'help')
if ($script:ValidCommands -notcontains $Command) {
  Write-Host ("USAGE_ERROR: 未知子命令 '" + $Command + "'；可用：" + ($script:ValidCommands -join ', '))
  exit 2
}

$script:Here = $PSScriptRoot
. (Join-Path $Here 'redaction.ps1')
. (Join-Path $Here 'hashes.ps1')
. (Join-Path $Here 'envprobe.ps1')
. (Join-Path $Here 'report.ps1')
. (Join-Path $Here 'vendor.ps1')

$script:RepoRoot = [IO.Path]::GetFullPath((Join-Path $Here '..\..'))
$script:Vendored = ((Split-Path -Leaf (Split-Path -Parent $Here)) -eq 'vendor')
$script:Results = New-Object System.Collections.ArrayList
$script:SkipIds = @($Skip -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
# 适配层在脚本顶层点源（函数内点源会随函数作用域消失）；文件缺失时由 Load-Adapter 断言报错
$script:AdapterPath = $Adapter
if ([string]::IsNullOrWhiteSpace($script:AdapterPath)) { $script:AdapterPath = Join-Path $RepoRoot 'maintenance\adapter.ps1' }
if (Test-Path -LiteralPath $script:AdapterPath -PathType Leaf) { . $script:AdapterPath }

function Write-Step([string]$Message) { Write-Host "[maintenance] $Message" }

function Add-Result([string]$Id, [string]$Status, [string]$Summary) {
  [void]$script:Results.Add([pscustomobject]@{ id = $Id; status = $Status; summary = $Summary })
  Write-Step ("{0} {1} — {2}" -f $Status, $Id, $Summary)
}

function Exit-CodeFromResults {
  foreach ($r in $script:Results) { if ($r.status -eq 'FAIL') { return 2 } }
  foreach ($r in $script:Results) { if ($r.status -eq 'WARN' -or $r.status -eq 'SKIP') { return 1 } }
  return 0
}

function Load-Adapter([string]$Hook) {
  # 适配层已在脚本顶层点源（钩子跨函数可见）；此处只做存在性断言
  if (-not (Get-Command $Hook -ErrorAction SilentlyContinue)) {
    throw 'ADAPTER_NOT_FOUND: 适配层未加载（该命令需在已接入的适配仓库中运行）'
  }
}

function Invoke-StepSafe([string]$Id, $StepBlock) {
  if ($script:SkipIds -contains $Id) {
    Add-Result $Id 'SKIP' '调用方显式跳过'
    return 'SKIP'
  }
  try {
    $r = & $StepBlock
    if ($null -ne $r -and $r -is [pscustomobject] -and $r.PSObject.Properties['status']) {
      Add-Result $Id ([string]$r.status) ([string]$r.summary)
      return [string]$r.status
    }
    Add-Result $Id 'PASS' '通过'
    return 'PASS'
  } catch {
    $msg = "$($_.Exception.Message)"
    if ($msg.StartsWith('SKIP:')) { Add-Result $Id 'SKIP' $msg.Substring(5).Trim(); return 'SKIP' }
    if ($msg.StartsWith('WARN:')) { Add-Result $Id 'WARN' $msg.Substring(5).Trim(); return 'WARN' }
    Add-Result $Id 'FAIL' $msg
    return 'FAIL'
  }
}

# ---------- vendor 完整性（防漂移：哈希互校 + 基本路径边界） ----------

function Get-VendorManifestPath { return (Join-Path $RepoRoot 'vendor\manifest.json') }

function Test-VendorIntegrity {
  $manifestPath = Get-VendorManifestPath
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    return [pscustomobject]@{ status = 'FAIL'; summary = 'vendor/manifest.json 缺失（先发布 vendor）' }
  }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $vendorDir = Join-Path $RepoRoot 'vendor\maintenance'
  $problems = New-Object System.Collections.ArrayList
  $expected = @{}
  foreach ($f in $manifest.files) { $expected[[string]$f.path] = ([string]$f.sha256).ToUpperInvariant() }
  $actual = @{}
  if (Test-Path -LiteralPath $vendorDir -PathType Container) {
    foreach ($rel in Get-RelativeFiles $vendorDir) {
      $actual[$rel] = Get-FileSha256 (Join-Path $vendorDir ($rel.Replace('/', '\')))
    }
  }
  foreach ($rel in ($expected.Keys | Sort-Object)) {
    if (-not $actual.ContainsKey($rel)) { [void]$problems.Add("缺失 $rel") }
    elseif ($actual[$rel] -ne $expected[$rel]) { [void]$problems.Add("哈希不符 $rel") }
  }
  foreach ($rel in ($actual.Keys | Sort-Object)) {
    if (-not $expected.ContainsKey($rel)) { [void]$problems.Add("多余 $rel") }
  }
  if ($problems.Count -gt 0) {
    return [pscustomobject]@{ status = 'FAIL'; summary = ('vendor 完整性失败：' + ($problems -join '；')) }
  }
  return [pscustomobject]@{ status = 'PASS'; summary = ("vendor 完整性通过（{0} 文件；来源 commit {1}）" -f $expected.Count, ([string]$manifest.commit).Substring(0, 9)) }
}

# ---------- PS 语法 + UTF-8 BOM 门禁 ----------

function Test-PowerShellGate {
  $exclude = '\\node_modules\\|\\dist\\|\\\.git\\'
  $files = Get-ChildItem -Path $RepoRoot -Recurse -Filter *.ps1 -File |
    Where-Object { $_.FullName -notmatch $exclude }
  $problems = New-Object System.Collections.ArrayList
  foreach ($f in $files) {
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
      [void]$problems.Add("缺 UTF-8 BOM：$($f.Name)")
    }
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors)
    foreach ($e in $errors) { [void]$problems.Add("语法错误 $($f.Name):$($e.Extent.StartLineNumber) $($e.Message)") }
  }
  if ($problems.Count -gt 0) {
    return [pscustomobject]@{ status = 'FAIL'; summary = (($problems | Select-Object -First 6) -join '；') }
  }
  return [pscustomobject]@{ status = 'PASS'; summary = ("{0} 个 ps1 语法与 BOM 全过" -f $files.Count) }
}

# ---------- 命令实现 ----------

function Invoke-VerifyCommand {
  Load-Adapter 'Get-VerifySteps'
  if ($Vendored) {
    [void](Invoke-StepSafe 'vendor-integrity' { Test-VendorIntegrity })
  }
  [void](Invoke-StepSafe 'ps-syntax-bom' { Test-PowerShellGate })
  foreach ($step in (Get-VerifySteps)) {
    [void](Invoke-StepSafe $step.id $step.run)
  }
  $code = Exit-CodeFromResults
  if ($Json) { $script:Results | ConvertTo-Json -Depth 4 }
  Write-Step ("verify 汇总：{0} 项，退出码 {1}" -f $script:Results.Count, $code)
  return $code
}

function Invoke-BuildCommand {
  Load-Adapter 'Invoke-AdapterBuild'
  $verifyCode = Invoke-VerifyCommand
  if ($verifyCode -eq 2) { Write-Step 'verify 未通过，终止 build'; return 2 }
  $buildResult = Invoke-StepSafe 'adapter-build' { Invoke-AdapterBuild -ReproducibilityCheck:$ReproducibilityCheck }
  if ($buildResult -eq 'FAIL') { return 2 }
  $exit = Exit-CodeFromResults
  foreach ($a in (Get-Artifacts)) {
    $abs = Join-Path $RepoRoot ($a.Replace('/', '\'))
    Write-Step ("制品 {0}  SHA-256 {1}" -f $a, (Get-FileSha256 $abs))
  }
  return $exit
}

function Invoke-AcceptanceCommand {
  Load-Adapter 'Get-AcceptanceStages'
  $adapterInfo = Get-AdapterInfo
  $coreCommit = $null
  if ($Vendored) {
    $manifestPath = Get-VendorManifestPath
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
      $coreCommit = [string]((Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json).commit)
    }
  } else {
    $coreCommit = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
  }
  $report = New-MaintenanceReport 'acceptance' $adapterInfo $coreCommit
  $chainFailed = $false
  try {
    foreach ($stage in (Get-AcceptanceStages)) {
      if ($chainFailed) {
        Add-ReportSkip $report $stage.id '前序阶段失败，本阶段跳过'
        continue
      }
      if ($script:SkipIds -contains $stage.id) {
        Add-ReportSkip $report $stage.id '调用方显式跳过'
        continue
      }
      Write-Step ("acceptance 阶段：" + $stage.id)
      try {
        $r = & $stage.run
        $status = if ($null -ne $r -and $r.status) { [string]$r.status } else { 'PASS' }
        $summary = if ($null -ne $r -and $r.summary) { [string]$r.summary } else { '通过' }
        $code = if ($null -ne $r -and $r.code) { [string]$r.code } else { $null }
        Add-ReportCheck $report $stage.id $status $summary $code
        if ($status -eq 'FAIL') { $chainFailed = $true; $script:AcceptanceFailed = $true }
        if ($status -eq 'SKIP') { Add-ReportSkip $report $stage.id $summary }
      } catch {
        Add-ReportCheck $report $stage.id 'FAIL' ("$($_.Exception.Message)") 'STAGE_EXCEPTION'
        $chainFailed = $true
        $script:AcceptanceFailed = $true
      }
    }
  } finally {
    try {
      $cleanup = Invoke-AdapterCleanup
      Set-ReportCleanup $report ([string]$cleanup.status) ([string]$cleanup.summary)
      Write-Step ("清理：" + $cleanup.status + " — " + $cleanup.summary)
    } catch {
      Set-ReportCleanup $report 'FAIL' "CLEANUP_FAILED: $($_.Exception.Message)"
      Write-Step ("清理失败（CLEANUP_FAILED）：" + $_.Exception.Message)
    }
  }
  $exit = 0
  foreach ($c in $report.checks) { if ($c.status -eq 'FAIL') { $exit = 2 } }
  if ($exit -ne 2) {
    foreach ($c in $report.checks) { if ($c.status -eq 'WARN' -or $c.status -eq 'SKIP') { $exit = 1 } }
  }
  if ($report.cleanup -and $report.cleanup.status -eq 'FAIL') { $exit = 2 }
  $outPath = $ReportOut
  if ([string]::IsNullOrWhiteSpace($outPath)) { $outPath = Join-Path $RepoRoot 'acceptance-report.json' }
  [void](Write-Report $report $outPath $exit)
  Write-Step ("acceptance 报告已写：" + $outPath + "（原始件不入库；退出码 " + $exit + "）")
  return $exit
}

function Invoke-DoctorCommand {
  $facts = Get-EnvironmentFacts
  $adapterLoaded = $false
  try { Load-Adapter 'Get-AdapterInfo'; $adapterLoaded = $true } catch { }
  if ($Json) {
    $payload = [ordered]@{ command = 'doctor'; machine = $facts.machine; facts = $facts }
    if ($adapterLoaded) { $payload['adapter'] = Get-AdapterInfo }
    (ConvertTo-RedactedObject $payload) | ConvertTo-Json -Depth 10
  } else {
    Write-Step ("机器档位：" + $facts.machine.class + "；OS build " + $facts.machine.os_build + "；PowerShell " + $facts.machine.powershell)
    Write-Step ("指纹：" + $facts.machine.fingerprint)
    Write-Step ("DSH home：" + $facts.dsh_home.path + "（存在=" + $facts.dsh_home.exists + "）")
    Write-Step ("bundled pnpm：" + $facts.bundled_pnpm.path + "（存在=" + $facts.bundled_pnpm.exists + "）")
    foreach ($name in @('node', 'npm', 'git', 'dsh', 'kimi', 'bl')) {
      $t = $facts.tools.$name
      Write-Step ("工具 {0}: found={1} path={2}" -f $name, $t.found, $t.path)
    }
    Write-Step ("端口 3080=" + $facts.ports.p3080 + "；58627=" + $facts.ports.p58627)
    if ($adapterLoaded) {
      foreach ($step in (Get-DoctorSteps)) { [void](Invoke-StepSafe $step.id $step.run) }
    }
    Write-Step 'doctor 只报事实，不下结论；退出码 0=体检完成'
  }
  return 0
}

function Invoke-SelfTestCommand {
  if (-not $Vendored) {
    $selftest = Join-Path $RepoRoot 'tests\maintenance\selftest.ps1'
    if (-not (Test-Path -LiteralPath $selftest -PathType Leaf)) { throw 'SELFTEST_MISSING' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $selftest
    return $LASTEXITCODE
  }
  Load-Adapter 'Get-SelfTestSteps'
  foreach ($step in (Get-SelfTestSteps)) { [void](Invoke-StepSafe $step.id $step.run) }
  return (Exit-CodeFromResults)
}

function Invoke-PublishVendorCommand {
  if ($Vendored) { throw 'publish-vendor 只能在通用层仓库（tool-library）运行' }
  if ([string]::IsNullOrWhiteSpace($Target)) { throw '用法：maintenance.ps1 publish-vendor -Target <目标仓库根>' }
  $result = Publish-VendorCore $RepoRoot ([IO.Path]::GetFullPath($Target))
  Write-Step ("vendor 已发布：" + $result.files + " 文件；来源 commit " + $result.commit + " → " + $result.vendorDir)
  return 0
}

function Invoke-SyncVersionsCommand {
  Load-Adapter 'Invoke-SyncVersions'
  $dshHome = Resolve-DshHome
  $pnpm = Join-Path $dshHome 'bin\pnpm.cmd'
  if (-not (Test-Path -LiteralPath $pnpm -PathType Leaf)) {
    Add-Result 'sync-versions' 'FAIL' "PNPM_BUNDLED_MISSING: 需要 DSH 自带 pnpm：$pnpm（不使用全局 PATH）"
    return 2
  }
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $nodeCmd) {
    Add-Result 'sync-versions' 'FAIL' 'NODE_MISSING: 未找到 node'
    return 2
  }
  [void](Invoke-StepSafe 'sync-versions' { Invoke-SyncVersions -PnpmCmd $pnpm -NodeExe $nodeCmd.Source })
  return (Exit-CodeFromResults)
}

function Show-Help {
  Write-Host @'
统一维护入口（通用层）——退出码 0=过 / 1=有 SKIP 或 WARN / 2=FAIL 或用法错误
  maintenance.ps1 verify [-Json] [-Skip ids]        确定性静态门禁（CI 硬门，必须 0）
  maintenance.ps1 build [-ReproducibilityCheck]     先 verify 再产制品与哈希
  maintenance.ps1 acceptance [-ReportOut 路径]      实机验收链，产 acceptance-report.json
  maintenance.ps1 doctor [-Json]                    只读环境体检（报事实不下结论）
  maintenance.ps1 selftest                          通用层/适配层自测（临时夹具）
  maintenance.ps1 publish-vendor -Target <仓库根>   从干净提交发布 vendor（仅通用层仓库）
  maintenance.ps1 sync-versions                     自 versions.json 重生成派生文件与 lockfile（bundled pnpm）
详见 docs/使用说明-统一维护入口.md
'@
  return 0
}

switch ($Command) {
  'verify' { exit (Invoke-VerifyCommand) }
  'build' { exit (Invoke-BuildCommand) }
  'acceptance' { exit (Invoke-AcceptanceCommand) }
  'doctor' { exit (Invoke-DoctorCommand) }
  'selftest' { exit (Invoke-SelfTestCommand) }
  'publish-vendor' { exit (Invoke-PublishVendorCommand) }
  'sync-versions' { exit (Invoke-SyncVersionsCommand) }
  default { exit (Show-Help) }
}
