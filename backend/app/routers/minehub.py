"""MineHub platform API — master registry.

Superadmin only; the gate is the "/api/minehub" rule in main.py, so every route
added to this router is protected by default rather than by remembering to
protect it.

Two registers are exposed here, and they are the ones everything else waits on:

  * Equipment — the mine has no authoritative fleet list today. Four partial
    lists exist, none complete.
  * Identity  — telematics calls a machine MAN18, the handover register calls it
    MAN-18, and no query joins them. Two alias rows fix that permanently.
"""
from __future__ import annotations

import json
import re
from uuid import uuid4
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db, test_connection
from app.services import people

router = APIRouter(prefix="/api/minehub", tags=["MineHub"])

IDENTITY_SYSTEMS = ("TELEMATICS", "HOTO", "WEIGHBRIDGE", "RFID", "SAP", "SECURITY", "LEGACY")
DOCUMENT_TYPES = ("INSURANCE", "FITNESS", "PUC", "ROAD_TAX", "PERMIT", "NATIONAL_PERMIT",
                  "STATUTORY_INSPECTION", "EXPLOSIVE_LICENCE", "POLLUTION_NOC", "OTHER")
SCHEDULE_TYPES = ("PREVENTIVE", "SERVICE", "OIL_CHANGE", "INSPECTION", "OVERHAUL",
                  "TYRE_ROTATION", "OTHER")

# Fields written straight from the registration form. Listed once so create and
# update cannot drift apart — the commonest way a form quietly stops saving a
# field someone added to only one of them.
ASSET_FIELDS = (
    "fleet_code", "nickname", "registration_no", "asset_type_id", "make", "model",
    "year_of_make", "chassis_no", "engine_no", "capacity", "capacity_uom",
    "plant_id", "ownership", "owner_party_id", "supplier_party_id",
    "sap_equipment_no", "contract_no", "service_po_no", "po_valid_from", "po_valid_to",
    "purchase_date", "purchase_cost", "hire_rate", "hire_rate_uom",
    "rated_output_per_hr", "rated_fuel_lph", "fuel_type", "propulsion", "tank_capacity_l",
    "battery_kwh", "range_km", "charging_type", "charge_time_hrs",
    "reading_uom", "current_reading", "reading_as_on",
    "home_location_id", "org_unit_id", "commissioned_on", "status",
    "tyre_count", "seating_capacity", "remarks",
)
NUMERIC_FIELDS = {"year_of_make", "capacity", "purchase_cost", "hire_rate",
                  "rated_output_per_hr", "rated_fuel_lph", "tank_capacity_l",
                  "battery_kwh", "range_km", "charge_time_hrs", "current_reading",
                  "tyre_count", "seating_capacity", "asset_type_id",
                  "owner_party_id", "supplier_party_id", "home_location_id", "org_unit_id"}
ASSET_STATUS = ("ACTIVE", "MAINTENANCE", "STANDBY", "IDLE", "DISPOSED")
LOCATION_TYPES = ("SITE", "PIT", "BENCH", "PLANT", "WORKSHOP",
                  "STOCKYARD", "WEIGHBRIDGE", "STORE", "OFFICE")
OWNERSHIP = ("OWN", "HIRED")


APPROVE_PERMISSION = "platform.registry.approve"


def _may_approve(request: Request) -> bool:
    return APPROVE_PERMISSION in (getattr(request.state, "permissions", None) or set())


def _require_approver(request: Request) -> None:
    """Deciding what goes on the register is a separate responsibility from
    filling it in, and the mine grants it from the Access Control screen."""
    if not _may_approve(request):
        raise HTTPException(
            403, "You do not have permission to approve register entries. "
                 "An Access Manager can add it to your role.")


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _activity(db, request: Request, event_type: str, *, asset_id: int | None = None,
              payload: dict | None = None) -> None:
    """Record a platform action in the event log.

    Registering a machine is day-to-day work done by users, so it belongs in the
    same append-only log as every other operational fact rather than in a
    separate admin audit. occurred_at and recorded_at are both now because the
    action happened as it was recorded — a distinction that matters for events
    captured from the field, which arrive later than they occurred.
    """
    db.execute(text("""
        INSERT INTO event (event_type, occurred_at, recorded_at, source,
                           asset_id, payload, recorded_by)
        VALUES (:t, now(), now(), 'WEB', :asset, CAST(:payload AS jsonb), :by)
    """), {"t": event_type, "asset": asset_id,
           "payload": json.dumps(payload or {}), "by": _actor(request)})


def _clean(body: dict) -> dict:
    """Form values into database values.

    A browser form sends "" for an untouched field, and "" is not a number, a
    date or a foreign key — it is the absence of one. Writing it straight
    through is how a registration form ends up failing on a field nobody filled.
    """
    out: dict = {}
    for key in ASSET_FIELDS:
        if key not in body:
            continue
        v = body[key]
        if isinstance(v, str):
            v = v.strip()
        if v == "" or v is None:
            out[key] = None
            continue
        if key in NUMERIC_FIELDS:
            try:
                out[key] = float(v) if not str(v).isdigit() else int(v)
            except (TypeError, ValueError):
                raise HTTPException(400, f"'{key}' must be a number.")
        else:
            out[key] = v
    return out


def _next_due(sched: dict, current_reading: float | None) -> tuple:
    """When a schedule next falls due, on usage and on the calendar.

    Computed on save so 'what is due' stays a plain query instead of arithmetic
    repeated in every screen that asks.
    """
    from datetime import date, timedelta
    uom = sched.get("interval_uom")
    val = sched.get("interval_value")
    next_reading = next_date = None
    if val:
        val = float(val)
        if uom in ("HOURS", "KM"):
            base = sched.get("last_done_reading")
            base = float(base) if base not in (None, "") else (current_reading or 0)
            next_reading = base + val
        elif uom in ("DAYS", "MONTHS"):
            last = sched.get("last_done_on")
            base = date.fromisoformat(last) if last else date.today()
            next_date = base + timedelta(days=val if uom == "DAYS" else val * 30)
    return next_reading, next_date


# ---------------------------------------------------------------- platform
@router.get("/health")
def health() -> dict:
    """Platform database state — connectivity and which migrations have run."""
    return {"minehub": test_connection()}


@router.get("/me")
def whoami(request: Request) -> dict:
    """What this user may do here, so the screen offers only what will work.

    The check still happens on every write; this exists so the approve button is
    absent rather than present and refused.
    """
    return {"emp_id": _actor(request), "may_approve": _may_approve(request)}


@router.get("/summary")
def summary(db: Session = Depends(get_minehub_db)) -> dict:
    """Registry counts, for the landing screen."""
    row = db.execute(text("""
        SELECT (SELECT count(*) FROM asset)                          AS assets,
               (SELECT count(*) FROM asset WHERE status='ACTIVE')    AS assets_active,
               (SELECT count(*) FROM asset_identity)                 AS aliases,
               (SELECT count(*) FROM asset_type)                     AS asset_types,
               (SELECT count(*) FROM party WHERE party_type='PERSON') AS people,
               (SELECT count(*) FROM party WHERE party_type='ORGANISATION') AS organisations,
               (SELECT count(*) FROM location)                       AS locations,
               (SELECT count(*) FROM material)                       AS materials,
               (SELECT count(*) FROM competency)                     AS competencies,
               (SELECT count(*) FROM event)                          AS events
    """)).mappings().first()
    return dict(row)


# ------------------------------------------------------------- asset types
@router.get("/asset-types")
def list_asset_types(db: Session = Depends(get_minehub_db)) -> list[dict]:
    rows = db.execute(text("""
        SELECT t.asset_type_id, t.code, t.name, t.category,
               t.rated_output_per_hr, t.rated_output_uom, t.rated_fuel_lph,
               t.standard_crew, t.status,
               (SELECT count(*) FROM asset a WHERE a.asset_type_id = t.asset_type_id) AS asset_count
        FROM asset_type t
        WHERE t.status = 'ACTIVE'
        ORDER BY t.name
    """)).mappings().all()
    return [dict(r) for r in rows]


@router.put("/asset-types/{asset_type_id}")
def update_asset_type(asset_type_id: int, request: Request, body: dict = Body(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Set the rated capacities — the ideal operating model.

    These numbers set every capacity-gap figure the platform reports, which is
    why they are left NULL until someone deliberately enters them rather than
    seeded with a guess that would quietly become fact.
    """
    fields, params = [], {"id": asset_type_id, "by": _actor(request)}
    for key in ("rated_output_per_hr", "rated_output_uom", "rated_fuel_lph", "standard_crew"):
        if key in body:
            fields.append(f"{key} = :{key}")
            params[key] = body[key]
    if not fields:
        raise HTTPException(400, "Nothing to update.")

    res = db.execute(text(
        f"UPDATE asset_type SET {', '.join(fields)} WHERE asset_type_id = :id"), params)
    if res.rowcount == 0:
        raise HTTPException(404, "Asset type not found.")
    db.commit()
    return {"ok": True, "asset_type_id": asset_type_id}


# ------------------------------------------------------------------ assets
@router.get("/assets")
def list_assets(q: str = Query(""), status: str = Query(""),
                asset_type_id: int | None = Query(None),
                propulsion: str = Query(""),
                db: Session = Depends(get_minehub_db)) -> list[dict]:
    where, params = ["1=1"], {}
    if q.strip():
        where.append("(a.fleet_code ILIKE :q OR a.registration_no ILIKE :q "
                     "OR a.make ILIKE :q OR a.model ILIKE :q OR a.asset_ref ILIKE :q "
                     "OR a.nickname ILIKE :q)")
        params["q"] = f"%{q.strip()}%"
    if status:
        where.append("a.status = :status")
        params["status"] = status
    if asset_type_id:
        where.append("a.asset_type_id = :atid")
        params["atid"] = asset_type_id
    if propulsion:
        # HYBRID answers to both sides of the question. A fleet report that
        # counts it as neither is a report whose columns do not add up.
        if propulsion.upper() == "EV":
            where.append("a.propulsion IN ('EV', 'HYBRID')")
        elif propulsion.upper() == "NON_EV":
            where.append("(a.propulsion IN ('NON_EV', 'HYBRID') OR a.propulsion IS NULL)")
        else:
            where.append("a.propulsion = :prop")
            params["prop"] = propulsion.upper()

    rows = db.execute(text(f"""
        SELECT a.asset_id, a.asset_ref, a.fleet_code, a.registration_no, a.make, a.model,
               pl.code AS plant_code, pl.name AS plant, ou.name AS department,
               a.capacity, a.capacity_uom, a.ownership, a.status,
               a.rated_output_per_hr, a.rated_fuel_lph, a.commissioned_on,
               a.fuel_type, a.propulsion,
               a.nickname, a.version, a.approval_status,
               t.asset_type_id, t.name AS asset_type, t.category,
               o.display_name AS owner,
               COALESCE(ident.alias_count, 0) AS alias_count,
               ident.alias_systems
        FROM asset a
        -- LEFT, because a draft is allowed to have no equipment type yet. An
        -- inner join dropped exactly the rows someone still has to finish, so
        -- they could not be reopened or discarded — invisible but occupying
        -- their fleet code.
        LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        LEFT JOIN party o ON o.party_id = a.owner_party_id
        LEFT JOIN plant pl ON pl.plant_id = a.plant_id
        LEFT JOIN org_unit ou ON ou.org_unit_id = a.org_unit_id
        -- Grouped once rather than two correlated subqueries per row: over a
        -- tunnel that difference was two and a half seconds on eleven machines,
        -- and it grows with the fleet.
        LEFT JOIN (
            SELECT asset_id, count(*) AS alias_count,
                   string_agg(system, ',' ORDER BY system) AS alias_systems
            FROM asset_identity GROUP BY asset_id
        ) ident ON ident.asset_id = a.asset_id
        WHERE {' AND '.join(where)}
        ORDER BY a.fleet_code
    """), params).mappings().all()
    return [dict(r) for r in rows]


@router.post("/assets")
def create_asset(request: Request, body: dict = Body(...),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Register a machine, with its documents, schedules and system names.

    Everything arrives in one call and is written in one transaction. A machine
    saved without its insurance expiry, because a second request failed, is a
    machine nobody knows is uninsured.
    """
    data = _clean(body)

    # A draft is someone's working note, so nothing here is required. What a
    # machine must have is checked when it is submitted for approval, which is
    # the point at which other people start relying on it. Refusing to save an
    # incomplete draft only means the person who walked out to read the chassis
    # plate comes back to an empty form.
    fleet_code = (data.get("fleet_code") or "").strip()

    ownership = (data.get("ownership") or "OWN").upper()
    if ownership not in OWNERSHIP:
        raise HTTPException(400, f"Ownership must be one of {OWNERSHIP}.")
    data["ownership"] = ownership
    data.setdefault("status", "ACTIVE")
    if not data.get("plant_id"):
        # Almost every machine registered here is Kaliapani's, and a field that
        # is right by default should not be left empty by default.
        data["plant_id"] = db.execute(text(
            "SELECT plant_id FROM plant WHERE is_default LIMIT 1")).scalar()

    if fleet_code and db.execute(
            text("SELECT 1 FROM asset WHERE fleet_code = :c"), {"c": fleet_code}).first():
        raise HTTPException(409, f"Fleet code '{fleet_code}' is already registered.")

    # The column is unique and cannot be empty, so an unnamed draft gets a
    # placeholder it is easy to recognise and impossible to submit.
    placeholder = not fleet_code
    if placeholder:
        data["fleet_code"] = f"DRAFT-{uuid4().hex[:8]}"

    cols = list(data.keys())
    placeholders = ", ".join(":" + c for c in cols)
    created = db.execute(text(
        f"INSERT INTO asset ({', '.join(cols)}, created_by, asset_ref) "
        f"VALUES ({placeholders}, :by, next_asset_ref()) RETURNING asset_id, asset_ref"
    ), {**data, "by": _actor(request)}).mappings().first()
    asset_id, asset_ref = created["asset_id"], created["asset_ref"]

    if placeholder:
        # Now that the row has an id, name it after that instead: DRAFT-7 is
        # something a person can say out loud.
        fleet_code = f"DRAFT-{asset_id}"
        db.execute(text("UPDATE asset SET fleet_code = :c WHERE asset_id = :i"),
                   {"c": fleet_code, "i": asset_id})
        data["fleet_code"] = fleet_code

    _save_children(db, request, asset_id, body, data.get("current_reading"))

    _revise(db, request, asset_id, 1, "CREATED",
            {k: {"from": None, "to": _jsonable(v)} for k, v in data.items() if v is not None},
            remarks="Registered")
    _activity(db, request, "ASSET_REGISTERED", asset_id=asset_id,
              payload={"asset_ref": asset_ref,
                       "fleet_code": fleet_code, "nickname": data.get("nickname"),
                       "ownership": ownership,
                       "documents": len(body.get("documents") or []),
                       "schedules": len(body.get("schedules") or [])})
    db.commit()
    return {"ok": True, "asset_id": asset_id, "fleet_code": fleet_code, "asset_ref": asset_ref}


def _save_children(db, request: Request, asset_id: int, body: dict,
                   current_reading) -> None:
    """Documents, maintenance schedules and system identities for one machine."""
    actor = _actor(request)

    for doc in body.get("documents") or []:
        dtype = (doc.get("document_type") or "").upper()
        if dtype not in DOCUMENT_TYPES:
            raise HTTPException(400, f"Unknown document type '{dtype}'.")
        # A row with nothing in it is the form's empty slot, not a document.
        if not any(doc.get(k) for k in ("document_no", "valid_upto", "provider", "amount")):
            continue
        db.execute(text(
            "INSERT INTO asset_compliance (asset_id, document_type, document_no, provider, "
            "issuing_authority, amount, valid_from, valid_upto, reminder_days, remarks, created_by) "
            "VALUES (:a, :t, :no, :prov, :auth, :amt, :vf, :vu, :rem, :note, :by)"
        ), {"a": asset_id, "t": dtype, "no": doc.get("document_no") or None,
            "prov": doc.get("provider") or None,
            "auth": doc.get("issuing_authority") or None,
            "amt": doc.get("amount") or None,
            "vf": doc.get("valid_from") or None, "vu": doc.get("valid_upto") or None,
            "rem": doc.get("reminder_days") or 30,
            "note": doc.get("remarks") or None, "by": actor})

    for sch in body.get("schedules") or []:
        stype = (sch.get("schedule_type") or "").upper()
        if stype not in SCHEDULE_TYPES:
            raise HTTPException(400, f"Unknown schedule type '{stype}'.")
        if not sch.get("name") and not sch.get("interval_value"):
            continue
        next_reading, next_date = _next_due(sch, current_reading)
        db.execute(text(
            "INSERT INTO asset_maintenance_schedule "
            "(asset_id, schedule_type, name, interval_value, interval_uom, "
            " last_done_on, last_done_reading, next_due_on, next_due_reading, remarks, created_by) "
            "VALUES (:a, :t, :n, :iv, :iu, :ld, :lr, :nd, :nr, :rm, :by)"
        ), {"a": asset_id, "t": stype,
            "n": sch.get("name") or stype.replace("_", " ").title(),
            "iv": sch.get("interval_value") or None,
            "iu": sch.get("interval_uom") or None,
            "ld": sch.get("last_done_on") or None,
            "lr": sch.get("last_done_reading") or None,
            "nd": next_date, "nr": next_reading,
            "rm": sch.get("remarks") or None, "by": actor})

    for ident in body.get("identities") or []:
        system = (ident.get("system") or "").upper()
        code = (ident.get("external_code") or "").strip()
        if not code:
            continue
        if system not in IDENTITY_SYSTEMS:
            raise HTTPException(400, f"Unknown system '{system}'.")
        clash = db.execute(text(
            "SELECT a.fleet_code FROM asset_identity i JOIN asset a ON a.asset_id = i.asset_id "
            "WHERE i.system = :s AND i.external_code = :c"
        ), {"s": system, "c": code}).first()
        if clash:
            raise HTTPException(409, f"'{code}' in {system} is already mapped to {clash[0]}.")
        db.execute(text(
            "INSERT INTO asset_identity (asset_id, system, external_code, created_by) "
            "VALUES (:a, :s, :c, :by)"
        ), {"a": asset_id, "s": system, "c": code, "by": actor})


@router.get("/assets/{asset_id}")
def get_asset(asset_id: int, db: Session = Depends(get_minehub_db)) -> dict:
    """One machine in full - everything the registration form captured."""
    row = db.execute(text(
        "SELECT a.*, t.name AS asset_type, t.category, "
        "       o.display_name AS owner, s.display_name AS supplier, "
        "       l.name AS home_location, pl.name AS plant, ou.name AS department "
        "FROM asset a "
        # LEFT, for the same reason as the register listing: a draft need not
        # have chosen an equipment type yet, and an inner join turns that draft
        # into a 404 on the only screen that could finish it.
        "LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id "
        "LEFT JOIN party o    ON o.party_id = a.owner_party_id "
        "LEFT JOIN party s    ON s.party_id = a.supplier_party_id "
        "LEFT JOIN location l ON l.location_id = a.home_location_id "
        "LEFT JOIN plant pl   ON pl.plant_id = a.plant_id "
        "LEFT JOIN org_unit ou ON ou.org_unit_id = a.org_unit_id "
        "WHERE a.asset_id = :id"
    ), {"id": asset_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Machine not found.")

    out = dict(row)
    out["documents"] = [dict(r) for r in db.execute(text(
        "SELECT asset_compliance_id, document_type, document_no, provider, issuing_authority, "
        "       amount, valid_from, valid_upto, reminder_days, status, remarks, "
        "       (valid_upto - CURRENT_DATE) AS days_left "
        "FROM asset_compliance WHERE asset_id = :id ORDER BY valid_upto NULLS LAST"
    ), {"id": asset_id}).mappings().all()]
    out["schedules"] = [dict(r) for r in db.execute(text(
        "SELECT schedule_id, schedule_type, name, interval_value, interval_uom, "
        "       last_done_on, last_done_reading, next_due_on, next_due_reading, status, remarks, "
        "       (next_due_on - CURRENT_DATE) AS days_left "
        "FROM asset_maintenance_schedule WHERE asset_id = :id ORDER BY next_due_on NULLS LAST"
    ), {"id": asset_id}).mappings().all()]
    out["identities"] = [dict(r) for r in db.execute(text(
        "SELECT asset_identity_id, system, external_code "
        "FROM asset_identity WHERE asset_id = :id ORDER BY system"
    ), {"id": asset_id}).mappings().all()]
    return out


@router.get("/alerts")
def alerts(db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Documents expiring and services falling due, worst first.

    An expired fitness certificate on a running machine is a statutory exposure,
    so this is a first-class endpoint rather than something you find by opening
    each machine in turn.
    """
    rows = db.execute(text(
        "SELECT * FROM asset_alert WHERE severity <> 'OK' "
        "ORDER BY (severity = 'EXPIRED') DESC, days_left"
    )).mappings().all()
    return [dict(r) for r in rows]


@router.put("/assets/{asset_id}")
def update_asset(asset_id: int, request: Request, body: dict = Body(...),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Save a change, recording what actually moved.

    The diff is taken against the stored row rather than trusted from the
    client: a form posts every field it holds, so without comparing, a revision
    would claim forty changes when someone corrected one date.
    """
    before = db.execute(text("SELECT * FROM asset WHERE asset_id = :id"),
                        {"id": asset_id}).mappings().first()
    if not before:
        raise HTTPException(404, "Machine not found.")

    data = _clean(body)
    data.pop("fleet_code", None) if body.get("keep_code") else None

    changes: dict = {}
    for key, new_value in data.items():
        old_value = before.get(key)
        if _same(old_value, new_value):
            continue
        changes[key] = {"from": _jsonable(old_value), "to": _jsonable(new_value)}

    if not changes:
        return {"ok": True, "asset_id": asset_id, "changed": 0,
                "version": before["version"], "message": "Nothing changed."}

    cols = list(data.keys())
    # An approved record that is edited goes back to draft: the thing that was
    # approved is no longer the thing on file.
    reset_approval = before["approval_status"] == "APPROVED"
    version = before["version"] + 1

    db.execute(text(
        f"UPDATE asset SET {', '.join(f'{c} = :{c}' for c in cols)}, version = :ver"
        + (", approval_status = 'DRAFT', approved_by = NULL, approved_at = NULL" if reset_approval else "")
        + " WHERE asset_id = :id"
    ), {**data, "ver": version, "id": asset_id})

    _revise(db, request, asset_id, version, "UPDATED", changes,
            remarks=body.get("remarks_for_change"))
    _activity(db, request, "ASSET_UPDATED", asset_id=asset_id,
              payload={"version": version, "fields": sorted(changes.keys())})
    db.commit()
    return {"ok": True, "asset_id": asset_id, "version": version,
            "changed": len(changes),
            "approval_reset": reset_approval}


def _same(a, b) -> bool:
    """Whether a stored value and a submitted one mean the same thing.

    Forms return strings; the database returns dates, Decimals and ints. Without
    normalising, every save would look like a change to every field.
    """
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if isinstance(a, (int, float, Decimal)) or isinstance(b, (int, float, Decimal)):
        try:
            return Decimal(str(a)) == Decimal(str(b))
        except (InvalidOperation, ValueError):
            pass
    return str(a).strip() == str(b).strip()


def _jsonable(v):
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def _revise(db, request: Request, asset_id: int, version: int, action: str,
            changes: dict, remarks: str | None = None) -> None:
    """Append a revision. Snapshots the record so any version can be read back
    without replaying everything before it."""
    snap = db.execute(text("SELECT * FROM asset WHERE asset_id = :id"),
                      {"id": asset_id}).mappings().first()
    db.execute(text(
        "INSERT INTO asset_revision (asset_id, version, action, changes, snapshot, remarks, changed_by) "
        "VALUES (:a, :v, :act, CAST(:ch AS jsonb), CAST(:sn AS jsonb), :rm, :by)"
    ), {"a": asset_id, "v": version, "act": action,
        "ch": json.dumps(changes, default=str),
        "sn": json.dumps({k: _jsonable(v) for k, v in dict(snap).items()}, default=str) if snap else None,
        "rm": remarks, "by": _actor(request)})


# --------------------------------------------------------------- approval
@router.post("/assets/{asset_id}/submit")
def submit_asset(asset_id: int, request: Request, body: dict = Body(default={}),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Put a machine forward for approval."""
    row = db.execute(text(
        "SELECT approval_status, version, fleet_code, asset_type_id, ownership, owner_party_id, "
        "       plant_id, org_unit_id FROM asset WHERE asset_id = :id"
    ), {"id": asset_id}).first()
    if not row:
        raise HTTPException(404, "Machine not found.")

    # The rules a draft was excused from. Everything missing is named at once —
    # being sent back three times for one field each is how a form earns its
    # reputation.
    missing = []
    if not row[2] or row[2].startswith("DRAFT-"):
        missing.append("a fleet code")
    if not row[3]:
        missing.append("an equipment type")
    if row[4] == "HIRED" and not row[5]:
        missing.append("the contractor that owns it")
    if not row[6]:
        missing.append("a plant")
    if not row[7]:
        missing.append("a department")
    if missing:
        raise HTTPException(400, "Before this can go for approval it needs "
                                 + ", ".join(missing[:-1]) + (" and " if len(missing) > 1 else "")
                                 + missing[-1] + ".")

    if row[0] == "SUBMITTED":
        raise HTTPException(400, "This machine is already awaiting approval.")
    if row[0] == "APPROVED":
        raise HTTPException(400, "This machine is already approved.")

    db.execute(text(
        "UPDATE asset SET approval_status = 'SUBMITTED', submitted_by = :by, "
        "submitted_at = now() WHERE asset_id = :id"
    ), {"by": _actor(request), "id": asset_id})
    _revise(db, request, asset_id, row[1], "SUBMITTED", {}, remarks=body.get("remarks"))
    db.commit()
    return {"ok": True, "approval_status": "SUBMITTED"}


@router.post("/assets/{asset_id}/approve")
def approve_asset(asset_id: int, request: Request, body: dict = Body(default={}),
                  db: Session = Depends(get_minehub_db)) -> dict:
    """Accept a machine onto the register.

    Approving your own submission is refused. One person doing both halves is
    not review, and the register is what contractor billing and statutory
    compliance are later read from.
    """
    _require_approver(request)
    row = db.execute(text(
        "SELECT approval_status, version, submitted_by FROM asset WHERE asset_id = :id"
    ), {"id": asset_id}).first()
    if not row:
        raise HTTPException(404, "Machine not found.")
    if row[0] != "SUBMITTED":
        raise HTTPException(400, "Only a machine awaiting approval can be approved.")
    own = bool(row[2]) and row[2] == _actor(request)
    # The same exception the operator register makes, for the same reason: two
    # people are the point, and the one account that has to be able to finish
    # the job alone cannot be held to it. It is recorded rather than hidden.
    if own and "platform.settings" not in (getattr(request.state, "permissions", None) or set()):
        raise HTTPException(
            403, "You submitted this machine — someone else has to approve it.")

    db.execute(text(
        "UPDATE asset SET approval_status = 'APPROVED', approved_by = :by, "
        "approved_at = now() WHERE asset_id = :id"
    ), {"by": _actor(request), "id": asset_id})
    note = body.get("remarks")
    if own:
        note = ((note + " · ") if note else "") + "Self-approved by the platform owner"
    _revise(db, request, asset_id, row[1], "APPROVED", {}, remarks=note)
    _activity(db, request, "ASSET_APPROVED", asset_id=asset_id, payload={"self_approved": own})
    db.commit()
    return {"ok": True, "approval_status": "APPROVED", "self_approved": own}


@router.post("/assets/{asset_id}/send-back")
def send_back_asset(asset_id: int, request: Request, body: dict = Body(default={}),
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Return a machine for correction, with a reason."""
    _require_approver(request)
    remarks = (body.get("remarks") or "").strip()
    if not remarks:
        raise HTTPException(400, "Say what needs correcting — a bare rejection helps nobody.")

    row = db.execute(text(
        "SELECT approval_status, version FROM asset WHERE asset_id = :id"
    ), {"id": asset_id}).first()
    if not row:
        raise HTTPException(404, "Machine not found.")
    if row[0] != "SUBMITTED":
        raise HTTPException(400, "Only a machine awaiting approval can be sent back.")

    db.execute(text("UPDATE asset SET approval_status = 'SENT_BACK' WHERE asset_id = :id"),
               {"id": asset_id})
    _revise(db, request, asset_id, row[1], "SENT_BACK", {}, remarks=remarks)
    db.commit()
    return {"ok": True, "approval_status": "SENT_BACK"}


@router.delete("/assets/{asset_id}")
def discard_draft(asset_id: int, request: Request,
                  db: Session = Depends(get_minehub_db)) -> dict:
    """Throw away a draft.

    Only a draft, and only one that has never been approved. Anything that has
    been through approval is what other people have acted on, and removing it
    would leave their decisions pointing at nothing — those are retired by
    status instead.

    The revision trail goes with the row, since it only ever described a record
    that no longer exists. What survives is the activity log, which is append
    only and keeps the fact that this fleet code was registered and discarded.
    """
    row = db.execute(text(
        "SELECT approval_status, fleet_code, nickname FROM asset WHERE asset_id = :id"
    ), {"id": asset_id}).first()
    if not row:
        raise HTTPException(404, "Machine not found.")
    if row[0] not in ("DRAFT", "SENT_BACK"):
        raise HTTPException(
            400, "Only a draft can be discarded. This one has been through approval — "
                 "set its status to Disposed instead, so the history it carries stays readable.")

    _activity(db, request, "ASSET_DISCARDED",
              payload={"fleet_code": row[1], "nickname": row[2], "was": row[0]})
    db.execute(text("DELETE FROM asset WHERE asset_id = :id"), {"id": asset_id})
    db.commit()
    return {"ok": True, "discarded": row[1]}


@router.post("/assets/{asset_id}/revert")
def revert_asset(asset_id: int, request: Request, body: dict = Body(default={}),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Put a machine back the way an earlier revision found it.

    The earlier state is written as a new revision rather than by deleting the
    ones after it: an undo that erases its own evidence is not an audit trail.
    Anyone reading the history sees the change, and sees it being taken back.
    """
    target = body.get("revision_id")
    rows = db.execute(text(
        "SELECT revision_id, version, snapshot FROM asset_revision "
        "WHERE asset_id = :id ORDER BY revision_id DESC LIMIT 2"
    ), {"id": asset_id}).mappings().all()
    if len(rows) < 2 and not target:
        raise HTTPException(400, "There is nothing to go back to yet.")

    if target:
        snap_row = db.execute(text(
            "SELECT version, snapshot FROM asset_revision "
            "WHERE asset_id = :id AND revision_id = :r"
        ), {"id": asset_id, "r": target}).mappings().first()
        if not snap_row:
            raise HTTPException(404, "That revision is not on this machine.")
    else:
        snap_row = rows[1]          # the state before the most recent change

    snap = snap_row["snapshot"] or {}
    before = db.execute(text("SELECT * FROM asset WHERE asset_id = :id"),
                        {"id": asset_id}).mappings().first()
    if not before:
        raise HTTPException(404, "Machine not found.")

    # Only the fields a person edits are restored. Identity, timestamps and the
    # approval state are not part of what an undo means.
    restore = {k: snap.get(k) for k in ASSET_FIELDS if k in snap}
    changes = {k: {"from": _jsonable(before.get(k)), "to": _jsonable(v)}
               for k, v in restore.items() if not _same(before.get(k), v)}
    if not changes:
        return {"ok": True, "changed": 0, "message": "It already looks like that."}

    version = before["version"] + 1
    db.execute(text(
        f"UPDATE asset SET {', '.join(f'{c} = :{c}' for c in restore)}, version = :ver "
        "WHERE asset_id = :id"
    ), {**restore, "ver": version, "id": asset_id})

    _revise(db, request, asset_id, version, "UPDATED", changes,
            remarks=f"Reverted to v{snap_row['version']}")
    _activity(db, request, "ASSET_REVERTED", asset_id=asset_id,
              payload={"to_version": snap_row["version"], "fields": sorted(changes)})
    db.commit()
    return {"ok": True, "version": version, "changed": len(changes),
            "reverted_to": snap_row["version"]}


@router.get("/assets/{asset_id}/revisions")
def asset_revisions(asset_id: int, db: Session = Depends(get_minehub_db),
                    corp: Session = Depends(get_db)) -> list[dict]:
    """The full history of one machine, newest first.

    Carries the name beside the employee id it was recorded against. The id is
    what makes the trail reliable; the name is what makes anyone read it.
    """
    rows = db.execute(text(
        "SELECT revision_id, version, action, changes, remarks, changed_by, changed_at "
        "FROM asset_revision WHERE asset_id = :id ORDER BY changed_at DESC, revision_id DESC"
    ), {"id": asset_id}).mappings().all()

    names = people.names_for(corp, [r["changed_by"] for r in rows])
    return [{**dict(r), "changed_by_name": names.get(r["changed_by"])} for r in rows]


# -------------------------------------------------------------- identities
@router.get("/assets/{asset_id}/identities")
def list_identities(asset_id: int, db: Session = Depends(get_minehub_db)) -> list[dict]:
    rows = db.execute(text("""
        SELECT asset_identity_id, system, external_code, valid_from, valid_to
        FROM asset_identity WHERE asset_id = :id ORDER BY system
    """), {"id": asset_id}).mappings().all()
    return [dict(r) for r in rows]


@router.post("/assets/{asset_id}/identities")
def add_identity(asset_id: int, request: Request, body: dict = Body(...),
                 db: Session = Depends(get_minehub_db)) -> dict:
    system = (body.get("system") or "").upper()
    code = (body.get("external_code") or "").strip()
    if system not in IDENTITY_SYSTEMS:
        raise HTTPException(400, f"System must be one of {IDENTITY_SYSTEMS}.")
    if not code:
        raise HTTPException(400, "The external code is required.")

    # A code in a system points at exactly one machine. Say which one, rather
    # than reporting a constraint violation.
    clash = db.execute(text("""
        SELECT a.fleet_code FROM asset_identity i JOIN asset a ON a.asset_id = i.asset_id
        WHERE i.system = :s AND i.external_code = :c
    """), {"s": system, "c": code}).first()
    if clash:
        raise HTTPException(409, f"'{code}' in {system} is already mapped to {clash[0]}.")

    db.execute(text("""
        INSERT INTO asset_identity (asset_id, system, external_code, created_by)
        VALUES (:id, :s, :c, :by)
    """), {"id": asset_id, "s": system, "c": code, "by": _actor(request)})
    _activity(db, request, "ASSET_IDENTITY_LINKED", asset_id=asset_id,
              payload={"system": system, "external_code": code})
    db.commit()
    return {"ok": True}


@router.delete("/assets/identities/{asset_identity_id}")
def remove_identity(asset_identity_id: int, request: Request,
                    db: Session = Depends(get_minehub_db)) -> dict:
    row = db.execute(text("""
        SELECT asset_id, system, external_code FROM asset_identity WHERE asset_identity_id = :id
    """), {"id": asset_identity_id}).first()
    if not row:
        raise HTTPException(404, "Identity not found.")
    db.execute(text("DELETE FROM asset_identity WHERE asset_identity_id = :id"),
               {"id": asset_identity_id})
    _activity(db, request, "ASSET_IDENTITY_UNLINKED", asset_id=row[0],
              payload={"system": row[1], "external_code": row[2]})
    db.commit()
    return {"ok": True}


# ------------------------------------------------------- unmapped telematics
@router.get("/unmapped-telematics")
def unmapped_telematics(db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Machines transmitting telematics that no registered asset claims.

    This is the working list for the registry: every row here is a real machine
    whose data the platform cannot currently attribute to anything.
    """
    rows = db.execute(text("""
        WITH seen AS (
            SELECT vehicle_desc, 'MAN' AS feed, count(*) AS rows_,
                   max(trip_date) AS last_seen
            FROM technoton_man_utilization GROUP BY vehicle_desc
            UNION ALL
            SELECT vehicle_desc, 'EQUIPMENT', count(*), max(trip_date)
            FROM technoton_rest_equipment_utilization GROUP BY vehicle_desc
        )
        SELECT s.vehicle_desc, s.feed, s.rows_, s.last_seen
        FROM seen s
        WHERE NOT EXISTS (
            SELECT 1 FROM asset_identity i
            WHERE i.system = 'TELEMATICS' AND i.external_code = s.vehicle_desc)
        ORDER BY s.feed, s.vehicle_desc
    """)).mappings().all()
    return [dict(r) for r in rows]


# -------------------------------------------------------------- contractors
@router.get("/parties")
def list_parties(party_type: str = Query("ORGANISATION"),
                 q: str = Query(""),
                 db: Session = Depends(get_minehub_db)) -> list[dict]:
    where, params = ["party_type = :t", "status = 'ACTIVE'"], {"t": party_type.upper()}
    if q.strip():
        where.append("(legal_name ILIKE :q OR display_name ILIKE :q)")
        params["q"] = f"%{q.strip()}%"
    rows = db.execute(text(f"""
        SELECT party_id, legal_name, display_name, org_category, party_type
        FROM party WHERE {' AND '.join(where)}
        ORDER BY COALESCE(display_name, legal_name) LIMIT 100
    """), params).mappings().all()
    return [dict(r) for r in rows]


@router.post("/parties")
def create_party(request: Request, body: dict = Body(...),
                 db: Session = Depends(get_minehub_db)) -> dict:
    name = (body.get("legal_name") or "").strip()
    if not name:
        raise HTTPException(400, "Name is required.")
    party_type = (body.get("party_type") or "ORGANISATION").upper()
    row = db.execute(text("""
        INSERT INTO party (party_type, legal_name, display_name, org_category, phone, email, created_by)
        VALUES (:t, :n, :d, :c, :p, :e, :by) RETURNING party_id
    """), {
        "t": party_type, "n": name,
        "d": (body.get("display_name") or name).strip(),
        "c": body.get("org_category") or ("CONTRACTOR" if party_type == "ORGANISATION" else None),
        "p": body.get("phone") or None, "e": body.get("email") or None,
        "by": _actor(request),
    }).first()
    _activity(db, request, "PARTY_REGISTERED",
              payload={"party_id": row[0], "name": name, "party_type": party_type})
    db.commit()
    return {"ok": True, "party_id": row[0]}


# -------------------------------------------------------------- activity feed
@router.get("/activity")
def activity(limit: int = Query(100, le=500),
             db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Day-to-day platform activity, newest first.

    Read straight off the event log, so anything a module records shows up here
    without this endpoint being changed.
    """
    rows = db.execute(text("""
        SELECT e.event_id, e.event_type, e.occurred_at, e.recorded_by, e.source,
               e.payload, a.fleet_code
        FROM event e
        LEFT JOIN asset a ON a.asset_id = e.asset_id
        ORDER BY e.occurred_at DESC
        LIMIT :lim
    """), {"lim": limit}).mappings().all()
    return [dict(r) for r in rows]


@router.get("/locations")
def list_locations(db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Places a machine can belong to — site, pit, plant, workshop, stockyard."""
    rows = db.execute(text(
        "SELECT location_id, code, name, location_type, parent_id "
        "FROM location WHERE status = 'ACTIVE' ORDER BY location_type, name"
    )).mappings().all()
    return [dict(r) for r in rows]


@router.get("/plants")
def list_plants(db: Session = Depends(get_minehub_db)) -> list[dict]:
    """The SAP plants a machine can belong to, default first."""
    rows = db.execute(text(
        "SELECT plant_id, code, name, is_default FROM plant "
        "WHERE status = 'ACTIVE' ORDER BY is_default DESC, code"
    )).mappings().all()
    return [dict(r) for r in rows]


@router.get("/org-units")
def list_org_units(db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Departments, as SAP spells them."""
    rows = db.execute(text(
        "SELECT org_unit_id, code, name FROM org_unit WHERE status = 'ACTIVE' ORDER BY name"
    )).mappings().all()
    return [dict(r) for r in rows]


@router.post("/org-units")
def create_org_unit(request: Request, body: dict = Body(...),
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Add a department, from wherever a department is being chosen.

    Not seeded from the employee master on purpose. That master says which
    department a *person* is paid under, which is a different question from
    which department answers for a machine — and a list arriving full of names
    nobody chose invites people to pick the nearest one rather than the right
    one. The mine builds this list as it meets it, the same as every other.
    """
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "A department needs a name.")

    existing = db.execute(text(
        "SELECT org_unit_id, code, name FROM org_unit WHERE lower(name) = lower(:n)"
    ), {"n": name}).mappings().first()
    if existing:
        return dict(existing)          # typing it twice should not create two

    base = re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")[:28] or "DEPT"
    code, n = base, 1
    while db.execute(text("SELECT 1 FROM org_unit WHERE code = :c"), {"c": code}).first():
        n += 1
        code = f"{base}_{n}"

    row = db.execute(text(
        "INSERT INTO org_unit (code, name, created_by) VALUES (:c, :n, :by) "
        "RETURNING org_unit_id, code, name"
    ), {"c": code, "n": name, "by": _actor(request)}).mappings().first()

    _activity(db, request, "ORG_UNIT_ADDED", payload=dict(row))
    db.commit()
    return dict(row)


@router.post("/locations")
def create_location(request: Request, body: dict = Body(...),
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Add a place, from wherever a place is being chosen.

    The site was the only location on file, so every machine was "at the mine" —
    true and useless. Pits, workshops and stockyards get added as people meet
    them, rather than waiting for someone to prepare a list in advance, which is
    the wait that sends people back to writing free text.
    """
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "A location needs a name.")

    kind = (body.get("location_type") or "PIT").upper()
    if kind not in LOCATION_TYPES:
        raise HTTPException(400, f"Location type must be one of {LOCATION_TYPES}.")

    # A code people can read, derived from the name, kept unique by suffix.
    base = re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")[:24] or "LOC"
    code, n = base, 1
    while db.execute(text("SELECT 1 FROM location WHERE code = :c"), {"c": code}).first():
        n += 1
        code = f"{base}_{n}"

    row = db.execute(text(
        "INSERT INTO location (code, name, location_type, parent_id, status, created_by) "
        "VALUES (:code, :name, :kind, :parent, 'ACTIVE', :by) "
        "RETURNING location_id, code, name, location_type"
    ), {"code": code, "name": name, "kind": kind,
        "parent": body.get("parent_id"), "by": _actor(request)}).mappings().first()

    _activity(db, request, "LOCATION_ADDED", payload=dict(row))
    db.commit()
    return dict(row)


# ------------------------------------------------------------------ lookups
@router.get("/lookups")
def list_lookups(category: str = Query(...), q: str = Query(""),
                 db: Session = Depends(get_minehub_db)) -> list[dict]:
    """Suggestions for one field.

    Ordered by how often each has been chosen, so the values people actually use
    rise above the ones seeded and never picked. Alphabetical would bury them.
    """
    where = ["category = :c", "status = 'ACTIVE'"]
    params: dict = {"c": category.upper()}
    if q.strip():
        where.append("value ILIKE :q")
        params["q"] = f"%{q.strip()}%"
    rows = db.execute(text(
        f"SELECT lookup_id, value, usage_count, is_system FROM lookup "
        f"WHERE {' AND '.join(where)} ORDER BY usage_count DESC, value LIMIT 50"
    ), params).mappings().all()
    return [dict(r) for r in rows]


@router.post("/lookups")
def add_lookup(request: Request, body: dict = Body(...),
               db: Session = Depends(get_minehub_db)) -> dict:
    """Add a value a user could not find.

    Deliberately never refused. The aim is standardisation, not gatekeeping: if
    adding is hard, people type into a free-text field instead and the register
    fragments — which is exactly how the legacy driver master ended up recording
    equipment types that match nothing.
    """
    category = (body.get("category") or "").strip().upper()
    value = (body.get("value") or "").strip()
    if not category or not value:
        raise HTTPException(400, "Both a category and a value are required.")

    # Same value in a different case is the same value. Return the existing one
    # rather than creating a near-duplicate.
    existing = db.execute(text(
        "SELECT lookup_id, value FROM lookup WHERE category = :c AND lower(value) = lower(:v)"
    ), {"c": category, "v": value}).first()
    if existing:
        return {"ok": True, "lookup_id": existing[0], "value": existing[1], "existed": True}

    row = db.execute(text(
        "INSERT INTO lookup (category, value, created_by) VALUES (:c, :v, :by) "
        "RETURNING lookup_id, value"
    ), {"c": category, "v": value, "by": _actor(request)}).first()
    db.commit()
    return {"ok": True, "lookup_id": row[0], "value": row[1], "existed": False}


@router.post("/lookups/used")
def record_lookup_use(body: dict = Body(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Count a value as chosen, so the list learns what this mine uses."""
    pairs = body.get("values") or []
    for p in pairs:
        cat, val = (p.get("category") or "").upper(), (p.get("value") or "").strip()
        if cat and val:
            db.execute(text(
                "UPDATE lookup SET usage_count = usage_count + 1 "
                "WHERE category = :c AND lower(value) = lower(:v)"
            ), {"c": cat, "v": val})
    db.commit()
    return {"ok": True}


@router.post("/asset-types")
def create_asset_type(request: Request, body: dict = Body(...),
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Add an equipment type that was not on the list.

    The thirteen seeded types came from the legacy master and will not cover
    everything the mine runs. Refusing to add would push whoever is registering
    into picking a near-enough type, which is worse than an extra row: a wrong
    type carries wrong rated figures into every capacity calculation.
    """
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "A name is required.")
    code = "".join(ch for ch in name.upper().replace(" ", "_") if ch.isalnum() or ch == "_")
    if not code:
        raise HTTPException(400, "The name must contain letters or numbers.")

    existing = db.execute(text(
        "SELECT asset_type_id, name FROM asset_type WHERE code = :c OR lower(name) = lower(:n)"
    ), {"c": code, "n": name}).first()
    if existing:
        return {"ok": True, "asset_type_id": existing[0], "name": existing[1], "existed": True}

    row = db.execute(text(
        "INSERT INTO asset_type (code, name, category, created_by) "
        "VALUES (:c, :n, :cat, :by) RETURNING asset_type_id, name"
    ), {"c": code, "n": name,
        "cat": (body.get("category") or "OTHER").upper(), "by": _actor(request)}).first()
    db.commit()
    return {"ok": True, "asset_type_id": row[0], "name": row[1], "existed": False}
