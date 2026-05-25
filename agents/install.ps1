# Pipeflow agent installer for Windows (slim binary edition).
# Downloads pre-built pipeflow-agent.exe from GitHub Releases, drops it on
# the host, registers it as a Windows service via NSSM (auto-downloaded if
# absent). No Python, no git clone, no venv needed.
#
# Usage (PowerShell as Administrator):
#   .\install.ps1 -Backend https://pipeflow.example.com `
#                 -Token   PROD_TOKEN `
#                 -Id      myservice-prod `
#                 -Label   "My Service" `
#                 -Kind    svc -Color indigo
#
# Re-running upgrades the binary + service in place.

[CmdletBinding()]
param(
  [string]$Backend,
  [string]$Token,
  [string]$Id,
  [string]$Label,
  [ValidateSet('user','ext','fe','be','svc','wk','kf','db','obs')]
  [string]$Kind = 'svc',
  [ValidateSet('indigo','teal','amber','red','violet','orange','green','cyan','pink','purple','yorange','neutral')]
  [string]$Color = 'indigo',
  [string]$Targets,
  [string]$Flows,
  [string]$ReleaseRepo  = 'red-color001/pipeflow',
  [string]$ReleaseTag   = 'latest',
  [string]$InstallDir   = 'C:\Program Files\Pipeflow',
  [string]$ConfigDir    = 'C:\ProgramData\Pipeflow',
  [string]$ServiceName  = 'PipeflowAgent',
  [string]$LocalBinary,
  [int]$HealthcheckTimeout = 30,
  [switch]$NoHealthcheck
)

$ErrorActionPreference = 'Stop'

function Log  { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Cyan }
function Warn { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Red; exit 1 }

# ─── Admin check ─────────────────────────────────────────────────────────────
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($me)).IsInRole(
        [Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Die "must run as Administrator"
}

# ─── Detect arch ─────────────────────────────────────────────────────────────
$arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { Die "32-bit Windows not supported" }
$artifact = "pipeflow-agent-windows-$arch.exe"
Log "detected: windows-$arch (artifact: $artifact)"

# ─── Prompt for missing values ───────────────────────────────────────────────
function Prompt-If-Empty {
  param([ref]$Var, [string]$Msg, [string]$Default = '')
  if ($Var.Value) { return }
  if ([Console]::IsInputRedirected) { Die "missing -$($Msg.Replace(' ','')) and no TTY for prompt" }
  $suffix = if ($Default) { " [$Default]" } else { '' }
  $val = Read-Host "$Msg$suffix"
  if (-not $val -and $Default) { $val = $Default }
  $Var.Value = $val
}

Prompt-If-Empty ([ref]$Backend) 'Backend URL'             'https://pipeflow.example.com'
Prompt-If-Empty ([ref]$Token)   'Agent token'
Prompt-If-Empty ([ref]$Id)      'Agent ID (unique slug)'
if (-not $Label) { $Label = $Id }

foreach ($v in @('Backend','Token','Id','Label','Kind','Color')) {
  if (-not (Get-Variable $v -ValueOnly)) { Die "$v required" }
}

# ─── Ensure NSSM available (auto-download if missing) ────────────────────────
$nssmDir = Join-Path $InstallDir 'nssm'
$nssmExe = Join-Path $nssmDir 'nssm.exe'

function Ensure-Nssm {
  $existing = Get-Command nssm -ErrorAction SilentlyContinue
  if ($existing) { return $existing.Source }
  if (Test-Path $nssmExe) { return $nssmExe }

  Log "NSSM not found — downloading"
  New-Item -ItemType Directory -Force -Path $nssmDir | Out-Null
  $zipUrl = 'https://nssm.cc/release/nssm-2.24.zip'
  $tmpZip = Join-Path $env:TEMP "nssm-$([guid]::NewGuid()).zip"
  Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing
  $tmpExtract = Join-Path $env:TEMP "nssm-extract-$([guid]::NewGuid())"
  Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract -Force
  $src = Join-Path $tmpExtract 'nssm-2.24\win64\nssm.exe'
  if (-not (Test-Path $src)) { Die "NSSM extract failed: $src not found" }
  Copy-Item $src $nssmExe -Force
  Remove-Item $tmpZip, $tmpExtract -Recurse -Force -ErrorAction SilentlyContinue
  Log "NSSM installed: $nssmExe"
  return $nssmExe
}

$nssm = Ensure-Nssm

# ─── Download / install binary ───────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$binPath = Join-Path $InstallDir 'pipeflow-agent.exe'

if ($LocalBinary) {
  Log "installing local binary: $LocalBinary"
  if (-not (Test-Path $LocalBinary)) { Die "local binary not found: $LocalBinary" }
  Copy-Item $LocalBinary $binPath -Force
} else {
  if ($ReleaseTag -eq 'latest') {
    $url = "https://github.com/$ReleaseRepo/releases/latest/download/$artifact"
  } else {
    $url = "https://github.com/$ReleaseRepo/releases/download/$ReleaseTag/$artifact"
  }
  Log "downloading $url"
  $tmp = Join-Path $env:TEMP "pipeflow-agent-$([guid]::NewGuid()).exe"
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
  } catch {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    Die "download failed — check ReleaseRepo='$ReleaseRepo' and ReleaseTag='$ReleaseTag'. Error: $_"
  }
  Copy-Item $tmp $binPath -Force
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
Log "installed binary: $binPath"

# ─── Write config file ───────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$configFile = Join-Path $ConfigDir "$Id.env"
$lines = @(
  "PIPEFLOW_BACKEND=$Backend"
  "PIPEFLOW_TOKEN=$Token"
  "AGENT_ID=$Id"
  "AGENT_LABEL=$Label"
  "AGENT_KIND=$Kind"
  "AGENT_COLOR=$Color"
)
if ($Targets) { $lines += "AGENT_TARGETS=$Targets" }
if ($Flows)   { $lines += "AGENT_FLOWS=$Flows" }
Set-Content -Path $configFile -Value $lines -Encoding ASCII
icacls $configFile /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" *> $null
Log "wrote config: $configFile (admins-only)"

# ─── Register / update NSSM service ──────────────────────────────────────────
$svc = "$ServiceName-$Id"
$logsDir = Join-Path $InstallDir 'logs'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$svcExists = $false
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try {
  $null = & $nssm status $svc 2>&1
  if ($LASTEXITCODE -eq 0) { $svcExists = $true }
} finally { $ErrorActionPreference = $prev }

if ($svcExists) {
  Log "stopping existing service $svc for upgrade"
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    & $nssm stop   $svc confirm 2>&1 | Out-Null
    & $nssm remove $svc confirm 2>&1 | Out-Null
  } finally { $ErrorActionPreference = $prev }
}

# nssm.exe writes informational lines like "SERVICE_START_PENDING" to stderr,
# which $ErrorActionPreference='Stop' would promote to terminating exceptions.
# Lower the preference for the NSSM section only.
function Invoke-Nssm {
  param([string[]]$NssmArgs)
  # nssm.exe writes informational lines (e.g. SERVICE_START_PENDING) to stderr,
  # which $ErrorActionPreference='Stop' would promote to terminating exceptions.
  # Lower the preference for the call only.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $nssm @NssmArgs 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Warn "nssm $($NssmArgs -join ' ') -> exit $LASTEXITCODE"
    }
  } finally {
    $ErrorActionPreference = $prev
  }
}

Log "registering service $svc"
Invoke-Nssm @('install', $svc, $binPath, '--config', $configFile)
Invoke-Nssm @('set', $svc, 'AppDirectory',    $InstallDir)
Invoke-Nssm @('set', $svc, 'Start',           'SERVICE_AUTO_START')
Invoke-Nssm @('set', $svc, 'AppStdout',       (Join-Path $logsDir "$Id.log"))
Invoke-Nssm @('set', $svc, 'AppStderr',       (Join-Path $logsDir "$Id.err.log"))
Invoke-Nssm @('set', $svc, 'AppRotateFiles',  '1')
Invoke-Nssm @('set', $svc, 'AppRotateBytes',  '10485760')
Invoke-Nssm @('start', $svc)
Log "service started. tail: Get-Content $logsDir\$Id.log -Wait"

# ─── Healthcheck ─────────────────────────────────────────────────────────────
function HealthCheck {
  if ($NoHealthcheck) { Log "healthcheck skipped"; return }
  $url = "$($Backend.TrimEnd('/'))/topology"
  Log "waiting up to ${HealthcheckTimeout}s for '$Id' to register live at $url"
  $deadline = (Get-Date).AddSeconds($HealthcheckTimeout)
  while ((Get-Date) -lt $deadline) {
    try {
      $body = Invoke-RestMethod -Uri $url -TimeoutSec 5
      $node = $body.nodes | Where-Object { $_.id -eq $Id } | Select-Object -First 1
      # Stub rows can linger from prior deregisters — require live + non-stub.
      if ($node -and -not $node.stub -and $node.status -eq 'live') {
        Log "healthcheck OK -- agent '$Id' is live"
        return
      }
    } catch { }
    Start-Sleep -Seconds 2
  }
  Warn "healthcheck FAILED within ${HealthcheckTimeout}s -- check:"
  Warn "  Get-Service $svc"
  Warn "  Get-Content $logsDir\$Id.err.log -Tail 50"
  exit 2
}

HealthCheck

Log "agent '$Id' installed, pointing at $Backend"
