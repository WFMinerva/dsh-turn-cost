# envprobe.ps1 — 统一维护基础设施 · 环境探测（通用层）
# 探测优先级链沿用 TL-078 hoi4_paths.py：显式参数 > 环境变量 > 动态探测 > 兜底；找不到只报事实不猜。

function Resolve-DshHome {
  $candidate = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
    Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'
  } else { $env:DSH_HOME }
  return [IO.Path]::GetFullPath($candidate)
}

function Test-PortOpen([int]$Port) {
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(300)) { $client.Close(); return $false }
    $client.EndConnect($async); $client.Close(); return $true
  } catch { return $false }
}

function Get-ToolFact([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $cmd) { return [pscustomobject]@{ found = $false; path = $null } }
  return [pscustomobject]@{ found = $true; path = $cmd.Source }
}

function Get-MachineFingerprint {
  # 与 tools/checks.py _hardware_fingerprint 同源：只读注册表型号/CPU 字段。
  # 显式不读序列号、UUID、MAC、机器名、用户名（见 redaction-rules.md 排除清单）。
  $values = @()
  try {
    $biosKey = Get-Item 'HKLM:\HARDWARE\DESCRIPTION\System\BIOS' -ErrorAction Stop
    foreach ($name in @('SystemManufacturer', 'SystemProductName', 'BaseBoardManufacturer', 'BaseBoardProduct')) {
      $v = $biosKey.GetValue($name)
      if ($v) { $values += [string]$v }
    }
  } catch { }
  try {
    $cpuKey = Get-Item 'HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor\0' -ErrorAction Stop
    $v = $cpuKey.GetValue('ProcessorNameString')
    if ($v) { $values += [string]$v }
  } catch { }
  return ($values -join ' | ')
}

function Get-MachineBlock {
  $fp = Get-MachineFingerprint
  $class = 'unknown'
  $fpLower = $fp.ToLower()
  if ($fpLower.Contains('7730u') -and $fpLower.Contains('probook 455')) { $class = 'laptop' }
  elseif ($fpLower.Contains('ryzen 5 5500') -and $fpLower.Contains('a520m-k')) { $class = 'unit' }
  elseif ($fpLower.Contains('14600kf') -and $fpLower.Contains('b760m')) { $class = 'home' }
  $osBuild = $null
  try { $osBuild = [string](Get-CimInstance Win32_OperatingSystem).BuildNumber } catch { }
  return [pscustomobject]@{
    class = $class
    fingerprint = $fp
    os_build = $osBuild
    powershell = $PSVersionTable.PSVersion.ToString()
  }
}

function Get-EnvironmentFacts {
  $dshHome = Resolve-DshHome
  return [pscustomobject]@{
    machine = Get-MachineBlock
    dsh_home = [pscustomobject]@{ path = $dshHome; exists = (Test-Path -LiteralPath $dshHome -PathType Container) }
    bundled_pnpm = [pscustomobject]@{ path = (Join-Path $dshHome 'bin\pnpm.cmd'); exists = (Test-Path -LiteralPath (Join-Path $dshHome 'bin\pnpm.cmd') -PathType Leaf) }
    tools = [pscustomobject]@{
      node = Get-ToolFact 'node'
      npm = Get-ToolFact 'npm'
      git = Get-ToolFact 'git'
      dsh = Get-ToolFact 'dsh'
      kimi = Get-ToolFact 'kimi'
      bl = Get-ToolFact 'bl'
    }
    ports = [pscustomobject]@{ p3080 = (Test-PortOpen 3080); p58627 = (Test-PortOpen 58627) }
  }
}
