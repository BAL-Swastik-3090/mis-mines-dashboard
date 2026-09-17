"""Operator 360 — the people who run the machines.

The equipment register answers what a machine is. This answers who may run it,
how well they understand it, what they are certified for, and what is about to
lapse.

Two shapes carry most of the profile. `operator_record` holds everything that is
"a titled thing, from an issuer, between two dates, possibly verified" —
education, languages, previous experience, licences, medicals, training,
certificates, safety records — distinguished by record_type rather than by having
a table each. `operator_competency` holds levels, one row per equipment class per
dimension, where OVERALL is the competency and the rest are the understanding
questions. The distinctions the specification insists on are kept; the tables
that would have duplicated each other are not.

Actual operation history is deliberately absent from both: it belongs in the
append-only partitioned event log, fed from HOTO and telematics, not in a table
this router writes.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import people

router = APIRouter(prefix="/api/operators", tags=["Operators"])


# ── the fields a form may write ──────────────────────────────────────────────
# Named explicitly: a profile holds personal and medical data, and "whatever the
# client sent" is not an acceptable definition of what may be written to it.
PARTY_FIELDS = (
    "display_name", "legal_name", "gender", "date_of_birth", "blood_group",
    "phone", "email", "photo_ref",
)

OPERATOR_FIELDS = (
    "employment_type", "employer_party_id", "org_unit_id", "plant_id", "designation",
    "joined_on", "employment_end", "supervisor_party_id", "shift_pattern", "work_location_id",
    "alternate_phone", "emergency_contact_name", "emergency_contact_phone",
    "emergency_contact_relation", "current_address", "permanent_address",
    "highest_qualification", "qualification_type", "institution", "year_of_passing",
    "reading_level", "writing_level", "numeracy_level", "digital_level",
    "safety_sign_level", "record_keeping_level",
    "exp_total_months", "exp_mining_months", "exp_hemm_months", "exp_operator_months",
    "exp_kaliapani_months", "exp_current_role_months", "exp_verified_months",
    "exp_verified_by", "exp_verified_on",
    "profile_status", "suspension_reason", "remarks",
)

RECORD_FIELDS = (
    "record_type", "title", "category", "asset_type_id", "document_no", "issuer",
    "issued_on", "valid_from", "valid_upto", "refresher_due", "result", "score",
    "duration_hours", "restrictions", "verification_status", "verified_by",
    "verified_on", "document_ref", "status", "remarks", "details",
)

INT_FIELDS = {
    "employer_party_id", "org_unit_id", "plant_id", "supervisor_party_id",
    "work_location_id", "asset_type_id", "asset_id", "year_of_passing",
    "exp_total_months", "exp_mining_months", "exp_hemm_months", "exp_operator_months",
    "exp_kaliapani_months", "exp_current_role_months", "exp_verified_months", "level",
}

MANAGE = "platform.operators.manage"
ASSESS = "platform.operators.assess"
APPROVE = "platform.operators.approve"


# ── shared plumbing ──────────────────────────────────────────────────────────
def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _perms(request: Request) -> set:
    return getattr(request.state, "permissions", None) or set()


def _require(request: Request, permission: str, what: str) -> None:
    if permission not in _perms(request):
        raise HTTPException(
            403, f"You do not have permission to {what}. "
                 "An Access Manager can add it to your role.")


def _clean(body: dict, allowed: tuple[str, ...]) -> dict:
    """Form values into database values.

    A browser form sends "" for an untouched field, and "" is not a date, a
    number or a foreign key — it is the absence of one.
    """
    out: dict = {}
    for key in allowed:
        if key not in body:
            continue
        v = body[key]
        if isinstance(v, str):
            v = v.strip() or None
        if v is not None and key in INT_FIELDS:
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise HTTPException(400, f"{key} must be a number.")
        if key == "details" and v is not None and not isinstance(v, str):
            v = json.dumps(v)
        out[key] = v
    return out


def _same(a, b) -> bool:
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
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def _revise(db, request: Request, operator_id: int, version: int, action: str,
            changes: dict, remarks: str | None = None) -> None:
    snap = db.execute(text("SELECT * FROM operator WHERE operator_id = :id"),
                      {"id": operator_id}).mappings().first()
    db.execute(text(
        "INSERT INTO operator_revision (operator_id, version, action, changes, snapshot, "
        "remarks, changed_by) VALUES (:o, :v, :a, CAST(:ch AS jsonb), CAST(:sn AS jsonb), :rm, :by)"
    ), {"o": operator_id, "v": version, "a": action,
        "ch": json.dumps(changes, default=str),
        "sn": json.dumps({k: _jsonable(v) for k, v in dict(snap).items()}, default=str) if snap else None,
        "rm": remarks, "by": _actor(request)})


def _activity(db, request: Request, event_type: str, operator_id: int | None = None,
              payload: dict | None = None, party_id: int | None = None) -> None:
    """The append-only log, shared with the equipment side.

    party_id is a real column on the event table, so an operator's activity can
    be found by the person rather than only by reading payloads.
    """
    db.execute(text("""
        INSERT INTO event (event_type, occurred_at, recorded_at, source,
                           party_id, payload, recorded_by)
        VALUES (:t, now(), now(), 'WEB', :party, CAST(:p AS jsonb), :by)
    """), {"t": event_type, "party": party_id,
           "p": json.dumps({**(payload or {}), "operator_id": operator_id}, default=str),
           "by": _actor(request)})


# ── the register ─────────────────────────────────────────────────────────────
@router.get("")
def list_operators(q: str = Query(""), status: str = Query(""),
                   asset_type_id: int | None = Query(None),
                   db: Session = Depends(get_minehub_db)) -> list[dict]:
    """The register. One row per person, with enough to judge them at a glance."""
    where, params = ["1=1"], {}
    if q.strip():
        where.append("(p.display_name ILIKE :q OR o.operator_ref ILIKE :q "
                     "OR o.designation ILIKE :q OR EXISTS (SELECT 1 FROM party_identity i "
                     "WHERE i.party_id = o.party_id AND i.external_code ILIKE :q))")
        params["q"] = f"%{q.strip()}%"
    if status:
        where.append("o.approval_status = :st")
        params["st"] = status
    if asset_type_id:
        where.append("EXISTS (SELECT 1 FROM operator_competency c WHERE c.operator_id = o.operator_id "
                     "AND c.asset_type_id = :atid AND c.dimension = 'OVERALL' AND c.level >= 2)")
        params["atid"] = asset_type_id

    rows = db.execute(text(f"""
        SELECT o.operator_id, o.operator_ref, o.approval_status, o.profile_status,
               o.employment_type, o.designation, o.version,
               o.exp_total_months, o.exp_hemm_months, o.joined_on,
               p.party_id, p.display_name, p.phone, p.photo_ref, p.blood_group,
               e.display_name AS employer, ou.name AS department, pl.name AS plant,
               (SELECT count(*) FROM operator_competency c
                 WHERE c.operator_id = o.operator_id AND c.dimension = 'OVERALL'
                   AND c.level >= 2)                               AS machines_competent,
               (SELECT count(*) FROM operator_record r
                 WHERE r.operator_id = o.operator_id AND r.status = 'ACTIVE'
                   AND r.valid_upto IS NOT NULL AND r.valid_upto < CURRENT_DATE) AS expired_documents,
               (SELECT string_agg(DISTINCT a.fleet_code, ', ')
                  FROM operator_assignment oa JOIN asset a ON a.asset_id = oa.asset_id
                 WHERE oa.operator_id = o.operator_id AND oa.status = 'ACTIVE'
                   AND (oa.valid_to IS NULL OR oa.valid_to >= CURRENT_DATE)) AS assigned_to
        FROM operator o
        JOIN party p           ON p.party_id = o.party_id
        LEFT JOIN party e      ON e.party_id = o.employer_party_id
        LEFT JOIN org_unit ou  ON ou.org_unit_id = o.org_unit_id
        LEFT JOIN plant pl     ON pl.plant_id = o.plant_id
        WHERE {' AND '.join(where)}
        ORDER BY p.display_name
    """), params).mappings().all()
    return [dict(r) for r in rows]


@router.get("/summary")
def summary(db: Session = Depends(get_minehub_db)) -> dict:
    """What the register looks like as a whole."""
    row = db.execute(text("""
        SELECT (SELECT count(*) FROM operator)                                    AS operators,
               (SELECT count(*) FROM operator WHERE approval_status = 'APPROVED') AS approved,
               (SELECT count(*) FROM operator WHERE approval_status = 'SUBMITTED') AS awaiting,
               (SELECT count(*) FROM operator_competency
                 WHERE dimension = 'OVERALL' AND level >= 2)                      AS competencies,
               (SELECT count(*) FROM operator_alert WHERE severity = 'EXPIRED')   AS expired,
               (SELECT count(*) FROM operator_alert WHERE severity = 'DUE')       AS due
    """)).mappings().first()
    return dict(row or {})


@router.get("/unregistered")
def unregistered(db: Session = Depends(get_minehub_db),
                 corp: Session = Depends(get_db)) -> list[dict]:
    """People the mine's own records name, who have no profile here yet.

    The driver master and the handover sheets are two lists of the same
    workforce that do not know about each other. Rather than importing either
    one blind — 133 rows whose licence fields have never been filled and whose
    Equipment_Type column holds machine names — they become a queue that is
    worked through one person at a time, each arriving correct.
    """
    try:
        drivers = corp.execute(text("""
            SELECT d.Driver_Name AS name, d.Emp_Code AS code, d.Equipment_Type AS machine,
                   d.Driver_Status AS grade, MAX(d.Entry_Date) AS last_seen, 'DRIVER_MASTER' AS source
            FROM mines_driver_master d
            GROUP BY d.Driver_Name, d.Emp_Code, d.Equipment_Type, d.Driver_Status
            ORDER BY d.Driver_Name
        """)).mappings().all()
    except Exception:                       # noqa: BLE001 — the screen still works
        drivers = []

    known = {r[0] for r in db.execute(text(
        "SELECT external_code FROM party_identity WHERE external_code IS NOT NULL"))}
    known_names = {(r[0] or "").strip().upper() for r in db.execute(text(
        "SELECT p.display_name FROM operator o JOIN party p ON p.party_id = o.party_id"))}

    out = []
    for d in drivers:
        code = (d["code"] or "").strip()
        name = (d["name"] or "").strip()
        if (code and code in known) or name.upper() in known_names:
            continue
        out.append({"name": name, "code": code or None, "machine": d["machine"],
                    "grade": d["grade"], "last_seen": d["last_seen"], "source": d["source"]})
    return out


@router.get("/alerts")
def alerts(db: Session = Depends(get_minehub_db)) -> list[dict]:
    """What is expiring or has expired, soonest first."""
    rows = db.execute(text(
        "SELECT * FROM operator_alert WHERE severity <> 'OK' ORDER BY days_left"
    )).mappings().all()
    return [dict(r) for r in rows]


@router.get("/matrix")
def capability_matrix(db: Session = Depends(get_minehub_db)) -> dict:
    """Operators down the side, equipment classes across the top.

    One screen that answers whether three excavators can be crewed on B shift.
    """
    types = [dict(r) for r in db.execute(text(
        "SELECT asset_type_id, name FROM asset_type WHERE status = 'ACTIVE' ORDER BY name"
    )).mappings().all()]

    rows = db.execute(text("""
        SELECT o.operator_id, o.operator_ref, p.display_name,
               c.asset_type_id, c.level, c.valid_upto,
               (c.valid_upto IS NOT NULL AND c.valid_upto < CURRENT_DATE) AS assessment_lapsed
        FROM operator o
        JOIN party p ON p.party_id = o.party_id
        LEFT JOIN operator_competency c
               ON c.operator_id = o.operator_id AND c.dimension = 'OVERALL' AND c.status = 'ACTIVE'
        WHERE o.profile_status = 'ACTIVE'
        ORDER BY p.display_name
    """)).mappings().all()

    people_rows: dict[int, dict] = {}
    for r in rows:
        person = people_rows.setdefault(r["operator_id"], {
            "operator_id": r["operator_id"], "operator_ref": r["operator_ref"],
            "name": r["display_name"], "levels": {},
        })
        if r["asset_type_id"]:
            person["levels"][str(r["asset_type_id"])] = {
                "level": r["level"], "lapsed": r["assessment_lapsed"]}
    return {"asset_types": types, "operators": list(people_rows.values())}


# ── one profile ──────────────────────────────────────────────────────────────
@router.get("/{operator_id}")
def get_operator(operator_id: int, db: Session = Depends(get_minehub_db),
                 corp: Session = Depends(get_db)) -> dict:
    """The whole 360 in one call — the screen shows it as tabs, not as requests."""
    row = db.execute(text("""
        SELECT o.*, p.display_name, p.legal_name, p.gender, p.date_of_birth, p.blood_group,
               p.phone, p.email, p.photo_ref,
               e.display_name AS employer, ou.name AS department, pl.name AS plant,
               s.display_name AS supervisor, l.name AS work_location
        FROM operator o
        JOIN party p           ON p.party_id = o.party_id
        LEFT JOIN party e      ON e.party_id = o.employer_party_id
        LEFT JOIN party s      ON s.party_id = o.supervisor_party_id
        LEFT JOIN org_unit ou  ON ou.org_unit_id = o.org_unit_id
        LEFT JOIN plant pl     ON pl.plant_id = o.plant_id
        LEFT JOIN location l   ON l.location_id = o.work_location_id
        WHERE o.operator_id = :id
    """), {"id": operator_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Operator not found.")

    out = dict(row)
    out["records"] = [dict(r) for r in db.execute(text(
        "SELECT * FROM operator_record WHERE operator_id = :id "
        "ORDER BY record_type, COALESCE(valid_upto, issued_on) DESC NULLS LAST"
    ), {"id": operator_id}).mappings().all()]

    out["competencies"] = [dict(r) for r in db.execute(text(
        "SELECT c.*, t.name AS asset_type, a.fleet_code FROM operator_competency c "
        "LEFT JOIN asset_type t ON t.asset_type_id = c.asset_type_id "
        "LEFT JOIN asset a ON a.asset_id = c.asset_id "
        "WHERE c.operator_id = :id ORDER BY t.name, c.dimension"
    ), {"id": operator_id}).mappings().all()]

    out["assignments"] = [dict(r) for r in db.execute(text(
        "SELECT oa.*, a.fleet_code, a.nickname, t.name AS asset_type "
        "FROM operator_assignment oa JOIN asset a ON a.asset_id = oa.asset_id "
        "LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id "
        "WHERE oa.operator_id = :id ORDER BY oa.valid_from DESC"
    ), {"id": operator_id}).mappings().all()]

    out["identities"] = [dict(r) for r in db.execute(text(
        "SELECT party_identity_id, system, external_code, is_primary FROM party_identity "
        "WHERE party_id = :p ORDER BY system"
    ), {"p": row["party_id"]}).mappings().all()]

    out["alerts"] = [dict(r) for r in db.execute(text(
        "SELECT * FROM operator_alert WHERE operator_id = :id AND severity <> 'OK' ORDER BY days_left"
    ), {"id": operator_id}).mappings().all()]

    # What SAP knows, if any identity points there — read, never copied.
    sap = next((i["external_code"] for i in out["identities"] if i["system"] == "SAP"), None)
    out["sap_name"] = people.names_for(corp, [sap]).get(sap) if sap else None
    return out


@router.post("")
def create_operator(request: Request, body: dict = Body(...),
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Start a profile. A name is enough; everything else can follow."""
    _require(request, MANAGE, "register operators")

    party = _clean(body, PARTY_FIELDS)
    name = (party.get("display_name") or "").strip()
    if not name:
        raise HTTPException(400, "A name is needed to start a profile.")
    party.setdefault("legal_name", name)

    cols = list(party.keys())
    party_id = db.execute(text(
        f"INSERT INTO party (party_type, {', '.join(cols)}, created_by) "
        f"VALUES ('PERSON', {', '.join(':' + c for c in cols)}, :by) RETURNING party_id"
    ), {**party, "by": _actor(request)}).scalar()

    data = _clean(body, OPERATOR_FIELDS)
    if not data.get("plant_id"):
        data["plant_id"] = db.execute(text(
            "SELECT plant_id FROM plant WHERE is_default LIMIT 1")).scalar()

    cols = list(data.keys())
    created = db.execute(text(
        f"INSERT INTO operator (party_id, {', '.join(cols)}, created_by, operator_ref) "
        f"VALUES (:pid, {', '.join(':' + c for c in cols)}, :by, next_operator_ref()) "
        "RETURNING operator_id, operator_ref"
    ), {**data, "pid": party_id, "by": _actor(request)}).mappings().first()

    operator_id = created["operator_id"]
    for ident in body.get("identities") or []:
        code = (ident.get("external_code") or "").strip()
        if not code:
            continue
        db.execute(text(
            "INSERT INTO party_identity (party_id, system, external_code, created_by) "
            "VALUES (:p, :s, :c, :by)"
        ), {"p": party_id, "s": (ident.get("system") or "OTHER").upper(),
            "c": code, "by": _actor(request)})

    _revise(db, request, operator_id, 1, "CREATED",
            {k: {"from": None, "to": _jsonable(v)} for k, v in {**party, **data}.items() if v is not None},
            remarks="Profile started")
    _activity(db, request, "OPERATOR_REGISTERED", operator_id,
              {"name": name, "operator_ref": created["operator_ref"]}, party_id=party_id)
    db.commit()
    return {"ok": True, "operator_id": operator_id, "party_id": party_id,
            "operator_ref": created["operator_ref"]}


@router.put("/{operator_id}")
def update_operator(operator_id: int, request: Request, body: dict = Body(...),
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Save a change, recording what actually moved."""
    _require(request, MANAGE, "edit operator profiles")

    before = db.execute(text(
        "SELECT o.*, p.display_name, p.legal_name, p.gender, p.date_of_birth, "
        "       p.blood_group, p.phone, p.email, p.photo_ref "
        "FROM operator o JOIN party p ON p.party_id = o.party_id WHERE o.operator_id = :id"
    ), {"id": operator_id}).mappings().first()
    if not before:
        raise HTTPException(404, "Operator not found.")

    party = _clean(body, PARTY_FIELDS)
    data = _clean(body, OPERATOR_FIELDS)

    changes = {k: {"from": _jsonable(before.get(k)), "to": _jsonable(v)}
               for k, v in {**party, **data}.items() if not _same(before.get(k), v)}
    if not changes:
        return {"ok": True, "changed": 0, "version": before["version"]}

    reset = before["approval_status"] == "APPROVED"
    version = before["version"] + 1

    if party:
        db.execute(text(
            f"UPDATE party SET {', '.join(f'{c} = :{c}' for c in party)} WHERE party_id = :pid"
        ), {**party, "pid": before["party_id"]})

    sets = [f"{c} = :{c}" for c in data]
    db.execute(text(
        f"UPDATE operator SET {', '.join(sets + ['version = :ver', 'updated_at = now()'])}"
        + (", approval_status = 'DRAFT', approved_by = NULL, approved_at = NULL" if reset else "")
        + " WHERE operator_id = :id"
    ), {**data, "ver": version, "id": operator_id})

    _revise(db, request, operator_id, version, "UPDATED", changes,
            remarks=body.get("remarks_for_change"))
    _activity(db, request, "OPERATOR_UPDATED", operator_id,
              {"version": version, "fields": sorted(changes)})
    db.commit()
    return {"ok": True, "version": version, "changed": len(changes), "approval_reset": reset}


@router.delete("/{operator_id}")
def discard_operator(operator_id: int, request: Request,
                     db: Session = Depends(get_minehub_db)) -> dict:
    """Throw away a draft profile, and the person record created with it."""
    _require(request, MANAGE, "edit operator profiles")
    row = db.execute(text(
        "SELECT o.approval_status, o.party_id, o.operator_ref, p.display_name "
        "FROM operator o JOIN party p ON p.party_id = o.party_id WHERE o.operator_id = :id"
    ), {"id": operator_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Operator not found.")
    if row["approval_status"] not in ("DRAFT", "SENT_BACK"):
        raise HTTPException(400, "Only a draft can be discarded. This profile has been "
                                 "approved — set its status to Inactive instead.")

    _activity(db, request, "OPERATOR_DISCARDED", operator_id,
              {"name": row["display_name"], "operator_ref": row["operator_ref"]})
    db.execute(text("DELETE FROM party WHERE party_id = :p"), {"p": row["party_id"]})
    db.commit()
    return {"ok": True, "discarded": row["operator_ref"]}


# ── approval ─────────────────────────────────────────────────────────────────
@router.post("/{operator_id}/submit")
def submit_operator(operator_id: int, request: Request, body: dict = Body(default={}),
                    db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "submit operator profiles")
    row = db.execute(text(
        "SELECT o.approval_status, o.version, o.employment_type, o.plant_id, p.display_name "
        "FROM operator o JOIN party p ON p.party_id = o.party_id WHERE o.operator_id = :id"
    ), {"id": operator_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Operator not found.")

    missing = []
    if not (row["display_name"] or "").strip():
        missing.append("a name")
    if not row["employment_type"]:
        missing.append("an employment type")
    if not row["plant_id"]:
        missing.append("a plant")
    if missing:
        raise HTTPException(400, "Before this can go for approval it needs "
                                 + ", ".join(missing[:-1]) + (" and " if len(missing) > 1 else "")
                                 + missing[-1] + ".")
    if row["approval_status"] == "SUBMITTED":
        raise HTTPException(400, "This profile is already awaiting approval.")
    if row["approval_status"] == "APPROVED":
        raise HTTPException(400, "This profile is already approved.")

    db.execute(text("UPDATE operator SET approval_status = 'SUBMITTED', submitted_by = :by, "
                    "submitted_at = now() WHERE operator_id = :id"),
               {"by": _actor(request), "id": operator_id})
    _revise(db, request, operator_id, row["version"], "SUBMITTED", {}, body.get("remarks"))
    db.commit()
    return {"ok": True, "approval_status": "SUBMITTED"}


@router.post("/{operator_id}/approve")
def approve_operator(operator_id: int, request: Request, body: dict = Body(default={}),
                     db: Session = Depends(get_minehub_db)) -> dict:
    """Accept a profile onto the register — never your own submission."""
    _require(request, APPROVE, "approve operator profiles")
    row = db.execute(text(
        "SELECT approval_status, version, submitted_by FROM operator WHERE operator_id = :id"
    ), {"id": operator_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Operator not found.")
    if row["approval_status"] != "SUBMITTED":
        raise HTTPException(400, "Only a profile awaiting approval can be approved.")
    if row["submitted_by"] and row["submitted_by"] == _actor(request):
        raise HTTPException(403, "You submitted this profile — someone else has to approve it.")

    db.execute(text("UPDATE operator SET approval_status = 'APPROVED', approved_by = :by, "
                    "approved_at = now() WHERE operator_id = :id"),
               {"by": _actor(request), "id": operator_id})
    _revise(db, request, operator_id, row["version"], "APPROVED", {}, body.get("remarks"))
    db.commit()
    return {"ok": True, "approval_status": "APPROVED"}


@router.post("/{operator_id}/send-back")
def send_back_operator(operator_id: int, request: Request, body: dict = Body(default={}),
                       db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, APPROVE, "approve operator profiles")
    remarks = (body.get("remarks") or "").strip()
    if not remarks:
        raise HTTPException(400, "Say what needs correcting — a bare rejection helps nobody.")

    row = db.execute(text(
        "SELECT approval_status, version FROM operator WHERE operator_id = :id"
    ), {"id": operator_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Operator not found.")
    if row["approval_status"] != "SUBMITTED":
        raise HTTPException(400, "Only a profile awaiting approval can be sent back.")

    db.execute(text("UPDATE operator SET approval_status = 'SENT_BACK' WHERE operator_id = :id"),
               {"id": operator_id})
    _revise(db, request, operator_id, row["version"], "SENT_BACK", {}, remarks)
    db.commit()
    return {"ok": True, "approval_status": "SENT_BACK"}


@router.get("/{operator_id}/revisions")
def operator_revisions(operator_id: int, db: Session = Depends(get_minehub_db),
                       corp: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(text(
        "SELECT revision_id, version, action, changes, remarks, changed_by, changed_at "
        "FROM operator_revision WHERE operator_id = :id "
        "ORDER BY changed_at DESC, revision_id DESC"
    ), {"id": operator_id}).mappings().all()
    names = people.names_for(corp, [r["changed_by"] for r in rows])
    return [{**dict(r), "changed_by_name": names.get(r["changed_by"])} for r in rows]


# ── records: every dated, issued, verifiable thing ───────────────────────────
@router.post("/{operator_id}/records")
def add_record(operator_id: int, request: Request, body: dict = Body(...),
               db: Session = Depends(get_minehub_db)) -> dict:
    """One row for a licence, a medical, a course, a language, a past job.

    The kind is a value, not a table. What differs between kinds lives in
    `details`, so adding a kind the mine turns out to track does not mean a
    migration and a new screen.
    """
    _require(request, MANAGE, "edit operator profiles")
    data = _clean(body, RECORD_FIELDS)
    if not data.get("record_type"):
        raise HTTPException(400, "Say what kind of record this is.")
    data["record_type"] = data["record_type"].upper()

    cols = list(data.keys())
    values = ", ".join(f"CAST(:{c} AS jsonb)" if c == "details" else f":{c}" for c in cols)
    row = db.execute(text(
        f"INSERT INTO operator_record (operator_id, {', '.join(cols)}, created_by) "
        f"VALUES (:oid, {values}, :by) RETURNING *"
    ), {**data, "oid": operator_id, "by": _actor(request)}).mappings().first()

    _activity(db, request, "OPERATOR_RECORD_ADDED", operator_id,
              {"record_type": data["record_type"], "title": data.get("title")})
    db.commit()
    return dict(row)


@router.put("/{operator_id}/records/{record_id}")
def update_record(operator_id: int, record_id: int, request: Request,
                  body: dict = Body(...), db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "edit operator profiles")
    data = _clean(body, RECORD_FIELDS)
    if not data:
        return {"ok": True, "changed": 0}

    sets = ", ".join(f"details = CAST(:details AS jsonb)" if c == "details" else f"{c} = :{c}"
                     for c in data)
    row = db.execute(text(
        f"UPDATE operator_record SET {sets}, updated_at = now() "
        "WHERE operator_record_id = :rid AND operator_id = :oid RETURNING *"
    ), {**data, "rid": record_id, "oid": operator_id}).mappings().first()
    if not row:
        raise HTTPException(404, "That record is not on this profile.")
    db.commit()
    return dict(row)


@router.delete("/{operator_id}/records/{record_id}")
def delete_record(operator_id: int, record_id: int, request: Request,
                  db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "edit operator profiles")
    db.execute(text("DELETE FROM operator_record WHERE operator_record_id = :r AND operator_id = :o"),
               {"r": record_id, "o": operator_id})
    _activity(db, request, "OPERATOR_RECORD_REMOVED", operator_id, {"record_id": record_id})
    db.commit()
    return {"ok": True}


# ── competency and understanding ─────────────────────────────────────────────
@router.post("/{operator_id}/competency")
def set_competency(operator_id: int, request: Request, body: dict = Body(...),
                   db: Session = Depends(get_minehub_db)) -> dict:
    """Record a level for one equipment class and one dimension.

    Assessing is its own permission. Saying that someone may run an excavator is
    a different act from typing their phone number, and is usually done by
    training rather than by whoever keeps the register.
    """
    _require(request, ASSESS, "assess competency")
    data = _clean(body, ("asset_type_id", "asset_id", "dimension", "level", "assessment_type",
                         "assessor", "assessed_on", "score", "result", "valid_upto", "remarks"))
    if not data.get("asset_type_id"):
        raise HTTPException(400, "Choose the equipment class being assessed.")
    data["dimension"] = (data.get("dimension") or "OVERALL").upper()
    data.setdefault("assessor", _actor(request))

    evidence = json.dumps(body.get("evidence") or {}, default=str)
    cols = list(data.keys())
    row = db.execute(text(
        f"INSERT INTO operator_competency (operator_id, {', '.join(cols)}, evidence, created_by) "
        f"VALUES (:oid, {', '.join(':' + c for c in cols)}, CAST(:ev AS jsonb), :by) "
        "ON CONFLICT (operator_id, asset_type_id, dimension) DO UPDATE SET "
        + ", ".join(f"{c} = EXCLUDED.{c}" for c in cols)
        + ", evidence = EXCLUDED.evidence, updated_at = now() RETURNING *"
    ), {**data, "oid": operator_id, "ev": evidence, "by": _actor(request)}).mappings().first()

    _activity(db, request, "OPERATOR_ASSESSED", operator_id,
              {"dimension": data["dimension"], "level": data.get("level")})
    db.commit()
    return dict(row)


# ── assignment ───────────────────────────────────────────────────────────────
@router.post("/{operator_id}/assignments")
def assign(operator_id: int, request: Request, body: dict = Body(...),
           db: Session = Depends(get_minehub_db)) -> dict:
    """Put an operator on a machine.

    Eligibility is checked and reported, not enforced: a shift supervisor who
    needs someone on a machine at two in the morning is not helped by a refusal,
    but the register should say plainly what was overridden and keep it.
    """
    _require(request, MANAGE, "assign operators")
    data = _clean(body, ("asset_id", "shift", "role", "valid_from", "valid_to", "remarks"))
    if not data.get("asset_id"):
        raise HTTPException(400, "Choose a machine.")

    check = eligibility(operator_id, data["asset_id"], db)

    db.execute(text(
        "UPDATE operator_assignment SET status = 'ENDED', valid_to = CURRENT_DATE "
        "WHERE operator_id = :o AND asset_id = :a AND status = 'ACTIVE'"
    ), {"o": operator_id, "a": data["asset_id"]})

    cols = list(data.keys())
    row = db.execute(text(
        f"INSERT INTO operator_assignment (operator_id, {', '.join(cols)}, assigned_by, created_by) "
        f"VALUES (:oid, {', '.join(':' + c for c in cols)}, :by, :by) RETURNING *"
    ), {**data, "oid": operator_id, "by": _actor(request)}).mappings().first()

    _activity(db, request, "OPERATOR_ASSIGNED", operator_id,
              {"asset_id": data["asset_id"], "eligibility": check["status"],
               "blockers": check["blockers"]})
    db.commit()
    return {**dict(row), "eligibility": check}


@router.get("/{operator_id}/eligibility/{asset_id}")
def eligibility(operator_id: int, asset_id: int,
                db: Session = Depends(get_minehub_db)) -> dict:
    """Can this person be put on this machine, and if not, what is missing.

    Derived from what is on file rather than from a stored flag, so it cannot go
    stale: a licence that lapsed overnight changes the answer without anyone
    running anything.
    """
    machine = db.execute(text(
        "SELECT a.asset_id, a.fleet_code, a.asset_type_id, t.name AS asset_type "
        "FROM asset a LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id "
        "WHERE a.asset_id = :id"
    ), {"id": asset_id}).mappings().first()
    if not machine:
        raise HTTPException(404, "Machine not found.")

    op = db.execute(text(
        "SELECT o.operator_id, o.profile_status, o.approval_status, p.display_name "
        "FROM operator o JOIN party p ON p.party_id = o.party_id WHERE o.operator_id = :id"
    ), {"id": operator_id}).mappings().first()
    if not op:
        raise HTTPException(404, "Operator not found.")

    blockers: list[str] = []
    warnings: list[str] = []

    if op["profile_status"] != "ACTIVE":
        blockers.append(f"Profile is {op['profile_status'].lower()}")
    if op["approval_status"] != "APPROVED":
        warnings.append("Profile has not been approved yet")

    docs = db.execute(text(
        "SELECT record_type, valid_upto, verification_status FROM operator_record "
        "WHERE operator_id = :id AND status = 'ACTIVE' AND record_type IN "
        "('LICENCE', 'MEDICAL', 'AUTHORISATION', 'CERTIFICATE')"
    ), {"id": operator_id}).mappings().all()

    for kind, label in (("LICENCE", "licence"), ("MEDICAL", "medical fitness")):
        held = [d for d in docs if d["record_type"] == kind]
        if not held:
            blockers.append(f"No {label} on file")
        elif all(d["valid_upto"] and d["valid_upto"] < date.today() for d in held):
            blockers.append(f"{label.capitalize()} has expired")
        elif all(d["verification_status"] != "VERIFIED" for d in held):
            warnings.append(f"{label.capitalize()} has not been verified")

    comp = db.execute(text(
        "SELECT level, valid_upto FROM operator_competency WHERE operator_id = :o "
        "AND asset_type_id = :t AND dimension = 'OVERALL' AND status = 'ACTIVE'"
    ), {"o": operator_id, "t": machine["asset_type_id"]}).mappings().first()

    if not comp or comp["level"] is None or comp["level"] == 0:
        blockers.append(f"Not assessed on {machine['asset_type'] or 'this class'}")
    elif comp["level"] == 1:
        warnings.append("Assessed at level 1 — assisted operation only")
    elif comp["valid_upto"] and comp["valid_upto"] < date.today():
        blockers.append("Competency assessment has lapsed")

    status = ("NOT_ELIGIBLE" if blockers
              else "ELIGIBLE_WITH_RESTRICTION" if warnings
              else "ELIGIBLE")
    return {"status": status, "blockers": blockers, "warnings": warnings,
            "operator": op["display_name"], "machine": machine["fleet_code"],
            "level": comp["level"] if comp else 0}


# ── identities ───────────────────────────────────────────────────────────────
@router.post("/{operator_id}/identities")
def add_identity(operator_id: int, request: Request, body: dict = Body(...),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """What another system calls this person."""
    _require(request, MANAGE, "edit operator profiles")
    code = (body.get("external_code") or "").strip()
    if not code:
        raise HTTPException(400, "Give the code that system uses.")
    system = (body.get("system") or "OTHER").upper()

    party_id = db.execute(text("SELECT party_id FROM operator WHERE operator_id = :id"),
                          {"id": operator_id}).scalar()
    if not party_id:
        raise HTTPException(404, "Operator not found.")

    clash = db.execute(text(
        "SELECT p.display_name FROM party_identity i JOIN party p ON p.party_id = i.party_id "
        "WHERE i.system = :s AND i.external_code = :c AND i.party_id <> :p"
    ), {"s": system, "c": code, "p": party_id}).scalar()
    if clash:
        raise HTTPException(409, f"{system} code {code} already belongs to {clash}.")

    row = db.execute(text(
        "INSERT INTO party_identity (party_id, system, external_code, created_by) "
        "VALUES (:p, :s, :c, :by) RETURNING party_identity_id, system, external_code"
    ), {"p": party_id, "s": system, "c": code, "by": _actor(request)}).mappings().first()
    _activity(db, request, "OPERATOR_IDENTITY_LINKED", operator_id, dict(row))
    db.commit()
    return dict(row)


@router.delete("/{operator_id}/identities/{identity_id}")
def remove_identity(operator_id: int, identity_id: int, request: Request,
                    db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, MANAGE, "edit operator profiles")
    db.execute(text("DELETE FROM party_identity WHERE party_identity_id = :i"), {"i": identity_id})
    _activity(db, request, "OPERATOR_IDENTITY_REMOVED", operator_id, {"identity_id": identity_id})
    db.commit()
    return {"ok": True}


@router.get("/meta/me")
def whoami(request: Request) -> dict:
    """What this user may do here, so the screen offers only what will work."""
    perms = _perms(request)
    return {"emp_id": _actor(request),
            "may_manage": MANAGE in perms,
            "may_assess": ASSESS in perms,
            "may_approve": APPROVE in perms}
