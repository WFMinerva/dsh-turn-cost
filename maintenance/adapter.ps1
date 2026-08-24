# maintenance/adapter.ps1 — dsh-turn-cost 适配层（契约：vendor/maintenance/adapter.schema.json）
# 范围：DSH/Kimi/Qwen 探测、安装器编排、服务生命周期、回滚、项目 manifest。
# 纪律：不改 vendor/；不复制通用层函数体（Test-PortOpen/Get-FileSha256 等直接调用通用层）；
#       报告只收白名单字段；凭据零接触（不进报告/日志/仓库、不打印、不复制；唯一例外：
#       Kimi loopback bearer 令牌内存即用，见 vendor/maintenance/redaction-rules.md）。

$script:Acc = @{ startedKimi = $false; dshProcess = $null; kimiProcess = $null; extract = $null; backupPath = $null; dshExe = $null; dshHome = $null; baselineProfileHash = $null; zip = $null }

function Get-JsonProperty($Obj, [string]$Name) {
  if ($null -eq $Obj) { return $null }
  foreach ($p in $Obj.PSObject.Properties) { if ($p.Name -ceq $Name) { return $p.Value } }
  return $null
}

function Read-AdapterJson([string]$RelPath) {
  $p = Join-Path $RepoRoot $RelPath
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "MISSING_FILE: $RelPath" }
  return (Get-Content -Raw -Encoding UTF8 -LiteralPath $p | ConvertFrom-Json)
}

function Get-AdapterInfo {
  $pkg = Read-AdapterJson 'package.json'
  return [pscustomobject]@{ name = [string]$pkg.name; version = [string]$pkg.version }
}

function Find-RemainingPercent($Obj) {
  if ($null -eq $Obj) { return $null }
  foreach ($p in $Obj.PSObject.Properties) {
    if ($p.Name -eq 'remainingPercent') { return $p.Value }
    if ($p.Value -is [pscustomobject]) {
      $found = Find-RemainingPercent $p.Value
      if ($null -ne $found) { return $found }
    }
  }
  return $null
}

# ---------- verify ----------

function Test-VersionsEquality {
  $versions = Read-AdapterJson 'versions.json'
  $problems = New-Object System.Collections.ArrayList
  $dshName = [string]$versions.dsh.package
  $dshVersion = [string]$versions.dsh.version

  $dshPkg = Read-AdapterJson 'installer\dsh-package.json'
  if ([string]$dshPkg._generated -notmatch 'versions\.json') { [void]$problems.Add('dsh-package.json 缺 _generated 派生标记') }
  if ([string](Get-JsonProperty $dshPkg.dependencies $dshName) -ne $dshVersion) { [void]$problems.Add('dsh-package.json 与 versions.json 的 DSH 版本不等') }

  $toolsPkg = Read-AdapterJson 'installer\tools-package.json'
  if ([string]$toolsPkg._generated -notmatch 'versions\.json') { [void]$problems.Add('tools-package.json 缺 _generated 派生标记') }
  foreach ($name in @('@moonshot-ai/kimi-code', 'bailian-cli')) {
    if ([string](Get-JsonProperty $toolsPkg.dependencies $name) -ne [string](Get-JsonProperty $versions.tools $name)) {
      [void]$problems.Add("tools-package.json 与 versions.json 不等：$name")
    }
  }

  # lockfile 体量大且 PS5.1 ConvertFrom-Json 对大对象不稳：改用文本断言（只断言版本事实）
  $toolsLockText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $RepoRoot 'installer\tools-package-lock.json')
  $rootSection = $toolsLockText
  $nmIndex = $toolsLockText.IndexOf('node_modules')
  if ($nmIndex -gt 0) { $rootSection = $toolsLockText.Substring(0, $nmIndex) }
  foreach ($name in @('@moonshot-ai/kimi-code', 'bailian-cli')) {
    $ver = [regex]::Escape([string](Get-JsonProperty $versions.tools $name))
    $escName = [regex]::Escape($name)
    if ($rootSection -notmatch ('"' + $escName + '":\s*"' + $ver + '"')) {
      [void]$problems.Add("tools-package-lock.json 根 specifier 与 versions.json 不等：$name")
    }
    if ($toolsLockText -notmatch ('"node_modules/' + $escName + '":\s*\{\s*"version":\s*"' + $ver + '"')) {
      [void]$problems.Add("tools-package-lock.json 固定版本与 versions.json 不等：$name")
    }
  }

  $dshLockText = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'installer\dsh-package-lock.yaml')
  if ($dshLockText -notmatch ('specifier:\s*' + [regex]::Escape($dshVersion))) {
    [void]$problems.Add('dsh-package-lock.yaml specifier 与 versions.json 不等')
  }

  $pkg = Read-AdapterJson 'package.json'
  # package-lock.json 用首段文本断言（PS5.1 ConvertFrom-Json 对 npm lockfile 大对象不稳）
  $pkgLockText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $RepoRoot 'package-lock.json')
  $head = $pkgLockText.Substring(0, [Math]::Min(400, $pkgLockText.Length))
  if ($head -notmatch ('"version":\s*"' + [regex]::Escape([string]$pkg.version) + '"')) {
    [void]$problems.Add('package.json 与 package-lock.json 版本不等')
  }

  $build = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot 'scripts\build-windows-installer.ps1')
  if ($build -notmatch 'versions\.json') { [void]$problems.Add('build 脚本未读 versions.json') }
  if ($build -match "'deepseek-official'") { [void]$problems.Add('build 脚本仍内联 providers 常量') }

  if ($problems.Count -gt 0) {
    return [pscustomobject]@{ status = 'FAIL'; summary = (($problems | Select-Object -First 5) -join '；') }
  }
  return [pscustomobject]@{ status = 'PASS'; summary = 'versions.json 单一权威源与全部派生文件相等' }
}

function Get-VerifySteps {
  return @(
    @{ id = 'node-tests'; run = {
        Push-Location $RepoRoot
        try {
          $out = & node --test 2>&1 | ForEach-Object { $_.ToString() }
          $code = $LASTEXITCODE
        } finally { Pop-Location }
        $info = (($out | Where-Object { $_ -match '^ℹ (tests|pass|fail) ' }) -join '；')
        if ($code -ne 0) { throw ('node --test exit=' + $code + '（' + $info + '）') }
        return [pscustomobject]@{ status = 'PASS'; summary = ('node --test 通过（' + $info + '）') }
      } },
    @{ id = 'versions-equality'; run = { Test-VersionsEquality } },
    @{ id = 'windows-fixture'; run = {
        $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoRoot 'test\windows-installer.test.ps1') 2>&1
        $code = $LASTEXITCODE
        if ($code -ne 0 -or (($out -join "`n") -notmatch 'WINDOWS_INSTALLER_TEST_OK')) {
          throw ('windows-installer 夹具 exit=' + $code)
        }
        return [pscustomobject]@{ status = 'PASS'; summary = 'Windows 安装事务夹具全绿（端口注入隔离宿主）' }
      } }
  )
}

function Get-SelfTestSteps {
  return @(
    @{ id = 'windows-fixture'; run = { (Get-VerifySteps)[2].run } }
  )
}

function Get-DoctorSteps {
  return @(
    @{ id = 'installer-state'; run = {
        $dshHome = Resolve-DshHome
        $tools = Join-Path $dshHome 'turn-cost-tools\node_modules\.bin'
        $parts = @(
          ('state.json=' + (Test-Path -LiteralPath (Join-Path $dshHome 'turn-cost-installer\state.json') -PathType Leaf)),
          ('launcher=' + (Test-Path -LiteralPath (Join-Path $dshHome 'turn-cost-launcher\启动 DSH（含额度）.cmd') -PathType Leaf)),
          ('kimi.cmd=' + (Test-Path -LiteralPath (Join-Path $tools 'kimi.cmd') -PathType Leaf)),
          ('bl.cmd=' + (Test-Path -LiteralPath (Join-Path $tools 'bl.cmd') -PathType Leaf)),
          ('kimi token=' + (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.kimi-code\server.token') -PathType Leaf))
        )
        return [pscustomobject]@{ status = 'PASS'; summary = ($parts -join '；') }
      } }
  )
}

# ---------- build ----------

function Invoke-AdapterBuild {
  param([switch]$ReproducibilityCheck)
  $scriptPath = Join-Path $RepoRoot 'scripts\build-windows-installer.ps1'
  $extra = @()
  if ($ReproducibilityCheck) { $extra += '-ReproducibilityCheck' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath @extra
  if ($LASTEXITCODE -ne 0) { throw ('BUILD_FAILED: build-windows-installer exit=' + $LASTEXITCODE) }
}

function Get-Artifacts {
  $pkg = Read-AdapterJson 'package.json'
  return @(
    ('dist/dsh-turn-cost-setup-' + [string]$pkg.version + '-win-x64.zip'),
    'dist/content-sha256.json'
  )
}

# ---------- acceptance（真实链：必须在 DSH 之外运行） ----------

function Invoke-AcceptancePs1([string]$Mode, [string]$PackageRoot) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PackageRoot 'Install.ps1') -Mode $Mode -PackageRoot $PackageRoot -NonInteractive
  return $LASTEXITCODE
}

function Get-KimiToken {
  $tokenPath = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.kimi-code\server.token'
  if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) { throw 'KIMI_SERVER_TOKEN_NOT_FOUND：请先运行 kimi login' }
  return (Get-Content -Raw -LiteralPath $tokenPath).Trim()
}

function Get-AcceptanceStages {
  return @(
    @{ id = 'precheck'; run = {
        if (Test-PortOpen 3080) { throw 'PORT_BUSY：3080 正在监听；请先退出 DSH（acceptance 必须在 DSH 之外运行）' }
        if (Test-PortOpen 58627) { throw 'PORT_BUSY：58627 正在监听；请先退出 Kimi 本地服务' }
        $dshHome = Resolve-DshHome
        $profilePkg = Join-Path $dshHome 'profiles\web\package.json'
        if (-not (Test-Path -LiteralPath $profilePkg -PathType Leaf)) { throw 'PROFILE_MISSING：未找到 web profile' }
        $script:Acc.dshHome = $dshHome
        $script:Acc.baselineProfileHash = Get-FileSha256 $profilePkg
        $zip = Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'dist') -Filter 'dsh-turn-cost-setup-*.zip' -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($null -eq $zip) { throw 'BUILD_FIRST：dist/ 没有 ZIP，请先运行 maintenance.ps1 build' }
        $script:Acc.zip = $zip.FullName
        return @{ status = 'PASS'; summary = ('前置通过；制品 ' + $zip.Name + '；安装前基线哈希已登记（不回显）'); code = $null }
      } },
    @{ id = 'install'; run = {
        $extract = Join-Path ([IO.Path]::GetTempPath()) ('dsh-acceptance-' + [Guid]::NewGuid().ToString('N'))
        Expand-Archive -LiteralPath $script:Acc.zip -DestinationPath $extract -Force
        $script:Acc.extract = $extract
        $code = Invoke-AcceptancePs1 'Install' $extract
        if ($code -ne 0) { throw ('INSTALL_FAILED：Install.ps1 exit=' + $code) }
        $state = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $script:Acc.dshHome 'turn-cost-installer\state.json') | ConvertFrom-Json
        $script:Acc.backupPath = [string]$state.backupPath
        $script:Acc.dshExe = [string]$state.dsh.executable
        return @{ status = 'PASS'; summary = '安装成功；回滚点与 DSH 入口已登记'; code = $null }
      } },
    @{ id = 'reinstall'; run = {
        $code = Invoke-AcceptancePs1 'Install' $script:Acc.extract
        if ($code -ne 0) { throw ('REINSTALL_FAILED：exit=' + $code) }
        $state2 = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $script:Acc.dshHome 'turn-cost-installer\state.json') | ConvertFrom-Json
        if ([string]$state2.backupPath -ne $script:Acc.backupPath) { throw 'ROLLBACK_POINT_DRIFT：幂等重跑改变了回滚点' }
        return @{ status = 'PASS'; summary = '幂等重跑成功；回滚点不变'; code = $null }
      } },
    @{ id = 'start'; run = {
        $toolsBin = Join-Path $script:Acc.dshHome 'turn-cost-tools\node_modules\.bin'
        if (-not (Test-PortOpen 58627)) {
          $kimi = Join-Path $toolsBin 'kimi.cmd'
          if (-not (Test-Path -LiteralPath $kimi -PathType Leaf)) { throw 'KIMI_CLI_MISSING：私有 kimi CLI 缺失，请先补齐额度CLI' }
          $script:Acc.kimiProcess = Start-Process -FilePath $kimi -ArgumentList @('web', '--no-open', '--port', '58627') -WindowStyle Hidden -PassThru
          $script:Acc.startedKimi = $true
          $deadline = [DateTime]::UtcNow.AddSeconds(25)
          do { Start-Sleep -Milliseconds 300 } while (-not (Test-PortOpen 58627) -and [DateTime]::UtcNow -lt $deadline)
          if (-not (Test-PortOpen 58627)) { throw 'KIMI_SERVER_START_FAILED：58627 未出现监听' }
        }
        [void](Get-KimiToken)
        $script:Acc.dshProcess = Start-Process -FilePath $script:Acc.dshExe -ArgumentList @('web') -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(40)
        do { Start-Sleep -Milliseconds 500 } while (-not (Test-PortOpen 3080) -and [DateTime]::UtcNow -lt $deadline)
        if (-not (Test-PortOpen 3080)) { throw 'DSH_START_FAILED：3080 未出现监听' }
        return @{ status = 'PASS'; summary = ('启动成功；Kimi 由本链启动=' + $script:Acc.startedKimi); code = $null }
      } },
    @{ id = 'probe'; run = {
        try { $page = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/' -UseBasicParsing -TimeoutSec 10 }
        catch { throw 'DSH_HTTP_FAILED：3080 请求失败' }
        if ([int]$page.StatusCode -ne 200) { throw 'DSH_HTTP_STATUS：状态码非 200' }
        $token = Get-KimiToken
        $headers = @{ Authorization = "Bearer $token" }
        $meta = Invoke-RestMethod -Uri 'http://127.0.0.1:58627/api/v1/meta' -Headers $headers -TimeoutSec 5
        if ($null -eq $meta -or [int]$meta.code -ne 0) { throw 'KIMI_META_FAILED' }
        $usage = Invoke-RestMethod -Uri 'http://127.0.0.1:58627/api/v1/oauth/usage' -Headers $headers -TimeoutSec 5
        if ($null -eq $usage -or [int]$usage.code -ne 0) { throw 'KIMI_USAGE_FAILED' }
        $bl = Join-Path $script:Acc.dshHome 'turn-cost-tools\node_modules\.bin\bl.cmd'
        $blSummary = 'bl 缺失（未计额度）'
        if (Test-Path -LiteralPath $bl -PathType Leaf) {
          $previous = $ErrorActionPreference
          $ErrorActionPreference = 'Continue'
          try { $blOut = & $bl usage token-plan --output json 2>&1; $blExit = $LASTEXITCODE }
          finally { $ErrorActionPreference = $previous }
          if ($blExit -eq 0) {
            try {
              $rp = Find-RemainingPercent (($blOut -join "`n") | ConvertFrom-Json)
              if ($null -ne $rp) { $blSummary = 'bl usage 正常（remainingPercent 已读取）' }
              else { $blSummary = 'bl usage 返回但未识别额度字段' }
            } catch { $blSummary = 'bl usage 返回但输出不可解析' }
          } else { $blSummary = 'bl 退出非零（未登录或 CLI 异常）' }
        }
        return @{ status = 'PASS'; summary = ('DSH HTTP 200；Kimi meta/usage code=0；' + $blSummary); code = $null }
      } },
    @{ id = 'stop'; run = {
        if ($null -ne $script:Acc.dshProcess -and -not $script:Acc.dshProcess.HasExited) {
          Stop-Process -Id $script:Acc.dshProcess.Id -Force -ErrorAction SilentlyContinue
          $deadline = [DateTime]::UtcNow.AddSeconds(15)
          do { Start-Sleep -Milliseconds 300 } while ((Test-PortOpen 3080) -and [DateTime]::UtcNow -lt $deadline)
        }
        if (Test-PortOpen 3080) { throw 'DSH_STOP_FAILED：退出后 3080 仍监听' }
        if ($script:Acc.startedKimi) {
          $token = Get-KimiToken
          $shutdown = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:58627/api/v1/shutdown' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body '{}' -TimeoutSec 5
          if ($null -eq $shutdown -or [int]$shutdown.code -ne 0) { throw 'KIMI_SHUTDOWN_REJECTED' }
          $deadline = [DateTime]::UtcNow.AddSeconds(10)
          do { Start-Sleep -Milliseconds 300 } while ((Test-PortOpen 58627) -and [DateTime]::UtcNow -lt $deadline)
          if (Test-PortOpen 58627) { throw 'KIMI_SHUTDOWN_FAILED：58627 仍监听' }
        }
        return @{ status = 'PASS'; summary = '退出成功；本链服务经官方端点/进程句柄停止'; code = $null }
      } },
    @{ id = 'port-residue'; run = {
        if (Test-PortOpen 3080) { throw 'PORT_RESIDUE：3080 残留' }
        if ($script:Acc.startedKimi -and (Test-PortOpen 58627)) { throw 'PORT_RESIDUE：58627 残留' }
        $summary = '3080 已释放'
        if ($script:Acc.startedKimi) { $summary += '；58627 已释放' } else { $summary += '；58627 非本链启动不计残留' }
        return @{ status = 'PASS'; summary = $summary; code = $null }
      } },
    @{ id = 'rollback'; run = {
        $code = Invoke-AcceptancePs1 'Rollback' $script:Acc.extract
        if ($code -ne 0) { throw ('ROLLBACK_FAILED：exit=' + $code) }
        $nowHash = Get-FileSha256 (Join-Path $script:Acc.dshHome 'profiles\web\package.json')
        if ($nowHash -ne $script:Acc.baselineProfileHash) { throw 'ROLLBACK_HASH_MISMATCH：profile 未精确恢复到安装前哈希' }
        return @{ status = 'PASS'; summary = '回滚成功；profile 哈希与安装前基线精确相等'; code = $null }
      } },
    @{ id = 'reinstall-after-rollback'; run = {
        $code = Invoke-AcceptancePs1 'Install' $script:Acc.extract
        if ($code -ne 0) { throw ('REINSTALL_AFTER_ROLLBACK_FAILED：exit=' + $code) }
        return @{ status = 'PASS'; summary = '回滚后再安装成功'; code = $null }
      } }
  )
}

function Invoke-AdapterCleanup {
  $problems = New-Object System.Collections.ArrayList
  # 第一步：停止本链拥有的 DSH 并确认 3080 释放（回滚前置要求端口空闲）
  try {
    if ($null -ne $script:Acc.dshProcess -and -not $script:Acc.dshProcess.HasExited) {
      # DSH 无对外的优雅停止接口；该进程由本验收链启动（所有权明确），直接结束并核对端口释放
      Stop-Process -Id $script:Acc.dshProcess.Id -Force -ErrorAction SilentlyContinue
      $deadline = [DateTime]::UtcNow.AddSeconds(15)
      do { Start-Sleep -Milliseconds 300 } while ((Test-PortOpen 3080) -and [DateTime]::UtcNow -lt $deadline)
      if (Test-PortOpen 3080) { [void]$problems.Add('DSH 进程已停但 3080 仍监听') }
    }
  } catch { [void]$problems.Add('停止 DSH 进程异常') }
  # 第二步：链失败时按前置快照恢复验收前 profile（用安装器自带备份）；成功链末尾已按设计重新安装
  try {
    $failed = $false
    try { $failed = [bool]$script:AcceptanceFailed } catch { }
    if ($failed -and $null -ne $script:Acc.extract -and (Test-Path -LiteralPath (Join-Path $script:Acc.extract 'Install.ps1') -PathType Leaf)) {
      if (Test-PortOpen 3080) {
        [void]$problems.Add('3080 仍被占用，无法执行失败后回滚（请人工核对）')
      } else {
        $code = Invoke-AcceptancePs1 'Rollback' $script:Acc.extract
        if ($code -ne 0) { [void]$problems.Add('失败后回滚退出非零（请人工核对备份目录）') }
      }
    }
  } catch { [void]$problems.Add('失败后回滚异常') }
  try {
    if ($script:Acc.startedKimi -and (Test-PortOpen 58627)) {
      try {
        $token = Get-KimiToken
        [void](Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:58627/api/v1/shutdown' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body '{}' -TimeoutSec 5)
      } catch { }
      Start-Sleep -Seconds 1
      if (Test-PortOpen 58627) { [void]$problems.Add('58627 仍监听（本链启动的 Kimi 未停止）') }
    }
  } catch { [void]$problems.Add('清理 Kimi 服务异常') }
  try {
    if ($null -ne $script:Acc.extract -and (Test-Path -LiteralPath $script:Acc.extract)) {
      Remove-Item -LiteralPath $script:Acc.extract -Recurse -Force
    }
  } catch { [void]$problems.Add('临时解压目录清理失败') }
  if ($problems.Count -gt 0) { throw ('CLEANUP_FAILED：' + ($problems -join '；')) }
  return @{ status = 'PASS'; summary = '清理完成：进程/端口/临时目录均已恢复' }
}

# ---------- sync-versions（bundled pnpm，不依赖全局 PATH） ----------

function Invoke-SyncVersions {
  param([string]$PnpmCmd, [string]$NodeExe)
  $versions = Read-AdapterJson 'versions.json'
  $kimiName = '@moonshot-ai/kimi-code'

  $dshPkg = [ordered]@{
    _generated = '由 versions.json 经 maintenance.ps1 sync-versions 生成，勿手改（合同测试断言相等）'
    name = 'dsh-turn-cost-private-dsh'; version = '1.0.0'; private = $true
    dependencies = [ordered]@{ ([string]$versions.dsh.package) = [string]$versions.dsh.version }
  }
  # 派生 JSON 必须无 BOM（pnpm/npm 的 JSON 解析拒绝 BOM）
  [IO.File]::WriteAllText((Join-Path $RepoRoot 'installer\dsh-package.json'), ($dshPkg | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))

  $toolsPkg = [ordered]@{
    _generated = '由 versions.json 经 maintenance.ps1 sync-versions 生成，勿手改（合同测试断言相等）'
    name = 'dsh-turn-cost-private-tools'; version = '1.0.0'; private = $true
    description = 'Pinned private CLI tools used by the dsh-turn-cost Windows launcher'
    dependencies = [ordered]@{
      $kimiName = [string](Get-JsonProperty $versions.tools $kimiName)
      'bailian-cli' = [string](Get-JsonProperty $versions.tools 'bailian-cli')
    }
  }
  [IO.File]::WriteAllText((Join-Path $RepoRoot 'installer\tools-package.json'), ($toolsPkg | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))

  # pnpm lockfile：临时目录 staging（pnpm 只认 package.json/pnpm-workspace.yaml/pnpm-lock.yaml 本名）
  $tmpDsh = Join-Path ([IO.Path]::GetTempPath()) ('dsh-sync-dsh-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmpDsh -Force | Out-Null
  try {
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'installer\dsh-package.json') -Destination (Join-Path $tmpDsh 'package.json') -Force
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'installer\dsh-pnpm-workspace.yaml') -Destination (Join-Path $tmpDsh 'pnpm-workspace.yaml') -Force
    Push-Location $tmpDsh
    try {
      & $PnpmCmd install --lockfile-only
      if ($LASTEXITCODE -ne 0) { throw ('PNPM_LOCKFILE_FAILED：exit=' + $LASTEXITCODE) }
    } finally { Pop-Location }
    Copy-Item -LiteralPath (Join-Path $tmpDsh 'pnpm-lock.yaml') -Destination (Join-Path $RepoRoot 'installer\dsh-package-lock.yaml') -Force
    # 归一 LF + 无 BOM，与仓库行尾一致（避免换行差异污染后续 diff）
    $lockTarget = Join-Path $RepoRoot 'installer\dsh-package-lock.yaml'
    [IO.File]::WriteAllText($lockTarget, (([IO.File]::ReadAllText($lockTarget)) -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding($false)))
  } finally { if (Test-Path -LiteralPath $tmpDsh) { Remove-Item -LiteralPath $tmpDsh -Recurse -Force } }

  # npm lockfile：node 自带 npm（不经全局 PATH 顺序）
  $npmCli = Join-Path (Split-Path -Parent $NodeExe) 'node_modules\npm\bin\npm-cli.js'
  if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw 'NPM_CLI_MISSING：node 目录中未找到 npm-cli.js' }
  $tmpTools = Join-Path ([IO.Path]::GetTempPath()) ('dsh-sync-tools-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmpTools -Force | Out-Null
  try {
    Copy-Item -LiteralPath (Join-Path $RepoRoot 'installer\tools-package.json') -Destination (Join-Path $tmpTools 'package.json') -Force
    Push-Location $tmpTools
    try {
      & $NodeExe $npmCli install --package-lock-only --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw ('NPM_LOCKFILE_FAILED：exit=' + $LASTEXITCODE) }
    } finally { Pop-Location }
    Copy-Item -LiteralPath (Join-Path $tmpTools 'package-lock.json') -Destination (Join-Path $RepoRoot 'installer\tools-package-lock.json') -Force
    $lockTarget2 = Join-Path $RepoRoot 'installer\tools-package-lock.json'
    [IO.File]::WriteAllText($lockTarget2, (([IO.File]::ReadAllText($lockTarget2)) -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding($false)))
  } finally { if (Test-Path -LiteralPath $tmpTools) { Remove-Item -LiteralPath $tmpTools -Recurse -Force } }
}
