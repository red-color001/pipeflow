# Install a Pipeflow Agent

Pre-built single-file binaries are published on every `v*` tag at:
<https://github.com/red-color001/pipeflow/releases/latest>

The installers download the right binary for your host, write a config
file, register a service, and verify the agent is live with the backend.

---

## Linux (systemd)

```bash
curl -fsSL https://raw.githubusercontent.com/red-color001/pipeflow/main/agents/install.sh \
  | sudo bash -s -- \
      --backend https://pipeflow.example.com \
      --token   YOUR_AGENT_TOKEN \
      --id      myservice-prod \
      --label   "My Service" \
      --kind    svc \
      --color   indigo
```

Omit the flags to be prompted interactively. Supported arches:
`linux-x64`, `linux-arm64`.

### What it does

1. Downloads `pipeflow-agent-linux-<arch>` from the latest GitHub release
   into `/usr/local/bin/pipeflow-agent`.
2. Writes `/etc/pipeflow/<id>.env` (mode 0600) with `PIPEFLOW_BACKEND`,
   `PIPEFLOW_TOKEN`, and the agent metadata.
3. Installs a templated systemd unit `pipeflow-agent@.service`, enables
   and starts the `<id>` instance.
4. Polls `GET <backend>/topology` until the agent shows up as
   `status=live, stub=false` (30s timeout).

### Manage

```bash
systemctl status   pipeflow-agent@myservice-prod
systemctl restart  pipeflow-agent@myservice-prod
journalctl -u      pipeflow-agent@myservice-prod -f
```

### Uninstall

```bash
sudo bash agents/uninstall.sh --id myservice-prod --deregister
# add --purge to also remove the binary + systemd template unit
```

---

## Windows (NSSM service)

PowerShell as **Administrator**:

```powershell
$flags = @(
  '-Backend','https://pipeflow.example.com',
  '-Token','YOUR_AGENT_TOKEN',
  '-Id','myservice-prod',
  '-Label','My Service',
  '-Kind','svc','-Color','indigo'
)
$installer = "$env:TEMP\pipeflow-install.ps1"
Invoke-WebRequest -UseBasicParsing `
  -Uri  https://raw.githubusercontent.com/red-color001/pipeflow/main/agents/install.ps1 `
  -OutFile $installer
& $installer @flags
```

### What it does

1. Downloads `pipeflow-agent-windows-x64.exe` from the latest release
   into `C:\Program Files\Pipeflow\pipeflow-agent.exe`.
2. Auto-downloads NSSM (~340 KB) into `C:\Program Files\Pipeflow\nssm\`
   if not already on `PATH`.
3. Writes `C:\ProgramData\Pipeflow\<id>.env` (admins + SYSTEM only).
4. Registers `PipeflowAgent-<id>` as an auto-start Windows service.
5. Polls `GET <backend>/topology` until live (30s timeout).

### Manage

```powershell
Get-Service     PipeflowAgent-myservice-prod
Restart-Service PipeflowAgent-myservice-prod
Get-Content     'C:\Program Files\Pipeflow\logs\myservice-prod.log' -Wait
```

### Uninstall

```powershell
& 'C:\Users\andif\Documents\GitHub\pipline-data-flow\agents\uninstall.ps1' `
  -Id myservice-prod -Deregister
# add -Purge to also remove the binary + NSSM
```

---

## macOS (Apple Silicon)

Same `install.sh` works on macOS. Service registration is currently
systemd-only — on macOS the script will exit with an error. As an
interim, run the binary directly under launchd or in a terminal:

```bash
curl -fsSL -o pipeflow-agent \
  https://github.com/red-color001/pipeflow/releases/latest/download/pipeflow-agent-macos-arm64
chmod +x pipeflow-agent

cat > pipeflow.env <<EOF
PIPEFLOW_BACKEND=https://pipeflow.example.com
PIPEFLOW_TOKEN=YOUR_AGENT_TOKEN
AGENT_ID=myservice-prod
AGENT_LABEL=My Service
AGENT_KIND=svc
AGENT_COLOR=indigo
EOF

./pipeflow-agent --config pipeflow.env
```

Intel Macs are not built in CI — build locally with
`pyinstaller agents/pyinstaller.spec`.

---

## Flags reference

| Flag (sh / ps1)         | Required | Description                                                    |
|-------------------------|----------|----------------------------------------------------------------|
| `--backend / -Backend`  | yes      | Pipeflow backend URL (e.g. `https://pipeflow.example.com`)     |
| `--token / -Token`      | yes      | Bearer token expected by the backend (`AGENT_TOKEN` env there) |
| `--id / -Id`            | yes      | Unique slug for this agent (also the systemd / NSSM instance)  |
| `--label / -Label`      | yes      | Human-readable name shown in the UI                            |
| `--kind / -Kind`        | yes      | One of: `user, ext, fe, be, svc, wk, kf, db, obs`              |
| `--color / -Color`      | no       | `indigo, teal, amber, red, violet, orange, green, cyan, pink, purple, yorange, neutral` (default: `indigo`) |
| `--targets / -Targets`  | no       | JSON array of declared outgoing edges, e.g. `[{"to":"postgres","color":"teal"}]` |
| `--flows / -Flows`      | no       | JSON array of flow patterns, e.g. `[{"to":"postgres","interval_min":0.5,"interval_max":1.5,"bytes_min":200,"bytes_max":2000}]` |
| `--release-tag / -ReleaseTag`     | no | Pin a specific release tag (default: `latest`)             |
| `--release-repo / -ReleaseRepo`   | no | Override fork (default: `red-color001/pipeflow`)           |
| `--local-binary / -LocalBinary`   | no | Use a local binary file instead of downloading from a release |
| `--no-healthcheck / -NoHealthcheck`| no | Skip the post-install live verification                    |
| `--healthcheck-timeout / -HealthcheckTimeout` | no | Seconds to wait for the agent to register live (default 30) |

---

## Troubleshooting

**`curl: (22) The requested URL returned error: 404`**

The release artifact for your OS/arch is missing. Check
<https://github.com/red-color001/pipeflow/releases/latest> — the artifact
list should include `pipeflow-agent-linux-x64`, `pipeflow-agent-linux-arm64`,
`pipeflow-agent-windows-x64.exe`, and `pipeflow-agent-macos-arm64`. If CI
is still building, wait and retry.

**`healthcheck FAILED within 30s`**

The service installed but the agent did not register live. Check:

- Linux: `journalctl -u pipeflow-agent@<id> -n 50`
- Windows: `Get-Content 'C:\Program Files\Pipeflow\logs\<id>.err.log' -Tail 50`

Common causes:

1. Backend unreachable from the host. Test with `curl <backend>/topology`.
2. Token mismatch (the backend rejected `401 unauthorized`).
3. Invalid `--kind` or `--color` (backend returns `400` with the allowed
   enum in the body).

**Re-install / upgrade**

Re-running the installer with the same `--id` stops the running service,
overwrites the binary + config, re-registers the service, and verifies
again. No manual uninstall needed for in-place upgrades.

**Build from source**

If your platform is not covered by the CI matrix:

```bash
pip install pyinstaller ./packages/sdk-py
pyinstaller agents/pyinstaller.spec --noconfirm
# Output: dist/pipeflow-agent[.exe]
sudo bash agents/install.sh --local-binary ./dist/pipeflow-agent <other flags>
```
