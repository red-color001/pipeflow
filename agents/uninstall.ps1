# Pipeflow agent uninstaller for Windows (binary edition).
# Stops + removes the NSSM service for the given agent id, removes its
# config file. Optionally deregisters at the backend or purges shared bits.
#
# Usage (PowerShell as Administrator):
#   .\uninstall.ps1 -Id myservice-prod
#   .\uninstall.ps1 -Id myservice-prod -Deregister
#   .\uninstall.ps1 -Id myservice-prod -Purge

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Id,
  [string]$Backend,
  [string]$Token,
  [string]$InstallDir  = 'C:\Program Files\Pipeflow',
  [string]$ConfigDir   = 'C:\ProgramData\Pipeflow',
  [string]$ServiceName = 'PipeflowAgent',
  [switch]$Deregister,
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'

function Log  { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Cyan }
function Warn { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Red; exit 1 }

$me = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($me)).IsInRole(
        [Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Die "must run as Administrator"
}

$configFile = Join-Path $ConfigDir "$Id.env"
$svc        = "$ServiceName-$Id"
$binPath    = Join-Path $InstallDir 'pipeflow-agent.exe'
$nssm       = Join-Path $InstallDir 'nssm\nssm.exe'
if (-not (Test-Path $nssm)) {
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { $nssm = $cmd.Source } else { $nssm = $null }
}

# Optional deregister.
if ($Deregister) {
  if (-not $Backend -or -not $Token) {
    if (Test-Path $configFile) {
      Log "loading backend/token from $configFile"
      Get-Content $configFile | ForEach-Object {
        if ($_ -match '^PIPEFLOW_BACKEND=(.+)$' -and -not $Backend) { $Backend = $matches[1] }
        if ($_ -match '^PIPEFLOW_TOKEN=(.+)$'   -and -not $Token)   { $Token   = $matches[1] }
      }
    }
  }
  if ($Backend -and $Token) {
    Log "deregistering '$Id' at backend"
    try {
      Invoke-RestMethod -Method Post `
        -Uri "$($Backend.TrimEnd('/'))/agents/$Id/deregister" `
        -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 5
    } catch { Warn "deregister request failed: $_" }
  } else {
    Warn "skipping deregister: backend/token unavailable"
  }
}

if ($nssm -and (Test-Path $nssm)) {
  $exists = $false
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $null = & $nssm status $svc 2>&1
    if ($LASTEXITCODE -eq 0) { $exists = $true }
  } finally { $ErrorActionPreference = $prev }
  if ($exists) {
    Log "stopping + removing service $svc"
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
      & $nssm stop   $svc confirm 2>&1 | Out-Null
      & $nssm remove $svc confirm 2>&1 | Out-Null
    } finally { $ErrorActionPreference = $prev }
  } else {
    Warn "no service $svc found"
  }
} else {
  Warn "nssm.exe not found — skipping service removal (orphan service may remain)"
}

if (Test-Path $configFile) {
  Log "removing config $configFile"
  Remove-Item $configFile -Force
}

if ($Purge) {
  $remaining = (Get-ChildItem $ConfigDir -Filter '*.env' -ErrorAction SilentlyContinue).Count
  if ($remaining -eq 0) {
    if (Test-Path $binPath) { Log "removing binary $binPath"; Remove-Item $binPath -Force }
    $logsDir = Join-Path $InstallDir 'logs'
    if (Test-Path $logsDir) { Remove-Item $logsDir -Recurse -Force }
    $nssmDir = Join-Path $InstallDir 'nssm'
    if (Test-Path $nssmDir) { Remove-Item $nssmDir -Recurse -Force }
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $ConfigDir)  { Remove-Item $ConfigDir  -Recurse -Force -ErrorAction SilentlyContinue }
  } else {
    Warn "purge requested but $remaining other agent(s) still configured -- keeping binary + nssm"
  }
}

Log "agent '$Id' uninstalled"
