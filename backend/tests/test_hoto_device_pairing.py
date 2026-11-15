"""A device is allowed only with the pairing code on its own screen.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
Asked for on 16 Nov: when a device asks to be allowed, a code is made, and the
approver must give it to approve. Anyone with the app can register under any
name, and two waiting requests look alike on the dashboard; a code shown only
on the requesting device proves the approver is looking at that one. These
tests register devices for the purpose and remove them afterwards.

Run: python tests/test_hoto_device_pairing.py
"""
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text                                   # noqa: E402
from app.minehub_db import get_minehub_db                     # noqa: E402
from app.services import hoto_devices as dvc                  # noqa: E402

ok = True
A, B = str(uuid.uuid4()), str(uuid.uuid4())
SA, SB = "a" * 40, "b" * 40


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {name}")
    if not good:
        print(f"        got {got!r}, wanted {want!r}")


def refusal(fn, *a, **kw):
    try:
        fn(*a, **kw)
        return None
    except dvc.DeviceError as e:
        db.rollback()
        return e


db = next(get_minehub_db())
try:
    print("a device asking to be allowed is given a code, and only it is")
    a = dvc.register(db, install_id=A, claim_secret=SA, requested_by_name="Pair Test A")
    code_a = a.get("pairing_code") or ""
    check("six digits", (len(code_a), code_a.isdigit()), (6, True))
    check("the same code when it checks again",
          dvc.claim(db, A, SA).get("pairing_code"), code_a)
    again = dvc.register(db, install_id=A, claim_secret=SA, requested_by_name="Pair Test A")
    check("and when it registers again", again.get("pairing_code"), code_a)
    stranger = dvc.register(db, install_id=A, claim_secret="x" * 40, requested_by_name="Someone")
    check("not to anyone else using its install id", "pairing_code" in stranger, False)
    listed = next(d for d in dvc.listing(db) if d["device_code"] == a["device_code"])
    check("never on the dashboard's list", code_a in json.dumps(listed, default=str), False)

    b = dvc.register(db, install_id=B, claim_secret=SB, requested_by_name="Pair Test B")
    check("two devices, two codes", b["pairing_code"] != code_a, True)

    print("approving needs the code on that device's screen")
    e = refusal(dvc.approve, db, a["device_code"], "test")
    check("refused with no code", e and e.status, 403)
    e = refusal(dvc.approve, db, a["device_code"], "test", pairing=b["pairing_code"])
    check("refused with the other device's code", e and e.status, 403)
    check("and says how many tries are left", "tries before it locks" in (e.problems[0] if e else ""), True)
    out = dvc.approve(db, a["device_code"], "test", pairing=code_a[:3] + " " + code_a[3:])
    check("allowed with its own code, spaces and all", out["status"], "ACTIVE")
    check("once allowed it shows no code", "pairing_code" in dvc.claim(db, A, SA), False)

    print("guessing is stopped")
    for _ in range(dvc.PAIR_MAX_WRONG):
        refusal(dvc.approve, db, b["device_code"], "test", pairing="000000"
                if b["pairing_code"] != "000000" else "111111")
    e = refusal(dvc.approve, db, b["device_code"], "test", pairing=b["pairing_code"])
    check("after five wrong codes even the right one waits", e and e.status, 429)
finally:
    db.rollback()
    dvc._pair_wrong.clear()
    db.execute(text("DELETE FROM hoto_device WHERE install_id IN (CAST(:a AS uuid), CAST(:b AS uuid))"),
               {"a": A, "b": B})
    db.commit()

print("\nALL PASS" if ok else "\nSOME FAILED")
sys.exit(0 if ok else 1)
