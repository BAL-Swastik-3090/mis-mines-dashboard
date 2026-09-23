"""The weighbridge: who is inside, what they hauled, and what it weighed.

THE SHAPE OF IT

    gate_pass   a vehicle's stay. A contractor's tipper drives in once, works
                for months, drives out once. Opened and closed at the gate.
    trip        one load. Opened when the truck rolls onto the deck, closed
                when it has been weighed. Twenty minutes.
    weighment   what the bridge said, and whether anyone typed it instead.

A trip belongs to a stay, so every load traces back to a vehicle somebody
admitted, under a contract, with a named driver in the seat.

ONE POINT OF CAPTURE
Everything about a trip is recorded at the bridge, by the person weighing it,
at the moment of weighing — vehicle, driver, which pit it came out of, where it
is going, what it is. Nothing is inferred from elsewhere and nothing is entered
twice. That is what makes the record checkable afterwards.

TWO KINDS OF CALLER
The desktop agent posts readings and is not a person; it carries a token, and
that one path is exempt from the session middleware in main.py. It can only add
readings to the bridge its token names — it cannot touch a trip. Everyone else
is signed in and goes through the ordinary middleware.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import date

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import access as access_svc

router = APIRouter(prefix="/api/weighbridge", tags=["Weighbridge"])

VIEW = "wb.view"
GATE = "wb.gate"
WEIGH = "wb.weigh"
MANUAL = "wb.manual"
TARE = "wb.tare"
MANAGE = "wb.manage"
MASTERS = "wb.masters"

# A reading older than this is history, not a live weight. Seconds, because the
# comparison is made by the database — see the note in live().
LIVE_WINDOW_SECONDS = 20
# How stale a standing tare may get before a net computed from it is called an
# estimate on screen. Two weeks is a working figure, not a rule of physics.
TARE_STALE_DAYS = 14


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _require(db: Session, request: Request, code: str) -> None:
    if not access_svc.has_permission(db, _actor(request), code):
        raise HTTPException(403, f"This needs the '{code}' permission.")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _f(v):
    return float(v) if v is not None else None


# ═══════════════════════════════════════════════════════════════════════════
# The agent's one endpoint
# ═══════════════════════════════════════════════════════════════════════════
@router.post("/readings")
def ingest(request: Request,
           body: dict = Body(...),
           x_agent_token: str = Header(default=""),
           x_agent_version: str = Header(default=""),
           pg: Session = Depends(get_minehub_db)) -> dict:
    """Readings from a weighbridge agent.

    The token decides which bridge these land against. The agent names a bridge
    in its payload too, but it is checked rather than believed, so a
    misconfigured agent cannot write onto another bridge's record.
    """
    if not x_agent_token:
        raise HTTPException(401, "No agent token.")

    agent = pg.execute(text("""
        SELECT a.agent_id, a.weighbridge_id, a.status, w.code
          FROM weighbridge_agent a
          JOIN weighbridge w ON w.weighbridge_id = a.weighbridge_id
         WHERE a.token_hash = :h
    """), {"h": _hash(x_agent_token)}).mappings().first()
    if not agent:
        raise HTTPException(401, "That agent token is not recognised.")
    if agent["status"] != "ACTIVE":
        raise HTTPException(403, "This agent has been disabled.")

    readings = body.get("readings") or []
    if not isinstance(readings, list):
        raise HTTPException(400, "readings must be a list.")
    if len(readings) > 500:
        raise HTTPException(413, "Too many readings in one batch.")

    rows = []
    for r in readings:
        try:
            weight = float(r["weight_kg"])
        except (KeyError, TypeError, ValueError):
            continue  # malformed is dropped, never guessed at
        rows.append({"b": agent["weighbridge_id"], "a": agent["agent_id"],
                     "w": weight, "s": bool(r.get("stable")),
                     "raw": (r.get("raw") or "")[:200], "t": r.get("read_at")})

    if rows:
        pg.execute(text("""
            INSERT INTO weighbridge_reading
                   (weighbridge_id, agent_id, weight_kg, is_stable, raw_line, read_at)
            VALUES (:b, :a, :w, :s, NULLIF(:raw, ''),
                    COALESCE(CAST(:t AS timestamptz), now()))
        """), rows)

    pg.execute(text("""UPDATE weighbridge_agent
                          SET last_seen_at = now(), version = NULLIF(:v, ''),
                              last_error = NULL
                        WHERE agent_id = :id"""),
               {"id": agent["agent_id"], "v": x_agent_version})
    pg.commit()
    return {"accepted": len(rows), "bridge": agent["code"]}


# ═══════════════════════════════════════════════════════════════════════════
# Looking
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/live")
def live(request: Request,
         db: Session = Depends(get_db),
         pg: Session = Depends(get_minehub_db)) -> dict:
    """What each bridge is showing now, and whether its agent is alive."""
    _require(db, request, VIEW)

    rows = [dict(r) for r in pg.execute(text("""
        SELECT w.weighbridge_id, w.code, w.name, w.status, w.capacity_kg,
               w.last_verified_on, w.verification_due_on,
               r.weight_kg, r.is_stable, r.raw_line, r.read_at, r.age_seconds,
               a.agent_id, a.machine_name, a.last_seen_at, a.version,
               a.last_error, a.status AS agent_status
          FROM weighbridge w
          LEFT JOIN LATERAL (
                SELECT weight_kg, is_stable, raw_line, read_at,
                       round(EXTRACT(EPOCH FROM (now() - received_at)))::int AS age_seconds
                  FROM weighbridge_reading
                 WHERE weighbridge_id = w.weighbridge_id
                 ORDER BY read_at DESC LIMIT 1
          ) r ON TRUE
          LEFT JOIN LATERAL (
                SELECT agent_id, machine_name, last_seen_at, version, last_error, status
                  FROM weighbridge_agent
                 WHERE weighbridge_id = w.weighbridge_id AND status = 'ACTIVE'
                 ORDER BY last_seen_at DESC NULLS LAST LIMIT 1
          ) a ON TRUE
         WHERE w.status <> 'INACTIVE'
         ORDER BY w.code
    """)).mappings()]

    # Age is measured by the database, never by subtracting this server's clock
    # from a timestamp the database wrote. The office PC running the backend is
    # several minutes ahead of the database server; doing it the other way made
    # every reading "399 seconds old" a second after it arrived, and the screen
    # showed a dead bridge while the agent posted four readings a second.
    for r in rows:
        age = r.pop("age_seconds", None)
        r["is_live"] = age is not None and age <= LIVE_WINDOW_SECONDS
        r["seconds_since_reading"] = age
        if not r["is_live"]:
            r["weight_kg"] = None
            r["is_stable"] = False
        else:
            r["weight_kg"] = _f(r["weight_kg"])
        r["capacity_kg"] = _f(r["capacity_kg"])
    return {"bridges": rows}


@router.get("/inside")
def inside(request: Request,
           q: str = Query("", max_length=60),
           db: Session = Depends(get_db),
           pg: Session = Depends(get_minehub_db)) -> dict:
    """Every vehicle currently inside the mine.

    This is the list the weighbridge operator picks from. It carries the
    standing tare and its age with it, so the screen can say up front whether a
    net from this vehicle will be a measurement or an estimate — before the
    weight is taken, not after it is recorded.
    """
    _require(db, request, VIEW)

    rows = [dict(r) for r in pg.execute(text("""
        SELECT g.gate_pass_id, g.gate_pass_no, g.purpose, g.contract_ref,
               g.entry_at, g.expected_until,
               COALESCE(a.registration_no, vv.registration_no) AS vehicle,
               a.asset_id, a.fleet_code, a.payload_capacity_kg,
               COALESCE(a.standing_tare_kg, vv.standing_tare_kg) AS standing_tare_kg,
               COALESCE(a.tare_taken_at, vv.tare_taken_at) AS tare_taken_at,
               g.visiting_vehicle_id, vv.visits AS previous_visits,
               CASE WHEN COALESCE(a.tare_taken_at, vv.tare_taken_at) IS NOT NULL
                    THEN EXTRACT(DAY FROM (now() - COALESCE(a.tare_taken_at, vv.tare_taken_at)))::int
               END AS tare_age_days,
               COALESCE(at.name, vv.vehicle_type) AS vehicle_type,
               tp.legal_name AS transporter,
               round(EXTRACT(EPOCH FROM (now() - g.entry_at)) / 86400)::int AS days_inside,
               (SELECT count(*) FROM trip t
                 WHERE t.gate_pass_id = g.gate_pass_id
                   AND t.production_date = CURRENT_DATE) AS trips_today,
               (SELECT t.trip_id FROM trip t
                 WHERE t.gate_pass_id = g.gate_pass_id AND t.status = 'OPEN'
                 ORDER BY t.trip_id DESC LIMIT 1) AS open_trip_id
          FROM gate_pass g
          LEFT JOIN asset a       ON a.asset_id = g.asset_id
          LEFT JOIN visiting_vehicle vv ON vv.visiting_vehicle_id = g.visiting_vehicle_id
          LEFT JOIN asset_type at ON at.asset_type_id = a.asset_type_id
          LEFT JOIN party tp      ON tp.party_id = g.transporter_party_id
         WHERE g.status = 'IN'
           AND (:q = '' OR COALESCE(a.registration_no, vv.registration_no) ILIKE '%' || :q || '%'
                        OR a.fleet_code ILIKE '%' || :q || '%')
         ORDER BY COALESCE(a.registration_no, vv.registration_no)
    """), {"q": q.strip()}).mappings()]

    for r in rows:
        for k in ("payload_capacity_kg", "standing_tare_kg"):
            r[k] = _f(r[k])
        age = r["tare_age_days"]
        r["tare_is_stale"] = age is not None and age > TARE_STALE_DAYS
        r["has_tare"] = r["standing_tare_kg"] is not None
    return {"vehicles": rows, "tare_stale_after_days": TARE_STALE_DAYS}


@router.get("/trips")
def trips(request: Request,
          on: date | None = Query(None),
          shift: str = Query(""),
          status: str = Query(""),
          asset_id: int | None = Query(None),
          limit: int = Query(200, ge=1, le=2000),
          db: Session = Depends(get_db),
          pg: Session = Depends(get_minehub_db)) -> dict:
    """The haul record, newest first."""
    _require(db, request, VIEW)

    rows = [dict(r) for r in pg.execute(text("""
        SELECT t.trip_id, t.trip_no, t.status, t.production_date, t.shift_code,
               t.grade, t.sub_grade, t.remarks, t.created_at, t.created_by,
               g.gate_pass_no,
               COALESCE(a.registration_no, vv.registration_no) AS vehicle,
               a.fleet_code, a.asset_id, a.payload_capacity_kg,
               COALESCE(dp.legal_name, vd.full_name) AS driver,
               COALESCE(vd.licence_no, lic.document_no) AS driver_licence,
               (vd.visiting_driver_id IS NOT NULL) AS driver_is_visitor,
               tp.legal_name AS transporter,
               m.name AS material,
               src.name AS source, dst.name AS destination,
               w.code AS bridge,
               tw.gross_kg, tw.tare_kg, tw.net_kg, tw.tare_source,
               tw.tare_age_days, tw.has_manual, tw.gross_at
          FROM trip t
          JOIN gate_pass g        ON g.gate_pass_id = t.gate_pass_id
          LEFT JOIN asset a       ON a.asset_id = t.asset_id
          LEFT JOIN visiting_vehicle vv ON vv.visiting_vehicle_id = t.visiting_vehicle_id
          LEFT JOIN operator o    ON o.operator_id = t.operator_id
          LEFT JOIN party dp      ON dp.party_id = o.party_id
          LEFT JOIN visiting_driver vd ON vd.visiting_driver_id = t.visiting_driver_id
          LEFT JOIN LATERAL (
                SELECT r.document_no FROM operator_record r
                 WHERE r.operator_id = o.operator_id AND r.record_type = 'LICENCE'
                   AND r.status <> 'INACTIVE'
                 ORDER BY r.valid_upto DESC NULLS LAST LIMIT 1) lic ON TRUE
          LEFT JOIN party tp      ON tp.party_id = g.transporter_party_id
          LEFT JOIN material m    ON m.material_id = t.material_id
          LEFT JOIN location src  ON src.location_id = t.source_location_id
          LEFT JOIN location dst  ON dst.location_id = t.dest_location_id
          LEFT JOIN weighbridge w ON w.weighbridge_id = t.weighbridge_id
          LEFT JOIN trip_weights tw ON tw.trip_id = t.trip_id
         WHERE (CAST(:on AS date) IS NULL OR t.production_date = CAST(:on AS date))
           AND (:sh = '' OR t.shift_code = :sh)
           AND (:st = '' OR t.status = :st)
           AND (CAST(:asset AS bigint) IS NULL OR t.asset_id = CAST(:asset AS bigint))
         ORDER BY t.trip_id DESC
         LIMIT :lim
    """), {"on": on, "sh": shift.strip().upper(), "st": status.strip().upper(),
           "asset": asset_id, "lim": limit}).mappings()]

    for r in rows:
        for k in ("gross_kg", "tare_kg", "net_kg", "payload_capacity_kg"):
            r[k] = _f(r[k])
        cap, net = r["payload_capacity_kg"], r["net_kg"]
        r["overload_kg"] = round(net - cap, 2) if cap and net and net > cap else None
        r["tare_is_stale"] = (r["tare_source"] == "STANDING"
                              and r["tare_age_days"] is not None
                              and r["tare_age_days"] > TARE_STALE_DAYS)

    tonnes = sum((r["net_kg"] or 0) for r in rows) / 1000
    return {
        "trips": rows,
        "summary": {
            "trips": len(rows),
            "net_tonnes": round(tonnes, 2),
            "manual": sum(1 for r in rows if r["has_manual"]),
            "on_standing_tare": sum(1 for r in rows if r["tare_source"] == "STANDING"),
            "stale_tare": sum(1 for r in rows if r["tare_is_stale"]),
            "overloads": sum(1 for r in rows if r["overload_kg"]),
        },
    }


@router.get("/trips/{trip_id}")
def one_trip(trip_id: int, request: Request,
             db: Session = Depends(get_db),
             pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, VIEW)

    row = pg.execute(text("""
        SELECT t.*, g.gate_pass_no,
               COALESCE(a.registration_no, vv.registration_no) AS vehicle,
               a.fleet_code, a.payload_capacity_kg, a.standing_tare_kg, a.tare_taken_at,
               COALESCE(dp.legal_name, vd.full_name) AS driver,
               m.name AS material, src.name AS source, dst.name AS destination,
               tw.gross_kg, tw.tare_kg, tw.net_kg, tw.tare_source, tw.tare_age_days,
               tw.has_manual
          FROM trip t
          JOIN gate_pass g       ON g.gate_pass_id = t.gate_pass_id
          LEFT JOIN asset a      ON a.asset_id = t.asset_id
          LEFT JOIN visiting_vehicle vv ON vv.visiting_vehicle_id = t.visiting_vehicle_id
          LEFT JOIN operator o   ON o.operator_id = t.operator_id
          LEFT JOIN party dp     ON dp.party_id = o.party_id
          LEFT JOIN visiting_driver vd ON vd.visiting_driver_id = t.visiting_driver_id
          LEFT JOIN material m   ON m.material_id = t.material_id
          LEFT JOIN location src ON src.location_id = t.source_location_id
          LEFT JOIN location dst ON dst.location_id = t.dest_location_id
          LEFT JOIN trip_weights tw ON tw.trip_id = t.trip_id
         WHERE t.trip_id = :id
    """), {"id": trip_id}).mappings().first()
    if not row:
        raise HTTPException(404, "No such trip.")

    weighments = [dict(r) for r in pg.execute(text("""
        SELECT wm.weighment_id, wm.kind, wm.weight_kg, wm.capture_mode,
               wm.manual_reason, wm.weighed_at, wm.weighed_by, wm.remarks,
               wm.reading_id, w.code AS bridge, w.weighbridge_id,
               r.weight_kg AS reading_weight, r.is_stable AS reading_stable,
               r.raw_line, r.read_at AS reading_at
          FROM weighment wm
          JOIN weighbridge w ON w.weighbridge_id = wm.weighbridge_id
          LEFT JOIN weighbridge_reading r ON r.reading_id = wm.reading_id
         WHERE wm.trip_id = :id
         ORDER BY wm.weighed_at
    """), {"id": trip_id}).mappings()]

    out = dict(row)
    for k in ("gross_kg", "tare_kg", "net_kg", "payload_capacity_kg", "standing_tare_kg"):
        out[k] = _f(out.get(k))
    for w in weighments:
        w["weight_kg"] = _f(w["weight_kg"])
        w["reading_weight"] = _f(w["reading_weight"])
        # For a captured weight this is always zero. Anything else is worth seeing.
        w["drift_kg"] = (round(w["weight_kg"] - w["reading_weight"], 2)
                         if w["reading_weight"] is not None else None)
    return {"trip": out, "weighments": weighments}


@router.get("/trace")
def trace(request: Request,
          weighbridge_id: int = Query(...),
          at: str = Query(..., description="The moment to look around, ISO"),
          seconds: int = Query(90, ge=10, le=900),
          db: Session = Depends(get_db),
          pg: Session = Depends(get_minehub_db)) -> dict:
    """Everything the indicator reported either side of a moment.

    The check on a recorded weight: what was the deck actually showing when
    this figure was written down. A weight that never appeared has nowhere
    to hide.
    """
    _require(db, request, VIEW)

    rows = [dict(r) for r in pg.execute(text("""
        SELECT reading_id, weight_kg, is_stable, raw_line, read_at
          FROM weighbridge_reading
         WHERE weighbridge_id = :b
           AND read_at BETWEEN CAST(:at AS timestamptz) - make_interval(secs => :s)
                           AND CAST(:at AS timestamptz) + make_interval(secs => :s)
         ORDER BY read_at
    """), {"b": weighbridge_id, "at": at, "s": seconds}).mappings()]
    for r in rows:
        r["weight_kg"] = _f(r["weight_kg"])
    return {"readings": rows, "centre": at, "window_seconds": seconds}


@router.get("/masters")
def masters(request: Request,
            db: Session = Depends(get_db),
            pg: Session = Depends(get_minehub_db)) -> dict:
    """The cascade the capture screen runs on, in one call.

    Category chooses material type; source type chooses source location. All of
    it comes from rows, so a new dump yard or a new COB fraction appears at the
    bridge without a deployment.

    One request rather than five: every call pays a full round trip to a
    database on the other end of the site link, and this screen is opened at
    the start of a shift and used for eight hours.
    """
    _require(db, request, VIEW)

    categories = [dict(r) for r in pg.execute(text("""
        SELECT c.material_category_id, c.code, c.name, c.sort_order
          FROM material_category c
         WHERE c.status = 'ACTIVE'
         ORDER BY c.sort_order, c.name
    """)).mappings()]

    materials = [dict(r) for r in pg.execute(text("""
        SELECT m.material_id, m.code, m.name, m.material_class, m.is_saleable,
               m.material_category_id, m.sort_order
          FROM material m
         WHERE m.status = 'ACTIVE' AND m.material_category_id IS NOT NULL
         ORDER BY m.sort_order, m.name
    """)).mappings()]

    groups = [dict(r) for r in pg.execute(text("""
        SELECT g.movement_group_id, g.code, g.name, g.is_source, g.is_destination,
               g.sort_order
          FROM movement_group g
         WHERE g.status = 'ACTIVE'
         ORDER BY g.sort_order, g.name
    """)).mappings()]

    places = [dict(r) for r in pg.execute(text("""
        SELECT l.location_id, l.code, l.name, l.location_type, l.movement_group_id,
               l.sort_order
          FROM location l
         WHERE l.status = 'ACTIVE' AND l.movement_group_id IS NOT NULL
         ORDER BY l.sort_order, l.name
    """)).mappings()]

    by_cat: dict[int, list] = {}
    for m in materials:
        by_cat.setdefault(m["material_category_id"], []).append(m)
    for c in categories:
        c["materials"] = by_cat.get(c["material_category_id"], [])

    by_group: dict[int, list] = {}
    for pl in places:
        by_group.setdefault(pl["movement_group_id"], []).append(pl)
    for g in groups:
        g["places"] = by_group.get(g["movement_group_id"], [])
        # A group with one place behind it is the choice itself — the screen
        # shows no second dropdown, because picking "COB" twice is how a form
        # gets hated.
        g["needs_choice"] = len(g["places"]) > 1

    return {
        "categories": categories,
        "sources": [g for g in groups if g["is_source"]],
        "destinations": [g for g in groups if g["is_destination"]],
        "bridges": [dict(r) for r in pg.execute(text("""
            SELECT weighbridge_id, code, name FROM weighbridge
             WHERE status = 'ACTIVE' ORDER BY code
        """)).mappings()],
    }


# ═══════════════════════════════════════════════════════════════════════════
# Customising the lists
# ═══════════════════════════════════════════════════════════════════════════
def _slug(name: str, prefix: str = "") -> str:
    out = "".join(ch if ch.isalnum() else "_" for ch in name.upper()).strip("_")
    return ((prefix + "-") if prefix else "") + out[:40]


@router.get("/masters/all")
def masters_all(request: Request,
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    """Everything, including what has been retired — the customisation view."""
    _require(db, request, VIEW)
    return {
        "categories": [dict(r) for r in pg.execute(text("""
            SELECT c.material_category_id, c.code, c.name, c.sort_order, c.status,
                   (SELECT count(*) FROM material m
                     WHERE m.material_category_id = c.material_category_id
                       AND m.status = 'ACTIVE') AS material_count
              FROM material_category c ORDER BY c.sort_order, c.name
        """)).mappings()],
        "materials": [dict(r) for r in pg.execute(text("""
            SELECT m.material_id, m.code, m.name, m.material_class, m.status,
                   m.sort_order, m.material_category_id, c.name AS category,
                   (SELECT count(*) FROM trip t WHERE t.material_id = m.material_id) AS used_by_trips
              FROM material m
              LEFT JOIN material_category c ON c.material_category_id = m.material_category_id
             ORDER BY c.sort_order NULLS LAST, m.sort_order, m.name
        """)).mappings()],
        "groups": [dict(r) for r in pg.execute(text("""
            SELECT g.movement_group_id, g.code, g.name, g.is_source, g.is_destination,
                   g.sort_order, g.status,
                   (SELECT count(*) FROM location l
                     WHERE l.movement_group_id = g.movement_group_id
                       AND l.status = 'ACTIVE') AS place_count
              FROM movement_group g ORDER BY g.sort_order, g.name
        """)).mappings()],
        "places": [dict(r) for r in pg.execute(text("""
            SELECT l.location_id, l.code, l.name, l.location_type, l.status,
                   l.sort_order, l.movement_group_id, g.name AS group_name,
                   (SELECT count(*) FROM trip t
                     WHERE t.source_location_id = l.location_id
                        OR t.dest_location_id = l.location_id) AS used_by_trips
              FROM location l
              LEFT JOIN movement_group g ON g.movement_group_id = l.movement_group_id
             WHERE l.location_type <> 'SITE'
             ORDER BY g.sort_order NULLS LAST, l.sort_order, l.name
        """)).mappings()],
    }


@router.post("/masters/categories")
def add_category(request: Request, body: dict = Body(...),
                 db: Session = Depends(get_db),
                 pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, MASTERS)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "A category needs a name.")
    code = (body.get("code") or _slug(name)).upper()
    if pg.execute(text("SELECT 1 FROM material_category WHERE code = :c"), {"c": code}).first():
        raise HTTPException(409, f"'{code}' already exists.")
    new_id = pg.execute(text("""
        INSERT INTO material_category (code, name, sort_order, created_by)
        VALUES (:c, :n, COALESCE(:o, 100), :by) RETURNING material_category_id
    """), {"c": code, "n": name, "o": body.get("sort_order"), "by": _actor(request)}).scalar()
    pg.commit()
    return {"material_category_id": new_id, "code": code}


@router.post("/masters/materials")
def add_material(request: Request, body: dict = Body(...),
                 db: Session = Depends(get_db),
                 pg: Session = Depends(get_minehub_db)) -> dict:
    """Add a material type under a category.

    The code is prefixed with the category because the names are not unique
    across them — LG is both an ore grade and a COB fraction, and Tailing
    appears three times. What anybody sees is the name.
    """
    _require(db, request, MASTERS)
    name = (body.get("name") or "").strip()
    cat_id = body.get("material_category_id")
    if not name or not cat_id:
        raise HTTPException(400, "A material type needs a name and a category.")
    cat = pg.execute(text("SELECT code FROM material_category WHERE material_category_id = :i"),
                     {"i": cat_id}).scalar()
    if not cat:
        raise HTTPException(404, "No such category.")
    code = (body.get("code") or _slug(name, cat)).upper()
    if pg.execute(text("SELECT 1 FROM material WHERE code = :c"), {"c": code}).first():
        raise HTTPException(409, f"'{code}' already exists.")
    new_id = pg.execute(text("""
        INSERT INTO material (code, name, material_class, uom, is_saleable,
                              material_category_id, sort_order, created_by)
        VALUES (:c, :n, COALESCE(NULLIF(:cls, ''), 'OTHER'), 'MT',
                COALESCE(:sale, FALSE), :cat, COALESCE(:o, 100), :by)
        RETURNING material_id
    """), {"c": code, "n": name, "cls": (body.get("material_class") or "").strip().upper(),
           "sale": body.get("is_saleable"), "cat": cat_id,
           "o": body.get("sort_order"), "by": _actor(request)}).scalar()
    pg.commit()
    return {"material_id": new_id, "code": code}


@router.post("/masters/groups")
def add_group(request: Request, body: dict = Body(...),
              db: Session = Depends(get_db),
              pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, MASTERS)
    name = (body.get("name") or "").strip()
    is_src = bool(body.get("is_source"))
    is_dst = bool(body.get("is_destination"))
    if not name:
        raise HTTPException(400, "A source or destination type needs a name.")
    if not (is_src or is_dst):
        raise HTTPException(400, "Say whether loads come from here, go to here, or both.")
    code = (body.get("code") or _slug(name)).upper()
    if pg.execute(text("SELECT 1 FROM movement_group WHERE code = :c"), {"c": code}).first():
        raise HTTPException(409, f"'{code}' already exists.")
    new_id = pg.execute(text("""
        INSERT INTO movement_group (code, name, is_source, is_destination, sort_order, created_by)
        VALUES (:c, :n, :s, :d, COALESCE(:o, 100), :by) RETURNING movement_group_id
    """), {"c": code, "n": name, "s": is_src, "d": is_dst,
           "o": body.get("sort_order"), "by": _actor(request)}).scalar()
    pg.commit()
    return {"movement_group_id": new_id, "code": code}


@router.post("/masters/places")
def add_place(request: Request, body: dict = Body(...),
              db: Session = Depends(get_db),
              pg: Session = Depends(get_minehub_db)) -> dict:
    """Add a pit face, a dump yard, a stockpile — somewhere a load moves."""
    _require(db, request, MASTERS)
    name = (body.get("name") or "").strip()
    group_id = body.get("movement_group_id")
    if not name or not group_id:
        raise HTTPException(400, "A place needs a name and a source or destination type.")
    grp = pg.execute(text("SELECT code FROM movement_group WHERE movement_group_id = :i"),
                     {"i": group_id}).scalar()
    if not grp:
        raise HTTPException(404, "No such source or destination type.")
    code = (body.get("code") or _slug(name, grp)).upper()
    if pg.execute(text("SELECT 1 FROM location WHERE code = :c"), {"c": code}).first():
        raise HTTPException(409, f"'{code}' already exists.")
    ltype = (body.get("location_type") or "").strip().upper() or "STOCKPILE"
    new_id = pg.execute(text("""
        INSERT INTO location (code, name, location_type, parent_id, movement_group_id,
                              sort_order, created_by)
        VALUES (:c, :n, :t,
                (SELECT location_id FROM location WHERE code = 'KALIAPANI'),
                :g, COALESCE(:o, 100), :by)
        RETURNING location_id
    """), {"c": code, "n": name, "t": ltype, "g": group_id,
           "o": body.get("sort_order"), "by": _actor(request)}).scalar()
    pg.commit()
    return {"location_id": new_id, "code": code}


@router.patch("/masters/{kind}/{row_id}")
def retire_or_rename(kind: str, row_id: int, request: Request, body: dict = Body(...),
                     db: Session = Depends(get_db),
                     pg: Session = Depends(get_minehub_db)) -> dict:
    """Rename, reorder or retire a list entry.

    Retired, never deleted. A material or a place that disappears takes every
    past trip's description with it; one marked inactive stops being offered
    and leaves the record readable.
    """
    _require(db, request, MASTERS)

    table, key = {
        "categories": ("material_category", "material_category_id"),
        "materials":  ("material", "material_id"),
        "groups":     ("movement_group", "movement_group_id"),
        "places":     ("location", "location_id"),
    }.get(kind, (None, None))
    if not table:
        raise HTTPException(404, "No such list.")

    status = (body.get("status") or "").strip().upper()
    if status and status not in ("ACTIVE", "INACTIVE"):
        raise HTTPException(400, "status must be ACTIVE or INACTIVE.")

    pg.execute(text(f"""
        UPDATE {table}
           SET name = COALESCE(NULLIF(:n, ''), name),
               sort_order = COALESCE(:o, sort_order),
               status = COALESCE(NULLIF(:st, ''), status)
         WHERE {key} = :id
    """), {"id": row_id, "n": (body.get("name") or "").strip(),
           "o": body.get("sort_order"), "st": status})
    pg.commit()
    return {"ok": True}


@router.get("/vehicles/search")
def vehicle_search(request: Request,
                   q: str = Query("", max_length=60),
                   limit: int = Query(25, ge=1, le=100),
                   db: Session = Depends(get_db),
                   pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """Find a vehicle to admit, across both registers.

    The equipment register comes first, because a machine that is on it is the
    one the gate should be naming — it already carries the type, the capacity,
    the owner and the maintenance history. Visiting vehicles seen before come
    next, so a despatch truck that was here last week is recognised rather than
    entered again.
    """
    _require(db, request, VIEW)

    return [dict(r) for r in pg.execute(text("""
        SELECT v.kind, v.asset_id, v.visiting_vehicle_id, v.registration_no,
               v.fleet_code, v.vehicle_type, v.make, v.model,
               v.payload_capacity_kg, v.standing_tare_kg, v.owner, v.ownership,
               (SELECT g.gate_pass_no FROM gate_pass g
                 WHERE g.status = 'IN'
                   AND ((v.kind = 'ASSET' AND g.asset_id = v.asset_id)
                     OR (v.kind = 'VISITOR'
                         AND g.visiting_vehicle_id = v.visiting_vehicle_id))
                 LIMIT 1) AS inside_on,
               (SELECT vv.visits FROM visiting_vehicle vv
                 WHERE vv.visiting_vehicle_id = v.visiting_vehicle_id) AS previous_visits
          FROM weighable_vehicle v
         WHERE v.status NOT IN ('SCRAPPED', 'DISPOSED', 'BLACKLISTED', 'INACTIVE')
           AND (:q = ''
                -- Matched on the normalised form as well as the literal one, so
                -- "OD04G5856" finds the machine stored as "OD 04 G 5856". An
                -- operator reading a number off a bumper does not type spaces,
                -- and a search that misses sends them to create a duplicate.
                OR v.reg_normalised LIKE
                     '%' || upper(regexp_replace(:q, '[^A-Za-z0-9]', '', 'g')) || '%'
                OR v.registration_no ILIKE '%' || :q || '%'
                OR v.fleet_code ILIKE '%' || :q || '%'
                OR v.owner ILIKE '%' || :q || '%')
         ORDER BY (v.kind = 'ASSET') DESC, v.registration_no
         LIMIT :lim
    """), {"q": q.strip(), "lim": limit}).mappings()]


@router.get("/drivers/search")
def driver_search(request: Request,
                  q: str = Query("", max_length=60),
                  limit: int = Query(25, ge=1, le=100),
                  db: Session = Depends(get_db),
                  pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """Find a driver, across the operator register and the visiting drivers.

    The operator register first: all 211 of them are contractors' drivers
    already, which is the population this gate deals with, and one of them
    named against a load is a person with a competency file behind them.

    The licence and its expiry come back with each one. A weighbridge is where
    a mine otherwise finds out too late that the man who has been hauling all
    month is driving on a licence that ran out in March.
    """
    _require(db, request, VIEW)

    rows = [dict(r) for r in pg.execute(text("""
        SELECT d.kind, d.operator_id, d.visiting_driver_id, d.full_name,
               d.reference, d.licence_no, d.licence_valid_upto, d.phone,
               d.employer, d.designation, d.visits,
               CASE WHEN d.licence_valid_upto IS NULL THEN NULL
                    ELSE (d.licence_valid_upto - CURRENT_DATE) END AS licence_days_left
          FROM weighable_driver d
         WHERE d.status NOT IN ('BLACKLISTED', 'INACTIVE')
           AND (:q = ''
                OR d.full_name ILIKE '%' || :q || '%'
                OR d.reference ILIKE '%' || :q || '%'
                OR d.licence_normalised LIKE
                     '%' || upper(regexp_replace(:q, '[^A-Za-z0-9]', '', 'g')) || '%')
         ORDER BY (d.kind = 'OPERATOR') DESC, d.full_name
         LIMIT :lim
    """), {"q": q.strip(), "lim": limit}).mappings()]

    for r in rows:
        left = r["licence_days_left"]
        r["licence_expired"] = left is not None and left < 0
        r["licence_expiring"] = left is not None and 0 <= left <= 30
        r["licence_recorded"] = r["licence_no"] is not None
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# The gate — twice in a vehicle's life, not twice a day
# ═══════════════════════════════════════════════════════════════════════════
@router.post("/gate/entry")
def gate_entry(request: Request, body: dict = Body(...),
               db: Session = Depends(get_db),
               pg: Session = Depends(get_minehub_db)) -> dict:
    """Admit a vehicle to the mine.

    It names a vehicle rather than describing one: a machine on the equipment
    register, a visiting vehicle already known, or a new visitor described once
    in `visitor` — which creates the record, so the next visit finds it instead
    of typing it again.

    This happens once. A contractor's tipper admitted today is still on this
    pass in March; it hauls under it every shift until it leaves for good.
    """
    _require(db, request, GATE)
    actor = _actor(request)

    asset_id = body.get("asset_id")
    visitor_id = body.get("visiting_vehicle_id")
    visitor = body.get("visitor") or None

    if sum(bool(x) for x in (asset_id, visitor_id, visitor)) != 1:
        raise HTTPException(400,
            "Name exactly one vehicle: pick it from the equipment register, "
            "pick a visiting vehicle already known, or describe a new one.")

    # A vehicle the gate has not seen before is recorded once, here, and found
    # by its number every time after. The normalisation is the database's, so
    # "OD 35 F 4475" and "od35f4475" cannot become two lorries.
    if visitor:
        reg = (visitor.get("registration_no") or "").strip()
        if not reg:
            raise HTTPException(400, "A visiting vehicle needs its registration number.")
        existing = pg.execute(text("""
            SELECT visiting_vehicle_id FROM visiting_vehicle
             WHERE reg_normalised = upper(regexp_replace(:r, '[^A-Za-z0-9]', '', 'g'))
        """), {"r": reg}).scalar()
        if existing:
            visitor_id = existing
        else:
            visitor_id = pg.execute(text("""
                INSERT INTO visiting_vehicle
                       (registration_no, vehicle_type, make, model, axles,
                        payload_capacity_kg, transporter_party_id, owner_name_text,
                        remarks, created_by)
                VALUES (:r, NULLIF(:vt, ''), NULLIF(:mk, ''), NULLIF(:md, ''), :ax,
                        :cap, :tp, NULLIF(:own, ''), NULLIF(:rm, ''), :by)
                RETURNING visiting_vehicle_id
            """), {"r": reg, "vt": (visitor.get("vehicle_type") or "").strip(),
                   "mk": (visitor.get("make") or "").strip(),
                   "md": (visitor.get("model") or "").strip(),
                   "ax": visitor.get("axles"),
                   "cap": visitor.get("payload_capacity_kg"),
                   "tp": visitor.get("transporter_party_id"),
                   "own": (visitor.get("owner_name_text") or "").strip(),
                   "rm": (visitor.get("remarks") or "").strip(),
                   "by": actor}).scalar()

    purpose = (body.get("purpose") or "MINING_CONTRACT").upper()
    if purpose not in ("MINING_CONTRACT", "DESPATCH", "DELIVERY", "VISIT"):
        raise HTTPException(400, "Unknown purpose.")

    already = pg.execute(text("""
        SELECT gate_pass_no FROM gate_pass
         WHERE status = 'IN'
           AND ((CAST(:a AS bigint) IS NOT NULL AND asset_id = CAST(:a AS bigint))
             OR (CAST(:v AS bigint) IS NOT NULL
                 AND visiting_vehicle_id = CAST(:v AS bigint)))
    """), {"a": asset_id, "v": visitor_id}).scalar()
    if already:
        raise HTTPException(409,
            f"That vehicle is already inside on {already}. It stays on that pass "
            "until it leaves — its hauls are recorded as trips against it.")

    gate_no = pg.execute(text("""
        SELECT 'GP-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
               lpad((COALESCE(max(split_part(gate_pass_no, '-', 3)::int), 0) + 1)::text, 4, '0')
          FROM gate_pass
         WHERE gate_pass_no LIKE 'GP-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-%'
    """)).scalar()

    new_id = pg.execute(text("""
        INSERT INTO gate_pass
               (gate_pass_no, plant_id, asset_id, visiting_vehicle_id, operator_id,
                transporter_party_id, driver_name_text, driver_phone_text,
                driver_licence_text, direction, purpose, contract_ref, expected_until,
                entry_at, entry_by, status, remarks, created_by)
        VALUES (:no, :plant, :asset, :visitor, :op,
                :tp, NULLIF(:dn, ''), NULLIF(:dp, ''),
                NULLIF(:dl, ''), 'INBOUND', :purpose, NULLIF(:cref, ''),
                CAST(:until AS date), now(), :by, 'IN', NULLIF(:rm, ''), :by)
        RETURNING gate_pass_id
    """), {"no": gate_no, "plant": body.get("plant_id"), "asset": asset_id,
           "visitor": visitor_id, "op": body.get("operator_id"),
           "tp": body.get("transporter_party_id"),
           "dn": (body.get("driver_name_text") or "").strip(),
           "dp": (body.get("driver_phone_text") or "").strip(),
           "dl": (body.get("driver_licence_text") or "").strip(),
           "purpose": purpose, "cref": (body.get("contract_ref") or "").strip(),
           "until": body.get("expected_until"), "by": actor,
           "rm": (body.get("remarks") or "").strip()}).scalar()

    if visitor_id:
        pg.execute(text("""UPDATE visiting_vehicle
                              SET visits = visits + 1, last_seen_at = now()
                            WHERE visiting_vehicle_id = :v"""), {"v": visitor_id})
    pg.commit()
    return {"gate_pass_id": new_id, "gate_pass_no": gate_no,
            "visiting_vehicle_id": visitor_id}


@router.post("/gate/{pass_id}/exit")
def gate_exit(pass_id: int, request: Request, body: dict = Body(default={}),
              db: Session = Depends(get_db),
              pg: Session = Depends(get_minehub_db)) -> dict:
    """The vehicle leaves the mine for good. Its trips stay on the record."""
    _require(db, request, GATE)

    row = pg.execute(text("""
        SELECT g.status,
               (SELECT count(*) FROM trip t WHERE t.gate_pass_id = g.gate_pass_id) AS trips,
               (SELECT count(*) FROM trip t
                 WHERE t.gate_pass_id = g.gate_pass_id AND t.status = 'OPEN') AS open_trips
          FROM gate_pass g WHERE g.gate_pass_id = :id
    """), {"id": pass_id}).mappings().first()
    if not row:
        raise HTTPException(404, "No such gate pass.")
    if row["status"] != "IN":
        raise HTTPException(409, f"That pass is already {row['status'].lower()}.")
    if row["open_trips"]:
        raise HTTPException(409,
            "That vehicle has a trip open on the bridge. Finish or cancel it "
            "before signing the vehicle out.")

    pg.execute(text("""
        UPDATE gate_pass
           SET status = 'OUT', exit_at = now(), exit_by = :by,
               exit_reason = NULLIF(:r, '')
         WHERE gate_pass_id = :id
    """), {"id": pass_id, "by": _actor(request),
           "r": (body.get("reason") or "").strip()})
    pg.commit()
    return {"ok": True, "trips_recorded": row["trips"]}


# ═══════════════════════════════════════════════════════════════════════════
# The trip — the single point of capture
# ═══════════════════════════════════════════════════════════════════════════
@router.post("/trips")
def start_trip(request: Request, body: dict = Body(...),
               db: Session = Depends(get_db),
               pg: Session = Depends(get_minehub_db)) -> dict:
    """Record a haul, at the bridge, as the truck is weighed.

    Everything is stated here in one action: which vehicle (from those inside),
    who is driving it now, which pit the material came out of, where it is
    going, and what it is. Passing capture=true takes the gross off the bridge
    in the same breath, which is what the operator actually does — the truck is
    on the deck while the form is being filled.
    """
    _require(db, request, WEIGH)
    actor = _actor(request)

    pass_id = body.get("gate_pass_id")
    if not pass_id:
        raise HTTPException(400, "Which vehicle? Pick one from those inside the mine.")

    stay = pg.execute(text("""
        SELECT g.gate_pass_id, g.asset_id, g.visiting_vehicle_id, g.status,
               COALESCE(a.registration_no, vv.registration_no) AS vehicle
          FROM gate_pass g
          LEFT JOIN asset a ON a.asset_id = g.asset_id
          LEFT JOIN visiting_vehicle vv ON vv.visiting_vehicle_id = g.visiting_vehicle_id
         WHERE g.gate_pass_id = :id
    """), {"id": pass_id}).mappings().first()
    if not stay:
        raise HTTPException(404, "No such gate pass.")
    if stay["status"] != "IN":
        raise HTTPException(409,
            f"{stay['vehicle']} is not inside the mine. Admit it at the gate first.")

    if stay["asset_id"]:
        open_trip = pg.execute(text("""
            SELECT trip_no FROM trip WHERE asset_id = :a AND status = 'OPEN'
        """), {"a": stay["asset_id"]}).scalar()
        if open_trip:
            raise HTTPException(409,
                f"{stay['vehicle']} already has trip {open_trip} open. Finish that "
                "one before starting another.")

    prod = body.get("production_date") or date.today().isoformat()
    trip_no = pg.execute(text("""
        SELECT 'T-' || to_char(CAST(:d AS date), 'YYYYMMDD') || '-' ||
               lpad((COALESCE(max(split_part(trip_no, '-', 3)::int), 0) + 1)::text, 5, '0')
          FROM trip
         WHERE trip_no LIKE 'T-' || to_char(CAST(:d AS date), 'YYYYMMDD') || '-%'
    """), {"d": prod}).scalar()

    operator_id = body.get("operator_id")
    visiting_driver_id = body.get("visiting_driver_id")
    if operator_id and visiting_driver_id:
        raise HTTPException(400, "Name one driver, not two.")

    trip_id = pg.execute(text("""
        INSERT INTO trip (trip_no, gate_pass_id, asset_id, visiting_vehicle_id,
                          operator_id, visiting_driver_id,
                          source_location_id, dest_location_id, material_id,
                          grade, sub_grade, shift_code, production_date,
                          weighbridge_id, remarks, created_by)
        VALUES (:no, :gp, :asset, :visitor, :op, :vdrv,
                :src, :dst, :mat, NULLIF(:gr, ''), NULLIF(:sg, ''),
                NULLIF(:sh, ''), CAST(:prod AS date), :wb, NULLIF(:rm, ''), :by)
        RETURNING trip_id
    """), {"no": trip_no, "gp": pass_id, "asset": stay["asset_id"],
           "visitor": stay["visiting_vehicle_id"],
           "op": operator_id, "vdrv": visiting_driver_id,
           "src": body.get("source_location_id"), "dst": body.get("dest_location_id"),
           "mat": body.get("material_id"), "gr": (body.get("grade") or "").strip(),
           "sg": (body.get("sub_grade") or "").strip(),
           "sh": (body.get("shift_code") or "").strip().upper(), "prod": prod,
           "wb": body.get("weighbridge_id"), "rm": (body.get("remarks") or "").strip(),
           "by": actor}).scalar()
    pg.commit()

    out = {"trip_id": trip_id, "trip_no": trip_no, "vehicle": stay["vehicle"]}
    if body.get("capture") and body.get("weighbridge_id"):
        out["gross"] = _record(pg, db, request, trip_id, "GROSS",
                               body["weighbridge_id"], "CAPTURED", None, None, "")
    return out


def _record(pg, db, request, trip_id: int, kind: str, bridge_id: int,
            mode: str, weight_in, reason, remarks: str) -> dict:
    """Store one weighment. Shared by the capture-on-create path and re-weighing.

    A captured weight is read from the bridge here, on the server. The client
    says which bridge, never which number — so there is no request that can put
    a figure the indicator never produced into the record as 'captured'.
    """
    if mode == "CAPTURED":
        reading = pg.execute(text("""
            SELECT reading_id, weight_kg FROM weighbridge_reading
             WHERE weighbridge_id = :b AND is_stable
               AND received_at > now() - interval '30 seconds'
             ORDER BY read_at DESC LIMIT 1
        """), {"b": bridge_id}).mappings().first()
        if not reading:
            raise HTTPException(409,
                "The bridge is not showing a settled weight. Wait for the load to "
                "steady, or check the agent on the weighbridge PC is running.")
        weight = float(reading["weight_kg"])
        reading_id = reading["reading_id"]
        manual_reason = None
    else:
        try:
            weight = float(weight_in)
        except (TypeError, ValueError):
            raise HTTPException(400, "A typed weight needs a number.")
        manual_reason = (reason or "").strip()
        if len(manual_reason) < 5:
            raise HTTPException(400,
                "Say why this weight is being typed rather than taken from the "
                "bridge. It is kept with the figure and shown to management.")
        reading_id = None

    pg.execute(text("DELETE FROM weighment WHERE trip_id = :t AND kind = :k"),
               {"t": trip_id, "k": kind})
    wid = pg.execute(text("""
        INSERT INTO weighment (trip_id, weighbridge_id, kind, weight_kg,
                               capture_mode, reading_id, manual_reason,
                               weighed_by, remarks)
        VALUES (:t, :b, :k, :w, :m, :r, :reason, :by, NULLIF(:rm, ''))
        RETURNING weighment_id
    """), {"t": trip_id, "b": bridge_id, "k": kind, "w": weight, "m": mode,
           "r": reading_id, "reason": manual_reason, "by": _actor(request),
           "rm": remarks}).scalar()

    pg.execute(text("UPDATE trip SET status = 'WEIGHED' WHERE trip_id = :t AND status = 'OPEN'"),
               {"t": trip_id})
    pg.commit()

    tot = pg.execute(text("""SELECT gross_kg, tare_kg, net_kg, tare_source, tare_age_days
                               FROM trip_weights WHERE trip_id = :t"""),
                     {"t": trip_id}).mappings().first()
    return {"weighment_id": wid, "weight_kg": weight, "capture_mode": mode,
            "gross_kg": _f(tot["gross_kg"]) if tot else None,
            "tare_kg": _f(tot["tare_kg"]) if tot else None,
            "net_kg": _f(tot["net_kg"]) if tot else None,
            "tare_source": tot["tare_source"] if tot else None,
            "tare_age_days": tot["tare_age_days"] if tot else None}


@router.post("/trips/{trip_id}/weigh")
def weigh(trip_id: int, request: Request, body: dict = Body(...),
          db: Session = Depends(get_db),
          pg: Session = Depends(get_minehub_db)) -> dict:
    """Record a gross or tare against a trip."""
    kind = (body.get("kind") or "GROSS").upper()
    if kind not in ("GROSS", "TARE"):
        raise HTTPException(400, "kind must be GROSS or TARE.")
    mode = (body.get("capture_mode") or "CAPTURED").upper()
    if mode not in ("CAPTURED", "MANUAL"):
        raise HTTPException(400, "capture_mode must be CAPTURED or MANUAL.")

    _require(db, request, MANUAL if mode == "MANUAL" else WEIGH)

    status = pg.execute(text("SELECT status FROM trip WHERE trip_id = :t"),
                        {"t": trip_id}).scalar()
    if status is None:
        raise HTTPException(404, "No such trip.")
    if status == "CANCELLED":
        raise HTTPException(409, "That trip was cancelled.")

    bridge_id = body.get("weighbridge_id")
    if not bridge_id:
        raise HTTPException(400, "Which bridge?")

    return _record(pg, db, request, trip_id, kind, bridge_id, mode,
                   body.get("weight_kg"), body.get("manual_reason"),
                   (body.get("remarks") or "").strip())


@router.post("/trips/{trip_id}/cancel")
def cancel_trip(trip_id: int, request: Request, body: dict = Body(...),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    """Abandon a trip. Kept, with the reason — a deleted trip is a gap nobody
    can explain later."""
    _require(db, request, WEIGH)
    reason = (body.get("reason") or "").strip()
    if len(reason) < 3:
        raise HTTPException(400, "Give a reason.")
    pg.execute(text("""UPDATE trip SET status = 'CANCELLED', cancel_reason = :r
                        WHERE trip_id = :t AND status <> 'CANCELLED'"""),
               {"t": trip_id, "r": reason})
    pg.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# Standing tare
# ═══════════════════════════════════════════════════════════════════════════
@router.post("/vehicles/{asset_id}/tare")
def set_tare(asset_id: int, request: Request, body: dict = Body(...),
             db: Session = Depends(get_db),
             pg: Session = Depends(get_minehub_db)) -> dict:
    """Take a vehicle's empty weight, for use across its hauls.

    Its own right, because this one figure produces every net weight for that
    vehicle until it is taken again. Getting it wrong is not one bad trip, it
    is a fortnight of them.
    """
    _require(db, request, TARE)

    bridge_id = body.get("weighbridge_id")
    if not bridge_id:
        raise HTTPException(400, "Which bridge?")

    reading = pg.execute(text("""
        SELECT reading_id, weight_kg FROM weighbridge_reading
         WHERE weighbridge_id = :b AND is_stable
           AND received_at > now() - interval '30 seconds'
         ORDER BY read_at DESC LIMIT 1
    """), {"b": bridge_id}).mappings().first()
    if not reading:
        raise HTTPException(409,
            "The bridge is not showing a settled weight. Drive the empty vehicle "
            "onto the deck and let it steady.")

    weight = float(reading["weight_kg"])
    prev = pg.execute(text("""SELECT standing_tare_kg, tare_taken_at FROM asset
                               WHERE asset_id = :a"""), {"a": asset_id}).mappings().first()
    if prev is None:
        raise HTTPException(404, "No such vehicle on the register.")

    pg.execute(text("""
        UPDATE asset SET standing_tare_kg = :w, tare_taken_at = now(), tare_taken_by = :by
         WHERE asset_id = :a
    """), {"a": asset_id, "w": weight, "by": _actor(request)})
    pg.commit()

    before = _f(prev["standing_tare_kg"])
    return {"standing_tare_kg": weight, "previous_kg": before,
            "change_kg": round(weight - before, 2) if before is not None else None,
            "previous_taken_at": prev["tare_taken_at"]}


# ═══════════════════════════════════════════════════════════════════════════
# Bridges and agents
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/agents")
def agents(request: Request,
           db: Session = Depends(get_db),
           pg: Session = Depends(get_minehub_db)) -> dict:
    """Agent health. Never the token — only when it was last heard from."""
    _require(db, request, VIEW)
    rows = [dict(r) for r in pg.execute(text("""
        SELECT a.agent_id, a.machine_name, a.watch_path, a.parser, a.poll_ms,
               a.version, a.last_seen_at, a.last_error, a.status,
               round(EXTRACT(EPOCH FROM (now() - a.last_seen_at)))::int AS age_seconds,
               w.code AS bridge, w.weighbridge_id,
               (SELECT count(*) FROM weighbridge_reading r
                 WHERE r.agent_id = a.agent_id
                   AND r.received_at > now() - interval '1 hour') AS readings_last_hour
          FROM weighbridge_agent a
          JOIN weighbridge w ON w.weighbridge_id = a.weighbridge_id
         ORDER BY w.code, a.machine_name
    """)).mappings()]
    for r in rows:
        age = r.pop("age_seconds", None)
        r["seconds_since_seen"] = age
        r["is_up"] = age is not None and age < 60
    return {"agents": rows}


@router.get("/bridges")
def bridges(request: Request,
            db: Session = Depends(get_db),
            pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, VIEW)
    return {"bridges": [dict(r) for r in pg.execute(text("""
        SELECT w.*, (SELECT count(*) FROM weighbridge_agent a
                      WHERE a.weighbridge_id = w.weighbridge_id
                        AND a.status = 'ACTIVE') AS agents
          FROM weighbridge w ORDER BY w.code
    """)).mappings()]}


@router.post("/agents")
def issue_agent(request: Request, body: dict = Body(...),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    """Register a weighbridge PC and issue its token.

    Returned once; only the hash is kept. There is no endpoint that can show it
    again — a lost token is replaced, not recovered.
    """
    _require(db, request, MANAGE)

    machine = (body.get("machine_name") or "").strip()
    bridge_id = body.get("weighbridge_id")
    watch_path = (body.get("watch_path") or "").strip()
    if not machine or not bridge_id or not watch_path:
        raise HTTPException(400, "The PC name, the bridge and the file path are all needed.")

    token = secrets.token_urlsafe(32)
    agent_id = pg.execute(text("""
        INSERT INTO weighbridge_agent (weighbridge_id, machine_name, token_hash,
                                       watch_path, parser, poll_ms, created_by)
        VALUES (:b, :m, :h, :p, COALESCE(NULLIF(:parser, ''), 'auto'),
                COALESCE(:poll, 400), :by)
        RETURNING agent_id
    """), {"b": bridge_id, "m": machine, "h": _hash(token), "p": watch_path,
           "parser": (body.get("parser") or "").strip(),
           "poll": body.get("poll_ms"), "by": _actor(request)}).scalar()
    pg.commit()
    return {"agent_id": agent_id, "token": token,
            "note": ("Copy this into wbagent.ini on that PC now. It cannot be shown "
                     "again — if it is lost, issue a new one and disable this.")}


@router.delete("/agents/{agent_id}")
def remove_agent(agent_id: int, request: Request,
                 db: Session = Depends(get_db),
                 pg: Session = Depends(get_minehub_db)) -> dict:
    """Take a PC off the list.

    Two different things are called "delete" here, and which one happens
    depends on whether the agent ever reported a weight.

    An agent that has sent readings is part of the record: every weighment it
    carried names it as the source, and that is how a figure is traced back to
    the machine that produced it years later. Such an agent is disabled, never
    removed — it stops being accepted, and its history stays attached.

    An agent that has never sent anything is not history, it is a typo. Someone
    registered the bridge twice, or named it wrongly and registered it again.
    Disabling those leaves them on the screen forever, greyed out, indistinguish-
    able from a machine that genuinely died — which is how the list stops being
    read at all. There is nothing to preserve, so it is deleted.
    """
    _require(db, request, MANAGE)

    reported = pg.execute(
        text("SELECT EXISTS (SELECT 1 FROM weighbridge_reading WHERE agent_id = :id)"),
        {"id": agent_id}).scalar()

    if reported:
        pg.execute(
            text("UPDATE weighbridge_agent SET status = 'DISABLED' WHERE agent_id = :id"),
            {"id": agent_id})
        pg.commit()
        return {"ok": True, "action": "disabled",
                "detail": "This agent has sent readings, so it is kept and disabled."}

    # The NOT EXISTS is repeated here deliberately. The check above and the
    # delete are two statements; a reading arriving between them would otherwise
    # orphan itself against the foreign key. In the WHERE clause the database
    # decides, not a value this read a moment ago.
    removed = pg.execute(text("""
        DELETE FROM weighbridge_agent a
         WHERE a.agent_id = :id
           AND NOT EXISTS (SELECT 1 FROM weighbridge_reading r
                            WHERE r.agent_id = a.agent_id)
        RETURNING a.agent_id"""), {"id": agent_id}).scalar()
    pg.commit()

    if removed is None:
        raise HTTPException(409, "That agent started reporting just now, so it "
                                 "was kept. Disable it instead.")
    return {"ok": True, "action": "removed",
            "detail": "This agent never reported, so it was removed."}


@router.post("/drivers")
def register_visiting_driver(request: Request, body: dict = Body(...),
                             db: Session = Depends(get_db),
                             pg: Session = Depends(get_minehub_db)) -> dict:
    """Record a driver who is not on the operator register.

    For the man who brings a despatch lorry in once. Keyed on his licence
    number, so the same driver is one record however his name is spelled, and
    the second visit finds him instead of describing him again.

    This is deliberately not the operator register. Putting him there would
    mean a competency file, an induction and a medical that nobody is going to
    complete for a delivery — and would make the register mean less for the
    drivers it does cover.
    """
    _require(db, request, GATE)

    name = (body.get("full_name") or "").strip()
    licence = (body.get("licence_no") or "").strip()
    if not name or not licence:
        raise HTTPException(400, "A visiting driver needs a name and a licence number.")

    existing = pg.execute(text("""
        SELECT visiting_driver_id FROM visiting_driver
         WHERE licence_normalised = upper(regexp_replace(:l, '[^A-Za-z0-9]', '', 'g'))
    """), {"l": licence}).scalar()
    if existing:
        pg.execute(text("""UPDATE visiting_driver
                              SET full_name = :n,
                                  phone = COALESCE(NULLIF(:ph, ''), phone),
                                  licence_valid_upto =
                                      COALESCE(CAST(:vu AS date), licence_valid_upto)
                            WHERE visiting_driver_id = :id"""),
                   {"id": existing, "n": name, "ph": (body.get("phone") or "").strip(),
                    "vu": body.get("licence_valid_upto")})
        pg.commit()
        return {"visiting_driver_id": existing, "already_known": True}

    new_id = pg.execute(text("""
        INSERT INTO visiting_driver (full_name, licence_no, licence_valid_upto,
                                     phone, transporter_party_id, employer_name_text,
                                     remarks, created_by)
        VALUES (:n, :l, CAST(:vu AS date), NULLIF(:ph, ''), :tp, NULLIF(:emp, ''),
                NULLIF(:rm, ''), :by)
        RETURNING visiting_driver_id
    """), {"n": name, "l": licence, "vu": body.get("licence_valid_upto"),
           "ph": (body.get("phone") or "").strip(),
           "tp": body.get("transporter_party_id"),
           "emp": (body.get("employer_name_text") or "").strip(),
           "rm": (body.get("remarks") or "").strip(), "by": _actor(request)}).scalar()
    pg.commit()
    return {"visiting_driver_id": new_id, "already_known": False}
