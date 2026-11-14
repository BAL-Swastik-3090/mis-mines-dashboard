"""A yes/no fault must reach the workshop, not just the verdict.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
On 13 Nov the server's evaluator was taught that "ROPS / FOPS visible damage
-- YES" is a fault (it never selected adverse_answer). The test for that fix
asserted on the evaluator. It passed. But three other places decide what a
fault is with their own copy of the old rule:

    r.answer IN ('NOT_OK', 'CAUTION') OR r.in_range = false

-- defect raising, the register's fault count, and the register's detail. So
after the fix a tablet reporting ROPS damage got a handover marked BLOCKED,
with no defect raised, the machine not locked, and the register showing no
fault. Worse than before: the record looked handled.

The rule is now one thing, stored at capture: an answer is a fault when it has
a severity, which the evaluator sets on a fault and only on a fault. This test
drives a real filing end to end and asserts at every place a fault has to
arrive, because asserting on the evaluator is how this was missed.

Filed against January 2025 and removed afterwards -- including the machine
lock, which deleting a handover does not undo by itself.

Run: python tests/test_hoto_yes_no_defects.py
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text                                   # noqa: E402
from app.minehub_db import get_minehub_db                     # noqa: E402
from app.services import hoto_capture as cap                  # noqa: E402
from app.services import hoto_register as register            # noqa: E402

ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {name}")
    if not good:
        print(f"        got {got!r}, wanted {want!r}")


db = next(get_minehub_db())

ROPS = db.execute(text("""
    SELECT i.item_id, i.label, t.asset_type_id FROM hoto_checklist_item i
      JOIN hoto_checklist_section s ON s.section_id = i.section_id
      JOIN hoto_checklist_template t ON t.template_id = s.template_id
     WHERE i.response_type = 'YES_NO' AND i.is_critical AND i.adverse_answer = 'YES'
       AND i.status = 'ACTIVE' AND t.status = 'ACTIVE'
     ORDER BY i.item_id LIMIT 1""")).mappings().first()
asset = db.execute(text("""
    SELECT a.asset_id, a.fleet_code FROM asset a
     WHERE a.asset_type_id = :t ORDER BY a.asset_id LIMIT 1"""),
    {"t": ROPS["asset_type_id"]}).mappings().first()
items = db.execute(text("""
    SELECT i.item_id, i.response_type, i.min_value, i.max_value, i.adverse_answer
      FROM hoto_checklist_item i
      JOIN hoto_checklist_section s ON s.section_id = i.section_id
      JOIN hoto_checklist_template t ON t.template_id = s.template_id
     WHERE t.asset_type_id = :t AND t.status = 'ACTIVE' AND i.status = 'ACTIVE'"""),
    {"t": ROPS["asset_type_id"]}).mappings().all()


def clean(i):
    rt = i["response_type"]
    if rt == "NUMERIC":
        lo, hi = i["min_value"], i["max_value"]
        return {"item_id": i["item_id"],
                "numeric_value": (float(lo) + float(hi)) / 2 if lo is not None and hi is not None else 1}
    if rt == "YES_NO":
        return {"item_id": i["item_id"],
                "answer": "NO" if (i["adverse_answer"] or "YES") == "YES" else "YES"}
    if rt == "LEVEL":
        return {"item_id": i["item_id"], "answer": "NORMAL"}
    return {"item_id": i["item_id"], "answer": "OK"}


answers = [clean(i) for i in items]
for a in answers:
    if a["item_id"] == ROPS["item_id"]:
        a.update(answer="YES", remark="crack in the left ROPS post", photo_count=1)

print(f"{ROPS['label']} answered YES on {asset['fleet_code']}")
session_id = None
try:
    r = cap.submit(db, {
        "client_uuid": str(uuid.uuid4()), "asset_id": asset["asset_id"],
        "session_type": "START_HANDOVER", "captured_at": "2025-01-20T06:10:00+05:30",
        "meter_reading": 100, "status": "BLOCKED", "responses": answers,
    }, "test")
    session_id = r["session_id"]

    print("\nthe verdict (fixed 13 Nov)")
    check("the machine does not change hands", r["status"], "BLOCKED")

    print("\nthe workshop is told")
    raised = [d["item"] for d in r["defects_raised"]]
    check("a defect is raised for it", ROPS["label"] in raised, True)
    check("the machine is locked", (r["machine_state_change"] or {}).get("to"), "LOCKED")

    print("\nthe register shows it")
    stored = db.execute(text("""SELECT severity FROM hoto_response
                                 WHERE session_id = :s AND item_id = :i"""),
                        {"s": session_id, "i": ROPS["item_id"]}).scalar()
    check("the answer is stored with its severity", stored, "CRITICAL")
    row = next(x for x in register.search(db, asset_id=asset["asset_id"],
                                          from_date=None, to_date=None, limit=50)
               if x["session_id"] == session_id)
    check("the list counts it as a fault", row["adverse_count"] >= 1, True)
    check("the list gives its severity", row["worst_severity"], "CRITICAL")
    only = [x["session_id"] for x in register.search(db, asset_id=asset["asset_id"],
                                                      only_adverse=True, limit=50)]
    check("'only with faults' includes it", session_id in only, True)
    d = register.detail(db, session_id)
    check("the detail lists it among the faults",
          ROPS["label"] in [a["item_label"] for a in d["adverse"]], True)
finally:
    if session_id:
        db.rollback()
        # The lock: delete the window this filing opened and reopen the one it
        # closed, or the machine stays locked by a record that is gone.
        ev = db.execute(text("""
            SELECT availability_event_id, asset_id, started_at FROM availability_event
             WHERE reason LIKE :r AND source = 'HOTO' AND ended_at IS NULL"""),
            {"r": f"% from handover {session_id}"}).mappings().first()
        if ev:
            db.execute(text("DELETE FROM availability_event WHERE availability_event_id = :e"),
                       {"e": ev["availability_event_id"]})
            db.execute(text("""UPDATE availability_event SET ended_at = NULL, released_by = NULL
                                WHERE asset_id = :a AND ended_at = :t"""),
                       {"a": ev["asset_id"], "t": ev["started_at"]})
        dids = [x[0] for x in db.execute(text(
            "SELECT defect_id FROM hoto_defect WHERE raised_session_id = :s"), {"s": session_id})]
        if dids:
            db.execute(text("DELETE FROM hoto_defect_event WHERE defect_id = ANY(:i)"), {"i": dids})
            db.execute(text("DELETE FROM hoto_defect_sighting WHERE defect_id = ANY(:i)"), {"i": dids})
            db.execute(text("DELETE FROM hoto_defect WHERE defect_id = ANY(:i)"), {"i": dids})
        db.execute(text("DELETE FROM hoto_defect_sighting WHERE session_id = :s"), {"s": session_id})
        db.execute(text("DELETE FROM hoto_response WHERE session_id = :s"), {"s": session_id})
        db.execute(text("DELETE FROM hoto_session WHERE session_id = :s"), {"s": session_id})
        db.commit()
        print(f"\n  (test handover, {len(dids)} defect(s) and the machine lock removed)")
    db.close()

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
