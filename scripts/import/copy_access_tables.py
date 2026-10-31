"""Copy mines_user_role and mines_role_page_access from MySQL into Postgres.

Migration 091 creates the two tables empty. This fills them, and then proves
they match, because an empty or partial mines_user_role does not degrade
access to the dashboard -- it removes it from everyone, including whoever
would have to put it back.

    python scripts/import/copy_access_tables.py            # check only
    python scripts/import/copy_access_tables.py --write    # copy, then check

Idempotent: rows are upserted on their primary keys, so running it twice is
the same as running it once. It never deletes -- a row that exists in Postgres
and not in MySQL is REPORTED, not removed, because at that point the two
sources disagree about who has access and a script should not pick a winner.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy import text                                    # noqa: E402

from app.database import SessionLocal                          # noqa: E402
from app.minehub_db import SessionLocal as Pg                  # noqa: E402

WRITE = "--write" in sys.argv

ROLE_COLS = ("emp_id", "role", "updated_by", "updated_at")
PAGE_COLS = ("role", "page", "allowed", "updated_by", "updated_at")


def _rows(db, table, cols):
    rows = [dict(r) for r in db.execute(
        text(f"SELECT {', '.join(cols)} FROM {table}")).mappings()]
    # MySQL stores `allowed` as TINYINT(1) and hands back 0/1; the Postgres
    # column is a real BOOLEAN, and psycopg will not quietly coerce one to the
    # other -- it refuses with "column is of type boolean but expression is of
    # type smallint". Cast here so both sides of the comparison below are
    # reading the same kind of value too.
    for r in rows:
        if "allowed" in r and r["allowed"] is not None:
            r["allowed"] = bool(r["allowed"])
    return rows


def _key(table, row):
    return row["emp_id"] if table == "mines_user_role" else (row["role"], row["page"])


def copy(my, pg, table, cols, conflict):
    src = _rows(my, table, cols)
    print(f"\n── {table}: {len(src)} rows in MySQL")
    if not src:
        print("   NOTHING TO COPY. Stopping -- an empty source is far more "
              "likely to be a wrong connection than an empty access list.")
        return False

    if WRITE:
        assign = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in conflict)
        pg.execute(text(
            f"INSERT INTO {table} ({', '.join(cols)}) "
            f"VALUES ({', '.join(':' + c for c in cols)}) "
            f"ON CONFLICT ({', '.join(conflict)}) DO UPDATE SET {assign}"), src)
        pg.commit()
        print(f"   wrote {len(src)} rows")

    dst = _rows(pg, table, cols)
    s = {_key(table, r): r for r in src}
    d = {_key(table, r): r for r in dst}

    missing = sorted(set(s) - set(d), key=str)
    extra = sorted(set(d) - set(s), key=str)
    differ = [k for k in set(s) & set(d)
              if any(str(s[k][c]).strip().lower() != str(d[k][c]).strip().lower()
                     for c in cols if c != "updated_at")]

    print(f"   Postgres now holds {len(dst)} rows")
    for label, keys in (("missing from Postgres", missing),
                        ("in Postgres but NOT in MySQL", extra),
                        ("present in both but different", differ)):
        if keys:
            print(f"   {len(keys)} {label}: {keys[:12]}")
    ok = not (missing or differ)
    print(f"   {'MATCHES' if ok else 'DOES NOT MATCH'}"
          + ("" if not extra else "  (extras are reported, never deleted)"))
    return ok


def main() -> int:
    my, pg = SessionLocal(), Pg()
    try:
        a = copy(my, pg, "mines_user_role", ROLE_COLS, ("emp_id",))
        b = copy(my, pg, "mines_role_page_access", PAGE_COLS, ("role", "page"))
    finally:
        my.close()
        pg.close()

    print()
    if a and b:
        print("Both tables match. Postgres can now answer the access questions.")
        return 0
    if not WRITE:
        print("Check only -- nothing was written. Re-run with --write to copy.")
        return 1
    print("STOP. The copy did not reconcile; do not point login at Postgres.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
