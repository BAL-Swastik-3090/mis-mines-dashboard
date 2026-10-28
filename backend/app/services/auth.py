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
import logging
import contextlib
import threading
import secrets
import time
from typing import Iterator

from sqlalchemy import bindparam, text
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.orm import Session

# ── WHERE EACH OF THESE NOW LIVES ───────────────────────────────────────────
# All of them are in Postgres, which is why this module no longer uses the
# MySQL session it is handed -- see _auth_db() below.
#
# balcorpdb.intranet_user_login is the intranet's credentials. It is QUALIFIED
# because the balcorpdb schema is not on the connection's search_path and must
# not be: putting it there would expose a whole mirrored database to every
# unqualified name in the application.
#
# IT IS A MIRROR, AND MIRRORS GO STALE. When this was written its newest
# password change was 23 October and the mirror itself had stopped on the
# 26th. A password changed on the intranet after that will not open this
# dashboard until the copy is refreshed -- which is what
# scripts/import/refresh_login_copy.py exists to do, and why it should run on
# a schedule rather than by hand.
LOGIN_TBL = "balcorpdb.intranet_user_login"

# The live SAP feed, not a copy: this one is written by the OData pipeline and
# is more complete than the MySQL table it replaces.
EMP_TBL = "sap_odata_api.sap_employee_details"
log = logging.getLogger(__name__)

# MySQL says 1213 for a deadlock and 1205 for a lock-wait timeout. Both mean
# "somebody else had it, try again" rather than "this statement is wrong".
_RETRYABLE = (1213, 1205)

# Postgres reports the same two conditions as SQLSTATEs, not as numbers:
# 40P01 deadlock_detected and 55P03 lock_not_available. Without these the
# retry loop below would simply never retry -- it would look like it was
# working, and quietly give up on the first contended flush.
_RETRYABLE_SQLSTATE = ("40P01", "40001", "55P03")


def _sqlstate(exc: BaseException) -> str | None:
    """The SQLSTATE of a database error, wherever SQLAlchemy has wrapped it."""
    for holder in (getattr(exc, "orig", None), exc):
        code = getattr(holder, "sqlstate", None) or getattr(holder, "pgcode", None)
        if isinstance(code, str):
            return code
    return None


def _is_retryable(exc: BaseException) -> bool:
    return (_mysql_errno(exc) in _RETRYABLE
            or _sqlstate(exc) in _RETRYABLE_SQLSTATE)

# How long one of these writes may wait on a row lock before giving up.
#
# The server's own setting is 50 seconds, which is a sensible default for a
# statement somebody is waiting on the result of. Nobody waits on the result of
# these. What they cost while they wait is a connection out of the 8 this
# process is allowed, and eight of them blocked together is every connection
# gone — which is how a stalled timestamp update turned into "Could not read
# the attendance readers" on a screen that reads a different database entirely.
_LOCK_WAIT_SECONDS = 2


@contextlib.contextmanager
def _auth_db(db: Session) -> Iterator[Session]:
    """The session the login tables live on, which is Postgres.

    Every table this module reads or writes -- credentials, employee details,
    the two mines_* access tables and the two mines_* session tables -- is in
    Postgres now. The `db` parameter is still accepted because this module is
    called from middleware and from a dozen routers that all hold a MySQL
    session, and changing every one of those signatures would be a diff across
    the whole application for no gain.

    IT FALLS BACK TO `db`, AND THAT IS NOT A SAFETY NET. If Postgres is
    unreachable the tables are not there either, so the queries will fail --
    the fallback exists only so that a misconfigured deployment fails on a
    query it can explain, rather than on None.
    """
    from app.minehub_db import SessionLocal as PgSession
    if PgSession is None:
        yield db
        return
    pg = PgSession()
    try:
        yield pg
    finally:
        try:
            pg.close()
        except Exception:                               # noqa: BLE001
            pass


def _mysql_errno(exc: BaseException) -> int | None:
    """The engine's own error number, wherever SQLAlchemy has wrapped it."""
    orig = getattr(exc, "orig", None)
    for holder in (orig, exc):
        n = getattr(holder, "errno", None)
        if isinstance(n, int):
            return n
        args = getattr(holder, "args", None)
        if args and isinstance(args[0], int):
            return args[0]
    return None


def _short_lock_wait(db: Session) -> bool:
    """Ask for a short lock wait. Returns whether it must be restored after.

    MySQL and Postgres spell this differently and, more importantly, SCOPE it
    differently. innodb_lock_wait_timeout is set on the SESSION and rides the
    pooled connection into whatever runs next, so it has to be put back.
    Postgres's lock_timeout can be set LOCAL, which means it dies with the
    transaction and there is nothing to restore -- so the restore path, which
    is the fiddly half, simply does not apply there.

    Returning False on Postgres is therefore the correct answer and not a
    failure: nothing was left behind to undo.
    """
    try:
        if db.bind.dialect.name == "postgresql":
            # SET TAKES NO BIND PARAMETERS. Postgres parses SET before the
            # parameter is ever bound, so "SET LOCAL lock_timeout = :s" is a
            # syntax error at "$1" -- which this function CATCHES and logs,
            # meaning the short lock wait would silently never be applied.
            # The value is an int defined in this module, so interpolating it
            # is safe; there is no other way to write this statement.
            db.execute(text(
                f"SET LOCAL lock_timeout = '{int(_LOCK_WAIT_SECONDS) * 1000}ms'"))
            return False
        db.execute(text("SET SESSION innodb_lock_wait_timeout = :s"),
                   {"s": _LOCK_WAIT_SECONDS})
        return True
    except Exception as exc:                            # noqa: BLE001
        # Not fatal, and not worth failing over: without it the write simply
        # has the server's patience instead of ours.
        try:
            db.rollback()
        except Exception:                               # noqa: BLE001
            pass
        log.warning("could not shorten the lock wait: %s", str(exc)[:120])
        return False


def _best_effort(db: Session, what: str, run) -> bool:
    """Do a housekeeping write, or do not, but never take the request with it.

    THE CALLER IS SERVING A PAGE. These writes record that somebody is still
    active and which page they looked at; none of them is the reason the
    request was made, and a failure in one used to surface as "Internal server
    error" on whatever screen happened to be loading.

    Retried once. A deadlock is transient by definition — InnoDB picks a loser
    and rolls it back precisely so the other can finish — so the second attempt
    almost always succeeds. Anything still failing after that is logged and
    dropped: last_active_at stays as it was, which is a minute stale at worst,
    and the next request corrects it.

    AND IT GIVES UP QUICKLY. Not failing the request was only half the problem:
    the statement still waited out the server's 50-second lock timeout while
    holding one of the 8 MySQL connections this process may have. Eight at once
    is all of them, and every other request in the application then failed at
    pool checkout — including ones that never touch MySQL for their own data.
    Two seconds here, restored afterwards so the next caller on this pooled
    connection inherits the server's own setting rather than ours.
    """
    restore = _short_lock_wait(db)

    try:
        return _attempt(db, what, run)
    finally:
        if restore:
            try:
                db.execute(text(
                    "SET SESSION innodb_lock_wait_timeout = "
                    "@@GLOBAL.innodb_lock_wait_timeout"))
                db.commit()
            except Exception:                           # noqa: BLE001
                # The connection is in an unknown state, so do not hand it back
                # carrying our setting. Closing it costs one reconnect; leaving
                # a 2-second lock timeout on a pooled connection costs a
                # mysterious failure in an unrelated write later.
                try:
                    db.rollback()
                    db.get_bind().dispose()
                except Exception:                       # noqa: BLE001
                    pass


def _attempt(db: Session, what: str, run) -> bool:
    """The write itself, with the one retry. Split out so the lock-timeout
    handling above reads as the setup it is."""
    for attempt in (1, 2):
        try:
            run()
            db.commit()
            return True
        except (OperationalError, DBAPIError) as exc:
            db.rollback()
            errno = _mysql_errno(exc)
            if errno in _RETRYABLE and attempt == 1:
                continue
            log.warning("%s skipped (mysql errno %s): %s", what, errno,
                        str(exc)[:160])
            return False
        except Exception as exc:                        # noqa: BLE001
            # Housekeeping has no business raising anything at all here.
            db.rollback()
            log.warning("%s skipped: %s", what, str(exc)[:160])
            return False
    return False


# Mines' OWN session tables (migration 092), not the shared intranet ones.
# digital_apps_user_sessions is written by about twenty-five applications and
# read from MySQL by all of them; a Mines session written to its Postgres
# mirror would be invisible to every one of them, and would race the
# usage_sync job that also writes that mirror. So Mines keeps its own.
#
# The cost, stated where it will be read: Mines sessions no longer appear in
# the shared intranet session list.
SESS_TBL = "mines_user_session"
VIEW_TBL = "mines_page_view"
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
        with _auth_db(db) as s_:
            r = s_.execute(text(f"SELECT role FROM {ROLE_TBL} WHERE emp_id = :e"),
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
        with _auth_db(db) as s_:
            r = s_.execute(text(f"SELECT role FROM {ROLE_TBL} WHERE emp_id = :e"),
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
PAGES: tuple[str, ...] = ("mis", "oee", "intelligence", "amira",
          "fuel-management", "ev-tracking")

PAGE_LABELS = {
    "mis": "MIS Dashboard",
    "oee": "OEE / LCM",
    "intelligence": "Intelligence",
    "amira": "AMIRA Accounting",
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
    # Hand-entered mines stock position. Same reasoning as above: an
    # unmapped path skips the page check and would be reachable by any
    # signed-in user.
    ("/api/stock-entry", "mis"),
    # End-to-end quality, read-only over SAP. Mapped for the same reason as
    # the two above: an unmapped path skips the page check entirely.
    ("/api/quality-e2e", "mis"),
    # Its own page, not the MIS dashboard's. Reading the chromium balance is
    # a narrower right than reading production figures, and this is the line
    # the middleware enforces -- hiding the sidebar entry alone would leave
    # the data one URL away.
    #
    # The incoming branch predates migration 082 and still mapped this to
    # "mis". Taking it would have put the chromium balance back in front of
    # all 38 MIS holders, which is the thing 082 was written to stop.
    ("/api/amira", "amira"),
    ("/api/executive-summary", "mis"),
    # Ferrochrome output and its composite analysis, read-only over SAP.
    ("/api/plant-output", "mis"),
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
        with _auth_db(db) as s_:
            rows = s_.execute(text(
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
    # ALIASED TO LOWERCASE ON PURPOSE. Postgres folds an unquoted EMPID to
    # `empid` and hands the row back under that name, so row["STATUS"] raises
    # NoSuchColumnError -- every login failing with a 500 rather than a refusal.
    # MySQL honours an alias too, so this one spelling reads on both.
    with _auth_db(db) as s_:
        row = s_.execute(text(
            f"""SELECT EMPID AS empid, USER_PWD AS user_pwd, STATUS AS status
                FROM {LOGIN_TBL} WHERE EMPID = :e"""),
            {"e": empid}).mappings().first()
    if not row or (row["status"] or "").upper() != "A":
        return None
    if (row["user_pwd"] or "").lower() != _sha1(password).lower():
        return None
    return employee(db, empid)


def employee(db: Session, empid: str) -> dict:
    """The employee profile shown in the UI, plus their Mines access role."""
    with _auth_db(db) as s_:
        e = s_.execute(text(
            f"""SELECT EMPID AS empid, EMPNAME AS empname, TITLE AS title,
                       EMPDESG AS empdesg, EMPDEPT AS empdept, EMAILID AS emailid,
                       LOCATION AS location, PLANT_CD AS plant_cd, STATUS AS status
                FROM {EMP_TBL} WHERE EMPID = :e"""),
            {"e": empid}).mappings().first()
    if not e:
        # A valid login with no HR record still gets in — as a viewer.
        from app.services import access as access_svc
        perms = sorted(access_svc.permissions_for(db, empid))
        return {"emp_id": empid, "name": empid, "designation": None, "department": None,
                "email": None, "title": None, "location": None, "plant": None,
                "roles": access_svc.roles_for(db, empid), "permissions": perms,
                "access_source": access_svc.access_source(),
                "allowed_pages": [pg for pg, code in (
                    ("mis", "dashboard.mis"), ("oee", "dashboard.oee"),
                    ("intelligence", "dashboard.intelligence"),
                    ("amira", "dashboard.amira"),
                    ("fuel-management", "dashboard.fuel"), ("ev-tracking", "dashboard.ev"),
                ) if code in perms]}
    s = lambda v: (v or "").strip() or None  # noqa: E731
    from app.services import access as access_svc
    _perms = sorted(access_svc.permissions_for(db, e["empid"]))
    _roles = access_svc.roles_for(db, e["empid"])
    return {
        "emp_id": e["empid"],
        "name": s(e["empname"]) or empid,
        "title": s(e["title"]),
        "designation": s(e["empdesg"]),
        "department": s(e["empdept"]),
        "email": s(e["emailid"]),
        "location": s(e["location"]),
        "plant": s(e["plant_cd"]),
        # Roles are data now, so the UI is given the permissions themselves
        # rather than a role name to reason about.
        "roles": _roles,
        "permissions": _perms,
        # Where those two came from. "legacy" means the access database was
        # unreachable and this is the old, smaller fallback set -- which looks
        # identical to the real thing unless something says so.
        "access_source": access_svc.access_source(),
        # The pages this user may open, so the sidebar shows only those. The
        # same rule is enforced on the API, so this is convenience, not security.
        "allowed_pages": [pg for pg, code in (
            ("mis", "dashboard.mis"), ("oee", "dashboard.oee"),
            ("intelligence", "dashboard.intelligence"),
            ("amira", "dashboard.amira"),
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
    # is_active is a real BOOLEAN in the Postgres table, not MySQL's TINYINT(1).
    with _auth_db(db) as s_:
        s_.execute(text(
            f"""INSERT INTO {SESS_TBL}
                  (session_id, emp_id, emp_name, role, department, login_at, last_active_at,
                   is_active, app_source, ip_address, user_agent, device_type, browser, os)
                VALUES (:sid,:eid,:nm,:role,:dept, NOW(), NOW(), TRUE, :app, :ip, :ua, :dev, :br, :os)"""),
            {"sid": sid, "eid": emp["emp_id"], "nm": emp["name"],
             "role": emp.get("designation"), "dept": emp.get("department"),
             "app": APP_SOURCE, "ip": ip, "ua": (ua or "")[:500],
             "dev": device, "br": browser, "os": os_})
        s_.commit()
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
# Sessions seen since the last flush. A request adds to this and returns; the
# flusher below turns the whole set into one UPDATE.
#
# A plain dict guarded by a lock rather than a queue: the same session appearing
# forty times in a minute should cost one entry and one write, not forty.
_seen: dict[str, float] = {}
_seen_lock = threading.Lock()

# When each session last showed GENUINE activity — a request or a heartbeat
# that actually arrived from that browser. Distinct from _seen, which is only
# "noted since the last flush", and from last_active_at, which is what we
# write.
#
# WHY THIS HAS TO EXIST. The policy is IDLE_MINUTES on real activity, but
# something outside this application sweeps the shared session table and
# closes rows about ten to twelve minutes after last_active_at. That means the
# row must keep moving for the whole thirty minutes or somebody else ends the
# session for us — and the browser cannot be relied on to do it. A hidden tab
# has its timers throttled, and a frozen background page stops running them
# altogether, so the heartbeat that was supposed to cover "working in Excel
# with the dashboard behind it" is exactly the one the browser declines to
# send. Measured here: a hidden tab sent nothing for three minutes.
#
# So the server keeps the row fresh on the browser's behalf, for as long as
# its own rule says the session is alive, and stops the moment that rule says
# it is not. The policy is unchanged; it is simply enforced somewhere that
# cannot be put to sleep.
_real_seen: dict[str, float] = {}

# How often the flusher runs, and how long it may wait for the lock while it
# does. It can be patient because no request is waiting on it — the opposite of
# the inline write, which had a user watching.
FLUSH_SECONDS = 45.0
FLUSH_LOCK_WAIT = 15
FLUSH_ATTEMPTS = 4


# session id -> the monotonic time its next activity write is due.
#
# "When is the next one due" rather than "when did we last try", because those
# are the same number only when the write succeeded. A touch that lost its race
# used to book the next two minutes off anyway, which is how an active user's
# timestamp went stale enough to idle them out while they were still clicking.
_touch_next: dict[str, float] = {}

# How long to wait before trying again, after a write that worked and after one
# that did not. The retry gap is short because the cost of being wrong is
# somebody being logged out mid-sentence, and cheap because the write itself
# gives up after two seconds.
_TOUCH_AFTER_OK = 120.0
_TOUCH_AFTER_FAIL = 20.0


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


def touch_due(sid: str, throttle_seconds: float = _TOUCH_AFTER_OK) -> bool:
    """Whether the session's activity timestamp is worth another write.

    Every thirty seconds, to protect a thirty-MINUTE idle timeout — sixty
    times more often than the policy it exists for. Each of those writes
    enters a race with ev_sync_digital_apps_crm, which runs every minute in
    the shared database and takes the same two indexes of this table in the
    opposite order, so the rate is not free: it is the rate at which we buy
    lottery tickets for a deadlock.

    Two minutes instead. The stored timestamp then lags real activity by at
    most two minutes, so a session idles out somewhere between 28 and 30
    minutes rather than at exactly 30 — which no policy written as "about half
    an hour" can tell the difference between. Four times fewer writes, and
    "who is online" reporting elsewhere in the shared table stays within two
    minutes of the truth.

    Two minutes only when the last write SUCCEEDED. When it did not, the next
    one is due in twenty seconds: the throttle exists to avoid pointless
    writes, and a write that never landed was not pointless. Booking the full
    two minutes after a failure is what let an active session go stale enough
    to be logged out.

    `throttle_seconds` is no longer read — the interval is decided by touch()
    when it learns whether the write landed — and is kept so callers passing it
    still work.
    """
    due = _touch_next.get(sid)
    return due is None or time.monotonic() >= due


def forget_session(sid: str) -> None:
    """Drop a cached session — called on logout so signing out is immediate."""
    _session_cache.pop(sid, None)
    _touch_next.pop(sid, None)
    with _seen_lock:
        _seen.pop(sid, None)
        # Otherwise the keep-alive below would hold a signed-out session open
        # for the rest of the window.
        _real_seen.pop(sid, None)


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

    # INTERVAL '30 minutes', not MySQL's INTERVAL 30 MINUTE -- the second is a
    # syntax error in Postgres, and this runs on every single api request.
    with _auth_db(db) as s_:
        row = s_.execute(text(
            f"""SELECT session_id, emp_id, emp_name, role, department, last_active_at
                FROM {SESS_TBL}
                WHERE session_id = :sid AND is_active AND app_source = :app
                  AND last_active_at > (NOW() - INTERVAL '{IDLE_MINUTES} minutes')"""),
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
    """Push the idle timeout out. Throttled by the caller — see main.py.

    Best-effort. This runs inside the auth middleware on every request, and it
    deadlocks against ev_sync_digital_apps_crm — a MySQL event in the shared
    balcorpdb that runs every minute and takes the same two indexes of this
    table in the opposite order. InnoDB rolls one of the pair back, and when
    that was us the user saw "Internal server error" on whatever page was
    loading.

    The timestamp is worth having and is not worth a failed page. But it is
    also what the idle timeout reads, so a write that did not land has to be
    retried rather than forgotten: this used to mark the session touched before
    attempting, and a run of lost races aged `last_active_at` past the
    thirty-minute limit while somebody was actively using the screen. They were
    returned to the login page for being idle while they were working.

    IT NO LONGER WRITES. It notes the session id, and `flush_touches` below
    turns every session noted since the last run into a single UPDATE, once
    every 45 seconds, from one background task.

    Because the inline write did not land. It raced ev_sync_digital_apps_crm —
    which runs every minute in the shared balcorpdb and takes the same two
    indexes of this table in the opposite order — and with the short lock
    timeout it needed in order not to drain the connection pool, it lost almost
    every time. A user clicking through five screens over half an hour had a
    last_active_at still showing the minute they signed in, and was turned out
    at exactly thirty minutes for being idle.

    Noting it in memory cannot fail, costs nothing, and gives the write to
    somebody who can afford to wait for the lock.

    `db` is kept in the signature: every caller has one, and the day this needs
    a database again is not the day to go and find them all.
    """
    with _seen_lock:
        _seen[sid] = time.time()
        _real_seen[sid] = time.monotonic()


def touch_now(db: Session, sid: str) -> bool:
    """Write this session's activity immediately, and say whether it landed.

    For the heartbeat, which is the only thing keeping a session alive while
    somebody reads one screen. touch() notes the session for the flusher, which
    is right for the per-request path — a write on every call is what drained
    the pool — and wrong here: the heartbeat fires once every two minutes and is
    the whole reason an idle-but-watching user stays signed in.

    Once per user per two minutes is a fraction of the load that caused the
    original trouble, and it keeps the short lock timeout and the retry, so it
    can neither hold a pooled connection nor fail the request it rides on.
    """
    with _seen_lock:
        _seen.pop(sid, None)        # written here; the flusher need not repeat it
        _real_seen[sid] = time.monotonic()
    with _auth_db(db) as s_:
        return _best_effort(s_, "heartbeat", lambda: s_.execute(text(
            f"UPDATE {SESS_TBL} SET last_active_at = NOW() "
            f"WHERE session_id = :sid AND is_active"), {"sid": sid}))


def flush_touches(db: Session) -> int:
    """Write the activity noted since the last flush. One statement, patiently.

    Returns how many sessions were written, for the log.

    The patience is the point. This is the same UPDATE that used to run inline
    with two seconds to get its lock, against a job that holds the table for
    longer than that every minute. Here nobody is waiting on it, so it may take
    fifteen seconds and try four times — which is what it takes to land between
    the bursts.

    On failure the ids go back, so the next flush covers this one's sessions
    too. Activity is never dropped because a write was unlucky; that is the
    whole bug this exists to fix.
    """
    # KEEPING A LIVE SESSION LIVE, not just recording the ones that moved.
    #
    # This used to write only the sessions noted since the last pass, which is
    # the same as saying "only the ones whose browser made a request". A user
    # reading one screen, or working in another window with the dashboard
    # behind it, makes no requests — and after ten to twelve minutes the
    # external sweeper closed them for it. They were signed out while working,
    # which is the whole complaint.
    #
    # Every session whose last GENUINE activity is still inside the
    # application's own window is written on every pass, so the row never
    # looks stale to the sweeper. A session whose real activity has aged past
    # IDLE_MINUTES is dropped here and written no more: the row then goes
    # stale on schedule and the session ends, exactly as the policy says. An
    # unattended machine is still signed out; it is now measured from the last
    # time a person touched it rather than from the last time their browser
    # happened to poll.
    cutoff = IDLE_MINUTES * 60
    now = time.monotonic()
    with _seen_lock:
        for sid, seen_at in list(_real_seen.items()):
            if now - seen_at >= cutoff:
                _real_seen.pop(sid, None)
        sids = sorted(set(_seen) | set(_real_seen))
        _seen.clear()
        if not sids:
            return 0

    # ── ON THE SESSION TABLE'S OWN DATABASE ─────────────────────────────────
    # This is called from a background task holding a MySQL session, and
    # mines_user_session is in Postgres. Run on the caller's session and every
    # pass fails with 42P01 undefined_table -- which _best_effort-style
    # logging reports once and then swallows, so the flush looks like it is
    # running while writing nothing, and every active user idles out anyway.
    # That is exactly the failure this whole mechanism exists to prevent.
    with _auth_db(db) as db:
        return _flush_on(db, sids)


def _flush_on(db: Session, sids: list[str]) -> int:
    """The flush itself, once the right database is in hand."""
    restore = False
    try:
        # lock_timeout is Postgres's name for it, and it takes milliseconds.
        # SET LOCAL dies with this transaction, so unlike the MySQL session
        # setting it replaces there is nothing to hand back.
        # Interpolated, not bound: SET takes no parameters (see _short_lock_wait).
        db.execute(text(
            f"SET LOCAL lock_timeout = '{int(FLUSH_LOCK_WAIT) * 1000}ms'"))
        restore = False
    except Exception as exc:                            # noqa: BLE001
        db.rollback()
        log.warning("could not set the flush lock wait: %s", str(exc)[:120])

    try:
        for attempt in range(1, FLUSH_ATTEMPTS + 1):
            try:
                res = db.execute(text(
                    f"UPDATE {SESS_TBL} SET last_active_at = NOW() "
                    f"WHERE is_active AND session_id IN :sids"
                ).bindparams(bindparam("sids", expanding=True)), {"sids": sids})
                db.commit()
                # Rows actually written, not sessions attempted. The bug this
                # whole mechanism exists to fix was a write that reported
                # success and changed nothing, so this must not be the count of
                # what we hoped for. Fewer than asked is normal and correct:
                # sessions closed since they were noted match nothing, and they
                # should not be resurrected.
                return int(res.rowcount or 0)
            except (OperationalError, DBAPIError) as exc:
                db.rollback()
                errno = _mysql_errno(exc) or _sqlstate(exc)
                if _is_retryable(exc) and attempt < FLUSH_ATTEMPTS:
                    time.sleep(0.5 * attempt)
                    continue
                log.warning("activity flush failed for %d sessions "
                            "(mysql errno %s) — will retry next pass",
                            len(sids), errno)
                break
            except Exception as exc:                    # noqa: BLE001
                db.rollback()
                log.warning("activity flush failed: %s", str(exc)[:160])
                break
    finally:
        if restore:                                     # MySQL only; see above
            try:
                db.execute(text("SET SESSION innodb_lock_wait_timeout = "
                                "@@GLOBAL.innodb_lock_wait_timeout"))
                db.commit()
            except Exception:                           # noqa: BLE001
                try:
                    db.rollback()
                except Exception:                       # noqa: BLE001
                    pass

    # Put them back rather than losing the activity they represent.
    with _seen_lock:
        for sid in sids:
            _seen.setdefault(sid, time.time())
    return 0


def end_session(db: Session, sid: str, reason: str = "LOGOUT") -> None:
    forget_session(sid)     # otherwise the cookie keeps working until the TTL
    # And drop any pending activity for it, so a flush a few seconds from now
    # does not write last_active_at onto a session somebody has just left. The
    # UPDATE is guarded by is_active = 1 as well, so this is belt and braces —
    # but a logout that can be partially undone by a timer is not worth the
    # cleverness of leaving it to one guard.
    with _seen_lock:
        _seen.pop(sid, None)
    # duration_minutes is a generated column — the DB derives it from login/logout.
    with _auth_db(db) as s_:
        s_.execute(text(
            f"""UPDATE {SESS_TBL}
                SET is_active = FALSE, logout_at = NOW(), end_reason = :r
                WHERE session_id = :sid AND is_active"""), {"sid": sid, "r": reason})
        s_.commit()


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

    def go() -> None:
        s_.execute(text(
            f"""UPDATE {VIEW_TBL} SET time_spent_seconds = :ts
                 WHERE id = (SELECT id FROM {VIEW_TBL}
                              WHERE session_id = :sid AND page_path = :p
                                AND app_source = :app
                                AND time_spent_seconds IS NULL
                              ORDER BY viewed_at DESC LIMIT 1)"""),
            {"ts": seconds, "sid": sid, "p": (path or "/")[:255], "app": APP_SOURCE})
        s_.execute(text(
            f"UPDATE {SESS_TBL} SET last_active_at = NOW() "
            f"WHERE session_id = :sid AND is_active"), {"sid": sid})

    # Usage reporting. Losing a page's dwell time to a lock race costs a row in
    # a report; failing the request costs the user their page.
    with _auth_db(db) as s_:
        _best_effort(s_, "time spent", go)


def record_page_view(db: Session, sid: str, emp_id: str, path: str,
                     time_spent: int | None = None, referrer: str | None = None) -> None:
    def go() -> None:
        s_.execute(text(
            f"""INSERT INTO {VIEW_TBL}
                  (session_id, emp_id, page_path, app_source, referrer_path,
                   viewed_at, time_spent_seconds)
                VALUES (:sid,:eid,:p,:app,:ref, NOW(), :ts)"""),
            {"sid": sid, "eid": emp_id, "p": (path or "/")[:255], "app": APP_SOURCE,
             "ref": (referrer or None), "ts": time_spent})
        s_.execute(text(
            f"UPDATE {SESS_TBL} SET last_active_at = NOW() "
            f"WHERE session_id = :sid AND is_active"), {"sid": sid})

    # Same bargain as above: the page view is reporting, the page is the job.
    with _auth_db(db) as s_:
        _best_effort(s_, "page view", go)
