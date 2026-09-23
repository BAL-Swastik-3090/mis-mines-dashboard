"""Fields the mine defines for itself.

Every time this platform needed somewhere to put a new fact — a PAN, a pay
grade, a nominee — the answer was a migration and a deployment. This is the
general answer instead: name a field, pick its type, say which screen it
belongs on, and it appears.

TWO RIGHTS, DELIBERATELY SEPARATE

Adding a field changes what every record of that kind can hold and what every
user is asked for; that needs platform.fields.manage. Filling one in is
ordinary work and needs only whatever right already governs the record — an
operator's fields are writable by whoever may edit operators.

A FIELD IS RETIRED, NEVER DELETED

Deleting a definition would take its values with it, and a column of answers
that disappears is worse than one marked closed. Retiring stops it being
offered and leaves what people already wrote.
"""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import access as access_svc

router = APIRouter(prefix="/api/fields", tags=["Fields"])

MANAGE = "platform.fields.manage"

TYPES = ("TEXT", "LONG_TEXT", "NUMBER", "DATE", "BOOLEAN",
         "SELECT", "MULTI_SELECT", "PHONE", "EMAIL")

# The registers a field may be attached to. A short list on purpose: an entity
# name that is a typo would create a field nobody ever sees, on a screen that
# does not exist, and it would look exactly like a working one.
ENTITIES = ("OPERATOR", "ASSET", "PARTY", "GATE_PASS", "TRIP", "ORG_UNIT")


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _require(db: Session, request: Request, code: str) -> None:
    if not access_svc.has_permission(db, _actor(request), code):
        raise HTTPException(403, f"This needs the '{code}' permission.")


def _slug(label: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return out[:48] or "field"


@router.get("/definitions")
def definitions(request: Request,
                entity: str = Query(..., description="OPERATOR, ASSET, …"),
                include_retired: bool = Query(False),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    """Every field on a register, grouped the way the screen draws them."""
    entity = entity.strip().upper()
    rows = [dict(r) for r in pg.execute(text("""
        SELECT field_definition_id, entity, code, label, data_type, options,
               section, hint, placeholder, is_required, is_sensitive,
               sort_order, status,
               (SELECT count(*) FROM field_value v
                 WHERE v.field_definition_id = d.field_definition_id
                   AND v.value IS NOT NULL) AS answered
          FROM field_definition d
         WHERE entity = :e AND (:all OR status = 'ACTIVE')
         ORDER BY section, sort_order, label
    """), {"e": entity, "all": include_retired}).mappings()]

    sections: dict[str, list] = {}
    for r in rows:
        sections.setdefault(r["section"], []).append(r)
    return {
        "entity": entity,
        "fields": rows,
        "sections": [{"name": k, "fields": v} for k, v in sections.items()],
        "types": list(TYPES),
        "entities": list(ENTITIES),
    }


@router.get("/values")
def values(request: Request,
           entity: str = Query(...),
           entity_id: int = Query(...),
           db: Session = Depends(get_db),
           pg: Session = Depends(get_minehub_db)) -> dict:
    """What one record holds, keyed by field code so a screen can look it up."""
    rows = pg.execute(text("""
        SELECT d.code, d.data_type, v.value, v.updated_at, v.updated_by
          FROM field_definition d
          LEFT JOIN field_value v
                 ON v.field_definition_id = d.field_definition_id
                AND v.entity_id = :id
         WHERE d.entity = :e AND d.status = 'ACTIVE'
    """), {"e": entity.strip().upper(), "id": entity_id}).mappings()
    return {"values": {r["code"]: r["value"] for r in rows if r["value"] is not None}}


@router.put("/values")
def set_values(request: Request, body: dict = Body(...),
               db: Session = Depends(get_db),
               pg: Session = Depends(get_minehub_db)) -> dict:
    """Fill fields in on one record.

    Whatever the record's own permission is, not the field-management right: adding a
    field is a decision, answering one is the job. A value the field's type
    does not accept is refused by the database, so a dropdown cannot quietly
    acquire an answer that is not one of its choices.
    """
    entity = (body.get("entity") or "").strip().upper()
    entity_id = body.get("entity_id")
    given = body.get("values") or {}
    if entity not in ENTITIES or not entity_id:
        raise HTTPException(400, "Which record?")
    if not isinstance(given, dict):
        raise HTTPException(400, "values must be an object keyed by field code.")

    defs = {r["code"]: r for r in pg.execute(text("""
        SELECT field_definition_id, code, data_type, is_required, label
          FROM field_definition
         WHERE entity = :e AND status = 'ACTIVE'
    """), {"e": entity}).mappings()}

    unknown = set(given) - set(defs)
    if unknown:
        raise HTTPException(400, f"No such field on {entity}: {', '.join(sorted(unknown))}")

    actor, written = _actor(request), 0
    for code, raw in given.items():
        d = defs[code]
        blank = raw is None or (isinstance(raw, str) and not raw.strip()) \
            or (isinstance(raw, list) and not raw)
        if blank:
            # Clearing is a real action — it means "not applicable" — and is
            # stored as an absent value rather than an empty string.
            pg.execute(text("""
                DELETE FROM field_value
                 WHERE field_definition_id = :f AND entity_id = :i
            """), {"f": d["field_definition_id"], "i": entity_id})
            written += 1
            continue

        if d["data_type"] == "NUMBER":
            try:
                raw = float(raw)
            except (TypeError, ValueError):
                raise HTTPException(400, f"{d['label']} expects a number.")
        elif d["data_type"] == "BOOLEAN":
            raw = bool(raw)

        pg.execute(text("""
            INSERT INTO field_value (field_definition_id, entity_id, value, updated_by)
            VALUES (:f, :i, CAST(:v AS jsonb), :by)
            ON CONFLICT (field_definition_id, entity_id)
            DO UPDATE SET value = EXCLUDED.value,
                          updated_by = EXCLUDED.updated_by,
                          updated_at = now()
        """), {"f": d["field_definition_id"], "i": entity_id,
               "v": json.dumps(raw), "by": actor})
        written += 1

    pg.commit()
    return {"ok": True, "written": written}


@router.post("/definitions")
def add_field(request: Request, body: dict = Body(...),
              db: Session = Depends(get_db),
              pg: Session = Depends(get_minehub_db)) -> dict:
    """Add a field to a register."""
    _require(db, request, MANAGE)

    entity = (body.get("entity") or "").strip().upper()
    label = (body.get("label") or "").strip()
    data_type = (body.get("data_type") or "TEXT").strip().upper()
    options = body.get("options")

    if entity not in ENTITIES:
        raise HTTPException(400, f"entity must be one of {', '.join(ENTITIES)}.")
    if not label:
        raise HTTPException(400, "A field needs a label — what the user will see.")
    if data_type not in TYPES:
        raise HTTPException(400, f"data_type must be one of {', '.join(TYPES)}.")
    if data_type in ("SELECT", "MULTI_SELECT"):
        options = [str(o).strip() for o in (options or []) if str(o).strip()]
        if len(options) < 2:
            raise HTTPException(400,
                "A dropdown needs at least two choices. With one it is not a "
                "choice, and with none it is a text box pretending otherwise.")
    else:
        options = None

    code = (body.get("code") or _slug(label)).lower()
    clash = pg.execute(text("""
        SELECT label, status FROM field_definition WHERE entity = :e AND code = :c
    """), {"e": entity, "c": code}).mappings().first()
    if clash:
        raise HTTPException(409,
            f"'{code}' is already used by '{clash['label']}'"
            + (" — it is retired; bring it back rather than making a second one."
               if clash["status"] != "ACTIVE" else "."))

    new_id = pg.execute(text("""
        INSERT INTO field_definition
               (entity, code, label, data_type, options, section, hint,
                placeholder, is_required, is_sensitive, sort_order, created_by)
        VALUES (:e, :c, :l, :t, CAST(:o AS jsonb),
                COALESCE(NULLIF(:sec, ''), 'More details'),
                NULLIF(:hint, ''), NULLIF(:ph, ''),
                COALESCE(:req, FALSE), COALESCE(:sens, FALSE),
                COALESCE(:ord, 100), :by)
        RETURNING field_definition_id
    """), {"e": entity, "c": code, "l": label, "t": data_type,
           "o": json.dumps(options) if options else None,
           "sec": (body.get("section") or "").strip(),
           "hint": (body.get("hint") or "").strip(),
           "ph": (body.get("placeholder") or "").strip(),
           "req": body.get("is_required"), "sens": body.get("is_sensitive"),
           "ord": body.get("sort_order"), "by": _actor(request)}).scalar()
    pg.commit()
    return {"field_definition_id": new_id, "code": code}


@router.patch("/definitions/{field_id}")
def edit_field(field_id: int, request: Request, body: dict = Body(...),
               db: Session = Depends(get_db),
               pg: Session = Depends(get_minehub_db)) -> dict:
    """Rename, reorder, retire or bring back a field.

    The code and the type are not editable. A code is what stored answers point
    at; a type is what they already are. Changing either would leave every
    existing answer meaning something it does not — retire it and make a new
    one instead, which keeps the old answers readable.
    """
    _require(db, request, MANAGE)

    status = (body.get("status") or "").strip().upper()
    if status and status not in ("ACTIVE", "INACTIVE"):
        raise HTTPException(400, "status must be ACTIVE or INACTIVE.")

    cur = pg.execute(text("""
        SELECT data_type FROM field_definition WHERE field_definition_id = :id
    """), {"id": field_id}).mappings().first()
    if not cur:
        raise HTTPException(404, "No such field.")

    options = body.get("options")
    if options is not None:
        if cur["data_type"] not in ("SELECT", "MULTI_SELECT"):
            raise HTTPException(400, "Only a dropdown has choices.")
        options = [str(o).strip() for o in options if str(o).strip()]
        if len(options) < 2:
            raise HTTPException(400, "A dropdown needs at least two choices.")

    pg.execute(text("""
        UPDATE field_definition SET
            label       = COALESCE(NULLIF(:l, ''), label),
            section     = COALESCE(NULLIF(:sec, ''), section),
            hint        = CASE WHEN :set_hint THEN NULLIF(:hint, '') ELSE hint END,
            placeholder = CASE WHEN :set_ph THEN NULLIF(:ph, '') ELSE placeholder END,
            options     = COALESCE(CAST(:o AS jsonb), options),
            is_required = COALESCE(:req, is_required),
            is_sensitive= COALESCE(:sens, is_sensitive),
            sort_order  = COALESCE(:ord, sort_order),
            status      = COALESCE(NULLIF(:st, ''), status)
         WHERE field_definition_id = :id
    """), {"id": field_id, "l": (body.get("label") or "").strip(),
           "sec": (body.get("section") or "").strip(),
           "set_hint": "hint" in body, "hint": (body.get("hint") or "").strip(),
           "set_ph": "placeholder" in body, "ph": (body.get("placeholder") or "").strip(),
           "o": json.dumps(options) if options else None,
           "req": body.get("is_required"), "sens": body.get("is_sensitive"),
           "ord": body.get("sort_order"), "st": status})
    pg.commit()
    return {"ok": True}
