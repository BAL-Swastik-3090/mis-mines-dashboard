"""Whose device is it.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
Asked for on 16 Nov: with employees putting the app on their own phones, the
office has to be able to tell whose each device is. A device now registers
with the person's employee number and whether it is their own phone, an
approver can set or correct whom it is registered to, and the device list
says who has actually been using it. These tests register a device for the
purpose and remove it afterwards.

Run: python tests/test_hoto_device_owner.py
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text                                   # noqa: E402
from app.minehub_db import get_minehub_db                     # noqa: E402
from app.services import hoto_devices as dvc                  # noqa: E402

ok = True
INSTALL = str(uuid.uuid4())
SECRET = "s" * 40


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
    print("an employee registering their own phone")
    e = refusal(dvc.register, db, install_id=INSTALL, claim_secret=SECRET,
                requested_by_name="Test Person", requested_by_emp="3101; drop")
    check("an employee number that is not one is refused", e is not None, True)
    out = dvc.register(db, install_id=INSTALL, claim_secret=SECRET,
                       requested_by_name="Test Person", requested_by_emp="t-9001",
                       own_device=True, model="Test Phone")
    code = out["device_code"]
    row = next(d for d in dvc.listing(db) if d["device_code"] == code)
    check("the name and number are kept together", row["requested_by_name"], "Test Person (T-9001)")
    check("and read back apart", (row["registered_to_name"], row["registered_to_emp"]),
          ("Test Person", "T-9001"))
    check("their own phone is marked PERSONAL", row["profile"], "PERSONAL")
    check("nobody has used it yet", (row["last_used_by"], row["people_30d"]), (None, 0))

    print("the office setting whose it is")
    e = refusal(dvc.set_owner, db, code, "test", name="  ", emp=None)
    check("a name is required", e is not None and e.status, 422)
    e = refusal(dvc.set_owner, db, code, "test", name="X", emp="1", profile="BORROWED")
    check("a device is a phone or a tablet, nothing else", e is not None and e.status, 422)
    dvc.set_owner(db, code, "test", name="Shift Supervisor", emp="4102",
                  profile="COMPANY", label="Pit 2 tablet")
    row = next(d for d in dvc.listing(db) if d["device_code"] == code)
    check("registered to the new person", (row["registered_to_name"], row["registered_to_emp"]),
          ("Shift Supervisor", "4102"))
    check("now a company tablet, with its name", (row["profile"], row["label"]),
          ("COMPANY", "Pit 2 tablet"))
    check("the change is on its history", "registered to Shift Supervisor (4102) by test" in (row["remarks"] or ""), True)
    e = refusal(dvc.set_owner, db, "NO-SUCH-DEVICE", "test", name="X", emp=None)
    check("an unknown device is refused", e is not None and e.status, 404)
finally:
    db.rollback()       # a failed check above must not stop the clean-up
    db.execute(text("DELETE FROM hoto_device WHERE install_id = CAST(:i AS uuid)"), {"i": INSTALL})
    db.commit()

print("\nALL PASS" if ok else "\nSOME FAILED")
sys.exit(0 if ok else 1)
