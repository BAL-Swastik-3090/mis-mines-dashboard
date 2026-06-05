"""
Port availability checker for Mines Dashboard.
Checks all required ports before starting the application.

Usage:
    python scripts/check_ports.py             # check all ports
    python scripts/check_ports.py --fix       # show how to free occupied ports
"""

import socket
import sys
import argparse
import subprocess
import platform
from dataclasses import dataclass

# ── Port configuration ────────────────────────────────────────
@dataclass
class PortConfig:
    port: int
    service: str
    description: str
    required: bool = True


PORTS_TO_CHECK: list[PortConfig] = [
    PortConfig(3333, "Frontend",  "Next.js Dashboard UI",     required=True),
    PortConfig(8989, "Backend",   "FastAPI REST API",          required=True),
    PortConfig(80,   "Nginx",     "Reverse Proxy (Docker)",    required=False),
    PortConfig(6379, "Redis",     "Cache (Docker internal)",   required=False),
]

# ── ANSI Colors ───────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
BOLD   = "\033[1m"
RESET  = "\033[0m"
CYAN   = "\033[96m"


def is_port_free(port: int, host: str = "127.0.0.1") -> bool:
    """Returns True if port is available, False if occupied."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        try:
            s.connect((host, port))
            return False   # connection succeeded → port is IN USE
        except (ConnectionRefusedError, socket.timeout, OSError):
            return True    # connection refused → port is FREE


def get_process_on_port(port: int) -> str:
    """Get process name/PID occupying the port (best-effort)."""
    os_name = platform.system()
    try:
        if os_name == "Windows":
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    pid = parts[-1]
                    # Get process name
                    proc = subprocess.run(
                        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                        capture_output=True, text=True, timeout=5
                    )
                    if proc.stdout.strip():
                        name = proc.stdout.strip().split(",")[0].strip('"')
                        return f"PID {pid} ({name})"
                    return f"PID {pid}"
        else:
            # Linux / macOS
            result = subprocess.run(
                ["lsof", "-i", f":{port}", "-sTCP:LISTEN", "-n", "-P"],
                capture_output=True, text=True, timeout=5
            )
            lines = result.stdout.strip().splitlines()
            if len(lines) > 1:
                parts = lines[1].split()
                return f"{parts[0]} (PID {parts[1]})"
    except Exception:
        pass
    return "unknown process"


def kill_hint(port: int) -> str:
    """Return OS-specific command to free the port."""
    os_name = platform.system()
    if os_name == "Windows":
        return (
            f"  Find PID : netstat -ano | findstr :{port}\n"
            f"  Kill PID : taskkill /PID <PID> /F"
        )
    else:
        return (
            f"  Find PID : lsof -i :{port}\n"
            f"  Kill PID : kill -9 $(lsof -t -i:{port})"
        )


def print_banner():
    print(f"\n{BOLD}{BLUE}{'-'*58}{RESET}")
    print(f"{BOLD}{BLUE}  Kaliapani Mines Dashboard - Port Availability Check{RESET}")
    print(f"{BOLD}{BLUE}{'-'*58}{RESET}\n")


def run_check(show_fix: bool = False) -> bool:
    print_banner()

    all_required_free = True
    results = []

    for cfg in PORTS_TO_CHECK:
        free = is_port_free(cfg.port)
        results.append((cfg, free))

        tag   = f"{GREEN}[FREE]    {RESET}" if free else f"{RED}[OCCUPIED]{RESET}"
        req   = f"{BOLD}[REQUIRED]{RESET}" if cfg.required else f"{YELLOW}[OPTIONAL]{RESET}"
        print(f"  Port {BOLD}{cfg.port:5d}{RESET}  {tag}  {req}  {cfg.service:<12}  {CYAN}{cfg.description}{RESET}")

        if not free:
            proc = get_process_on_port(cfg.port)
            print(f"             {YELLOW}>> Occupied by: {proc}{RESET}")

            if show_fix:
                print(f"{YELLOW}{kill_hint(cfg.port)}{RESET}")

            if cfg.required:
                all_required_free = False

    print()

    if all_required_free:
        print(f"{GREEN}{BOLD}  [OK] All required ports are free. Safe to start!{RESET}")
        print(f"{CYAN}     Frontend --> http://localhost:3333{RESET}")
        print(f"{CYAN}     Backend  --> http://localhost:8989{RESET}")
        print(f"{CYAN}     API Docs --> http://localhost:8989/api/docs{RESET}")
    else:
        print(f"{RED}{BOLD}  [FAIL] One or more REQUIRED ports are occupied.{RESET}")
        print(f"{YELLOW}     Free the ports above, then retry.{RESET}")
        if not show_fix:
            print(f"{YELLOW}     Run with --fix flag to see how:{RESET}")
            print(f"{YELLOW}     python scripts/check_ports.py --fix{RESET}")

    print(f"\n{BOLD}{BLUE}{'-'*58}{RESET}\n")
    return all_required_free


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Check port availability for Mines Dashboard")
    parser.add_argument("--fix", action="store_true", help="Show commands to free occupied ports")
    args = parser.parse_args()

    ok = run_check(show_fix=args.fix)
    sys.exit(0 if ok else 1)
