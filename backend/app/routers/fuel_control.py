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

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/fuel-control", tags=["fuel-control"])

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

    return {"points": points, "consumers": consumers, "tolerances": tolerances,
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

    row = pg.execute(text("""
        INSERT INTO fuel_issue (
            on_date, shift, issuing_point_id, consumer_id, litres,
            meter_reading, meter_kind, capture_mode, source,
            issued_by, received_by, note, entered_by)
        VALUES (:on, :shift, :pid, :cid, :litres, :meter,
                NULLIF(:mkind, 'NONE'), :cap, :src,
                :issued_by, :received_by, :note, :by)
        RETURNING issue_id
    """), {"on": body["on_date"], "shift": body.get("shift") or "GEN",
           "pid": body["issuing_point_id"], "cid": body["consumer_id"],
           "litres": litres, "meter": body.get("meter_reading"),
           "mkind": c["meter_kind"], "cap": c["capture_mode"],
           "src": body.get("source") or "MANUAL",
           "issued_by": body.get("issued_by"),
           "received_by": body.get("received_by"),
           "note": body.get("note"), "by": _who(request)}).mappings().first()
    pg.commit()
    return {"ok": True, "issue_id": row["issue_id"]}


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
