# vendor.ps1 — 统一维护基础设施 · vendor 快照发布（通用层）
# 只从干净提交发布：待发布源子树（tools/maintenance）必须干净（脏树检查仅覆盖该子树，
# 理由见方案文档 §3.3-1），来源 SHA 一律取 HEAD；
# 目标固定写入 <目标仓库根>/vendor/maintenance，配哈希清单（基本路径边界 + 哈希互校）。

function Publish-VendorCore([string]$SourceRoot, [string]$TargetRoot) {
  # 干净提交检查只覆盖发布目标（tools/maintenance）：该路径下任何改动都拒绝；
  # 仓库其他位置的无关状态不影响「快照内容 = 来源提交内容」的保真。
  $porcelain = & git -C $SourceRoot status --porcelain -- tools/maintenance
  if ($LASTEXITCODE -ne 0) { throw 'GIT_FAILED: 无法读取源仓库状态' }
  if ($porcelain) {
    throw 'DIRTY_TREE: tools/maintenance 存在未提交改动；先提交干净再发布，禁止以未提交内容生成快照'
  }
  $sha = (& git -C $SourceRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') { throw 'GIT_FAILED: 无法解析 HEAD' }
  $srcMaint = Join-Path $SourceRoot 'tools\maintenance'
  $whitelist = @(
    'core.ps1', 'vendor.ps1', 'redaction.ps1', 'hashes.ps1', 'envprobe.ps1', 'report.ps1',
    'report.schema.json', 'redaction-rules.md', 'adapter.schema.json',
    'templates\adapter.ps1.template', 'templates\diagnostic-table.template.md'
  )
  $files = New-Object System.Collections.ArrayList
  foreach ($rel in $whitelist) {
    $src = Join-Path $srcMaint $rel
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "VENDOR_SOURCE_MISSING: $rel" }
    $text = Get-Content -Raw -LiteralPath $src
    foreach ($line in $text -split "\r?\n") {
      if ((Invoke-Redact $line) -ne $line) { throw "VENDOR_CONTENT_REJECTED: $rel 含敏感模式命中" }
    }
    [void]$files.Add([pscustomobject]@{ rel = $rel.Replace('\', '/'); src = $src })
  }
  $vendorDir = Assert-ChildPath $TargetRoot (Join-Path $TargetRoot 'vendor\maintenance')
  $manifestTarget = Assert-ChildPath $TargetRoot (Join-Path $TargetRoot 'vendor\manifest.json')
  if (Test-Path -LiteralPath $vendorDir) { Remove-Item -LiteralPath $vendorDir -Recurse -Force }
  New-Item -ItemType Directory -Path $vendorDir -Force | Out-Null
  $entries = @()
  foreach ($f in $files) {
    $dest = Assert-ChildPath $TargetRoot (Join-Path $vendorDir ($f.rel.Replace('/', '\')))
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    Copy-Item -LiteralPath $f.src -Destination $dest -Force
    $entries += [pscustomobject]@{ path = $f.rel; sha256 = (Get-FileSha256 $dest) }
  }
  $manifest = [ordered]@{
    schemaVersion = 1
    sourceRepo = 'WFMinerva/tool-library'
    commit = $sha
    generatedAt = [DateTime]::UtcNow.ToString('o')
    files = $entries
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestTarget -Encoding UTF8
  return [pscustomobject]@{ commit = $sha; files = $entries.Count; vendorDir = $vendorDir }
}
