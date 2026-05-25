#!/usr/bin/env bash
# Pipeflow agent uninstaller.
# Removes container or systemd service for a given agent id, plus its env file.
# Optional: --deregister calls backend to mark agent dead.
#           --purge       also removes /opt/pipeflow source tree (shared across agents — be careful).
#
# Usage:
#   sudo bash agents/uninstall.sh --id myservice-prod
#   sudo bash agents/uninstall.sh --id myservice-prod --deregister --backend https://... --token ...
#   sudo bash agents/uninstall.sh --id myservice-prod --purge

set -euo pipefail

INSTALL_DIR_DEFAULT="/opt/pipeflow"
SERVICE_NAME_DEFAULT="pipeflow-agent"

agent_id=""
method=""
backend=""
token=""
install_dir="$INSTALL_DIR_DEFAULT"
service_name="$SERVICE_NAME_DEFAULT"
do_deregister=""
do_purge=""

log()  { printf '\033[1;36m[pipeflow]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[pipeflow]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[pipeflow]\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id)          agent_id="$2"; shift 2 ;;
    --method)      method="$2"; shift 2 ;;
    --backend)     backend="$2"; shift 2 ;;
    --token)       token="$2"; shift 2 ;;
    --install-dir) install_dir="$2"; shift 2 ;;
    --service)     service_name="$2"; shift 2 ;;
    --deregister)  do_deregister=1; shift ;;
    --purge)       do_purge=1; shift ;;
    -h|--help)     sed -n '2,12p' "$0"; exit 0 ;;
    *)             die "unknown flag: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "must run as root"
[[ -n "$agent_id" ]] || die "--id required"

env_file="/etc/pipeflow/${agent_id}.env"
container="pipeflow-${agent_id}"
instance="${service_name}@${agent_id}"
unit="/etc/systemd/system/${service_name}@.service"

# Auto-detect method if not specified.
if [[ -z "$method" ]]; then
  if command -v docker >/dev/null 2>&1 \
     && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
    method="docker"
  elif command -v systemctl >/dev/null 2>&1 \
       && systemctl list-unit-files 2>/dev/null | grep -q "^${service_name}@"; then
    method="systemd"
  else
    die "could not detect existing install for '$agent_id' — pass --method explicitly"
  fi
  log "detected method: $method"
fi

# Optional: deregister via backend before tearing down.
if [[ -n "$do_deregister" ]]; then
  if [[ -z "$backend" || -z "$token" ]]; then
    if [[ -f "$env_file" ]]; then
      log "loading backend/token from $env_file"
      # shellcheck disable=SC1090
      set -a; source "$env_file"; set +a
      backend="${backend:-$PIPEFLOW_BACKEND}"
      token="${token:-$PIPEFLOW_TOKEN}"
    fi
  fi
  if [[ -n "$backend" && -n "$token" ]]; then
    log "deregistering '$agent_id' at backend"
    curl -fsS -X POST \
      -H "Authorization: Bearer $token" \
      "${backend%/}/api/agents/${agent_id}/deregister" \
      || warn "deregister request failed (backend unreachable?)"
  else
    warn "skipping deregister: backend/token not provided and not in env file"
  fi
fi

case "$method" in
  docker)
    if docker ps -a --format '{{.Names}}' | grep -qx "$container"; then
      log "stopping + removing container $container"
      docker rm -f "$container" >/dev/null
    else
      warn "no container named $container"
    fi
    ;;
  systemd)
    if systemctl list-units --all --type=service 2>/dev/null | grep -q "^\s*${instance}.service"; then
      log "stopping + disabling $instance"
      systemctl disable --now "$instance" || true
    else
      warn "no active service $instance"
    fi
    # If this was the last instance, remove the template unit too.
    remaining=$(systemctl list-unit-files 2>/dev/null \
                | grep "^${service_name}@" \
                | grep -v "^${service_name}@\.service" \
                | wc -l || echo 0)
    active_instances=$(ls /etc/pipeflow 2>/dev/null | grep '\.env$' | grep -v "^${agent_id}\.env$" | wc -l || echo 0)
    if [[ "$active_instances" -eq 0 ]] && [[ -f "$unit" ]]; then
      log "removing template unit $unit (no other agents installed)"
      rm -f "$unit"
      systemctl daemon-reload
    fi
    ;;
  *) die "unknown method: $method" ;;
esac

if [[ -f "$env_file" ]]; then
  log "removing env file $env_file"
  rm -f "$env_file"
fi

if [[ -n "$do_purge" ]]; then
  if [[ -d "$install_dir" ]]; then
    log "purging $install_dir (this affects ALL agents on this host)"
    rm -rf "$install_dir"
  fi
fi

log "agent '$agent_id' uninstalled"
