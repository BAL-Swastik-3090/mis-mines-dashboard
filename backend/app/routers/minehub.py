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

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db, test_connection

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
    "ownership", "owner_party_id", "sap_asset_no", "supplier_party_id",
    "purchase_date", "purchase_cost", "hire_rate", "hire_rate_uom",
    "rated_output_per_hr", "rated_fuel_lph", "fuel_type", "tank_capacity_l",
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
OWNERSHIP = ("OWN", "HIRED")


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
                db: Session = Depends(get_minehub_db)) -> list[dict]:
    where, params = ["1=1"], {}
    if q.strip():
        where.append("(a.fleet_code ILIKE :q OR a.registration_no ILIKE :q "
                     "OR a.make ILIKE :q OR a.model ILIKE :q)")
        params["q"] = f"%{q.strip()}%"
    if status:
        where.append("a.status = :status")
        params["status"] = status
    if asset_type_id:
        where.append("a.asset_type_id = :atid")
        params["atid"] = asset_type_id

    rows = db.execute(text(f"""
        SELECT a.asset_id, a.fleet_code, a.registration_no, a.make, a.model,
               a.capacity, a.capacity_uom, a.ownership, a.status,
               a.rated_output_per_hr, a.rated_fuel_lph, a.commissioned_on,
               t.asset_type_id, t.name AS asset_type, t.category,
               o.display_name AS owner,
               (SELECT count(*) FROM asset_identity i WHERE i.asset_id = a.asset_id) AS alias_count,
               (SELECT string_agg(i.system, ',' ORDER BY i.system)
                  FROM asset_identity i WHERE i.asset_id = a.asset_id) AS alias_systems
        FROM asset a
        JOIN asset_type t ON t.asset_type_id = a.asset_type_id
        LEFT JOIN party o ON o.party_id = a.owner_party_id
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

    fleet_code = (data.get("fleet_code") or "").strip()
    if not fleet_code:
        raise HTTPException(400, "Fleet code is required.")
    if not data.get("asset_type_id"):
        raise HTTPException(400, "Equipment type is required.")

    ownership = (data.get("ownership") or "OWN").upper()
    if ownership not in OWNERSHIP:
        raise HTTPException(400, f"Ownership must be one of {OWNERSHIP}.")
    if ownership == "HIRED" and not data.get("owner_party_id"):
        raise HTTPException(400, "A hired machine must record which contractor owns it.")
    data["ownership"] = ownership
    data.setdefault("status", "ACTIVE")

    if db.execute(text("SELECT 1 FROM asset WHERE fleet_code = :c"), {"c": fleet_code}).first():
        raise HTTPException(409, f"Fleet code '{fleet_code}' is already registered.")

    cols = list(data.keys())
    placeholders = ", ".join(":" + c for c in cols)
    asset_id = db.execute(text(
        f"INSERT INTO asset ({', '.join(cols)}, created_by) "
        f"VALUES ({placeholders}, :by) RETURNING asset_id"
    ), {**data, "by": _actor(request)}).scalar()

    _save_children(db, request, asset_id, body, data.get("current_reading"))

    _activity(db, request, "ASSET_REGISTERED", asset_id=asset_id,
              payload={"fleet_code": fleet_code, "nickname": data.get("nickname"),
                       "ownership": ownership,
                       "documents": len(body.get("documents") or []),
                       "schedules": len(body.get("schedules") or [])})
    db.commit()
    return {"ok": True, "asset_id": asset_id, "fleet_code": fleet_code}


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
        "       l.name AS home_location "
        "FROM asset a "
        "JOIN asset_type t ON t.asset_type_id = a.asset_type_id "
        "LEFT JOIN party o    ON o.party_id = a.owner_party_id "
        "LEFT JOIN party s    ON s.party_id = a.supplier_party_id "
        "LEFT JOIN location l ON l.location_id = a.home_location_id "
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
    allowed = ("fleet_code", "registration_no", "asset_type_id", "make", "model",
               "year_of_make", "capacity", "capacity_uom", "ownership", "owner_party_id",
               "sap_asset_no", "rated_output_per_hr", "rated_fuel_lph",
               "commissioned_on", "status", "remarks")
    fields, params = [], {"id": asset_id}
    for key in allowed:
        if key in body:
            fields.append(f"{key} = :{key}")
            params[key] = body[key] if body[key] != "" else None
    if not fields:
        raise HTTPException(400, "Nothing to update.")
    if params.get("status") and params["status"] not in ASSET_STATUS:
        raise HTTPException(400, f"Status must be one of {ASSET_STATUS}.")

    res = db.execute(text(
        f"UPDATE asset SET {', '.join(fields)} WHERE asset_id = :id"), params)
    if res.rowcount == 0:
        raise HTTPException(404, "Asset not found.")
    _activity(db, request, "ASSET_UPDATED", asset_id=asset_id,
              payload={k: str(v) for k, v in params.items() if k != "id"})
    db.commit()
    return {"ok": True, "asset_id": asset_id}


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
