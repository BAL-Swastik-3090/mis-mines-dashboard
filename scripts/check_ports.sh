#!/usr/bin/env bash
# ============================================================
#  Mines Dashboard — Port Availability Checker (Bash/Linux)
#  Usage: bash scripts/check_ports.sh
#         bash scripts/check_ports.sh --fix
# ============================================================

set -euo pipefail

GREEN='\033[92m'; RED='\033[91m'; YELLOW='\033[93m'
BLUE='\033[94m';  CYAN='\033[96m'; BOLD='\033[1m'; RESET='\033[0m'

FIX=false
[[ "${1:-}" == "--fix" ]] && FIX=true

# ── Port definitions (name:port:required:description) ────────
declare -a PORTS=(
  "Frontend:3333:true:Next.js Dashboard UI"
  "Backend:8989:true:FastAPI REST API"
  "Nginx:80:false:Reverse Proxy (Docker)"
  "Redis:6379:false:Cache (Docker internal)"
)

is_port_free() {
  ! (echo >/dev/tcp/127.0.0.1/"$1") 2>/dev/null
}

get_process() {
  local port=$1
  if command -v lsof &>/dev/null; then
    lsof -i :"$port" -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR==2{print $1" (PID "$2")"}' || echo "unknown"
  elif command -v ss &>/dev/null; then
    ss -tlnp | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1 | xargs -I{} ps -p {} -o comm= || echo "unknown"
  else
    echo "unknown"
  fi
}

echo ""
echo -e "${BOLD}${BLUE}──────────────────────────────────────────────────────────${RESET}"
echo -e "${BOLD}${BLUE}  Kaliapani Mines Dashboard — Port Availability Check${RESET}"
echo -e "${BOLD}${BLUE}──────────────────────────────────────────────────────────${RESET}"
echo ""

ALL_OK=true

for entry in "${PORTS[@]}"; do
  IFS=':' read -r service port required desc <<< "$entry"

  if is_port_free "$port"; then
    status="${GREEN}✅ FREE    ${RESET}"
  else
    status="${RED}❌ OCCUPIED${RESET}"
  fi

  req_label="[OPTIONAL]"
  [[ "$required" == "true" ]] && req_label="${BOLD}[REQUIRED]${RESET}"

  printf "  Port %5s  " "$port"
  echo -en "$status  $req_label  "
  printf "%-14s  %s\n" "$service" "$desc"

  if ! is_port_free "$port"; then
    proc=$(get_process "$port")
    echo -e "             ${YELLOW}↳ Occupied by: $proc${RESET}"

    if $FIX; then
      echo -e "             ${YELLOW}To free this port:${RESET}"
      echo -e "             ${YELLOW}  Find PID : lsof -i :$port${RESET}"
      echo -e "             ${YELLOW}  Kill PID : kill -9 \$(lsof -t -i:$port)${RESET}"
    fi

    [[ "$required" == "true" ]] && ALL_OK=false
  fi
done

echo ""

if $ALL_OK; then
  echo -e "${GREEN}${BOLD}  ✅ All required ports are free. Safe to start!${RESET}"
  echo -e "${CYAN}     Frontend → http://localhost:3333${RESET}"
  echo -e "${CYAN}     Backend  → http://localhost:8989/api/docs${RESET}"
else
  echo -e "${RED}${BOLD}  ❌ One or more REQUIRED ports are occupied.${RESET}"
  echo -e "${YELLOW}     Free the ports above, then retry.${RESET}"
  if ! $FIX; then
    echo -e "${YELLOW}     Run: bash scripts/check_ports.sh --fix${RESET}"
  fi
fi

echo ""
echo -e "${BOLD}${BLUE}──────────────────────────────────────────────────────────${RESET}"
echo ""

$ALL_OK
