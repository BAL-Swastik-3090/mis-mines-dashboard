"""Reproduce what took WB3 off the air, and prove it cannot happen again.

The bug was not subtle once seen, and it was invisible until then: a malformed
line in the spool raised out of _drain_spool, the sender thread died, and the
agent kept reading into a queue nobody was emptying. Everything a person could
check looked healthy.

So the test feeds it exactly that — a spool with two corrupt lines among the
good ones, which is what was actually on the machine — and checks the two
things that matter: the readable records still go, and the thread is still
alive afterwards.
"""
import json
import sys
import time
from pathlib import Path

AGENT = Path(r'D:\Projects\Mines\mis-mines-dashboard\weighbridge-agent')
sys.path.insert(0, str(AGENT))

import wbagent                                          # noqa: E402

ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'ok  ' if good else 'FAIL'} {name}: {got}"
          + ("" if good else f"  (expected {want})"))


class FakeSession:
    """Accepts everything, and remembers what it was given."""
    def __init__(self):
        self.got = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.got.extend(json["readings"])

        class R:
            status_code = 200
            text = '{"accepted": 1}'
            def raise_for_status(self): pass
        return R()


# A spool exactly like the one on WB3: mostly good, two lines of rubbish.
spool = AGENT / "spool.jsonl"
backup = spool.with_suffix(".jsonl.testbak") if spool.exists() else None
if backup:
    spool.replace(backup)

lines = []
for i in range(10):
    lines.append(json.dumps({"weight_kg": float(i), "stable": True,
                             "raw": str(i), "read_at": "2026-09-28T10:00:00+00:00"}))
lines.insert(3, '{"weight_kg": 4.0, "stable": tr')     # half a line, as a power cut leaves
lines.insert(7, '\x00\x00\x00')                        # a torn block
spool.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"spool: {len(lines)} lines, 2 of them corrupt\n")

try:
    print("1. draining a spool that contains unreadable lines")
    sender = wbagent.Sender.__new__(wbagent.Sender)
    sender.url = "http://example.invalid/readings"
    sender.token = "test-token"
    sender.sent = 0
    sender.online = True
    sender.last_error = None
    sender.spooled = 0
    sender.dropped = 0
    sender.on_status = lambda *a: None

    session = FakeSession()
    sender._drain_spool(session)

    check("the readable readings were sent", len(session.got), 10)
    check("the corrupt ones were counted", sender.dropped, 2)
    check("nothing was raised", True, True)
    check("spool emptied", spool.read_text(encoding="utf-8").strip(), "")

    print("\n2. the sender thread survives an exception from anywhere")
    boom = {"n": 0}

    def explode(_session):
        boom["n"] += 1
        if boom["n"] <= 2:
            raise RuntimeError("something nobody predicted")

    s2 = wbagent.Sender.__new__(wbagent.Sender)
    s2.on_status = lambda *a: None
    s2.last_error = None
    s2._once = explode
    import threading
    s2._stop = threading.Event()

    t = threading.Thread(target=s2.run, daemon=True)
    t.start()
    time.sleep(3.5)
    alive = t.is_alive()
    s2._stop.set()
    time.sleep(1.5)

    check("thread still running after two failures", alive, True)
    check("it kept going round", boom["n"] > 2, True)
    check("and said so", "recovered from" in (s2.last_error or ""), True)
finally:
    spool.unlink(missing_ok=True)
    if backup:
        backup.replace(spool)

print()
print("ALL PASS" if ok else "SOMETHING FAILED")
sys.exit(0 if ok else 1)
