#!/usr/bin/env bash
# Pipeflow agent uninstaller (binary edition).
# Stops the systemd instance, removes its config file. Optionally:
#   --deregister  POST /agents/:id/deregister at the backend
#   --purge       remove the shared binary + template unit too (affects all
#                 agents installed via the same template — be careful)
#
# Usage:
#   sudo bash agents/uninstall.sh --id myservice-prod
#   sudo bash agents/uninstall.sh --id myservice-prod --deregister
#   sudo bash agents/uninstall.sh --id myservice-prod --purge

set -euo pipefail

BIN_DIR_DEFAULT="/usr/local/bin"
CONFIG_DIR_DEFAULT="/etc/pipeflow"
SERVICE_NAME_DEFAULT="pipeflow-agent"

agent_id=""
backend=""
token=""
bin_dir="$BIN_DIR_DEFAULT"
config_dir="$CONFIG_DIR_DEFAULT"
service_name="$SERVICE_NAME_DEFAULT"
do_deregister=""
do_purge=""

log()  { printf '\033[1;36m[pipeflow]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[pipeflow]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[pipeflow]\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id)          agent_id="$2"; shift 2 ;;
    --backend)     backend="$2"; shift 2 ;;
    --token)       token="$2"; shift 2 ;;
    --bin-dir)     bin_dir="$2"; shift 2 ;;
    --config-dir)  config_dir="$2"; shift 2 ;;
    --service)     service_name="$2"; shift 2 ;;
    --deregister)  do_deregister=1; shift ;;
    --purge)       do_purge=1; shift ;;
    -h|--help)     sed -n '2,14p' "$0"; exit 0 ;;
    *)             die "unknown flag: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "must run as root"
[[ -n "$agent_id" ]] || die "--id required"

config_file="${config_dir}/${agent_id}.env"
instance="${service_name}@${agent_id}"
unit="/etc/systemd/system/${service_name}@.service"
bin_path="${bin_dir}/pipeflow-agent"

# Optional deregister at backend before tear-down.
if [[ -n "$do_deregister" ]]; then
  if [[ -z "$backend" || -z "$token" ]]; then
    if [[ -f "$config_file" ]]; then
      log "loading backend/token from $config_file"
      set -a; source "$config_file"; set +a
      backend="${backend:-$PIPEFLOW_BACKEND}"
      token="${token:-$PIPEFLOW_TOKEN}"
    fi
  fi
  if [[ -n "$backend" && -n "$token" ]]; then
    log "deregistering '$agent_id' at backend"
    curl -fsS -X POST -H "Authorization: Bearer $token" \
      "${backend%/}/agents/${agent_id}/deregister" \
      || warn "deregister request failed"
  else
    warn "skipping deregister: backend/token unavailable"
  fi
fi

if systemctl list-unit-files | grep -q "^${service_name}@"; then
  log "stopping + disabling $instance"
  systemctl disable --now "$instance" 2>/dev/null || true
fi

if [[ -f "$config_file" ]]; then
  log "removing config $config_file"
  rm -f "$config_file"
fi

if [[ -n "$do_purge" ]]; then
  remaining=$(ls "$config_dir" 2>/dev/null | grep '\.env$' | wc -l || echo 0)
  if [[ "$remaining" -eq 0 ]]; then
    [[ -f "$unit" ]] && { log "removing template unit $unit"; rm -f "$unit"; systemctl daemon-reload; }
    [[ -f "$bin_path" ]] && { log "removing binary $bin_path"; rm -f "$bin_path"; }
    [[ -d "$config_dir" ]] && rmdir "$config_dir" 2>/dev/null || true
  else
    warn "purge requested but $remaining other agent(s) still configured — keeping binary + unit"
  fi
fi

log "agent '$agent_id' uninstalled"
