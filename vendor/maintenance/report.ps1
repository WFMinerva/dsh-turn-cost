# report.ps1 — 统一维护基础设施 · 报告组装（通用层）
# 脱敏单一出口：所有字符串字段在序列化时统一过 Invoke-Redact；
# artifact 只准仓库相对路径；白名单字段，不收 stdout/stderr 原文。

$script:ReportStatusValues = @('PASS', 'WARN', 'FAIL', 'SKIP')

function New-MaintenanceReport([string]$CommandName, $AdapterInfo, [string]$CoreCommit) {
  return [pscustomobject]@{
    schema_version = 1
    command = $CommandName
    adapter = $AdapterInfo
    core = [pscustomobject]@{ vendor_commit = $CoreCommit; schema_version = 1 }
    machine = (Get-MachineBlock)
    started_at = [DateTime]::UtcNow.ToString('o')
    finished_at = $null
    checks = (New-Object System.Collections.ArrayList)
    artifacts = (New-Object System.Collections.ArrayList)
    skipped = (New-Object System.Collections.ArrayList)
    cleanup = $null
    exit_code = $null
  }
}

function Add-ReportCheck($Report, [string]$Id, [string]$Status, [string]$Summary, [string]$Code) {
  if ($script:ReportStatusValues -notcontains $Status) { throw "REPORT_STATUS_INVALID: $Status" }
  $detail = $Summary
  if ($detail.Length -gt 200) { $detail = $detail.Substring(0, 200) + '…' }
  [void]$Report.checks.Add([pscustomobject]@{
    id = $Id; status = $Status; code = $Code; summary = $Summary; detail = $detail
  })
}

function Add-ReportSkip($Report, [string]$Id, [string]$Reason) {
  [void]$Report.skipped.Add([pscustomobject]@{ id = $Id; reason = $Reason })
  Add-ReportCheck $Report $Id 'SKIP' $Reason 'SKIPPED'
}

function Add-ReportArtifact($Report, [string]$RepoRoot, [string]$AbsPath) {
  $rootFull = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
  $absFull = [IO.Path]::GetFullPath($AbsPath)
  if (-not $absFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'ARTIFACT_PATH_REJECTED: 制品必须位于仓库内（只准相对路径入库）'
  }
  $rel = $absFull.Substring($rootFull.Length).Replace('\', '/')
  if ($rel.Contains('..')) { throw 'ARTIFACT_PATH_REJECTED: 相对路径含 ..' }
  [void]$Report.artifacts.Add([pscustomobject]@{ path = $rel; sha256 = (Get-FileSha256 $absFull) })
  return $rel
}

function Set-ReportCleanup($Report, [string]$Status, [string]$Detail) {
  $Report.cleanup = [pscustomobject]@{ status = $Status; detail = $Detail }
}

function ConvertTo-RedactedObject($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [string]) { return (Invoke-Redact $Value) }
  if ($Value -is [System.Collections.IList]) {
    return @($Value | ForEach-Object { ConvertTo-RedactedObject $_ })
  }
  if ($Value -is [System.Collections.IDictionary]) {
    $out = [ordered]@{}
    foreach ($k in $Value.Keys) { $out[(Invoke-Redact ([string]$k))] = ConvertTo-RedactedObject $Value[$k] }
    return $out
  }
  if ($Value -is [pscustomobject] -or $Value -is [PSCustomObject]) {
    $out = [ordered]@{}
    foreach ($p in $Value.PSObject.Properties) { $out[(Invoke-Redact $p.Name)] = ConvertTo-RedactedObject $p.Value }
    return $out
  }
  return $Value
}

function Write-Report($Report, [string]$Path, [int]$ExitCode) {
  $Report.finished_at = [DateTime]::UtcNow.ToString('o')
  $Report.exit_code = $ExitCode
  $redacted = ConvertTo-RedactedObject $Report
  $json = $redacted | ConvertTo-Json -Depth 12
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($Path), $json, (New-Object Text.UTF8Encoding($false)))
  return $Path
}
