"""Electric vehicle tracking — parse the LiuGong export, store it, read it back.

The source is one workbook per machine per month, exported from the LiuGong
telematics portal. Two things about that file drive the whole design:

  * The machine serial is **only in the file name**, before the first hyphen.
    Nothing inside the sheet identifies the machine. Browser downloads add a
    " (1)" suffix, and the month is not always present, so the serial is the
    one part of the name we can rely on.

  * The column set changes. Exports up to Jul-2026 carry 10 columns; the
    Oct-2026 format adds "Avg. Energy(include energy recycle) indicator".
    Columns are therefore matched by normalised header text, never position,
    and anything unrecognised is ignored rather than fatal.
"""
from __future__ import annotations

import datetime as dt
import json
import io
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings

settings = get_settings()

# Schema comes from config, not from a request. Validated anyway — it is
# interpolated into SQL, and a typo should fail loudly here rather than oddly later.
SCHEMA = settings.pg_schema
if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", SCHEMA):
    raise ValueError(f"Invalid PG_SCHEMA {SCHEMA!r}")

# Implied kWh/h above this is physically impossible for these machines and marks
# a bad vendor row. Mirrors the is_suspect generated column in the DDL — change
# both together.
SUSPECT_KWH_PER_H = 300

METRIC_FIELDS = (
    "operating_hours", "idling_hours", "work_hours",
    "operating_energy_kwh", "idling_energy_kwh", "total_energy_kwh",
    "avg_operating_kwh_per_h", "avg_idling_kwh_per_h",
    "avg_energy_kwh_per_h", "avg_energy_recycle_kwh_per_h",
)

# Normalised header text -> column. Several spellings map to one column because
# LiuGong is inconsistent about unit suffixes between exports.
HEADER_MAP = {
    "date": "report_date",
    "operatinghrs(h)": "operating_hours",
    "idlinghrs(h)": "idling_hours",
    "workhrs(h)": "work_hours",
    "operating(kwh)": "operating_energy_kwh",
    "idling(kwh)": "idling_energy_kwh",
    "totalenergy(kwh)": "total_energy_kwh",
    "avg.operating": "avg_operating_kwh_per_h",
    "avg.operating(kwh/h)": "avg_operating_kwh_per_h",
    "avg.idling(kwh/h)": "avg_idling_kwh_per_h",
    "avg.energy(kwh/h)": "avg_energy_kwh_per_h",
    "avg.energy(includeenergyrecycle)indicator(kwh/h)": "avg_energy_recycle_kwh_per_h",
}


class EvParseError(ValueError):
    """The workbook could not be read as a LiuGong man-hour export."""


# ── parsing ──────────────────────────────────────────────────────────
def _norm(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip().lower()


def serial_from_filename(filename: str) -> str:
    """Everything before the first hyphen, e.g.

    'CLG838TECSL831801-Man-hour fuel consumption (1).xlsx' -> 'CLG838TECSL831801'
    """
    stem = re.sub(r"\.xlsx?$", "", (filename or "").strip(), flags=re.I)
    serial = stem.split("-")[0].strip().upper()
    if not serial:
        raise EvParseError(
            "Could not read a machine serial from the file name. Expected it before "
            "the first hyphen, e.g. CLG838TECSL831801-Man-hour fuel consumption.xlsx"
        )
    return serial


def _to_date(value: Any) -> dt.date | None:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    text_value = str(value or "").strip()
    if not text_value:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(text_value[:10], fmt).date()
        except ValueError:
            continue
    return None


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def parse_workbook(content: bytes, filename: str, serial_override: str | None = None) -> dict:
    """Read one export into rows ready for upsert, plus a report on what it found."""
    try:
        import openpyxl
    except ImportError:  # pragma: no cover
        raise EvParseError("openpyxl is not installed — add it to requirements.txt")

    serial = (serial_override or "").strip().upper() or serial_from_filename(filename)

    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    except Exception as exc:
        raise EvParseError(f"Not a readable .xlsx file: {exc}") from exc

    try:
        sheet = workbook.worksheets[0]          # named 'SheetJS', but do not depend on it
        rows = list(sheet.iter_rows(values_only=True))
    finally:
        workbook.close()

    if not rows:
        raise EvParseError("The workbook is empty.")

    index: dict[str, int] = {}
    unknown: list[str] = []
    for position, header in enumerate(rows[0]):
        column = HEADER_MAP.get(_norm(header))
        if column and column not in index:
            index[column] = position
        elif header:
            unknown.append(str(header))

    if "report_date" not in index:
        raise EvParseError(
            "No 'Date' column found. This does not look like a LiuGong "
            "man-hour fuel consumption export."
        )

    parsed: list[dict] = []
    skipped = 0
    for row in rows[1:]:
        if not row:
            continue
        raw_date = row[index["report_date"]] if index["report_date"] < len(row) else None
        report_date = _to_date(raw_date)
        if report_date is None:
            if raw_date not in (None, ""):
                skipped += 1
            continue
        record: dict[str, Any] = {"report_date": report_date}
        for field in METRIC_FIELDS:
            position = index.get(field)
            record[field] = _to_float(row[position]) if position is not None and position < len(row) else None
        parsed.append(record)

    if not parsed:
        raise EvParseError("No dated rows found in the workbook.")

    # Last occurrence wins if the export repeats a day.
    deduped: dict[dt.date, dict] = {}
    for record in parsed:
        deduped[record["report_date"]] = record
    final = [deduped[d] for d in sorted(deduped)]

    suspect = [
        r["report_date"].isoformat() for r in final
        if (r["work_hours"] or 0) > 0
        and (r["total_energy_kwh"] or 0) > (r["work_hours"] or 0) * SUSPECT_KWH_PER_H
    ]

    return {
        "serial_no": serial,
        "rows": final,
        "report": {
            "file": filename,
            "serial_no": serial,
            "rows_parsed": len(final),
            "duplicate_dates_collapsed": len(parsed) - len(final),
            "rows_skipped_unreadable_date": skipped,
            "columns_matched": sorted(index),
            "columns_ignored": unknown,
            "has_energy_recycle_column": "avg_energy_recycle_kwh_per_h" in index,
            "date_from": final[0]["report_date"].isoformat(),
            "date_to": final[-1]["report_date"].isoformat(),
            "suspect_dates": suspect,
            "all_zero": all(not (r["work_hours"] or 0) and not (r["total_energy_kwh"] or 0) for r in final),
        },
    }


# ── writing ──────────────────────────────────────────────────────────
def get_vehicle(db: Session, serial_no: str) -> dict | None:
    row = db.execute(
        text(f"""SELECT ev_vehicle_id, serial_no, equipment_type, model, status
                 FROM {SCHEMA}.ev_vehicle_master WHERE serial_no = :s"""),
        {"s": serial_no},
    ).fetchone()
    return dict(row._mapping) if row else None


def _same(old: Any, new: Any) -> bool:
    """Is this the same reading?

    The stored value is numeric(…) and comes back as Decimal; the parsed one is
    a float off a spreadsheet. 8.4 and Decimal('8.400') are the same reading and
    must not be reported as a change, or re-uploading an unchanged month would
    light up every row. Compared at the precision the column stores (3dp), with
    None equal only to None — a blank is not a zero.
    """
    if old is None or new is None:
        return old is None and new is None
    try:
        return round(float(old), 3) == round(float(new), 3)
    except (TypeError, ValueError):
        return str(old) == str(new)


def diff_rows(db: Session, serial_no: str, rows: list[dict]) -> dict:
    """What this file would do to the table, day by day. Writes nothing.

    WHY THIS EXISTS. A dry run used to report only what it had read — rows,
    date range, columns matched — which is the same report whether the table is
    empty or already holds every one of those days. The question somebody
    uploading six months of telemetry over a table that stops on 8 July is
    actually asking is "which days are new, which get overwritten, and does
    anything I already have disagree with this file". That cannot be answered
    from the workbook alone; it needs the rows that are already there.

    Three outcomes per day, and they are different things:
      NEW       no row for that day — the file is adding history
      CHANGED   a row exists and at least one metric differs — the file is
                restating a figure somebody may already have reported
      IDENTICAL a row exists and every metric matches — re-uploading the same
                export, which is safe and worth saying so plainly

    Only CHANGED carries field-level before/after, because that is the only
    case where something a reader may have quoted is about to move.
    """
    vehicle = get_vehicle(db, serial_no)
    if vehicle is None:
        raise EvParseError(
            f"Serial {serial_no} is not registered. Add it to {SCHEMA}.ev_vehicle_master first."
        )

    dates = [r["report_date"] for r in rows]
    columns = ", ".join(METRIC_FIELDS)
    existing = {
        r._mapping["report_date"]: dict(r._mapping)
        for r in db.execute(
            text(f"""SELECT report_date, {columns}, source_file, ingested_at
                       FROM {SCHEMA}.ev_vehicle_tracking
                      WHERE ev_vehicle_id = :v AND report_date = ANY(:dates)"""),
            {"v": vehicle["ev_vehicle_id"], "dates": dates},
        ).fetchall()
    }

    new_days: list[str] = []
    identical: list[str] = []
    changed: list[dict] = []

    for row in rows:
        day = row["report_date"]
        old = existing.get(day)
        if old is None:
            new_days.append(day.isoformat())
            continue
        fields = {
            f: {"from": None if old[f] is None else float(old[f]),
                "to": None if row.get(f) is None else float(row[f])}
            for f in METRIC_FIELDS if not _same(old[f], row.get(f))
        }
        if fields:
            changed.append({
                "report_date": day.isoformat(),
                "fields": fields,
                "previous_source_file": old.get("source_file"),
                "previously_ingested_at": (old["ingested_at"].isoformat()
                                           if old.get("ingested_at") else None),
            })
        else:
            identical.append(day.isoformat())

    changed.sort(key=lambda c: c["report_date"])
    return {
        "rows_new": len(new_days),
        "rows_changed": len(changed),
        "rows_identical": len(identical),
        "new_dates": new_days,
        "identical_dates": identical,
        "changed": changed,
        # The span this file would ADD, which is the sentence somebody wants
        # when they upload July-to-December over a table that stops on 8 July.
        "new_from": min(new_days) if new_days else None,
        "new_to": max(new_days) if new_days else None,
    }


def upsert_tracking(db: Session, serial_no: str, rows: list[dict], source_file: str,
                    impact: dict | None = None, actor: str | None = None) -> dict:
    """Write one machine's days. Re-uploading the same month overwrites it.

    `impact` is the diff_rows() result taken BEFORE this call. It is recorded
    as the audit trail, because once the UPDATE has run the old values are
    gone and "what did this day say yesterday" has no answer. Passing it is
    how the log stays honest; omitting it writes the rows and logs nothing.
    """
    vehicle = get_vehicle(db, serial_no)
    if vehicle is None:
        raise EvParseError(
            f"Serial {serial_no} is not registered. Add it to {SCHEMA}.ev_vehicle_master first."
        )

    assignments = ", ".join(f"{f} = EXCLUDED.{f}" for f in METRIC_FIELDS)
    columns = ", ".join(METRIC_FIELDS)
    placeholders = ", ".join(f":{f}" for f in METRIC_FIELDS)

    statement = text(f"""
        INSERT INTO {SCHEMA}.ev_vehicle_tracking
               (ev_vehicle_id, report_date, {columns}, source_file)
        VALUES (:ev_vehicle_id, :report_date, {placeholders}, :source_file)
        ON CONFLICT (ev_vehicle_id, report_date) DO UPDATE SET
            {assignments},
            source_file = EXCLUDED.source_file,
            ingested_at = now()
    """)

    existing = {
        r[0] for r in db.execute(
            text(f"""SELECT report_date FROM {SCHEMA}.ev_vehicle_tracking
                     WHERE ev_vehicle_id = :v AND report_date = ANY(:dates)"""),
            {"v": vehicle["ev_vehicle_id"], "dates": [r["report_date"] for r in rows]},
        ).fetchall()
    }

    payload = [
        {**row, "ev_vehicle_id": vehicle["ev_vehicle_id"], "source_file": source_file}
        for row in rows
    ]
    db.execute(statement, payload)

    batch_id = None
    if impact is not None:
        batch_id = _record_batch(db, vehicle, source_file, rows, impact, actor)

    db.commit()

    return {
        "serial_no": serial_no,
        "equipment_type": vehicle["equipment_type"],
        "rows_received": len(rows),
        "rows_inserted": len(rows) - len(existing),
        "rows_updated": len(existing),
        "batch_id": batch_id,
    }


def _record_batch(db: Session, vehicle: dict, source_file: str, rows: list[dict],
                  impact: dict, actor: str | None) -> int:
    """One batch row, and one row per day the upload touched.

    In the same transaction as the write it describes: a log that can commit
    while the write rolls back is worse than no log, because it is believed.

    Identical days are deliberately NOT recorded. They are the bulk of a
    re-upload — 8 of 31 on the July file — and a log where most entries say
    "nothing happened" buries the ones that did.
    """
    batch_id = db.execute(text(f"""
        INSERT INTO {SCHEMA}.ev_upload_batch
               (ev_vehicle_id, source_file, uploaded_by, rows_received,
                rows_new, rows_changed, rows_identical, date_from, date_to)
        VALUES (:v, :f, :by, :n, :new, :chg, :same, :dfrom, :dto)
        RETURNING batch_id
    """), {
        "v": vehicle["ev_vehicle_id"], "f": source_file, "by": actor,
        "n": len(rows), "new": impact["rows_new"], "chg": impact["rows_changed"],
        "same": impact["rows_identical"],
        "dfrom": min(r["report_date"] for r in rows),
        "dto": max(r["report_date"] for r in rows),
    }).scalar()

    entries = [{"b": batch_id, "d": d, "t": "NEW", "f": None}
               for d in impact["new_dates"]]
    entries += [{"b": batch_id, "d": c["report_date"], "t": "CHANGED",
                 "f": json.dumps(c["fields"])}
                for c in impact["changed"]]
    if entries:
        db.execute(text(f"""
            INSERT INTO {SCHEMA}.ev_upload_change
                   (batch_id, report_date, change_type, fields)
            VALUES (:b, CAST(:d AS date), :t, CAST(:f AS jsonb))
            ON CONFLICT (batch_id, report_date) DO NOTHING
        """), entries)
    return batch_id


def get_upload_log(db: Session, limit: int = 50) -> list[dict]:
    """Every recorded upload, newest first.

    NOT the same thing as get_upload_history, which groups the tracking table
    by source_file and therefore describes the CURRENT state: a day re-loaded
    from a second file moves to that file and the first one shrinks. This is
    the log of what was actually done, and nothing can rewrite it.

    It begins at migration 086. Uploads before that were not recorded, and
    their before-values are genuinely gone, so they are absent rather than
    guessed at.
    """
    rows = db.execute(text(f"""
        SELECT b.batch_id, b.source_file, m.serial_no, m.equipment_type,
               b.uploaded_by, b.uploaded_at, b.rows_received,
               b.rows_new, b.rows_changed, b.rows_identical,
               b.date_from, b.date_to
          FROM {SCHEMA}.ev_upload_batch b
          JOIN {SCHEMA}.ev_vehicle_master m USING (ev_vehicle_id)
         ORDER BY b.uploaded_at DESC
         LIMIT :l
    """), {"l": limit}).fetchall()
    return [_shape(dict(r._mapping)) for r in rows]


def get_upload_changes(db: Session, batch_id: int) -> list[dict]:
    """What one upload did, day by day."""
    rows = db.execute(text(f"""
        SELECT report_date, change_type, fields
          FROM {SCHEMA}.ev_upload_change
         WHERE batch_id = :b
         ORDER BY report_date
    """), {"b": batch_id}).fetchall()
    return [_shape(dict(r._mapping)) for r in rows]


# ── reading ──────────────────────────────────────────────────────────
def list_vehicles(db: Session) -> list[dict]:
    """Master list with the coverage each machine actually has."""
    rows = db.execute(text(f"""
        SELECT m.ev_vehicle_id, m.serial_no, m.equipment_type, m.product_group,
               m.make, m.model, m.rated_battery_kwh, m.status,
               COUNT(t.report_date)                                        AS days,
               COUNT(*) FILTER (WHERE COALESCE(t.work_hours,0) > 0)        AS active_days,
               COUNT(*) FILTER (WHERE t.is_suspect)                        AS suspect_days,
               MIN(t.report_date)                                          AS first_day,
               MAX(t.report_date)                                          AS last_day,
               ROUND(SUM(t.total_energy_kwh) FILTER (WHERE NOT t.is_suspect), 2) AS energy_kwh,
               ROUND(SUM(t.work_hours)       FILTER (WHERE NOT t.is_suspect), 2) AS work_hours
        FROM {SCHEMA}.ev_vehicle_master m
        LEFT JOIN {SCHEMA}.ev_vehicle_tracking t USING (ev_vehicle_id)
        GROUP BY m.ev_vehicle_id
        ORDER BY m.equipment_type, m.serial_no
    """)).fetchall()
    return [_shape(dict(r._mapping)) for r in rows]


def get_summary(db: Session, date_from: dt.date, date_to: dt.date,
                include_suspect: bool = False) -> dict:
    """Fleet KPIs for a window, per machine and in total."""
    clause = "" if include_suspect else "AND NOT t.is_suspect"
    rows = db.execute(text(f"""
        SELECT m.serial_no, m.equipment_type, m.model,
               COUNT(*)                                             AS days,
               COUNT(*) FILTER (WHERE COALESCE(t.work_hours,0) > 0) AS active_days,
               ROUND(SUM(t.total_energy_kwh), 2)                    AS energy_kwh,
               ROUND(SUM(t.work_hours), 2)                          AS work_hours,
               ROUND(SUM(t.operating_hours), 2)                     AS operating_hours,
               ROUND(SUM(t.idling_hours), 2)                        AS idling_hours,
               CASE WHEN SUM(t.work_hours) > 0
                    THEN ROUND(SUM(t.total_energy_kwh) / SUM(t.work_hours), 2) END AS kwh_per_hour
        FROM {SCHEMA}.ev_vehicle_tracking t
        JOIN {SCHEMA}.ev_vehicle_master   m USING (ev_vehicle_id)
        WHERE t.report_date BETWEEN :f AND :t {clause}
        GROUP BY m.serial_no, m.equipment_type, m.model
        ORDER BY energy_kwh DESC NULLS LAST
    """), {"f": date_from, "t": date_to}).fetchall()

    machines = [_shape(dict(r._mapping)) for r in rows]
    energy = sum(m["energy_kwh"] or 0 for m in machines)
    hours = sum(m["work_hours"] or 0 for m in machines)
    excluded = db.execute(text(f"""
        SELECT COUNT(*) FROM {SCHEMA}.ev_vehicle_tracking
        WHERE report_date BETWEEN :f AND :t AND is_suspect
    """), {"f": date_from, "t": date_to}).scalar() or 0

    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "include_suspect": include_suspect,
        "suspect_rows_excluded": 0 if include_suspect else int(excluded),
        "totals": {
            "machines": len(machines),
            "energy_kwh": round(energy, 2),
            "work_hours": round(hours, 2),
            "kwh_per_hour": round(energy / hours, 2) if hours else None,
            "active_machines": sum(1 for m in machines if (m["active_days"] or 0) > 0),
        },
        "machines": machines,
    }


def get_daily(db: Session, date_from: dt.date, date_to: dt.date,
              serial_no: str | None = None, include_suspect: bool = False) -> list[dict]:
    """Day-by-day series, one row per machine per day."""
    clause = "" if include_suspect else "AND NOT t.is_suspect"
    serial_clause = "AND m.serial_no = :s" if serial_no else ""
    rows = db.execute(text(f"""
        SELECT m.serial_no, m.equipment_type, t.report_date,
               t.operating_hours, t.idling_hours, t.work_hours,
               t.total_energy_kwh, t.avg_energy_kwh_per_h,
               t.avg_energy_recycle_kwh_per_h,
               CASE WHEN COALESCE(t.work_hours,0) > 0
                    THEN ROUND(t.total_energy_kwh / t.work_hours, 2) END AS derived_kwh_per_h,
               t.is_suspect, t.source_file
        FROM {SCHEMA}.ev_vehicle_tracking t
        JOIN {SCHEMA}.ev_vehicle_master   m USING (ev_vehicle_id)
        WHERE t.report_date BETWEEN :f AND :t {clause} {serial_clause}
        ORDER BY t.report_date, m.serial_no
    """), {"f": date_from, "t": date_to, **({"s": serial_no} if serial_no else {})}).fetchall()
    return [_shape(dict(r._mapping)) for r in rows]


def get_data_quality(db: Session) -> dict:
    """Every row the suspect rule caught, plus how much it distorts the totals."""
    rows = db.execute(text(f"""
        SELECT m.serial_no, m.model, t.report_date, t.work_hours, t.total_energy_kwh,
               t.avg_energy_kwh_per_h,
               ROUND(t.total_energy_kwh / NULLIF(t.work_hours,0), 1) AS derived_kwh_per_h,
               t.source_file
        FROM {SCHEMA}.ev_vehicle_tracking t
        JOIN {SCHEMA}.ev_vehicle_master   m USING (ev_vehicle_id)
        WHERE t.is_suspect
        ORDER BY t.total_energy_kwh DESC
    """)).fetchall()
    totals = db.execute(text(f"""
        SELECT ROUND(SUM(total_energy_kwh), 2)                                AS raw_kwh,
               ROUND(SUM(total_energy_kwh) FILTER (WHERE NOT is_suspect), 2)  AS clean_kwh
        FROM {SCHEMA}.ev_vehicle_tracking
    """)).fetchone()
    totals = dict(totals._mapping) if totals else {"raw_kwh": 0, "clean_kwh": 0}
    raw, clean = float(totals["raw_kwh"] or 0), float(totals["clean_kwh"] or 0)
    return {
        "threshold_kwh_per_h": SUSPECT_KWH_PER_H,
        "suspect_rows": len(rows),
        "fleet_energy_kwh_raw": round(raw, 2),
        "fleet_energy_kwh_clean": round(clean, 2),
        "overstatement_pct": round((raw - clean) / clean * 100, 1) if clean else None,
        "rows": [_shape(dict(r._mapping)) for r in rows],
    }


def get_upload_history(db: Session, limit: int = 50) -> list[dict]:
    """What has been loaded, newest first — the audit trail for a disputed figure."""
    rows = db.execute(text(f"""
        SELECT t.source_file, m.serial_no,
               COUNT(*) AS rows, MIN(t.report_date) AS date_from,
               MAX(t.report_date) AS date_to, MAX(t.ingested_at) AS ingested_at
        FROM {SCHEMA}.ev_vehicle_tracking t
        JOIN {SCHEMA}.ev_vehicle_master   m USING (ev_vehicle_id)
        WHERE t.source_file IS NOT NULL
        GROUP BY t.source_file, m.serial_no
        ORDER BY MAX(t.ingested_at) DESC
        LIMIT :l
    """), {"l": limit}).fetchall()
    return [_shape(dict(r._mapping)) for r in rows]


def _shape(row: dict) -> dict:
    """Dates to ISO, Decimals to float — JSON-safe without a custom encoder."""
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
