"""Copy the mine's three entry tables from MySQL balcorpdb into minehub.

THIS SCRIPT HAS A FINITE LIFE. balcorpdb is being retired, and when it goes
this goes with it -- it is the last thing in the platform that opens that
instance for these three tables. Until the switch it exists to be run twice:
once to seed, once more after deploying to sweep up whatever the mine entered
in between. Delete it when balcorpdb is gone.

RUN IT AS OFTEN AS YOU LIKE. Every row is an upsert keyed on the table's own
primary key, so a second run changes nothing except rows that have been edited
in MySQL since the first. That is the whole point: the mine types into these
tables every day, so the copy taken before a deployment is stale by the time
the deployment lands. Run it once to seed, deploy, then run it once more to
sweep up whatever was entered in between.

IT IS ONE-WAY AND IT DOES NOT DELETE. A row removed in MySQL is left standing
in minehub rather than being deleted here: this script is not a replication
agent and guessing that an absence means a deletion is how a copy destroys the
thing it was meant to protect. Deletions, if there ever are any, are done by
hand after looking at them.

TIMES ARE READ AS INDIA STANDARD TIME. MySQL stored naive `datetime`, which is
the mine's clock, the server's clock and the application's clock. minehub
stores instants. Interpreting them as UTC instead would move every entry
timestamp five and a half hours and make "who filed this, and when" wrong for
every row.

    python minehub/copy_mine_entries.py            # copy, then verify
    python minehub/copy_mine_entries.py --verify   # verify only, change nothing
"""
from __future__ import annotations

import sys
from datetime import timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text                                   # noqa: E402
from app.database import SessionLocal as MySQLSession         # noqa: E402
from app.minehub_db import SessionLocal as PGSession          # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))

# (table, key columns, all columns in MySQL spelling, same in minehub spelling)
# The previous day's actual is NOT copied: production already moved it, with
# its history, to minehub.prev_day_actual (migration 126), and the screens read
# that table. A second copy here would split the mine's entries in two.
SPECS = (
    ("mines_stock_entry",
     ("stock_date", "grade", "bucket"),
     ("Stock_Date", "Grade", "Bucket", "Qty",
      "Entry_Id", "Entry_Date", "Updated_At", "Updated_By"),
     ("stock_date", "grade", "bucket", "qty",
      "entry_id", "entry_date", "updated_at", "updated_by")),

    ("mines_proposed_despatch",
     ("despatch_date", "destination"),
     ("Despatch_Date", "Destination", "Qty",
      "Entry_Id", "Entry_Date", "Updated_At", "Updated_By"),
     ("despatch_date", "destination", "qty",
      "entry_id", "entry_date", "updated_at", "updated_by")),
)

# Which columns are the naive datetimes that need a timezone attaching.
_TIMES = {"entry_date", "updated_at"}


def _localise(value, column: str):
    if column in _TIMES and value is not None and value.tzinfo is None:
        return value.replace(tzinfo=IST)
    return value


def copy_all(verify_only: bool = False) -> int:
    my, pg = MySQLSession(), PGSession()
    failures = 0
    try:
        for table, keys, my_cols, pg_cols in SPECS:
            rows = my.execute(text(
                f"SELECT {', '.join(my_cols)} FROM {table}")).fetchall()

            if not verify_only:
                setters = ", ".join(f"{c} = EXCLUDED.{c}"
                                    for c in pg_cols if c not in keys)
                stmt = text(f"""
                    INSERT INTO minehub.{table} ({', '.join(pg_cols)})
                    VALUES ({', '.join(':' + c for c in pg_cols)})
                    ON CONFLICT ({', '.join(keys)}) DO UPDATE SET {setters}
                """)
                for r in rows:
                    pg.execute(stmt, {c: _localise(v, c)
                                      for c, v in zip(pg_cols, r)})
                pg.commit()

            # ── verify, always: counts, and every value of every row ───────
            got = pg.execute(text(
                f"SELECT COUNT(*) FROM minehub.{table}")).scalar()
            mine = {tuple(str(_localise(v, c)) for c, v in zip(pg_cols, r))
                    for r in rows}
            theirs = {tuple(str(v) for v in r) for r in pg.execute(text(
                f"SELECT {', '.join(pg_cols)} FROM minehub.{table}"))}
            missing = mine - theirs
            status = "OK" if not missing else f"<<< {len(missing)} NOT COPIED"
            print(f"   {table:26} MySQL {len(rows):5}  minehub {got:5}  {status}")
            for m in list(missing)[:3]:
                print(f"      missing: {m[:3]}")
            if missing:
                failures += 1
            extra = got - len(rows)
            if extra > 0:
                print(f"      note: minehub holds {extra} row(s) MySQL does "
                      f"not. Nothing is deleted here -- check by hand.")
    finally:
        my.close()
        pg.close()
    return failures


if __name__ == "__main__":
    only = "--verify" in sys.argv
    print("VERIFYING ONLY, nothing will be written" if only
          else "COPYING balcorpdb -> minehub (upsert, no deletes)")
    bad = copy_all(only)
    print("\nall three tables match" if not bad
          else f"\n{bad} table(s) did NOT fully copy -- see above")
    sys.exit(1 if bad else 0)
