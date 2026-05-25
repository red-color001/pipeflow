#!/usr/bin/env bash
# Pipeflow agent installer (slim binary edition).
# Downloads pre-built binary from GitHub Releases, drops it on the host,
# registers a systemd service. No Python, no git clone, no venv needed.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/red-color001/pipeflow/main/agents/install.sh \
#     | sudo bash -s -- \
#         --backend https://pipeflow.example.com \
#         --token   PROD_TOKEN \
#         --id      myservice-prod \
#         --label   "My Service" \
#         --kind    svc \
#         --color   indigo
#
# Flags can be omitted; the script will prompt interactively for missing values.
# Re-running upgrades the binary + service unit in place.

set -euo pipefail

RELEASE_REPO_DEFAULT="red-color001/pipeflow"
RELEASE_TAG_DEFAULT="latest"
BIN_DIR_DEFAULT="/usr/local/bin"
CONFIG_DIR_DEFAULT="/etc/pipeflow"
SERVICE_NAME_DEFAULT="pipeflow-agent"
HEALTHCHECK_TIMEOUT_DEFAULT=30

release_repo="$RELEASE_REPO_DEFAULT"
release_tag="$RELEASE_TAG_DEFAULT"
bin_dir="$BIN_DIR_DEFAULT"
config_dir="$CONFIG_DIR_DEFAULT"
service_name="$SERVICE_NAME_DEFAULT"
healthcheck_timeout="$HEALTHCHECK_TIMEOUT_DEFAULT"
skip_healthcheck=""
local_binary=""

backend=""
token=""
agent_id=""
label=""
kind=""
color="indigo"
targets=""
flows=""

log()  { printf '\033[1;36m[pipeflow]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[pipeflow]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[pipeflow]\033[0m %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,18p' "$0"; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend)              backend="$2"; shift 2 ;;
    --token)                token="$2"; shift 2 ;;
    --id)                   agent_id="$2"; shift 2 ;;
    --label)                label="$2"; shift 2 ;;
    --kind)                 kind="$2"; shift 2 ;;
    --color)                color="$2"; shift 2 ;;
    --targets)              targets="$2"; shift 2 ;;
    --flows)                flows="$2"; shift 2 ;;
    --release-repo)         release_repo="$2"; shift 2 ;;
    --release-tag)          release_tag="$2"; shift 2 ;;
    --bin-dir)              bin_dir="$2"; shift 2 ;;
    --config-dir)           config_dir="$2"; shift 2 ;;
    --service)              service_name="$2"; shift 2 ;;
    --local-binary)         local_binary="$2"; shift 2 ;;
    --healthcheck-timeout)  healthcheck_timeout="$2"; shift 2 ;;
    --no-healthcheck)       skip_healthcheck=1; shift ;;
    -h|--help)              usage ;;
    *)                      die "unknown flag: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "must run as root (sudo bash install.sh ...)"

command -v systemctl >/dev/null 2>&1 || die "systemd required (no systemctl found)"

# ─── Detect OS + arch ────────────────────────────────────────────────────────
os_kernel="$(uname -s)"
arch_raw="$(uname -m)"

case "$os_kernel" in
  Linux)  os_slug="linux"  ;;
  Darwin) os_slug="macos"  ;;
  *)      die "unsupported OS: $os_kernel" ;;
esac

case "$arch_raw" in
  x86_64|amd64) arch_slug="x64"   ;;
  aarch64|arm64) arch_slug="arm64" ;;
  *) die "unsupported arch: $arch_raw" ;;
esac

artifact="pipeflow-agent-${os_slug}-${arch_slug}"
log "detected: ${os_slug}-${arch_slug} (artifact: $artifact)"

# ─── Prompt for missing values ───────────────────────────────────────────────
prompt() {
  local var="$1" msg="$2" default="${3:-}"
  local current="${!var}"
  [[ -n "$current" ]] && return
  if [[ -t 0 ]]; then
    if [[ -n "$default" ]]; then
      read -r -p "$msg [$default]: " val
      val="${val:-$default}"
    else
      read -r -p "$msg: " val
    fi
    printf -v "$var" '%s' "$val"
  else
    die "missing --${var//_/-} and no TTY for prompt"
  fi
}

prompt backend  "Backend URL"                                                                  "https://pipeflow.example.com"
prompt token    "Agent token"
prompt agent_id "Agent ID (unique slug)"
prompt label    "Agent display label"                                                          "$agent_id"
prompt kind     "Agent kind (user|ext|fe|be|svc|wk|kf|db|obs)"                                 "svc"
prompt color    "Agent color (indigo|teal|amber|red|violet|orange|green|cyan|pink|purple|yorange|neutral)" "indigo"

[[ -n "$backend"  ]] || die "backend required"
[[ -n "$token"    ]] || die "token required"
[[ -n "$agent_id" ]] || die "agent id required"
[[ -n "$label"    ]] || die "label required"
[[ -n "$kind"     ]] || die "kind required"

# ─── Download / install binary ───────────────────────────────────────────────
bin_path="${bin_dir}/pipeflow-agent"

if [[ -n "$local_binary" ]]; then
  log "installing local binary: $local_binary"
  [[ -f "$local_binary" ]] || die "local binary not found: $local_binary"
  install -m 0755 "$local_binary" "$bin_path"
else
  if [[ "$release_tag" == "latest" ]]; then
    url="https://github.com/${release_repo}/releases/latest/download/${artifact}"
  else
    url="https://github.com/${release_repo}/releases/download/${release_tag}/${artifact}"
  fi
  log "downloading $url"
  tmp="$(mktemp)"
  if ! curl -fsSL --retry 3 -o "$tmp" "$url"; then
    rm -f "$tmp"
    die "download failed — check release_repo='$release_repo' and tag='$release_tag'"
  fi
  install -m 0755 "$tmp" "$bin_path"
  rm -f "$tmp"
fi
log "installed binary: $bin_path"

# ─── Write env / config file ─────────────────────────────────────────────────
mkdir -p "$config_dir"
config_file="${config_dir}/${agent_id}.env"
umask 077
{
  echo "PIPEFLOW_BACKEND=$backend"
  echo "PIPEFLOW_TOKEN=$token"
  echo "AGENT_ID=$agent_id"
  echo "AGENT_LABEL=$label"
  echo "AGENT_KIND=$kind"
  echo "AGENT_COLOR=$color"
  [[ -n "$targets" ]] && echo "AGENT_TARGETS=$targets"
  [[ -n "$flows"   ]] && echo "AGENT_FLOWS=$flows"
} > "$config_file"
chmod 600 "$config_file"
log "wrote config: $config_file (0600)"

# ─── systemd unit (template) ─────────────────────────────────────────────────
unit="/etc/systemd/system/${service_name}@.service"
if [[ ! -f "$unit" ]] || ! grep -q "$bin_path" "$unit"; then
  log "writing service unit $unit"
  cat > "$unit" <<EOF
[Unit]
Description=Pipeflow agent (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$bin_path --config ${config_dir}/%i.env
Restart=always
RestartSec=5
DynamicUser=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
fi

instance="${service_name}@${agent_id}"
log "enabling + starting $instance"
systemctl enable --now "$instance"

# ─── Healthcheck ─────────────────────────────────────────────────────────────
healthcheck() {
  [[ -n "$skip_healthcheck" ]] && { log "healthcheck skipped"; return; }
  command -v curl >/dev/null 2>&1 || { warn "curl not found, skipping healthcheck"; return; }

  local url="${backend%/}/topology"
  log "waiting up to ${healthcheck_timeout}s for '$agent_id' to register live at $url"

  # Match the agent's node object and require stub=false + status=live
  # (deregister leaves a stub row that would otherwise yield a false positive).
  local pattern="\"id\":\"${agent_id}\"[^}]*\"status\":\"live\"[^}]*\"stub\":false"
  local deadline=$(( $(date +%s) + healthcheck_timeout ))
  while [[ $(date +%s) -lt $deadline ]]; do
    if curl -fsS --max-time 5 "$url" 2>/dev/null | grep -Eq "$pattern"; then
      log "healthcheck OK — agent '$agent_id' is live"
      return
    fi
    sleep 2
  done
  warn "healthcheck FAILED within ${healthcheck_timeout}s — check: journalctl -u $instance -n 50"
  exit 2
}

healthcheck

log "agent '$agent_id' installed via systemd, pointing at $backend"
