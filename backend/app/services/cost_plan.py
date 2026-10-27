"""Cost plan - read the SAP CO plan export, store it, read it back.

The plan arrives as SAP CO (KP06) exports, one file per slice of the
business. Three things about those files shape this module:

  * The header block carries the period, not the rows. Every row is just
    cost centre / cost element / amount, so if a file ever covered more
    than one period there would be no way to tell which row belonged
    where. A file whose "Period n To m" has n <> m is therefore refused
    rather than guessed at.

  * The files of a month are disjoint. For Oct-2026 the Salary and CC OH
    exports share no (cost centre, cost element) pair, so uploading all
    fourteen accumulates into one plan. The key is the pair plus the
    period, and re-uploading one file touches only its own rows.

  * They carry no descriptions. 1210021001 and 70501010 mean nothing on
    screen, so the two master tables are loaded separately from the
    "CE and CC List" workbook and joined on read.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings

settings = get_settings()

SCHEMA = settings.pg_schema
if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", SCHEMA):
    raise ValueError(f"Invalid PG_SCHEMA {SCHEMA!r}")

# The beneficiation plant's own cost centres. Everything else on 1210 is the
# mine; anything else is another plant and is not this dashboard's business.
# Seeded into cost_centre_master.section by migration 088 - this copy exists
# only so an upload can report its own breakdown before the database is read.
COB_COST_CENTRES = {"1210021002", "1210023009", "1210023010", "1210023011"}


def section_of(cost_centre: str) -> str:
    if cost_centre in COB_COST_CENTRES:
        return "COB"
    return "MINES" if cost_centre.startswith("1210") else "OTHER"


class PlanParseError(ValueError):
    """The file could not be read as a SAP CO plan export."""


# ── parsing ──────────────────────────────────────────────────────────
def _rows_from_bytes(content: bytes, filename: str) -> list[list[str]]:
    """Both shapes the export arrives in, flattened to rows of strings."""
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
        except Exception as exc:
            raise PlanParseError(f"Not a readable .xlsx file: {exc}") from exc
        try:
            sheet = wb.worksheets[0]
            return [["" if c is None else str(c).strip() for c in row]
                    for row in sheet.iter_rows(values_only=True)]
        finally:
            wb.close()

    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            decoded = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise PlanParseError("Could not decode the file as text.")
    return [[c.strip() for c in row] for row in csv.reader(io.StringIO(decoded))]


def _num(value: str) -> float | None:
    if value in (None, ""):
        return None
    cleaned = str(value).replace(",", "").strip()
    # SAP writes credits as a trailing minus
    if cleaned.endswith("-"):
        cleaned = "-" + cleaned[:-1]
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_plan(content: bytes, filename: str) -> dict:
    """One export into a header and its rows, with a report on what was found."""
    rows = _rows_from_bytes(content, filename)
    if not rows:
        raise PlanParseError("The file is empty.")

    header: dict[str, list[str]] = {}
    start = None
    for i, row in enumerate(rows[:40]):
        if not row:
            continue
        first = (row[0] or "").strip()
        if first.lower() == "cost center":
            start = i
            break
        if first:
            header[first.lower()] = [c for c in row[1:]]

    if start is None:
        raise PlanParseError(
            "No 'Cost Center' header row found. This does not look like a SAP CO plan export."
        )

    def head(key: str, index: int = 0) -> str:
        vals = header.get(key, [])
        return vals[index].strip() if len(vals) > index and vals[index] else ""

    try:
        fiscal_year = int(head("fiscal year"))
    except ValueError:
        raise PlanParseError("Could not read 'Fiscal Year' from the header block.")

    period_from = head("period", 0)
    period_to = head("period", 2) or period_from
    try:
        period = int(period_from)
        period_end = int(period_to)
    except ValueError:
        raise PlanParseError("Could not read 'Period' from the header block.")

    if period != period_end:
        raise PlanParseError(
            f"This export covers periods {period} to {period_end}. The rows do not say which "
            "period each belongs to, so it cannot be stored. Re-export one period at a time."
        )
    if not 1 <= period <= 16:
        raise PlanParseError(f"Period {period} is outside the fiscal year.")

    currency = ""
    for row in rows[:start]:
        for cell in row:
            if cell and re.fullmatch(r"[A-Z]{3}", cell):
                currency = cell
    currency = currency or "INR"

    parsed: list[dict] = []
    skipped = 0
    for row in rows[start + 1:]:
        if not row or not (row[0] or "").strip():
            continue
        centre = row[0].strip()
        element = row[1].strip() if len(row) > 1 else ""
        # The export leaves column 3 blank and puts the amount in column 4;
        # take the last non-empty cell so a reshuffle does not break it.
        amount = None
        for cell in reversed(row[2:]):
            amount = _num(cell)
            if amount is not None:
                break
        if not centre.isdigit() or not element.isdigit() or amount is None:
            skipped += 1
            continue
        parsed.append({"cost_centre": centre, "cost_element": element, "plan_fix_cost": amount})

    if not parsed:
        raise PlanParseError("No plan rows found in the file.")

    # Within one export a pair should appear once; if it repeats, the last wins.
    deduped: dict[tuple[str, str], dict] = {}
    for rec in parsed:
        deduped[(rec["cost_centre"], rec["cost_element"])] = rec
    final = list(deduped.values())

    by_section: dict[str, dict[str, Any]] = {}
    for rec in final:
        section = section_of(rec["cost_centre"])
        slot = by_section.setdefault(section, {"rows": 0, "amount": 0.0})
        slot["rows"] += 1
        slot["amount"] = round(slot["amount"] + rec["plan_fix_cost"], 2)

    return {
        "meta": {
            "co_area": head("co area") or "1000",
            "plan_version": head("version") or "0",
            "fiscal_year": fiscal_year,
            "period": period,
            "currency": currency,
        },
        "rows": final,
        "report": {
            "file": filename,
            "fiscal_year": fiscal_year,
            "period": period,
            "plan_month": _plan_month(fiscal_year, period).isoformat(),
            "co_area": head("co area") or "1000",
            "plan_version": head("version") or "0",
            "currency": currency,
            "rows_parsed": len(final),
            "duplicate_pairs_collapsed": len(parsed) - len(final),
            "rows_skipped_unreadable": skipped,
            "amount_total": round(sum(r["plan_fix_cost"] for r in final), 2),
            "negative_rows": sum(1 for r in final if r["plan_fix_cost"] < 0),
            "by_section": by_section,
        },
    }


def _plan_month(fiscal_year: int, period: int) -> dt.date:
    """Calendar month a fiscal period covers. FY2026 P7 = Oct-2026."""
    if 1 <= period <= 12:
        month = ((period + 2) % 12) + 1
    else:
        month = 3
    return dt.date(fiscal_year + (1 if period >= 10 else 0), month, 1)


def parse_masters(content: bytes, filename: str) -> dict:
    """The "CE and CC List" workbook - one sheet of elements, one of centres."""
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    except Exception as exc:
        raise PlanParseError(f"Not a readable .xlsx file: {exc}") from exc

    elements: dict[str, str] = {}
    centres: dict[str, str] = {}
    try:
        for sheet in wb.worksheets:
            title = (sheet.title or "").lower()
            if "element" in title:
                target = elements
            elif "cent" in title:          # "Cost Center" or "Cost Centre"
                target = centres
            else:
                continue
            for row in sheet.iter_rows(values_only=True):
                if not row or row[0] in (None, ""):
                    continue
                key = str(row[0]).strip()
                desc = str(row[1]).strip() if len(row) > 1 and row[1] else ""
                if key.isdigit() and desc:
                    target[key] = desc
    finally:
        wb.close()

    if not elements and not centres:
        raise PlanParseError(
            "No 'Cost Element' or 'Cost Center' sheet found. Expected the CE and CC List workbook."
        )
    return {"cost_elements": elements, "cost_centres": centres,
            "report": {"file": filename,
                       "cost_elements": len(elements),
                       "cost_centres": len(centres)}}


# ── completeness ─────────────────────────────────────────────────────
# A month's plan arrives as four separate SAP exports, and uploading two of
# them produces a sheet that is quietly a quarter of the cost rather than an
# error.
#
# Which export a row came from is recorded as source_file, and that is what
# this checks. Content cannot answer it: September's "Mines and COB" export
# also carries an Overhead element, so judging by the lines filled reported
# CC OH Plan as loaded in a month where it was never uploaded. The period
# still comes from the header block and never from the name - a filename is
# good enough to say WHICH export this is, not good enough to say WHEN.
EXPECTED_PLAN_FILES: tuple[dict, ...] = (
    {"name": "Mines and COB", "match": "mines and cob",
     "fills": ("Excavation Charges", "Labour", "Electricity Cost",
               "Sampling & Analysis", "Diesel", "Cons., Spares & Maintenance")},
    {"name": "depreciation Plan", "match": "depreciation",
     "fills": ("Depreciation",)},
    {"name": "CC OH Plan", "match": "cc oh",
     "fills": ("Overhead",)},
    {"name": "Salary Planning", "match": "salary planning",
     "fills": ("Salary",)},
)


def get_plan_coverage(db: Session, fiscal_year: int, period: int) -> dict:
    """Which of the month's four plan exports are in, and what is missing."""
    from app.services import costing          # GL -> cost-sheet line mapping

    rows = db.execute(text(f"""
        SELECT cost_element, SUM(plan_fix_cost) AS amt
          FROM {SCHEMA}.cost_plan_detail
         WHERE fiscal_year = :fy AND period = :p
           AND section IN ('MINES', 'COB')
         GROUP BY cost_element
    """), {"fy": fiscal_year, "p": period}).mappings().all()

    by_line: dict[str, float] = {}
    unmapped = 0.0
    for r in rows:
        m = costing.GL_MASTER.get(str(r["cost_element"]))
        if m and m["include_in_costing"] == "1" and m["summary_line"]:
            by_line[m["summary_line"]] = by_line.get(m["summary_line"], 0.0) + float(r["amt"])
        else:
            unmapped += float(r["amt"])

    loaded_files = [r[0] for r in db.execute(text(f"""
        SELECT DISTINCT source_file FROM {SCHEMA}.cost_plan
         WHERE fiscal_year = :fy AND period = :p
    """), {"fy": fiscal_year, "p": period}).fetchall()]

    files, recognised = [], set()
    for spec in EXPECTED_PLAN_FILES:
        hit = next((f for f in loaded_files if spec["match"] in f.lower()), None)
        if hit:
            recognised.add(hit)
        files.append({
            "name": spec["name"],
            "present": hit is not None,
            "source_file": hit,
            "fills": list(spec["fills"]),
            "amount": round(sum(by_line.get(l, 0.0) for l in spec["fills"]), 2) if hit else 0.0,
            "missing_lines": [] if hit else [
                l for l in spec["fills"] if by_line.get(l, 0.0) == 0
            ],
        })

    loaded = sum(1 for f in files if f["present"])
    return {
        "fiscal_year": fiscal_year, "period": period,
        "plan_month": _plan_month(fiscal_year, period).isoformat(),
        "files_loaded": loaded,
        "files_expected": len(files),
        "complete": loaded == len(files),
        "files": files,
        # A file nobody expected is worth saying out loud rather than
        # ignoring: it is either a renamed export or the wrong one.
        "unrecognised_files": sorted(set(loaded_files) - recognised),
        "amount_total": round(sum(by_line.values()) + unmapped, 2),
        "amount_unmapped": round(unmapped, 2),
    }


# ── writing ──────────────────────────────────────────────────────────
def upsert_masters(db: Session, elements: dict, centres: dict, source_file: str) -> dict:
    for table, key, data in (("cost_element_master", "cost_element", elements),
                             ("cost_centre_master", "cost_centre", centres)):
        if not data:
            continue
        db.execute(text(f"""
            INSERT INTO {SCHEMA}.{table} ({key}, description, source_file)
            VALUES (:k, :d, :f)
            ON CONFLICT ({key}) DO UPDATE SET
                description = EXCLUDED.description,
                source_file = EXCLUDED.source_file,
                updated_at  = now()
        """), [{"k": k, "d": d, "f": source_file} for k, d in data.items()])
    db.commit()
    return {"cost_elements": len(elements), "cost_centres": len(centres)}


def upsert_plan(db: Session, meta: dict, rows: list[dict], source_file: str,
                uploaded_by: str | None = None) -> dict:
    """Write one export's rows, recording what actually moved."""
    key = {"co_area": meta["co_area"], "plan_version": meta["plan_version"],
           "fiscal_year": meta["fiscal_year"], "period": meta["period"]}

    existing = {
        (r[0], r[1]): float(r[2])
        for r in db.execute(text(f"""
            SELECT cost_centre, cost_element, plan_fix_cost
            FROM {SCHEMA}.cost_plan
            WHERE co_area = :co_area AND plan_version = :plan_version
              AND fiscal_year = :fiscal_year AND period = :period
        """), key).fetchall()
    }

    changes: list[dict] = []
    new = changed = identical = 0
    for rec in rows:
        pair = (rec["cost_centre"], rec["cost_element"])
        before = existing.get(pair)
        after = rec["plan_fix_cost"]
        if before is None:
            new += 1
            kind, fields = "NEW", {"plan_fix_cost": after}
        elif abs(before - after) > 0.005:
            changed += 1
            kind, fields = "CHANGED", {"plan_fix_cost": {"before": before, "after": after}}
        else:
            identical += 1
            kind, fields = "IDENTICAL", None
        changes.append({"cost_centre": pair[0], "cost_element": pair[1],
                        "change_type": kind, "fields": json.dumps(fields) if fields else None})

    amount_total = round(sum(r["plan_fix_cost"] for r in rows), 2)
    batch_id = db.execute(text(f"""
        INSERT INTO {SCHEMA}.cost_plan_upload_batch
               (source_file, uploaded_by, co_area, plan_version, fiscal_year, period,
                rows_received, rows_new, rows_changed, rows_identical, amount_total)
        VALUES (:f, :by, :co_area, :plan_version, :fiscal_year, :period,
                :received, :new, :changed, :identical, :amount)
        RETURNING batch_id
    """), {**key, "f": source_file, "by": uploaded_by, "received": len(rows),
           "new": new, "changed": changed, "identical": identical,
           "amount": amount_total}).scalar()

    # Only the rows that moved are worth keeping; IDENTICAL is counted, not listed.
    moved = [c for c in changes if c["change_type"] != "IDENTICAL"]
    if moved:
        db.execute(text(f"""
            INSERT INTO {SCHEMA}.cost_plan_upload_change
                   (batch_id, cost_centre, cost_element, change_type, fields)
            VALUES (:b, :cost_centre, :cost_element, :change_type, CAST(:fields AS jsonb))
        """), [{**c, "b": batch_id} for c in moved])

    db.execute(text(f"""
        INSERT INTO {SCHEMA}.cost_plan
               (co_area, plan_version, fiscal_year, period, cost_centre, cost_element,
                plan_fix_cost, currency, source_file)
        VALUES (:co_area, :plan_version, :fiscal_year, :period, :cost_centre, :cost_element,
                :plan_fix_cost, :currency, :source_file)
        ON CONFLICT (co_area, plan_version, fiscal_year, period, cost_centre, cost_element)
        DO UPDATE SET plan_fix_cost = EXCLUDED.plan_fix_cost,
                      currency      = EXCLUDED.currency,
                      source_file   = EXCLUDED.source_file,
                      ingested_at   = now()
    """), [{**key, **rec, "currency": meta["currency"], "source_file": source_file}
           for rec in rows])
    db.commit()

    return {"batch_id": batch_id, "rows_received": len(rows), "rows_new": new,
            "rows_changed": changed, "rows_identical": identical,
            "amount_total": amount_total}


# ── reading ──────────────────────────────────────────────────────────
def available_periods(db: Session) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT fiscal_year, period, plan_month, co_area, plan_version,
               COUNT(*) AS rows,
               COUNT(*) FILTER (WHERE cost_centre LIKE '1210%') AS mines_rows,
               ROUND(SUM(plan_fix_cost), 2) AS amount_total,
               ROUND(SUM(plan_fix_cost) FILTER (WHERE cost_centre LIKE '1210%'), 2) AS mines_amount,
               COUNT(DISTINCT source_file) AS files,
               MAX(ingested_at) AS last_upload
        FROM {SCHEMA}.cost_plan
        GROUP BY fiscal_year, period, plan_month, co_area, plan_version
        ORDER BY plan_month DESC
    """)).fetchall()
    return [_shape(dict(r._mapping)) for r in rows]


def get_summary(db: Session, fiscal_year: int, period: int, section: str | None = None) -> dict:
    where = "WHERE fiscal_year = :fy AND period = :p"
    params: dict[str, Any] = {"fy": fiscal_year, "p": period}
    if section:
        where += " AND section = :section"
        params["section"] = section

    by_element = db.execute(text(f"""
        SELECT cost_element, cost_element_desc,
               COUNT(*) AS centres, ROUND(SUM(plan_fix_cost), 2) AS amount
        FROM {SCHEMA}.cost_plan_detail {where}
        GROUP BY cost_element, cost_element_desc
        ORDER BY SUM(plan_fix_cost) DESC
    """), params).fetchall()

    by_centre = db.execute(text(f"""
        SELECT cost_centre, cost_centre_desc, section,
               COUNT(*) AS elements, ROUND(SUM(plan_fix_cost), 2) AS amount
        FROM {SCHEMA}.cost_plan_detail {where}
        GROUP BY cost_centre, cost_centre_desc, section
        ORDER BY SUM(plan_fix_cost) DESC
    """), params).fetchall()

    by_section = db.execute(text(f"""
        SELECT section, COUNT(*) AS rows, ROUND(SUM(plan_fix_cost), 2) AS amount
        FROM {SCHEMA}.cost_plan_detail
        WHERE fiscal_year = :fy AND period = :p
        GROUP BY section ORDER BY SUM(plan_fix_cost) DESC
    """), {"fy": fiscal_year, "p": period}).fetchall()

    total = db.execute(text(f"""
        SELECT ROUND(SUM(plan_fix_cost), 2) AS amount, COUNT(*) AS rows,
               MIN(plan_month) AS plan_month
        FROM {SCHEMA}.cost_plan_detail {where}
    """), params).fetchone()
    total = _shape(dict(total._mapping)) if total else {"amount": 0, "rows": 0}

    return {
        "fiscal_year": fiscal_year, "period": period, "section": section,
        "plan_month": total.get("plan_month"),
        "totals": {"amount": total.get("amount") or 0, "rows": total.get("rows") or 0},
        "by_section": [_shape(dict(r._mapping)) for r in by_section],
        "by_element": [_shape(dict(r._mapping)) for r in by_element],
        "by_centre": [_shape(dict(r._mapping)) for r in by_centre],
    }


def get_rows(db: Session, fiscal_year: int, period: int, section: str | None = None,
             cost_centre: str | None = None, cost_element: str | None = None,
             limit: int = 1000) -> list[dict]:
    where = "WHERE fiscal_year = :fy AND period = :p"
    params: dict[str, Any] = {"fy": fiscal_year, "p": period, "lim": limit}
    for column, value, name in (("section", section, "section"),
                                ("cost_centre", cost_centre, "cc"),
                                ("cost_element", cost_element, "ce")):
        if value:
            where += f" AND {column} = :{name}"
            params[name] = value
    rows = db.execute(text(f"""
        SELECT cost_centre, cost_centre_desc, cost_element, cost_element_desc,
               plan_fix_cost, currency, section, plan_month, source_file
        FROM {SCHEMA}.cost_plan_detail {where}
        ORDER BY cost_centre, cost_element
        LIMIT :lim
    """), params).fetchall()
    return [_shape(dict(r._mapping)) for r in rows]


def get_uploads(db: Session, limit: int = 50) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT b.batch_id, b.source_file, b.uploaded_by, b.uploaded_at,
               b.fiscal_year, b.period, b.rows_received, b.rows_new,
               b.rows_changed, b.rows_identical, b.amount_total
        FROM {SCHEMA}.cost_plan_upload_batch b
        ORDER BY b.uploaded_at DESC LIMIT :lim
    """), {"lim": limit}).fetchall()
    return [_shape(dict(r._mapping)) for r in rows]


def get_master_status(db: Session) -> dict:
    """Whether the descriptions are loaded, and what the plan still lacks."""
    row = db.execute(text(f"""
        SELECT (SELECT COUNT(*) FROM {SCHEMA}.cost_element_master) AS elements,
               (SELECT COUNT(*) FROM {SCHEMA}.cost_centre_master)  AS centres,
               (SELECT COUNT(DISTINCT cost_element) FROM {SCHEMA}.cost_plan p
                  WHERE NOT EXISTS (SELECT 1 FROM {SCHEMA}.cost_element_master m
                                    WHERE m.cost_element = p.cost_element)) AS unmapped_elements,
               (SELECT COUNT(DISTINCT cost_centre) FROM {SCHEMA}.cost_plan p
                  WHERE NOT EXISTS (SELECT 1 FROM {SCHEMA}.cost_centre_master m
                                    WHERE m.cost_centre = p.cost_centre)) AS unmapped_centres
    """)).fetchone()
    return _shape(dict(row._mapping)) if row else {}


def _shape(row: dict) -> dict:
    """Dates to ISO, Decimals to float - JSON-safe without a custom encoder."""
    from decimal import Decimal
    out = {}
    for key, value in row.items():
        if isinstance(value, dt.datetime):
            out[key] = value.isoformat()
        elif isinstance(value, dt.date):
            out[key] = value.isoformat()
        elif isinstance(value, Decimal):
            out[key] = float(value)
        else:
            out[key] = value
    return out
