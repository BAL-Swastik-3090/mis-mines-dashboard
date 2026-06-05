#!/usr/bin/env bash
# ============================================================
#  Mines Dashboard — Linux Startup Script (Bash)
#  Checks ports, then starts via Docker Compose or natively
#  Usage: bash start.sh              (native dev)
#         bash start.sh --docker     (docker compose)
#         bash start.sh --check-only (only check ports)
# ============================================================

set -euo pipefail

FRONTEND_PORT=3333
BACKEND_PORT=8989
DOCKER=false
CHECK_ONLY=false
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for arg in "$@"; do
  case $arg in
    --docker)     DOCKER=true      ;;
    --check-only) CHECK_ONLY=true  ;;
  esac
done

GREEN='\033[92m'; RED='\033[91m'; YELLOW='\033[93m'
BLUE='\033[94m';  CYAN='\033[96m'; BOLD='\033[1m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}${BLUE}============================================================${RESET}"
echo -e "${BOLD}${BLUE}  Kaliapani Mines Dashboard — Startup${RESET}"
echo -e "${BOLD}${BLUE}  Balasore Alloys Limited · BAL-1100${RESET}"
echo -e "${BOLD}${BLUE}============================================================${RESET}"
echo ""

# ── Step 1: Port Check ────────────────────────────────────────
echo -e "${CYAN}[ STEP 1 ]  Checking port availability...${RESET}"
echo ""

if ! bash "$ROOT_DIR/scripts/check_ports.sh"; then
  echo ""
  echo -e "${RED}  ⛔ Startup aborted — free the occupied ports first.${RESET}"
  echo -e "${YELLOW}     Run: bash scripts/check_ports.sh --fix${RESET}"
  echo ""
  exit 1
fi

if $CHECK_ONLY; then
  echo -e "${YELLOW}  ℹ️  Check-only mode — not starting services.${RESET}"
  exit 0
fi

# ── Step 2: Start services ────────────────────────────────────
echo -e "${CYAN}[ STEP 2 ]  Starting services...${RESET}"
echo ""

if $DOCKER; then
  echo -e "  🐳 ${GREEN}Starting via Docker Compose...${RESET}"
  docker compose -f "$ROOT_DIR/docker-compose.yml" up --build -d
  echo ""
  echo -e "  ${GREEN}${BOLD}✅ All containers started!${RESET}"
  echo -e "  ${CYAN}     Dashboard → http://localhost${RESET}"
  echo -e "  ${CYAN}     API Docs  → http://localhost/api/docs${RESET}"
  echo ""
  echo -e "  ${YELLOW}  View logs: docker compose logs -f${RESET}"
else
  echo -e "  🚀 ${GREEN}Starting Backend  (FastAPI · port $BACKEND_PORT)...${RESET}"
  cd "$ROOT_DIR/backend"
  uvicorn app.main:app --reload --port "$BACKEND_PORT" &
  BACKEND_PID=$!

  sleep 2

  echo -e "  🚀 ${GREEN}Starting Frontend (Next.js · port $FRONTEND_PORT)...${RESET}"
  cd "$ROOT_DIR/frontend"
  npm run dev &
  FRONTEND_PID=$!

  echo ""
  echo -e "  ${GREEN}${BOLD}✅ Services started!${RESET}"
  echo -e "  ${CYAN}     Frontend  → http://localhost:$FRONTEND_PORT${RESET}"
  echo -e "  ${CYAN}     Backend   → http://localhost:$BACKEND_PORT${RESET}"
  echo -e "  ${CYAN}     API Docs  → http://localhost:$BACKEND_PORT/api/docs${RESET}"
  echo ""
  echo -e "  ${YELLOW}  Press Ctrl+C to stop all services.${RESET}"

  # Wait and trap Ctrl+C to kill both
  trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Services stopped.'" INT TERM
  wait
fi

echo ""
