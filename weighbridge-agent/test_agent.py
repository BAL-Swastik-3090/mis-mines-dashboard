"""End-to-end: a simulated indicator, the real agent, a stub server.

Proves the loop works before it goes anywhere near a real bridge — including
the two things that are hard to check on site: that a truck rolling on produces
exactly one settled weight, and that readings taken while the network is down
are not lost.

    python test_agent.py
"""
from __future__ import annotations

import configparser
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wbagent
from wbagent import Agent

TMP = Path(__file__).resolve().parent / ".test"
TMP.mkdir(exist_ok=True)
DATA = TMP / "wbdata.txt"

received: list[dict] = []
refuse = threading.Event()


class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        if refuse.is_set():
            self.send_response(503); self.end_headers(); return
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        if self.headers.get("X-Agent-Token") != "test-token":
            self.send_response(401); self.end_headers(); return
        received.extend(body.get("readings", []))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"accepted":%d}' % len(body.get("readings", [])))

    def log_message(self, *a):  # keep the test output readable
        pass


def indicator(script: list[tuple[float, float]]) -> None:
    """Rewrite the file the way a digitizer does: in place, continuously."""
    for weight, hold in script:
        end = time.time() + hold
        while time.time() < end:
            stable = "ST" if weight in STABLE_AT else "US"
            DATA.write_text(f"{stable},GS,+{int(weight):>8}kg\r\n", encoding="ascii")
            time.sleep(0.05)


STABLE_AT = {0.0, 16200.0, 44800.0}


def main() -> int:
    srv = HTTPServer(("127.0.0.1", 0), Stub)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    wbagent.SPOOL = TMP / "spool.jsonl"
    if wbagent.SPOOL.exists():
        wbagent.SPOOL.unlink()

    cfg = configparser.ConfigParser()
    cfg.read_dict({
        "agent": {"server": f"http://127.0.0.1:{port}", "token": "test-token",
                  "bridge": "WB3", "path": str(DATA), "parser": "auto",
                  "poll_ms": "100"},
        "stability": {"samples": "3", "tolerance_kg": "20"},
    })

    DATA.write_text("ST,GS,+       0kg\r\n", encoding="ascii")
    agent = Agent(cfg)
    agent.start()

    failures = 0

    # ── a truck arrives loaded, tips, and leaves ────────────────────────────
    print("  simulating: empty deck -> loaded truck -> tipped -> empty")
    indicator([(0, 0.6),          # empty deck, settled
               (8400, 0.3),       # rolling on — unstable
               (44800, 1.2),      # gross, settled
               (21000, 0.3),      # rolling off
               (0, 0.5),
               (16200, 1.2),      # tare, settled
               (0, 0.8)])
    time.sleep(1.5)

    settled = [r["weight_kg"] for r in received if r.get("stable")]
    print(f"  distinct settled weights: {sorted(set(settled))}")

    for want in (44800.0, 16200.0):
        if want not in settled:
            print(f"  FAIL  {want} kg never arrived"); failures += 1
    if not failures:
        print("  ok    gross and tare both arrived, flagged settled")

    # A live feed carries many stable readings while a truck rests on the deck,
    # and should: the screen has to keep saying "settled" the whole time the
    # operator is deciding. What must happen once per rest is the settle EVENT,
    # which is what the record and the capture key off.
    rests = 3   # empty, gross, tare — the deck returns to 0 between them
    if agent.settles < rests:
        print(f"  FAIL  only {agent.settles} settle events for {rests} rests"); failures += 1
    elif agent.settles > rests + 2:
        print(f"  FAIL  {agent.settles} settle events — a rest fired repeatedly"); failures += 1
    else:
        print(f"  ok    {agent.settles} settle events for {rests} rests — one per rest")

    if any(r["weight_kg"] in (8400.0, 21000.0) and r.get("stable") for r in received):
        print("  FAIL  a rolling truck was reported as settled"); failures += 1
    else:
        print("  ok    weights while the truck was rolling were never settled")

    if not all(r.get("bridge") == "WB3" for r in received):
        print("  FAIL  a reading arrived without its bridge"); failures += 1
    else:
        print("  ok    every reading named its bridge")

    # ── the network drops ──────────────────────────────────────────────────
    print("\n  simulating: server unreachable during a weighment")
    before = len(received)
    refuse.set()
    indicator([(0, 0.3), (38600, 1.3)])
    time.sleep(1.2)
    if len(received) != before:
        print("  FAIL  the server was refusing but readings got through"); failures += 1
    spooled = wbagent.SPOOL.exists() and wbagent.SPOOL.stat().st_size > 0
    print(f"  ok    nothing lost to the void — spooled to disk: {spooled}")
    if not spooled:
        print("  FAIL  readings were dropped instead of spooled"); failures += 1

    refuse.clear()
    print("  server back — waiting for the replay")
    for _ in range(40):
        time.sleep(0.25)
        if any(r["weight_kg"] == 38600.0 for r in received):
            break
    if any(r["weight_kg"] == 38600.0 for r in received):
        print("  ok    the weight taken while offline arrived after reconnect")
    else:
        print("  FAIL  the offline weight never arrived"); failures += 1

    # ── the file goes away ─────────────────────────────────────────────────
    print("\n  simulating: the digitizer stops writing")
    DATA.unlink()
    time.sleep(0.6)
    if agent.error and "not there" in agent.error:
        print(f"  ok    reported plainly: {agent.error!r}")
    else:
        print(f"  FAIL  missing file not reported, error was {agent.error!r}"); failures += 1
    if agent.weight is not None:
        print("  FAIL  kept showing a stale weight after the file vanished"); failures += 1
    else:
        print("  ok    stopped showing a weight rather than holding the last one")

    agent.stop(); srv.shutdown()
    print(f"\n{'ALL PASS' if not failures else str(failures) + ' FAILURES'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
