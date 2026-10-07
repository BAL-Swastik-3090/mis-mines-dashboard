"""Fuel control — the reconciliation the spreadsheet could not do.

WHAT THIS ANSWERS, and nothing else does today:

    litres booked to machines   vs   what the pump totaliser says it dispensed

In September three of the four issuing points agreed to within one litre and
one was out by 2,154. The evidence was in the workbook the whole month, in rows
nobody compares, because comparing them by hand across four sheets of 190 rows
is not a thing a person does.

── WHY IT READS POSTGRES AND NOT THE WORKBOOK ──────────────────────────────
Everything here is in minehub (migration 073): issuing points, consumers,
issues, totaliser readings, transfers, tolerances and exceptions. The Technoton
fuel-sensor feed still lives in the shared balcorpdb and is read from there,
because it is somebody else's table and we only look at it.

── SAP IS NOT HERE ─────────────────────────────────────────────────────────
Deliberately. SAP keeps procurement and posts late; linking the two is a later
job. There is a nullable sap_reference column on issues and receipts and
nothing writes it. No posting is attempted and none is implied, so nobody can
mistake a figure on this screen for a figure in the ledger.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

import os
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import (APIRouter, Body, Depends, File, HTTPException, Query,
                     Request, UploadFile)
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/fuel-control", tags=["fuel-control"])

# Where the paperwork lives. Same arrangement as the equipment register's
# documents, which has been working since migration 004.
FUEL_DOCUMENT_ROOT = Path(os.environ.get(
    "FUEL_DOCUMENT_ROOT",
    Path(__file__).resolve().parents[2] / "storage" / "fuel"))
FUEL_MAX_UPLOAD = 15 * 1024 * 1024
FUEL_FILE_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    "image/heic": ".heic",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}

VIEW = ("dashboard.fuel", "fuel.record", "fuel.manage")
RECORD = ("fuel.record", "fuel.manage")
MANAGE = ("fuel.manage",)

# The sensor feed, in the shared database. Two tables because the vendor split
# the MAN trucks from everything else; to us they are one list.
SENSOR_TABLES = ("mines_technoton_man_utilization",
                 "mines_technoton_rest_equipment_utilization")


def _require(request: Request, perms: tuple[str, ...], what: str) -> None:
    held = set(getattr(request.state, "permissions", None) or set())
    if not (set(perms) & held):
        raise HTTPException(403, f"You do not have permission to {what}.")


def _who(request: Request) -> str | None:
    return getattr(request.state, "emp_id", None) or None


def _f(v) -> float:
    """A number, whatever the driver handed back.

    Pydantic serialises a Decimal as a JSON string and the browser then
    concatenates it instead of adding it — which is how a department once
    reported '2,53,70,70' hours.
    """
    try:
        return round(float(v), 3) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _window(day_from: date | None, day_to: date | None) -> tuple[date, date]:
    """The range to report on: the header's dates, or this month so far.

    Every other screen takes its dates from the header picker. A page with its
    own second date control has two answers to "what am I looking at".
    """
    if day_from and day_to:
        return (day_from, day_to) if day_from <= day_to else (day_to, day_from)
    today = date.today()
    return today.replace(day=1), today


# ──────────────────────────────────────────────────────────────────────────
#  The masters. Everything configurable, because none of it is constant.
# ──────────────────────────────────────────────────────────────────────────
@router.get("/masters")
def masters(request: Request, pg: Session = Depends(get_minehub_db)) -> dict:
    """Issuing points, consumers and tolerances — the whole editable surface.

    One call. The entry screens all need the same three lists and fetching
    them separately means three chances to be looking at different vintages.
    """
    _require(request, VIEW, "see fuel management")

    points = [{
        "issuing_point_id": r["issuing_point_id"], "code": r["code"],
        "label": r["label"], "kind": r["kind"],
        "has_totaliser": r["has_totaliser"], "is_active": r["is_active"],
        "capacity_l": _f(r["capacity_l"]) or None, "note": r["note"],
    } for r in pg.execute(text("""
        SELECT issuing_point_id, code, label, kind, has_totaliser, is_active,
               capacity_l, note
          FROM fuel_issuing_point ORDER BY is_active DESC, code
    """)).mappings()]

    consumers = [{
        "consumer_id": r["consumer_id"], "code": r["code"], "label": r["label"],
        "kind": r["kind"], "asset_id": r["asset_id"],
        "meter_kind": r["meter_kind"], "capture_mode": r["capture_mode"],
        "tank_capacity_l": _f(r["tank_capacity_l"]) or None,
        "is_active": r["is_active"],
        "asset_type": r["asset_type"], "fleet_code": r["fleet_code"],
        # Whether a fuel sensor has ever been matched to this machine. Null
        # means nobody has mapped it, which is not the same as no sensor.
        "sensor_name": r["sensor_name"],
        "register_name": r["register_name"],
    } for r in pg.execute(text("""
        SELECT c.consumer_id, c.code, c.label, c.kind, c.asset_id,
               c.meter_kind, c.capture_mode, c.tank_capacity_l, c.is_active,
               t.name AS asset_type, a.fleet_code,
               -- Every name, not the first one. The diesel register calls the
               -- same machine by its plate on one row and "PC - 200" on the
               -- next, and both are true.
               (SELECT string_agg(i.external_code, ', ' ORDER BY i.external_code)
                  FROM asset_identity i
                 WHERE i.asset_id = c.asset_id AND i.system = 'FUEL_SENSOR')
                 AS sensor_name,
               (SELECT string_agg(i.external_code, ', ' ORDER BY i.external_code)
                  FROM asset_identity i
                 WHERE i.asset_id = c.asset_id AND i.system = 'FUEL_REGISTER')
                 AS register_name
          FROM fuel_consumer c
          LEFT JOIN asset a ON a.asset_id = c.asset_id
          LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
         ORDER BY c.is_active DESC, c.code
    """)).mappings()]

    tolerances = [{
        "scope": r["scope"], "pct": _f(r["pct"]) or None,
        "absolute_l": _f(r["absolute_l"]) or None, "is_active": r["is_active"],
        "note": r["note"],
    } for r in pg.execute(text("""
        SELECT scope, pct, absolute_l, is_active, note
          FROM fuel_tolerance ORDER BY scope
    """)).mappings()]

    nozzles_ = [{
        "nozzle_id": r["nozzle_id"], "issuing_point_id": r["issuing_point_id"],
        "code": r["code"], "label": r["label"], "kind": r["kind"],
        "has_totaliser": r["has_totaliser"], "is_active": r["is_active"],
    } for r in pg.execute(text("""
        SELECT nozzle_id, issuing_point_id, code, label, kind,
               has_totaliser, is_active
          FROM fuel_nozzle ORDER BY issuing_point_id, code
    """)).mappings()]

    return {"points": points, "nozzles": nozzles_,
            "consumers": consumers, "tolerances": tolerances,
            "can_record": bool(set(RECORD) & set(
                getattr(request.state, "permissions", None) or set())),
            "can_manage": bool(set(MANAGE) & set(
                getattr(request.state, "permissions", None) or set()))}


# ──────────────────────────────────────────────────────────────────────────
#  The control tower
# ──────────────────────────────────────────────────────────────────────────
@router.get("/overview")
def overview(request: Request,
             day_from: date | None = Query(None),
             day_to: date | None = Query(None),
             pg: Session = Depends(get_minehub_db),
             db: Session = Depends(get_db)) -> dict:
    """Per issuing point: what was booked, what the meter says, and the gap.

    The gap is the whole point. Everything else on this response exists to let
    somebody judge whether a gap is worth asking about.
    """
    _require(request, VIEW, "see fuel management")
    frm, to = _window(day_from, day_to)
    p = {"frm": frm, "to": to}

    # Litres booked to machines, per point. Transfers are NOT here: a bowser
    # refilled from a tank is not consumption, and counting it as an issue is
    # what made the four register sheets add to twice the real figure.
    issued = {r["issuing_point_id"]: (_f(r["litres"]), r["n"])
              for r in pg.execute(text("""
        SELECT issuing_point_id, SUM(litres) AS litres, COUNT(*) AS n
          FROM fuel_issue WHERE on_date BETWEEN :frm AND :to
         GROUP BY issuing_point_id
    """), p).mappings()}

    # What the pump says it dispensed. First opening and last closing in the
    # range, so a missing day in the middle narrows the window rather than
    # inventing a reading for it.
    meters = {r["issuing_point_id"]: r for r in pg.execute(text("""
        SELECT issuing_point_id,
               MIN(on_date) AS first_day, MAX(on_date) AS last_day,
               COUNT(*) AS readings,
               COUNT(*) FILTER (WHERE is_suspect) AS suspect,
               -- The delta is built from readings we BELIEVE, not from every
               -- reading. A flagged one is still stored and still counted
               -- below, but letting it set the boundary makes the headline
               -- figure wrong in a way nobody can see: in testing, a single
               -- backwards reading turned 3,130 litres dispensed into 2,653.
               (ARRAY_AGG(opening_reading ORDER BY on_date, shift)
                 FILTER (WHERE opening_reading IS NOT NULL
                           AND NOT is_suspect))[1] AS first_opening,
               (ARRAY_AGG(closing_reading ORDER BY on_date DESC, shift DESC)
                 FILTER (WHERE closing_reading IS NOT NULL
                           AND NOT is_suspect))[1] AS last_closing
          FROM fuel_meter_reading
         WHERE on_date BETWEEN :frm AND :to
         GROUP BY issuing_point_id
    """), p).mappings()}

    receipts = {r["issuing_point_id"]: _f(r["litres"])
                for r in pg.execute(text("""
        SELECT issuing_point_id, SUM(litres) AS litres FROM fuel_receipt
         WHERE on_date BETWEEN :frm AND :to GROUP BY issuing_point_id
    """), p).mappings()}

    xfer_in = {r["to_point_id"]: _f(r["litres"]) for r in pg.execute(text("""
        SELECT to_point_id, SUM(litres) AS litres FROM fuel_transfer
         WHERE on_date BETWEEN :frm AND :to GROUP BY to_point_id
    """), p).mappings()}
    xfer_out = {r["from_point_id"]: _f(r["litres"]) for r in pg.execute(text("""
        SELECT from_point_id, SUM(litres) AS litres FROM fuel_transfer
         WHERE on_date BETWEEN :frm AND :to GROUP BY from_point_id
    """), p).mappings()}

    tol = {r["scope"]: r for r in pg.execute(text(
        "SELECT scope, pct, absolute_l, is_active FROM fuel_tolerance")).mappings()}

    def flagged(scope: str, gap: float, base: float) -> bool:
        """Is this gap big enough to raise, by the office's own thresholds?

        Both a percentage and a floor, because 40 per cent of a lighting set is
        nothing and 3 per cent of a 20,000 litre month is not.
        """
        t = tol.get(scope)
        if not t or not t["is_active"]:
            return False
        g = abs(gap)
        pct_ok = t["pct"] is not None and base and g >= base * float(t["pct"]) / 100.0
        abs_ok = t["absolute_l"] is not None and g >= float(t["absolute_l"])
        if t["pct"] is not None and t["absolute_l"] is not None:
            return bool(pct_ok and abs_ok)      # both, so small points stay quiet
        return bool(pct_ok or abs_ok)

    rows = []
    for r in pg.execute(text("""
        SELECT issuing_point_id, code, label, kind, has_totaliser, capacity_l
          FROM fuel_issuing_point WHERE is_active ORDER BY code
    """)).mappings():
        pid = r["issuing_point_id"]
        booked, n = issued.get(pid, (0.0, 0))
        m = meters.get(pid)
        delta = (_f(m["last_closing"]) - _f(m["first_opening"])) if m else None
        gap = (booked - delta) if delta is not None else None
        rows.append({
            "issuing_point_id": pid, "code": r["code"], "label": r["label"],
            "kind": r["kind"], "has_totaliser": r["has_totaliser"],
            "booked_l": booked, "issues": n,
            "totaliser_l": delta,
            "gap_l": round(gap, 2) if gap is not None else None,
            "gap_flagged": flagged("TANK_TOTALISER", gap, booked)
                           if gap is not None else False,
            "readings": (m["readings"] if m else 0),
            "suspect_readings": (m["suspect"] if m else 0),
            "receipts_l": receipts.get(pid, 0.0),
            "transfer_in_l": xfer_in.get(pid, 0.0),
            "transfer_out_l": xfer_out.get(pid, 0.0),
            # Why there is no gap to show, said plainly rather than as a blank.
            "why_no_gap": (
                None if gap is not None else
                "no totaliser at this point" if not r["has_totaliser"]
                else "every reading in this range is flagged for review"
                if m and m["suspect"] and m["suspect"] == m["readings"]
                else "no meter readings recorded for this range"),
        })

    # ── coverage: what this screen cannot see ────────────────────────────
    cov = pg.execute(text("""
        SELECT COUNT(*) FILTER (WHERE is_active) AS active,
               COUNT(*) FILTER (WHERE is_active AND capture_mode = 'C') AS manual,
               COUNT(*) FILTER (WHERE is_active AND kind = 'ASSET') AS on_register,
               COUNT(*) FILTER (WHERE is_active AND meter_kind = 'NONE') AS no_meter
          FROM fuel_consumer
    """)).mappings().first()

    mapped = pg.execute(text("""
        SELECT COUNT(DISTINCT c.consumer_id) FROM fuel_consumer c
          JOIN asset_identity i ON i.asset_id = c.asset_id
                               AND i.system = 'FUEL_SENSOR'
         WHERE c.is_active
    """)).scalar() or 0

    # The sensor feed's own silence. A machine whose sensor stopped reporting
    # is not a machine that stopped working, and the difference matters.
    silent: list[dict] = []
    try:
        for tbl in SENSOR_TABLES:
            for s in db.execute(text(f"""
                SELECT vehicle_desc, MAX(report_date) AS last_seen
                  FROM {tbl} GROUP BY vehicle_desc
            """)).mappings():
                last = s["last_seen"]
                if not last:
                    continue
                d = last.date() if isinstance(last, datetime) else last
                days = (date.today() - d).days
                if days >= 2:
                    silent.append({"sensor_name": s["vehicle_desc"],
                                   "last_seen": d.isoformat(), "days": days})
    except Exception:                                   # noqa: BLE001
        # The sensor tables are somebody else's. If they are unreachable the
        # rest of this screen is still correct, and saying so beats a 500.
        silent = []
    silent.sort(key=lambda x: -x["days"])

    open_exceptions = pg.execute(text("""
        SELECT kind, COUNT(*) FROM fuel_exception
         WHERE status = 'OPEN' GROUP BY kind
    """)).all()

    return {
        "from": frm.isoformat(), "to": to.isoformat(),
        "days": (to - frm).days + 1,
        "points": rows,
        "headline": {
            "booked_l": round(sum(r["booked_l"] for r in rows), 2),
            "receipts_l": round(sum(r["receipts_l"] for r in rows), 2),
            "transfers_l": round(sum(r["transfer_out_l"] for r in rows), 2),
            "issues": sum(r["issues"] for r in rows),
            "points_reconciled": sum(1 for r in rows
                                     if r["gap_l"] is not None and not r["gap_flagged"]),
            "points_flagged": sum(1 for r in rows if r["gap_flagged"]),
            "points_unchecked": sum(1 for r in rows if r["gap_l"] is None),
        },
        "coverage": {
            "active_consumers": cov["active"], "on_register": cov["on_register"],
            "manual_capture": cov["manual"], "no_meter_kind": cov["no_meter"],
            "sensor_mapped": mapped,
            "sensor_unmapped": max(cov["active"] - mapped, 0),
        },
        "silent_sensors": silent[:20],
        "open_exceptions": {k: int(v) for k, v in open_exceptions},
    }


# ──────────────────────────────────────────────────────────────────────────
#  Recording. Permissive on purpose.
# ──────────────────────────────────────────────────────────────────────────
@router.post("/meter-reading")
def meter_reading(request: Request, body: dict = Body(...),
                  pg: Session = Depends(get_minehub_db)) -> dict:
    """Record a pump totaliser reading.

    IT ACCEPTS A READING IT BELIEVES IS WRONG. A closing figure below the
    opening is stored and flagged, never refused. Security has been writing
    these in a notebook for years and that notebook is the only independent
    check the mine has; a validation that blocks the entry means the notebook
    wins and we get nothing at all.
    """
    _require(request, RECORD, "record fuel readings")
    pid = body.get("issuing_point_id")
    on = body.get("on_date")
    if not pid or not on:
        raise HTTPException(422, "An issuing point and a date are needed.")

    opening, closing = body.get("opening_reading"), body.get("closing_reading")
    reasons = []
    if opening is not None and closing is not None:
        if float(closing) < float(opening):
            reasons.append("the closing reading is below the opening")
        elif float(closing) - float(opening) > 20000:
            reasons.append("more than 20,000 litres in one shift")
    if opening is None and closing is None:
        raise HTTPException(422, "At least one reading is needed.")

    row = pg.execute(text("""
        INSERT INTO fuel_meter_reading (
            issuing_point_id, on_date, shift, opening_reading, closing_reading,
            is_suspect, suspect_reason, entered_by, paper_ref, note)
        VALUES (:pid, :on, :shift, :op, :cl, :sus, :reason, :by, :paper, :note)
        ON CONFLICT (issuing_point_id, on_date, shift) DO UPDATE SET
            opening_reading = COALESCE(EXCLUDED.opening_reading,
                                       fuel_meter_reading.opening_reading),
            closing_reading = COALESCE(EXCLUDED.closing_reading,
                                       fuel_meter_reading.closing_reading),
            is_suspect = EXCLUDED.is_suspect,
            suspect_reason = EXCLUDED.suspect_reason,
            entered_by = EXCLUDED.entered_by,
            entered_at = now(),
            paper_ref = COALESCE(EXCLUDED.paper_ref, fuel_meter_reading.paper_ref),
            note = COALESCE(EXCLUDED.note, fuel_meter_reading.note)
        RETURNING meter_reading_id, is_suspect
    """), {"pid": pid, "on": on, "shift": body.get("shift") or "GEN",
           "op": opening, "cl": closing,
           "sus": bool(reasons), "reason": "; ".join(reasons) or None,
           "by": _who(request), "paper": body.get("paper_ref"),
           "note": body.get("note")}).mappings().first()
    pg.commit()
    return {"ok": True, "meter_reading_id": row["meter_reading_id"],
            "flagged": row["is_suspect"],
            # Said back plainly, so the person who typed it knows what was
            # recorded rather than being told off.
            "message": ("Recorded, and flagged for review: "
                        + "; ".join(reasons)) if reasons else "Recorded."}


@router.post("/issue")
def issue(request: Request, body: dict = Body(...),
          pg: Session = Depends(get_minehub_db)) -> dict:
    """Book an issue of diesel to a consumer.

    `capture_mode` defaults to C — by hand — because that is what every issue
    is until a metered dispenser exists. It is stored on the row rather than
    assumed, so the day some consumers move to an automated dispenser the older
    figures do not silently claim the same certainty.
    """
    _require(request, RECORD, "record fuel issues")
    need = ("issuing_point_id", "consumer_id", "litres", "on_date")
    if any(body.get(k) in (None, "") for k in need):
        raise HTTPException(422, "Issuing point, consumer, litres and date are needed.")
    litres = float(body["litres"])
    if not (0 < litres < 20000):
        raise HTTPException(422, "Litres must be between 0 and 20,000.")

    # The machine's own meter kind, so an HMR is never filed as a KM.
    c = pg.execute(text(
        "SELECT meter_kind, capture_mode FROM fuel_consumer WHERE consumer_id = :c"),
        {"c": body["consumer_id"]}).mappings().first()
    if not c:
        raise HTTPException(404, "That consumer is not on the list.")

    # The nozzle must belong to the point it is being issued from. Getting
    # this wrong would put a fill against a totaliser that never dispensed it,
    # and the reconciliation would then chase a gap that does not exist.
    if body.get("nozzle_id"):
        ok = pg.execute(text("""
            SELECT 1 FROM fuel_nozzle
             WHERE nozzle_id = :n AND issuing_point_id = :p
        """), {"n": body["nozzle_id"], "p": body["issuing_point_id"]}).first()
        if not ok:
            raise HTTPException(422, "That nozzle is not on that issuing point.")

    row = pg.execute(text("""
        INSERT INTO fuel_issue (
            on_date, shift, issuing_point_id, nozzle_id, consumer_id, litres,
            meter_reading, meter_kind, capture_mode, source, order_id,
            filled_at, filled_location, issued_by, received_by, note, entered_by)
        VALUES (:on, :shift, :pid, :nid, :cid, :litres, :meter,
                NULLIF(:mkind, 'NONE'), :cap, :src, :oid,
                -- The time the diesel actually went in. Defaults to now,
                -- which is right when it is booked at the nozzle and wrong
                -- when it is keyed in next morning -- so the form sends it.
                COALESCE(CAST(:filled_at AS timestamptz), now()),
                :where, :issued_by, :received_by, :note, :by)
        RETURNING issue_id, filled_at
    """), {"on": body["on_date"], "shift": body.get("shift") or "GEN",
           "pid": body["issuing_point_id"], "nid": body.get("nozzle_id"),
           "cid": body["consumer_id"],
           "litres": litres, "meter": body.get("meter_reading"),
           "mkind": c["meter_kind"], "cap": c["capture_mode"],
           "src": body.get("source") or "MANUAL",
           "oid": body.get("order_id"),
           "filled_at": body.get("filled_at"),
           "where": body.get("filled_location"),
           "issued_by": body.get("issued_by"),
           "received_by": body.get("received_by"),
           "note": body.get("note"), "by": _who(request)}).mappings().first()
    pg.commit()

    # What the order it answers now stands at. The trigger has already
    # restated it, so this is read back rather than worked out again.
    order = None
    if body.get("order_id"):
        o = pg.execute(text("""
            SELECT o.order_no, o.requested_l, o.status,
                   COALESCE(SUM(i.litres), 0) AS filled
              FROM fuel_order o LEFT JOIN fuel_issue i USING (order_id)
             WHERE o.order_id = :o
             GROUP BY o.order_no, o.requested_l, o.status
        """), {"o": body["order_id"]}).mappings().first()
        if o:
            order = {"order_no": o["order_no"], "status": o["status"],
                     "requested_l": _f(o["requested_l"]),
                     "filled_l": _f(o["filled"]),
                     "outstanding_l": round(
                         max(_f(o["requested_l"]) - _f(o["filled"]), 0), 2)}
    return {"ok": True, "issue_id": row["issue_id"],
            "filled_at": row["filled_at"], "order": order}


@router.post("/transfer")
def transfer(request: Request, body: dict = Body(...),
             pg: Session = Depends(get_minehub_db)) -> dict:
    """Move diesel between two of our own points.

    This exists so that refilling the bowser from a tank is never booked as an
    issue. Recorded as an issue, it is counted as consumption twice — which is
    why the four register sheets add to 165,129 litres in a month where 79,046
    were consumed.
    """
    _require(request, RECORD, "record fuel transfers")
    for k in ("from_point_id", "to_point_id", "litres", "on_date"):
        if body.get(k) in (None, ""):
            raise HTTPException(422, "Both points, litres and a date are needed.")
    if body["from_point_id"] == body["to_point_id"]:
        raise HTTPException(422, "A transfer needs two different points.")
    row = pg.execute(text("""
        INSERT INTO fuel_transfer (on_date, from_point_id, to_point_id, litres,
                                   note, entered_by)
        VALUES (:on, :frm, :to, :litres, :note, :by) RETURNING transfer_id
    """), {"on": body["on_date"], "frm": body["from_point_id"],
           "to": body["to_point_id"], "litres": float(body["litres"]),
           "note": body.get("note"), "by": _who(request)}).mappings().first()
    pg.commit()
    return {"ok": True, "transfer_id": row["transfer_id"]}


@router.post("/receipt")
def receipt(request: Request, body: dict = Body(...),
            pg: Session = Depends(get_minehub_db)) -> dict:
    """Diesel delivered into a point. No SAP posting — see the module docstring."""
    _require(request, RECORD, "record fuel receipts")
    for k in ("issuing_point_id", "litres", "on_date"):
        if body.get(k) in (None, ""):
            raise HTTPException(422, "An issuing point, litres and a date are needed.")
    row = pg.execute(text("""
        INSERT INTO fuel_receipt (issuing_point_id, on_date, litres, invoice_no,
                                  rate_per_l, note, entered_by)
        VALUES (:pid, :on, :litres, :inv, :rate, :note, :by) RETURNING receipt_id
    """), {"pid": body["issuing_point_id"], "on": body["on_date"],
           "litres": float(body["litres"]), "inv": body.get("invoice_no"),
           "rate": body.get("rate_per_l"), "note": body.get("note"),
           "by": _who(request)}).mappings().first()
    pg.commit()
    return {"ok": True, "receipt_id": row["receipt_id"]}


# ──────────────────────────────────────────────────────────────────────────
#  Masters, maintained from the screen and never from the source
# ──────────────────────────────────────────────────────────────────────────
@router.put("/consumer/{consumer_id}")
def set_consumer(consumer_id: int, request: Request, body: dict = Body(...),
                 pg: Session = Depends(get_minehub_db)) -> dict:
    """Change what a machine is measured in, how its fuel is captured, or
    whether it is still in use.

    `meter_kind` matters more than it looks. The register says HOURS for all 97
    machines including the ambulance, so the seeded value is a starting guess
    for everything except the road vehicles. Litres per hour on a machine
    measured in kilometres is not a smaller error than a missing figure — it is
    a number that looks usable and is not.

    A key that is absent is left alone, so two fields on a row cannot wipe each
    other.
    """
    _require(request, MANAGE, "change fuel masters")
    sets, params = [], {"id": consumer_id}
    allowed = {
        "meter_kind": ("HMR", "KM", "NONE"),
        "capture_mode": ("A", "B", "C"),
        "kind": ("ASSET", "FIXTURE", "COST_HEAD"),
    }
    for k, valid in allowed.items():
        if k in body:
            if body[k] not in valid:
                raise HTTPException(422, f"{k} must be one of {', '.join(valid)}.")
            sets.append(f"{k} = :{k}")
            params[k] = body[k]
    for k in ("label", "note", "tank_capacity_l", "is_active"):
        if k in body:
            sets.append(f"{k} = :{k}")
            params[k] = body[k]
    if not sets:
        raise HTTPException(422, "Nothing to change.")

    done = pg.execute(text(
        f"UPDATE fuel_consumer SET {', '.join(sets)} "
        f"WHERE consumer_id = :id RETURNING consumer_id"), params).first()
    if not done:
        raise HTTPException(404, "That consumer is not on the list.")
    pg.commit()
    return {"ok": True}


@router.post("/consumer")
def add_consumer(request: Request, body: dict = Body(...),
                 pg: Session = Depends(get_minehub_db)) -> dict:
    """Add a consumer that is not a machine on the register.

    The September register issued diesel to a 1010 KVA generator, a compressor,
    a dewatering pump and the Sukinda guest house. They are real, they burn
    diesel, and they are not equipment — so they are entered here rather than
    forced onto the asset register as fake vehicles.
    """
    _require(request, MANAGE, "change fuel masters")
    kind = body.get("kind") or "FIXTURE"
    if kind not in ("FIXTURE", "COST_HEAD"):
        raise HTTPException(
            422, "A consumer that is a machine is created from the equipment "
                 "register, not here.")
    if not body.get("code") or not body.get("label"):
        raise HTTPException(422, "A code and a name are needed.")
    try:
        row = pg.execute(text("""
            INSERT INTO fuel_consumer (code, label, kind, meter_kind,
                                       capture_mode, note, created_by)
            VALUES (:code, :label, :kind, :mkind, 'C', :note, :by)
            RETURNING consumer_id
        """), {"code": body["code"].strip(), "label": body["label"].strip(),
               "kind": kind, "mkind": body.get("meter_kind") or "NONE",
               "note": body.get("note"), "by": _who(request)}).mappings().first()
        pg.commit()
    except Exception as exc:                            # noqa: BLE001
        pg.rollback()
        raise HTTPException(409, "That code is already in use.") from exc
    return {"ok": True, "consumer_id": row["consumer_id"]}


@router.put("/tolerance/{scope}")
def set_tolerance(scope: str, request: Request, body: dict = Body(...),
                  pg: Session = Depends(get_minehub_db)) -> dict:
    """How big a gap is worth raising — the fuel office's call, not ours."""
    _require(request, MANAGE, "change fuel tolerances")
    done = pg.execute(text("""
        UPDATE fuel_tolerance
           SET pct = :pct, absolute_l = :abs, is_active = :active,
               note = COALESCE(:note, note), updated_at = now(), updated_by = :by
         WHERE scope = :scope RETURNING tolerance_id
    """), {"scope": scope, "pct": body.get("pct"),
           "abs": body.get("absolute_l"),
           "active": bool(body.get("is_active", True)),
           "note": body.get("note"), "by": _who(request)}).first()
    if not done:
        raise HTTPException(404, "No such tolerance.")
    pg.commit()
    return {"ok": True}


@router.put("/identity/{consumer_id}")
def set_identity(consumer_id: int, request: Request, body: dict = Body(...),
                 pg: Session = Depends(get_minehub_db)) -> dict:
    """Record what another system calls this machine.

    One excavator is EX-2 to the shift board, 'BAL_Z AXIS 470-2(Excavator)' to
    the fuel sensor, 'ZAXIS-470-2' to the logbook and a registration plate to
    the diesel register. Five names, and matching them on a cleaned-up string
    guesses wrong silently — so somebody who knows the machines says so once,
    here, and every screen afterwards agrees.
    """
    _require(request, MANAGE, "map fuel names")
    system = body.get("system")
    if system not in ("FUEL_SENSOR", "FUEL_REGISTER"):
        raise HTTPException(422, "system must be FUEL_SENSOR or FUEL_REGISTER.")
    asset_id = pg.execute(text(
        "SELECT asset_id FROM fuel_consumer WHERE consumer_id = :c"),
        {"c": consumer_id}).scalar()
    if not asset_id:
        raise HTTPException(
            422, "Only a consumer that is a machine on the register can carry "
                 "another system's name.")
    code = (body.get("external_code") or "").strip()

    # The unique key is (system, external_code): one code names one machine.
    # NOT (asset_id, system) — a machine may carry several names in one system,
    # which for the diesel register it genuinely does.
    if not code:
        n = pg.execute(text(
            "DELETE FROM asset_identity WHERE asset_id = :a AND system = :s"),
            {"a": asset_id, "s": system}).rowcount
        pg.commit()
        return {"ok": True, "removed": n}

    # A code already pointing at a different machine is moved, not duplicated.
    # Two machines claiming one name is the ambiguity this table exists to end.
    moved = pg.execute(text("""
        SELECT a.fleet_code FROM asset_identity i JOIN asset a ON a.asset_id = i.asset_id
         WHERE i.system = :s AND i.external_code = :c AND i.asset_id <> :a
    """), {"s": system, "c": code, "a": asset_id}).scalar()

    pg.execute(text("""
        INSERT INTO asset_identity (asset_id, system, external_code)
        VALUES (:a, :s, :c)
        ON CONFLICT (system, external_code) DO UPDATE
           SET asset_id = EXCLUDED.asset_id
    """), {"a": asset_id, "s": system, "c": code})
    pg.commit()
    return {"ok": True,
            "moved_from": moved,
            "message": (f"That name was on {moved}; it now points here."
                        if moved else "Recorded.")}


# ──────────────────────────────────────────────────────────────────────────
#  Exceptions — a question, never a verdict
# ──────────────────────────────────────────────────────────────────────────
@router.get("/exceptions")
def exceptions(request: Request, status: str = Query("OPEN"),
               pg: Session = Depends(get_minehub_db)) -> list[dict]:
    _require(request, VIEW, "see fuel management")
    return [{
        "exception_id": r["exception_id"], "raised_on": r["raised_on"],
        "kind": r["kind"], "detail": r["detail"], "status": r["status"],
        "gap_value": _f(r["gap_value"]),
        "point": r["point"], "consumer": r["consumer"],
        "explanation": r["explanation"], "explained_by": r["explained_by"],
    } for r in pg.execute(text("""
        SELECT e.exception_id, e.raised_on, e.kind, e.detail, e.status,
               e.gap_value, e.explanation, e.explained_by,
               p.label AS point, c.label AS consumer
          FROM fuel_exception e
          LEFT JOIN fuel_issuing_point p ON p.issuing_point_id = e.issuing_point_id
          LEFT JOIN fuel_consumer c ON c.consumer_id = e.consumer_id
         WHERE (:st = 'ALL' OR e.status = :st)
         ORDER BY e.raised_on DESC, ABS(COALESCE(e.gap_value, 0)) DESC
         LIMIT 300
    """), {"st": status.upper()}).mappings()]


@router.put("/exception/{exception_id}")
def explain(exception_id: int, request: Request, body: dict = Body(...),
            pg: Session = Depends(get_minehub_db)) -> dict:
    """Attach somebody's explanation to a gap.

    A discrepancy needs a person's answer and a derived figure has nowhere to
    put one — which is the whole reason an exception is a row rather than a
    calculation. Nothing here concludes anything: a gap between a meter and a
    register has a dozen honest causes.
    """
    _require(request, RECORD, "explain fuel exceptions")
    status = body.get("status") or "EXPLAINED"
    if status not in ("OPEN", "EXPLAINED", "ACCEPTED", "STALE"):
        raise HTTPException(422, "Unknown status.")
    if status in ("EXPLAINED", "ACCEPTED") and not (body.get("explanation") or "").strip():
        raise HTTPException(422, "An explanation is needed to close a gap.")
    done = pg.execute(text("""
        UPDATE fuel_exception
           SET status = :st, explanation = :ex, explained_by = :by,
               explained_at = now()
         WHERE exception_id = :id RETURNING exception_id
    """), {"id": exception_id, "st": status,
           "ex": body.get("explanation"), "by": _who(request)}).first()
    if not done:
        raise HTTPException(404, "No such exception.")
    pg.commit()
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────────
#  The chain: a litre from the tanker to a cubic metre of rock
# ──────────────────────────────────────────────────────────────────────────
@router.get("/chain")
def chain(request: Request,
          day_from: date | None = Query(None),
          day_to: date | None = Query(None),
          pg: Session = Depends(get_minehub_db),
          db: Session = Depends(get_db)) -> dict:
    """Where the diesel went, and what it moved.

        delivered -> held in tanks -> moved to bowsers -> issued to machines
                                                             |
                                                       cubic metres moved
                                                             |
                                                  litres/Cum and cost/Cum vs plan

    WHY THE DECOMPOSITION MATTERS MORE THAN THE RATIO. The audit's August
    observation reads 5.49 litres/Cum against a plan of 2.60 and calls it
    111 per cent worse. Both halves of that fraction moved:

        diesel spend   68.98 lakh against 185.94 lakh   =  37 per cent of plan
        excavation      8,949 Cum  against 67,735 Cum   =  13 per cent of plan

    Fuel came in far UNDER plan. Output came in further under. The ratio rose
    because the denominator collapsed, not because machines drank more — and a
    screen that shows only 5.49 against 2.60 sends somebody to audit the
    excavators when the question is why the rock did not move.

    So this returns both sides as a share of plan and lets the reader see which
    one moved. It does not compute a verdict.
    """
    _require(request, VIEW, "see fuel management")
    frm, to = _window(day_from, day_to)
    p = {"frm": frm, "to": to}

    # ── the fuel side, from our own records ──────────────────────────────
    flow = pg.execute(text("""
        SELECT
          (SELECT COALESCE(SUM(litres), 0) FROM fuel_receipt
            WHERE on_date BETWEEN :frm AND :to)            AS received,
          (SELECT COALESCE(SUM(litres), 0) FROM fuel_transfer
            WHERE on_date BETWEEN :frm AND :to)            AS transferred,
          (SELECT COALESCE(SUM(litres), 0) FROM fuel_issue
            WHERE on_date BETWEEN :frm AND :to)            AS issued,
          (SELECT COUNT(*) FROM fuel_issue
            WHERE on_date BETWEEN :frm AND :to)            AS issue_count
    """), p).mappings().first()

    # Issued, split by what received it. A generator running the dewatering
    # pumps burns diesel that moves no rock at all, and charging it against
    # cubic metres is one of the ways a ratio misleads.
    by_kind = {r["kind"]: {"litres": _f(r["litres"]), "consumers": r["n"]}
               for r in pg.execute(text("""
        SELECT c.kind, SUM(i.litres) AS litres, COUNT(DISTINCT c.consumer_id) AS n
          FROM fuel_issue i JOIN fuel_consumer c ON c.consumer_id = i.consumer_id
         WHERE i.on_date BETWEEN :frm AND :to
         GROUP BY c.kind
    """), p).mappings()}

    top = [{"code": r["code"], "label": r["label"], "type": r["asset_type"],
            "litres": _f(r["litres"]), "issues": r["n"]}
           for r in pg.execute(text("""
        SELECT c.code, c.label, t.name AS asset_type,
               SUM(i.litres) AS litres, COUNT(*) AS n
          FROM fuel_issue i
          JOIN fuel_consumer c ON c.consumer_id = i.consumer_id
          LEFT JOIN asset a ON a.asset_id = c.asset_id
          LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
         WHERE i.on_date BETWEEN :frm AND :to
         GROUP BY c.code, c.label, t.name
         ORDER BY SUM(i.litres) DESC LIMIT 15
    """), p).mappings()]

    # The rate we actually paid, from receipts. Null rather than a guess: a
    # cost per Cum built on an assumed price is a number nobody can defend.
    rate = pg.execute(text("""
        SELECT CASE WHEN SUM(litres) > 0
                    THEN SUM(litres * COALESCE(rate_per_l, 0)) / SUM(litres) END
          FROM fuel_receipt
         WHERE on_date BETWEEN :frm AND :to AND rate_per_l IS NOT NULL
    """), p).scalar()

    # ── what was moved, from the excavation log ──────────────────────────
    #
    # Variant 1 is ore, 3 overburden, 4 silt, and the Units column says
    # whether a row is tonnes or cubic metres. Ore in tonnes is converted at
    # the same factor the capacity model uses, not a number typed in here.
    t_per_cum = pg.execute(text("""
        SELECT ore_t_per_cum FROM productivity_assumption
         WHERE effective_to IS NULL ORDER BY effective_from DESC LIMIT 1
    """)).scalar()
    t_per_cum = float(t_per_cum) if t_per_cum else 3.0

    exc = {"silt_cum": 0.0, "ob_cum": 0.0, "ore_cum": 0.0, "ore_mt": 0.0}
    exc_ok, exc_problem = True, None
    try:
        for r in db.execute(text("""
            SELECT Variant AS v, Units AS u,
                   SUM(CAST(Qty AS DECIMAL(15,3))) AS q
              FROM mines_day_wise_excavation
             WHERE Prod_date BETWEEN :frm AND :to
             GROUP BY Variant, Units
        """), p).mappings():
            q = _f(r["q"])
            unit = (r["u"] or "").strip().upper()
            v = str(r["v"] or "").strip()
            if v == "4":
                exc["silt_cum"] += q / t_per_cum if unit == "MT" else q
            elif v == "3":
                exc["ob_cum"] += q / t_per_cum if unit == "MT" else q
            elif v == "1":
                if unit == "MT":
                    exc["ore_mt"] += q
                    exc["ore_cum"] += q / t_per_cum
                else:
                    exc["ore_cum"] += q
    except Exception as exc_err:                        # noqa: BLE001
        exc_ok = False
        exc_problem = f"the excavation log could not be read ({type(exc_err).__name__})"
    total_cum = round(exc["silt_cum"] + exc["ob_cum"] + exc["ore_cum"], 2)

    # ── the plan for the months this range covers ───────────────────────
    plan = pg.execute(text("""
        SELECT SUM(COALESCE(planned_silt_cum,0) + COALESCE(planned_ob_cum,0)
                   + COALESCE(planned_ore_cum,0))            AS cum,
               SUM(COALESCE(planned_total_cost,0))           AS cost,
               AVG(planned_l_per_cum)                        AS l_per_cum,
               AVG(planned_rate_per_l)                       AS rate,
               COUNT(*)                                      AS months
          FROM fuel_plan
         WHERE plan_month BETWEEN DATE_TRUNC('month', CAST(:frm AS date))
                              AND DATE_TRUNC('month', CAST(:to AS date))
    """), p).mappings().first()

    issued = _f(flow["issued"])
    has_plan = bool(plan and plan["months"])
    planned_cum = _f(plan["cum"]) if has_plan else None
    planned_lpc = _f(plan["l_per_cum"]) if has_plan else None
    planned_rate = _f(plan["rate"]) if has_plan else None
    planned_cost = _f(plan["cost"]) if has_plan else None
    planned_litres = (round(planned_cost / planned_rate, 0)
                      if planned_cost and planned_rate else None)

    actual_lpc = round(issued / total_cum, 3) if issued and total_cum else None
    actual_cost = round(issued * float(rate), 2) if issued and rate else None
    actual_cpc = (round(actual_cost / total_cum, 2)
                  if actual_cost and total_cum else None)

    def share(actual, planned):
        """Actual as a share of plan.

        The two shares side by side ARE the decomposition: whichever fell
        further is the one that moved the ratio.
        """
        if actual is None or not planned:
            return None
        return round(100.0 * actual / planned, 1)

    return {
        "from": frm.isoformat(), "to": to.isoformat(),
        "flow": {
            "received_l": _f(flow["received"]),
            "transferred_l": _f(flow["transferred"]),
            "issued_l": issued,
            "issue_count": flow["issue_count"],
            "by_consumer_kind": by_kind,
            "top_consumers": top,
            "rate_per_l": _f(rate) or None,
        },
        "excavation": {
            **{k: round(v, 2) for k, v in exc.items()},
            "total_cum": total_cum,
            "ore_t_per_cum": t_per_cum,
            "ok": exc_ok, "problem": exc_problem,
        },
        "plan": None if not has_plan else {
            "months": plan["months"], "cum": planned_cum,
            "l_per_cum": planned_lpc, "rate_per_l": planned_rate,
            "total_cost": planned_cost, "litres": planned_litres,
            "cost_per_cum": (round(planned_cost / planned_cum, 2)
                             if planned_cost and planned_cum else None),
        },
        "actual": {
            "litres": issued or None, "cost": actual_cost,
            "l_per_cum": actual_lpc, "cost_per_cum": actual_cpc,
        },
        # Both sides of the fraction, as a share of plan. No verdict.
        "variance": {
            "litres_pct_of_plan": share(issued or None, planned_litres),
            "cum_pct_of_plan": share(total_cum or None, planned_cum),
            "l_per_cum_pct_of_plan": share(actual_lpc, planned_lpc),
            "rate_pct_of_plan": share(_f(rate) or None, planned_rate),
        },
        # What is missing, said plainly rather than shown as a zero.
        "gaps": [g for g in [
            "nothing has been issued through the portal for this range yet, "
            "so the fuel side of every ratio is empty. It fills in as the "
            "fuel point books issues — this is a live record, not a monthly "
            "return" if not issued else None,
            "no delivery rate has been recorded, so cost per cubic metre "
            "cannot be worked out" if issued and not rate else None,
            "no business plan is on file for this range, so there is nothing "
            "to compare against" if not has_plan else None,
            exc_problem,
        ] if g],
    }


# ──────────────────────────────────────────────────────────────────────────
#  Capture. The portal is the record, not a monthly return.
# ──────────────────────────────────────────────────────────────────────────
@router.post("/consumer-meter")
def consumer_meter(request: Request, body: dict = Body(...),
                   pg: Session = Depends(get_minehub_db)) -> dict:
    """The hour meter or odometer on a machine, captured where it is read.

    This is the number that turns litres into litres-per-hour, and the reason
    the old logbooks could not produce it: the reading lived on a different
    sheet from the fuel, and the sheet subtracted a blank cell when a shift
    ended without a closing figure — 120 rows across 86 of 98 sheets carried a
    negative working-hours figure and the error compounded down the month.

    Here both readings are stored and the difference is derived, so a missing
    closing reading leaves a gap rather than a negative number that looks like
    data. And as with the pump, a reading that goes backwards is recorded and
    flagged, never refused: a meter does get replaced, and an operator who is
    told their reading is invalid stops typing readings.
    """
    _require(request, RECORD, "record machine readings")
    cid, on = body.get("consumer_id"), body.get("on_date")
    if not cid or not on:
        raise HTTPException(422, "A machine and a date are needed.")

    c = pg.execute(text(
        "SELECT code, meter_kind FROM fuel_consumer WHERE consumer_id = :c"),
        {"c": cid}).mappings().first()
    if not c:
        raise HTTPException(404, "That machine is not on the list.")
    kind = body.get("meter_kind") or c["meter_kind"]
    if kind == "NONE":
        raise HTTPException(
            422, f"{c['code']} has no hour meter or odometer recorded against "
                 f"it. Set what it is measured in first — otherwise its hours "
                 f"and its kilometres end up in one column.")

    opening, closing = body.get("opening_reading"), body.get("closing_reading")
    if opening is None and closing is None:
        raise HTTPException(422, "At least one reading is needed.")

    reasons = []
    if opening is not None and closing is not None and float(closing) < float(opening):
        reasons.append("the closing reading is below the opening")
    # The last reading we hold for this machine, so a jump is visible at entry
    # rather than in a report a fortnight later.
    prev = pg.execute(text("""
        SELECT closing_reading FROM consumer_meter_reading
         WHERE consumer_id = :c AND meter_kind = :k
           AND closing_reading IS NOT NULL AND on_date < CAST(:on AS date)
         ORDER BY on_date DESC, shift DESC LIMIT 1
    """), {"c": cid, "k": kind, "on": on}).scalar()
    if prev is not None and opening is not None and float(opening) < float(prev):
        reasons.append(f"the opening reading is below the last one recorded ({prev})")

    row = pg.execute(text("""
        INSERT INTO consumer_meter_reading (
            consumer_id, on_date, shift, meter_kind, opening_reading,
            closing_reading, idle_hours, breakdown_hours, is_suspect,
            suspect_reason, source, entered_by, note)
        VALUES (:c, :on, :shift, :k, :op, :cl, :idle, :bd, :sus, :reason,
                :src, :by, :note)
        ON CONFLICT (consumer_id, on_date, shift) DO UPDATE SET
            meter_kind = EXCLUDED.meter_kind,
            opening_reading = COALESCE(EXCLUDED.opening_reading,
                                       consumer_meter_reading.opening_reading),
            closing_reading = COALESCE(EXCLUDED.closing_reading,
                                       consumer_meter_reading.closing_reading),
            idle_hours = COALESCE(EXCLUDED.idle_hours,
                                  consumer_meter_reading.idle_hours),
            breakdown_hours = COALESCE(EXCLUDED.breakdown_hours,
                                       consumer_meter_reading.breakdown_hours),
            is_suspect = EXCLUDED.is_suspect,
            suspect_reason = EXCLUDED.suspect_reason,
            entered_by = EXCLUDED.entered_by,
            note = COALESCE(EXCLUDED.note, consumer_meter_reading.note)
        RETURNING consumer_meter_id
    """), {"c": cid, "on": on, "shift": body.get("shift") or "GEN", "k": kind,
           "op": opening, "cl": closing, "idle": body.get("idle_hours"),
           "bd": body.get("breakdown_hours"),
           "sus": bool(reasons), "reason": "; ".join(reasons) or None,
           "src": body.get("source") or "MANUAL", "by": _who(request),
           "note": body.get("note")}).mappings().first()
    pg.commit()
    worked = (round(float(closing) - float(opening), 2)
              if opening is not None and closing is not None
              and float(closing) >= float(opening) else None)
    return {"ok": True, "consumer_meter_id": row["consumer_meter_id"],
            "flagged": bool(reasons),
            "worked": worked,
            "unit": "hours" if kind == "HMR" else "km",
            "message": ("Recorded, and flagged for review: " + "; ".join(reasons))
                       if reasons else "Recorded."}


@router.get("/daybook")
def daybook(request: Request,
            on: date | None = Query(None),
            pg: Session = Depends(get_minehub_db)) -> dict:
    """Everything the portal captured on one day, as it was captured.

    The shift in-charge's view. Not a report assembled at month end from a
    workbook somebody filled in from memory — a running record of what was
    handed out, to what, by whom, and what the meters read.
    """
    _require(request, VIEW, "see fuel management")
    day = on or date.today()

    issues = [{
        "issue_id": r["issue_id"], "shift": r["shift"],
        "point": r["point"], "consumer": r["consumer"], "code": r["code"],
        "litres": _f(r["litres"]), "meter_reading": _f(r["meter_reading"]) or None,
        "meter_kind": r["meter_kind"], "capture_mode": r["capture_mode"],
        "source": r["source"], "issued_by": r["issued_by"],
        "received_by": r["received_by"], "entered_by": r["entered_by"],
        "at": r["created_at"],
    } for r in pg.execute(text("""
        SELECT i.issue_id, i.shift, i.litres, i.meter_reading, i.meter_kind,
               i.capture_mode, i.source, i.issued_by, i.received_by,
               i.entered_by, i.created_at,
               p.label AS point, c.label AS consumer, c.code
          FROM fuel_issue i
          JOIN fuel_issuing_point p ON p.issuing_point_id = i.issuing_point_id
          JOIN fuel_consumer c ON c.consumer_id = i.consumer_id
         WHERE i.on_date = :d
         ORDER BY i.created_at DESC
    """), {"d": day}).mappings()]

    readings = [{
        "point": r["point"], "shift": r["shift"],
        "opening": _f(r["opening_reading"]) or None,
        "closing": _f(r["closing_reading"]) or None,
        "dispensed": (_f(r["closing_reading"]) - _f(r["opening_reading"]))
                     if r["opening_reading"] is not None
                     and r["closing_reading"] is not None else None,
        "flagged": r["is_suspect"], "reason": r["suspect_reason"],
        "by": r["entered_by"], "paper_ref": r["paper_ref"],
    } for r in pg.execute(text("""
        SELECT m.shift, m.opening_reading, m.closing_reading, m.is_suspect,
               m.suspect_reason, m.entered_by, m.paper_ref, p.label AS point
          FROM fuel_meter_reading m
          JOIN fuel_issuing_point p ON p.issuing_point_id = m.issuing_point_id
         WHERE m.on_date = :d ORDER BY p.code, m.shift
    """), {"d": day}).mappings()]

    meters = [{
        "code": r["code"], "consumer": r["label"], "shift": r["shift"],
        "meter_kind": r["meter_kind"],
        "opening": _f(r["opening_reading"]) or None,
        "closing": _f(r["closing_reading"]) or None,
        "worked": (round(_f(r["closing_reading"]) - _f(r["opening_reading"]), 2)
                   if r["opening_reading"] is not None
                   and r["closing_reading"] is not None
                   and _f(r["closing_reading"]) >= _f(r["opening_reading"])
                   else None),
        "flagged": r["is_suspect"], "reason": r["suspect_reason"],
    } for r in pg.execute(text("""
        SELECT c.code, c.label, m.shift, m.meter_kind, m.opening_reading,
               m.closing_reading, m.is_suspect, m.suspect_reason
          FROM consumer_meter_reading m
          JOIN fuel_consumer c ON c.consumer_id = m.consumer_id
         WHERE m.on_date = :d ORDER BY c.code, m.shift
    """), {"d": day}).mappings()]

    # What a machine burnt per hour, from what the portal captured today and
    # nowhere else. Only where BOTH the fuel and the hours were captured —
    # anything else is a division with a hole in it.
    rates = [{
        "code": r["code"], "consumer": r["label"], "litres": _f(r["litres"]),
        "worked": _f(r["worked"]), "meter_kind": r["meter_kind"],
        "per_unit": round(_f(r["litres"]) / _f(r["worked"]), 2)
                    if _f(r["worked"]) else None,
    } for r in pg.execute(text("""
        SELECT c.code, c.label, m.meter_kind,
               SUM(i.litres) AS litres,
               MAX(m.closing_reading) - MIN(m.opening_reading) AS worked
          FROM fuel_issue i
          JOIN fuel_consumer c ON c.consumer_id = i.consumer_id
          JOIN consumer_meter_reading m ON m.consumer_id = c.consumer_id
                                       AND m.on_date = i.on_date
         WHERE i.on_date = :d
           AND m.opening_reading IS NOT NULL AND m.closing_reading IS NOT NULL
           AND NOT m.is_suspect
         GROUP BY c.code, c.label, m.meter_kind
         HAVING MAX(m.closing_reading) > MIN(m.opening_reading)
         ORDER BY SUM(i.litres) DESC
    """), {"d": day}).mappings()]

    return {
        "on": day.isoformat(),
        "issues": issues, "meter_readings": readings, "machine_meters": meters,
        "rates": rates,
        "totals": {
            "litres": round(sum(i["litres"] for i in issues), 2),
            "issues": len(issues),
            "machines": len({i["code"] for i in issues}),
            "flagged": sum(1 for r in readings if r["flagged"])
                       + sum(1 for m in meters if m["flagged"]),
        },
    }


# ──────────────────────────────────────────────────────────────────────────
#  The tanker arriving, against a purchase order
# ──────────────────────────────────────────────────────────────────────────
@router.post("/tanker")
def tanker_in(request: Request, body: dict = Body(...),
              pg: Session = Depends(get_minehub_db)) -> dict:
    """A tanker arrives, is checked, dipped, decanted and signed for.

    THREE QUANTITIES, NOT ONE. What the PO allows, what the vendor invoiced,
    what the dips say the tank gained, and what the storekeeper accepted.
    They disagree more often than not -- temperature, a short load, a hose left
    part full -- and the differences are the only things here worth escalating.

    AND THE SEAL, WHICH IS NOT A FORMALITY. A quantity recorded without the
    seal's condition throws away the only evidence that tells a short delivery
    apart from a load opened on the road.

    QUALITY IS CHECKED AGAINST A SPECIFICATION, not against a number in this
    file. Out of range raises a question; it does not reject the load, because
    the man at the gate is not the person who decides to turn a tanker away.

    SAP owns the purchase order and the GRN. po_no, po_litres and grn_ref are
    references. Nothing is posted.
    """
    _require(request, RECORD, "record fuel receipts")
    for k in ("issuing_point_id", "on_date", "litres"):
        if body.get(k) in (None, ""):
            raise HTTPException(
                422, "The tank, the date and the litres accepted are needed.")

    litres = float(body["litres"])
    if not (0 < litres < 100000):
        raise HTTPException(422, "Accepted litres must be between 0 and 100,000.")
    invoice = body.get("invoice_litres")
    po_litres = body.get("po_litres")
    before, after = body.get("dip_before"), body.get("dip_after")
    material_id = body.get("material_id")

    # ── the questions this delivery raises ───────────────────────────────
    reasons: list[str] = []
    dip_gain = None
    if before is not None and after is not None:
        dip_gain = round(float(after) - float(before), 2)
        if dip_gain <= 0:
            reasons.append("the tank did not gain anything between the two dips")
        elif abs(dip_gain - litres) > max(litres * 0.01, 25):
            reasons.append(f"the dips say {dip_gain:g} L but {litres:g} was accepted")
    if invoice is not None and abs(float(invoice) - litres) > max(litres * 0.005, 20):
        short = float(invoice) - litres
        reasons.append(f"the invoice says {float(invoice):g} L, "
                       f"{abs(short):g} L {'more' if short > 0 else 'less'} than accepted")
    if po_litres is not None and litres > float(po_litres) * 1.02:
        reasons.append(f"more was accepted than the purchase order allows "
                       f"({float(po_litres):g} L)")

    seal = body.get("seal_condition")
    if seal in ("BROKEN", "MISSING"):
        reasons.append(f"the seal was {seal.lower()} on arrival")

    # Against the specification in force, not against a constant here.
    spec = None
    if material_id:
        spec = pg.execute(text("""
            SELECT density_min, density_max, density_ref_temp_c, temp_max_c,
                   water_sediment_allowed
              FROM fuel_quality_spec
             WHERE material_id = :m AND effective_to IS NULL
             ORDER BY effective_from DESC LIMIT 1
        """), {"m": material_id}).mappings().first()
    density = body.get("density")
    temp = body.get("temperature_c")
    water = body.get("water_sediment")
    if spec:
        if density is not None:
            lo, hi = spec["density_min"], spec["density_max"]
            if lo is not None and hi is not None and not (
                    float(lo) <= float(density) <= float(hi)):
                reasons.append(f"density {float(density):g} is outside the "
                               f"{float(lo):g}-{float(hi):g} range for this material")
        if temp is not None and spec["temp_max_c"] is not None \
                and float(temp) > float(spec["temp_max_c"]):
            reasons.append(f"temperature {float(temp):g} C is above the "
                           f"{float(spec['temp_max_c']):g} C limit")
        if water and not spec["water_sediment_allowed"]:
            reasons.append("water or sediment was found")

    row = pg.execute(text("""
        INSERT INTO fuel_receipt (
            receipt_no,
            issuing_point_id, on_date, material_id, litres, invoice_litres,
            po_litres, rate_per_l,
            po_no, po_line, challan_no, grn_ref, storage_location,
            supplier_party_id, transporter_party_id, transporter,
            tanker_no, driver_name, driver_mobile, driver_licence,
            seal_no, seal_condition,
            dip_before, dip_after, arrived_at, decanted_at,
            density, temperature_c, water_sediment, sample_ref,
            quality_status, quality_remarks,
            received_by, approval_status, is_suspect, suspect_reason,
            note, entered_by)
        VALUES (
            'FR-' || TO_CHAR(CAST(:on AS date), 'YYMMDD') || '-' ||
            LPAD((SELECT COUNT(*) + 1 FROM fuel_receipt
                   WHERE on_date = CAST(:on AS date))::text, 3, '0'),
            :pid, :on, :mid, :litres, :invoice, :po_litres, :rate,
            :po, :po_line, :challan, :grn, :storeloc,
            :supplier, :transporter_id, :transporter,
            :tanker, :driver, :mobile, :licence,
            :seal_no, :seal_cond,
            :before, :after, :arrived, :decanted,
            :density, :temp, :water, :sample,
            :qstatus, :qremarks,
            :received_by, 'DRAFT', :sus, :reason, :note, :by)
        RETURNING receipt_id, receipt_no
    """), {"pid": body["issuing_point_id"], "on": body["on_date"],
           "mid": material_id, "litres": litres, "invoice": invoice,
           "po_litres": po_litres, "rate": body.get("rate_per_l"),
           "po": body.get("po_no"), "po_line": body.get("po_line"),
           "challan": body.get("challan_no"), "grn": body.get("grn_ref"),
           "storeloc": body.get("storage_location"),
           "supplier": body.get("supplier_party_id"),
           "transporter_id": body.get("transporter_party_id"),
           "transporter": body.get("transporter"),
           "tanker": body.get("tanker_no"), "driver": body.get("driver_name"),
           "mobile": body.get("driver_mobile"),
           "licence": body.get("driver_licence"),
           "seal_no": body.get("seal_no"), "seal_cond": seal,
           "before": before, "after": after,
           "arrived": body.get("arrived_at"), "decanted": body.get("decanted_at"),
           "density": density, "temp": temp, "water": water,
           "sample": body.get("sample_ref"),
           "qstatus": body.get("quality_status"),
           "qremarks": body.get("quality_remarks"),
           "received_by": body.get("received_by"),
           "sus": bool(reasons), "reason": "; ".join(reasons) or None,
           "note": body.get("note"), "by": _who(request)}).mappings().first()
    pg.commit()
    return {"ok": True, "receipt_id": row["receipt_id"],
            "receipt_no": row["receipt_no"], "dip_gain": dip_gain,
            "flagged": bool(reasons), "questions": reasons,
            "message": (f"{row['receipt_no']} recorded, with "
                        f"{len(reasons)} thing{'s' if len(reasons) != 1 else ''} "
                        f"to ask about.") if reasons
                       else f"{row['receipt_no']} recorded."}


@router.get("/receipt-masters")
def receipt_masters(request: Request,
                    pg: Session = Depends(get_minehub_db)) -> dict:
    """Everything the tanker form needs to offer instead of a free-text box.

    DRIVERS ARE DELIBERATELY NOT A MASTER. A tanker driver changes week to
    week, and a master nobody maintains is worse than free text -- it goes
    stale and people work around it. Past receipts are the suggestion list
    instead, so the names on offer are the ones actually seen at this gate.
    """
    _require(request, VIEW, "see fuel management")

    materials = [{"material_id": r["material_id"], "code": r["code"],
                  "label": r["label"], "uom": r["uom"]}
                 for r in pg.execute(text("""
        SELECT material_id, code, label, uom FROM fuel_material
         WHERE is_active ORDER BY code
    """)).mappings()]

    specs = {r["material_id"]: {
        "density_min": _f(r["density_min"]) or None,
        "density_max": _f(r["density_max"]) or None,
        "density_ref_temp_c": _f(r["density_ref_temp_c"]) or None,
        "temp_max_c": _f(r["temp_max_c"]) or None,
        "water_sediment_allowed": r["water_sediment_allowed"],
    } for r in pg.execute(text("""
        SELECT * FROM fuel_quality_spec WHERE effective_to IS NULL
    """)).mappings()}

    # Organisations only. party also holds people, and offering an operator as
    # a fuel vendor is the kind of list that gets ignored.
    parties = [{"party_id": r["party_id"], "name": r["display_name"],
                "gstin": r["gstin"]}
               for r in pg.execute(text("""
        SELECT party_id, display_name, gstin FROM party
         WHERE party_type <> 'PERSON' AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
         ORDER BY display_name LIMIT 500
    """)).mappings()]

    def seen(col: str) -> list[str]:
        return [r[0] for r in pg.execute(text(f"""
            SELECT DISTINCT {col} FROM fuel_receipt
             WHERE {col} IS NOT NULL AND TRIM({col}) <> ''
             ORDER BY {col} LIMIT 200
        """)).all()]

    return {
        "materials": materials, "specs": specs, "parties": parties,
        # The suggestion lists, built from what has actually come through.
        "drivers": seen("driver_name"), "tankers": seen("tanker_no"),
        "transporters": seen("transporter"),
        "storage_locations": seen("storage_location"),
        "seal_conditions": ["INTACT", "BROKEN", "MISSING", "NOT_SEALED"],
        "quality_statuses": ["PASSED", "FAILED", "PENDING", "NOT_TESTED"],
        "document_kinds": ["INVOICE", "CHALLAN", "EWAY_BILL", "DELIVERY_NOTE",
                           "TANKER_PHOTO", "SEAL_PHOTO", "DIP_EVIDENCE",
                           "QUALITY_REPORT", "OTHER"],
    }


@router.get("/receipt/{receipt_id}")
def receipt_detail(receipt_id: int, request: Request,
                   pg: Session = Depends(get_minehub_db)) -> dict:
    """One delivery in full, with its paperwork."""
    _require(request, VIEW, "see fuel management")
    r = pg.execute(text("""
        SELECT r.*, p.label AS point, m.code AS material,
               s.display_name AS supplier, t.display_name AS transporter_name
          FROM fuel_receipt r
          JOIN fuel_issuing_point p USING (issuing_point_id)
          LEFT JOIN fuel_material m ON m.material_id = r.material_id
          LEFT JOIN party s ON s.party_id = r.supplier_party_id
          LEFT JOIN party t ON t.party_id = r.transporter_party_id
         WHERE r.receipt_id = :id
    """), {"id": receipt_id}).mappings().first()
    if not r:
        raise HTTPException(404, "No such delivery.")
    out = {k: (_f(v) if isinstance(v, Decimal) else v) for k, v in r.items()}
    out["dip_gain"] = (_f(r["dip_after"]) - _f(r["dip_before"])) \
        if r["dip_after"] is not None and r["dip_before"] is not None else None
    out["documents"] = [{
        "fuel_document_id": d["fuel_document_id"], "kind": d["kind"],
        "title": d["title"], "file_name": d["file_name"],
        "content_type": d["content_type"], "size_bytes": d["size_bytes"],
        "uploaded_by": d["uploaded_by"], "uploaded_at": d["uploaded_at"],
    } for d in pg.execute(text("""
        SELECT * FROM fuel_receipt_document WHERE receipt_id = :id
         ORDER BY uploaded_at
    """), {"id": receipt_id}).mappings()]
    return out


@router.put("/receipt/{receipt_id}/verify")
def verify_receipt(receipt_id: int, request: Request, body: dict = Body(...),
                   pg: Session = Depends(get_minehub_db)) -> dict:
    """A second person checks the delivery, or accepts it into stock.

    Received and verified are two people and two moments. One name against
    both is not a control, so this refuses to let the person who entered a
    delivery be the one who verifies it.
    """
    _require(request, RECORD, "verify fuel receipts")
    st = (body.get("approval_status") or "").upper()
    if st not in ("VERIFIED", "APPROVED", "REJECTED"):
        raise HTTPException(
            422, "approval_status must be VERIFIED, APPROVED or REJECTED.")
    if st == "REJECTED" and not (body.get("quality_remarks") or "").strip():
        raise HTTPException(422, "A rejected delivery needs a reason.")

    who = _who(request)
    was = pg.execute(text(
        "SELECT entered_by, approval_status FROM fuel_receipt WHERE receipt_id = :id"),
        {"id": receipt_id}).mappings().first()
    if not was:
        raise HTTPException(404, "No such delivery.")
    if st == "VERIFIED" and who and was["entered_by"] == who:
        raise HTTPException(
            409, "The person who recorded a delivery cannot also verify it. "
                 "That is the whole point of the second check.")

    pg.execute(text("""
        UPDATE fuel_receipt
           SET approval_status = :st,
               verified_by = COALESCE(:vb, verified_by),
               verified_at = now(),
               grn_ref = COALESCE(:grn, grn_ref),
               quality_remarks = COALESCE(:qr, quality_remarks)
         WHERE receipt_id = :id
    """), {"id": receipt_id, "st": st, "vb": body.get("verified_by") or who,
           "grn": body.get("grn_ref"), "qr": body.get("quality_remarks")})
    pg.commit()
    return {"ok": True, "approval_status": st}


@router.post("/receipt/{receipt_id}/document")
async def upload_receipt_document(receipt_id: int, request: Request,
                                  file: UploadFile = File(...),
                                  kind: str = Query("OTHER"),
                                  title: str = Query(""),
                                  pg: Session = Depends(get_minehub_db)) -> dict:
    """Attach the invoice, the challan, the seal photograph, the dip slip.

    A challan number is a promise that a document exists. The document is what
    settles an argument, and the argument happens months later.

    Same shape as asset_document, which already works: the bytes on disk, the
    row in the database, and the original filename kept because 'scan_0041.pdf'
    is not what anybody will search for.
    """
    _require(request, RECORD, "attach fuel documents")
    if not pg.execute(text("SELECT 1 FROM fuel_receipt WHERE receipt_id = :id"),
                      {"id": receipt_id}).first():
        raise HTTPException(404, "No such delivery.")

    suffix = FUEL_FILE_TYPES.get(file.content_type or "")
    if not suffix:
        raise HTTPException(
            400, "That file type cannot be attached. PDFs, images, Word and "
                 f"Excel files can (this was {file.content_type or 'unrecognised'}).")
    payload = await file.read()
    if not payload:
        raise HTTPException(400, "That file is empty.")
    if len(payload) > FUEL_MAX_UPLOAD:
        raise HTTPException(400, "That file is larger than 15 MB.")

    FUEL_DOCUMENT_ROOT.mkdir(parents=True, exist_ok=True)
    stored = f"{receipt_id}-{uuid4().hex}{suffix}"
    (FUEL_DOCUMENT_ROOT / stored).write_bytes(payload)

    row = pg.execute(text("""
        INSERT INTO fuel_receipt_document (receipt_id, kind, title, file_name,
                                          stored_name, content_type,
                                          size_bytes, uploaded_by)
        VALUES (:r, :k, :t, :fn, :sn, :ct, :sz, :by)
        RETURNING fuel_document_id, kind, title, file_name, size_bytes,
                  uploaded_at
    """), {"r": receipt_id, "k": (kind or "OTHER").upper(),
           "t": title.strip() or None, "fn": file.filename or stored,
           "sn": stored, "ct": file.content_type, "sz": len(payload),
           "by": _who(request)}).mappings().first()
    pg.commit()
    return dict(row)


@router.get("/receipt/{receipt_id}/document/{document_id}")
def download_receipt_document(receipt_id: int, document_id: int,
                              request: Request,
                              pg: Session = Depends(get_minehub_db)):
    """Hand back the file. Streamed from disk under its original name."""
    _require(request, VIEW, "see fuel management")
    d = pg.execute(text("""
        SELECT stored_name, file_name, content_type FROM fuel_receipt_document
         WHERE fuel_document_id = :d AND receipt_id = :r
    """), {"d": document_id, "r": receipt_id}).mappings().first()
    if not d:
        raise HTTPException(404, "No such document.")
    path = FUEL_DOCUMENT_ROOT / d["stored_name"]
    if not path.exists():
        raise HTTPException(
            410, "The record of that file is here but the file itself is not "
                 "on disk any more.")
    return FileResponse(path, media_type=d["content_type"] or "application/octet-stream",
                        filename=d["file_name"])


@router.get("/tankers")
def tankers(request: Request,
            day_from: date | None = Query(None),
            day_to: date | None = Query(None),
            pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """Deliveries in the range, with the invoice-against-dip question visible."""
    _require(request, VIEW, "see fuel management")
    frm, to = _window(day_from, day_to)
    return [{
        "receipt_id": r["receipt_id"], "on_date": r["on_date"],
        "point": r["point"], "po_no": r["po_no"], "challan_no": r["challan_no"],
        "tanker_no": r["tanker_no"], "transporter": r["transporter"],
        "litres": _f(r["litres"]), "invoice_litres": _f(r["invoice_litres"]) or None,
        "dip_gain": (_f(r["dip_after"]) - _f(r["dip_before"]))
                    if r["dip_after"] is not None and r["dip_before"] is not None
                    else None,
        "rate_per_l": _f(r["rate_per_l"]) or None,
        "arrived_at": r["arrived_at"], "decanted_at": r["decanted_at"],
        "received_by": r["received_by"],
        "flagged": r["is_suspect"], "reason": r["suspect_reason"],
    } for r in pg.execute(text("""
        SELECT r.*, p.label AS point
          FROM fuel_receipt r
          JOIN fuel_issuing_point p USING (issuing_point_id)
         WHERE r.on_date BETWEEN :frm AND :to
         ORDER BY r.on_date DESC, r.receipt_id DESC
    """), {"frm": frm, "to": to}).mappings()]


# ──────────────────────────────────────────────────────────────────────────
#  An order, and then the fill that answers it
# ──────────────────────────────────────────────────────────────────────────
@router.post("/order")
def raise_order(request: Request, body: dict = Body(...),
                pg: Session = Depends(get_minehub_db)) -> dict:
    """Raise an indent for fuel.

    The order number is generated rather than typed, because two people
    raising orders at the same fuel point on the same morning will otherwise
    pick the same number.
    """
    _require(request, RECORD, "raise fuel orders")
    for k in ("consumer_id", "requested_l", "on_date"):
        if body.get(k) in (None, ""):
            raise HTTPException(422, "A machine, a quantity and a date are needed.")
    want = float(body["requested_l"])
    if not (0 < want < 20000):
        raise HTTPException(422, "A quantity must be between 0 and 20,000 litres.")

    row = pg.execute(text("""
        INSERT INTO fuel_order (
            order_no, on_date, shift, consumer_id, issuing_point_id, nozzle_id,
            requested_l, purpose, requested_by, note, created_by)
        VALUES (
            'FO-' || TO_CHAR(CAST(:on AS date), 'YYMMDD') || '-' ||
            LPAD((SELECT COUNT(*) + 1 FROM fuel_order
                   WHERE on_date = CAST(:on AS date))::text, 3, '0'),
            :on, :shift, :cid, :pid, :nid, :want, :purpose, :req, :note, :by)
        RETURNING order_id, order_no
    """), {"on": body["on_date"], "shift": body.get("shift") or "GEN",
           "cid": body["consumer_id"],
           "pid": body.get("issuing_point_id"), "nid": body.get("nozzle_id"),
           "want": want, "purpose": body.get("purpose"),
           "req": body.get("requested_by"), "note": body.get("note"),
           "by": _who(request)}).mappings().first()
    pg.commit()
    return {"ok": True, "order_id": row["order_id"], "order_no": row["order_no"]}


@router.get("/orders")
def orders(request: Request,
           on: date | None = Query(None),
           status: str = Query("PENDING"),
           pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """Orders, with how much of each has actually been filled.

    `filled_l` is summed from the issues rather than stored, so it cannot
    drift from them. PENDING means anything still expecting fuel.
    """
    _require(request, VIEW, "see fuel management")
    day = on or date.today()
    st = status.upper()
    return [{
        "order_id": r["order_id"], "order_no": r["order_no"],
        "on_date": r["on_date"], "shift": r["shift"], "status": r["status"],
        "consumer_id": r["consumer_id"], "code": r["code"],
        "consumer": r["consumer"], "meter_kind": r["meter_kind"],
        "point": r["point"], "nozzle": r["nozzle"],
        "requested_l": _f(r["requested_l"]),
        "filled_l": _f(r["filled_l"]),
        "outstanding_l": round(max(_f(r["requested_l"]) - _f(r["filled_l"]), 0), 2),
        "fills": r["fills"],
        "purpose": r["purpose"], "requested_by": r["requested_by"],
    } for r in pg.execute(text("""
        SELECT o.*, c.code, c.label AS consumer, c.meter_kind,
               p.label AS point, n.label AS nozzle,
               COALESCE((SELECT SUM(i.litres) FROM fuel_issue i
                          WHERE i.order_id = o.order_id), 0) AS filled_l,
               (SELECT COUNT(*) FROM fuel_issue i
                 WHERE i.order_id = o.order_id) AS fills
          FROM fuel_order o
          JOIN fuel_consumer c USING (consumer_id)
          LEFT JOIN fuel_issuing_point p USING (issuing_point_id)
          LEFT JOIN fuel_nozzle n ON n.nozzle_id = o.nozzle_id
         WHERE (:st = 'PENDING' AND o.status IN ('OPEN', 'PART_FILLED')
                OR :st = 'ALL'
                OR o.status = :st)
           AND (:st = 'PENDING' OR o.on_date = :d)
         ORDER BY o.on_date DESC, o.order_no DESC
         LIMIT 200
    """), {"st": st, "d": day}).mappings()]


@router.put("/order/{order_id}")
def set_order(order_id: int, request: Request, body: dict = Body(...),
              pg: Session = Depends(get_minehub_db)) -> dict:
    """Approve or cancel an order.

    OPEN, PART_FILLED and FILLED are derived from the fills by a trigger and
    cannot be set here — a status somebody types is a status that disagrees
    with the litres.
    """
    _require(request, RECORD, "change fuel orders")
    st = (body.get("status") or "").upper()
    if st not in ("CANCELLED", "EXPIRED", ""):
        raise HTTPException(
            422, "Only CANCELLED or EXPIRED can be set by hand; the rest "
                 "follows from what was actually filled.")
    sets, params = [], {"id": order_id}
    if st:
        sets.append("status = :st"); params["st"] = st
    if "approved_by" in body:
        sets.append("approved_by = :ab, approved_at = now()")
        params["ab"] = body.get("approved_by") or _who(request)
    if "note" in body:
        sets.append("note = :note"); params["note"] = body.get("note")
    if not sets:
        raise HTTPException(422, "Nothing to change.")
    done = pg.execute(text(
        f"UPDATE fuel_order SET {', '.join(sets)} "
        f"WHERE order_id = :id RETURNING order_id"), params).first()
    if not done:
        raise HTTPException(404, "No such order.")
    pg.commit()
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────────
#  Nozzles, maintained from the screen
# ──────────────────────────────────────────────────────────────────────────
@router.get("/nozzles")
def nozzles(request: Request, pg: Session = Depends(get_minehub_db)) -> list[dict]:
    _require(request, VIEW, "see fuel management")
    return [{
        "nozzle_id": r["nozzle_id"], "issuing_point_id": r["issuing_point_id"],
        "point": r["point"], "code": r["code"], "label": r["label"],
        "kind": r["kind"], "has_totaliser": r["has_totaliser"],
        "is_active": r["is_active"], "note": r["note"],
    } for r in pg.execute(text("""
        SELECT n.*, p.label AS point FROM fuel_nozzle n
          JOIN fuel_issuing_point p USING (issuing_point_id)
         ORDER BY p.code, n.code
    """)).mappings()]


@router.post("/nozzle")
def add_nozzle(request: Request, body: dict = Body(...),
               pg: Session = Depends(get_minehub_db)) -> dict:
    """Another nozzle, or a point that has grown one."""
    _require(request, MANAGE, "change fuel masters")
    for k in ("issuing_point_id", "code", "label"):
        if not body.get(k):
            raise HTTPException(422, "A point, a code and a name are needed.")
    kind = body.get("kind") or "FIXED"
    if kind not in ("FIXED", "MOBILE"):
        raise HTTPException(422, "kind must be FIXED or MOBILE.")
    try:
        row = pg.execute(text("""
            INSERT INTO fuel_nozzle (issuing_point_id, code, label, kind,
                                     has_totaliser, note, created_by)
            VALUES (:pid, :code, :label, :kind, :tot, :note, :by)
            RETURNING nozzle_id
        """), {"pid": body["issuing_point_id"], "code": body["code"].strip(),
               "label": body["label"].strip(), "kind": kind,
               "tot": bool(body.get("has_totaliser", True)),
               "note": body.get("note"), "by": _who(request)}).mappings().first()
        pg.commit()
    except Exception as exc:                            # noqa: BLE001
        pg.rollback()
        raise HTTPException(409, "That nozzle code is already on this point.") from exc
    return {"ok": True, "nozzle_id": row["nozzle_id"]}


@router.put("/nozzle/{nozzle_id}")
def set_nozzle(nozzle_id: int, request: Request, body: dict = Body(...),
               pg: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "change fuel masters")
    sets, params = [], {"id": nozzle_id}
    for k in ("label", "note"):
        if k in body:
            sets.append(f"{k} = :{k}"); params[k] = body[k]
    for k in ("has_totaliser", "is_active"):
        if k in body:
            sets.append(f"{k} = :{k}"); params[k] = bool(body[k])
    if "kind" in body:
        if body["kind"] not in ("FIXED", "MOBILE"):
            raise HTTPException(422, "kind must be FIXED or MOBILE.")
        sets.append("kind = :kind"); params["kind"] = body["kind"]
    if not sets:
        raise HTTPException(422, "Nothing to change.")
    done = pg.execute(text(
        f"UPDATE fuel_nozzle SET {', '.join(sets)} "
        f"WHERE nozzle_id = :id RETURNING nozzle_id"), params).first()
    if not done:
        raise HTTPException(404, "No such nozzle.")
    pg.commit()
    return {"ok": True}
