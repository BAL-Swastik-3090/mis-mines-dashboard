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
            "roles": lset.roles(db), "count": len(heads)}


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
