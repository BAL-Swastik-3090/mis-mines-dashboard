"""The two halves of a handover, compared.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
The question a handover exists to answer -- did the person going off and the
person coming on say the same thing about this machine? -- could not be asked
until the server paired the halves (migration 115). The register now asks it,
on every row and in the detail. This files a real pair through the service,
the handover clean and the takeover reporting ROPS damage, and asserts what
the register says about them.

It also asserts the shift reaches the list: that column read a field the list
query never selected, and showed a dash on every row for a day.

Filed against January 2025 and removed afterwards, machine lock included.

Run: python tests/test_hoto_pair_compare.py
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
asset = db.execute(text("SELECT asset_id FROM asset WHERE asset_type_id = :t ORDER BY asset_id LIMIT 1"),
                   {"t": ROPS["asset_type_id"]}).scalar()
items = db.execute(text("""
    SELECT i.item_id, i.response_type, i.min_value, i.max_value, i.adverse_answer
      FROM hoto_checklist_item i
      JOIN hoto_checklist_section s ON s.section_id = i.section_id
      JOIN hoto_checklist_template t ON t.template_id = s.template_id
     WHERE t.asset_type_id = :t AND t.status = 'ACTIVE' AND i.status = 'ACTIVE'"""),
    {"t": ROPS["asset_type_id"]}).mappings().all()
people = [r[0] for r in db.execute(text(
    "SELECT operator_id FROM operator WHERE profile_status = 'ACTIVE' ORDER BY operator_id LIMIT 2"))]


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


def file(kind, at, op, other, faulty):
    answers = [clean(i) for i in items]
    if faulty:
        for a in answers:
            if a["item_id"] == ROPS["item_id"]:
                a.update(answer="YES", remark="crack in the left post", photo_count=1)
    r = cap.submit(db, {
        "client_uuid": str(uuid.uuid4()), "asset_id": asset, "session_type": kind,
        "captured_at": at, "meter_reading": 100, "operator_id": op,
        "counterpart_operator_id": other, "responses": answers,
        "status": "BLOCKED" if faulty else "SUBMITTED"}, "test")
    filed.append(r["session_id"])
    return r


filed: list[int] = []
try:
    end = file("END_HANDOVER", "2025-01-21T13:55:00+05:30", people[0], people[1], False)
    start = file("START_HANDOVER", "2025-01-21T14:05:00+05:30", people[1], people[0], True)

    print("the takeover, compared with the handover it follows")
    c = register.detail(db, start["session_id"])["comparison"]
    check("it is compared", c is not None, True)
    check("every check both answered is compared", c["compared"], len(items))
    check("one disagreement", len(c["differ"]), 1)
    d = c["differ"][0]
    check("it is the ROPS check", d["item_label"], ROPS["label"])
    check("this half found it", (d["this_found"], d["other_found"]), (True, False))
    check("and says what it found", d["this"].startswith("Yes"), True)
    check("worst first, with its severity", d["severity"], "CRITICAL")

    print("\nthe handover, compared the other way round")
    c2 = register.detail(db, end["session_id"])["comparison"]
    check("the same disagreement, from its side", (c2["differ"][0]["this_found"],
                                                   c2["differ"][0]["other_found"]), (False, True))

    print("\nthe list says so on both rows")
    rows = {r["session_id"]: r for r in register.search(db, asset_id=asset, limit=50)}
    for name, sid, other in (("takeover", start["session_id"], end["session_ref"]),
                             ("handover", end["session_id"], start["session_ref"])):
        check(f"the {name} names its other half", rows[sid]["counterpart_ref"], other)
        check(f"the {name} says they disagree on one check", rows[sid]["pair_differs"], 1)
        check(f"the {name} carries its shift", rows[sid]["shift_code"] is not None, True)

    print("\na check with no range is not a disagreement")
    # in_range is NULL on a yes/no or OK/Not OK check. Compared carelessly,
    # NULL is "distinct from" false, and every pair would disagree on every
    # such check. The pair above disagrees on exactly one, so it was not.
    check("only the real difference counted", rows[start["session_id"]]["pair_differs"], 1)
finally:
    if filed:
        db.rollback()
        for sid in filed:
            ev = db.execute(text("""
                SELECT availability_event_id, asset_id, started_at FROM availability_event
                 WHERE reason LIKE :r AND source = 'HOTO' AND ended_at IS NULL"""),
                {"r": f"% from handover {sid}"}).mappings().first()
            if ev:
                db.execute(text("DELETE FROM availability_event WHERE availability_event_id = :e"),
                           {"e": ev["availability_event_id"]})
                db.execute(text("""UPDATE availability_event SET ended_at = NULL, released_by = NULL
                                    WHERE asset_id = :a AND ended_at = :t"""),
                           {"a": ev["asset_id"], "t": ev["started_at"]})
        dids = [x[0] for x in db.execute(text(
            "SELECT defect_id FROM hoto_defect WHERE raised_session_id = ANY(:s)"), {"s": filed})]
        if dids:
            db.execute(text("DELETE FROM hoto_defect_event WHERE defect_id = ANY(:i)"), {"i": dids})
            db.execute(text("DELETE FROM hoto_defect_sighting WHERE defect_id = ANY(:i)"), {"i": dids})
            db.execute(text("DELETE FROM hoto_defect WHERE defect_id = ANY(:i)"), {"i": dids})
        db.execute(text("DELETE FROM hoto_defect_sighting WHERE session_id = ANY(:s)"), {"s": filed})
        db.execute(text("DELETE FROM ops_exception WHERE raised_by = 'test'"))
        db.execute(text("UPDATE hoto_session SET counterpart_session_id = NULL WHERE session_id = ANY(:s)"),
                   {"s": filed})
        db.execute(text("DELETE FROM hoto_response WHERE session_id = ANY(:s)"), {"s": filed})
        db.execute(text("DELETE FROM hoto_session WHERE session_id = ANY(:s)"), {"s": filed})
        db.commit()
        print(f"\n  ({len(filed)} test handovers, {len(dids)} defect(s) and any lock removed)")
    db.close()

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
