"""The two selectors that sit under the OEE Master Selector.

    /api/oee-settings/equipment   the Equipment Status Selector
    /api/oee-settings/loss-heads  the LCM KAM Selector

BOTH ARE DATED, AND THE DATE IS THE POINT. A GET answers "what was in force
on this day"; a POST says "from this day on, this". So every route takes an
`on_date` and every response echoes it -- a screen that showed settings
without saying which day they belong to would be read as "the settings", and
the next person would change October believing they were changing today.

THE RESPONSES CARRY `effective_from` PER ROW, which is not the same as the
date asked for. A machine whose last decision was in October still answers a
question about November, and the row says so, so the screen can show which
settings are actually being inherited rather than implying each one was
chosen on the day being viewed.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import equipment_settings as eqs
from app.services import lcm_settings as lset

router = APIRouter(prefix="/api/oee-settings", tags=["OEE Master Selector"])


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _on(on_date: date | None) -> date:
    return on_date or date.today()


# ── The Equipment Status Selector ────────────────────────────────────────────
class EquipmentChange(BaseModel):
    equipment_name: str = Field(min_length=1, max_length=60)
    status: str | None = Field(None, pattern="^(ACTIVE|INACTIVE)$")
    generation: str | None = Field(None, pattern="^(OLD|NEW)$")
    ideal_cum_per_hr: float | None = Field(None, gt=0, le=9999)
    ideal_trip_fixed: int | None = Field(None, gt=0, le=99999)
    trips_per_engine_hour: float | None = Field(None, gt=0, le=99)

    def fields(self) -> dict[str, Any]:
        """Only what the screen actually sent.

        `exclude_unset` and not `exclude_none`: clearing a figure is a real
        edit, and the two are indistinguishable once None has been dropped.
        """
        return self.model_dump(exclude_unset=True,
                               exclude={"equipment_name"})


class EquipmentIn(BaseModel):
    effective_from: date
    changes: list[EquipmentChange]


@router.get("/equipment")
def read_equipment(on_date: date | None = Query(None),
                   include_inactive: bool = Query(True),
                   db: Session = Depends(get_minehub_db)) -> dict:
    """The whole fleet as it stood on a day, grouped the way the screen reads.

    Inactive machines are included by DEFAULT here, unlike everywhere else in
    the application. This is the screen on which a machine is brought back,
    and one that cannot be seen cannot be brought back.
    """
    d = _on(on_date)
    rows = eqs.resolve(db, d, active_only=not include_inactive)

    def group(klass: str, gen: str) -> list[dict]:
        return [r for r in rows
                if r["equipment_class"] == klass and r["generation"] == gen]

    return {
        "on_date": d.isoformat(),
        "groups": [
            {"key": "excavator_old", "label": "Excavator · Old",
             "equipment_class": eqs.EXCAVATOR, "generation": eqs.OLD,
             "machines": group(eqs.EXCAVATOR, eqs.OLD)},
            {"key": "excavator_new", "label": "Excavator · New",
             "equipment_class": eqs.EXCAVATOR, "generation": eqs.NEW,
             "machines": group(eqs.EXCAVATOR, eqs.NEW)},
            {"key": "tipper_old", "label": "Tipper · Old",
             "equipment_class": eqs.TIPPER, "generation": eqs.OLD,
             "machines": group(eqs.TIPPER, eqs.OLD)},
            {"key": "tipper_new", "label": "Tipper · New",
             "equipment_class": eqs.TIPPER, "generation": eqs.NEW,
             "machines": group(eqs.TIPPER, eqs.NEW)},
        ],
        "count": len(rows),
    }


@router.post("/equipment")
def save_equipment(body: EquipmentIn, request: Request,
                   db: Session = Depends(get_minehub_db)) -> dict:
    changes = {c.equipment_name: c.fields() for c in body.changes}
    if len(changes) != len(body.changes):
        raise HTTPException(400, "The same machine appears twice.")
    try:
        res = eqs.save(db, body.effective_from, changes, _actor(request))
    except eqs.SettingsError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    return {**res, "entry_id": _actor(request)}


@router.get("/equipment/history")
def equipment_history(equipment_name: str | None = Query(None),
                      limit: int = Query(200, ge=1, le=1000),
                      db: Session = Depends(get_minehub_db)) -> dict:
    rows = eqs.history(db, equipment_name, limit)
    return {"equipment_name": equipment_name, "count": len(rows),
            "history": rows}


@router.get("/equipment/versions")
def equipment_versions(equipment_name: str = Query(...),
                       db: Session = Depends(get_minehub_db)) -> dict:
    rows = eqs.versions(db, equipment_name)
    return {"equipment_name": equipment_name, "count": len(rows),
            "versions": rows}


# ── The LCM KAM Selector ─────────────────────────────────────────────────────
class LossHeadChange(BaseModel):
    column_name: str = Field(min_length=1, max_length=60)
    label: str | None = Field(None, min_length=1, max_length=80)
    loss_type: str | None = Field(
        None, pattern="^(Controllable|Non Controllable|Unclassified)$")
    kam_name: str | None = Field(None, max_length=60)
    role_code: str | None = Field(None, max_length=20)
    sl_order: int | None = Field(None, ge=1, le=999)
    is_active: bool | None = None

    def fields(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True, exclude={"column_name"})


class LossHeadIn(BaseModel):
    effective_from: date
    changes: list[LossHeadChange]


@router.get("/loss-heads")
def read_loss_heads(on_date: date | None = Query(None),
                    db: Session = Depends(get_minehub_db)) -> dict:
    """The loss heads as classified on a day, plus who they can be given to.

    WHAT THIS DOES NOT LIST is every loss head that exists. Which heads exist
    comes from the columns of the source table in balcorpdb, which this route
    has no session for; what it returns is every head anyone has ever
    classified. A head the mine has just started recording appears on the
    matrix as Unclassified before it appears here, which is the right way
    round -- the matrix must never hide one.
    """
    d = _on(on_date)
    heads = list(lset.resolve(db, d).values())
    heads.sort(key=lambda h: (h["sl_order"] or 999, h["column_name"]))
    return {"on_date": d.isoformat(), "heads": heads,
            "kams": lset.kams(db, active_only=False),
            # Dated, like the heads. These are the names on the KAM Wise Loss
            # Tree's own cards -- who runs each node, as distinct from who
            # owns each loss head under it.
            "roles": lset.roles(db, d), "count": len(heads)}


@router.post("/loss-heads")
def save_loss_heads(body: LossHeadIn, request: Request,
                    db: Session = Depends(get_minehub_db)) -> dict:
    changes = {c.column_name: c.fields() for c in body.changes}
    if len(changes) != len(body.changes):
        raise HTTPException(400, "The same loss head appears twice.")
    try:
        res = lset.save(db, body.effective_from, changes, _actor(request))
    except lset.SettingsError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    return {**res, "entry_id": _actor(request)}


# ── The owners of the tree's own nodes ───────────────────────────────────────
# SEPARATE FROM THE LOSS HEADS, because they are a separate fact. A head's KAM
# is who owns that loss; a node's owner is who runs the department it rolls up
# to. They do not derive from one another -- Head Human Resource holds four
# heads under one KAM and Trans. truck jam under a different one -- so the
# mine states both. Saved with its own date, resolved the same way.
class RoleChange(BaseModel):
    role_code: str = Field(min_length=1, max_length=20)
    #: None is a vacant post, and is allowed. It is NOT the same as leaving
    #: the field out, which means "do not touch the owner".
    owner_kam: str | None = Field(None, max_length=60)
    title: str | None = Field(None, min_length=1, max_length=60)

    def fields(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True, exclude={"role_code"})


class RolesIn(BaseModel):
    effective_from: date
    changes: list[RoleChange]


@router.get("/roles")
def read_roles(on_date: date | None = Query(None),
               db: Session = Depends(get_minehub_db)) -> dict:
    """The nodes of the KAM Wise Loss Tree as they stood on a day."""
    d = _on(on_date)
    return {"on_date": d.isoformat(), "roles": lset.roles(db, d),
            "kams": lset.kams(db, active_only=False)}


@router.post("/roles")
def save_roles(body: RolesIn, request: Request,
               db: Session = Depends(get_minehub_db)) -> dict:
    changes = {c.role_code: c.fields() for c in body.changes}
    if len(changes) != len(body.changes):
        raise HTTPException(400, "The same node appears twice.")
    try:
        res = lset.save_roles(db, body.effective_from, changes, _actor(request))
    except lset.SettingsError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    return {**res, "entry_id": _actor(request)}


@router.get("/roles/history")
def roles_history(role_code: str | None = Query(None),
                  limit: int = Query(200, ge=1, le=1000),
                  db: Session = Depends(get_minehub_db)) -> dict:
    rows = lset.role_history(db, role_code, limit)
    return {"role_code": role_code, "count": len(rows), "history": rows}


@router.get("/roles/versions")
def roles_versions(role_code: str = Query(...),
                   db: Session = Depends(get_minehub_db)) -> dict:
    rows = lset.role_versions(db, role_code)
    return {"role_code": role_code, "count": len(rows), "versions": rows}


# ── The people a loss head can be given to ───────────────────────────────────
class KamIn(BaseModel):
    """Add an employee to the KAM list."""
    emp_id: str = Field(min_length=1, max_length=20)
    #: The display name for the matrix. Defaults to a title-cased form of the
    #: SAP name, which the screen offers and the user may edit -- the mine's
    #: own short forms ("K L Das") are not derivable from the register.
    kam_name: str | None = Field(None, min_length=1, max_length=60)


class KamLinkIn(BaseModel):
    """Attach an employee to a name already on the list, or retire it."""
    kam_name: str = Field(min_length=1, max_length=60)
    emp_id: str | None = Field(None, min_length=1, max_length=20)
    status: str | None = Field(None, pattern="^(ACTIVE|INACTIVE)$")


@router.get("/employees")
def search_employees(q: str = Query("", max_length=80),
                     db: Session = Depends(get_minehub_db)) -> dict:
    """Employee lookup for the Add KAM picker.

    THE SAME REGISTER ACCESS CONTROL USES, but behind this page's own gate
    rather than access.users.view -- somebody maintaining the loss matrix has
    no business holding the user list, and requiring it would mean handing out
    Access Control to let a clerk name a KAM.

    It returns a name, a designation and a department and nothing else: enough
    to tell two people called Singh apart, and no more of the HR record than
    that question needs.
    """
    rows = lset.search_employees(db, q)
    return {"q": q, "count": len(rows), "employees": rows}


@router.post("/kams")
def add_kam(body: KamIn, request: Request,
            db: Session = Depends(get_minehub_db)) -> dict:
    try:
        return lset.add_kam(db, body.emp_id, body.kam_name, _actor(request))
    except lset.SettingsError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))


@router.patch("/kams")
def link_kam(body: KamLinkIn, request: Request,
             db: Session = Depends(get_minehub_db)) -> dict:
    """Attach an employee id to an existing name, or retire the name.

    Retiring is a status, never a delete: the dated loss-head versions point
    at this name, and a month already reported must keep naming its owner.
    """
    try:
        return lset.link_kam(db, body.kam_name, body.emp_id, body.status,
                             actor=_actor(request))
    except lset.SettingsError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))


@router.get("/loss-heads/history")
def loss_head_history(column_name: str | None = Query(None),
                      limit: int = Query(200, ge=1, le=1000),
                      db: Session = Depends(get_minehub_db)) -> dict:
    rows = lset.history(db, column_name, limit)
    return {"column_name": column_name, "count": len(rows), "history": rows}


@router.get("/loss-heads/versions")
def loss_head_versions(column_name: str = Query(...),
                       db: Session = Depends(get_minehub_db)) -> dict:
    rows = lset.versions(db, column_name)
    return {"column_name": column_name, "count": len(rows), "versions": rows}
