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
    fleet_code = (body.get("fleet_code") or "").strip()
    if not fleet_code:
        raise HTTPException(400, "Fleet code is required.")
    if not body.get("asset_type_id"):
        raise HTTPException(400, "Equipment type is required.")

    ownership = (body.get("ownership") or "OWN").upper()
    if ownership not in OWNERSHIP:
        raise HTTPException(400, f"Ownership must be one of {OWNERSHIP}.")
    if ownership == "HIRED" and not body.get("owner_party_id"):
        raise HTTPException(400, "A hired machine must record which contractor owns it.")

    exists = db.execute(text("SELECT 1 FROM asset WHERE fleet_code = :c"),
                        {"c": fleet_code}).first()
    if exists:
        raise HTTPException(409, f"Fleet code '{fleet_code}' is already registered.")

    row = db.execute(text("""
        INSERT INTO asset (fleet_code, registration_no, asset_type_id, make, model,
                           year_of_make, capacity, capacity_uom, ownership, owner_party_id,
                           sap_asset_no, rated_output_per_hr, rated_fuel_lph,
                           commissioned_on, status, remarks, created_by)
        VALUES (:fleet_code, :registration_no, :asset_type_id, :make, :model,
                :year_of_make, :capacity, :capacity_uom, :ownership, :owner_party_id,
                :sap_asset_no, :rated_output_per_hr, :rated_fuel_lph,
                :commissioned_on, :status, :remarks, :by)
        RETURNING asset_id
    """), {
        "fleet_code": fleet_code,
        "registration_no": body.get("registration_no") or None,
        "asset_type_id": body["asset_type_id"],
        "make": body.get("make") or None,
        "model": body.get("model") or None,
        "year_of_make": body.get("year_of_make") or None,
        "capacity": body.get("capacity") or None,
        "capacity_uom": body.get("capacity_uom") or None,
        "ownership": ownership,
        "owner_party_id": body.get("owner_party_id") or None,
        "sap_asset_no": body.get("sap_asset_no") or None,
        "rated_output_per_hr": body.get("rated_output_per_hr") or None,
        "rated_fuel_lph": body.get("rated_fuel_lph") or None,
        "commissioned_on": body.get("commissioned_on") or None,
        "status": (body.get("status") or "ACTIVE").upper(),
        "remarks": body.get("remarks") or None,
        "by": _actor(request),
    }).first()
    _activity(db, request, "ASSET_REGISTERED", asset_id=row[0],
              payload={"fleet_code": fleet_code, "ownership": ownership,
                       "asset_type_id": body["asset_type_id"]})
    db.commit()
    return {"ok": True, "asset_id": row[0], "fleet_code": fleet_code}


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
