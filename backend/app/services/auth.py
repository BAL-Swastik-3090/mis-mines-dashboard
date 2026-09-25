"""Authentication, session tracking and access control against the intranet tables.

Single sign-on with the existing intranet credentials — the same model the other
BAL apps use, so a Mines login shows up in the shared activity tables alongside
PEMS and the rest:

  * intranet_user_login          — EMPID + SHA-1(USER_PWD), STATUS='A' is active
  * sap_employee_details         — name / designation / department / email
  * digital_apps_user_sessions   — one row per Mines login (app_source='MINES')
  * digital_apps_page_views      — one row per page view
  * mines_user_role              — Mines access role per employee (this app only)

Passwords are never stored or logged here. We only compare the SHA-1 hash of what
the user typed against the hash already held in intranet_user_login.

Unlike PEMS — which keeps sessions in MySQL and its roles in a separate Postgres
database, and so has to open a second engine for every role check — this app's
primary database IS balcorpdb. Every table above lives on the connection the rest
of the dashboard already uses, so all of this runs on the existing pool. That
matters: the shared MySQL server is at its connection limit and refuses
connections daily, which is why database.py keeps the resting pool at two.
"""
from __future__ import annotations

import hashlib
import secrets
import time

from sqlalchemy import text
from sqlalchemy.orm import Session

LOGIN_TBL = "intranet_user_login"
EMP_TBL = "sap_employee_details"
SESS_TBL = "digital_apps_user_sessions"
VIEW_TBL = "digital_apps_page_views"
ROLE_TBL = "mines_user_role"
PAGE_TBL = "mines_role_page_access"

# Identifies our rows in the tables shared across the intranet apps. Every read of
# those tables filters on it, so Mines never sees another app's sessions.
APP_SOURCE = "MINES"

# A session expires after this many idle minutes. Kept short deliberately: the
# dashboard is opened on shared and control-room machines, where an unattended
# browser would otherwise stay signed in for the rest of the shift.
IDLE_MINUTES = 30


def _sha1(pw: str) -> str:
    return hashlib.sha1(pw.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ access roles
# Ranked, so a check is "at least this role" rather than a list of equals.
#   viewer      read the dashboards the page matrix allows
#   manager     reserved for elevated operational access
#   admin       manages roles and page access (Access Control)
#   superadmin  the above, plus the MineHub platform modules
ROLE_RANK = {"viewer": 1, "manager": 2, "admin": 3, "superadmin": 4}
DEFAULT_ROLE = "viewer"

# The role required to reach the MineHub platform itself - master data registry,
# migrations, platform administration. Deliberately above admin: admin
# administers who sees which dashboard, superadmin administers the platform.
PLATFORM_ROLE = "superadmin"


def _known_role(value: object) -> str | None:
    """A stored role name normalised to one this build knows, or None.

    Values are compared case-insensitively and trimmed: the column is free text
    on the MySQL side and a row written by hand is not guaranteed to match the
    exact spelling used here.
    """
    name = str(value).strip().lower() if value is not None else ""
    return name if name in ROLE_RANK else None


def mines_role(db: Session, emp_id: str) -> str:
    """The Mines access role for an employee, defaulting to 'viewer'.

    Anyone with valid intranet credentials is a viewer without needing a row in
    mines_user_role — the table only records elevated access.
    """
    try:
        r = db.execute(text(f"SELECT role FROM {ROLE_TBL} WHERE emp_id = :e"),
                       {"e": emp_id}).scalar()
    except Exception:
        # The role table not existing must not lock everyone out of the app.
        return DEFAULT_ROLE
    return _known_role(r) or DEFAULT_ROLE


def explicit_role(db: Session, emp_id: str) -> str | None:
    """The role explicitly granted to an employee, or None if they have none.

    This is what makes the dashboard invite-only. mines_role() cannot answer it:
    it reports 'viewer' for everybody, which is what previously let any employee
    with intranet credentials open the dashboard without being granted anything.

    Returns DEFAULT_ROLE rather than None if the table cannot be read. A database
    problem must not lock the whole company out of a dashboard used for daily
    operations — that failure mode is worse than the one this gate prevents.

    A row holding a role this build does not know is still a grant, and is
    answered with DEFAULT_ROLE rather than None. The two are not the same
    question: the gate asks whether the person was invited, not whether this
    build recognises the name of what they were given. Answering None locked out
    everyone whose role was added by a newer build than the one running — which
    is exactly what happened when 'superadmin' was granted while the server was
    still on a build that knew only viewer/manager/admin. An unknown name now
    costs privileges, not access.
    """
    try:
        r = db.execute(text(f"SELECT role FROM {ROLE_TBL} WHERE emp_id = :e"),
                       {"e": emp_id}).scalar()
    except Exception:
        return DEFAULT_ROLE
    if r is None or not str(r).strip():
        return None
    return _known_role(r) or DEFAULT_ROLE


def has_role(db: Session, emp_id: str, minimum: str) -> bool:
    """True if the employee's role is at least `minimum`."""
    return ROLE_RANK.get(mines_role(db, emp_id), 0) >= ROLE_RANK.get(minimum, 99)


# ------------------------------------------------------------------ page access
# The pages in the sidebar, and the API prefixes that feed each one. Access is
# enforced on these prefixes rather than by hiding the sidebar entry — hiding a
# menu item leaves the data reachable to anyone who knows the URL.
PAGES: tuple[str, ...] = ("mis", "oee", "intelligence", "fuel-management", "ev-tracking")

PAGE_LABELS = {
    "mis": "MIS Dashboard",
    "oee": "OEE / LCM",
    "intelligence": "Intelligence",
    "fuel-management": "Fuel Management",
    "ev-tracking": "Electric Vehicles Tracking",
}

# Longest prefixes first — /api/live-tracking must not be shadowed by a shorter
# entry, and the lookup takes the first match.
PREFIX_PAGE: tuple[tuple[str, str], ...] = (
    # Hand-entered previous-day actuals for the MIS Plan vs Actual table.
    # Mapped so it needs dashboard.mis: without an entry here an unmapped path
    # passes the page check entirely and would be reachable by any signed-in
    # user, including one with no MIS access at all.
    ("/api/prev-day-actual", "mis"),
    ("/api/fuel-management", "fuel-management"),
    ("/api/ev-tracking", "ev-tracking"),
    ("/api/live-tracking", "mis"),
    ("/api/insights", "intelligence"),
    ("/api/oee", "oee"),
    ("/api/production", "mis"),
    ("/api/despatch", "mis"),
    ("/api/equipment", "mis"),
    ("/api/dewatering", "mis"),
    ("/api/plant", "mis"),
    ("/api/stock", "mis"),
    ("/api/cob", "mis"),
    ("/api/ob", "mis"),
)


def page_for_path(path: str) -> str | None:
    """The page a request belongs to, or None if it is not page-specific."""
    return next((pg for pre, pg in PREFIX_PAGE if path.startswith(pre)), None)


# role -> set of allowed pages, cached in-process. Without this every API call
# would add a lookup to a MySQL server that is already refusing connections; one
# dashboard page load fires ~15 calls. Writes from the Access Control screen call
# invalidate_page_access(), so a change takes effect immediately rather than
# after the TTL.
_PAGE_CACHE: dict[str, set[str]] = {}
_PAGE_CACHE_AT: float = 0.0
_PAGE_CACHE_TTL = 60.0


def invalidate_page_access() -> None:
    global _PAGE_CACHE_AT
    _PAGE_CACHE_AT = 0.0


def _page_access_map(db: Session) -> dict[str, set[str]]:
    global _PAGE_CACHE, _PAGE_CACHE_AT
    now = time.monotonic()
    if _PAGE_CACHE and (now - _PAGE_CACHE_AT) < _PAGE_CACHE_TTL:
        return _PAGE_CACHE
    try:
        rows = db.execute(text(
            f"SELECT role, page, allowed FROM {PAGE_TBL}")).mappings().all()
    except Exception:
        # The table not existing must not lock everyone out — fall back to the
        # pre-table behaviour, which is that every role sees every page.
        return {r: set(PAGES) for r in ROLE_RANK}
    if not rows:
        return {r: set(PAGES) for r in ROLE_RANK}
    out: dict[str, set[str]] = {r: set() for r in ROLE_RANK}
    for row in rows:
        if row["allowed"]:
            out.setdefault(row["role"], set()).add(row["page"])
    _PAGE_CACHE, _PAGE_CACHE_AT = out, now
    return out


def allowed_pages(db: Session, role: str) -> set[str]:
    return _page_access_map(db).get(role, set())


def can_open_page(db: Session, role: str, page: str) -> bool:
    return page in allowed_pages(db, role)


# --------------------------------------------------------------- authentication
def authenticate(db: Session, empid: str, password: str) -> dict | None:
    """Validate EMPID + password against the intranet login table.

    Returns the employee profile on success, None on bad credentials. Callers must
    not distinguish the two failure modes to the user — an unknown EMPID and a
    wrong password get the same message, so this endpoint can't be used to
    enumerate employee IDs.
    """
    row = db.execute(text(
        f"SELECT EMPID, USER_PWD, STATUS FROM {LOGIN_TBL} WHERE EMPID = :e"),
        {"e": empid}).mappings().first()
    if not row or (row["STATUS"] or "").upper() != "A":
        return None
    if (row["USER_PWD"] or "").lower() != _sha1(password).lower():
        return None
    return employee(db, empid)


def employee(db: Session, empid: str) -> dict:
    """The employee profile shown in the UI, plus their Mines access role."""
    e = db.execute(text(
        f"""SELECT EMPID, EMPNAME, TITLE, EMPDESG, EMPDEPT, EMAILID, LOCATION, PLANT_CD, STATUS
            FROM {EMP_TBL} WHERE EMPID = :e"""), {"e": empid}).mappings().first()
    if not e:
        # A valid login with no HR record still gets in — as a viewer.
        from app.services import access as access_svc
        perms = sorted(access_svc.permissions_for(db, empid))
        return {"emp_id": empid, "name": empid, "designation": None, "department": None,
                "email": None, "title": None, "location": None, "plant": None,
                "roles": access_svc.roles_for(db, empid), "permissions": perms,
                "allowed_pages": [pg for pg, code in (
                    ("mis", "dashboard.mis"), ("oee", "dashboard.oee"),
                    ("intelligence", "dashboard.intelligence"),
                    ("fuel-management", "dashboard.fuel"), ("ev-tracking", "dashboard.ev"),
                ) if code in perms]}
    s = lambda v: (v or "").strip() or None  # noqa: E731
    from app.services import access as access_svc
    _perms = sorted(access_svc.permissions_for(db, e["EMPID"]))
    _roles = access_svc.roles_for(db, e["EMPID"])
    return {
        "emp_id": e["EMPID"],
        "name": s(e["EMPNAME"]) or empid,
        "title": s(e["TITLE"]),
        "designation": s(e["EMPDESG"]),
        "department": s(e["EMPDEPT"]),
        "email": s(e["EMAILID"]),
        "location": s(e["LOCATION"]),
        "plant": s(e["PLANT_CD"]),
        # Roles are data now, so the UI is given the permissions themselves
        # rather than a role name to reason about.
        "roles": _roles,
        "permissions": _perms,
        # The pages this user may open, so the sidebar shows only those. The
        # same rule is enforced on the API, so this is convenience, not security.
        "allowed_pages": [pg for pg, code in (
            ("mis", "dashboard.mis"), ("oee", "dashboard.oee"),
            ("intelligence", "dashboard.intelligence"),
            ("fuel-management", "dashboard.fuel"), ("ev-tracking", "dashboard.ev"),
        ) if code in _perms],
    }


# --------------------------------------------------------------------- sessions
def _ua_parse(ua: str) -> tuple[str, str, str]:
    """Best-effort browser / OS / device from the User-Agent, for the session row."""
    ua = ua or ""
    browser = ("Edge" if "Edg" in ua else "Chrome" if "Chrome" in ua else "Firefox" if "Firefox" in ua
               else "Safari" if "Safari" in ua else "Other")
    os_ = ("Windows" if "Windows" in ua else "Android" if "Android" in ua
           else "iOS" if ("iPhone" in ua or "iPad" in ua) else "macOS" if "Mac OS" in ua
           else "Linux" if "Linux" in ua else "Other")
    device = "Mobile" if ("Mobile" in ua or "Android" in ua) else "Desktop"
    return browser, os_, device


def create_session(db: Session, emp: dict, ip: str | None, ua: str | None) -> str:
    """Open a session row and return its id — the value of the session cookie.

    The id is 32 bytes from secrets.token_hex, so it is unguessable. It is the
    only thing the browser holds; nothing about the user is encoded in it.
    """
    sid = secrets.token_hex(32)          # 64 hex characters
    browser, os_, device = _ua_parse(ua or "")
    db.execute(text(
        f"""INSERT INTO {SESS_TBL}
              (session_id, emp_id, emp_name, role, department, login_at, last_active_at,
               is_active, app_source, ip_address, user_agent, device_type, browser, os)
            VALUES (:sid,:eid,:nm,:role,:dept, NOW(), NOW(), 1, :app, :ip, :ua, :dev, :br, :os)"""),
        {"sid": sid, "eid": emp["emp_id"], "nm": emp["name"],
         "role": emp.get("designation"), "dept": emp.get("department"),
         "app": APP_SOURCE, "ip": ip, "ua": (ua or "")[:500],
         "dev": device, "br": browser, "os": os_})
    db.commit()
    return sid


# A validated session, cached in-process for a few seconds.
#
# The session check runs on EVERY api request and costs a round trip to a MySQL
# server ~100ms away, so one dashboard page load spent well over a second just
# re-answering "is this cookie still valid" — a question whose answer cannot
# plausibly change between two calls made milliseconds apart.
#
# The window is deliberately short. Revoking access still takes effect within
# it, and the permission check is NOT cached here: only the fact that the
# session exists. Sessions are keyed by a 64-hex token, so this holds nothing an
# attacker could guess at.
_SESSION_TTL = 15.0
_session_cache: dict[str, tuple[dict, float]] = {}


# When each session was last written to the database. Tracked here rather than
# read off the cached row, whose last_active_at is frozen at the moment it was
# cached and would otherwise make the throttle fire on every request.
_last_touch: dict[str, float] = {}


def peek_session(sid: str | None) -> dict | None:
    """The session from cache only — never touches the database.

    Lets the middleware decide without any I/O in the common case. Returns None
    when the answer is not cached, which means 'ask the database', not 'invalid'.
    """
    if not sid:
        return None
    hit = _session_cache.get(sid)
    if hit and (time.monotonic() - hit[1]) < _SESSION_TTL:
        return hit[0]
    return None


def touch_due(sid: str, throttle_seconds: float = 30.0) -> bool:
    """Whether the session's activity timestamp is worth another write."""
    last = _last_touch.get(sid)
    return last is None or (time.monotonic() - last) > throttle_seconds


def forget_session(sid: str) -> None:
    """Drop a cached session — called on logout so signing out is immediate."""
    _session_cache.pop(sid, None)
    _last_touch.pop(sid, None)


def get_session(db: Session, sid: str | None) -> dict | None:
    """The active, non-idle Mines session for a session id, or None.

    Filtering on app_source as well as the id means a session cookie minted by
    another intranet app is not accepted here.
    """
    if not sid:
        return None

    hit = _session_cache.get(sid)
    if hit and (time.monotonic() - hit[1]) < _SESSION_TTL:
        return hit[0]

    row = db.execute(text(
        f"""SELECT session_id, emp_id, emp_name, role, department, last_active_at
            FROM {SESS_TBL}
            WHERE session_id = :sid AND is_active = 1 AND app_source = :app
              AND last_active_at > (NOW() - INTERVAL {IDLE_MINUTES} MINUTE)"""),
        {"sid": sid, "app": APP_SOURCE}).mappings().first()
    if not row:
        _session_cache.pop(sid, None)
        return None
    out = dict(row)
    _session_cache[sid] = (out, time.monotonic())
    # The cache is bounded by the number of live sessions, but a long-running
    # process would otherwise accumulate expired entries forever.
    if len(_session_cache) > 500:
        now = time.monotonic()
        for k, (_v, t) in list(_session_cache.items()):
            if now - t > _SESSION_TTL:
                _session_cache.pop(k, None)
    return out


def touch(db: Session, sid: str) -> None:
    """Push the idle timeout out. Throttled by the caller — see main.py."""
    _last_touch[sid] = time.monotonic()
    db.execute(text(
        f"UPDATE {SESS_TBL} SET last_active_at = NOW() WHERE session_id = :sid AND is_active = 1"),
        {"sid": sid})
    db.commit()


def end_session(db: Session, sid: str, reason: str = "LOGOUT") -> None:
    forget_session(sid)     # otherwise the cookie keeps working until the TTL
    # duration_minutes is a generated column — the DB derives it from login/logout.
    db.execute(text(
        f"""UPDATE {SESS_TBL}
            SET is_active = 0, logout_at = NOW(), end_reason = :r
            WHERE session_id = :sid AND is_active = 1"""), {"sid": sid, "r": reason})
    db.commit()


def record_time_spent(db: Session, sid: str, path: str, seconds: int) -> None:
    """Fill in how long the user stayed on a page they have just left.

    The view row is inserted on arrival, when the duration is not yet known, so
    this completes it rather than inserting a second row — otherwise every visit
    would be counted twice in the shared utilisation reporting.

    Targets the most recent still-unfilled row for this session and path, so a
    late-arriving update cannot overwrite the duration of an earlier visit to the
    same page in the same session.
    """
    if seconds is None or seconds < 0:
        return
    seconds = min(int(seconds), 86_400)     # a tab left open for days is not "time spent"
    db.execute(text(
        f"""UPDATE {VIEW_TBL}
            SET time_spent_seconds = :ts
            WHERE session_id = :sid AND page_path = :p AND app_source = :app
              AND time_spent_seconds IS NULL
            ORDER BY viewed_at DESC LIMIT 1"""),
        {"ts": seconds, "sid": sid, "p": (path or "/")[:255], "app": APP_SOURCE})
    db.execute(text(
        f"UPDATE {SESS_TBL} SET last_active_at = NOW() WHERE session_id = :sid AND is_active = 1"),
        {"sid": sid})
    db.commit()


def record_page_view(db: Session, sid: str, emp_id: str, path: str,
                     time_spent: int | None = None, referrer: str | None = None) -> None:
    db.execute(text(
        f"""INSERT INTO {VIEW_TBL}
              (session_id, emp_id, page_path, app_source, referrer_path, viewed_at, time_spent_seconds)
            VALUES (:sid,:eid,:p,:app,:ref, NOW(), :ts)"""),
        {"sid": sid, "eid": emp_id, "p": (path or "/")[:255], "app": APP_SOURCE,
         "ref": (referrer or None), "ts": time_spent})
    db.execute(text(
        f"UPDATE {SESS_TBL} SET last_active_at = NOW() WHERE session_id = :sid AND is_active = 1"),
        {"sid": sid})
    db.commit()
