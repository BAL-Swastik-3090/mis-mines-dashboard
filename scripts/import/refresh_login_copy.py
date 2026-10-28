"""Refresh the Postgres copy of intranet_user_login from MySQL.

Login now authenticates against balcorpdb.intranet_user_login in Postgres.
That table is a MIRROR, and when the switch was made it had stopped being
updated on 26 October -- its newest password change was the 23rd.

A frozen credentials mirror does not fail loudly. It fails one person at a
time: someone changes their intranet password, that change never arrives, and
they are told their password is wrong. They will not report it as a sync
problem, because from where they are standing it is not one.

So this exists, and it should run on a schedule rather than by hand.

    python scripts/import/refresh_login_copy.py             # report the drift
    python scripts/import/refresh_login_copy.py --write     # copy, then report

It upserts on empid and NEVER deletes. A row that is in Postgres and not in
MySQL is reported: removing it would revoke somebody's access on the strength
of one query against a database that, the day this was written, was refusing
connections entirely.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy import text                                    # noqa: E402

from app.database import SessionLocal                          # noqa: E402
from app.minehub_db import SessionLocal as Pg                  # noqa: E402

WRITE = "--write" in sys.argv
PG_TBL = "balcorpdb.intranet_user_login"
COLS = ("empid", "user_pwd", "status", "creation_date", "update_date")


def main() -> int:
    my, pg = SessionLocal(), Pg()
    try:
        src = [dict(r) for r in my.execute(text(
            "SELECT EMPID AS empid, USER_PWD AS user_pwd, STATUS AS status, "
            "CREATION_DATE AS creation_date, UPDATE_DATE AS update_date "
            "FROM intranet_user_login")).mappings()]
        print(f"MySQL holds {len(src):,} login rows")
        if not src:
            print("EMPTY SOURCE -- stopping. Far more likely a wrong "
                  "connection than an intranet with nobody in it.")
            return 1

        before = pg.execute(text(f"SELECT COUNT(*) FROM {PG_TBL}")).scalar()

        if WRITE:
            pg.execute(text(
                f"INSERT INTO {PG_TBL} ({', '.join(COLS)}) "
                f"VALUES ({', '.join(':' + c for c in COLS)}) "
                "ON CONFLICT (empid) DO UPDATE SET "
                "user_pwd = EXCLUDED.user_pwd, status = EXCLUDED.status, "
                "update_date = EXCLUDED.update_date"), src)
            pg.commit()

        dst = {r["empid"]: r for r in pg.execute(text(
            f"SELECT {', '.join(COLS)} FROM {PG_TBL}")).mappings()}
        s = {r["empid"]: r for r in src}

        missing = sorted(set(s) - set(dst))
        extra = sorted(set(dst) - set(s))
        # The two that decide whether someone can sign in.
        differ = [k for k in set(s) & set(dst)
                  if (str(s[k]["user_pwd"] or "").lower()
                      != str(dst[k]["user_pwd"] or "").lower()
                      or str(s[k]["status"] or "").upper()
                      != str(dst[k]["status"] or "").upper())]

        print(f"Postgres held {before:,} rows, now holds {len(dst):,}")
        if missing:
            print(f"  {len(missing)} in MySQL but NOT in Postgres "
                  f"-- these people cannot sign in: {missing[:15]}")
        if differ:
            print(f"  {len(differ)} whose password or status differs "
                  f"-- stale credentials: {differ[:15]}")
        if extra:
            print(f"  {len(extra)} in Postgres but not in MySQL "
                  f"(reported, never deleted): {extra[:15]}")
        if not (missing or differ):
            print("  The copy matches MySQL. Nobody is locked out by drift.")
            return 0
        if not WRITE:
            print("\nReport only -- nothing written. Re-run with --write.")
        return 1
    finally:
        my.close()
        pg.close()


if __name__ == "__main__":
    raise SystemExit(main())
