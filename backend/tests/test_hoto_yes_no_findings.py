"""A yes/no check must be able to report a fault.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
Migration 112 gave every YES_NO item an `adverse_answer`, because some of these
questions are phrased as faults ("Exhaust smoke (excessive)" — YES reports it)
and some as tasks ("Grease points done" — NO reports it). `_evaluate` reads
`item["adverse_answer"]` to tell them apart and has done since the day it was
written.

The column was never selected. `_items_for` listed nine columns and not that
one, so the key was simply absent from every item dict, the branch never fired,
and no yes/no answer could raise anything however it was answered. In the live
data "ROPS / FOPS visible damage" — the rollover protection on a dozer — was
answered YES on seventeen handovers, and the register showed "nothing", no
severity was stored, and no defect was ever raised.

The identical omission had already been found and fixed in the device's own
item query. Fixing one end of a two-ended bug is how it survives, so the last
test here asserts the COLUMN ARRIVES, against the real database. Every test of
`_evaluate` alone passed throughout the entire period the bug was live,
because `_evaluate` was never the broken part.

Run: python tests/test_hoto_yes_no_findings.py
"""
import sys

# THIS worktree's app must win. The production checkout ends up on the path
# because the virtualenv lives there, and importing its hoto_capture would
# test the very code this change is not in — which is how a passing test
# reports on a file nobody edited.
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text                                   # noqa: E402
from app.minehub_db import get_minehub_db                     # noqa: E402
from app.services.hoto_capture import _evaluate_one as _evaluate, _items_for   # noqa: E402

ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {name}")
    if not good:
        print(f"        got {got!r}, wanted {want!r}")


def item(**over):
    base = {
        "item_id": 1, "label": "Exhaust smoke (excessive)",
        "response_type": "YES_NO", "unit": None,
        "min_value": None, "max_value": None,
        "is_critical": False, "requires_photo_if_not_ok": False,
        "default_severity": "MEDIUM", "adverse_answer": "YES",
    }
    base.update(over)
    return base


print("a question phrased as a fault — YES reports it")
check("YES is a finding", _evaluate(item(), {"answer": "YES"})["adverse"], True)
check("and carries the item's severity",
      _evaluate(item(), {"answer": "YES"})["severity"], "MEDIUM")
check("NO is not a finding", _evaluate(item(), {"answer": "NO"})["adverse"], False)
check("and carries no severity",
      _evaluate(item(), {"answer": "NO"})["severity"], None)

print("\na question phrased as a task — NO reports it was not done")
task = item(label="Grease points done", adverse_answer="NO")
check("NO is a finding", _evaluate(task, {"answer": "NO"})["adverse"], True)
check("YES is not", _evaluate(task, {"answer": "YES"})["adverse"], False)

print("\nthe case that was live and silent")
rops = item(label="ROPS / FOPS visible damage", adverse_answer="YES",
            is_critical=True, default_severity="CRITICAL")
ev = _evaluate(rops, {"answer": "YES"})
check("visible damage to rollover protection is a finding", ev["adverse"], True)
check("at the item's severity", ev["severity"], "CRITICAL")
check("and the machine does not go to work", ev["blocks"], True)

print("\nan unclassified yes/no is never guessed at")
for answer in ("YES", "NO"):
    check(f"{answer} on an unclassified item reports nothing",
          _evaluate(item(adverse_answer=None), {"answer": answer})["adverse"], False)

print("\nand the column actually reaches the evaluator")
db = next(get_minehub_db())
try:
    tid = db.execute(text("""
        SELECT s.template_id
          FROM hoto_checklist_item i
          JOIN hoto_checklist_section s ON s.section_id = i.section_id
         WHERE i.response_type = 'YES_NO' AND i.adverse_answer IS NOT NULL
         LIMIT 1""")).scalar()
    if tid is None:
        print("  SKIP  no classified yes/no item in this database")
    else:
        items = _items_for(db, tid)
        yes_no = [i for i in items if i["response_type"] == "YES_NO"]
        check("the template has yes/no items", len(yes_no) > 0, True)
        check("every one arrives with adverse_answer present",
              all("adverse_answer" in i for i in yes_no), True)
        check("and at least one is classified",
              any(i["adverse_answer"] for i in yes_no), True)
finally:
    db.close()

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
