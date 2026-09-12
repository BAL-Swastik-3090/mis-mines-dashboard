"""Mines access-role management (admin only — enforced by the middleware in main.py).

Roles are additive: every employee with valid intranet credentials is a viewer
without a row here. This table only records who has been elevated, so it stays
small and an empty table is a safe state rather than a lockout.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.auth import EMP_TBL, ROLE_RANK, ROLE_TBL

router = APIRouter(prefix="/api/roles", tags=["Roles"])


@router.get("")
def list_roles(db: Session = Depends(get_db)) -> list[dict]:
    """Everyone with an explicitly assigned role, with their HR details."""
    rows = db.execute(text(
        f"""SELECT r.emp_id, r.role, r.updated_by, r.updated_at,
                   e.EMPNAME AS name, e.EMPDEPT AS department, e.EMPDESG AS designation
            FROM {ROLE_TBL} r
            LEFT JOIN {EMP_TBL} e ON e.EMPID = r.emp_id
            ORDER BY FIELD(r.role,'admin','manager','viewer'), r.emp_id""")).mappings().all()
    return [dict(r) for r in rows]


@router.get("/employees")
def search_employees(q: str = Query("", min_length=0), db: Session = Depends(get_db)) -> list[dict]:
    """Employee lookup for the assign-role picker. Capped — this table is large."""
    term = (q or "").strip()
    if len(term) < 2:
        return []
    rows = db.execute(text(
        f"""SELECT EMPID AS emp_id, EMPNAME AS name, EMPDEPT AS department,
                   EMPDESG AS designation
            FROM {EMP_TBL}
            WHERE (EMPID LIKE :like OR EMPNAME LIKE :like) AND STATUS = 'A'
            ORDER BY EMPNAME LIMIT 25"""), {"like": f"%{term}%"}).mappings().all()
    return [dict(r) for r in rows]


@router.put("")
def set_role(request: Request, body: dict = Body(...), db: Session = Depends(get_db)) -> dict:
    emp_id = str(body.get("emp_id") or "").strip()
    role = str(body.get("role") or "").strip().lower()
    if not emp_id:
        raise HTTPException(400, "emp_id is required.")
    if role not in ROLE_RANK:
        raise HTTPException(400, f"role must be one of {sorted(ROLE_RANK)}.")

    by = getattr(request.state, "emp_id", None)
    if emp_id == by and role != "admin":
        # Removing your own admin with no other admin left would lock the screen
        # away from everyone and need a DBA to undo.
        raise HTTPException(400, "You cannot remove your own admin access.")

    db.execute(text(
        f"""INSERT INTO {ROLE_TBL} (emp_id, role, updated_by, updated_at)
            VALUES (:e, :r, :by, NOW())
            ON DUPLICATE KEY UPDATE role = :r, updated_by = :by, updated_at = NOW()"""),
        {"e": emp_id, "r": role, "by": by})
    db.commit()
    return {"ok": True, "emp_id": emp_id, "role": role}


@router.delete("/{emp_id}")
def delete_role(emp_id: str, request: Request, db: Session = Depends(get_db)) -> dict:
    """Drop an explicit role — the employee falls back to viewer."""
    if emp_id == getattr(request.state, "emp_id", None):
        raise HTTPException(400, "You cannot remove your own admin access.")
    db.execute(text(f"DELETE FROM {ROLE_TBL} WHERE emp_id = :e"), {"e": emp_id})
    db.commit()
    return {"ok": True, "emp_id": emp_id}
