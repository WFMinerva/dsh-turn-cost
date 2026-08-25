[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Resolve-DshHome {
  $candidate = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' } else { $env:DSH_HOME }
  return [IO.Path]::GetFullPath($candidate)
}

$dshHome = Resolve-DshHome
$statePath = Join-Path $dshHome 'turn-cost-installer\state.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw 'STATE_NOT_FOUND：请先运行安装器' }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$toolsBin = Join-Path $dshHome 'turn-cost-tools\node_modules\.bin'
$env:Path = "$toolsBin;$($env:Path)"

# Kimi's default quota route uses the DSH-managed KIMI_CODING_API_KEY and the
# official HTTPS usage endpoint.  Do not start or require a local Kimi OAuth
# server here.  Users who explicitly configure a loopback baseUrl own that
# optional service lifecycle themselves.
$file = [string]$state.dsh.executable
$args = @($state.dsh.prefix) + @('web')
& $file @args
if ($LASTEXITCODE -ne 0) { throw "DSH_EXIT_$LASTEXITCODE" }
