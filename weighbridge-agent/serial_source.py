"""Reading the indicator itself, rather than a file somebody could edit.

WHY THIS EXISTS

The agent began by watching C:\\WB3\\wbdata.txt, because that is what SAP GUI
reads. Looking at the real weighbridge PC showed what that file actually is:
two bytes, containing `40`, last written eleven days earlier, with no software
installed anywhere on the machine that could have written it and nothing
holding the serial port open.

An indicator was physically connected the whole time — COM1, a USB serial
device, status OK — and nothing was listening to it.

A number that reaches the record through a text file on a Windows desktop is
only as trustworthy as that file's permissions, and a text file is not a
control. Reading the port removes the gap: there is no longer anything between
the load cells and the record for a person to edit.

WHAT THIS DOES NOT DO

It never writes to the port. Weighbridge indicators accept commands — tare,
zero, print — and an agent that can transmit is an agent that can change what
the bridge reads. This opens the port, reads, and closes it. The write
direction is not implemented at all, which is a stronger guarantee than
choosing not to use it.

DISCOVERING THE SETTINGS

Indicators do not agree on baud rate and few sites have the manual. `probe()`
listens at each common rate in turn and reports what came back and whether any
parser understood it, so the right setting is found by looking rather than by
guessing.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

try:
    import serial                      # pyserial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover
    serial = None
    list_ports = None

# Ordered by how likely they are on an Indian weighbridge indicator.
COMMON_BAUDS = (9600, 4800, 2400, 19200, 1200, 38400, 57600, 115200)


@dataclass
class Probe:
    port: str
    baud: int
    chars: int
    sample: str
    parser: str | None
    weight: float | None


def ports() -> list[tuple[str, str]]:
    """Every serial port on this machine, with what Windows calls it."""
    if list_ports is None:
        return []
    return [(p.device, p.description or "") for p in list_ports.comports()]


def probe(port: str, seconds: float = 3.0,
          bauds: tuple[int, ...] = COMMON_BAUDS) -> list[Probe]:
    """Listen at each baud rate and report what arrived.

    Read-only, and the port is closed after every attempt — a port left open
    is a port the digitizer's own software cannot use.
    """
    from wbagent import parse           # imported here to avoid a cycle

    found: list[Probe] = []
    for baud in bauds:
        buf = ""
        try:
            with serial.Serial(port, baud, timeout=0.4) as sp:
                end = time.time() + seconds
                while time.time() < end:
                    try:
                        buf += sp.read(256).decode("ascii", errors="replace")
                    except Exception:
                        break
        except Exception as exc:
            found.append(Probe(port, baud, -1, str(exc)[:70], None, None))
            continue

        got = parse(buf) if buf.strip() else None
        found.append(Probe(
            port=port, baud=baud, chars=len(buf),
            sample=buf.replace("\r", "<CR>").replace("\n", "<LF>")[:90],
            parser=got["parser"] if got else None,
            weight=got["weight_kg"] if got else None,
        ))
    return found


class SerialReader:
    """A live line of text from the indicator.

    The port is opened once and held. Indicators stream continuously — several
    readings a second — so the newest complete line is what the agent wants,
    and anything older is discarded rather than queued. A backlog of stale
    weights is worse than none: it would arrive looking current.
    """

    def __init__(self, port: str, baud: int = 9600, bytesize: int = 8,
                 parity: str = "N", stopbits: float = 1):
        if serial is None:
            raise RuntimeError("pyserial is not installed")
        self.port, self.baud = port, baud
        self._cfg = dict(bytesize=bytesize, parity=parity, stopbits=stopbits)
        self._sp: "serial.Serial | None" = None
        self._buf = ""
        self.error: str | None = None

    def _open(self) -> None:
        if self._sp and self._sp.is_open:
            return
        self._sp = serial.Serial(self.port, self.baud, timeout=0.2, **self._cfg)
        self.error = None

    def read(self) -> str | None:
        """The newest complete line, or None if nothing has arrived yet.

        A partial line is kept for next time rather than parsed — half a weight
        is a different number, not a smaller one.
        """
        try:
            self._open()
            self._buf += self._sp.read(512).decode("ascii", errors="replace")
        except Exception as exc:
            self.error = f"{type(exc).__name__}: {exc}"
            self.close()
            return None

        if len(self._buf) > 4096:                 # a stream with no terminator
            self._buf = self._buf[-1024:]

        text = self._buf.replace("\r", "\n")
        if "\n" not in text:
            return None
        lines = [l for l in text.split("\n") if l.strip()]
        self._buf = ""
        return lines[-1] if lines else None

    def close(self) -> None:
        try:
            if self._sp and self._sp.is_open:
                self._sp.close()
        except Exception:
            pass
        self._sp = None
