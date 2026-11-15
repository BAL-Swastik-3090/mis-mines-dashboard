"""A handover names everyone in it, and finds its other half.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
The record had room for one person. The operator's employee number went into
operator_emp_id AND confirmed_by, so the person going off shift, the person
coming on, and whoever held the tablet were all one name -- and the first
question asked of a disputed handover, "who said this machine was fine?",
had no answer. counterpart_session_id existed from migration 106 and was
never set by anything.

Asserted THROUGH THE REAL SERVICE against the dev database, because the
failure this replaces was never in a calculation: a column nobody wrote and a
link nobody made. A unit test of a helper would have passed throughout.

Every handover this files is dated January 2025, far from real records, and
is removed afterwards along with anything it raised.

Run: python tests/test_hoto_people.py
"""
import copy
import os
import sys
import uuid

# This worktree's app must win over the production checkout that carries the
# virtualenv, or the test reports on a file nobody edited.
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
filed: list[int] = []

asset = db.execute(text("""
    SELECT a.asset_id, at.asset_type_id FROM asset a
      JOIN asset_type at ON at.asset_type_id = a.asset_type_id
      JOIN hoto_checklist_template t ON t.asset_type_id = at.asset_type_id
     WHERE t.status = 'ACTIVE' ORDER BY a.asset_id LIMIT 1""")).mappings().first()

items = db.execute(text("""
    SELECT i.item_id, i.response_type, i.min_value, i.max_value, i.adverse_answer
      FROM hoto_checklist_item i
      JOIN hoto_checklist_section s ON s.section_id = i.section_id
      JOIN hoto_checklist_template t ON t.template_id = s.template_id
     WHERE t.asset_type_id = :at AND t.status = 'ACTIVE' AND i.status = 'ACTIVE'
"""), {"at": asset["asset_type_id"]}).mappings().all()

people = [r[0] for r in db.execute(text("""
    SELECT operator_id FROM operator WHERE profile_status = 'ACTIVE'
     ORDER BY operator_id LIMIT 6"""))]
A, B, C, D, E, F = people


def clean(i):
    """Every check answered the way a sound machine reads, so nothing is raised."""
    rt = i["response_type"]
    if rt == "NUMERIC":
        lo, hi = i["min_value"], i["max_value"]
        mid = (float(lo) + float(hi)) / 2 if lo is not None and hi is not None else 1
        return {"item_id": i["item_id"], "numeric_value": mid}
    if rt == "YES_NO":
        return {"item_id": i["item_id"],
                "answer": "NO" if (i["adverse_answer"] or "YES") == "YES" else "YES"}
    if rt == "LEVEL":
        return {"item_id": i["item_id"], "answer": "NORMAL"}
    return {"item_id": i["item_id"], "answer": "OK"}


ANSWERS = [clean(i) for i in items]


def file(kind, at, operator, **people_in_it):
    payload = {
        "client_uuid": str(uuid.uuid4()), "asset_id": asset["asset_id"],
        "session_type": kind, "captured_at": at, "meter_reading": 100,
        "operator_id": operator, "status": "SUBMITTED",
        "responses": copy.deepcopy(ANSWERS), **people_in_it,
    }
    r = cap.submit(db, payload, "test")
    filed.append(r["session_id"])
    if r.get("defects_raised"):
        raise RuntimeError("a clean walk-round raised a defect; the test would leave it behind")
    return r


def row(session_id):
    return db.execute(text("""
        SELECT counterpart_session_id, counterpart_operator_id, counterpart_absent,
               recorded_by_operator_id
          FROM hoto_session WHERE session_id = :s"""), {"s": session_id}).mappings().first()


try:
    print("the people are stored as given")
    r = file("START_HANDOVER", "2025-01-06T06:05:00+05:30", A,
             counterpart_operator_id=B, recorded_by_operator_id=F)
    got = row(r["session_id"])
    check("the other side", got["counterpart_operator_id"], B)
    check("who filled it in", got["recorded_by_operator_id"], F)
    check("not stated absent", got["counterpart_absent"], False)

    r = file("START_HANDOVER", "2025-01-06T09:00:00+05:30", A, counterpart_absent=True,
             recorded_by_operator_id=A)
    got = row(r["session_id"])
    check("nobody on the other side, stated", got["counterpart_absent"], True)
    check("and nobody named", got["counterpart_operator_id"], None)

    r = file("START_HANDOVER", "2025-01-06T11:00:00+05:30", A)
    got = row(r["session_id"])
    check("an older tablet's record says NOT RECORDED, not 'nobody'",
          (got["counterpart_operator_id"], got["counterpart_absent"]), (None, False))
    check("and does not invent who filled it in", got["recorded_by_operator_id"], None)

    print("\ncontradictions are refused in words, not as a database error")
    for name, kind, extra in [
        ("named AND stated absent", "START_HANDOVER",
         {"counterpart_operator_id": B, "counterpart_absent": True}),
        ("a mid-shift check naming another side", "MID_SHIFT",
         {"counterpart_operator_id": B}),
        ("a mid-shift check stating one absent", "MID_SHIFT",
         {"counterpart_absent": True}),
        # Not a person, but the same failure: left to the CHECK constraint it
        # was a 500, retried by the tablet on every sync for ever.
        ("fuel above 100 per cent", "START_HANDOVER", {"fuel_level": 150}),
        ("fuel that is not a number", "START_HANDOVER", {"fuel_level": "full"}),
    ]:
        try:
            file(kind, "2025-01-06T12:00:00+05:30", A, **extra)
            check(name, "accepted", "refused")
        except cap.CaptureError:
            check(name, "refused", "refused")

    print("\nthe two halves find each other")
    end = file("END_HANDOVER", "2025-01-07T13:55:00+05:30", A, counterpart_operator_id=B)
    start = file("START_HANDOVER", "2025-01-07T14:05:00+05:30", B, counterpart_operator_id=A)
    check("the takeover points at the handover",
          row(start["session_id"])["counterpart_session_id"], end["session_id"])
    check("and the handover back at the takeover",
          row(end["session_id"])["counterpart_session_id"], start["session_id"])
    check("the filing says so", start["paired_with"], end["session_ref"])
    check("and that the names agree", start["names_disagree"], False)

    # Tablets reach a signal in any order. The takeover arrives first here.
    start2 = file("START_HANDOVER", "2025-01-07T22:05:00+05:30", D, counterpart_operator_id=C)
    check("a takeover filed before its handover waits unpaired",
          row(start2["session_id"])["counterpart_session_id"], None)
    end2 = file("END_HANDOVER", "2025-01-07T21:58:00+05:30", C, counterpart_operator_id=D)
    check("and is paired when the handover arrives",
          row(start2["session_id"])["counterpart_session_id"], end2["session_id"])

    print("\nwhen the names disagree it is still paired, and raised")
    end3 = file("END_HANDOVER", "2025-01-08T06:00:00+05:30", A, counterpart_operator_id=B)
    start3 = file("START_HANDOVER", "2025-01-08T06:10:00+05:30", E, counterpart_operator_id=A)
    check("paired", row(start3["session_id"])["counterpart_session_id"], end3["session_id"])
    check("flagged", start3["names_disagree"], True)
    lo, hi = sorted((end3["session_id"], start3["session_id"]))
    raised = db.execute(text("""SELECT count(*) FROM ops_exception
                                 WHERE dedupe_key = :k AND kind = 'HOTO_COUNTERPART_MISMATCH'"""),
                        {"k": f"pair:{lo}:{hi}"}).scalar()
    check("raised for a supervisor", raised, 1)

    print("\nthe name is better evidence than the clock")
    named = file("END_HANDOVER", "2025-01-09T13:40:00+05:30", C)
    nearer = file("END_HANDOVER", "2025-01-09T13:58:00+05:30", D)
    taker = file("START_HANDOVER", "2025-01-09T14:00:00+05:30", E, counterpart_operator_id=C)
    check("paired with the person it names, not the nearer one",
          row(taker["session_id"])["counterpart_session_id"], named["session_id"])
    check("the nearer one is left for its own takeover",
          row(nearer["session_id"])["counterpart_session_id"], None)

    print("\na machine that stood idle is not a handover")
    file("END_HANDOVER", "2025-01-10T08:00:00+05:30", A)
    late = file("START_HANDOVER", "2025-01-10T13:30:00+05:30", B)
    check("five and a half hours apart: not paired", late["paired_with"], None)

    print("\na mid-shift check is never paired")
    file("END_HANDOVER", "2025-01-11T10:00:00+05:30", A)
    mid = file("MID_SHIFT", "2025-01-11T10:05:00+05:30", B)
    check("not paired", mid["paired_with"], None)

    print("\nthe register shows the names")
    d = register.detail(db, start["session_id"])
    check("the other side by name", d["counterpart_name"] is not None, True)
    check("the paired half's reference", d["counterpart_ref"], end["session_ref"])
    check("who filed the other half",
          d["counterpart_session_operator_name"] is not None, True)
finally:
    if filed:
        db.rollback()
        db.execute(text("DELETE FROM ops_exception WHERE dedupe_key LIKE 'pair:%' "
                        "AND raised_by = 'test'"))
        db.execute(text("UPDATE hoto_session SET counterpart_session_id = NULL "
                        "WHERE session_id = ANY(:s)"), {"s": filed})
        db.execute(text("DELETE FROM hoto_response WHERE session_id = ANY(:s)"), {"s": filed})
        db.execute(text("DELETE FROM hoto_session WHERE session_id = ANY(:s)"), {"s": filed})
        db.commit()
        print(f"\n  ({len(filed)} test handovers removed)")
    db.close()

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
