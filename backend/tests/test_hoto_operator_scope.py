"""A device token must not read every site's operator register.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
`operators()` took no scope parameter at all and selected every ACTIVE
operator in the company, with names, employee references, plant, department,
competency lists and expiry dates. `sync_bundle()` already held the
authenticated device's plant and was passing it to `assets()` — the operator
query simply never asked for it. So one enrolled, stolen or cloned tablet read
the whole register of every site, while section 5 of the architecture document
stated it could not.

As with the yes/no finding bug, the failure was never in the logic: there was
no logic. So these tests assert at the BUNDLE — what a device is actually
handed — and not on the query, because the query was not wrong either. It was
absent.

Run: python tests/test_hoto_operator_scope.py
"""
import os
import sys

# This worktree's app must win over the production checkout that carries the
# virtualenv; otherwise the test reports on a file nobody edited.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text                                  # noqa: E402
from app.minehub_db import get_minehub_db                    # noqa: E402
from app.services.hoto_masters import operators, sync_bundle  # noqa: E402

ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {name}")
    if not good:
        print(f"        got {got!r}, wanted {want!r}")


db = next(get_minehub_db())
try:
    plants = [r[0] for r in db.execute(text("""
        SELECT DISTINCT plant_id FROM operator
         WHERE profile_status = 'ACTIVE' AND plant_id IS NOT NULL
         ORDER BY 1"""))]
    everyone = operators(db)

    print(f"{len(everyone)} active operators across plants {plants}")

    print("\nscoping to one site")
    if not plants:
        print("  SKIP  no operator has a plant in this database")
    else:
        mine = plants[0]
        scoped = operators(db, plant_id=mine)
        check("a scoped call returns somebody", len(scoped) > 0, True)
        check("and nobody from another site",
              all(o["plant_id"] in (mine, None) for o in scoped), True)
        check("and no more than the unscoped list", len(scoped) <= len(everyone), True)

        other = next((p for p in plants if p != mine), None)
        if other is None:
            print("  SKIP  only one site has operators, so cross-site cannot be shown")
        else:
            theirs = operators(db, plant_id=other)
            mine_ids = {o["operator_id"] for o in scoped}
            cross = [o for o in theirs
                     if o["operator_id"] in mine_ids and o["plant_id"] is not None]
            check("the two sites share only the site-less operators", cross, [])

    print("\nan operator with no site of their own is reachable from anywhere")
    anywhere = [o for o in everyone if o["plant_id"] is None]
    if not anywhere:
        print("  SKIP  no site-less operator in this database")
    elif plants:
        scoped = operators(db, plant_id=plants[0])
        check("a relief driver appears in a scoped list",
              all(a["operator_id"] in {o["operator_id"] for o in scoped}
                  for a in anywhere), True)

    print("\nthe scope actually reaches the bundle — the step that was missing")
    if plants:
        b = sync_bundle(db, plant_id=plants[0])
        check("the bundle's operators are scoped",
              all(o["plant_id"] in (plants[0], None) for o in b["operators"]), True)
        check("and the bundle says so", b["operator_scope"], "plant")

    print("\na device with no site is reported, not silently given everything")
    b = sync_bundle(db, plant_id=None)
    check("the breadth is declared", b["operator_scope"], "UNSCOPED")
    check("and it is still usable rather than empty", len(b["operators"]) > 0, True)
finally:
    db.close()

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
