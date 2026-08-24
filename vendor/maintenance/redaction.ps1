# redaction.ps1 — 统一维护基础设施 · 脱敏规则（通用层）
# 正则与仓库 .githooks/pre-commit.py、tools/checks.py 同源镜像；
# 一致性由 tests/maintenance/selftest.ps1 的 Test-RedactionMatchesPython 断言。
# 规则说明：tools/maintenance/redaction-rules.md

$script:KeyBlockPattern = '-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{20,}|sk-ant-[0-9A-Za-z_-]{20,}|xox[bprs]-[0-9A-Za-z-]{10,}'
$script:KeyWarnPattern = 'AIza[0-9A-Za-z_-]{35}|LTAI[0-9A-Za-z]{12,}'
$script:PersonalPathPattern = '[A-Za-z]:[\\/]+Users[\\/]+[^<>%$\\/\s]+[\\/]+(?:AppData(?:[\\/]+(?:Roaming|Local|LocalLow))?|Documents[\\/]+(?:Codex|ChatGPT)|\.codex)(?:[\\/]|$)'

function Invoke-Redact([string]$Text) {
  if ($null -eq $Text) { return '' }
  $t = $Text
  $t = [regex]::Replace($t, $script:PersonalPathPattern, '%USERPROFILE%\')
  $t = [regex]::Replace($t, $script:KeyBlockPattern, '[REDACTED]')
  $t = [regex]::Replace($t, $script:KeyWarnPattern, '[REDACTED]')
  return $t
}

function Get-RedactionFragments {
  # 与 Python 两份同源文件共有的字面量片段（一致性断言用）
  return @{
    key_block = @(
      '-----BEGIN [A-Z ]*PRIVATE KEY-----',
      'AKIA[0-9A-Z]{16}',
      'ghp_[0-9A-Za-z]{36}',
      'github_pat_[0-9A-Za-z_]{20,}',
      'sk-ant-[0-9A-Za-z_-]{20,}',
      'xox[bprs]-[0-9A-Za-z-]{10,}'
    )
    key_warn = @(
      'AIza[0-9A-Za-z_-]{35}',
      'LTAI[0-9A-Za-z]{12,}'
    )
    personal = @(
      'Documents[\\/]+(?:Codex|ChatGPT)'
    )
  }
}

function Test-RedactionMatchesPython([string]$RepoRoot) {
  $problems = New-Object System.Collections.ArrayList
  $checksPy = Join-Path $RepoRoot 'tools\checks.py'
  $hookPy = Join-Path $RepoRoot '.githooks\pre-commit.py'
  foreach ($p in @($checksPy, $hookPy)) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
      [void]$problems.Add("同源文件缺失：$p")
    }
  }
  if ($problems.Count -gt 0) { return @{ ok = $false; problems = $problems } }
  $checksText = Get-Content -Raw -LiteralPath $checksPy
  $hookText = Get-Content -Raw -LiteralPath $hookPy
  $frags = Get-RedactionFragments
  $ownPatterns = @($script:KeyBlockPattern, $script:KeyWarnPattern, $script:PersonalPathPattern) -join "`n"
  foreach ($group in @('key_block', 'key_warn', 'personal')) {
    foreach ($frag in $frags[$group]) {
      if (-not $ownPatterns.Contains($frag)) { [void]$problems.Add("PS 镜像缺失片段：$frag") }
      if (-not $checksText.Contains($frag)) { [void]$problems.Add("checks.py 缺失片段：$frag") }
      if (-not $hookText.Contains($frag)) { [void]$problems.Add("pre-commit.py 缺失片段：$frag") }
    }
  }
  return @{ ok = ($problems.Count -eq 0); problems = $problems }
}
