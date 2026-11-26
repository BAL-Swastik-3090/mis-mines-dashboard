"""The mine's resource reserve — declared here, depleted by SAP.

WHAT A SUBMISSION IS. One survey's complete declaration: three grades, each
with a tonnage and an in-situ assay, against one as_on_date. All three are
written together in one transaction, because a reserve that is this month's HG
beside last month's MG is not a position anybody can quote.

WHY THE WHOLE DATE IS REPLACED rather than upserted grade by grade: a grade
dropped from a later submission would otherwise linger from an earlier save and
quietly inflate the total. What is stored for a date is exactly what was last
submitted for it.

EDITING IS EXPECTED, not exceptional. The mine restates the reserve whenever a
survey does, and corrects a typo whenever one is spotted. Both go through this
same endpoint; the difference is only whether the as_on_date is new. Every
change — insert, edit and delete — is written to mines_resource_reserve_log
with the value before and after, because this figure backs a valuation of
several thousand crore.

WHO MAY EDIT. Anyone who can open the MIS dashboard; the prefix maps to the
"mis" page in services/auth.py, so the middleware has already required
dashboard.mis by the time a request arrives here. Set RESERVE_PERMISSION to
tighten it from Access Control later.

NO MySQL SESSION ON THE WRITE PATHS. Everything typed here lives in minehub.
The one read that needs SAP takes a session for pp_production, which still
lives in balcorpdb until the OData migration lands — services/sap_source.py
prefers the Postgres feed the moment it is ready.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import perm
from app.services import resource_reserve as rr

router = APIRouter(prefix="/api/resource-reserve", tags=["Mines Resource Reserve"])

GRADES = rr.GRADES
#: The hook this file carried from the start, now filled in by migration 137.
#: reserve.edit is marked SENSITIVE in that migration: every remaining-reserve
#: and valuation figure on the dashboard is derived from what is filed here,
#: it is filed a handful of times a year, and a wrong tonnage is wrong
#: everywhere without anything on screen to say so.
VIEW = "reserve.view"
EDIT = "reserve.edit"

#: ...and what the MIS DASHBOARD holds. The Executive Summary draws the
#: remaining reserve from the position endpoint below, so gating that one read
#: on reserve.* alone would have emptied a panel on a page those people are
#: already entitled to -- the figure is published to them either way. It
#: applies to the POSITION only: the survey as typed, the history and the
#: valuation sandbox are the form's own and stay with reserve.*, and every
#: write stays with reserve.edit, which migration 137 marks SENSITIVE.
DASHBOARD = "dashboard.mis"


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


# ── read ────────────────────────────────────────────────────────────────────

@router.get("", summary="Declared reserve, depletion since, and what is left")
def get_position(
    request: Request,
    as_on: date | None = Query(None, description="Defaults to today"),
    db: Session = Depends(get_db),
    pg: Session = Depends(get_minehub_db),
) -> dict:
    perm.require_any(request, (VIEW, EDIT, DASHBOARD),
                     "read the declared resource reserve")
    return rr.position(db, pg, as_on)


@router.get("/declaration", summary="One survey exactly as it was typed")
def get_declaration(
    request: Request,
    as_on_date: date | None = Query(
        None, description="The exact survey date; latest on or before today "
                          "when omitted"),
    pg: Session = Depends(get_minehub_db),
) -> dict:
    perm.require_any(request, (VIEW, EDIT), "read the declared resource reserve")
    """What the form reloads when it is reopened.

    Asked for an EXACT date it returns that survey or an empty one — never the
    previous survey's figures under the date being edited, which would read as
    though the date already had a declaration on it.
    """
    if as_on_date is None:
        d = rr.declaration(pg)
        rows = d["rows"]
        when = d["as_on_date"]
    else:
        rows = [dict(r) for r in pg.execute(text("""
            SELECT grade, tonnage_mt, cr2o3_pct, remarks,
                   entry_id, entry_date, updated_at, updated_by
              FROM minehub.mines_resource_reserve
             WHERE as_on_date = :d
        """), {"d": as_on_date}).mappings()]
        when = as_on_date if rows else None

    by_grade = {r["grade"]: r for r in rows}
    return {
        "as_on_date": when.isoformat() if when else None,
        "exists": bool(rows),
        "grades": [{
            "grade": g,
            "label": rr.LABELS[g],
            "tonnage": float(by_grade[g]["tonnage_mt"]) if g in by_grade else None,
            "cr2o3": float(by_grade[g]["cr2o3_pct"]) if g in by_grade else None,
        } for g in GRADES],
        "remarks": next((r["remarks"] for r in rows if r["remarks"]), None),
        "entry_id": rows[0]["entry_id"] if rows else None,
        "entry_date": rows[0]["entry_date"] if rows else None,
        "updated_at": max((r["updated_at"] for r in rows), default=None),
        "updated_by": next((r["updated_by"] for r in rows
                            if r["updated_by"]), None),
    }


@router.get("/history", summary="Every survey on file, newest first")
def get_history(request: Request,
                pg: Session = Depends(get_minehub_db)) -> dict:
    perm.require_any(request, (VIEW, EDIT), "read the declared resource reserve")
    return {"declarations": rr.declarations(pg)}


@router.get("/valuation", summary="Value a position without storing it")
def get_valuation(
    request: Request,
    hg: float = Query(0, ge=0), mg: float = Query(0, ge=0),
    lg: float = Query(0, ge=0),
    as_on: date | None = Query(None),
    pg: Session = Depends(get_minehub_db),
) -> dict:
    """What the form shows while it is being filled in.

    GATED LIKE THE STORED DECLARATION, although it stores nothing. It prices
    a tonnage, so leaving it open would hand the valuation out to anybody who
    knows the URL -- the arithmetic is the sensitive part, not the row.

    Priced on the server rather than in the browser so that the figure the
    person sees before saving is produced by the same code, and the same IBM
    issue, as the figure the dashboard shows afterwards. A rate copied into the
    frontend is a rate that goes stale on its own.
    """
    perm.require_any(request, (VIEW, EDIT), "value the resource reserve")
    when = as_on or date.today()
    tonnes = {"HG": hg, "MG": mg, "LG": lg}
    val = rr.value(pg, tonnes, when)
    total = hg + mg + lg
    return {"as_on": when.isoformat(), "tonnage": total, "valuation": val}


# ── write ───────────────────────────────────────────────────────────────────

def _clean(body: dict) -> tuple[date, list[tuple[str, float, float]], str | None]:
    try:
        when = date.fromisoformat(str(body.get("as_on_date", "")).strip())
    except ValueError:
        raise HTTPException(400, "A survey needs the date it is declared for.")

    raw = body.get("grades")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "Send the three grades.")

    seen, clean = set(), []
    for item in raw:
        grade = str(item.get("grade", "")).strip().upper()
        if grade not in GRADES:
            raise HTTPException(400, f"'{grade}' is not a reserve grade.")
        if grade in seen:
            raise HTTPException(400, f"{grade} appears twice.")
        seen.add(grade)
        for field, label in (("tonnage", "tonnage"), ("cr2o3", "Cr2O3%")):
            if item.get(field) in (None, ""):
                raise HTTPException(400, f"{grade} needs a {label}.")
        try:
            qty = float(item["tonnage"])
            pct = float(item["cr2o3"])
        except (TypeError, ValueError):
            raise HTTPException(400, f"{grade} has a figure that is not a number.")
        if qty < 0:
            raise HTTPException(400, f"{grade} tonnage cannot be negative.")
        # Checked here as well as by the CHECK constraint so the form gets a
        # sentence instead of a database error. The commonest mistake by far is
        # a tonnage typed into the assay column.
        if not 0 <= pct <= 100:
            raise HTTPException(
                400, f"{grade} Cr2O3% must be between 0 and 100 — "
                     f"got {pct:g}. Is a tonnage in the grade column?")
        clean.append((grade, round(qty, 2), round(pct, 3)))

    missing = [g for g in GRADES if g not in seen]
    if missing:
        raise HTTPException(
            400, f"A declaration covers every grade. Missing: "
                 f"{', '.join(missing)}. Enter 0 for a band that is exhausted.")

    remarks = str(body.get("remarks") or "").strip() or None
    return when, clean, remarks


@router.put("", summary="File or restate a survey")
def save(request: Request, body: dict = Body(...),
         pg: Session = Depends(get_minehub_db)) -> dict:
    perm.require(request, EDIT, "declare the resource reserve")
    when, rows, remarks = _clean(body)
    actor = _actor(request)

    before = {r["grade"]: r for r in pg.execute(text("""
        SELECT grade, tonnage_mt, cr2o3_pct FROM minehub.mines_resource_reserve
         WHERE as_on_date = :d
    """), {"d": when}).mappings()}

    try:
        # ONE TRANSACTION for the whole survey: a failure leaves the previous
        # declaration exactly as it was rather than half replaced.
        for grade, qty, pct in rows:
            old = before.get(grade)
            pg.execute(text("""
                INSERT INTO minehub.mines_resource_reserve
                       (as_on_date, grade, tonnage_mt, cr2o3_pct, remarks,
                        entry_id, updated_by)
                VALUES (:d, :g, :t, :c, :r, :actor, :actor)
                ON CONFLICT (as_on_date, grade) DO UPDATE
                   SET tonnage_mt = EXCLUDED.tonnage_mt,
                       cr2o3_pct  = EXCLUDED.cr2o3_pct,
                       remarks    = EXCLUDED.remarks,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()
            """), {"d": when, "g": grade, "t": qty, "c": pct,
                   "r": remarks, "actor": actor})

            # Logged only when something actually moved. A re-save that changes
            # nothing is not a restatement, and an audit trail full of them is
            # one nobody reads.
            if old is None or float(old["tonnage_mt"]) != qty \
                    or float(old["cr2o3_pct"]) != pct:
                pg.execute(text("""
                    INSERT INTO minehub.mines_resource_reserve_log
                           (as_on_date, grade, action,
                            old_tonnage_mt, new_tonnage_mt,
                            old_cr2o3_pct, new_cr2o3_pct, changed_by)
                    VALUES (:d, :g, :a, :ot, :nt, :oc, :nc, :actor)
                """), {"d": when, "g": grade,
                       "a": "UPDATE" if old else "INSERT",
                       "ot": old["tonnage_mt"] if old else None, "nt": qty,
                       "oc": old["cr2o3_pct"] if old else None, "nc": pct,
                       "actor": actor})

        # A grade dropped from this submission is removed, so what is stored is
        # exactly what was sent.
        pg.execute(text("""
            DELETE FROM minehub.mines_resource_reserve
             WHERE as_on_date = :d AND grade <> ALL(:keep)
        """), {"d": when, "keep": [g for g, _, _ in rows]})
        pg.commit()
    except HTTPException:
        pg.rollback()
        raise
    except Exception as exc:                                # noqa: BLE001
        pg.rollback()
        raise HTTPException(500, f"The survey was not saved: {exc}") from exc

    return {"saved": True, "as_on_date": when.isoformat(),
            "grades": len(rows), "by": actor}


@router.delete("", summary="Withdraw a survey")
def remove(request: Request,
           as_on_date: date = Query(..., description="The survey to withdraw"),
           pg: Session = Depends(get_minehub_db)) -> dict:
    perm.require(request, EDIT, "withdraw a resource reserve survey")
    actor = _actor(request)
    rows = [dict(r) for r in pg.execute(text("""
        SELECT grade, tonnage_mt, cr2o3_pct FROM minehub.mines_resource_reserve
         WHERE as_on_date = :d
    """), {"d": as_on_date}).mappings()]
    if not rows:
        raise HTTPException(404, "There is no survey on that date.")

    try:
        for r in rows:
            pg.execute(text("""
                INSERT INTO minehub.mines_resource_reserve_log
                       (as_on_date, grade, action, old_tonnage_mt,
                        old_cr2o3_pct, changed_by)
                VALUES (:d, :g, 'DELETE', :ot, :oc, :actor)
            """), {"d": as_on_date, "g": r["grade"], "ot": r["tonnage_mt"],
                   "oc": r["cr2o3_pct"], "actor": actor})
        pg.execute(text("DELETE FROM minehub.mines_resource_reserve "
                        "WHERE as_on_date = :d"), {"d": as_on_date})
        pg.commit()
    except Exception as exc:                                # noqa: BLE001
        pg.rollback()
        raise HTTPException(500, f"The survey was not withdrawn: {exc}") from exc

    return {"deleted": True, "as_on_date": as_on_date.isoformat(),
            "grades": len(rows), "by": actor}
