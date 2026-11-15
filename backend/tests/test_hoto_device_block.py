"""Blocking a tablet from the dashboard, and letting it back.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
Asked for on 16 Nov: "from the dashboard can I block any device". Revoking
stops a tablet for good and strands whatever it holds; a block has to be
undoable, keep the tablet's credential, tell its holder why, and leave nothing
behind when it is lifted. These tests enrol a tablet for the purpose, drive it
through block, unblock and retire, and remove it afterwards.

Run: python tests/test_hoto_device_block.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text                                   # noqa: E402
from app.minehub_db import get_minehub_db                     # noqa: E402
from app.services import hoto_devices as dvc                  # noqa: E402

ok = True
CODE = "TEST-BLOCK-01"


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {name}")
    if not good:
        print(f"        got {got!r}, wanted {want!r}")


def refusal(fn, *a, **kw):
    """The DeviceError a call raises, or None if it went through."""
    try:
        fn(*a, **kw)
        return None
    except dvc.DeviceError as e:
        db.rollback()
        return e


db = next(get_minehub_db())
db.execute(text("DELETE FROM hoto_device WHERE device_code = :c"), {"c": CODE})
db.commit()
token = dvc.enrol(db, device_code=CODE, label="test tablet, removed by the test",
                  profile="COMPANY", actor="test")["token"]

try:
    print("an active tablet is let in")
    check("its token works", dvc.authenticate(db, token)["device_code"], CODE)

    print("blocking needs a reason, because the holder is shown it")
    e = refusal(dvc.block, db, CODE, "test", "   ")
    check("refused without one", e is not None and e.status, 422)

    print("a blocked tablet is refused, told why, and told nothing is lost")
    check("blocked", dvc.block(db, CODE, "test", "left in the canteen")["status"], "SUSPENDED")
    e = refusal(dvc.authenticate, db, token)
    check("refused with 403, which the tablet keeps its handovers for", e and e.status, 403)
    msg = e.problems[0] if e else ""
    check("the reason is in what it is told", "left in the canteen" in msg, True)
    check("and that its handovers wait", "stay on it" in msg, True)
    row = db.execute(text("""
        SELECT token_hash IS NOT NULL AS has_token, remarks FROM hoto_device
         WHERE device_code = :c"""), {"c": CODE}).mappings().first()
    check("its credential is kept, so unblocking needs nothing on the tablet",
          row["has_token"], True)
    check("who blocked it goes on its history", "blocked by test on" in (row["remarks"] or ""), True)

    print("blocking twice is refused, and says so")
    e = refusal(dvc.block, db, CODE, "test", "again")
    check("not active, so not blocked again", e and e.status, 404)

    print("unblocking lets the same token back in")
    check("unblocked", dvc.unblock(db, CODE, "test")["status"], "ACTIVE")
    check("the token it already had works", dvc.authenticate(db, token)["device_code"], CODE)
    e = refusal(dvc.unblock, db, CODE, "test")
    check("unblocking an active tablet is refused", e and e.status, 404)

    print("retiring is for good: a retired tablet cannot be unblocked")
    dvc.block(db, CODE, "test", "lost")
    check("a blocked tablet can still be retired",
          dvc.revoke(db, CODE, "test", "not found")["status"], "REVOKED")
    e = refusal(dvc.unblock, db, CODE, "test")
    check("and then not unblocked", e and e.status, 404)
    e = refusal(dvc.authenticate, db, token)
    check("its token is gone", e and e.status, 401)
finally:
    db.execute(text("DELETE FROM hoto_device WHERE device_code = :c"), {"c": CODE})
    db.commit()

print("\nALL PASS" if ok else "\nSOME FAILED")
sys.exit(0 if ok else 1)
