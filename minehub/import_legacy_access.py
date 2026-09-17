"""Move access from the legacy MySQL role table into minehub.user_access.

Idempotent: re-running changes nothing that is already correct.

The old role names map onto the new ones as follows. The mapping preserves
access exactly — nobody gains or loses anything by running this:

    superadmin -> PLATFORM_OWNER     full control, including the registry
    admin      -> ACCESS_MANAGER     grants access, manages roles
    manager    -> DASHBOARD_VIEWER   'manager' carried no permission the viewer
                                     role lacked; it only looked like seniority,
                                     and collided with six job titles containing
                                     the word Manager
    viewer     -> DASHBOARD_VIEWER

Run:  python minehub/import_legacy_access.py [--apply]

Without --apply it reports what it would do and writes nothing.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text                      # noqa: E402
from app.database import engine as mysql_engine  # noqa: E402
from app.minehub_db import engine as pg_engine   # noqa: E402

ROLE_MAP = {
    "superadmin": "PLATFORM_OWNER",
    "admin": "ACCESS_MANAGER",
    "manager": "DASHBOARD_VIEWER",
    "viewer": "DASHBOARD_VIEWER",
}


def main() -> int:
    apply = "--apply" in sys.argv

    with mysql_engine.connect() as m:
        legacy = m.execute(text(
            "SELECT emp_id, role, updated_by FROM mines_user_role ORDER BY emp_id"
        )).mappings().all()
    print(f"legacy rows: {len(legacy)}")

    with pg_engine.connect() as p:
        roles = {r[0]: r[1] for r in p.execute(text(
            "SELECT code, role_id FROM role")).all()}
        existing = {(r[0], r[1]) for r in p.execute(text(
            "SELECT emp_id, role_id FROM user_access WHERE valid_to IS NULL")).all()}

    planned, skipped = [], 0
    for row in legacy:
        target = ROLE_MAP.get(row["role"])
        if not target:
            print(f"  ! unknown legacy role {row['role']!r} for {row['emp_id']} — skipped")
            continue
        role_id = roles.get(target)
        if not role_id:
            print(f"  ! role {target} missing in minehub — run migration 002 first")
            return 1
        if (row["emp_id"], role_id) in existing:
            skipped += 1
            continue
        planned.append((row["emp_id"], role_id, target, row["role"], row["updated_by"]))

    print(f"already present: {skipped}")
    print(f"to import:       {len(planned)}")
    for emp, _rid, target, old, _by in planned:
        print(f"    {emp:<9} {old:<11} -> {target}")

    if not planned:
        print("nothing to do")
        return 0
    if not apply:
        print("\ndry run — pass --apply to write")
        return 0

    with pg_engine.begin() as p:
        for emp, role_id, _t, _o, by in planned:
            p.execute(text("""
                INSERT INTO user_access (emp_id, role_id, granted_by)
                VALUES (:e, :r, :by)
                ON CONFLICT (emp_id, role_id) DO NOTHING
            """), {"e": emp, "r": role_id, "by": by or "LEGACY_IMPORT"})
    print(f"\nimported {len(planned)} grants")

    with pg_engine.connect() as p:
        for r in p.execute(text("""
            SELECT ro.name, count(*) FROM user_access ua
            JOIN role ro ON ro.role_id = ua.role_id
            WHERE ua.valid_to IS NULL GROUP BY ro.name ORDER BY 2 DESC
        """)).all():
            print(f"  {r[0]:<20} {r[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
