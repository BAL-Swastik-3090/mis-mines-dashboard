"""Remove the demo and test data, leaving the reference data intact.

WHY THIS IS A SCRIPT AND NOT A MIGRATION. A migration is something every
environment runs. This is something one database gets once, before real people
start entering real records — and running it anywhere else would delete
somebody's live register. Keeping it out of migrations/ is deliberate.

WHAT GOES

    the eight seeded machines      created_by = 'seed' — TP-01, EX-04 and the
                                   rest, invented to have something on screen
    three machines entered while   asset_ref EQP-2026-0001 to 0003, entered by
    building                       3101 on 17 September while testing the form
    the one test operator          OPR-2026-0002, and the person record behind
    "Sample Contractor (demo)"     what its name says
    the event log                  161 rows, all of them about the rows above

Each of those takes its dependents with it through the foreign keys already
declared: compliance rows, revision trails, competencies, assessments.

WHAT STAYS, AND WHY

    asset_type, lookup, skill      the vocabulary the platform reasons in
    plant, location, org_unit      the mine's own structure
    role, permission, user_access  who can do what — including your own access
    shift_calendar                 A, B, C and GENERAL as this mine runs them
    DASHMESH, SANY, SIDHIVINAYAK   real agencies, loaded by migration 021
    BAL                            the company
    technoton_*                    409,000 rows of real telematics

RUNNING IT

    python minehub/purge_demo_data.py            # says what it would do
    python minehub/purge_demo_data.py --apply    # does it

It counts first and shows you the list either way. Nothing is deleted without
--apply, and a backup was written to minehub/backups/ before this script was
written — restore from there if any of this turns out to have been wanted.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text                                    # noqa: E402

from app.minehub_db import SessionLocal                        # noqa: E402

# Parties that are the mine's real counterparties rather than something typed
# to see whether the form worked. Named rather than derived, because "created
# by a migration" would also protect anything a future migration invents.
KEEP_PARTIES = ("BAL", "DASHMESH", "SANY", "SIDHIVINAYAK")


def main(apply: bool) -> int:
    db = SessionLocal()
    try:
        assets = db.execute(text("""
            SELECT a.asset_id, a.asset_ref, a.fleet_code, a.created_by,
                   t.name AS asset_type
            FROM asset a LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
            ORDER BY a.asset_id
        """)).mappings().all()

        operators = db.execute(text("""
            SELECT o.operator_id, o.operator_ref, p.display_name
            FROM operator o JOIN party p ON p.party_id = o.party_id
            ORDER BY o.operator_id
        """)).mappings().all()

        parties = db.execute(text("""
            SELECT party_id, party_type, display_name
            FROM party WHERE display_name <> ALL(:keep)
            ORDER BY party_id
        """), {"keep": list(KEEP_PARTIES)}).mappings().all()

        events = db.execute(text("SELECT count(*) FROM event")).scalar()

        print(f"\n{len(assets)} machines")
        for a in assets:
            print(f"    {a['asset_ref'] or '—':<16} {a['fleet_code'] or '—':<14} "
                  f"{(a['asset_type'] or 'no type')[:24]:<24} by {a['created_by']}")

        print(f"\n{len(operators)} operators")
        for o in operators:
            print(f"    {o['operator_ref'] or '—':<16} {o['display_name']}")

        print(f"\n{len(parties)} parties (keeping {', '.join(KEEP_PARTIES)})")
        for p in parties:
            print(f"    {p['party_id']:>4} {p['party_type']:<13} {p['display_name']}")

        print(f"\n{events} events")

        if not apply:
            print("\nNothing was deleted. Add --apply to do it.")
            return 0

        # THE ORDER MATTERS, and it is not the obvious one.
        #
        # Three tables reference a machine without a cascade — operator_competency
        # (a machine-level assessment, from migration 022), hoto and deployment —
        # so deleting machines first fails on a foreign key. Deliberately: none
        # of those should ever be silently destroyed by removing a machine.
        #
        # Deleting the operator first resolves it, because operator_competency
        # *does* cascade from the operator side. Then the machines are free, and
        # the parties last, since a machine points at the contractor that owns it.
        #
        # Events go first and on their own. The table is append-only by design,
        # so emptying it is a decision somebody makes rather than something a
        # cascade does quietly on the way past.
        print()
        for label, sql, params in (
            ("events", "DELETE FROM event", {}),
            ("operators", "DELETE FROM operator", {}),
            ("machines", "DELETE FROM asset", {}),
            ("parties", "DELETE FROM party WHERE display_name <> ALL(:keep)",
             {"keep": list(KEEP_PARTIES)}),
        ):
            result = db.execute(text(sql), params)
            print(f"  {label:<12} {result.rowcount} removed")

        # Notes address their subject by a type and an id rather than a foreign
        # key, so nothing cascades them away. Pruning here is what makes that
        # trade affordable — see migration 030.
        orphans = db.execute(text("SELECT prune_orphan_comments()")).scalar()
        if orphans:
            print(f"  {'notes':<12} {orphans} orphaned removed")

        db.commit()

        print("\nWhat is left:")
        for table in ("asset", "asset_compliance", "asset_revision", "operator",
                      "operator_competency", "operator_record", "operator_revision",
                      "event", "party", "asset_type", "lookup", "skill", "plant",
                      "role", "permission", "user_access", "shift_calendar",
                      "roster_pattern", "leave_type", "holiday"):
            count = db.execute(text(f"SELECT count(*) FROM {table}")).scalar()
            print(f"  {table:<24} {count}")

        print("\nReferences restart at 0001 — the counters take one past the "
              "highest that exists, and now nothing does.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
