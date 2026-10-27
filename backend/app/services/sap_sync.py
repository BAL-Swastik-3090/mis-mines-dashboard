"""Carry the SAP rows this mine reads out of balcorpdb and into ours.

WHY. Every production, quality, breakdown and maintenance figure on this
platform comes from a table SAP writes into balcorpdb, and four of the five
carry no index on a date. pp_production is 336,701 rows and 112 MB; 3,381 of
them are this mine's. The single query behind the Production screen takes
1,978 ms to find them, because MySQL reads the whole table to do it.

The index that would end it belongs on SAP's own table in a database
twenty-five applications share, and adding one is not ours to do quietly. So
the rows are mirrored into minehub -- see migration 086 -- and the screens read
them there.

balcorpdb stays the place SAP writes. Nothing writes the mirror but this, and
it can be dropped and rebuilt from the source at any time, which is what an
empty mirror does on its first pass.

── WHAT IS AND IS NOT NORMALISED ───────────────────────────────────────────
Nothing is. The columns keep their SAP names and their SAP values, lower-cased
only because Postgres folds unquoted identifiers that way. This is deliberate:
a query that reads the mirror is the query that read balcorpdb, so the two can
be compared row for row while both exist, and a difference in a figure is a
real difference rather than something this file did on the way across.

Where a value needs interpreting -- the varchar quantities, the negative
issues, the zero-padded material numbers -- that stays in the service that
reads it, as it already does.

── HOW A PASS DECIDES WHAT TO CARRY ────────────────────────────────────────
Each table has a date that moves forward and is the natural watermark. A pass
re-reads a window back from it, because SAP restates: a goods receipt posted
late lands against the day it happened, behind a watermark that has already
moved past it. OVERLAP_DAYS is how far back that reach goes.

pp_quality_inspection is the exception and is carried whole. It has 173,848 of
our rows against 3,381 for production, and a lot is amended in place -- the lab
files Cr2O3 on one day and the Cr/Fe on another against the SAME lot number, so
a row can change without any date in it changing. A watermark cannot see that;
a full upsert can, and 173,848 rows is a few seconds.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MINE_PLANTS = ("1200", "1210")
MAINT_PLANT = "1200"

# A pass every fifteen minutes. SAP posts through the day, and this is about how
# soon a posting shows rather than how fresh any single figure is.
SYNC_SECONDS = 900

# How far back each pass re-reads. A week covers a late posting without making
# every pass a full scan of the source.
OVERLAP_DAYS = 7

# source table -> (date column to watermark on, the predicate that selects the
#                  mine's rows, or None to carry the table whole)
TABLES: dict[str, tuple[str | None, str]] = {
    "pp_production":              ("POSTING_DATE", "PLANT IN :plants"),
    "pp_prod_order_confirmation": ("POSTING_DATE", "PLANT IN :plants"),
    "zpm_iw29_notifications":     ("MALFUNCTION_START", "MAINTENANCE_PLANT = :maint"),
    "mm_plant_maint_calibration": ("BASIC_START_DATE", "PLANT = :maint"),
    # carried whole -- see the note above
    "pp_quality_inspection":      (None, "PLANT IN :plants"),
}


def _columns(pg: Session, table: str) -> list[str]:
    """The mirror's own columns, so a column added to SAP later is ignored
    rather than breaking the insert with a count mismatch."""
    return [r[0] for r in pg.execute(text("""
        SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = :t
           AND column_name <> 'synced_at'
         ORDER BY ordinal_position
    """), {"t": table}).all()]


def _pk(pg: Session, table: str) -> list[str]:
    return [r[0] for r in pg.execute(text("""
        SELECT a.attname
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid
                             AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = (current_schema() || '.' || :t)::regclass
           AND i.indisprimary
    """), {"t": table}).all()]


def _since(pg: Session, table: str, full: bool) -> date:
    if full:
        return date(2000, 1, 1)
    row = pg.execute(text(
        "SELECT watermark FROM sap_sync_state WHERE source_table = :t"),
        {"t": table}).first()
    if not row or not row[0]:
        return date(2000, 1, 1)
    return row[0] - timedelta(days=OVERLAP_DAYS)


def _mark(pg: Session, table: str, watermark, rows: int, error: str | None) -> None:
    pg.execute(text("""
        INSERT INTO sap_sync_state (source_table, watermark, last_run_at,
                                    last_rows, last_error)
        VALUES (:t, :w, now(), :n, :e)
        ON CONFLICT (source_table) DO UPDATE
           SET watermark   = COALESCE(EXCLUDED.watermark, sap_sync_state.watermark),
               last_run_at = EXCLUDED.last_run_at,
               last_rows   = EXCLUDED.last_rows,
               last_error  = EXCLUDED.last_error
    """), {"t": table, "w": watermark, "n": rows, "e": error})


def _sync_table(db: Session, pg: Session, table: str, full: bool) -> int:
    date_col, where = TABLES[table]
    cols = _columns(pg, table)
    pk = _pk(pg, table)
    if not cols or not pk:
        raise RuntimeError(f"{table}: the mirror has no columns or no primary key")

    params: dict = {}
    clauses = [where]
    if ":plants" in where:
        params["plants"] = list(MINE_PLANTS)
    if ":maint" in where:
        params["maint"] = MAINT_PLANT

    since = None
    if date_col:
        since = _since(pg, table, full)
        # A NULL date would be excluded by a plain >= and the row would never
        # arrive; SAP leaves MALFUNCTION_START empty on a notification that has
        # not been given one.
        clauses.append(f"({date_col} >= :since OR {date_col} IS NULL)")
        params["since"] = since

    sql = text(f"SELECT {', '.join(cols)} FROM {table} WHERE {' AND '.join(clauses)}")
    if "plants" in params:
        sql = sql.bindparams(bindparam("plants", expanding=True))
    rows = db.execute(sql, params).mappings().all()

    if rows:
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in pk)
        insert = text(f"""
            INSERT INTO {table} ({', '.join(cols)}, synced_at)
            VALUES ({', '.join(':' + c for c in cols)}, now())
            ON CONFLICT ({', '.join(pk)}) DO UPDATE
               SET {updates}, synced_at = now()
        """)
        # Executemany: one round trip for the batch rather than one per row.
        pg.execute(insert, [dict(r) for r in rows])

    high = None
    if date_col:
        vals = [r[date_col.lower()] for r in rows if r[date_col.lower()]]
        high = max(vals) if vals else since
    _mark(pg, table, high, len(rows), None)
    return len(rows)


def run_once(db: Session, pg: Session, full: bool = False) -> dict:
    """One pass over every mirrored table.

    Each table commits separately, so a failure in one does not roll the others
    back into a gap, and a table SAP has not populated yet cannot stop the rest.
    """
    out: dict = {"tables": {}, "errors": []}
    for table in TABLES:
        try:
            empty = pg.execute(text(
                f"SELECT NOT EXISTS (SELECT 1 FROM {table})")).scalar()
            n = _sync_table(db, pg, table, full or bool(empty))
            pg.commit()
            out["tables"][table] = n
        except Exception as exc:                        # noqa: BLE001
            pg.rollback()
            out["errors"].append(f"{table}: {type(exc).__name__}: {exc}")
            logger.warning("SAP sync failed for %s", table, exc_info=True)
            try:
                _mark(pg, table, None, 0, f"{type(exc).__name__}: {exc}")
                pg.commit()
            except Exception:                           # noqa: BLE001
                pg.rollback()
    return out


def freshness(pg: Session) -> dict:
    """How old the copy is, for a screen to admit to."""
    rows = pg.execute(text(
        "SELECT source_table, last_run_at, last_rows, last_error"
        " FROM sap_sync_state")).mappings().all()
    if not rows:
        return {"ready": False, "seconds_old": None, "error": None}
    oldest = min((r["last_run_at"] for r in rows if r["last_run_at"]), default=None)
    age = None
    if oldest is not None:
        age = pg.execute(text("SELECT EXTRACT(EPOCH FROM (now() - :t))"),
                         {"t": oldest}).scalar()
        age = int(age) if age is not None else None
    return {"ready": True, "seconds_old": age,
            "error": next((r["last_error"] for r in rows if r["last_error"]), None)}
