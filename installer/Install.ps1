[CmdletBinding()]
param(
  [ValidateSet('Install', 'RepairTools', 'Rollback', 'Uninstall')]
  [string]$Mode = 'Install',
  [string]$PackageRoot = $PSScriptRoot,
  [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Write-Step([string]$Message) { Write-Host "[dsh-turn-cost] $Message" }
function Fail([string]$Code, [string]$Message) { throw "$Code`: $Message" }

function Resolve-DshHome {
  $candidate = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) {
    Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'
  } else { $env:DSH_HOME }
  return [IO.Path]::GetFullPath($candidate)
}

function Assert-ChildPath([string]$Root, [string]$Path, [string]$Code = 'PATH_OUTSIDE_DSH_HOME') {
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $pathFull = [IO.Path]::GetFullPath($Path)
  if (-not $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    Fail $Code "拒绝操作 DSH home 之外的路径"
  }
  return $pathFull
}

function Read-Json([string]$Path, [string]$Code) {
  try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json }
  catch { Fail $Code "无法读取 JSON: $Path" }
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Get-CommandOutput([string]$FilePath, [string[]]$Arguments, [string]$Code) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & $FilePath @Arguments 2>&1; $exit = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previous }
  if ($exit -ne 0) { Fail $Code "命令失败（exit=$exit）" }
  return ($output | ForEach-Object { $_.ToString() })
}

function Resolve-DshInvocation([string]$DshHome, [string]$ExpectedVersion, [string]$Root) {
  if ([string]::IsNullOrWhiteSpace($ExpectedVersion) -or $ExpectedVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    Fail 'DSH_VERSION_UNRECOGNIZED' '安装清单没有合法的固定 DSH 版本；未修改 profile'
  }
  $direct = Get-Command dsh -ErrorAction SilentlyContinue
  if ($null -ne $direct) {
    $versionOutput = Get-CommandOutput $direct.Source @('--version') 'DSH_VERSION_FAILED'
    $directText = ($versionOutput -join ' ').Trim()
    if ($directText -match [regex]::Escape($ExpectedVersion)) {
      return [pscustomobject]@{ Kind = 'direct'; File = $direct.Source; Prefix = @(); Version = $ExpectedVersion }
    }
  }
  $version = $ExpectedVersion
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($null -eq $pnpm) {
    $bundledPnpm = Join-Path $DshHome 'bin\pnpm.cmd'
    if (Test-Path -LiteralPath $bundledPnpm -PathType Leaf) { $pnpm = [pscustomobject]@{ Source = $bundledPnpm } }
  }
  if ($null -eq $pnpm) { Fail 'PNPM_NOT_FOUND' '找不到 pnpm，无法建立隔离 DSH CLI；未修改 profile' }
  $cliRoot = Assert-ChildPath $DshHome (Join-Path $DshHome 'turn-cost-dsh-cli')
  $cliBin = Join-Path $cliRoot 'node_modules\.bin\dsh.cmd'
  $cliPackage = Join-Path $cliRoot 'package.json'
  $ready = $false
  if ((Test-Path -LiteralPath $cliBin -PathType Leaf) -and (Test-Path -LiteralPath $cliPackage -PathType Leaf)) {
    try {
      $existing = Read-Json $cliPackage 'DSH_CLI_MANIFEST_INVALID'
      $ready = ([string]$existing.dependencies.'@deepseek-ai/dsh' -eq $version)
    } catch { $ready = $false }
  }
  if (-not $ready) {
    if (Test-Path -LiteralPath $cliRoot) { Remove-Item -LiteralPath $cliRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $cliRoot | Out-Null
    $dshPackageSource = Join-Path $Root 'dsh-package.json'
    $dshLockSource = Join-Path $Root 'dsh-package-lock.yaml'
    $dshWorkspaceSource = Join-Path $Root 'dsh-pnpm-workspace.yaml'
    $dshPackage = Read-Json $dshPackageSource 'DSH_CLI_ASSET_INVALID'
    if ([string]$dshPackage.dependencies.'@deepseek-ai/dsh' -ne $ExpectedVersion) {
      Fail 'DSH_CLI_VERSION_MISMATCH' '安装清单与隔离 DSH 依赖版本不一致；未修改 profile'
    }
    Copy-Item -LiteralPath $dshPackageSource -Destination $cliPackage -Force
    Copy-Item -LiteralPath $dshLockSource -Destination (Join-Path $cliRoot 'pnpm-lock.yaml') -Force
    Copy-Item -LiteralPath $dshWorkspaceSource -Destination (Join-Path $cliRoot 'pnpm-workspace.yaml') -Force
    try {
      Push-Location $cliRoot
      try { [void](Get-CommandOutput $pnpm.Source @('install', '--frozen-lockfile') 'DSH_CLI_INSTALL_FAILED') }
      finally { Pop-Location }
    } catch {
      if (Test-Path -LiteralPath $cliRoot) { Remove-Item -LiteralPath $cliRoot -Recurse -Force }
      throw
    }
  }
  if (-not (Test-Path -LiteralPath $cliBin -PathType Leaf)) { Fail 'DSH_CLI_BIN_MISSING' '隔离 DSH CLI 安装后缺少 dsh.cmd；未修改 profile' }
  return [pscustomobject]@{ Kind = 'isolated-pnpm'; File = $cliBin; Prefix = @(); Version = $version }
}

function Invoke-Dsh($Invocation, [string[]]$Arguments, [string]$Code) {
  return Get-CommandOutput $Invocation.File (@($Invocation.Prefix) + $Arguments) $Code
}

function Test-Port([int]$Port) {
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(300)) { $client.Close(); return $false }
    $client.EndConnect($async); $client.Close(); return $true
  } catch { return $false }
}

function New-Backup([string]$DshHome, [string]$ProfilePath) {
  $backupRoot = Assert-ChildPath $DshHome (Join-Path $DshHome 'backups\dsh-turn-cost-installer')
  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
  $backup = Assert-ChildPath $DshHome (Join-Path $backupRoot "$stamp-$suffix")
  New-Item -ItemType Directory -Path $backup | Out-Null
  $records = @()
  foreach ($name in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml')) {
    $source = Join-Path $ProfilePath $name
    $exists = Test-Path -LiteralPath $source -PathType Leaf
    if ($exists) { Copy-Item -LiteralPath $source -Destination (Join-Path $backup $name) }
    $sha256 = $null
    if ($exists) { $sha256 = Get-Sha256 $source }
    $records += [pscustomobject]@{ path = $name; existed = $exists; sha256 = $sha256 }
  }
  $module = Join-Path $ProfilePath 'node_modules\dsh-turn-cost'
  $moduleExists = Test-Path -LiteralPath $module
  if ($moduleExists) { Copy-Item -LiteralPath $module -Destination (Join-Path $backup 'dsh-turn-cost') -Recurse -Force }
  $manifest = [ordered]@{ version = 1; createdAt = [DateTime]::UtcNow.ToString('o'); profileExisted = (Test-Path -LiteralPath $ProfilePath); files = $records; moduleExisted = $moduleExists }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backup 'backup.json') -Encoding UTF8
  return $backup
}

function Restore-Backup([string]$DshHome, [string]$ProfilePath, [string]$BackupPath) {
  $backup = Assert-ChildPath $DshHome $BackupPath 'BACKUP_OUTSIDE_DSH_HOME'
  $manifestPath = Join-Path $backup 'backup.json'
  $manifest = Read-Json $manifestPath 'BACKUP_INVALID'
  New-Item -ItemType Directory -Force -Path $ProfilePath | Out-Null
  foreach ($record in $manifest.files) {
    $target = Assert-ChildPath $DshHome (Join-Path $ProfilePath ([string]$record.path))
    $saved = Join-Path $backup ([string]$record.path)
    if ([bool]$record.existed) { Copy-Item -LiteralPath $saved -Destination $target -Force }
    elseif (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
  }
  $module = Assert-ChildPath $DshHome (Join-Path $ProfilePath 'node_modules\dsh-turn-cost')
  if (Test-Path -LiteralPath $module) { Remove-Item -LiteralPath $module -Recurse -Force }
  if ([bool]$manifest.moduleExisted) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $module) | Out-Null
    Copy-Item -LiteralPath (Join-Path $backup 'dsh-turn-cost') -Destination $module -Recurse -Force
  }
}

function Install-PrivateTools([string]$DshHome, [string]$Root) {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($null -eq $npm) { Write-Step 'CLI_PENDING：找不到 npm；插件已安装，可稍后运行“补齐额度CLI.cmd”'; return $false }
  $tools = Assert-ChildPath $DshHome (Join-Path $DshHome 'turn-cost-tools')
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  Copy-Item -LiteralPath (Join-Path $Root 'tools-package.json') -Destination (Join-Path $tools 'package.json') -Force
  Copy-Item -LiteralPath (Join-Path $Root 'tools-package-lock.json') -Destination (Join-Path $tools 'package-lock.json') -Force
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $npmOutput = & $npm.Source ci --prefix $tools --no-audit --no-fund 2>&1; $exit = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previous }
  if ($exit -ne 0) { Write-Step 'CLI_PENDING：私有 CLI 安装失败；插件保留，可联网后重试'; return $false }
  $bin = Join-Path $tools 'node_modules\.bin'
  if (-not (Test-Path -LiteralPath (Join-Path $bin 'kimi.cmd')) -or -not (Test-Path -LiteralPath (Join-Path $bin 'bl.cmd'))) {
    Write-Step 'CLI_PENDING：安装结果缺少 kimi.cmd 或 bl.cmd'; return $false
  }
  Write-Step '私有 Kimi/百炼 CLI 已安装'
  return $true
}

function Install-PackageCopy([string]$DshHome, [string]$Root) {
  $packageTarget = Assert-ChildPath $DshHome (Join-Path $DshHome 'turn-cost-installer-package')
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (-not $rootFull.Equals($packageTarget.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
    $staging = Assert-ChildPath $DshHome (Join-Path $DshHome ('turn-cost-installer-package.staging-' + [Guid]::NewGuid().ToString('N')))
    New-Item -ItemType Directory -Path $staging | Out-Null
    try {
      Get-ChildItem -LiteralPath $Root -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $staging -Recurse -Force
      }
      if (Test-Path -LiteralPath $packageTarget) { Remove-Item -LiteralPath $packageTarget -Recurse -Force }
      Move-Item -LiteralPath $staging -Destination $packageTarget
    } finally {
      if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    }
  }
  return $packageTarget
}

function Install-Launcher([string]$DshHome, [string]$Root) {
  $packageTarget = Assert-ChildPath $DshHome (Join-Path $DshHome 'turn-cost-installer-package')
  if (-not [IO.Path]::GetFullPath($Root).TrimEnd('\').Equals($packageTarget.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
    Fail 'LAUNCHER_ROOT_NOT_PERSISTENT' '拒绝从临时目录安装启动器'
  }
  if (-not (Test-Path -LiteralPath $packageTarget -PathType Container)) {
    Fail 'INSTALLER_PACKAGE_MISSING' '永久安装包目录不存在'
  }
  $target = Assert-ChildPath $DshHome (Join-Path $DshHome 'turn-cost-launcher')
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  foreach ($name in @('Launch.ps1', '启动 DSH（含额度）.cmd', '补齐额度CLI.cmd', '回滚上一次安装.cmd', '卸载.cmd')) {
    Copy-Item -LiteralPath (Join-Path $Root $name) -Destination (Join-Path $target $name) -Force
  }
}

function Get-StatePath([string]$DshHome) { return Assert-ChildPath $DshHome (Join-Path $DshHome 'turn-cost-installer\state.json') }

function Write-State([string]$DshHome, $State) {
  $path = Get-StatePath $DshHome
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8
}

function Read-State([string]$DshHome) {
  $path = Get-StatePath $DshHome
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail 'STATE_NOT_FOUND' '找不到可信安装状态，拒绝猜测回滚或删除' }
  return Read-Json $path 'STATE_INVALID'
}

$dshHome = Resolve-DshHome
$profilePath = Assert-ChildPath $dshHome (Join-Path $dshHome 'profiles\web')
$root = [IO.Path]::GetFullPath($PackageRoot)

if ($Mode -eq 'RepairTools') {
  [void](Install-PrivateTools $dshHome $root)
  exit 0
}

if ($Mode -eq 'Rollback') {
  if (Test-Port 3080) { Fail 'DSH_RUNNING' '3080 正在监听，请先退出 DSH' }
  $state = Read-State $dshHome
  Restore-Backup $dshHome $profilePath ([string]$state.backupPath)
  Write-Step '已恢复安装前 profile；凭据、settings 和会话未触碰'
  exit 0
}

if ($Mode -eq 'Uninstall') {
  if (Test-Port 3080) { Fail 'DSH_RUNNING' '3080 正在监听，请先退出 DSH' }
  $state = Read-State $dshHome
  Restore-Backup $dshHome $profilePath ([string]$state.backupPath)
  foreach ($relative in @('turn-cost-tools', 'turn-cost-dsh-cli', 'turn-cost-launcher', 'turn-cost-installer', 'turn-cost-installer-package')) {
    $target = Assert-ChildPath $dshHome (Join-Path $dshHome $relative)
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  }
  Write-Step '已卸载安装器拥有的文件，并恢复安装前插件状态；凭据和会话保留'
  exit 0
}

if (Test-Port 3080) { Fail 'DSH_RUNNING' '3080 正在监听，请先退出 DSH 再安装' }
$manifest = Read-Json (Join-Path $root 'installer-manifest.json') 'MANIFEST_INVALID'
$packagePath = Join-Path $root ('payload\' + [string]$manifest.plugin.file)
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { Fail 'PAYLOAD_MISSING' '插件 payload 不存在' }
$actualHash = Get-Sha256 $packagePath
if ($actualHash -ne ([string]$manifest.plugin.sha256).ToUpperInvariant()) { Fail 'PAYLOAD_HASH_MISMATCH' '插件包校验失败；未修改 profile' }
$root = Install-PackageCopy $dshHome $root
$manifest = Read-Json (Join-Path $root 'installer-manifest.json') 'STAGED_MANIFEST_INVALID'
$packagePath = Join-Path $root ('payload\' + [string]$manifest.plugin.file)
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { Fail 'STAGED_PAYLOAD_MISSING' '永久载荷不存在；未修改 profile' }
$actualHash = Get-Sha256 $packagePath
if ($actualHash -ne ([string]$manifest.plugin.sha256).ToUpperInvariant()) { Fail 'STAGED_PAYLOAD_HASH_MISMATCH' '永久载荷校验失败；未修改 profile' }
$invocation = Resolve-DshInvocation $dshHome ([string]$manifest.dsh.version) $root
$statePath = Get-StatePath $dshHome
if (Test-Path -LiteralPath $statePath -PathType Leaf) {
  $existingState = Read-Json $statePath 'STATE_INVALID'
  $profileManifestPath = Join-Path $profilePath 'package.json'
  if ([string]$existingState.plugin.sha256 -eq $actualHash -and (Test-Path -LiteralPath $profileManifestPath -PathType Leaf)) {
    $existingProfile = Read-Json $profileManifestPath 'PROFILE_MANIFEST_INVALID'
    $installedDependency = [string]$existingProfile.dependencies.'dsh-turn-cost'
    $expectedFileDependency = 'file:' + $packagePath.Replace('\', '/')
    $dependencyMatches = $installedDependency.Equals($packagePath, [StringComparison]::OrdinalIgnoreCase) -or $installedDependency.Equals($expectedFileDependency, [StringComparison]::OrdinalIgnoreCase)
    if ($existingProfile.dsh.profile.bundles -contains 'dsh-turn-cost' -and $dependencyMatches) {
      $toolsReady = [bool](Install-PrivateTools $dshHome $root)
      Install-Launcher $dshHome $root
      $existingState.toolsReady = $toolsReady
      Write-State $dshHome $existingState
      Write-Step 'INSTALL_OK：同版本同哈希，已完成健康检查与启动器修复'
      exit 0
    }
  }
}
$backup = New-Backup $dshHome $profilePath
try {
  Write-Step "安装插件 $($manifest.plugin.version)（DSH $($invocation.Version)）"
  [void](Invoke-Dsh $invocation @('plugin', '--profile', 'web', 'add', $packagePath) 'DSH_PLUGIN_ADD_FAILED')
  $dump = Invoke-Dsh $invocation @('--profile', 'web', '--dump-config') 'DSH_DUMP_FAILED'
  $dumpText = $dump -join "`n"
  if ($dumpText -notmatch 'dsh-turn-cost' -or $dumpText -notmatch 'turn-cost') { Fail 'DSH_BUNDLE_NOT_ACTIVE' 'dump-config 未发现插件层' }
  $profileManifest = Read-Json (Join-Path $profilePath 'package.json') 'PROFILE_MANIFEST_INVALID'
  if (-not ($profileManifest.dsh.profile.bundles -contains 'dsh-turn-cost')) { Fail 'DSH_BUNDLE_NOT_REGISTERED' 'profile bundles 未登记插件' }
} catch {
  Restore-Backup $dshHome $profilePath $backup
  throw
}

$toolsReady = [bool](Install-PrivateTools $dshHome $root)
Install-Launcher $dshHome $root
$state = [ordered]@{
  version = 1
  installedAt = [DateTime]::UtcNow.ToString('o')
  backupPath = $backup
  plugin = [ordered]@{ version = [string]$manifest.plugin.version; sha256 = $actualHash }
  dsh = [ordered]@{ kind = $invocation.Kind; executable = $invocation.File; prefix = @($invocation.Prefix); version = $invocation.Version }
  toolsReady = $toolsReady
}
Write-State $dshHome $state
Write-Step 'INSTALL_OK：插件与启动入口已就绪'
Write-Step '下一步：在 DSH 设置→模型中手动填写 Kimi/Qwen API Key；再完成 kimi login 与 bl 控制台登录'
