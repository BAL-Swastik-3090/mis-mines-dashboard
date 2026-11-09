"""HOTO — what a device syncs down before it goes down the pit.

Read-only. The capture path is phase 5 and lands separately, so this can ship
and be cached against while the write contract is still being settled.

── PERMISSIONS ──────────────────────────────────────────────────────────────
`hoto.capture` is the device's own permission and is deliberately narrow: it
grants the masters a tablet needs and nothing else. `hoto.view` is for people
reading the register in the dashboard.

Not gated on an existing permission that happens to be widely held. The PR to
Payment module hangs off `link.prpo.view`, which was created for an unrelated
shortcut and which thirteen of fifteen roles hold -- so that section is
effectively open to anyone who can sign in. Repeating that here would put the
fleet, the operator register and every competency record behind a permission
nobody chose.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import access as access_svc
from app.services import hoto_masters as svc
from app.services import hoto_capture as cap
from app.services import hoto_admin as adm

router = APIRouter(prefix="/api/hoto", tags=["HOTO"])

VIEW_PERMISSIONS = ("hoto.capture", "hoto.view", "hoto.admin")


def _guard(request: Request, db: Session) -> str:
    """Whoever is asking must hold one of the HOTO permissions.

    Returns the employee id, which every write will need and which the read
    endpoints log, because "which device pulled the operator register" is a
    question somebody will eventually ask.
    """
    emp = getattr(request.state, "emp_id", None)
    if not emp:
        raise HTTPException(401, "Please sign in to continue.")
    if any(access_svc.has_permission(db, emp, code) for code in VIEW_PERMISSIONS):
        return emp
    raise HTTPException(403, "You do not have access to HOTO.")


@router.get("/sync")
def sync(request: Request,
         plant_id: int | None = Query(default=None),
         db: Session = Depends(get_minehub_db)) -> dict:
    """Everything a device needs, in one round trip.

    ONE CALL, NOT FIVE. The moment a tablet has a network is short and often
    interrupted -- at a gate, in a yard, passing the workshop. Five calls can
    half-succeed, and a partial cache is worse than a stale one because it
    looks complete.
    """
    _guard(request, db)
    return svc.sync_bundle(db, plant_id=plant_id)


@router.get("/assets")
def assets(request: Request,
           plant_id: int | None = Query(default=None),
           db: Session = Depends(get_minehub_db)) -> dict:
    """The machines, with the last meter reading and any open defects."""
    _guard(request, db)
    rows = svc.assets(db, plant_id=plant_id)
    return {"count": len(rows), "assets": rows}


@router.get("/operators")
def operators(request: Request,
              db: Session = Depends(get_minehub_db)) -> dict:
    """The operators, with what each is signed off to drive.

    Competency is sent down so the device can SAY an operator is taking a
    machine he is not signed off on. It does not refuse him -- the mine has not
    decided whether that may be overridden, and until it does, recording the
    fact is more useful than blocking on a rule nobody has agreed.
    """
    _guard(request, db)
    rows = svc.operators(db)
    signed_off = sum(1 for r in rows if r["competent_type_ids"])
    return {"count": len(rows), "with_competency": signed_off, "operators": rows}


@router.get("/shifts")
def shifts(request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    """The shift calendar, with the production-day rule.

    The device must never work the production day out itself: a handover at
    06:00 belongs to the day that is ending, not the one starting, and a device
    clock that has drifted would get that wrong silently.
    """
    _guard(request, db)
    rows = svc.shifts(db)
    return {"count": len(rows), "shifts": rows}


@router.get("/template")
def template(request: Request,
             asset_type_id: int = Query(...),
             plant_id: int | None = Query(default=None),
             org_unit_id: int | None = Query(default=None),
             on_date: date | None = Query(default=None),
             db: Session = Depends(get_minehub_db)) -> dict:
    """The checklist in force for a machine type, on a day.

    `on_date` is the PRODUCTION DAY the handover belongs to, not today. A
    capture that syncs three days late must resolve against the template that
    was in force when it happened.
    """
    _guard(request, db)
    head = svc.resolve_template(db, asset_type_id, plant_id=plant_id,
                               org_unit_id=org_unit_id, on_date=on_date)
    if not head:
        raise HTTPException(404, "No active checklist is published for this machine type.")
    return svc.template_payload(db, head["template_id"])


@router.get("/template/{template_id}")
def template_by_id(template_id: int,
                   request: Request,
                   db: Session = Depends(get_minehub_db)) -> dict:
    """A specific template version, by id.

    Needed to read a historic capture: a session records the template and
    version it answered, and the register has to show the questions as they
    were asked, not as they are today.
    """
    _guard(request, db)
    payload = svc.template_payload(db, template_id)
    if not payload:
        raise HTTPException(404, "No such checklist.")
    return payload


# ── capture (phase 5) ────────────────────────────────────────────────────────

CAPTURE_PERMISSIONS = ("hoto.capture", "hoto.admin")


def _capture_guard(request: Request, db: Session) -> str:
    emp = getattr(request.state, "emp_id", None)
    if not emp:
        raise HTTPException(401, "Please sign in to continue.")
    if any(access_svc.has_permission(db, emp, c) for c in CAPTURE_PERMISSIONS):
        return emp
    raise HTTPException(403, "You may read HOTO but not record one.")


@router.post("/sessions", status_code=201)
def submit_session(request: Request,
                   payload: dict,
                   db: Session = Depends(get_minehub_db)) -> dict:
    """File one captured handover.

    IDEMPOTENT ON `client_uuid`. The device generates it at the moment of
    capture, so a retry after a dropped connection carries the same one and
    cannot file the handover twice. An identical replay returns the original
    record with `created: false` — which is what a device's retry should see,
    and why this returns 200 rather than 201 in that case.

    The rules are evaluated again here. The device already evaluated at the
    machine, because an operator who fails the brake check has to be told there
    and then. Where the two disagree the server wins and the difference is
    raised as an exception rather than smoothed over: it means either the device
    is running old rules or a template moved under it, and both are things a
    supervisor needs to see.
    """
    actor = _capture_guard(request, db)
    try:
        result = cap.submit(db, payload, actor)
    except cap.CaptureConflict as e:
        raise HTTPException(409, str(e))
    except cap.CaptureError as e:
        raise HTTPException(e.status, {"message": "The handover was not filed.",
                                       "problems": e.problems})
    if not result["created"]:
        # Already filed. Not an error — the device is retrying, correctly.
        from fastapi import Response
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=200, content=_jsonable(result))
    return result


def _jsonable(d: dict) -> dict:
    """datetimes out of a replayed row are not JSON on their own."""
    from datetime import date as _d, datetime as _dt
    return {k: (v.isoformat() if isinstance(v, (_d, _dt)) else v) for k, v in d.items()}


@router.get("/sessions/{client_uuid}")
def session_by_uuid(client_uuid: str,
                    request: Request,
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Has this capture been filed? The device asks before resending.

    Cheaper and safer than resending blind when a connection dropped
    mid-request and the device cannot tell whether the server got it.
    """
    _guard(request, db)
    row = cap._existing(db, client_uuid)
    if not row:
        raise HTTPException(404, "Not filed.")
    return _jsonable(row)


# ── admin: building and publishing checklists (phase 6) ──────────────────────

ADMIN_PERMISSION = "hoto.admin"


def _admin_guard(request: Request, db: Session) -> str:
    emp = getattr(request.state, "emp_id", None)
    if not emp:
        raise HTTPException(401, "Please sign in to continue.")
    if not access_svc.has_permission(db, emp, ADMIN_PERMISSION):
        raise HTTPException(403, "You do not administer HOTO checklists.")
    return emp


def _admin(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except adm.AdminError as e:
        raise HTTPException(e.status, {"message": "Refused.", "problems": e.problems})


@router.get("/admin/templates")
def admin_templates(request: Request,
                    include_retired: bool = Query(default=False),
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Every checklist, with how many handovers answered each version.

    That capture count is shown because it is the reason a published version
    cannot be edited.
    """
    _admin_guard(request, db)
    rows = adm.list_templates(db, include_retired=include_retired)
    return {"count": len(rows), "templates": rows}


@router.post("/admin/templates/{template_id}/clone", status_code=201)
def admin_clone(template_id: int, request: Request, payload: dict | None = None,
                db: Session = Depends(get_minehub_db)) -> dict:
    """Copy a checklist into a new draft — how every edit to a live one starts."""
    actor = _admin_guard(request, db)
    return _admin(adm.clone, db, template_id, actor,
                  name=(payload or {}).get("name"))


@router.post("/admin/templates/{template_id}/sections", status_code=201)
def admin_add_section(template_id: int, request: Request, payload: dict,
                      db: Session = Depends(get_minehub_db)) -> dict:
    actor = _admin_guard(request, db)
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, {"message": "Refused.", "problems": ["the section needs a name"]})
    return _admin(adm.add_section, db, template_id, name, actor)


@router.post("/admin/sections/{section_id}/items", status_code=201)
def admin_add_item(section_id: int, request: Request, payload: dict,
                   db: Session = Depends(get_minehub_db)) -> dict:
    actor = _admin_guard(request, db)
    return _admin(adm.add_item, db, section_id, payload, actor)


@router.put("/admin/items/{item_id}")
def admin_update_item(item_id: int, request: Request, payload: dict,
                      db: Session = Depends(get_minehub_db)) -> dict:
    actor = _admin_guard(request, db)
    return _admin(adm.update_item, db, item_id, payload, actor)


@router.delete("/admin/items/{item_id}")
def admin_retire_item(item_id: int, request: Request,
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Retires rather than deletes — a response points at its item."""
    actor = _admin_guard(request, db)
    return _admin(adm.retire_item, db, item_id, actor)


@router.post("/admin/templates/{template_id}/publish")
def admin_publish(template_id: int, request: Request, payload: dict,
                  db: Session = Depends(get_minehub_db)) -> dict:
    """Put a draft in force from a date.

    Refused if nothing on it is critical: a checklist where nothing blocks is a
    form, not a control.
    """
    actor = _admin_guard(request, db)
    eff = payload.get("effective_from")
    if not eff:
        raise HTTPException(422, {"message": "Refused.",
                                  "problems": ["effective_from is required"]})
    return _admin(adm.publish, db, template_id,
                  date.fromisoformat(eff) if isinstance(eff, str) else eff, actor)


@router.post("/admin/templates/{template_id}/retire")
def admin_retire(template_id: int, request: Request,
                 db: Session = Depends(get_minehub_db)) -> dict:
    actor = _admin_guard(request, db)
    return _admin(adm.retire, db, template_id, actor)
