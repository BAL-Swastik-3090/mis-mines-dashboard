"""The organisation: departments, posts, and who holds them.

Reading is the point of this screen. Every other module on the platform is
about to need an accountable person — inventory most of all, where the whole
design rests on being able to say "this is held against your department" and
"this has gone to your head of department" — and none of them can ask that
question of a free-text name.

Two habits worth knowing before reading the handlers:

A PROPOSAL IS NOT A HOLDER. The SAP import proposes a head from grade
seniority. Until somebody with org.manage confirms it, the API reports the
post as vacant and carries the proposal separately, so a caller that wants
"who is accountable" cannot accidentally read a guess.

A CHANGE CLOSES, IT DOES NOT OVERWRITE. Replacing a holder dates the old row
out and inserts a new one. A material case raised eighteen months ago can then
still name the person who was accountable when it was raised.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import access as access_svc

router = APIRouter(prefix="/api/organisation", tags=["Organisation"])

VIEW = "org.view"
MANAGE = "org.manage"

POST_TYPES = ("SITE_HEAD", "FUNCTIONAL_HEAD", "DEPARTMENT_HEAD",
              "SECTION_INCHARGE", "MATERIAL_CUSTODIAN", "MEMBER")
DOMAINS = ("MATERIAL", "EQUIPMENT", "MANPOWER", "STATUTORY",
           "BUDGET", "PRODUCTION", "SAFETY", "DATA")
UNIT_TYPES = ("SITE", "DIVISION", "DEPARTMENT", "SECTION")


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _require(db: Session, request: Request, code: str) -> None:
    if not access_svc.has_permission(db, _actor(request), code):
        raise HTTPException(403, f"This needs the '{code}' permission.")


# ---------------------------------------------------------------------------
# The structure
# ---------------------------------------------------------------------------
@router.get("/units")
def units(request: Request,
          db: Session = Depends(get_db),
          pg: Session = Depends(get_minehub_db)) -> dict:
    """Every unit, with its headcount, its head and what it answers for.

    Flat, with parent_id, rather than nested: the client draws the tree, and a
    flat list is also what the filter dropdowns on every other screen want.
    Nesting it here would mean sending it twice.
    """
    _require(db, request, VIEW)

    rows = [dict(r) for r in pg.execute(text("""
        WITH headcount AS (
            SELECT org_unit_id, count(*) AS people
              FROM party_employment
             WHERE valid_to IS NULL AND org_unit_id IS NOT NULL
             GROUP BY org_unit_id
        ),
        head AS (
            SELECT p.org_unit_id,
                   p.post_id,
                   p.title AS post_title,
                   h.holding_id,
                   h.emp_id,
                   h.source,
                   h.confirmed_at,
                   h.derived_note,
                   pa.legal_name AS person
              FROM org_post p
              LEFT JOIN org_post_holding h
                     ON h.post_id = p.post_id AND h.valid_to IS NULL
                    AND h.basis = 'SUBSTANTIVE'
              LEFT JOIN party pa ON pa.party_id = h.party_id
             WHERE p.status = 'ACTIVE'
               AND p.post_type IN ('DEPARTMENT_HEAD', 'SITE_HEAD')
        )
        SELECT u.org_unit_id, u.code, u.name, u.parent_id, u.unit_type,
               u.status, u.purpose, u.sort_order,
               pl.code AS plant_code, pl.name AS plant_name,
               COALESCE(c.people, 0) AS people,
               hd.post_id, hd.post_title, hd.holding_id, hd.person AS head_name,
               hd.emp_id AS head_emp_id, hd.confirmed_at IS NOT NULL AS head_confirmed,
               hd.source AS head_source, hd.derived_note AS head_note,
               (SELECT count(*) FROM org_post p2
                 WHERE p2.org_unit_id = u.org_unit_id AND p2.status = 'ACTIVE') AS posts,
               (SELECT count(*) FROM org_accountability a
                 WHERE a.org_unit_id = u.org_unit_id AND a.status = 'ACTIVE') AS accountabilities,
               (SELECT string_agg(s.external_label, ' | ' ORDER BY s.external_label)
                  FROM org_unit_source s
                 WHERE s.org_unit_id = u.org_unit_id AND s.system = 'SAP_DEPT') AS sap_labels
          FROM org_unit u
          LEFT JOIN plant pl ON pl.plant_id = u.plant_id
          LEFT JOIN headcount c ON c.org_unit_id = u.org_unit_id
          LEFT JOIN head hd ON hd.org_unit_id = u.org_unit_id
         ORDER BY u.sort_order, u.name
    """)).mappings()]

    # A head that nobody has confirmed is reported as no head at all, with the
    # proposal kept beside it. The screen can then show "proposed" without any
    # caller mistaking it for the answer.
    for r in rows:
        if r["head_name"] and not r["head_confirmed"]:
            r["proposed_head"] = {"name": r["head_name"], "emp_id": r["head_emp_id"],
                                  "note": r["head_note"], "holding_id": r["holding_id"]}
            r["head_name"] = None
            r["head_emp_id"] = None
        else:
            r["proposed_head"] = None

    return {
        "units": rows,
        "summary": {
            "units": len(rows),
            "people": sum(r["people"] for r in rows),
            "with_head": sum(1 for r in rows if r["head_name"]),
            "proposed": sum(1 for r in rows if r["proposed_head"]),
            "vacant": sum(1 for r in rows
                          if r["unit_type"] != "SITE" and not r["head_name"]
                          and not r["proposed_head"]),
        },
    }


@router.get("/units/{unit_id}")
def unit(unit_id: int, request: Request,
         db: Session = Depends(get_db),
         pg: Session = Depends(get_minehub_db)) -> dict:
    """One unit in full: its posts, its people, what it answers for."""
    _require(db, request, VIEW)

    row = pg.execute(text("""
        SELECT u.org_unit_id, u.code, u.name, u.parent_id, u.unit_type, u.status,
               u.purpose, pl.code AS plant_code, pl.name AS plant_name,
               parent.name AS parent_name
          FROM org_unit u
          LEFT JOIN plant pl ON pl.plant_id = u.plant_id
          LEFT JOIN org_unit parent ON parent.org_unit_id = u.parent_id
         WHERE u.org_unit_id = :id
    """), {"id": unit_id}).mappings().first()
    if not row:
        raise HTTPException(404, "No such unit.")

    posts = [dict(r) for r in pg.execute(text("""
        SELECT p.post_id, p.title, p.post_type, p.status, p.remarks,
               p.reports_to_post_id, rp.title AS reports_to_title,
               ru.name AS reports_to_unit,
               h.holding_id, h.emp_id, h.basis, h.valid_from, h.source,
               h.derived_note, h.confirmed_by, h.confirmed_at,
               pa.party_id, pa.legal_name AS person, pa.email, pa.phone,
               (SELECT e.designation FROM party_employment e
                 WHERE e.party_id = pa.party_id AND e.valid_to IS NULL
                 ORDER BY e.valid_from DESC LIMIT 1) AS designation
          FROM org_post p
          LEFT JOIN org_post rp ON rp.post_id = p.reports_to_post_id
          LEFT JOIN org_unit ru ON ru.org_unit_id = rp.org_unit_id
          LEFT JOIN org_post_holding h
                 ON h.post_id = p.post_id AND h.valid_to IS NULL
          LEFT JOIN party pa ON pa.party_id = h.party_id
         WHERE p.org_unit_id = :id
         ORDER BY CASE p.post_type
                    WHEN 'SITE_HEAD' THEN 1 WHEN 'FUNCTIONAL_HEAD' THEN 2
                    WHEN 'DEPARTMENT_HEAD' THEN 3 WHEN 'SECTION_INCHARGE' THEN 4
                    WHEN 'MATERIAL_CUSTODIAN' THEN 5 ELSE 6 END,
                  p.title, h.basis
    """), {"id": unit_id}).mappings()]

    people = [dict(r) for r in pg.execute(text("""
        SELECT pa.party_id, pa.legal_name AS name, e.designation, e.employment_type,
               e.valid_from AS since,
               (SELECT i.external_code FROM party_identity i
                 WHERE i.party_id = pa.party_id AND i.system = 'SAP'
                 ORDER BY i.is_primary DESC LIMIT 1) AS emp_id,
               emp.legal_name AS employer
          FROM party_employment e
          JOIN party pa ON pa.party_id = e.party_id
          JOIN party emp ON emp.party_id = e.employer_party_id
         WHERE e.org_unit_id = :id AND e.valid_to IS NULL
         ORDER BY pa.legal_name
    """), {"id": unit_id}).mappings()]

    accountability = [dict(r) for r in pg.execute(text("""
        SELECT a.accountability_id, a.domain, a.scope_system, a.scope_ref,
               a.description, a.status, a.post_id, p.title AS post_title
          FROM org_accountability a
          LEFT JOIN org_post p ON p.post_id = a.post_id
         WHERE a.org_unit_id = :id
         ORDER BY a.domain
    """), {"id": unit_id}).mappings()]

    history = [dict(r) for r in pg.execute(text("""
        SELECT h.holding_id, h.post_id, p.title AS post_title, pa.legal_name AS person,
               h.emp_id, h.basis, h.valid_from, h.valid_to, h.source,
               h.confirmed_by, h.confirmed_at, h.remarks
          FROM org_post_holding h
          JOIN org_post p ON p.post_id = h.post_id
          JOIN party pa ON pa.party_id = h.party_id
         WHERE p.org_unit_id = :id AND h.valid_to IS NOT NULL
         ORDER BY h.valid_to DESC, h.valid_from DESC
         LIMIT 50
    """), {"id": unit_id}).mappings()]

    labels = [dict(r) for r in pg.execute(text("""
        SELECT org_unit_source_id, system, external_label, note
          FROM org_unit_source WHERE org_unit_id = :id
         ORDER BY system, external_label
    """), {"id": unit_id}).mappings()]

    return {"unit": dict(row), "posts": posts, "people": people,
            "accountability": accountability, "history": history, "labels": labels}


@router.get("/gaps")
def gaps(request: Request,
         db: Session = Depends(get_db),
         pg: Session = Depends(get_minehub_db)) -> dict:
    """What is not written down yet.

    Deliberately the whole list rather than a count. A screen that says "12
    departments have no head" and does not say which twelve gives nobody
    anything to do.
    """
    _require(db, request, VIEW)

    no_head = [dict(r) for r in pg.execute(text("""
        SELECT u.org_unit_id, u.name, u.unit_type,
               (SELECT count(*) FROM party_employment e
                 WHERE e.org_unit_id = u.org_unit_id AND e.valid_to IS NULL) AS people
          FROM org_unit u
         WHERE u.status = 'ACTIVE'
           AND NOT EXISTS (
                SELECT 1 FROM org_post p
                  JOIN org_post_holding h ON h.post_id = p.post_id
                 WHERE p.org_unit_id = u.org_unit_id AND p.status = 'ACTIVE'
                   AND p.post_type IN ('DEPARTMENT_HEAD', 'SITE_HEAD')
                   AND h.valid_to IS NULL AND h.confirmed_at IS NOT NULL)
         ORDER BY people DESC, u.name
    """)).mappings()]

    unconfirmed = [dict(r) for r in pg.execute(text("""
        SELECT h.holding_id, u.org_unit_id, u.name AS unit, p.title AS post,
               pa.legal_name AS person, h.emp_id, h.derived_note
          FROM org_post_holding h
          JOIN org_post p ON p.post_id = h.post_id
          JOIN org_unit u ON u.org_unit_id = p.org_unit_id
          JOIN party pa ON pa.party_id = h.party_id
         WHERE h.valid_to IS NULL AND h.confirmed_at IS NULL
         ORDER BY u.name
    """)).mappings()]

    no_material_owner = [dict(r) for r in pg.execute(text("""
        SELECT u.org_unit_id, u.name,
               (SELECT count(*) FROM party_employment e
                 WHERE e.org_unit_id = u.org_unit_id AND e.valid_to IS NULL) AS people
          FROM org_unit u
         WHERE u.status = 'ACTIVE' AND u.unit_type = 'DEPARTMENT'
           AND NOT EXISTS (SELECT 1 FROM org_accountability a
                            WHERE a.org_unit_id = u.org_unit_id
                              AND a.domain = 'MATERIAL' AND a.status = 'ACTIVE')
         ORDER BY people DESC, u.name
    """)).mappings()]

    unscoped_material = [dict(r) for r in pg.execute(text("""
        SELECT a.accountability_id, u.org_unit_id, u.name AS unit, a.description
          FROM org_accountability a
          JOIN org_unit u ON u.org_unit_id = a.org_unit_id
         WHERE a.domain = 'MATERIAL' AND a.status = 'ACTIVE'
           AND (a.scope_system IS NULL OR a.scope_ref IS NULL OR a.scope_ref = '')
         ORDER BY u.name
    """)).mappings()]

    unmapped = [dict(r) for r in pg.execute(text("""
        SELECT u.org_unit_id, u.name
          FROM org_unit u
         WHERE u.status = 'ACTIVE' AND u.unit_type IN ('DEPARTMENT', 'SECTION')
           AND NOT EXISTS (SELECT 1 FROM org_unit_source s
                            WHERE s.org_unit_id = u.org_unit_id AND s.system = 'SAP_DEPT')
         ORDER BY u.name
    """)).mappings()]

    return {"no_head": no_head, "unconfirmed": unconfirmed,
            "no_material_owner": no_material_owner,
            "unscoped_material": unscoped_material,
            "unmapped_to_sap": unmapped}


@router.get("/people")
def people(request: Request,
           q: str = Query("", max_length=80),
           unit_id: int | None = Query(None),
           limit: int = Query(40, ge=1, le=200),
           db: Session = Depends(get_db),
           pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """Search for a person to put in a post. Employees first, by name or EMPID."""
    _require(db, request, VIEW)

    return [dict(r) for r in pg.execute(text("""
        SELECT pa.party_id, pa.legal_name AS name,
               i.external_code AS emp_id,
               e.designation, u.org_unit_id, u.name AS unit
          FROM party pa
          LEFT JOIN party_identity i ON i.party_id = pa.party_id AND i.system = 'SAP'
          LEFT JOIN party_employment e ON e.party_id = pa.party_id AND e.valid_to IS NULL
          LEFT JOIN org_unit u ON u.org_unit_id = e.org_unit_id
         WHERE pa.party_type = 'PERSON' AND pa.status = 'ACTIVE'
           AND (:q = '' OR pa.legal_name ILIKE '%' || :q || '%'
                        OR i.external_code ILIKE :q || '%')
           -- Cast, or Postgres cannot work out what type a bare NULL is being
           -- compared against and refuses the whole statement.
           AND (CAST(:unit AS bigint) IS NULL OR e.org_unit_id = CAST(:unit AS bigint))
         ORDER BY (i.external_code IS NULL), pa.legal_name
         LIMIT :lim
    """), {"q": q.strip(), "unit": unit_id, "lim": limit}).mappings()]


# ---------------------------------------------------------------------------
# Changing it
# ---------------------------------------------------------------------------
@router.post("/units")
def create_unit(request: Request, body: dict = Body(...),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, MANAGE)

    name = (body.get("name") or "").strip()
    code = (body.get("code") or "").strip().upper().replace(" ", "_")
    unit_type = (body.get("unit_type") or "DEPARTMENT").upper()
    if not name:
        raise HTTPException(400, "A unit needs a name.")
    if unit_type not in UNIT_TYPES:
        raise HTTPException(400, f"unit_type must be one of {', '.join(UNIT_TYPES)}.")
    if not code:
        code = "".join(ch if ch.isalnum() else "_" for ch in name.upper())[:40].strip("_")

    exists = pg.execute(text("SELECT name FROM org_unit WHERE code = :c"),
                        {"c": code}).scalar()
    if exists:
        raise HTTPException(409, f"'{code}' is already used by {exists}.")

    row = pg.execute(text("""
        INSERT INTO org_unit (code, name, parent_id, unit_type, plant_id, purpose,
                              sort_order, created_by)
        VALUES (:c, :n, :p, :t, :pl, NULLIF(:pu, ''), COALESCE(:so, 100), :by)
        RETURNING org_unit_id
    """), {"c": code, "n": name, "p": body.get("parent_id"), "t": unit_type,
           "pl": body.get("plant_id"), "pu": (body.get("purpose") or "").strip(),
           "so": body.get("sort_order"), "by": _actor(request)}).scalar()
    pg.commit()
    return {"org_unit_id": row, "code": code}


@router.patch("/units/{unit_id}")
def update_unit(unit_id: int, request: Request, body: dict = Body(...),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    """Rename, re-parent, restate the purpose. The code is not editable —
    other tables and other systems quote it."""
    _require(db, request, MANAGE)

    if body.get("parent_id") == unit_id:
        raise HTTPException(400, "A unit cannot report to itself.")
    # A cycle would make the tree undrawable and the escalation chain infinite.
    if body.get("parent_id"):
        cyclic = pg.execute(text("""
            WITH RECURSIVE up AS (
                SELECT org_unit_id, parent_id FROM org_unit WHERE org_unit_id = :new
                UNION ALL
                SELECT u.org_unit_id, u.parent_id FROM org_unit u JOIN up ON u.org_unit_id = up.parent_id
            ) SELECT 1 FROM up WHERE org_unit_id = :me
        """), {"new": body["parent_id"], "me": unit_id}).first()
        if cyclic:
            raise HTTPException(400, "That would make the unit report to itself, "
                                     "through one of the units under it.")

    unit_type = (body.get("unit_type") or "").upper() or None
    if unit_type and unit_type not in UNIT_TYPES:
        raise HTTPException(400, f"unit_type must be one of {', '.join(UNIT_TYPES)}.")

    pg.execute(text("""
        UPDATE org_unit
           SET name      = COALESCE(NULLIF(:n, ''), name),
               parent_id = CASE WHEN :set_parent THEN :p ELSE parent_id END,
               unit_type = COALESCE(:t, unit_type),
               plant_id  = CASE WHEN :set_plant THEN :pl ELSE plant_id END,
               purpose   = CASE WHEN :set_purpose THEN NULLIF(:pu, '') ELSE purpose END,
               sort_order = COALESCE(:so, sort_order),
               status    = COALESCE(NULLIF(:st, ''), status),
               updated_at = now()
         WHERE org_unit_id = :id
    """), {"id": unit_id, "n": (body.get("name") or "").strip(),
           "set_parent": "parent_id" in body, "p": body.get("parent_id"),
           "t": unit_type, "set_plant": "plant_id" in body, "pl": body.get("plant_id"),
           "set_purpose": "purpose" in body, "pu": (body.get("purpose") or "").strip(),
           "so": body.get("sort_order"), "st": (body.get("status") or "").strip().upper()})
    pg.commit()
    return {"ok": True}


@router.post("/units/{unit_id}/labels")
def add_label(unit_id: int, request: Request, body: dict = Body(...),
              db: Session = Depends(get_db),
              pg: Session = Depends(get_minehub_db)) -> dict:
    """Tell the platform that an outside system calls this unit something else."""
    _require(db, request, MANAGE)

    system = (body.get("system") or "SAP_DEPT").upper()
    label = (body.get("external_label") or "").strip()
    if not label:
        raise HTTPException(400, "A label is needed.")

    taken = pg.execute(text("""SELECT u.name FROM org_unit_source s
                                 JOIN org_unit u ON u.org_unit_id = s.org_unit_id
                                WHERE s.system = :s AND s.external_label = :l"""),
                       {"s": system, "l": label}).scalar()
    if taken:
        raise HTTPException(409, f"'{label}' already points at {taken}.")

    pg.execute(text("""INSERT INTO org_unit_source (org_unit_id, system, external_label,
                                                    note, created_by)
                       VALUES (:u, :s, :l, NULLIF(:n, ''), :by)"""),
               {"u": unit_id, "s": system, "l": label,
                "n": (body.get("note") or "").strip(), "by": _actor(request)})
    pg.commit()
    return {"ok": True}


@router.delete("/labels/{label_id}")
def drop_label(label_id: int, request: Request,
               db: Session = Depends(get_db),
               pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, MANAGE)
    pg.execute(text("DELETE FROM org_unit_source WHERE org_unit_source_id = :id"),
               {"id": label_id})
    pg.commit()
    return {"ok": True}


@router.post("/posts")
def create_post(request: Request, body: dict = Body(...),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, MANAGE)

    unit_id = body.get("org_unit_id")
    post_type = (body.get("post_type") or "MEMBER").upper()
    title = (body.get("title") or "").strip()
    if not unit_id:
        raise HTTPException(400, "A post belongs to a unit.")
    if post_type not in POST_TYPES:
        raise HTTPException(400, f"post_type must be one of {', '.join(POST_TYPES)}.")
    if not title:
        raise HTTPException(400, "A post needs a title.")

    # The unique indexes would refuse this anyway; saying so in words is kinder
    # than a constraint name.
    if post_type in ("DEPARTMENT_HEAD", "MATERIAL_CUSTODIAN"):
        clash = pg.execute(text("""SELECT title FROM org_post
                                    WHERE org_unit_id = :u AND post_type = :t
                                      AND status = 'ACTIVE'"""),
                           {"u": unit_id, "t": post_type}).scalar()
        if clash:
            raise HTTPException(409, f"This unit already has one: {clash}. "
                                     "Change who holds it rather than adding a second.")

    post_id = pg.execute(text("""
        INSERT INTO org_post (org_unit_id, title, post_type, reports_to_post_id,
                              remarks, created_by)
        VALUES (:u, :t, :ty, :r, NULLIF(:rm, ''), :by)
        RETURNING post_id
    """), {"u": unit_id, "t": title, "ty": post_type,
           "r": body.get("reports_to_post_id"),
           "rm": (body.get("remarks") or "").strip(), "by": _actor(request)}).scalar()
    pg.commit()
    return {"post_id": post_id}


@router.patch("/posts/{post_id}")
def update_post(post_id: int, request: Request, body: dict = Body(...),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, MANAGE)

    if body.get("reports_to_post_id") == post_id:
        raise HTTPException(400, "A post cannot report to itself.")

    pg.execute(text("""
        UPDATE org_post
           SET title = COALESCE(NULLIF(:t, ''), title),
               reports_to_post_id = CASE WHEN :set_rep THEN :r ELSE reports_to_post_id END,
               remarks = CASE WHEN :set_rm THEN NULLIF(:rm, '') ELSE remarks END,
               status = COALESCE(NULLIF(:st, ''), status)
         WHERE post_id = :id
    """), {"id": post_id, "t": (body.get("title") or "").strip(),
           "set_rep": "reports_to_post_id" in body, "r": body.get("reports_to_post_id"),
           "set_rm": "remarks" in body, "rm": (body.get("remarks") or "").strip(),
           "st": (body.get("status") or "").strip().upper()})
    pg.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/holder")
def set_holder(post_id: int, request: Request, body: dict = Body(...),
               db: Session = Depends(get_db),
               pg: Session = Depends(get_minehub_db)) -> dict:
    """Put somebody in a post.

    The person who was there is dated out on the day the new one starts, not
    deleted. Acting and additional charge sit alongside the substantive holder
    rather than displacing them, which is what those words mean on site.
    """
    _require(db, request, MANAGE)

    party_id = body.get("party_id")
    if not party_id:
        raise HTTPException(400, "Choose a person.")
    basis = (body.get("basis") or "SUBSTANTIVE").upper()
    if basis not in ("SUBSTANTIVE", "ACTING", "ADDITIONAL"):
        raise HTTPException(400, "basis must be SUBSTANTIVE, ACTING or ADDITIONAL.")
    start = body.get("valid_from") or date.today().isoformat()
    actor = _actor(request)

    emp_id = pg.execute(text("""SELECT external_code FROM party_identity
                                 WHERE party_id = :p AND system = 'SAP'
                                 ORDER BY is_primary DESC LIMIT 1"""),
                        {"p": party_id}).scalar()

    if basis == "SUBSTANTIVE":
        # Close whoever is there — including an unconfirmed proposal, which is
        # exactly what "somebody has now decided" should do to a guess.
        pg.execute(text("""
            UPDATE org_post_holding
               SET valid_to = GREATEST(valid_from, CAST(:start AS date) - 1)
             WHERE post_id = :id AND valid_to IS NULL AND basis = 'SUBSTANTIVE'
        """), {"id": post_id, "start": start})

    holding_id = pg.execute(text("""
        INSERT INTO org_post_holding (post_id, party_id, emp_id, basis, valid_from,
                                      source, confirmed_by, confirmed_at, remarks, created_by)
        VALUES (:id, :p, :e, :b, CAST(:start AS date), 'DECLARED', :by, now(),
                NULLIF(:rm, ''), :by)
        RETURNING holding_id
    """), {"id": post_id, "p": party_id, "e": emp_id, "b": basis, "start": start,
           "by": actor, "rm": (body.get("remarks") or "").strip()}).scalar()
    pg.commit()
    return {"holding_id": holding_id}


@router.post("/holdings/{holding_id}/confirm")
def confirm_holding(holding_id: int, request: Request,
                    db: Session = Depends(get_db),
                    pg: Session = Depends(get_minehub_db)) -> dict:
    """Agree with a proposal the import made. Until this, it is a suggestion."""
    _require(db, request, MANAGE)

    row = pg.execute(text("SELECT confirmed_at FROM org_post_holding WHERE holding_id = :id"),
                     {"id": holding_id}).mappings().first()
    if not row:
        raise HTTPException(404, "No such holding.")
    if row["confirmed_at"]:
        return {"ok": True, "already": True}

    pg.execute(text("""UPDATE org_post_holding
                          SET source = 'DECLARED', confirmed_by = :by, confirmed_at = now()
                        WHERE holding_id = :id"""),
               {"id": holding_id, "by": _actor(request)})
    pg.commit()
    return {"ok": True}


@router.delete("/holdings/{holding_id}")
def end_holding(holding_id: int, request: Request,
                on: str | None = Query(None, description="Last day held. Today if omitted."),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    """End a holding. The row stays — a post with nobody in it is a fact worth
    keeping, and so is who was in it before."""
    _require(db, request, MANAGE)

    pg.execute(text("""UPDATE org_post_holding
                          SET valid_to = GREATEST(valid_from, COALESCE(CAST(:on AS date), CURRENT_DATE))
                        WHERE holding_id = :id AND valid_to IS NULL"""),
               {"id": holding_id, "on": on})
    pg.commit()
    return {"ok": True}


@router.post("/accountability")
def add_accountability(request: Request, body: dict = Body(...),
                       db: Session = Depends(get_db),
                       pg: Session = Depends(get_minehub_db)) -> dict:
    """Record what a unit answers for, and where the source system keeps it."""
    _require(db, request, MANAGE)

    domain = (body.get("domain") or "").upper()
    if domain not in DOMAINS:
        raise HTTPException(400, f"domain must be one of {', '.join(DOMAINS)}.")
    if not body.get("org_unit_id"):
        raise HTTPException(400, "An accountability belongs to a unit.")

    new_id = pg.execute(text("""
        INSERT INTO org_accountability (org_unit_id, domain, post_id, scope_system,
                                        scope_ref, description, created_by)
        VALUES (:u, :d, :p, NULLIF(:ss, ''), NULLIF(:sr, ''), NULLIF(:de, ''), :by)
        RETURNING accountability_id
    """), {"u": body["org_unit_id"], "d": domain, "p": body.get("post_id"),
           "ss": (body.get("scope_system") or "").strip().upper(),
           "sr": (body.get("scope_ref") or "").strip(),
           "de": (body.get("description") or "").strip(), "by": _actor(request)}).scalar()
    pg.commit()
    return {"accountability_id": new_id}


@router.patch("/accountability/{acc_id}")
def update_accountability(acc_id: int, request: Request, body: dict = Body(...),
                          db: Session = Depends(get_db),
                          pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, MANAGE)
    pg.execute(text("""
        UPDATE org_accountability
           SET scope_system = CASE WHEN :set_ss THEN NULLIF(:ss, '') ELSE scope_system END,
               scope_ref    = CASE WHEN :set_sr THEN NULLIF(:sr, '') ELSE scope_ref END,
               description  = CASE WHEN :set_de THEN NULLIF(:de, '') ELSE description END,
               post_id      = CASE WHEN :set_po THEN :po ELSE post_id END,
               status       = COALESCE(NULLIF(:st, ''), status)
         WHERE accountability_id = :id
    """), {"id": acc_id,
           "set_ss": "scope_system" in body, "ss": (body.get("scope_system") or "").strip().upper(),
           "set_sr": "scope_ref" in body, "sr": (body.get("scope_ref") or "").strip(),
           "set_de": "description" in body, "de": (body.get("description") or "").strip(),
           "set_po": "post_id" in body, "po": body.get("post_id"),
           "st": (body.get("status") or "").strip().upper()})
    pg.commit()
    return {"ok": True}


@router.get("/me")
def me(request: Request,
       db: Session = Depends(get_db),
       pg: Session = Depends(get_minehub_db)) -> dict:
    """Where the signed-in person sits, and what they are accountable for.

    This is the call the inventory portal will make on every page: it needs to
    know whose department's material to show, and whether this person is the
    one an escalation stops at.
    """
    emp_id = _actor(request)

    where = pg.execute(text("""
        SELECT u.org_unit_id, u.name AS unit, u.code, e.designation
          FROM party_identity i
          JOIN party_employment e ON e.party_id = i.party_id AND e.valid_to IS NULL
          JOIN org_unit u ON u.org_unit_id = e.org_unit_id
         WHERE i.system = 'SAP' AND i.external_code = :emp
         ORDER BY e.valid_from DESC LIMIT 1
    """), {"emp": emp_id}).mappings().first()

    holds = [dict(r) for r in pg.execute(text("""
        SELECT p.post_id, p.title, p.post_type, u.org_unit_id, u.name AS unit,
               h.basis, h.valid_from, h.confirmed_at IS NOT NULL AS confirmed
          FROM org_post_holding h
          JOIN org_post p ON p.post_id = h.post_id
          JOIN org_unit u ON u.org_unit_id = p.org_unit_id
         WHERE h.emp_id = :emp AND h.valid_to IS NULL
         ORDER BY p.post_type, u.name
    """), {"emp": emp_id}).mappings()]

    return {
        "emp_id": emp_id,
        "unit": dict(where) if where else None,
        "posts": holds,
        "is_department_head": any(h["post_type"] in ("DEPARTMENT_HEAD", "SITE_HEAD")
                                  and h["confirmed"] for h in holds),
    }
