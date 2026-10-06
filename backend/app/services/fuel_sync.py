"""Carry the fuel rows out of the shared SAP tables and into ours.

WHY. scm_zmm_stock_mb5b holds 4,130,084 rows across every material and plant;
the fuel at our four plants is 2,068 of them. Its index is (plant,
report_date) and matgroup is not in it, so a thirty-day window reads 635,937
rows to find a few dozen. The index that would fix that belongs on a 1.1 GB
table in a database twenty-five applications share.

So the rows are mirrored into minehub -- see migration 081 -- and the screen
reads them there. balcorpdb stays the place SAP writes; this can be dropped
and rebuilt from it at any time, which is what an empty mirror does on its
first pass.

── WHAT IS NORMALISED ON THE WAY ACROSS ────────────────────────────────────
Each of these has bitten somebody reading the source directly, so each is
done once, here, rather than in every query:

  material numbers lose their padding -- 000000000012000004 becomes 12000004,
  because the purchase-order table stores it the short way and a join on the
  padded form silently matches nothing;

  issues become POSITIVE. SAP keeps them negative in a varchar with the sign
  on the front, '-10409.0', so a reader who casts gets a negative burn rate,
  which looks like stock growing by itself;

  plant becomes text. MySQL returns it as an integer and the codes are
  written as strings everywhere else, so a comparison in Python quietly
  matches nothing at all.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# The plants the mine's management looks at, and SAP's own group for fuels.
PLANTS = ("1200", "1110", "1100", "1210")
FUEL_GROUP = "1046"

# How often a pass runs. SAP posts one snapshot a day, so this is about how
# soon a new day shows rather than how fresh any figure is.
SYNC_SECONDS = 900

# How far back each pass re-reads. A day's row can be restated after it is
# first written -- a late goods receipt posts against the day it arrived -- so
# a watermark that only ever moved forward would keep the first version.
OVERLAP_DAYS = 7


def _f(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _since(pg: Session, full: bool) -> date:
    if full:
        return date(2000, 1, 1)
    row = pg.execute(text(
        "SELECT watermark FROM fuel_sync_state WHERE source_table = 'mb5b'")).first()
    if not row or not row[0]:
        return date(2000, 1, 1)
    return row[0] - timedelta(days=OVERLAP_DAYS)


def _mark(pg: Session, table: str, watermark, rows: int, error: str | None) -> None:
    pg.execute(text("""
        INSERT INTO fuel_sync_state (source_table, watermark, last_run_at,
                                     last_rows, last_error)
        VALUES (:t, :w, now(), :n, :e)
        ON CONFLICT (source_table) DO UPDATE
           SET watermark   = COALESCE(EXCLUDED.watermark, fuel_sync_state.watermark),
               last_run_at = EXCLUDED.last_run_at,
               last_rows   = EXCLUDED.last_rows,
               last_error  = EXCLUDED.last_error
    """), {"t": table, "w": watermark, "n": rows, "e": error})


def _sync_stock(db: Session, pg: Session, full: bool) -> int:
    since = _since(pg, full)
    rows = db.execute(text("""
        SELECT report_date,
               CAST(plant AS CHAR) AS plant,
               TRIM(LEADING '0' FROM material) AS material,
               MAX(matdesc)       AS description,
               SUM(openstock)     AS opening,
               SUM(totreceiptqty) AS received,
               SUM(ABS(CAST(totissueqty AS DECIMAL(18,3)))) AS issued,
               SUM(closingstock)  AS closing,
               SUM(closingvalue)  AS closing_value,
               SUM(receiptvalue)  AS received_value,
               MAX(unit)          AS unit
          FROM scm_zmm_stock_mb5b
         WHERE matgroup = :grp
           AND plant IN :plants
           AND report_date >= :since
         GROUP BY report_date, CAST(plant AS CHAR), TRIM(LEADING '0' FROM material)
    """).bindparams(bindparam("plants", expanding=True)),
        {"grp": FUEL_GROUP, "plants": [int(p) for p in PLANTS],
         "since": since}).mappings().all()

    for r in rows:
        pg.execute(text("""
            INSERT INTO fuel_stock_snapshot (
                report_date, plant, material, description, opening_l,
                received_l, issued_l, closing_l, closing_value,
                received_value, unit, synced_at)
            VALUES (:d, :p, :m, :desc, :open, :recv, :iss, :close, :cval,
                    :rval, :unit, now())
            ON CONFLICT (report_date, plant, material) DO UPDATE SET
                description = EXCLUDED.description,
                opening_l = EXCLUDED.opening_l, received_l = EXCLUDED.received_l,
                issued_l = EXCLUDED.issued_l, closing_l = EXCLUDED.closing_l,
                closing_value = EXCLUDED.closing_value,
                received_value = EXCLUDED.received_value,
                unit = EXCLUDED.unit, synced_at = now()
        """), {"d": r["report_date"], "p": r["plant"], "m": r["material"],
               "desc": (r["description"] or "").strip() or None,
               "open": _f(r["opening"]), "recv": _f(r["received"]),
               "iss": _f(r["issued"]), "close": _f(r["closing"]),
               "cval": _f(r["closing_value"]), "rval": _f(r["received_value"]),
               "unit": r["unit"]})

    high = max((r["report_date"] for r in rows), default=None)
    _mark(pg, "mb5b", high, len(rows), None)
    return len(rows)


def _sync_orders(db: Session, pg: Session) -> int:
    """Replaced whole: a line completed in SAP must disappear here.

    Working out which of a hundred lines vanished is more code than writing
    the current hundred again, and more ways to be wrong.
    """
    mats = [r[0] for r in pg.execute(text(
        "SELECT DISTINCT material FROM fuel_stock_snapshot")).all()]
    if not mats:
        return 0

    rows = db.execute(text("""
        SELECT PO_NO AS po, ITEM_NO AS item,
               CAST(PLANT AS CHAR) AS plant,
               TRIM(LEADING '0' FROM MATERIAL_NO) AS material,
               VENDOR_NAME AS vendor, QUANTITY AS ordered,
               CAST(STILL_DEL_QTY AS DECIMAL(18,3)) AS pending,
               GR_QTY AS received, UNIT AS unit,
               ITEM_DEL_DATE AS due, GOODS_RECEIPT_DATE AS gr
          FROM scm_purchase_order
         WHERE CAST(PLANT AS UNSIGNED) IN :plants
           AND TRIM(LEADING '0' FROM MATERIAL_NO) IN :mats
           AND COALESCE(DELETE_INDICATOR, '') = ''
    """).bindparams(bindparam("plants", expanding=True),
                    bindparam("mats", expanding=True)),
        {"plants": [int(p) for p in PLANTS], "mats": mats}).mappings().all()

    def _d(v) -> date | None:
        s = str(v or "").replace("-", "").strip()
        if len(s) != 8 or not s.isdigit():
            return None
        try:
            return date(int(s[:4]), int(s[4:6]), int(s[6:]))
        except ValueError:
            return None

    pg.execute(text("DELETE FROM fuel_purchase_line"))
    for r in rows:
        pg.execute(text("""
            INSERT INTO fuel_purchase_line (
                po, item_no, plant, material, vendor, ordered_l, pending_l,
                received_l, unit, due_on, goods_receipt_on, synced_at)
            VALUES (:po, :item, :p, :m, :v, :ord, :pend, :recv, :unit,
                    :due, :gr, now())
            ON CONFLICT (po, item_no) DO NOTHING
        """), {"po": str(r["po"]).strip(), "item": str(r["item"]).strip(),
               "p": r["plant"], "m": r["material"],
               "v": (r["vendor"] or "").strip() or None,
               "ord": _f(r["ordered"]), "pend": _f(r["pending"]),
               "recv": _f(r["received"]), "unit": r["unit"],
               "due": _d(r["due"]), "gr": _d(r["gr"])})

    _mark(pg, "purchase_order", None, len(rows), None)
    return len(rows)


def run_once(db: Session, pg: Session, full: bool = False) -> dict:
    """One pass. Each table commits separately, so a failure in one does not
    roll back the other into a gap."""
    out: dict = {"stock": 0, "orders": 0, "errors": []}
    empty = pg.execute(text(
        "SELECT NOT EXISTS (SELECT 1 FROM fuel_stock_snapshot)")).scalar()
    full = bool(full or empty)

    for name, fn, key in (("mb5b", lambda: _sync_stock(db, pg, full), "stock"),
                          ("purchase_order", lambda: _sync_orders(db, pg), "orders")):
        try:
            out[key] = fn()
            pg.commit()
        except Exception as exc:                        # noqa: BLE001
            pg.rollback()
            out["errors"].append(f"{name}: {type(exc).__name__}: {exc}")
            logger.warning("fuel sync failed for %s", name, exc_info=True)
            try:
                _mark(pg, name, None, 0, f"{type(exc).__name__}: {exc}")
                pg.commit()
            except Exception:                           # noqa: BLE001
                pg.rollback()
    return out


def freshness(pg: Session) -> dict:
    """How old the copy is, for the screen to admit to."""
    rows = pg.execute(text(
        "SELECT source_table, last_run_at, last_rows, last_error"
        " FROM fuel_sync_state")).mappings().all()
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
