"""Notes on things — the sentence that does not fit in a field.

Every other screen records facts. This records what a person would say about
them: that the hydraulics have been slow since the monsoon, that the PO is
being renegotiated so nobody should chase the expiry, that Sahoo asked for the
14th and was told to raise it properly.

That sentence currently lives in WhatsApp, which is the difference between a
register and a record. A note nobody can find is a note nobody wrote.

ROUTES ARE PREFIXED /thread DELIBERATELY. A bare /{entity_type}/{entity_id}
would have swallowed /meta/counts and /{comment_id}/resolve — FastAPI matches in
order and a path parameter that fails validation is a 422, not a fall-through to
the next route. The prefix costs six characters and removes the whole class of
problem.

ONE ENDPOINT FOR EVERYTHING. A note on a machine and a note on a leave request
are the same object, so they are one table and one set of routes, addressed by
a pair: what kind of thing, and which one. Adding notes to a new screen is a
component and no backend work at all.

WHAT IT DELIBERATELY IS NOT. Not a chat — there is one level of reply and no
more, because every product that allowed deeper nesting regrets it. Not a task
list — a note can be marked resolved, which is enough to close the ones that
asked for something, and anything heavier belongs in the exception queue that
already exists. And not anonymous: every note carries a name and a time, and an
edited one says so, because a note that can change silently is one nobody can
rely on having read.
"""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import people

router = APIRouter(prefix="/api/comments", tags=["Notes"])

WRITE = "platform.comment.write"
MODERATE = "platform.comment.moderate"

# What can be talked about. Mirrors the check constraint — the database is the
# authority, and this list exists so a typo in a URL is a clear 400 rather than
# an integrity error the user has to interpret.
ENTITIES = {
    "ASSET": ("asset", "asset_id", "COALESCE(fleet_code, asset_ref, 'machine')"),
    "OPERATOR": ("operator o JOIN party p ON p.party_id = o.party_id",
                 "o.operator_id", "p.display_name"),
    "SHIFT": ("shift_instance si JOIN shift_calendar sc ON sc.shift_id = si.shift_id",
              "si.shift_instance_id", "sc.code || ' shift, ' || si.production_day"),
    "DEPLOYMENT": ("deployment", "deployment_id", "COALESCE(deployment_ref, 'deployment')"),
    "HOTO": ("hoto", "hoto_id", "COALESCE(hoto_ref, 'handover')"),
    "LEAVE": ("leave_request", "leave_request_id", "COALESCE(leave_ref, 'leave')"),
    "EXCEPTION": ("ops_exception", "ops_exception_id", "kind"),
    "PATTERN": ("roster_pattern", "pattern_id", "code"),
    "PLANT": ("plant", "plant_id", "name"),
}

# @3101 in the body is a mention. Employee ids rather than names, because a name
# is not an identity and "tell Sahoo" has never reached anybody.
MENTION = re.compile(r"@([A-Za-z0-9_.-]{2,32})")


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _perms(request: Request) -> set:
    return getattr(request.state, "permissions", None) or set()


def _require(request: Request, permission: str, what: str) -> None:
    if permission not in _perms(request):
        raise HTTPException(403, f"You do not have permission to {what}. "
                                 "An Access Manager can add it to your role.")


def _kind(entity_type: str) -> str:
    kind = (entity_type or "").upper()
    if kind not in ENTITIES:
        raise HTTPException(400, f"Notes cannot be attached to '{entity_type}'. "
                                 f"Try one of: {', '.join(sorted(ENTITIES))}.")
    return kind


def _decorate(rows: list[dict], corp: Session) -> list[dict]:
    """Put names on the employee ids, in one lookup rather than one per row."""
    ids = {r["author_emp_id"] for r in rows if r.get("author_emp_id")}
    ids |= {m for r in rows for m in (r.get("mentions") or [])}
    ids |= {r["resolved_by"] for r in rows if r.get("resolved_by")}
    names = people.names_for(corp, sorted(ids)) if ids else {}
    for r in rows:
        r["author_name"] = names.get(r["author_emp_id"]) or r["author_emp_id"]
        r["resolved_by_name"] = names.get(r.get("resolved_by") or "")
        r["mention_names"] = {m: names.get(m) or m for m in (r.get("mentions") or [])}
    return rows


# ── one thread ───────────────────────────────────────────────────────────────
@router.get("/thread/{entity_type}/{entity_id}")
def thread(entity_type: str, entity_id: int, request: Request,
           include_resolved: bool = Query(True),
           db: Session = Depends(get_minehub_db),
           corp: Session = Depends(get_db)) -> dict:
    """Everything said about one thing.

    Reading is not gated: anybody who can see the machine can see what was said
    about it. A register people can read but not read the notes on is one where
    the notes go somewhere else.
    """
    kind = _kind(entity_type)
    rows = [dict(r) for r in db.execute(text(f"""
        SELECT comment_id, parent_id, body, mentions, is_resolved, resolved_by,
               resolved_at, is_pinned, author_emp_id, created_at, edited_at
        FROM comment
        WHERE entity_type = :t AND entity_id = :id AND deleted_at IS NULL
          {"" if include_resolved else "AND is_resolved = FALSE"}
        ORDER BY is_pinned DESC, created_at
    """), {"t": kind, "id": entity_id}).mappings()]
    _decorate(rows, corp)

    # Replies hang off their parent rather than being sorted into the same flat
    # list, because a thread read flat is a thread nobody follows.
    by_parent: dict[int, list[dict]] = {}
    for row in rows:
        if row["parent_id"]:
            by_parent.setdefault(row["parent_id"], []).append(row)
    top = [{**r, "replies": by_parent.get(r["comment_id"], [])}
           for r in rows if not r["parent_id"]]

    me = _actor(request)
    db.execute(text("""
        INSERT INTO comment_read (entity_type, entity_id, emp_id, last_read_at)
        VALUES (:t, :id, :me, now())
        ON CONFLICT (entity_type, entity_id, emp_id)
        DO UPDATE SET last_read_at = now()
    """), {"t": kind, "id": entity_id, "me": me})
    db.commit()

    return {
        "entity_type": kind, "entity_id": entity_id,
        "comments": top,
        "total": len(rows),
        "open": len([r for r in top if not r["is_resolved"]]),
        "may_write": WRITE in _perms(request),
        "may_moderate": MODERATE in _perms(request),
        "me": me,
    }


@router.post("/thread/{entity_type}/{entity_id}")
def add(entity_type: str, entity_id: int, request: Request, body: dict = Body(...),
        db: Session = Depends(get_minehub_db),
        corp: Session = Depends(get_db)) -> dict:
    """Say something. A reply carries parent_id; anything else starts a thread."""
    _require(request, WRITE, "write notes")
    kind = _kind(entity_type)

    said = (body.get("body") or "").strip()
    if not said:
        raise HTTPException(400, "There is nothing to save.")
    if len(said) > 8000:
        raise HTTPException(400, "That note is longer than 8,000 characters.")

    parent_id = body.get("parent_id")
    if parent_id:
        parent = db.execute(text("""
            SELECT parent_id FROM comment
            WHERE comment_id = :id AND entity_type = :t AND entity_id = :e
              AND deleted_at IS NULL
        """), {"id": parent_id, "t": kind, "e": entity_id}).first()
        if not parent:
            raise HTTPException(404, "The note being replied to is no longer there.")
        # One level. A reply to a reply joins the same thread rather than
        # starting a deeper one.
        parent_id = parent[0] or parent_id

    # Mentions come from the body itself as well as from anything the screen
    # passed, so typing @3101 works whether or not a picker was used.
    mentions = sorted({*MENTION.findall(said),
                       *[str(m) for m in (body.get("mentions") or [])]})

    row = db.execute(text("""
        INSERT INTO comment (entity_type, entity_id, parent_id, body, mentions,
                             author_emp_id)
        VALUES (:t, :e, :p, :b, :m, :by)
        RETURNING comment_id, parent_id, body, mentions, is_resolved, resolved_by,
                  resolved_at, is_pinned, author_emp_id, created_at, edited_at
    """), {"t": kind, "e": entity_id, "p": parent_id, "b": said,
           "m": mentions, "by": _actor(request)}).mappings().first()

    db.execute(text("""
        INSERT INTO event (event_type, occurred_at, recorded_at, source, payload, recorded_by)
        VALUES ('NOTE_ADDED', now(), now(), 'WEB', CAST(:pl AS jsonb), :by)
    """), {"pl": json.dumps({"entity_type": kind, "entity_id": entity_id,
                             "comment_id": row["comment_id"],
                             "mentions": mentions}), "by": _actor(request)})
    db.commit()
    return _decorate([dict(row)], corp)[0]


@router.patch("/{comment_id}")
def edit(comment_id: int, request: Request, body: dict = Body(...),
         db: Session = Depends(get_minehub_db),
         corp: Session = Depends(get_db)) -> dict:
    """Change what you said. Only your own, and it will say it was edited."""
    _require(request, WRITE, "write notes")
    said = (body.get("body") or "").strip()
    if not said:
        raise HTTPException(400, "There is nothing to save.")

    owner = db.execute(text(
        "SELECT author_emp_id FROM comment WHERE comment_id = :id AND deleted_at IS NULL"
    ), {"id": comment_id}).scalar()
    if not owner:
        raise HTTPException(404, "That note is no longer there.")
    if owner != _actor(request):
        raise HTTPException(403, "You can only edit your own notes.")

    row = db.execute(text("""
        UPDATE comment SET body = :b, mentions = :m, edited_at = now()
        WHERE comment_id = :id
        RETURNING comment_id, parent_id, body, mentions, is_resolved, resolved_by,
                  resolved_at, is_pinned, author_emp_id, created_at, edited_at
    """), {"b": said, "m": sorted(set(MENTION.findall(said))),
           "id": comment_id}).mappings().first()
    db.commit()
    return _decorate([dict(row)], corp)[0]


@router.delete("/{comment_id}")
def remove(comment_id: int, request: Request,
           db: Session = Depends(get_minehub_db)) -> dict:
    """Take a note down.

    Soft, and the row stays. A thread that silently loses a message is one where
    the remaining messages stop making sense, and somebody will eventually need
    to know that something was said and withdrawn.
    """
    _require(request, WRITE, "write notes")
    owner = db.execute(text(
        "SELECT author_emp_id FROM comment WHERE comment_id = :id AND deleted_at IS NULL"
    ), {"id": comment_id}).scalar()
    if not owner:
        raise HTTPException(404, "That note is no longer there.")
    if owner != _actor(request) and MODERATE not in _perms(request):
        raise HTTPException(403, "You can only delete your own notes.")

    db.execute(text("""
        UPDATE comment SET deleted_at = now(), deleted_by = :by WHERE comment_id = :id
    """), {"by": _actor(request), "id": comment_id})
    db.commit()
    return {"ok": True}


@router.post("/{comment_id}/resolve")
def resolve(comment_id: int, request: Request, body: dict = Body(default={}),
            db: Session = Depends(get_minehub_db)) -> dict:
    """Close a note that asked for something, or reopen it."""
    _require(request, WRITE, "write notes")
    wanted = body.get("resolved")
    row = db.execute(text("""
        UPDATE comment
           SET is_resolved = COALESCE(CAST(:want AS boolean), NOT is_resolved),
               resolved_by = CASE WHEN COALESCE(CAST(:want AS boolean), NOT is_resolved)
                                  THEN :by END,
               resolved_at = CASE WHEN COALESCE(CAST(:want AS boolean), NOT is_resolved)
                                  THEN now() END
         WHERE comment_id = :id AND deleted_at IS NULL
        RETURNING comment_id, is_resolved, resolved_by, resolved_at
    """), {"want": wanted, "by": _actor(request), "id": comment_id}).mappings().first()
    if not row:
        raise HTTPException(404, "That note is no longer there.")
    db.commit()
    return dict(row)


@router.post("/{comment_id}/pin")
def pin(comment_id: int, request: Request, body: dict = Body(default={}),
        db: Session = Depends(get_minehub_db)) -> dict:
    """Hold one note at the top of its thread.

    For the sentence somebody arriving at this machine should read before
    anything else.
    """
    _require(request, WRITE, "write notes")
    row = db.execute(text("""
        UPDATE comment SET is_pinned = COALESCE(CAST(:want AS boolean), NOT is_pinned)
        WHERE comment_id = :id AND deleted_at IS NULL AND parent_id IS NULL
        RETURNING comment_id, is_pinned
    """), {"want": body.get("pinned"), "id": comment_id}).mappings().first()
    if not row:
        raise HTTPException(404, "That note is no longer there, or it is a reply.")
    db.commit()
    return dict(row)


# ── across everything ────────────────────────────────────────────────────────
def _label(db: Session, rows: list[dict]) -> list[dict]:
    """Say what each note is attached to, in one query per kind of thing.

    entity_id is not a foreign key — the price of one table for every kind of
    note — so the label has to be looked up per type. Grouped so a feed of fifty
    notes across five kinds costs five queries, not fifty.
    """
    by_kind: dict[str, set] = {}
    for r in rows:
        by_kind.setdefault(r["entity_type"], set()).add(r["entity_id"])

    labels: dict[tuple[str, int], str] = {}
    for kind, ids in by_kind.items():
        source, key, name = ENTITIES[kind]
        try:
            for row in db.execute(text(
                f"SELECT {key} AS id, {name} AS label FROM {source} "
                f"WHERE {key} = ANY(:ids)"
            ), {"ids": list(ids)}).mappings():
                labels[(kind, row["id"])] = row["label"]
        except Exception:                             # noqa: BLE001
            db.rollback()                             # a label is not worth a 500

    for r in rows:
        r["entity_label"] = labels.get((r["entity_type"], r["entity_id"]))
    return rows


@router.get("")
def feed(request: Request,
         entity_type: str | None = Query(None),
         mine: bool = Query(False),
         unresolved: bool = Query(False),
         days: int = Query(30, ge=1, le=365),
         limit: int = Query(100, ge=1, le=300),
         db: Session = Depends(get_minehub_db),
         corp: Session = Depends(get_db)) -> dict:
    """Everything said lately, across the whole platform.

    This is the screen people actually open: not "notes on machine EX-04" but
    "what has anybody said this week". Filters narrow it to one kind of thing,
    to notes addressed to you, or to the ones still open.
    """
    me = _actor(request)
    rows = [dict(r) for r in db.execute(text("""
        SELECT comment_id, entity_type, entity_id, parent_id, body, mentions,
               is_resolved, resolved_by, resolved_at, is_pinned,
               author_emp_id, created_at, edited_at
        FROM comment
        WHERE deleted_at IS NULL
          AND created_at >= now() - make_interval(days => :days)
          AND (CAST(:kind AS text) IS NULL OR entity_type = CAST(:kind AS text))
          AND (NOT :mine OR :me = ANY(mentions) OR author_emp_id = :me)
          AND (NOT :unresolved OR (is_resolved = FALSE AND parent_id IS NULL))
        ORDER BY created_at DESC
        LIMIT :limit
    """), {"days": days, "kind": entity_type.upper() if entity_type else None,
           "mine": mine, "unresolved": unresolved, "me": me,
           "limit": limit}).mappings()]

    _decorate(rows, corp)
    _label(db, rows)

    counts = db.execute(text("""
        SELECT
          count(*) FILTER (WHERE :me = ANY(mentions))                     AS mentioning_me,
          count(*) FILTER (WHERE is_resolved = FALSE AND parent_id IS NULL) AS open,
          count(*)                                                        AS total
        FROM comment
        WHERE deleted_at IS NULL AND created_at >= now() - make_interval(days => :days)
    """), {"me": me, "days": days}).mappings().first()

    return {"comments": rows, "days": days, "me": me,
            "may_write": WRITE in _perms(request),
            "summary": dict(counts)}


@router.get("/meta/counts")
def counts(request: Request, entity_type: str = Query(...),
           ids: str = Query(""),
           db: Session = Depends(get_minehub_db)) -> dict:
    """How many notes each of these things has, and whether any are new to me.

    For the little badge on a row. One call for a whole list rather than one per
    row, which is the difference between a badge and a slow page.
    """
    kind = _kind(entity_type)
    wanted = [int(i) for i in ids.split(",") if i.strip().isdigit()]
    if not wanted:
        return {}

    rows = db.execute(text("""
        SELECT c.entity_id,
               count(*)                                                      AS total,
               count(*) FILTER (WHERE c.is_resolved = FALSE
                                  AND c.parent_id IS NULL)                   AS open,
               count(*) FILTER (WHERE r.last_read_at IS NULL
                                   OR c.created_at > r.last_read_at)         AS unread
        FROM comment c
        LEFT JOIN comment_read r
               ON r.entity_type = c.entity_type AND r.entity_id = c.entity_id
              AND r.emp_id = :me
        WHERE c.entity_type = :t AND c.entity_id = ANY(:ids) AND c.deleted_at IS NULL
        GROUP BY c.entity_id
    """), {"t": kind, "ids": wanted, "me": _actor(request)}).mappings()
    return {str(r["entity_id"]): {"total": r["total"], "open": r["open"],
                                  "unread": r["unread"]} for r in rows}


@router.get("/meta/people")
def mentionable(request: Request, q: str = Query(""),
                db: Session = Depends(get_minehub_db),
                corp: Session = Depends(get_db)) -> list[dict]:
    """Who can be mentioned — everybody with access to the platform.

    Mentioning somebody who cannot open the page would be a message into a void,
    so the list is exactly the people who could act on it.
    """
    emp_ids = [r[0] for r in db.execute(text("""
        SELECT DISTINCT emp_id FROM user_access
        WHERE valid_to IS NULL OR valid_to >= CURRENT_DATE
    """)).all()]
    names = people.names_for(corp, emp_ids)
    term = q.strip().lower()
    out = [{"emp_id": e, "name": names.get(e) or e} for e in emp_ids]
    if term:
        out = [p for p in out
               if term in p["emp_id"].lower() or term in p["name"].lower()]
    return sorted(out, key=lambda p: p["name"])[:50]
