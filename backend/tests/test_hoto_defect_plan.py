"""Who is fixing a defect, and by when.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
The defect queue had no owner and no date (dashboard gap D4): ten open faults,
nobody named against any of them, and "overdue" measured only by how old a
defect was. Migration 116 adds both. These tests drive the service against a
defect raised for the purpose and removed afterwards, and check the two
things that make a target worth having: it is judged, and moving it leaves a
trail.

Run: python tests/test_hoto_defect_plan.py
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text                                   # noqa: E402
from app.minehub_db import get_minehub_db                     # noqa: E402
from app.services import hoto_defects as dfx                  # noqa: E402

ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {name}")
    if not good:
        print(f"        got {got!r}, wanted {want!r}")


def refused(fn, *a, **kw) -> bool:
    try:
        fn(*a, **kw)
        return False
    except dfx.DefectError:
        db.rollback()
        return True


db = next(get_minehub_db())
asset = db.execute(text("SELECT asset_id FROM asset ORDER BY asset_id LIMIT 1")).scalar()
raised = date.today() - timedelta(days=5)
did = db.execute(text("""
    INSERT INTO hoto_defect (asset_id, item_label, severity, description, raised_by, raised_at)
    VALUES (:a, 'Test: horn', 'HIGH', 'test defect, removed by the test', 'test', :r)
    RETURNING defect_id"""), {"a": asset, "r": raised}).scalar()
db.commit()

try:
    print("with nothing set, the severity norm applies -- and says so")
    row = next(r for r in dfx.queue(db, asset_id=asset) if r["defect_id"] == did)
    check("due by the HIGH norm, 3 days after raising", row["due_date"], raised + timedelta(days=3))
    check("marked as the norm, not as a date somebody set", row["due_is_set"], False)
    check("two days late", row["overdue_days"], 2)
    check("nobody fixing it", row["assigned_to"], None)

    print("\nsaying who, and by when")
    friday = date.today() + timedelta(days=3)
    dfx.plan(db, did, "test", assigned_to="  Hydraulics team ", target_date=friday.isoformat())
    row = next(r for r in dfx.queue(db, asset_id=asset) if r["defect_id"] == did)
    check("who is fixing it, trimmed", row["assigned_to"], "Hydraulics team")
    check("the date a person set", (row["due_date"], row["due_is_set"]), (friday, True))
    check("no longer late", row["overdue_days"], 0)

    print("\nmoving the target leaves a trail")
    dfx.plan(db, did, "test", target_date=(friday + timedelta(days=7)).isoformat())
    dfx.plan(db, did, "test", assigned_to="R. Naik (fitter)")
    trail = [e for e in dfx.detail(db, did)["events"] if e["kind"] != "STATE"]
    check("four entries: assigned, target set, target moved, reassigned",
          [e["kind"] for e in trail], ["ASSIGNED", "TARGET", "TARGET", "ASSIGNED"])
    check("the move says what it was before",
          trail[2]["note"].startswith(f"Target moved from {friday:%d %b %Y}"), True)
    check("the reassignment names both",
          trail[3]["note"], "Reassigned from Hydraulics team to R. Naik (fitter)")
    before = len(dfx.detail(db, did)["events"])
    dfx.plan(db, did, "test", assigned_to="R. Naik (fitter)")
    check("setting the same owner again adds nothing", len(dfx.detail(db, did)["events"]), before)

    print("\nwhat is refused")
    check("a blank owner", refused(dfx.plan, db, did, "test", assigned_to="  "), True)
    check("a target before the defect was raised",
          refused(dfx.plan, db, did, "test", target_date=(raised - timedelta(days=1)).isoformat()), True)
    check("something that is not a date", refused(dfx.plan, db, did, "test", target_date="Friday"), True)
    check("nothing at all", refused(dfx.plan, db, did, "test"), True)

    print("\na repaired defect is not planned, and not late")
    db.execute(text("""UPDATE hoto_defect SET state = 'VERIFIED', acknowledged_by = 'a',
                         acknowledged_at = now(), rectified_by = 'b', rectified_at = now(),
                         rectification_note = 'fixed', verified_by = 'c', verified_at = now(),
                         target_date = :t, target_set_by = 'test', target_set_at = now()
                        WHERE defect_id = :d"""), {"t": raised, "d": did})
    db.commit()
    row = next(r for r in dfx.queue(db, asset_id=asset) if r["defect_id"] == did)
    check("past its target but verified: not late", row["overdue_days"], 0)
    check("and cannot be planned", refused(dfx.plan, db, did, "test", assigned_to="anyone"), True)
finally:
    db.rollback()
    db.execute(text("DELETE FROM hoto_defect_event WHERE defect_id = :d"), {"d": did})
    db.execute(text("DELETE FROM hoto_defect WHERE defect_id = :d"), {"d": did})
    db.commit()
    db.close()
    print("\n  (test defect removed)")

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
