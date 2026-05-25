# Pipeflow agent installer for Windows.
# Auto-detects host capability (Docker Desktop > NSSM service) and installs the agent.
#
# Usage (PowerShell as Administrator):
#   .\install.ps1 -Backend https://pipeflow.example.com `
#                 -Token   PROD_TOKEN `
#                 -Id      myservice-prod `
#                 -Label   "My Service" `
#                 -Kind    svc `
#                 -Color   blue
#
# Re-running upgrades the install in place.

[CmdletBinding()]
param(
  [ValidateSet('auto','docker','nssm')]
  [string]$Method = 'auto',
  [string]$Backend,
  [string]$Token,
  [string]$Id,
  [string]$Label,
  [ValidateSet('user','ext','fe','be','svc','wk','kf','db','obs')]
  [string]$Kind = 'svc',
  [string]$Color = 'blue',
  [string]$Targets,
  [string]$Flows,
  [string]$RepoUrl    = 'https://github.com/andif/pipline-data-flow.git',
  [string]$RepoRef    = 'main',
  [string]$InstallDir = 'C:\ProgramData\pipeflow',
  [string]$ImageTag   = 'pipeflow-agent:local',
  [string]$Image,
  [string]$ServiceName = 'PipeflowAgent',
  [int]$HealthcheckTimeout = 30,
  [switch]$NoHealthcheck
)

$ErrorActionPreference = 'Stop'

function Log     { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Cyan }
function Warn    { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Yellow }
function Die     { param($m) Write-Host "[pipeflow] $m" -ForegroundColor Red; exit 1 }
function Has-Cmd { param($n) [bool](Get-Command $n -ErrorAction SilentlyContinue) }

# ─── Admin check ─────────────────────────────────────────────────────────────
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($me)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Die "must run as Administrator"
}

# ─── Method detection ────────────────────────────────────────────────────────
function Test-Docker {
  if (-not (Has-Cmd docker)) { return $false }
  try { docker info *> $null; return $LASTEXITCODE -eq 0 } catch { return $false }
}
function Test-Nssm   { Has-Cmd nssm }
function Test-Python { Has-Cmd python }
function Test-Git    { Has-Cmd git }

if ($Method -eq 'auto') {
  if (Test-Docker)   { $Method = 'docker' }
  elseif (Test-Nssm) { $Method = 'nssm' }
  else { Die "neither Docker Desktop nor NSSM available. Install one: 'choco install nssm' or Docker Desktop" }
  Log "auto-selected method: $Method"
}

switch ($Method) {
  'docker' {
    if (-not (Test-Docker)) { Die "method=docker but Docker not usable" }
    if (-not $Image -and -not (Test-Git)) { Die "git required to build image (or pass -Image <ref>)" }
  }
  'nssm' {
    if (-not (Test-Nssm))   { Die "method=nssm but NSSM not installed. Try: choco install nssm" }
    if (-not (Test-Python)) { Die "python required for NSSM method" }
    if (-not (Test-Git))    { Die "git required" }
  }
}

$needSource = -not ($Method -eq 'docker' -and $Image)

# ─── Prompt for missing required values ──────────────────────────────────────
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

if (-not $Backend) { Die "backend required" }
if (-not $Token)   { Die "token required" }
if (-not $Id)      { Die "id required" }

# ─── Fetch / refresh source ──────────────────────────────────────────────────
if ($needSource) {
  if (Test-Path (Join-Path $InstallDir '.git')) {
    Log "updating existing checkout at $InstallDir"
    git -C $InstallDir fetch --depth 1 origin $RepoRef | Out-Null
    git -C $InstallDir reset --hard "origin/$RepoRef" | Out-Null
  } else {
    Log "cloning $RepoUrl ($RepoRef) into $InstallDir"
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir -Parent) | Out-Null
    git clone --depth 1 --branch $RepoRef $RepoUrl $InstallDir | Out-Null
  }
} else {
  Log "skipping source fetch (using pulled image $Image)"
}

# ─── Write env file ──────────────────────────────────────────────────────────
$envDir  = 'C:\ProgramData\pipeflow\env'
$envFile = Join-Path $envDir "$Id.env"
New-Item -ItemType Directory -Force -Path $envDir | Out-Null
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
Set-Content -Path $envFile -Value $lines -Encoding ASCII
# Restrict to admins + SYSTEM only.
icacls $envFile /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" *> $null
Log "wrote env file: $envFile"

# ─── Install: docker ─────────────────────────────────────────────────────────
function Install-Docker {
  $container = "pipeflow-$Id"
  $imageRef = $ImageTag
  if ($Image) {
    Log "pulling image $Image"
    docker pull $Image | Out-Null
    $imageRef = $Image
  } else {
    Log "building image $ImageTag from $InstallDir"
    docker build -t $ImageTag -f (Join-Path $InstallDir 'agents\Dockerfile') $InstallDir | Out-Null
  }

  $existing = docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch -Pattern $container
  if ($existing) {
    Log "removing previous container $container"
    docker rm -f $container | Out-Null
  }

  Log "starting container $container"
  docker run -d --name $container --restart unless-stopped --env-file $envFile $imageRef | Out-Null

  Log "done. tail logs:  docker logs -f $container"
}

# ─── Install: NSSM ───────────────────────────────────────────────────────────
function Install-Nssm {
  $venv   = Join-Path $InstallDir '.venv'
  $python = Join-Path $venv 'Scripts\python.exe'
  $runner = Join-Path $InstallDir 'agents\runner.py'
  $svc    = "$ServiceName-$Id"

  if (-not (Test-Path $python)) {
    Log "creating venv at $venv"
    python -m venv $venv
  }
  Log "installing sdk-py into venv"
  & $python -m pip install --quiet --upgrade pip
  & $python -m pip install --quiet (Join-Path $InstallDir 'packages\sdk-py')

  # Remove existing service if present.
  $existing = & nssm status $svc 2>$null
  if ($LASTEXITCODE -eq 0) {
    Log "removing previous service $svc"
    & nssm stop   $svc confirm | Out-Null
    & nssm remove $svc confirm | Out-Null
  }

  Log "installing NSSM service $svc"
  & nssm install $svc $python '-u' $runner | Out-Null
  & nssm set $svc AppDirectory $InstallDir | Out-Null
  & nssm set $svc Start SERVICE_AUTO_START | Out-Null
  & nssm set $svc AppStdout (Join-Path $InstallDir "logs\$Id.log") | Out-Null
  & nssm set $svc AppStderr (Join-Path $InstallDir "logs\$Id.err.log") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null

  # Push env vars onto the service.
  $envBlob = ($lines | ForEach-Object { $_ }) -join "`r`n"
  & nssm set $svc AppEnvironmentExtra $envBlob | Out-Null

  & nssm start $svc | Out-Null
  Log "done. tail logs:  Get-Content $InstallDir\logs\$Id.log -Wait"
}

switch ($Method) {
  'docker' { Install-Docker }
  'nssm'   { Install-Nssm }
}

# ─── Post-install health check ───────────────────────────────────────────────
function HealthCheck {
  if ($NoHealthcheck) { Log "healthcheck skipped"; return }
  $url = "$($Backend.TrimEnd('/'))/api/topology"
  Log "waiting up to ${HealthcheckTimeout}s for '$Id' to appear at $url"
  $deadline = (Get-Date).AddSeconds($HealthcheckTimeout)
  while ((Get-Date) -lt $deadline) {
    try {
      $body = Invoke-RestMethod -Uri $url -TimeoutSec 5
      if ($body.nodes | Where-Object { $_.id -eq $Id }) {
        Log "healthcheck OK — agent '$Id' registered at backend"
        return
      }
    } catch { }
    Start-Sleep -Seconds 2
  }
  Warn "healthcheck FAILED — agent did not appear within ${HealthcheckTimeout}s"
  switch ($Method) {
    'docker' { Warn "  docker logs pipeflow-$Id" }
    'nssm'   { Warn "  Get-Content $InstallDir\logs\$Id.err.log -Tail 50" }
  }
  exit 2
}

HealthCheck

Log "agent '$Id' installed via $Method, pointing at $Backend"
