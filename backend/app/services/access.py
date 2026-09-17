"""Authorization — roles and permissions, held in MineHub (PostgreSQL).

Permissions are the unit of access. A role is a bundle of permissions; a person
holds roles. Nothing in the code tests for a role by name except the two system
roles that bootstrap the platform, so creating a role is data entry rather than
a deployment.

AVAILABILITY

Login now depends on a second database. MySQL holds the session and the
credentials; this holds the answer to "what may they do". Two mitigations keep a
Postgres blip from locking the company out of an operational dashboard:

  1. The whole access map is cached in-process. One dashboard page load fires
     ~15 API calls, and each would otherwise be a round trip.
  2. If Postgres cannot be read, the last known good map is used however stale,
     and if there is none the legacy MySQL role table answers instead. Both are
     narrower failures than refusing everyone.

That ordering is deliberate: being briefly out of date is a smaller problem than
an outage, and a revocation is applied the moment the cache refreshes.
"""
from __future__ import annotations

import logging
import time

from sqlalchemy import text

logger = logging.getLogger(__name__)

CACHE_TTL = 60.0            # seconds
_cache: dict[str, set[str]] = {}
_cache_roles: dict[str, list[dict]] = {}
_cache_at: float = 0.0
_cache_ok: bool = False     # have we ever loaded successfully?

# The one role the code knows by name. It holds every permission including ones
# added after it was created, so a new permission never needs a migration to
# reach the people who administer the platform.
PLATFORM_OWNER = "PLATFORM_OWNER"

# Legacy fallback only — the mapping used if Postgres is unreachable and the
# cache is cold. Mirrors minehub/import_legacy_access.py.
_LEGACY_PERMISSIONS = {
    "superadmin": {"dashboard.mis", "dashboard.oee", "dashboard.intelligence",
                   "dashboard.fuel", "dashboard.ev", "access.users.view",
                   "access.users.manage", "access.roles.manage",
                   "platform.registry.view", "platform.registry.manage",
                   "platform.settings"},
    "admin": {"dashboard.mis", "dashboard.oee", "dashboard.intelligence",
              "dashboard.fuel", "dashboard.ev", "access.users.view",
              "access.users.manage", "access.roles.manage"},
    "manager": {"dashboard.mis", "dashboard.oee", "dashboard.intelligence",
                "dashboard.fuel", "dashboard.ev"},
    "viewer": {"dashboard.mis", "dashboard.oee", "dashboard.intelligence",
               "dashboard.fuel", "dashboard.ev"},
}


def invalidate() -> None:
    """Called after any access change so it applies at once, not after the TTL."""
    global _cache_at
    _cache_at = 0.0


def _load() -> tuple[dict[str, set[str]], dict[str, list[dict]]]:
    """Every person's permissions and roles, in one query pair."""
    from app.minehub_db import SessionLocal

    if SessionLocal is None:
        raise RuntimeError("MineHub database is not configured")

    perms: dict[str, set[str]] = {}
    roles: dict[str, list[dict]] = {}
    with SessionLocal() as db:
        # Every permission of every role a person holds. The Platform Owner is
        # unioned separately so it picks up permissions added later.
        rows = db.execute(text("""
            SELECT ua.emp_id, p.code
            FROM user_access ua
            JOIN role r            ON r.role_id = ua.role_id AND r.status = 'ACTIVE'
            JOIN role_permission rp ON rp.role_id = r.role_id
            JOIN permission p       ON p.permission_id = rp.permission_id
            WHERE ua.valid_to IS NULL
            UNION
            SELECT ua.emp_id, p.code
            FROM user_access ua
            JOIN role r ON r.role_id = ua.role_id AND r.code = :owner
            CROSS JOIN permission p
            WHERE ua.valid_to IS NULL
        """), {"owner": PLATFORM_OWNER}).all()
        for emp_id, code in rows:
            perms.setdefault(emp_id, set()).add(code)

        for emp_id, code, name in db.execute(text("""
            SELECT ua.emp_id, r.code, r.name
            FROM user_access ua
            JOIN role r ON r.role_id = ua.role_id AND r.status = 'ACTIVE'
            WHERE ua.valid_to IS NULL
            ORDER BY r.name
        """)).all():
            roles.setdefault(emp_id, []).append({"code": code, "name": name})

    return perms, roles


def _map() -> tuple[dict[str, set[str]], dict[str, list[dict]]]:
    global _cache, _cache_roles, _cache_at, _cache_ok
    now = time.monotonic()
    if _cache_ok and (now - _cache_at) < CACHE_TTL:
        return _cache, _cache_roles
    try:
        _cache, _cache_roles = _load()
        _cache_at, _cache_ok = now, True
    except Exception as exc:
        if _cache_ok:
            # Stale beats absent. Log once per attempt so the outage is visible.
            logger.warning("access map refresh failed, serving cached: %s", exc)
            _cache_at = now - (CACHE_TTL / 2)     # retry sooner than a full TTL
        else:
            logger.error("access map unavailable and cache is cold: %s", exc)
            raise
    return _cache, _cache_roles


def _legacy(db, emp_id: str) -> set[str]:
    """Last resort: derive permissions from the old MySQL role column."""
    try:
        role = db.execute(text(
            "SELECT role FROM mines_user_role WHERE emp_id = :e"), {"e": emp_id}).scalar()
    except Exception:
        return set()
    return set(_LEGACY_PERMISSIONS.get(role, set()))


def peek_permissions(emp_id: str) -> set[str] | None:
    """Permissions from cache only. None means 'not cached', not 'none held'."""
    if not _cache_ok or (time.monotonic() - _cache_at) >= CACHE_TTL:
        return None
    return _cache.get(emp_id, set())


def permissions_for(db, emp_id: str) -> set[str]:
    """Everything this person may do. Empty set means no access at all."""
    try:
        perms, _ = _map()
        return perms.get(emp_id, set())
    except Exception:
        return _legacy(db, emp_id)


def roles_for(db, emp_id: str) -> list[dict]:
    try:
        _, roles = _map()
        return roles.get(emp_id, [])
    except Exception:
        try:
            role = db.execute(text(
                "SELECT role FROM mines_user_role WHERE emp_id = :e"), {"e": emp_id}).scalar()
        except Exception:
            return []
        return [{"code": role, "name": role}] if role else []


def has_permission(db, emp_id: str, code: str) -> bool:
    return code in permissions_for(db, emp_id)


def has_access(db, emp_id: str) -> bool:
    """Whether this person may sign in at all — the invite-only gate."""
    return bool(permissions_for(db, emp_id))


def is_platform_owner(db, emp_id: str) -> bool:
    return any(r["code"] == PLATFORM_OWNER for r in roles_for(db, emp_id))
