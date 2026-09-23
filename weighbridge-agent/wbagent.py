"""MineHub Weighbridge Agent — reads the indicator's file, sends the weight.

Runs on the weighbridge PC. The digitizer writes the live weight to a file
(C:\\WB3\\wbdata.txt on this site); this watches that file and posts what it
sees to the MineHub server, so the portal can show the live weight and, more
importantly, can keep a record of what the bridge was showing at the moment
somebody recorded a figure against a truck.

    wbagent.py                 the window, for the weighbridge PC
    wbagent.py --sniff         print what the file actually contains, and stop
    wbagent.py --headless      no window, for running as a service

THREE RULES THIS AGENT KEEPS

It never writes to the indicator's file, and never takes a lock that would stop
anything else reading it. SAP GUI still reads the same file on every capture,
and the digitizer is still writing to it. An agent that broke either of those
would have replaced a working weighbridge with a broken one.

It never invents a weight. If the file cannot be read, or the line cannot be
parsed, it says so on screen and sends nothing. A gap in the record is a fact;
a plausible number is a liability.

It never loses a reading to a bad network. A mine site drops its link several
times a day. Readings queue on disk and replay in order when the server comes
back, so the trace around a capture has no holes in it.

PACKAGING
    pip install requests
    pyinstaller --onefile --noconsole --name MineHubWeighbridge wbagent.py

Settings live in wbagent.ini beside the executable. The token is a credential —
it identifies this PC to the server — so the file belongs somewhere only the
weighbridge operator's account can read.
"""
from __future__ import annotations

import argparse
import configparser
import json
import os
import queue
import re
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover
    sys.exit("requests is not installed.\n  pip install requests")

# A Windows console is cp1252 unless told otherwise, and the first build of
# this crashed on its own output: the rules drawn under --sniff are box
# characters, which cp1252 has no idea about. Reconfigured rather than
# de-fanged, so genuine content — a vehicle number, an error from the OS —
# also survives instead of raising.
if sys.platform == "win32":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

APP = "MineHub Weighbridge Agent"
VERSION = "1.0.0"

HERE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
BESIDE_EXE = Path(sys.executable).parent if getattr(sys, "frozen", False) \
    else Path(__file__).resolve().parent
INI = BESIDE_EXE / "wbagent.ini"
SPOOL = BESIDE_EXE / "spool.jsonl"

DEFAULT_INI = """\
; MineHub Weighbridge Agent
;
; server      where MineHub is reachable from this PC
; token       issued in the portal under Weighbridge > Bridges > Agents.
;             It identifies this machine. Treat it like a password.
; bridge      the bridge this PC is wired to, as coded in the portal
; path        the file the indicator writes the live weight to
; source      serial, file, or auto.
;             serial  reads the indicator directly on `port` — the honest one:
;                     nothing sits between the load cells and the record.
;             file    watches `path`, which is what SAP GUI reads. Only as
;                     trustworthy as that file's permissions.
;             auto    serial if a port is configured and answers, else file.
; port        COM1 etc. Run --probe to find which port and which baud.
; parser      auto, or one of: toledo, plain  (run --sniff to find out)
; poll_ms     how often to read the file. 400ms is four readings a second,
;             which is plenty to catch a settle and gentle on a decade-old PC.

[agent]
server  = https://mines.balasorealloys.in
token   =
bridge  = WB3
source  = auto
port    = COM1
baud    = 9600
path    = C:\\WB3\\wbdata.txt
parser  = auto
poll_ms = 400

[stability]
; A weight counts as settled when this many consecutive readings agree to
; within tolerance_kg. Indicators that report stability themselves override
; this — their own flag is better than anything inferred here.
samples      = 5
tolerance_kg = 20
"""


# ───────────────────────────────────────────────────────────────────────────
# Parsing what the indicator wrote
# ───────────────────────────────────────────────────────────────────────────
# Weighbridge indicators do not agree on a format, and the ones on Indian sites
# are mostly one of three shapes. Each parser returns (weight_kg, is_stable) or
# None, and `auto` tries them in order of how specific they are — a format that
# carries its own stability flag is worth more than one that does not, so it is
# tried first and never overridden by a looser match.

# Essae-Teraoka, Avery India, Toledo and most of their clones:
#   ST,GS,+  12345kg     stable, gross
#   US,GS,+  12300kg     unstable — the truck is still rolling
_TOLEDO = re.compile(
    r"\b(?P<stab>ST|US)\s*,\s*(?P<kind>GS|NT)\s*,\s*(?P<sign>[+-]?)\s*"
    r"(?P<val>\d+(?:\.\d+)?)\s*(?P<unit>kg|kgs|t|ton)?",
    re.I,
)

# A bare number, optionally signed, optionally with a unit:
#   12345      +0012345      12345 kg      12,345 KG
_PLAIN = re.compile(
    r"(?P<sign>[+-]?)\s*(?P<val>\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*"
    r"(?P<unit>kg|kgs|t|ton|tons)?\s*$",
    re.I,
)

# There is deliberately no "CSV" parser splitting on commas.
#
# One was written, and it read "12,345 KG" as 345 — it took the thousands
# separator for a field delimiter and under-reported the load ten-fold, which
# on a weighbridge is the most expensive mistake this file can make. The
# timestamped case it was meant for, "16.09.2026 16:07:41,  12345", is already
# handled by the plain parser, which anchors on the end of the line and so
# picks up the weight wherever the fields before it end.
#
# If the real file turns out to put the weight somewhere other than last, a
# parser gets written for that actual format. Not before.

_TO_KG = {"t": 1000.0, "ton": 1000.0, "tons": 1000.0}


def _kg(val: str, sign: str, unit: str | None) -> float:
    n = float(val.replace(",", ""))
    if sign == "-":
        n = -n
    return n * _TO_KG.get((unit or "").lower(), 1.0)


def parse_toledo(line: str):
    m = _TOLEDO.search(line)
    if not m:
        return None
    return _kg(m["val"], m["sign"], m["unit"]), m["stab"].upper() == "ST"


def parse_plain(line: str):
    m = _PLAIN.search(line.strip())
    if not m:
        return None
    # No stability flag in this format — the caller infers it from repetition.
    return _kg(m["val"], m["sign"], m["unit"]), None


PARSERS = {"toledo": parse_toledo, "plain": parse_plain}
# Toledo first: it carries the indicator's own stability flag, which is worth
# more than anything inferred from repetition, so a line it understands must
# never fall through to a looser parser that would drop that flag.
AUTO_ORDER = ("toledo", "plain")


def parse(text: str, which: str = "auto"):
    """The last line that parses, and which parser understood it.

    Last rather than first: when the file is an append-only log the newest
    reading is at the bottom, and when it is a single rewritten line there is
    only one to choose from. Reading the top of a growing log would report a
    weight from this morning as the live figure.
    """
    # Strip the framing before anything tries to read a number out of it.
    #
    # WB3's indicator sends  STX SP 0 0 0 0 1 0 ETX CR LF  — the weight
    # wrapped in control characters, which is ordinary for a weighbridge and
    # was fatal here: every parser anchors on the end of the line, ETX is not
    # whitespace, so nothing matched. The agent would have reported a live,
    # streaming bridge as unreadable. Found by listening to the real port.
    #
    # Everything below 0x20 becomes a space except CR and LF, which are the
    # line breaks this then splits on.
    cleaned = "".join(
        ch if (ch >= " " or ch in "\r\n") else " " for ch in text)
    lines = [l.strip() for l in cleaned.replace("\r", "\n").split("\n")
             if l.strip()]
    if not lines:
        return None
    names = AUTO_ORDER if which == "auto" else (which,)
    for line in reversed(lines[-8:]):
        for name in names:
            fn = PARSERS.get(name)
            if not fn:
                continue
            got = fn(line)
            if got is not None:
                return {"weight_kg": got[0], "stable": got[1],
                        "raw": line.strip()[:200], "parser": name}
    return None


# ───────────────────────────────────────────────────────────────────────────
# Reading the file without getting in anybody's way
# ───────────────────────────────────────────────────────────────────────────
def read_file(path: Path) -> str:
    """Read the indicator's file, sharing it with everyone else.

    Opened read-only and closed immediately. On Windows a plain open() asks for
    no exclusive access, so the digitizer keeps writing and SAP GUI keeps
    reading while this runs. Anything unreadable is raised for the caller to
    show — never swallowed into a default weight.

    Only the tail is read: an append-only log left running for a month is a
    file nobody wants loaded into memory four times a second.
    """
    size = path.stat().st_size
    with open(path, "rb") as fh:
        if size > 8192:
            fh.seek(-8192, os.SEEK_END)
        raw = fh.read()
    return raw.decode("utf-8", errors="replace")


class Settle:
    """Decides when a weight has stopped moving.

    An indicator that reports its own stability is believed — it knows about
    the load cells and this does not. Otherwise a weight counts as settled once
    the same figure, within tolerance, has come back often enough in a row.

    One settle event per rest. Without that, a truck standing on the deck for
    forty seconds produces a hundred identical "settled" events and the record
    becomes unreadable at exactly the moment it matters.
    """

    def __init__(self, samples: int, tolerance_kg: float):
        self.samples = max(2, samples)
        self.tolerance = max(0.0, tolerance_kg)
        self.recent: list[float] = []
        self.announced: float | None = None

    def feed(self, weight: float, flag: bool | None) -> bool:
        if flag is not None:
            settled = flag
            self.recent = []
        else:
            self.recent.append(weight)
            self.recent = self.recent[-self.samples:]
            settled = (len(self.recent) == self.samples
                       and max(self.recent) - min(self.recent) <= self.tolerance)

        if not settled:
            # Leaving the deck rearms it, so the next truck is reported.
            if self.announced is not None and abs(weight - self.announced) > self.tolerance:
                self.announced = None
            return False

        if self.announced is not None and abs(weight - self.announced) <= self.tolerance:
            return False
        self.announced = weight
        return True


# ───────────────────────────────────────────────────────────────────────────
# Sending, and not losing anything when the link drops
# ───────────────────────────────────────────────────────────────────────────
class Sender(threading.Thread):
    """Posts readings, and spools them to disk when it cannot.

    The queue is bounded. A server that has been down for an hour must not turn
    into a weighbridge PC that has run out of memory, so the oldest live
    readings are dropped once the spool has them — the spool is the record, the
    queue is only the fast path.
    """

    daemon = True

    def __init__(self, server: str, token: str, bridge: str, on_status):
        super().__init__(name="sender")
        self.url = server.rstrip("/") + "/api/weighbridge/readings"
        self.token = token
        self.bridge = bridge
        self.on_status = on_status
        self.q: queue.Queue = queue.Queue(maxsize=2000)
        self.online = False
        self.sent = 0
        self.spooled = 0
        self.last_error: str | None = None
        self._stop = threading.Event()

    def offer(self, payload: dict) -> None:
        payload["bridge"] = self.bridge
        try:
            self.q.put_nowait(payload)
        except queue.Full:
            self._spool([payload])

    def _spool(self, batch: list[dict]) -> None:
        try:
            with open(SPOOL, "a", encoding="utf-8") as fh:
                for item in batch:
                    fh.write(json.dumps(item) + "\n")
            self.spooled += len(batch)
        except OSError as exc:
            self.last_error = f"could not spool: {exc}"

    def _drain_spool(self, session: requests.Session) -> None:
        if not SPOOL.exists() or SPOOL.stat().st_size == 0:
            return
        try:
            lines = SPOOL.read_text(encoding="utf-8").splitlines()
        except OSError:
            return
        kept: list[str] = []
        for i in range(0, len(lines), 200):
            chunk = [json.loads(l) for l in lines[i:i + 200] if l.strip()]
            if not chunk or not self._post(session, chunk):
                kept.extend(lines[i:])
                break
        try:
            SPOOL.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
            self.spooled = len(kept)
        except OSError:
            pass

    def _post(self, session: requests.Session, batch: list[dict]) -> bool:
        try:
            r = session.post(self.url, json={"readings": batch},
                             headers={"X-Agent-Token": self.token,
                                      "X-Agent-Version": VERSION},
                             timeout=10)
            if r.status_code == 401:
                self.last_error = "token refused — check wbagent.ini"
                self.online = False
                return False
            r.raise_for_status()
            self.sent += len(batch)
            self.online = True
            self.last_error = None
            return True
        except requests.RequestException as exc:
            self.online = False
            self.last_error = str(exc)[:140]
            return False

    def run(self) -> None:
        session = requests.Session()
        while not self._stop.is_set():
            batch: list[dict] = []
            try:
                batch.append(self.q.get(timeout=1.0))
            except queue.Empty:
                pass
            while len(batch) < 100:
                try:
                    batch.append(self.q.get_nowait())
                except queue.Empty:
                    break

            if batch:
                if not self._post(session, batch):
                    self._spool(batch)
            elif self.online or self.last_error is None:
                self._drain_spool(session)
            else:
                # Offline and idle: try the spool occasionally rather than
                # hammering a server that is not there.
                time.sleep(2)
                self._drain_spool(session)

            self.on_status()

    def stop(self) -> None:
        self._stop.set()


# ───────────────────────────────────────────────────────────────────────────
# The loop
# ───────────────────────────────────────────────────────────────────────────
class Agent:
    def __init__(self, cfg: configparser.ConfigParser, on_update=None):
        a = cfg["agent"]
        s = cfg["stability"]
        self.path = Path(a.get("path", ""))
        self.source = a.get("source", "auto").strip().lower()
        self.port = a.get("port", "").strip()
        self.baud = a.getint("baud", 9600)
        self.reader = None
        self.reading_from = None      # what it settled on, for the screen
        self.parser = a.get("parser", "auto")
        self.poll = max(100, a.getint("poll_ms", 400)) / 1000.0
        self.settle = Settle(s.getint("samples", 5), s.getfloat("tolerance_kg", 20))
        self.on_update = on_update or (lambda: None)

        self.sender = Sender(a["server"], a.get("token", ""), a["bridge"],
                             self.on_update)
        self.weight: float | None = None
        self.stable = False
        self.raw = ""
        self.parser_used = ""
        self.error: str | None = None
        self.settles = 0
        self._stop = threading.Event()
        # Live readings are sent at a gentler rate than they are read: the
        # screen wants four a second, the database does not.
        self._last_live = 0.0

    def start(self) -> None:
        self.sender.start()
        threading.Thread(target=self._loop, name="reader", daemon=True).start()

    def _take(self) -> str | None:
        """Whatever the configured source has to say, as text.

        Serial is preferred where it is available and answering, because a
        file between the indicator and the record is a file somebody can edit.
        The fallback to the file is deliberate and reported rather than silent:
        an operator should know which of the two they are looking at.
        """
        want_serial = self.source in ("serial", "auto") and self.port
        if want_serial:
            if self.reader is None:
                from serial_source import SerialReader
                self.reader = SerialReader(self.port, self.baud)
            line = self.reader.read()
            if line is not None:
                self.reading_from = f"{self.port} @ {self.baud}"
                self.error = None
                return line
            if self.reader.error:
                if self.source == "serial":
                    # Told to use the port and the port is not answering. Say
                    # so; do not quietly read a file the operator did not ask
                    # for and present it as the bridge.
                    self.error = f"{self.port}: {self.reader.error}"
                    self.reading_from = None
                    return None
            else:
                return None            # port open, nothing yet — not an error

        if self.source == "serial":
            return None
        self.reading_from = str(self.path)
        return read_file(self.path)

    def _loop(self) -> None:
        while not self._stop.is_set():
            now = time.time()
            try:
                text = self._take()
                got = parse(text, self.parser) if text is not None else None
                if got is None:
                    self.error = "could not read a weight from the file"
                    self.weight = None
                else:
                    self.error = None
                    self.weight = got["weight_kg"]
                    self.raw = got["raw"]
                    self.parser_used = got["parser"]
                    settled = self.settle.feed(got["weight_kg"], got["stable"])
                    if got["stable"] is not None:
                        self.stable = got["stable"]
                    elif settled:
                        self.stable = True

                    # Every reading carries the truth about whether the load
                    # had settled — the indicator's own flag where it gives one,
                    # otherwise what repetition implies.
                    #
                    # The settle *event* and the stable *state* are different
                    # things, and conflating them was a bug: live readings were
                    # sent with stable=False even while the indicator was saying
                    # ST, so the screen read "weighing..." throughout a rest and
                    # the operator was told to wait for a weight that had already
                    # steadied.
                    is_stable = got["stable"] if got["stable"] is not None else self.stable
                    stamp = datetime.now(timezone.utc).isoformat()
                    if settled:
                        self.settles += 1
                    if settled or now - self._last_live >= 1.0:
                        self.sender.offer({"weight_kg": round(got["weight_kg"], 2),
                                           "stable": bool(is_stable), "raw": got["raw"],
                                           "read_at": stamp})
                        self._last_live = now
            except FileNotFoundError:
                self.error = f"{self.path} is not there"
                self.weight = None
            except PermissionError:
                self.error = f"{self.path} cannot be read — permission refused"
                self.weight = None
            except OSError as exc:
                self.error = f"{type(exc).__name__}: {exc}"
                self.weight = None

            self.on_update()
            time.sleep(self.poll)

    def stop(self) -> None:
        self._stop.set()
        self.sender.stop()


# ───────────────────────────────────────────────────────────────────────────
# Learning what the file holds
# ───────────────────────────────────────────────────────────────────────────
def sniff(path: Path, seconds: int = 6) -> int:
    """Show what is actually in the file, so the parser can be pinned down.

    Every indicator claims a standard and few keep to one. Rather than guess
    from a manual, this watches the real file for a few seconds and prints the
    bytes, what changed, and which parser understood it.
    """
    print(f"{APP} {VERSION} — reading {path}\n")
    if not path.exists():
        print("  The file is not there. Check the path, and that the digitizer")
        print("  software is running — some only create it on the first weighment.")
        return 1

    st = path.stat()
    print(f"  size {st.st_size} bytes, last written "
          f"{datetime.fromtimestamp(st.st_mtime):%d-%m-%Y %H:%M:%S}\n")

    seen: list[str] = []
    grew = False
    first_size = st.st_size
    end = time.time() + seconds
    while time.time() < end:
        try:
            text = read_file(path)
        except OSError as exc:
            print(f"  could not read: {exc}")
            return 1
        if not seen or text != seen[-1]:
            seen.append(text)
        grew = grew or path.stat().st_size != first_size
        time.sleep(0.3)

    latest = seen[-1]
    print("  -- raw, last version seen " + "-" * 42)
    for line in latest.replace("\r", "\n").split("\n")[-10:]:
        if line.strip():
            print(f"    {line!r}")
    print("  " + "-" * 68)
    print(f"\n  changed {len(seen) - 1} times in {seconds}s; "
          f"file {'grows (append log)' if grew else 'is rewritten in place'}\n")

    got = parse(latest, "auto")
    if got:
        flag = ("the indicator reports stability itself" if got["stable"] is not None
                else "no stability flag — the agent will infer it from repetition")
        print(f"  Understood by the '{got['parser']}' parser: "
              f"{got['weight_kg']:,.0f} kg")
        print(f"  {flag}")
        print(f"\n  Put  parser = {got['parser']}  in wbagent.ini "
              f"(or leave it on auto).")
        return 0

    print("  None of the built-in parsers understood this.")
    print("  Send the lines above to IT and a parser will be added — it is a")
    print("  few lines, and guessing at the format is how a weight goes wrong.")
    return 2


def probe_ports() -> int:
    """Find which port the indicator is on, and at what baud rate.

    Few sites have the indicator's manual and fewer still know its settings.
    Rather than guess, listen at each common rate and report what came back —
    the right one is the one that produces readable weights.
    """
    try:
        from serial_source import ports, probe
    except RuntimeError:
        print("pyserial is not installed.\n  pip install pyserial")
        return 1

    found = ports()
    if not found:
        print("No serial ports on this machine.")
        print("If the indicator is on USB, check the cable and Device Manager.")
        return 1

    print(f"{APP} {VERSION} — serial ports\n")
    for dev, desc in found:
        print(f"  {dev:<8} {desc}")

    for dev, _ in found:
        print(f"\n-- listening on {dev} --")
        best = None
        for r in probe(dev):
            if r.chars < 0:
                print(f"  {r.baud:>6}  could not open — {r.sample}")
                continue
            if r.chars == 0:
                print(f"  {r.baud:>6}  silent")
                continue
            read = (f"{r.weight:,.0f} kg via '{r.parser}'" if r.parser
                    else "not understood by any parser")
            print(f"  {r.baud:>6}  {r.chars:>4} chars  {read}")
            print(f"          {r.sample}")
            if r.parser and best is None:
                best = r

        if best:
            print(f"\n  USE THIS — put in wbagent.ini:")
            print(f"    source = serial")
            print(f"    port   = {best.port}")
            print(f"    baud   = {best.baud}")
            print(f"    parser = {best.parser}")
        else:
            print("\n  Nothing readable. Either the indicator is not")
            print("  transmitting, or it speaks a format no parser knows yet.")
            print("  Send the lines above to IT — a parser is a few lines, and")
            print("  guessing at a weight is how a load goes out wrong.")
    return 0


# ───────────────────────────────────────────────────────────────────────────
# The window
# ───────────────────────────────────────────────────────────────────────────
def gui(cfg: configparser.ConfigParser) -> int:
    import tkinter as tk
    from tkinter import font as tkfont

    root = tk.Tk()
    root.title(f"{APP} — {cfg['agent']['bridge']}")
    root.configure(bg="#0f1c35")
    root.geometry("560x340")
    root.minsize(460, 300)

    big = tkfont.Font(family="Consolas", size=64, weight="bold")
    label = tkfont.Font(family="Segoe UI", size=9)
    mono = tkfont.Font(family="Consolas", size=9)

    tk.Label(root, text=cfg["agent"]["bridge"], bg="#0f1c35", fg="#f5a623",
             font=tkfont.Font(family="Segoe UI", size=11, weight="bold")).pack(pady=(14, 0))

    weight_var = tk.StringVar(value="—")
    weight_lbl = tk.Label(root, textvariable=weight_var, bg="#0f1c35",
                          fg="#ffffff", font=big)
    weight_lbl.pack(pady=(2, 0))
    tk.Label(root, text="kilograms", bg="#0f1c35", fg="#6b7c9e",
             font=label).pack()

    state_var = tk.StringVar(value="starting…")
    state_lbl = tk.Label(root, textvariable=state_var, bg="#0f1c35",
                         fg="#6b7c9e", font=label)
    state_lbl.pack(pady=(10, 0))

    detail_var = tk.StringVar(value="")
    tk.Label(root, textvariable=detail_var, bg="#0f1c35", fg="#4a5a7a",
             font=mono, wraplength=520, justify="left").pack(pady=(10, 0), padx=16)

    agent: Agent | None = None

    def refresh() -> None:
        if agent is None:
            return
        if agent.error:
            weight_var.set("—")
            weight_lbl.configure(fg="#ff6b6b")
            state_var.set(agent.error)
            state_lbl.configure(fg="#ff6b6b")
        else:
            weight_var.set(f"{agent.weight:,.0f}" if agent.weight is not None else "—")
            weight_lbl.configure(fg="#4ade80" if agent.stable else "#ffffff")
            state_var.set("settled" if agent.stable else "weighing…")
            state_lbl.configure(fg="#4ade80" if agent.stable else "#6b7c9e")

        s = agent.sender
        link = "connected" if s.online else "offline"
        detail_var.set(
            f"server   {link}   sent {s.sent}"
            + (f"   queued on disk {s.spooled}" if s.spooled else "")
            + f"\nsource   {agent.reading_from or '(nothing yet)'}"
            + (f"\nparser   {agent.parser_used}   raw  {agent.raw}" if agent.raw else "")
            + (f"\nlast err {s.last_error}" if s.last_error else "")
        )
        root.after(250, refresh)

    agent = Agent(cfg, on_update=lambda: None)
    agent.start()
    root.after(250, refresh)

    def on_close() -> None:
        agent.stop()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.mainloop()
    return 0


# ───────────────────────────────────────────────────────────────────────────
def load_config() -> configparser.ConfigParser:
    if not INI.exists():
        INI.write_text(DEFAULT_INI, encoding="utf-8")
        print(f"Wrote a starting {INI}.\nFill in the token and the path, then run again.")
        raise SystemExit(0)
    cfg = configparser.ConfigParser()
    # utf-8-sig, not utf-8. Windows PowerShell's Set-Content -Encoding UTF8
    # writes a byte-order mark, configparser reads it as part of the first
    # line, and the whole file is rejected with "contains no section headers".
    # The agent then dies on startup with a message about INI syntax that says
    # nothing about the real cause. Reading it this way costs nothing and the
    # class of problem disappears.
    cfg.read(INI, encoding="utf-8-sig")

    # Strip quotes somebody's shell left around a value. `server =
    # 'http://host:8989'` is what a quoted argument through ssh produces, and
    # the agent would otherwise try to reach a host whose name begins with an
    # apostrophe.
    for section in cfg.sections():
        for key, value in cfg.items(section):
            trimmed = value.strip()
            if len(trimmed) > 1 and trimmed[0] == trimmed[-1] and trimmed[0] in "\"'":
                cfg.set(section, key, trimmed[1:-1])
    return cfg


def _hide_console() -> None:
    """Hide the console window this was launched with, if any.

    Only its own console: GetConsoleWindow returns the window of the console
    THIS process is attached to, and when the agent is started from an existing
    terminal that terminal is not ours to hide — so the check for a parent
    console comes first.
    """
    if sys.platform != "win32":
        return
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        pids = (ctypes.c_uint * 1)()
        # One process on this console means it was created for us.
        if k32.GetConsoleProcessList(pids, 1) <= 1:
            ctypes.windll.user32.ShowWindow(k32.GetConsoleWindow(), 0)
    except Exception:
        pass            # a hidden console is a nicety, never a reason to fail


def main() -> int:
    ap = argparse.ArgumentParser(description=APP)
    ap.add_argument("--sniff", action="store_true",
                    help="print what the indicator's file contains, and stop")
    ap.add_argument("--headless", action="store_true",
                    help="run without a window, for a service")
    ap.add_argument("--probe", action="store_true",
                    help="list serial ports and listen at each baud rate")
    ap.add_argument("--path", help="override the watched file, for --sniff")
    args = ap.parse_args()

    if args.probe:
        return probe_ports()

    if args.sniff and args.path:
        return sniff(Path(args.path))

    cfg = load_config()
    if args.sniff:
        return sniff(Path(cfg["agent"]["path"]))

    if not cfg["agent"].get("token", "").strip():
        print("No token in wbagent.ini. Issue one in the portal under "
              "Weighbridge > Bridges > Agents.")
        return 1

    if args.headless:
        agent = Agent(cfg)
        agent.start()
        try:
            while True:
                time.sleep(5)
        except KeyboardInterrupt:
            agent.stop()
        return 0

    # Built as a console program so --probe and --sniff can print. When it is
    # opening the window instead, the console is hidden — a weighbridge
    # operator should see the weight, not a black box behind it.
    _hide_console()
    return gui(cfg)


if __name__ == "__main__":
    raise SystemExit(main())
