#!/usr/bin/env bash
# Pipeflow agent installer.
# Auto-detects host capability (docker > systemd) and installs the agent.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<you>/pipline-data-flow/main/agents/install.sh \
#     | sudo bash -s -- \
#         --backend https://pipeflow.example.com \
#         --token   PROD_TOKEN \
#         --id      myservice-prod \
#         --label   "My Service" \
#         --kind    svc \
#         --color   blue
#
# Flags can be omitted; the script will prompt interactively for missing values.
# Override the chosen method with:  --method docker|systemd
#
# Re-running the script upgrades the existing install in place.

set -euo pipefail

REPO_URL_DEFAULT="https://github.com/andif/pipline-data-flow.git"
REPO_REF_DEFAULT="main"
INSTALL_DIR_DEFAULT="/opt/pipeflow"
IMAGE_TAG_DEFAULT="pipeflow-agent:local"
SERVICE_NAME_DEFAULT="pipeflow-agent"
HEALTHCHECK_TIMEOUT_DEFAULT=30

method=""
backend=""
token=""
agent_id=""
label=""
kind=""
color="neutral"
targets=""
flows=""
repo_url="$REPO_URL_DEFAULT"
repo_ref="$REPO_REF_DEFAULT"
install_dir="$INSTALL_DIR_DEFAULT"
image_tag="$IMAGE_TAG_DEFAULT"
image_pull=""
service_name="$SERVICE_NAME_DEFAULT"
healthcheck_timeout="$HEALTHCHECK_TIMEOUT_DEFAULT"
skip_healthcheck=""

log()  { printf '\033[1;36m[pipeflow]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[pipeflow]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[pipeflow]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --method)       method="$2"; shift 2 ;;
    --backend)      backend="$2"; shift 2 ;;
    --token)        token="$2"; shift 2 ;;
    --id)           agent_id="$2"; shift 2 ;;
    --label)        label="$2"; shift 2 ;;
    --kind)         kind="$2"; shift 2 ;;
    --color)        color="$2"; shift 2 ;;
    --targets)      targets="$2"; shift 2 ;;
    --flows)        flows="$2"; shift 2 ;;
    --repo)         repo_url="$2"; shift 2 ;;
    --ref)          repo_ref="$2"; shift 2 ;;
    --install-dir)  install_dir="$2"; shift 2 ;;
    --image-tag)    image_tag="$2"; shift 2 ;;
    --image)        image_pull="$2"; shift 2 ;;
    --service)      service_name="$2"; shift 2 ;;
    --healthcheck-timeout) healthcheck_timeout="$2"; shift 2 ;;
    --no-healthcheck)      skip_healthcheck=1; shift ;;
    -h|--help)      usage ;;
    *)              die "unknown flag: $1" ;;
  esac
done

# ─── Root check ──────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  die "must run as root (sudo bash install.sh ...)"
fi

# ─── OS sanity ───────────────────────────────────────────────────────────────
os_kernel="$(uname -s 2>/dev/null || echo unknown)"
case "$os_kernel" in
  Linux)  ;;
  Darwin) warn "macOS detected — only docker method supported here" ;;
  *)      die "unsupported OS: $os_kernel (Linux or macOS only)" ;;
esac

# ─── Method detection ────────────────────────────────────────────────────────
has_docker()  { command -v docker  >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
has_systemd() { command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; }
has_python()  { command -v python3 >/dev/null 2>&1; }
has_git()     { command -v git >/dev/null 2>&1; }

if [[ -z "$method" ]]; then
  if   has_docker;  then method="docker"
  elif has_systemd; then method="systemd"
  else die "neither docker nor systemd available — install one first"
  fi
  log "auto-selected method: $method"
fi

case "$method" in
  docker)
    has_docker  || die "method=docker but docker not usable (daemon running? user in docker group?)"
    if [[ -z "$image_pull" ]]; then
      has_git || die "git required to build image from source (or pass --image <ref> to skip build)"
    fi
    ;;
  systemd)
    has_systemd || die "method=systemd but systemd not present"
    has_python  || die "python3 required"
    has_git     || die "git required to fetch the repo"
    ;;
  *) die "unknown method: $method (use docker or systemd)" ;;
esac

need_source=1
if [[ "$method" == "docker" && -n "$image_pull" ]]; then
  need_source=0
fi

# ─── Prompt for missing required values ──────────────────────────────────────
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

prompt backend  "Backend URL"                "https://pipeflow.example.com"
prompt token    "Agent token"
prompt agent_id "Agent ID (unique slug)"
prompt label    "Agent display label"        "$agent_id"
prompt kind     "Agent kind (user|ext|fe|be|svc|wk|kf|db|obs)" "svc"
prompt color    "Agent color (indigo|teal|amber|red|violet|orange|green|cyan|pink|purple|yorange|neutral)" "indigo"

[[ -n "$backend"  ]] || die "backend required"
[[ -n "$token"    ]] || die "token required"
[[ -n "$agent_id" ]] || die "agent id required"
[[ -n "$label"    ]] || die "label required"
[[ -n "$kind"     ]] || die "kind required"

# ─── Fetch / refresh source ──────────────────────────────────────────────────
if [[ "$need_source" -eq 1 ]]; then
  if [[ -d "$install_dir/.git" ]]; then
    log "updating existing checkout at $install_dir"
    git -C "$install_dir" fetch --depth 1 origin "$repo_ref"
    git -C "$install_dir" reset --hard "origin/$repo_ref"
  else
    log "cloning $repo_url ($repo_ref) into $install_dir"
    mkdir -p "$(dirname "$install_dir")"
    git clone --depth 1 --branch "$repo_ref" "$repo_url" "$install_dir"
  fi
else
  log "skipping source fetch (using pulled image $image_pull)"
fi

# ─── Write env file (shared by both methods) ─────────────────────────────────
env_file="/etc/pipeflow/${agent_id}.env"
mkdir -p /etc/pipeflow
umask 077
cat > "$env_file" <<EOF
PIPEFLOW_BACKEND=$backend
PIPEFLOW_TOKEN=$token
AGENT_ID=$agent_id
AGENT_LABEL=$label
AGENT_KIND=$kind
AGENT_COLOR=$color
EOF
[[ -n "$targets" ]] && printf 'AGENT_TARGETS=%s\n' "$targets" >> "$env_file"
[[ -n "$flows"   ]] && printf 'AGENT_FLOWS=%s\n'   "$flows"   >> "$env_file"
chmod 600 "$env_file"
log "wrote env file: $env_file (0600)"

# ─── Install: docker ─────────────────────────────────────────────────────────
install_docker() {
  local container="pipeflow-${agent_id}"
  local image_ref

  if [[ -n "$image_pull" ]]; then
    log "pulling image $image_pull"
    docker pull "$image_pull"
    image_ref="$image_pull"
  else
    log "building image $image_tag from $install_dir"
    docker build -t "$image_tag" -f "$install_dir/agents/Dockerfile" "$install_dir"
    image_ref="$image_tag"
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx "$container"; then
    log "removing previous container $container"
    docker rm -f "$container" >/dev/null
  fi

  log "starting container $container"
  docker run -d \
    --name "$container" \
    --restart unless-stopped \
    --env-file "$env_file" \
    "$image_ref" >/dev/null

  log "done. tail logs:  docker logs -f $container"
}

# ─── Install: systemd ────────────────────────────────────────────────────────
install_systemd() {
  local venv="$install_dir/.venv"
  local unit="/etc/systemd/system/${service_name}@.service"
  local instance="${service_name}@${agent_id}"

  log "creating venv at $venv"
  python3 -m venv "$venv"
  "$venv/bin/pip" install --quiet --upgrade pip
  "$venv/bin/pip" install --quiet "$install_dir/packages/sdk-py"

  log "writing service unit $unit"
  cat > "$unit" <<EOF
[Unit]
Description=Pipeflow agent (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/pipeflow/%i.env
ExecStart=$venv/bin/python -u $install_dir/agents/runner.py
Restart=always
RestartSec=5
WorkingDirectory=$install_dir

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "$instance"
  log "done. tail logs:  journalctl -u $instance -f"
}

case "$method" in
  docker)  install_docker  ;;
  systemd) install_systemd ;;
esac

# ─── Post-install health check ───────────────────────────────────────────────
healthcheck() {
  [[ -n "$skip_healthcheck" ]] && { log "healthcheck skipped"; return; }
  command -v curl >/dev/null 2>&1 || { warn "curl not found, skipping healthcheck"; return; }

  local url="${backend%/}/topology"
  log "waiting up to ${healthcheck_timeout}s for '$agent_id' to appear at $url"

  local deadline=$(( $(date +%s) + healthcheck_timeout ))
  while [[ $(date +%s) -lt $deadline ]]; do
    if curl -fsS --max-time 5 "$url" 2>/dev/null \
        | grep -q "\"id\":\"${agent_id}\""; then
      log "healthcheck OK — agent '$agent_id' registered at backend"
      return
    fi
    sleep 2
  done

  warn "healthcheck FAILED — agent did not appear within ${healthcheck_timeout}s"
  warn "check logs:"
  case "$method" in
    docker)  warn "  docker logs pipeflow-${agent_id}" ;;
    systemd) warn "  journalctl -u ${service_name}@${agent_id} -n 50" ;;
  esac
  exit 2
}

healthcheck

log "agent '$agent_id' installed via $method, pointing at $backend"
