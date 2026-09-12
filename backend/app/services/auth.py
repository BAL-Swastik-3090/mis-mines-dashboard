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

from sqlalchemy import text
from sqlalchemy.orm import Session

LOGIN_TBL = "intranet_user_login"
EMP_TBL = "sap_employee_details"
SESS_TBL = "digital_apps_user_sessions"
VIEW_TBL = "digital_apps_page_views"
ROLE_TBL = "mines_user_role"

# Identifies our rows in the tables shared across the intranet apps. Every read of
# those tables filters on it, so Mines never sees another app's sessions.
APP_SOURCE = "MINES"

IDLE_HOURS = 8          # a session expires after this many idle hours


def _sha1(pw: str) -> str:
    return hashlib.sha1(pw.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ access roles
ROLE_RANK = {"viewer": 1, "manager": 2, "admin": 3}
DEFAULT_ROLE = "viewer"


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
    return r if r in ROLE_RANK else DEFAULT_ROLE


def has_role(db: Session, emp_id: str, minimum: str) -> bool:
    """True if the employee's role is at least `minimum`."""
    return ROLE_RANK.get(mines_role(db, emp_id), 0) >= ROLE_RANK.get(minimum, 99)


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
        return {"emp_id": empid, "name": empid, "designation": None, "department": None,
                "email": None, "title": None, "location": None, "plant": None,
                "mines_role": mines_role(db, empid)}
    s = lambda v: (v or "").strip() or None  # noqa: E731
    return {
        "emp_id": e["EMPID"],
        "name": s(e["EMPNAME"]) or empid,
        "title": s(e["TITLE"]),
        "designation": s(e["EMPDESG"]),
        "department": s(e["EMPDEPT"]),
        "email": s(e["EMAILID"]),
        "location": s(e["LOCATION"]),
        "plant": s(e["PLANT_CD"]),
        "mines_role": mines_role(db, e["EMPID"]),
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


def get_session(db: Session, sid: str | None) -> dict | None:
    """The active, non-idle Mines session for a session id, or None.

    Filtering on app_source as well as the id means a session cookie minted by
    another intranet app is not accepted here.
    """
    if not sid:
        return None
    row = db.execute(text(
        f"""SELECT session_id, emp_id, emp_name, role, department, last_active_at
            FROM {SESS_TBL}
            WHERE session_id = :sid AND is_active = 1 AND app_source = :app
              AND last_active_at > (NOW() - INTERVAL {IDLE_HOURS} HOUR)"""),
        {"sid": sid, "app": APP_SOURCE}).mappings().first()
    return dict(row) if row else None


def touch(db: Session, sid: str) -> None:
    """Push the idle timeout out. Throttled by the caller — see main.py."""
    db.execute(text(
        f"UPDATE {SESS_TBL} SET last_active_at = NOW() WHERE session_id = :sid AND is_active = 1"),
        {"sid": sid})
    db.commit()


def end_session(db: Session, sid: str, reason: str = "LOGOUT") -> None:
    # duration_minutes is a generated column — the DB derives it from login/logout.
    db.execute(text(
        f"""UPDATE {SESS_TBL}
            SET is_active = 0, logout_at = NOW(), end_reason = :r
            WHERE session_id = :sid AND is_active = 1"""), {"sid": sid, "r": reason})
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
