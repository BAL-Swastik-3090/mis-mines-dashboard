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

from fastapi import (APIRouter, Depends, File, Form, HTTPException, Query,
                     Request, UploadFile)
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import access as access_svc
from app.services import hoto_masters as svc
from app.services import hoto_capture as cap
from app.services import hoto_admin as adm
from app.services import hoto_register as reg
from app.services import hoto_defects as dfx
from app.services import hoto_board as brd
from app.services import hoto_photos as pho
from app.services import hoto_devices as dvc
from app.services import hoto_app as appr
from fastapi.responses import FileResponse

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
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=200, content=_jsonable(result))
    return result


def _jsonable(d: dict) -> dict:
    """Coerce a row read back out of Postgres into something JSON accepts.

    A REPLAY RETURNS THE STORED ROW, not the payload that was sent, so it
    carries Postgres types: `client_uuid` comes back as a `UUID`, timestamps as
    `datetime`, numerics as `Decimal`. The created path never sees any of them,
    which is why this was wrong for `UUID` until a device actually retried --
    and a retry is the normal case offline, not an exceptional one. A tablet
    whose connection dropped mid-upload got a 500 and retried forever.
    """
    from datetime import date as _d, datetime as _dt
    from decimal import Decimal as _dec
    from uuid import UUID as _uuid

    def one(v):
        if isinstance(v, (_d, _dt)):
            return v.isoformat()
        if isinstance(v, _uuid):
            return str(v)
        if isinstance(v, _dec):
            return float(v)
        return v

    return {k: one(v) for k, v in d.items()}


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


@router.get("/admin/asset-types")
def admin_asset_types(request: Request,
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Every machine type in the fleet and whether it has a checklist.

    The question an administrator actually has, which a list of templates
    cannot answer: it shows what exists, not what is missing.
    """
    _admin_guard(request, db)
    rows = adm.asset_types_needing_a_checklist(db)
    return {"count": len(rows), "asset_types": rows,
            "without_a_checklist": sum(1 for r in rows if not r["published"])}


@router.post("/admin/templates", status_code=201)
def admin_create_template(request: Request, payload: dict,
                          db: Session = Depends(get_minehub_db)) -> dict:
    """Start a checklist for a machine type that has none."""
    actor = _admin_guard(request, db)
    return _admin(adm.create_template, db,
                  asset_type_id=payload.get("asset_type_id"),
                  name=payload.get("name", ""),
                  actor=actor,
                  plant_id=payload.get("plant_id"),
                  org_unit_id=payload.get("org_unit_id"))


@router.get("/admin/templates/{template_id}/performance")
def admin_item_performance(template_id: int, request: Request, days: int = 90,
                           db: Session = Depends(get_minehub_db)) -> dict:
    """How often each check on this template has actually found something.

    A checklist is a cost paid by every operator at every handover, and until
    now nothing said what any one question bought.
    """
    _admin_guard(request, db)
    days = max(7, min(days, 365))
    return {"template_id": template_id, "days": days,
            "items": adm.item_performance(db, template_id, days=days)}


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


@router.put("/admin/sections/{section_id}")
def admin_rename_section(section_id: int, request: Request, payload: dict,
                         db: Session = Depends(get_minehub_db)) -> dict:
    """Rename a section of a draft."""
    actor = _admin_guard(request, db)
    return _admin(adm.rename_section, db, section_id, payload.get("name", ""), actor)


@router.delete("/admin/sections/{section_id}")
def admin_delete_section(section_id: int, request: Request,
                         db: Session = Depends(get_minehub_db)) -> dict:
    """Remove an EMPTY section from a draft."""
    actor = _admin_guard(request, db)
    return _admin(adm.delete_section, db, section_id, actor)


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


# ── the register (phase 7) ───────────────────────────────────────────────────

@router.get("/register")
def register(request: Request,
             from_date: date | None = Query(default=None),
             to_date: date | None = Query(default=None),
             asset_id: int | None = Query(default=None),
             operator_id: int | None = Query(default=None),
             status: str | None = Query(default=None),
             session_type: str | None = Query(default=None),
             only_adverse: bool = Query(default=False),
             limit: int = Query(default=200, le=1000),
             db: Session = Depends(get_minehub_db)) -> dict:
    """Handovers, newest first.

    `only_adverse` is the filter people actually want: a register of clean
    handovers is long and says nothing, and the reason anybody opens this is
    usually that something was found.
    """
    _guard(request, db)
    rows = reg.search(db, from_date=from_date, to_date=to_date, asset_id=asset_id,
                      operator_id=operator_id, status=status,
                      session_type=session_type, only_adverse=only_adverse,
                      limit=limit)
    return {"count": len(rows), "sessions": rows}


@router.get("/register/export.csv")
def register_export(request: Request,
                    from_date: date | None = Query(default=None),
                    to_date: date | None = Query(default=None),
                    asset_id: int | None = Query(default=None),
                    status: str | None = Query(default=None),
                    session_type: str | None = Query(default=None),
                    only_adverse: bool = Query(default=False),
                    db: Session = Depends(get_minehub_db)):
    """The register, as a file.

    A register whose job is evidence has to leave the screen: for an audit,
    an inquiry, a monthly report. Same filters as the list, so what is
    exported is what was on screen. Declared before /register/{session_id},
    which would otherwise try to read "export.csv" as a handover number.
    """
    import csv
    import io
    from fastapi.responses import Response

    _guard(request, db)
    rows = reg.search(db, from_date=from_date, to_date=to_date, asset_id=asset_id,
                      status=status, session_type=session_type,
                      only_adverse=only_adverse, limit=1000)
    kind = {"START_HANDOVER": "Taking over", "END_HANDOVER": "Handing over",
            "MID_SHIFT": "Mid-shift check"}

    def other_side(r):
        if r.get("counterpart_name") or r.get("counterpart_emp_id"):
            return r.get("counterpart_name") or r.get("counterpart_emp_id")
        return "Nobody (parked)" if r.get("counterpart_absent") else ""

    def filled_by(r):
        if r.get("recorded_by_operator_id") is None:
            return ""
        if r["recorded_by_operator_id"] == r.get("operator_id"):
            return "The operator"
        return r.get("recorded_by_name") or r.get("recorded_by_emp_id") or ""

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Reference", "Captured", "Production day", "Shift", "Machine",
                "Machine type", "Kind", "Operator", "Operator number",
                "Other side", "Filled in by", "Status", "Blocked because",
                "Faults", "Checks answered", "Worst severity", "Photos",
                "Meter", "Meter unit", "Fuel %", "Position", "Other half",
                "Halves disagree on", "Device", "Reached the office",
                "Delay (min)", "Remarks"])
    for r in rows:
        w.writerow([
            r["session_ref"], r["captured_at"].isoformat() if r.get("captured_at") else "",
            r.get("production_day") or "", r.get("shift_code") or "",
            r["fleet_code"], r["asset_type_name"], kind.get(r["session_type"], r["session_type"]),
            r.get("operator_name") or "", r.get("operator_emp_id") or "",
            other_side(r), filled_by(r), r["status"], r.get("blocked_reason") or "",
            r["adverse_count"], r["answer_count"], r.get("worst_severity") or "",
            r["photo_count"], r.get("meter_reading") if r.get("meter_reading") is not None else "",
            r.get("meter_uom") or "", r.get("fuel_level") if r.get("fuel_level") is not None else "",
            (f"{r['captured_lat']},{r['captured_lon']}"
             if r.get("captured_lat") is not None else (r.get("gps_status") or "")),
            r.get("counterpart_ref") or "",
            r.get("pair_differs") if r.get("counterpart_ref") else "",
            r.get("device_code") or "",
            r["received_at"].isoformat() if r.get("received_at") else "",
            r.get("sync_delay_minutes") if r.get("sync_delay_minutes") is not None else "",
            r.get("remarks") or "",
        ])
    name = f"hoto-register-{from_date or 'all'}-to-{to_date or 'now'}.csv"
    # The BOM is for Excel, which otherwise reads names in Odia or with an
    # accent as mojibake.
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/register/{session_id}")
def register_detail(session_id: int, request: Request,
                    db: Session = Depends(get_minehub_db)) -> dict:
    """One handover in full, with every answer as it was given.

    The answers come from the response's own copies of the label, type and
    severity, not from a join to the live checklist — a register built that way
    would show today's wording against last March's answer, and a retired item
    would vanish from a record that definitely answered it.
    """
    _guard(request, db)
    d = reg.detail(db, session_id)
    if not d:
        raise HTTPException(404, "No such handover.")
    return d


@router.get("/compliance")
def compliance(request: Request,
               from_date: date = Query(...),
               to_date: date = Query(...),
               db: Session = Depends(get_minehub_db)) -> dict:
    """What was captured, and an explicit note that the denominator is unsettled.

    A HOTO system used on half the handovers produces a register whose SILENCES
    look like clean shifts — a reader cannot tell "nothing was wrong" from
    "nobody filled it in". Publishing a compliance percentage against a guessed
    expected-count would be worse than publishing none, so this reports what is
    there and says so.
    """
    _guard(request, db)
    return reg.compliance(db, from_date, to_date)


# ── defects and machine state (phase 8b) ─────────────────────────────────────

def _defects(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except dfx.DefectError as e:
        raise HTTPException(e.status, {"message": "Refused.", "problems": e.problems})


@router.get("/defects")
def defect_queue(request: Request,
                 asset_id: int | None = Query(default=None),
                 state: str | None = Query(default=None),
                 severity: str | None = Query(default=None),
                 open_only: bool = Query(default=True),
                 db: Session = Depends(get_minehub_db)) -> dict:
    """The workshop's queue, blocking machines first.

    Ordered by whether the defect holds the machine, then severity, then age —
    a queue sorted by date alone buries a locked machine under a fortnight of
    cabin lights.
    """
    _guard(request, db)
    rows = dfx.queue(db, asset_id=asset_id, state=state, severity=severity,
                     open_only=open_only)
    return {"count": len(rows),
            "blocking": sum(1 for r in rows if r["blocks_operation"]),
            "defects": rows}


@router.get("/defects/{defect_id}")
def defect_detail(defect_id: int, request: Request,
                  db: Session = Depends(get_minehub_db)) -> dict:
    """One defect, every sighting of it, and every move it has made."""
    _guard(request, db)
    d = dfx.detail(db, defect_id)
    if not d:
        raise HTTPException(404, "No such defect.")
    return d


@router.post("/defects/{defect_id}/transition")
def defect_transition(defect_id: int, request: Request, payload: dict,
                      db: Session = Depends(get_minehub_db)) -> dict:
    """Move a defect along.

    The database refuses a fitter verifying his own repair; this refuses the
    moves that make no sense in order and says which ones would. A machine is
    released only when NOTHING blocking is still open against it — one with two
    critical defects does not come back on the first repair.
    """
    actor = _capture_guard(request, db)
    to_state = (payload.get("to_state") or "").upper()
    return _defects(dfx.transition, db, defect_id, to_state, actor,
                    note=payload.get("note"))


@router.post("/defects/{defect_id}/plan")
def defect_plan(defect_id: int, request: Request, payload: dict,
                db: Session = Depends(get_minehub_db)) -> dict:
    """Say who is fixing a defect, and by when.

    Either or both. Each change goes in the defect's history with what it was
    before, so a target moved every time it is missed leaves that trail.
    """
    actor = _capture_guard(request, db)
    kw = {k: payload[k] for k in ("assigned_to", "target_date") if k in payload}
    return _defects(dfx.plan, db, defect_id, actor, **kw)


@router.get("/assets/{asset_id}/state")
def asset_state(asset_id: int, request: Request,
                db: Session = Depends(get_minehub_db)) -> dict:
    """What state a machine is in, and what is holding it there."""
    _guard(request, db)
    return {
        "asset_id": asset_id,
        "state": dfx.current_state(db, asset_id),
        "blocking_defects": [r for r in dfx.queue(db, asset_id=asset_id)
                             if r["blocks_operation"]],
    }


# ── the Shift HOTO Board (phase 9) ───────────────────────────────────────────

OVERRIDE_PERMISSION = "hoto.override"


def _board(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except brd.BoardError as e:
        raise HTTPException(e.status, {"message": "Refused.", "problems": e.problems})


@router.get("/board")
def shift_board(request: Request,
                plant_id: int | None = Query(default=None),
                shift_id: int | None = Query(default=None),
                production_day: date | None = Query(default=None),
                only_attention: bool = Query(default=False),
                db: Session = Depends(get_minehub_db)) -> dict:
    """Every active machine in one shift, and what is known about each.

    Starts from the MACHINES, not the handovers, because the rows a supervisor
    most needs are the machines with no handover — and a list of handovers
    cannot contain them.
    """
    _guard(request, db)
    return _board(brd.board, db, plant_id=plant_id, shift_id=shift_id,
                  production_day=production_day, only_attention=only_attention)


@router.get("/board/shift")
def board_shift(request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    """Which shift is running now, and the production day it belongs to."""
    _guard(request, db)
    return {"current": brd.current_shift(db), "shifts": svc.shifts(db)}


@router.get("/board/trend")
def board_trend(request: Request, days: int = 7, shift_code: str | None = None,
                db: Session = Depends(get_minehub_db)) -> dict:
    """Handovers filed on each of the last few production days.

    So the board's tally can be judged. A count with no history behind it
    cannot tell a bad shift from a rollout that never happened.
    """
    _guard(request, db)
    days = max(2, min(days, 60))
    return {"days": brd.recent_days(db, days=days, shift_code=shift_code)}


@router.post("/board/{asset_id}/state")
def board_decide(asset_id: int, request: Request, payload: dict,
                 db: Session = Depends(get_minehub_db)) -> dict:
    """A supervisor's call on one machine.

    Stopping a machine needs only the capture permission — a supervisor who
    thinks a machine should stop may always stop it. Releasing one that its own
    open defects say should be held is an override: it needs `hoto.override`
    and a written reason, and it is raised as an exception rather than filed
    quietly in the state history.
    """
    actor = _capture_guard(request, db)
    may_override = access_svc.has_permission(db, actor, OVERRIDE_PERMISSION)
    return _board(brd.decide, db, asset_id, (payload.get("state") or "").upper(),
                  actor, reason=payload.get("reason"), may_override=may_override,
                  shift_instance_id=payload.get("shift_instance_id"))


@router.get("/board/{asset_id}/history")
def board_history(asset_id: int, request: Request,
                  limit: int = Query(default=40, le=200),
                  db: Session = Depends(get_minehub_db)) -> dict:
    """How this machine's state has moved, newest first."""
    _guard(request, db)
    return {"asset_id": asset_id, "events": brd.history(db, asset_id, limit)}


# ── photos (phase 11) ────────────────────────────────────────────────────────

@router.post("/photos", status_code=201)
async def upload_photo(request: Request,
                       photo_uuid: str = Form(...),
                       client_uuid: str = Form(...),
                       item_id: int | None = Form(default=None),
                       captured_at: str | None = Form(default=None),
                       sha256: str | None = Form(default=None),
                       lat: float | None = Form(default=None),
                       lon: float | None = Form(default=None),
                       accuracy_m: float | None = Form(default=None),
                       file: UploadFile = File(...),
                       db: Session = Depends(get_minehub_db)) -> dict:
    """One photo, uploaded on its own.

    SEPARATELY FROM THE HANDOVER, deliberately. At a gate on a signal that
    lasts seconds, a session and its photos travelling together means neither
    arrives. The session is filed first and the photos follow, each addressed
    by the session's `client_uuid` — which is the only session key a device
    has, because it never holds a server id until the session has synced.

    Idempotent on `photo_uuid`, and the bytes are checked against the sha256
    the device computed: a truncated JPEG is refused rather than stored, since
    the only thing worse than no photo is a corrupt one that looks like
    evidence until somebody opens it.
    """
    actor = _capture_guard(request, db)
    content = await file.read()
    try:
        return pho.receive(
            db, photo_uuid=photo_uuid, client_uuid=client_uuid, content=content,
            actor=actor, item_id=item_id, captured_at=captured_at,
            content_type=file.content_type or "image/jpeg", sha256=sha256,
            lat=lat, lon=lon, accuracy_m=accuracy_m,
        )
    except pho.PhotoError as e:
        raise HTTPException(e.status, {"message": "The photo was not stored.",
                                       "problems": e.problems})


@router.get("/register/{session_id}/photos")
def session_photos(session_id: int, request: Request,
                   db: Session = Depends(get_minehub_db)) -> dict:
    """What evidence has arrived for this handover. Metadata only."""
    _guard(request, db)
    rows = pho.listing(db, session_id)
    return {"session_id": session_id, "count": len(rows), "photos": rows}


@router.get("/photos/{photo_id}")
def photo_bytes(photo_id: int, request: Request,
                db: Session = Depends(get_minehub_db)):
    """The image itself."""
    _guard(request, db)
    got = pho.content_of(db, photo_id)
    if not got:
        raise HTTPException(404, "No such photo.")
    content, content_type = got
    from fastapi.responses import Response as RawResponse
    return RawResponse(content=content, media_type=content_type,
                       headers={"Cache-Control": "private, max-age=86400"})


@router.get("/evidence/pending")
def pending_evidence(request: Request,
                     days: int = Query(default=7, ge=1, le=90),
                     db: Session = Depends(get_minehub_db)) -> dict:
    """Checks whose photos were attested to but have never arrived.

    The report that keeps an offline system honest. A photo still sitting on a
    tablet is indistinguishable from one nobody took unless somebody looks, and
    this is where somebody looks.
    """
    _guard(request, db)
    rows = pho.evidence_gaps(db, days)
    return {"days": days, "count": len(rows), "pending": rows}


# ── enrolling tablets (phase 12) ─────────────────────────────────────────────

def _devices(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except dvc.DeviceError as e:
        raise HTTPException(e.status, {"message": "Refused.", "problems": e.problems})


@router.get("/admin/devices")
def list_devices(request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    """Every tablet, what it has filed, and when it last called in."""
    _admin_guard(request, db)
    rows = dvc.listing(db)
    return {"count": len(rows), "devices": rows}


@router.post("/admin/devices", status_code=201)
def enrol_device(request: Request, payload: dict,
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Register a tablet and issue its credential.

    THE TOKEN COMES BACK ONCE. Only its hash is stored, so it cannot be shown
    again — a lost token means re-issuing, which is one call and leaves a
    trail. Recoverable secrets are how a credential ends up in a WhatsApp
    group.
    """
    actor = _admin_guard(request, db)
    return _devices(dvc.enrol, db,
                    device_code=payload.get("device_code", ""),
                    label=payload.get("label", ""),
                    profile=(payload.get("profile") or "COMPANY").upper(),
                    actor=actor,
                    plant_id=payload.get("plant_id"),
                    location_id=payload.get("location_id"),
                    remarks=payload.get("remarks"))


@router.post("/admin/devices/{device_code}/reissue")
def reissue_device(device_code: str, request: Request,
                   db: Session = Depends(get_minehub_db)) -> dict:
    """A new token for a tablet that lost its one. The old token stops at once."""
    actor = _admin_guard(request, db)
    return _devices(dvc.reissue, db, device_code, actor)


@router.post("/admin/devices/{device_code}/revoke")
def revoke_device(device_code: str, request: Request, payload: dict,
                  db: Session = Depends(get_minehub_db)) -> dict:
    """Stop a tablet — lost, stolen, or retired.

    Anything it captured and has not sent becomes unsendable, which the answer
    says in as many words: sync it first if that matters.
    """
    actor = _admin_guard(request, db)
    return _devices(dvc.revoke, db, device_code, actor,
                    payload.get("reason") or "")


# ── the app itself: versions, what changed, the files (16 Nov) ──────────────

APK_TYPE = "application/vnd.android.package-archive"


def _app(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except appr.AppError as e:
        raise HTTPException(e.status, {"message": "Refused.", "problems": e.problems})


@router.get("/app/releases")
def app_releases(request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    """Every version of the tablet app, newest first, and which is current."""
    _guard(request, db)
    return appr.listing()


@router.get("/app/releases/{rid}/download")
def app_download(rid: str, request: Request, db: Session = Depends(get_minehub_db)):
    """The APK, for anyone who can see HOTO. Withdrawn versions only for admins."""
    emp = _guard(request, db)
    is_admin = access_svc.has_permission(db, emp, ADMIN_PERMISSION)
    path, name = _app(appr.file_for, rid, allow_withdrawn=is_admin)
    return FileResponse(path, filename=name, media_type=APK_TYPE)


@router.post("/app/releases/{rid}/link")
def app_share_link(rid: str, request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    """A seven-day link a phone can open without signing in (shown as a QR code)."""
    _guard(request, db)
    return _app(appr.share_link, rid)


@router.post("/admin/app/releases")
async def app_upload(request: Request, file: UploadFile = File(...), notes: str = Form(""),
                     db: Session = Depends(get_minehub_db)) -> dict:
    """Publish a new version. Its version and build are read from the APK."""
    actor = _admin_guard(request, db)
    payload = await file.read()
    return _app(appr.upload, payload, file.filename, notes, actor)


@router.post("/admin/app/releases/{rid}/current")
def app_make_current(rid: str, request: Request, db: Session = Depends(get_minehub_db)) -> dict:
    actor = _admin_guard(request, db)
    return _app(appr.make_current, rid, actor)


@router.post("/admin/app/releases/{rid}/withdraw")
def app_withdraw(rid: str, request: Request, payload: dict,
                 db: Session = Depends(get_minehub_db)) -> dict:
    actor = _admin_guard(request, db)
    return _app(appr.withdraw, rid, actor, payload.get("reason"))


@router.post("/admin/app/releases/{rid}/notes")
def app_edit_notes(rid: str, request: Request, payload: dict,
                   db: Session = Depends(get_minehub_db)) -> dict:
    actor = _admin_guard(request, db)
    return _app(appr.edit_notes, rid, actor, payload.get("notes"))


@router.post("/admin/devices/{device_code}/block")
def block_device(device_code: str, request: Request, payload: dict,
                 db: Session = Depends(get_minehub_db)) -> dict:
    """Refuse a tablet for now -- mislaid, misused, under question.

    Undone by unblock. The tablet keeps its credential and everything it holds,
    and sends it once let back in. For a tablet that is gone for good, revoke.
    """
    actor = _admin_guard(request, db)
    return _devices(dvc.block, db, device_code, actor, payload.get("reason") or "")


@router.post("/admin/devices/{device_code}/unblock")
def unblock_device(device_code: str, request: Request, payload: dict,
                   db: Session = Depends(get_minehub_db)) -> dict:
    """Let a blocked tablet back in."""
    actor = _admin_guard(request, db)
    return _devices(dvc.unblock, db, device_code, actor, payload.get("reason"))


@router.post("/admin/devices/{device_code}/owner")
def set_device_owner(device_code: str, request: Request, payload: dict,
                     db: Session = Depends(get_minehub_db)) -> dict:
    """Whose a device is: a person and their employee number, whether it is
    their own phone or a company tablet, and what to call it."""
    actor = _admin_guard(request, db)
    return _devices(dvc.set_owner, db, device_code, actor,
                    name=payload.get("name"), emp=payload.get("emp"),
                    profile=payload.get("profile"), label=payload.get("label"))


@router.post("/admin/devices/{device_code}/approve")
def approve_device(device_code: str, request: Request, payload: dict,
                   db: Session = Depends(get_minehub_db)) -> dict:
    """Allow a device that registered itself.

    THE TOKEN IS NOT RETURNED HERE. It is generated and left for the device to
    collect on its next check, which is the whole point of migration 110: an
    approver who never sees a credential cannot forward one, and nobody types
    anything into the device.
    """
    actor = _admin_guard(request, db)
    return _devices(dvc.approve, db, device_code, actor,
                    label=payload.get("label"),
                    new_code=payload.get("device_code"),
                    profile=(payload.get("profile") or "").upper() or None,
                    plant_id=payload.get("plant_id"),
                    location_id=payload.get("location_id"),
                    track_location=payload.get("track_location"),
                    location_interval_s=payload.get("location_interval_s"),
                    reason=payload.get("reason"),
                    pairing=payload.get("pairing_code"))


@router.post("/admin/devices/{device_code}/reject")
def reject_device(device_code: str, request: Request, payload: dict,
                  db: Session = Depends(get_minehub_db)) -> dict:
    """Turn a registration down, with a reason the device shows its holder."""
    actor = _admin_guard(request, db)
    return _devices(dvc.reject, db, device_code, actor,
                    payload.get("reason") or "")


@router.post("/admin/devices/{device_code}/tracking")
def device_tracking(device_code: str, request: Request, payload: dict,
                    db: Session = Depends(get_minehub_db)) -> dict:
    """Turn a device's location reporting on or off, and set how often."""
    actor = _admin_guard(request, db)
    return _devices(dvc.set_tracking, db, device_code, actor,
                    track_location=bool(payload.get("track_location")),
                    location_interval_s=payload.get("location_interval_s"))


@router.post("/admin/devices/{device_code}/site")
def device_site(device_code: str, request: Request, payload: dict,
                db: Session = Depends(get_minehub_db)) -> dict:
    """Set which site a device belongs to, and so whose operators it may read."""
    actor = _admin_guard(request, db)
    pl = payload.get("plant_id")
    return _devices(dvc.set_site, db, device_code, actor,
                    plant_id=int(pl) if pl not in (None, "") else None)


@router.get("/admin/devices/{device_code}/track")
def device_track(device_code: str, request: Request, hours: int = 24,
                 limit: int = 500, db: Session = Depends(get_minehub_db)) -> dict:
    """Where one device has been, newest first."""
    _admin_guard(request, db)
    # Dates and Decimals both appear in a track; _jsonable is what the rest
    # of this router already uses to make them survive the trip.
    return _jsonable(_devices(dvc.track, db, device_code, hours=hours, limit=limit))
