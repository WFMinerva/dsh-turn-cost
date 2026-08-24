$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "ASSERT_FAILED: $Message" }
}

function Hash([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash }

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$temp = Join-Path ([IO.Path]::GetTempPath()) ('dsh-turn-cost-installer-test-' + [Guid]::NewGuid().ToString('N'))
$fixture = Join-Path $temp 'fixture'
$fakeBin = Join-Path $temp 'bin'
$testDshHome = Join-Path $temp 'home'
$profile = Join-Path $testDshHome 'profiles\web'
$oldPath = $env:Path
$oldHome = $env:DSH_HOME

try {
  New-Item -ItemType Directory -Force -Path $fixture,$fakeBin,(Join-Path $fixture 'payload'),$profile | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $repo 'installer') -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $fixture -Recurse -Force
  }
  Set-Content -LiteralPath (Join-Path $fixture 'payload\fake.tgz') -Value 'fixed-payload' -NoNewline -Encoding UTF8
  $payloadHash = Hash (Join-Path $fixture 'payload\fake.tgz')
  [ordered]@{
    schemaVersion = 1
    installerVersion = 'test'
    dsh = [ordered]@{ package = '@deepseek-ai/dsh'; version = '0.1.1-rc.test' }
    plugin = [ordered]@{ name = 'dsh-turn-cost'; version = '9.9.9-test'; file = 'fake.tgz'; sha256 = $payloadHash }
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $fixture 'installer-manifest.json') -Encoding UTF8

  @'
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest)
$ErrorActionPreference = 'Stop'
if ($Rest -contains '--version') { Write-Output '0.1.1-rc.test'; exit 0 }
if ($Rest.Count -gt 0 -and $Rest[0] -eq 'plugin') {
  $profile = Join-Path $env:DSH_HOME 'profiles\web'
  New-Item -ItemType Directory -Force -Path (Join-Path $profile 'node_modules\dsh-turn-cost') | Out-Null
  $path = Join-Path $profile 'package.json'
  if (Test-Path -LiteralPath $path) { $pkg = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json }
  else { $pkg = [pscustomobject]@{ name='dsh-profile-web'; private=$true; dependencies=[pscustomobject]@{}; dsh=[pscustomobject]@{ profile=[pscustomobject]@{ bundles=@('@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app') } } } }
  if ($null -eq $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
  $pkg.dependencies | Add-Member -Force -NotePropertyName 'dsh-turn-cost' -NotePropertyValue ([string]$Rest[-1])
  $bundles = @($pkg.dsh.profile.bundles)
  if ($bundles -notcontains 'dsh-turn-cost') { $pkg.dsh.profile.bundles = @($bundles + 'dsh-turn-cost') }
  $pkg | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $profile 'node_modules\dsh-turn-cost\package.json') -Value '{"name":"dsh-turn-cost","version":"9.9.9-test"}' -Encoding UTF8
  if ($env:FAKE_DSH_FAIL_ADD -eq '1') { exit 9 }
  exit 0
}
if ($Rest -contains '--dump-config') { Write-Output '# == dsh-turn-cost'; Write-Output '- id: turn-cost'; exit 0 }
exit 2
'@ | Set-Content -LiteralPath (Join-Path $fakeBin 'fake-dsh.ps1') -Encoding UTF8
  @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-dsh.ps1" %*
exit /b %errorlevel%
'@ | Set-Content -LiteralPath (Join-Path $fakeBin 'dsh.cmd') -Encoding ASCII

  @'
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest)
$prefixIndex = [Array]::IndexOf($Rest, '--prefix')
if ($prefixIndex -lt 0 -or $prefixIndex + 1 -ge $Rest.Count) { exit 3 }
$prefix = $Rest[$prefixIndex + 1]
$bin = Join-Path $prefix 'node_modules\.bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Set-Content -LiteralPath (Join-Path $bin 'kimi.cmd') -Value '@echo off' -Encoding ASCII
Set-Content -LiteralPath (Join-Path $bin 'bl.cmd') -Value '@echo off' -Encoding ASCII
Write-Output 'fake npm install output'
exit 0
'@ | Set-Content -LiteralPath (Join-Path $fakeBin 'fake-npm.ps1') -Encoding UTF8
  @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-npm.ps1" %*
exit /b %errorlevel%
'@ | Set-Content -LiteralPath (Join-Path $fakeBin 'npm.cmd') -Encoding ASCII

  [ordered]@{
    name = 'dsh-profile-web'
    private = $true
    dependencies = [ordered]@{ 'unrelated-plugin' = '1.0.0'; 'dsh-turn-cost' = 'file:C:/old/dsh-turn-cost-0.3.0.tgz' }
    dsh = [ordered]@{ profile = [ordered]@{ bundles = @('@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','unrelated-plugin','dsh-turn-cost') } }
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $profile 'package.json') -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $profile 'cordis.patch.yml') -Value "- id: unrelated`n  name: unrelated-plugin" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $testDshHome 'settings.yaml') -Value "llm-pi-ai:`n  providers: {}" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $testDshHome '.credentials.yaml') -Value 'SECRET_REF: test-secret-never-read' -Encoding UTF8

  $originalProfile = Hash (Join-Path $profile 'package.json')
  $settingsHash = Hash (Join-Path $testDshHome 'settings.yaml')
  $credentialsHash = Hash (Join-Path $testDshHome '.credentials.yaml')
  $env:Path = "$fakeBin;$oldPath"
  $env:DSH_HOME = $testDshHome

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Install.ps1') -Mode Install -PackageRoot $fixture -NonInteractive
  Assert-True ($LASTEXITCODE -eq 0) 'fresh install exits zero'
  $installed = Get-Content -Raw -LiteralPath (Join-Path $profile 'package.json') | ConvertFrom-Json
  Assert-True ($installed.dsh.profile.bundles -contains 'unrelated-plugin') 'unrelated bundle preserved'
  Assert-True ($installed.dsh.profile.bundles -contains 'dsh-turn-cost') 'turn-cost bundle installed'
  $expectedPayload = Join-Path $testDshHome 'turn-cost-installer-package\payload\fake.tgz'
  Assert-True ([string]$installed.dependencies.'dsh-turn-cost' -eq $expectedPayload) 'profile dependency uses permanent installer payload'
  Assert-True ((Hash (Join-Path $testDshHome 'settings.yaml')) -eq $settingsHash) 'settings byte-identical'
  Assert-True ((Hash (Join-Path $testDshHome '.credentials.yaml')) -eq $credentialsHash) 'credentials byte-identical'
  Assert-True (Test-Path -LiteralPath (Join-Path $testDshHome 'turn-cost-launcher\启动 DSH（含额度）.cmd')) 'launcher copied'
  $state1 = Get-Content -Raw -LiteralPath (Join-Path $testDshHome 'turn-cost-installer\state.json') | ConvertFrom-Json
  Assert-True ($state1.toolsReady -is [bool]) 'toolsReady is a boolean'
  Assert-True ([bool]$state1.toolsReady) 'private tools are ready'

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Install.ps1') -Mode Install -PackageRoot $fixture -NonInteractive
  Assert-True ($LASTEXITCODE -eq 0) 'same-version repair exits zero'
  $state2 = Get-Content -Raw -LiteralPath (Join-Path $testDshHome 'turn-cost-installer\state.json') | ConvertFrom-Json
  Assert-True ([string]$state1.backupPath -eq [string]$state2.backupPath) 'idempotent repair keeps original rollback point'

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Install.ps1') -Mode Rollback -PackageRoot $fixture -NonInteractive
  Assert-True ($LASTEXITCODE -eq 0) 'rollback exits zero'
  Assert-True ((Hash (Join-Path $profile 'package.json')) -eq $originalProfile) 'rollback restores profile manifest'
  Assert-True ((Hash (Join-Path $testDshHome '.credentials.yaml')) -eq $credentialsHash) 'rollback leaves credentials unchanged'

  $beforeTamper = Hash (Join-Path $profile 'package.json')
  Add-Content -LiteralPath (Join-Path $fixture 'payload\fake.tgz') -Value 'tamper'
  $savedPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Install.ps1') -Mode Install -PackageRoot $fixture -NonInteractive 2>$null
  $tamperExit = $LASTEXITCODE
  $ErrorActionPreference = $savedPreference
  Assert-True ($tamperExit -ne 0) 'tampered payload rejected'
  Assert-True ((Hash (Join-Path $profile 'package.json')) -eq $beforeTamper) 'tamper rejection makes no profile change'

  Set-Content -LiteralPath (Join-Path $fixture 'payload\fake.tgz') -Value 'fixed-payload' -NoNewline -Encoding UTF8
  $env:FAKE_DSH_FAIL_ADD = '1'
  $ErrorActionPreference = 'Continue'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Install.ps1') -Mode Install -PackageRoot $fixture -NonInteractive 2>$null
  $failureExit = $LASTEXITCODE
  $ErrorActionPreference = $savedPreference
  Assert-True ($failureExit -ne 0) 'failed plugin add surfaces failure'
  Assert-True ((Hash (Join-Path $profile 'package.json')) -eq $beforeTamper) 'failed add restores profile manifest'
  Remove-Item Env:FAKE_DSH_FAIL_ADD -ErrorAction SilentlyContinue

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Install.ps1') -Mode Install -PackageRoot $fixture -NonInteractive
  Assert-True ($LASTEXITCODE -eq 0) 'reinstall before uninstall exits zero'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $fixture 'Install.ps1') -Mode Uninstall -PackageRoot $fixture -NonInteractive
  Assert-True ($LASTEXITCODE -eq 0) 'uninstall exits zero'
  Assert-True ((Hash (Join-Path $profile 'package.json')) -eq $originalProfile) 'uninstall restores profile manifest'
  Assert-True ((Hash (Join-Path $testDshHome '.credentials.yaml')) -eq $credentialsHash) 'uninstall leaves credentials unchanged'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $testDshHome 'turn-cost-installer-package'))) 'uninstall removes permanent package'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $testDshHome 'turn-cost-launcher'))) 'uninstall removes launcher'

  Write-Output 'WINDOWS_INSTALLER_TEST_OK'
} finally {
  if ($null -ne $oldPath) { $env:Path = $oldPath }
  if ($null -ne $oldHome) { $env:DSH_HOME = $oldHome } else { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
  Remove-Item Env:FAKE_DSH_FAIL_ADD -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
