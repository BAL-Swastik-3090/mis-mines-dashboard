"""Access administration — users, roles and permissions.

Roles are data. Creating one is a row, not a deployment, so access policy can
change at the speed the organisation actually changes it.

Two rules protect the bootstrap path and are enforced here rather than trusted
to the UI:

  * You cannot grant a permission you do not hold. Otherwise an Access Manager
    could mint a role carrying platform settings and assign it to themselves,
    which is privilege escalation with extra steps.
  * System roles cannot be renamed or deleted. Deleting the role that grants
    access management would leave nobody able to restore it.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import access as access_svc
from app.services.auth import EMP_TBL

router = APIRouter(prefix="/api/access", tags=["Access"])


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _describe_permission_change(before: list[str], after: list[str]) -> str:
    """A readable summary, so the trail can be understood without reading JSON."""
    added = [c for c in after if c not in before]
    removed = [c for c in before if c not in after]
    parts = []
    if added:
        parts.append(f"added {', '.join(added)}")
    if removed:
        parts.append(f"removed {', '.join(removed)}")
    return "; ".join(parts) or "no change"


def _audit(pg, request: Request, action: str, *, subject_emp_id: str | None = None,
           role_id: int | None = None, role_name: str | None = None,
           before: dict | None = None, after: dict | None = None,
           detail: str | None = None) -> None:
    """Record an access change. Called inside the caller's transaction, so the
    trail and the change commit together — an audited action that did not happen,
    or a change with no trail, would both be worse than either alone."""
    pg.execute(text("""
        INSERT INTO access_audit (actor_emp_id, action, subject_emp_id, role_id, role_name,
                                  before_state, after_state, detail, ip_address)
        VALUES (:actor, :action, :subj, :rid, :rname,
                CAST(:before AS jsonb), CAST(:after AS jsonb), :detail, :ip)
    """), {
        "actor": _actor(request), "action": action, "subj": subject_emp_id,
        "rid": role_id, "rname": role_name,
        "before": json.dumps(before) if before is not None else None,
        "after": json.dumps(after) if after is not None else None,
        "detail": detail,
        "ip": (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or None,
    })


def _require(db, request: Request, code: str) -> None:
    if not access_svc.has_permission(db, _actor(request), code):
        raise HTTPException(403, f"This needs the '{code}' permission.")


# ------------------------------------------------------------------ catalogue
@router.get("/permissions")
def list_permissions(pg: Session = Depends(get_minehub_db)) -> list[dict]:
    rows = pg.execute(text("""
        SELECT permission_id, code, module, name, description, is_sensitive, sort_order
        FROM permission ORDER BY sort_order, code
    """)).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------- roles
@router.get("/roles")
def list_roles(pg: Session = Depends(get_minehub_db)) -> list[dict]:
    rows = pg.execute(text("""
        SELECT r.role_id, r.code, r.name, r.description, r.is_system, r.status,
               (SELECT count(*) FROM user_access ua
                 WHERE ua.role_id = r.role_id AND ua.valid_to IS NULL) AS user_count,
               COALESCE((SELECT array_agg(p.code ORDER BY p.sort_order)
                           FROM role_permission rp
                           JOIN permission p ON p.permission_id = rp.permission_id
                          WHERE rp.role_id = r.role_id), ARRAY[]::text[]) AS permissions
        FROM role r
        ORDER BY r.is_system DESC, r.name
    """)).mappings().all()
    return [dict(r) for r in rows]


@router.post("/roles")
def create_role(request: Request, body: dict = Body(...),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, "access.roles.manage")

    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "A role name is required.")
    code = (body.get("code") or name).strip().upper().replace(" ", "_")
    code = "".join(ch for ch in code if ch.isalnum() or ch == "_")
    if not code:
        raise HTTPException(400, "The role name must contain letters or numbers.")

    if pg.execute(text("SELECT 1 FROM role WHERE code = :c"), {"c": code}).first():
        raise HTTPException(409, f"A role with the code '{code}' already exists.")

    wanted = [str(c) for c in (body.get("permissions") or [])]
    mine = access_svc.permissions_for(db, _actor(request))
    # Escalation guard: you cannot put a permission into a role that you do not
    # hold yourself, or you could grant yourself anything in two steps.
    over = [c for c in wanted if c not in mine]
    if over:
        raise HTTPException(
            403, f"You cannot give a role permissions you do not hold: {', '.join(over)}")

    role_id = pg.execute(text("""
        INSERT INTO role (code, name, description, is_system, created_by)
        VALUES (:c, :n, :d, false, :by) RETURNING role_id
    """), {"c": code, "n": name, "d": body.get("description") or None,
           "by": _actor(request)}).scalar()

    if wanted:
        pg.execute(text("""
            INSERT INTO role_permission (role_id, permission_id, granted_by)
            SELECT :r, permission_id, :by FROM permission WHERE code = ANY(:codes)
        """), {"r": role_id, "by": _actor(request), "codes": wanted})
    _audit(pg, request, "ROLE_CREATED", role_id=role_id, role_name=name,
           after={"code": code, "name": name, "permissions": wanted},
           detail=f"Created role '{name}' with {len(wanted)} permission(s)")
    pg.commit()
    access_svc.invalidate()
    return {"ok": True, "role_id": role_id, "code": code}


@router.put("/roles/{role_id}")
def update_role(role_id: int, request: Request, body: dict = Body(...),
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, "access.roles.manage")

    row = pg.execute(text("""
        SELECT r.code, r.is_system, r.name,
               COALESCE((SELECT array_agg(p.code) FROM role_permission rp
                           JOIN permission p ON p.permission_id = rp.permission_id
                          WHERE rp.role_id = r.role_id), ARRAY[]::text[])
        FROM role r WHERE r.role_id = :r
    """), {"r": role_id}).first()
    if not row:
        raise HTTPException(404, "Role not found.")
    code, is_system, role_name, before_perms = row

    if "name" in body or "description" in body:
        if is_system and "name" in body:
            raise HTTPException(400, "A system role cannot be renamed.")
        pg.execute(text("""
            UPDATE role SET name = COALESCE(:n, name), description = COALESCE(:d, description)
            WHERE role_id = :r
        """), {"n": body.get("name"), "d": body.get("description"), "r": role_id})

    if "permissions" in body:
        if code == access_svc.PLATFORM_OWNER:
            raise HTTPException(
                400, "The Platform Owner holds every permission by definition and "
                     "cannot have them edited.")
        wanted = [str(c) for c in (body.get("permissions") or [])]
        mine = access_svc.permissions_for(db, _actor(request))
        over = [c for c in wanted if c not in mine]
        if over:
            raise HTTPException(
                403, f"You cannot give a role permissions you do not hold: {', '.join(over)}")

        pg.execute(text("DELETE FROM role_permission WHERE role_id = :r"), {"r": role_id})
        if wanted:
            pg.execute(text("""
                INSERT INTO role_permission (role_id, permission_id, granted_by)
                SELECT :r, permission_id, :by FROM permission WHERE code = ANY(:codes)
            """), {"r": role_id, "by": _actor(request), "codes": wanted})

        _audit(pg, request, "ROLE_PERMISSIONS_SET", role_id=role_id, role_name=role_name,
               before={"permissions": sorted(before_perms)},
               after={"permissions": sorted(wanted)},
               detail=_describe_permission_change(sorted(before_perms), sorted(wanted)))

    pg.commit()
    access_svc.invalidate()
    return {"ok": True, "role_id": role_id}


@router.delete("/roles/{role_id}")
def delete_role(role_id: int, request: Request,
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    _require(db, request, "access.roles.manage")

    row = pg.execute(text("""
        SELECT r.code, r.is_system,
               (SELECT count(*) FROM user_access ua
                 WHERE ua.role_id = r.role_id AND ua.valid_to IS NULL)
        FROM role r WHERE r.role_id = :r
    """), {"r": role_id}).first()
    if not row:
        raise HTTPException(404, "Role not found.")
    _code, is_system, holders = row

    if is_system:
        raise HTTPException(400, "A system role cannot be deleted.")
    if holders:
        raise HTTPException(
            400, f"{holders} {'person holds' if holders == 1 else 'people hold'} this role. "
                 "Move them to another role first.")

    name = pg.execute(text("SELECT name FROM role WHERE role_id = :r"),
                      {"r": role_id}).scalar()
    pg.execute(text("DELETE FROM role WHERE role_id = :r"), {"r": role_id})
    _audit(pg, request, "ROLE_DELETED", role_id=role_id, role_name=name,
           before={"name": name}, detail=f"Deleted role '{name}'")
    pg.commit()
    access_svc.invalidate()
    return {"ok": True}


# ---------------------------------------------------------------------- users
@router.get("/users")
def list_users(db: Session = Depends(get_db),
               pg: Session = Depends(get_minehub_db)) -> list[dict]:
    rows = pg.execute(text("""
        SELECT ua.emp_id, ua.granted_by, ua.created_at,
               r.role_id, r.code AS role_code, r.name AS role_name
        FROM user_access ua
        JOIN role r ON r.role_id = ua.role_id
        WHERE ua.valid_to IS NULL
        ORDER BY ua.emp_id
    """)).mappings().all()

    by_emp: dict[str, dict] = {}
    for r in rows:
        u = by_emp.setdefault(r["emp_id"], {
            "emp_id": r["emp_id"], "granted_by": r["granted_by"],
            "created_at": r["created_at"], "roles": [],
        })
        u["roles"].append({"role_id": r["role_id"], "code": r["role_code"],
                           "name": r["role_name"]})

    # Names come from the HR master in MySQL; the platform holds identity, not a
    # copy of the employee record.
    if by_emp:
        # expanding=True is required for IN with a list — without it the driver
        # is handed a tuple it cannot convert and the whole screen fails.
        stmt = text(
            f"SELECT EMPID, EMPNAME, EMPDEPT, EMPDESG FROM {EMP_TBL} WHERE EMPID IN :ids"
        ).bindparams(bindparam("ids", expanding=True))
        hr = db.execute(stmt, {"ids": list(by_emp.keys())}).mappings().all()
        for h in hr:
            if h["EMPID"] in by_emp:
                by_emp[h["EMPID"]].update({
                    "name": h["EMPNAME"], "department": h["EMPDEPT"],
                    "designation": h["EMPDESG"],
                })
    return sorted(by_emp.values(), key=lambda u: (u.get("name") or u["emp_id"]))


@router.put("/users/{emp_id}/roles")
def set_user_roles(emp_id: str, request: Request, body: dict = Body(...),
                   db: Session = Depends(get_db),
                   pg: Session = Depends(get_minehub_db)) -> dict:
    """Replace the set of roles a person holds."""
    _require(db, request, "access.users.manage")

    role_ids = [int(r) for r in (body.get("role_ids") or [])]
    actor = _actor(request)
    mine = access_svc.permissions_for(db, actor)

    if role_ids:
        rows = pg.execute(text("""
            SELECT r.role_id, r.name,
                   COALESCE((SELECT array_agg(p.code) FROM role_permission rp
                               JOIN permission p ON p.permission_id = rp.permission_id
                              WHERE rp.role_id = r.role_id), ARRAY[]::text[]) AS perms
            FROM role r WHERE r.role_id = ANY(:ids)
        """), {"ids": role_ids}).mappings().all()
        if len(rows) != len(set(role_ids)):
            raise HTTPException(400, "One of those roles does not exist.")
        # You cannot hand out more than you hold, by any route.
        for r in rows:
            over = [c for c in r["perms"] if c not in mine]
            if over:
                raise HTTPException(
                    403, f"You cannot grant '{r['name']}' — it carries permissions "
                         f"you do not hold: {', '.join(over)}")

    if emp_id == actor and not role_ids:
        raise HTTPException(400, "You cannot remove your own access.")

    before = [r[0] for r in pg.execute(text("""
        SELECT r.name FROM user_access ua JOIN role r ON r.role_id = ua.role_id
        WHERE ua.emp_id = :e ORDER BY r.name
    """), {"e": emp_id}).all()]

    pg.execute(text("DELETE FROM user_access WHERE emp_id = :e"), {"e": emp_id})
    for rid in role_ids:
        pg.execute(text("""
            INSERT INTO user_access (emp_id, role_id, granted_by)
            VALUES (:e, :r, :by) ON CONFLICT (emp_id, role_id) DO NOTHING
        """), {"e": emp_id, "r": rid, "by": actor})

    after = [r[0] for r in pg.execute(text("""
        SELECT r.name FROM user_access ua JOIN role r ON r.role_id = ua.role_id
        WHERE ua.emp_id = :e ORDER BY r.name
    """), {"e": emp_id}).all()]

    _audit(pg, request, "USER_ROLES_SET", subject_emp_id=emp_id,
           before={"roles": before}, after={"roles": after},
           detail=(f"{', '.join(before) or 'no access'} → {', '.join(after) or 'no access'}"))

    pg.commit()
    access_svc.invalidate()
    return {"ok": True, "emp_id": emp_id, "roles": len(role_ids)}


@router.delete("/users/{emp_id}")
def revoke_user(emp_id: str, request: Request,
                db: Session = Depends(get_db),
                pg: Session = Depends(get_minehub_db)) -> dict:
    """Remove access entirely. Not a demotion — this person can no longer sign in."""
    _require(db, request, "access.users.manage")
    if emp_id == _actor(request):
        raise HTTPException(400, "You cannot remove your own access.")

    before = [r[0] for r in pg.execute(text("""
        SELECT r.name FROM user_access ua JOIN role r ON r.role_id = ua.role_id
        WHERE ua.emp_id = :e ORDER BY r.name
    """), {"e": emp_id}).all()]

    pg.execute(text("DELETE FROM user_access WHERE emp_id = :e"), {"e": emp_id})
    _audit(pg, request, "USER_REVOKED", subject_emp_id=emp_id,
           before={"roles": before}, after={"roles": []},
           detail=f"Access removed — held {', '.join(before) or 'nothing'}")
    pg.commit()
    access_svc.invalidate()
    return {"ok": True}


@router.get("/employees")
def search_employees(q: str = Query(""), db: Session = Depends(get_db)) -> list[dict]:
    """Employee lookup for the add-user picker."""
    term = (q or "").strip()
    if len(term) < 2:
        return []
    rows = db.execute(text(
        f"""SELECT EMPID AS emp_id, EMPNAME AS name, EMPDEPT AS department,
                   EMPDESG AS designation
            FROM {EMP_TBL}
            WHERE (EMPID LIKE :like OR EMPNAME LIKE :like)
              AND (STATUS IS NULL OR STATUS <> 'Withdrawn')
            ORDER BY EMPNAME LIMIT 25"""), {"like": f"%{term}%"}).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------- audit
@router.get("/audit")
def access_audit(limit: int = Query(100, le=500),
                 emp_id: str = Query(""),
                 db: Session = Depends(get_db),
                 pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """Every access change, newest first. Optionally for one person."""
    where, params = ["1=1"], {"lim": limit}
    if emp_id.strip():
        where.append("(subject_emp_id = :e OR actor_emp_id = :e)")
        params["e"] = emp_id.strip()

    rows = pg.execute(text(f"""
        SELECT access_audit_id, occurred_at, actor_emp_id, action,
               subject_emp_id, role_name, before_state, after_state, detail, ip_address
        FROM access_audit
        WHERE {' AND '.join(where)}
        ORDER BY occurred_at DESC
        LIMIT :lim
    """), params).mappings().all()
    out = [dict(r) for r in rows]

    # Names come from the HR master; the trail stores identifiers only.
    ids = {r["actor_emp_id"] for r in out if r["actor_emp_id"]} |           {r["subject_emp_id"] for r in out if r["subject_emp_id"]}
    ids.discard("SYSTEM")
    names: dict[str, str] = {}
    if ids:
        stmt = text(f"SELECT EMPID, EMPNAME FROM {EMP_TBL} WHERE EMPID IN :ids")             .bindparams(bindparam("ids", expanding=True))
        names = {r[0]: r[1] for r in db.execute(stmt, {"ids": list(ids)}).all()}

    for r in out:
        r["actor_name"] = names.get(r["actor_emp_id"], r["actor_emp_id"])
        r["subject_name"] = names.get(r["subject_emp_id"], r["subject_emp_id"])
    return out
