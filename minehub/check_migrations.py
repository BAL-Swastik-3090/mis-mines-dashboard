#!/usr/bin/env python3
"""Name every table that is live in minehub but declared in no migration.

Development and production share one database here, so a table created by
hand works perfectly and announces nothing. This is the thing that notices.

Partitions are not counted: a partitioned table's children are created by the
migration that declares the parent, so they are declared by definition.

    python minehub/check_migrations.py          # exits 1 if anything is undeclared
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent / "migrations"
DECLARED = re.compile(
    r"""CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(?:minehub\.)?["']?([a-z_0-9]+)""",
    re.IGNORECASE,
)


def declared_tables() -> set[str]:
    found: set[str] = set()
    for sql in sorted(MIGRATIONS.glob("*.sql")):
        found |= {m.lower() for m in DECLARED.findall(sql.read_text(encoding="utf-8"))}
    return found


def live_tables() -> list[tuple[str, int]]:
    """Every non-partition table in minehub, with its row count."""
    # Run from the repo, or from inside the backend container where the
    # package is already installed at /app. Try both rather than assuming.
    for candidate in (Path(__file__).resolve().parent.parent / "backend",
                      Path.cwd(), Path("/app")):
        if (candidate / "app" / "minehub_db.py").is_file():
            sys.path.insert(0, str(candidate))
            break

    from sqlalchemy import text                      # noqa: PLC0415
    try:
        from app.minehub_db import SessionLocal      # noqa: PLC0415
    except ModuleNotFoundError:
        sys.exit("Run this from the repository root, or inside the backend "
                 "container: docker compose exec backend python "
                 "/path/to/check_migrations.py")

    if SessionLocal is None:
        sys.exit("minehub is not configured (PG_HOST / PG_DATABASE / PG_USER).")

    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT c.relname,
                   (SELECT n_live_tup FROM pg_stat_user_tables s
                     WHERE s.relid = c.oid)
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'minehub'
               AND c.relkind IN ('r', 'p')
               -- a partition is declared by whatever declared its parent
               AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid)
             ORDER BY 1
        """)).all()
        return [(r[0], r[1] or 0) for r in rows]
    finally:
        db.close()


def main() -> int:
    declared = declared_tables()
    missing = [(t, n) for t, n in live_tables() if t.lower() not in declared]

    if not missing:
        print(f"All {len(declared)} declared — every live table has a migration.")
        return 0

    width = max(len(t) for t, _ in missing)
    print(f"{len(missing)} table(s) live in minehub with no CREATE TABLE in "
          f"minehub/migrations/:\n")
    for t, n in missing:
        print(f"  {t:<{width}}  ~{n:,} rows")
    print("\nWrite the migration before opening the branch. Build it into a "
          "throwaway\nschema inside a transaction and compare it to minehub "
          "before trusting it —\na definition recovered from a live database "
          "is a guess until it is proved.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
