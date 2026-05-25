# Pipeflow agent uninstaller for Windows.
# Removes container or NSSM service for a given agent id, plus its env file.
#
# Usage (PowerShell as Administrator):
#   .\uninstall.ps1 -Id myservice-prod
#   .\uninstall.ps1 -Id myservice-prod -Deregister -Backend https://... -Token ...
#   .\uninstall.ps1 -Id myservice-prod -Purge

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Id,
  [ValidateSet('auto','docker','nssm')]
  [string]$Method = 'auto',
  [string]$Backend,
  [string]$Token,
  [string]$InstallDir  = 'C:\ProgramData\pipeflow',
  [string]$ServiceName = 'PipeflowAgent',
  [switch]$Deregister,
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'

function Log  { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Cyan }
function Warn { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Red; exit 1 }

$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($me)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Die "must run as Administrator"
}

$envFile  = "C:\ProgramData\pipeflow\env\$Id.env"
$container = "pipeflow-$Id"
$svc      = "$ServiceName-$Id"

# Auto-detect.
if ($Method -eq 'auto') {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    $found = docker ps -a --format '{{.Names}}' 2>$null | Select-String -SimpleMatch -Pattern $container
    if ($found) { $Method = 'docker' }
  }
  if ($Method -eq 'auto' -and (Get-Command nssm -ErrorAction SilentlyContinue)) {
    & nssm status $svc 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $Method = 'nssm' }
  }
  if ($Method -eq 'auto') { Die "could not detect existing install for '$Id' — pass -Method explicitly" }
  Log "detected method: $Method"
}

# Optional: deregister.
if ($Deregister) {
  if (-not $Backend -or -not $Token) {
    if (Test-Path $envFile) {
      Log "loading backend/token from $envFile"
      Get-Content $envFile | ForEach-Object {
        if ($_ -match '^PIPEFLOW_BACKEND=(.+)$' -and -not $Backend) { $Backend = $matches[1] }
        if ($_ -match '^PIPEFLOW_TOKEN=(.+)$'   -and -not $Token)   { $Token   = $matches[1] }
      }
    }
  }
  if ($Backend -and $Token) {
    Log "deregistering '$Id' at backend"
    try {
      Invoke-RestMethod -Method Post -Uri "$($Backend.TrimEnd('/'))/api/agents/$Id/deregister" `
        -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 5
    } catch { Warn "deregister request failed: $_" }
  } else {
    Warn "skipping deregister: backend/token not provided"
  }
}

switch ($Method) {
  'docker' {
    $found = docker ps -a --format '{{.Names}}' 2>$null | Select-String -SimpleMatch -Pattern $container
    if ($found) {
      Log "stopping + removing container $container"
      docker rm -f $container | Out-Null
    } else {
      Warn "no container named $container"
    }
  }
  'nssm' {
    & nssm status $svc 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Log "stopping + removing service $svc"
      & nssm stop   $svc confirm | Out-Null
      & nssm remove $svc confirm | Out-Null
    } else {
      Warn "no service $svc"
    }
  }
}

if (Test-Path $envFile) {
  Log "removing env file $envFile"
  Remove-Item $envFile -Force
}

if ($Purge -and (Test-Path $InstallDir)) {
  Log "purging $InstallDir (affects ALL agents on this host)"
  Remove-Item $InstallDir -Recurse -Force
}

Log "agent '$Id' uninstalled"
