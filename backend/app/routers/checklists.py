"""The things people record answers against, and the screen that edits them.

Competency dimensions and handover checks share a table because they are the
same shape — an ordered, named thing somebody answers for a class of machine —
and sharing it means one screen manages both.

NOTHING IS DELETED ONCE IT HAS BEEN ANSWERED. Retiring an item hides it from
the form and leaves every assessment already recorded against it exactly as it
was. A dimension that was removed outright would either take its history with
it or leave rows pointing at a code nothing explains, and an append-only trail
cannot afford either.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/checklists", tags=["Checklists"])

KINDS = ("COMPETENCY", "HOTO")

# Competency dimensions belong to whoever runs assessment; handover checks
# belong to whoever runs the machine register. Different lists, different
# people, so the gate is per kind rather than one permission for "vocabulary".
MANAGE = {"COMPETENCY": "platform.operators.manage",
          "HOTO": "platform.registry.manage"}

EDITABLE = ("label", "help", "asset_type_id", "is_decisive", "is_required",
            "sort_order", "status")


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _kind(kind: str) -> str:
    k = (kind or "").upper()
    if k not in KINDS:
        raise HTTPException(400, f"Kind must be one of {', '.join(KINDS)}.")
    return k


def _require(request: Request, kind: str) -> None:
    held = getattr(request.state, "permissions", None) or set()
    if MANAGE[kind] not in held:
        raise HTTPException(
            403, f"You do not have permission to change the {kind.lower()} list. "
                 f"An Access Manager grants {MANAGE[kind]}.")


def _code_from(label: str) -> str:
    """A stable code from the words somebody typed.

    Generated rather than asked for: the code is machinery — it is what gets
    written to operator_competency.dimension — and asking an assessor to
    invent one is asking them to care about the database.
    """
    code = re.sub(r"[^A-Z0-9]+", "_", (label or "").upper()).strip("_")
    return code[:48] or "ITEM"


@router.get("")
def list_items(kind: str = Query("COMPETENCY"),
               asset_type_id: int | None = Query(None),
               include_retired: bool = Query(False),
               db: Session = Depends(get_minehub_db)) -> list[dict]:
    """One list, in order.

    An item with no asset type applies everywhere; one that names a class is
    added when that class is being assessed. Asking for a class returns both,
    which is the list the form should show.
    """
    k = _kind(kind)
    rows = db.execute(text("""
        SELECT c.checklist_item_id, c.kind, c.code, c.label, c.help,
               c.asset_type_id, t.name AS asset_type, c.is_decisive,
               c.is_required, c.sort_order, c.status, c.updated_at, c.updated_by,
               -- How many answers already point at this item. It is what
               -- decides whether the code may still be changed, and it is the
               -- number somebody wants before they retire something.
               (SELECT count(*) FROM operator_competency oc
                 WHERE c.kind = 'COMPETENCY' AND oc.dimension = c.code) AS answers
          FROM checklist_item c
          LEFT JOIN asset_type t ON t.asset_type_id = c.asset_type_id
         WHERE c.kind = :kind
           AND (:retired OR c.status = 'ACTIVE')
           AND (CAST(:atid AS bigint) IS NULL
                OR c.asset_type_id IS NULL
                OR c.asset_type_id = CAST(:atid AS bigint))
         ORDER BY c.sort_order, c.checklist_item_id
    """), {"kind": k, "retired": include_retired, "atid": asset_type_id}).mappings().all()
    return [dict(r) for r in rows]


@router.post("")
def create_item(request: Request, body: dict = Body(...),
                db: Session = Depends(get_minehub_db)) -> dict:
    """Add one. The code is derived from the label and then left alone."""
    k = _kind(body.get("kind", "COMPETENCY"))
    _require(request, k)

    label = (body.get("label") or "").strip()
    if not label:
        raise HTTPException(400, "Give it a name — that is what the assessor reads.")

    code = _code_from(body.get("code") or label)
    atid = body.get("asset_type_id") or None

    if db.execute(text(
        "SELECT 1 FROM checklist_item WHERE kind = :k AND code = :c "
        "AND asset_type_id IS NOT DISTINCT FROM CAST(:a AS bigint)"),
            {"k": k, "c": code, "a": atid}).first():
        raise HTTPException(409, f"“{label}” is already on this list.")

    # New items go to the end rather than the middle, because a list that
    # reorders itself when you add to it is a list people stop trusting.
    last = db.execute(text(
        "SELECT COALESCE(max(sort_order), 0) FROM checklist_item WHERE kind = :k"),
        {"k": k}).scalar()

    row = db.execute(text("""
        INSERT INTO checklist_item (kind, code, label, help, asset_type_id,
                                    is_decisive, is_required, sort_order, created_by)
        VALUES (:k, :code, :label, :help, CAST(:atid AS bigint),
                FALSE, :req, :ord, :by)
        RETURNING checklist_item_id
    """), {"k": k, "code": code, "label": label,
           "help": (body.get("help") or "").strip() or None,
           "atid": atid, "req": bool(body.get("is_required")),
           "ord": last + 10, "by": _actor(request)}).mappings().first()
    db.commit()
    return {"ok": True, "checklist_item_id": row["checklist_item_id"], "code": code}


@router.post("/reorder")
def reorder(request: Request, body: dict = Body(...),
            db: Session = Depends(get_minehub_db)) -> dict:
    """The order the form asks the questions in, which is the order the work
    is done in. Sent whole rather than as a swap, so a dropped request cannot
    leave the list half-reordered."""
    k = _kind(body.get("kind", "COMPETENCY"))
    _require(request, k)
    ids = body.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(400, "Send the item ids in the order you want them.")

    for position, item_id in enumerate(ids, start=1):
        db.execute(text(
            "UPDATE checklist_item SET sort_order = :o, updated_at = now(), "
            "updated_by = :by WHERE checklist_item_id = :i AND kind = :k"),
            {"o": position * 10, "i": int(item_id), "k": k, "by": _actor(request)})
    db.commit()
    return {"ok": True, "ordered": len(ids)}


@router.put("/{item_id}")
def update_item(item_id: int, request: Request, body: dict = Body(...),
                db: Session = Depends(get_minehub_db)) -> dict:
    """Change one.

    The code is never updated here. Assessments point at it, and renaming it
    would silently orphan every answer already given — the label is what
    people read and it can be reworded freely.
    """
    current = db.execute(text(
        "SELECT * FROM checklist_item WHERE checklist_item_id = :i"),
        {"i": item_id}).mappings().first()
    if not current:
        raise HTTPException(404, "That item is not on the list.")
    _require(request, current["kind"])

    data = {k: body[k] for k in EDITABLE if k in body}
    if "label" in data and not str(data["label"]).strip():
        raise HTTPException(400, "It still needs a name.")
    if "status" in data and data["status"] not in ("ACTIVE", "RETIRED"):
        raise HTTPException(400, "Status is ACTIVE or RETIRED.")
    if not data:
        return {"ok": True, "changed": 0}

    # Only one item decides clearance. Making this one decisive stands the
    # previous one down rather than refusing, because "this is the decisive
    # one now" is what the person meant.
    if data.get("is_decisive"):
        db.execute(text("""
            UPDATE checklist_item SET is_decisive = FALSE, updated_at = now()
             WHERE kind = :k AND checklist_item_id <> :i
               AND COALESCE(asset_type_id, 0)
                   = COALESCE(CAST(:atid AS bigint), 0)
        """), {"k": current["kind"], "i": item_id,
               "atid": data.get("asset_type_id", current["asset_type_id"])})

    # Retiring the decisive item would leave nothing deciding clearance.
    if data.get("status") == "RETIRED" and current["is_decisive"]:
        raise HTTPException(
            400, "This is the item that decides whether somebody may work. "
                 "Make another one decisive first, then retire this one.")

    sets = ", ".join(f"{c} = :{c}" for c in data)
    db.execute(text(
        f"UPDATE checklist_item SET {sets}, updated_at = now(), updated_by = :by "
        f"WHERE checklist_item_id = :i"),
        {**data, "i": item_id, "by": _actor(request)})
    db.commit()
    return {"ok": True, "changed": len(data)}


@router.delete("/{item_id}")
def retire_item(item_id: int, request: Request,
                db: Session = Depends(get_minehub_db)) -> dict:
    """Take it off the form.

    An item nobody has answered is removed outright; one with answers against
    it is retired, because deleting it would take its history with it.
    """
    row = db.execute(text(
        "SELECT kind, code, is_decisive FROM checklist_item WHERE checklist_item_id = :i"),
        {"i": item_id}).mappings().first()
    if not row:
        raise HTTPException(404, "That item is not on the list.")
    _require(request, row["kind"])
    if row["is_decisive"]:
        raise HTTPException(
            400, "This is the item that decides whether somebody may work. "
                 "Make another one decisive first.")

    answers = db.execute(text(
        "SELECT count(*) FROM operator_competency WHERE dimension = :c"),
        {"c": row["code"]}).scalar() if row["kind"] == "COMPETENCY" else 0

    if answers:
        db.execute(text(
            "UPDATE checklist_item SET status = 'RETIRED', updated_at = now(), "
            "updated_by = :by WHERE checklist_item_id = :i"),
            {"i": item_id, "by": _actor(request)})
        db.commit()
        return {"ok": True, "retired": True, "answers": answers}

    db.execute(text("DELETE FROM checklist_item WHERE checklist_item_id = :i"),
               {"i": item_id})
    db.commit()
    return {"ok": True, "retired": False, "answers": 0}
