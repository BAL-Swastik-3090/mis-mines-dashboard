"""Who uses this dashboard, what they look at, and what they change.

TWO LOGS, AND NEITHER IS THE WHOLE STORY.

  digital_apps_user_sessions   MySQL, shared by 22 applications. Who signed
  digital_apps_page_views      in, from what browser, for how long, and which
                               screens they opened.

  event                        Postgres, ours. What they actually changed —
                               a roster day, a bucket, a crew, a face plan —
                               with what it said before.

Sessions say somebody was here. Events say they did something. A person with
forty sessions and no events is reading; one with six sessions and two hundred
events is working. Those are different people to a manager and the two logs
have never been put side by side.

JOINED ON THE EMPLOYEE NUMBER, LOOSELY. `emp_id` is clean; `recorded_by` is
not — it holds '3101', '3101 Akash', 'CLEANUP', 'unknown' and a couple of
one-off strings. The leading digits are taken where there are any, and
everything else is reported as unattributed rather than dropped: an event
nobody can be tied to is a fact about the log worth seeing, not a row to hide.

READ-ONLY, AND SCOPED. Defaults to this application. The table is shared, so
the other twenty-one are available too — for somebody who has the permission
to see who is using what, which is the same permission that guards the access
screen.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/usage", tags=["Usage"])

APP = "MINES"

# Either opens this screen. `usage.view` is the real one — it exists so that
# reading who used the platform does not require the ability to change who may.
# `access.users.view` is kept because every administrator held it before that
# permission existed, and a security tidy-up that quietly removes somebody's
# screen is a security tidy-up that gets reverted.
VIEW = ("usage.view", "access.users.view")

# The applications this screen may report on.
#
# Twenty-five write to the shared session table. This page belongs to the mine,
# and the mine has no business seeing who reads the Leave Management
# Application: that is somebody else's staff, on somebody else's screen. Two —
# the systems this site actually runs — and anything else is refused rather
# than quietly answered.
ALLOWED_APPS = ("MINES", "IMOS")

# Where a page path maps to a name somebody would recognise. The paths are
# what the browser reported; these are what the sidebar calls them.
SCREEN_NAMES = {
    "/": "MIS Dashboard", "/mis": "MIS Dashboard",
    "/minehub": "Equipment 360", "/manpower": "Manpower",
    "/operations": "Shift Control", "/workforce": "Workforce Planning",
    "/capacity": "Capacity", "/weighbridge": "Weighbridge", "/gate": "Gate",
    "/organisation": "Organisation", "/market": "Market Watch",
    "/oee": "OEE / LCM", "/intelligence": "Intelligence",
    "/fuel-management": "Fuel Management", "/ev-tracking": "Electric Vehicles",
    "/access-control": "Access Control", "/weather": "Weather Forecast",
    "/usage": "Usage",
}


def _int(v) -> int:
    """A count, as a number.

    MySQL's SUM() and COUNT() come back as Decimal, and Pydantic v2 writes
    Decimal to JSON as a string to protect a precision that a count does not
    have. The browser then adds "5908" to "34" and gets "590834".

    Done here rather than in the page, because the page is not the only reader
    and the next chart would have to remember.
    """
    if v is None:
        return 0
    if isinstance(v, (int, Decimal, float)):
        return int(v)
    try:
        return int(str(v).strip() or 0)
    except ValueError:
        return 0


def _numbers(row: dict, *keys: str) -> dict:
    """The same, for the counts in a row that came from the database."""
    for k in keys:
        if k in row:
            row[k] = _int(row[k])
    return row


def _superadmins(pg: Session) -> list[str]:
    """Everyone holding a role that grants everything.

    From the role, not a list of names: `grants_everything` is what makes
    somebody a superadmin, and hardcoding today's two would be wrong the first
    time anybody is promoted or steps down.
    """
    return [r[0] for r in pg.execute(text("""
        SELECT DISTINCT ua.emp_id
          FROM user_access ua
          JOIN role r ON r.role_id = ua.role_id
         WHERE ua.valid_to IS NULL
           AND r.status = 'ACTIVE'
           AND r.grants_everything
    """)).all()]


def _require(request: Request) -> None:
    perms = set(getattr(request.state, "permissions", None) or set())
    if not (set(VIEW) & perms):
        raise HTTPException(403, "You do not have permission to see usage. "
                                 "An Access Manager can add it to your role.")


def _window(days: int, day_from: date | None = None,
            day_to: date | None = None) -> tuple[date, date]:
    """The range to report on: the header's, or a rolling window if none.

    Every other screen takes its dates from the header picker. A page with a
    second date control has two answers to "what am I looking at", and the one
    the user did not touch is the one they believe.
    """
    if day_from and day_to:
        return (day_from, day_to) if day_from <= day_to else (day_to, day_from)
    to = date.today()
    return to - timedelta(days=days - 1), to


def _app(app_source: str) -> str:
    """The application asked for, if this screen is allowed to answer for it."""
    if app_source not in ALLOWED_APPS:
        raise HTTPException(404, f"No usage is reported for {app_source!r}.")
    return app_source


def _emp_of(recorded_by: str | None) -> str | None:
    """The employee number inside whatever the event recorded.

    'recorded_by' has been written by several hands over time: '3101' is the
    common case, '3101 Akash' happened during a verification run, and
    'CLEANUP', 'unknown' and 'test' are not people at all. Leading digits, or
    nothing.
    """
    if not recorded_by:
        return None
    digits = ""
    for ch in recorded_by.strip():
        if ch.isdigit():
            digits += ch
        else:
            break
    return digits or None


@router.get("")
def usage(request: Request,
          days: int = Query(30, ge=1, le=365),
          day_from: date | None = Query(None),
          day_to: date | None = Query(None),
          app_source: str = Query(APP),
          include_admins: bool = Query(False),
          db: Session = Depends(get_db),
          pg: Session = Depends(get_minehub_db)) -> dict:
    """Everything the page draws, in one request.

    One call rather than six. The page is read top to bottom in a meeting and
    six requests means six chances for one panel to be describing a different
    fortnight from the one above it.
    """
    _require(request)
    app_source = _app(app_source)
    frm, to = _window(days, day_from, day_to)

    # Superadmins are excluded by default — see _superadmins. A comma-joined
    # string rather than an expanding IN: the exclusion reaches a dozen queries
    # across two tables, and one plain parameter threads through all of them.
    # Empty excludes nobody, so "include them" needs no second code path.
    skipped = [] if include_admins else _superadmins(pg)
    p = {"app": app_source, "frm": frm, "to": to, "skip": ",".join(skipped)}

    # ── who signed in ────────────────────────────────────────────────────
    head = db.execute(text("""
        SELECT COUNT(*)                                    AS sessions,
               COUNT(DISTINCT emp_id)                      AS people,
               COALESCE(SUM(duration_minutes), 0)          AS minutes,
               COALESCE(ROUND(AVG(duration_minutes), 1), 0) AS avg_minutes,
               COUNT(DISTINCT CASE WHEN is_active = 1
                                   THEN emp_id END)        AS live
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
    """), p).mappings().first()

    people = [dict(r) for r in db.execute(text("""
        SELECT s.emp_id, MAX(s.emp_name) AS name, MAX(s.department) AS department,
               MAX(s.role) AS role,
               COUNT(*) AS sessions,
               COALESCE(SUM(s.duration_minutes), 0) AS minutes,
               -- On how many separate days, which says something sessions
               -- cannot: 40 sessions on 3 days is a week of work, 40 across
               -- 20 days is a habit.
               COUNT(DISTINCT DATE(s.login_at)) AS active_days,
               MIN(s.login_at) AS first_seen,
               MAX(s.last_active_at) AS last_seen,
               MAX(s.browser) AS browser, MAX(s.device_type) AS device,
               SUM(s.end_reason = 'TIMEOUT') AS timed_out,
               (SELECT COUNT(*) FROM digital_apps_page_views v
                 WHERE v.emp_id = s.emp_id AND v.app_source = :app
                   AND DATE(v.viewed_at) BETWEEN :frm AND :to) AS views
          FROM digital_apps_user_sessions s
         WHERE s.app_source = :app AND DATE(s.login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(s.emp_id, :skip)
         GROUP BY s.emp_id ORDER BY minutes DESC
    """), p).mappings().all()]
    for r in people:
        _numbers(r, "sessions", "minutes", "views", "timed_out", "active_days")

    # ── everyone who was GIVEN it, used or not ───────────────────────────
    #
    # The number that makes every other number mean something. A live role is
    # the definition of provisioned: `valid_to IS NULL` is how access.py
    # decides somebody currently holds a role, and disagreeing with it here
    # would put two different answers to "who has access" on two screens.
    # Postgres, not MySQL: roles and grants live in minehub beside the rest of
    # the platform's own tables, while the session log is in the shared
    # balcorpdb. Two databases in one answer, which is the whole shape of this
    # screen.
    provisioned = [dict(r) for r in pg.execute(text("""
        SELECT ua.emp_id, STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name) AS roles
          FROM user_access ua
          JOIN role r ON r.role_id = ua.role_id AND r.status = 'ACTIVE'
         WHERE ua.valid_to IS NULL
           AND (:keep OR NOT r.grants_everything)
         GROUP BY ua.emp_id
    """), {"keep": bool(include_admins)}).mappings().all()]

    # The same people over three windows. One number cannot separate a tool
    # somebody opens every morning from one they opened once this month.
    reach = db.execute(text("""
        SELECT COUNT(DISTINCT CASE WHEN DATE(login_at) = CURDATE()
                                   THEN emp_id END)                  AS dau,
               COUNT(DISTINCT CASE WHEN login_at >= NOW() - INTERVAL 7 DAY
                                   THEN emp_id END)                  AS wau,
               COUNT(DISTINCT emp_id)                                AS mau,
               SUM(DATE(login_at) = CURDATE())                       AS sessions_today
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
    """), p).mappings().first()

    # Every finished session's length, for a median. A mean is moved by one
    # person who left a tab open over lunch; a median is not, and the two
    # printed together say whether that happened.
    durations = sorted(
        int(r[0]) for r in db.execute(text("""
            SELECT duration_minutes FROM digital_apps_user_sessions
             WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
               AND duration_minutes IS NOT NULL
        """), p).all() if r[0] is not None)
    median_minutes = (durations[len(durations) // 2] if durations else 0)

    # Sessions that reached at least one screen. A sign-in that arrived
    # nowhere is not use, and dividing page views by ALL sessions quietly
    # counts it as though it were.
    engaged = int(db.execute(text("""
        SELECT COUNT(DISTINCT session_id) FROM digital_apps_page_views
         WHERE app_source = :app AND DATE(viewed_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
    """), p).scalar() or 0)

    # Who is in there right now — one row per PERSON, not per session.
    #
    # A session is a browser tab, and somebody with the dashboard open on their
    # desk and again on the wall display is one colleague, not two. Listing the
    # sessions made "3 signed in now" out of two people, which is the kind of
    # number that gets repeated in a meeting.
    #
    # The session count is kept, because two tabs is worth seeing once you know
    # it is one person.
    online = [dict(r) for r in db.execute(text("""
        SELECT emp_id,
               MAX(emp_name)       AS emp_name,
               MAX(department)     AS department,
               MAX(role)           AS role,
               MAX(last_active_at) AS last_active_at,
               MIN(login_at)       AS login_at,
               COUNT(*)            AS sessions
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND is_active = 1
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY emp_id
         ORDER BY last_active_at DESC
    """), p).mappings().all()]
    for r in online:
        _numbers(r, "sessions")

    # ── what they opened ─────────────────────────────────────────────────
    screens = []
    for r in db.execute(text("""
        SELECT page_path,
               COUNT(*) AS views,
               COUNT(DISTINCT emp_id) AS people,
               COALESCE(ROUND(AVG(time_spent_seconds)), 0) AS avg_seconds,
               COALESCE(SUM(time_spent_seconds), 0) AS total_seconds,
               SUM(time_spent_seconds IS NULL) AS no_dwell
          FROM digital_apps_page_views
         WHERE app_source = :app AND DATE(viewed_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY page_path ORDER BY views DESC
    """), p).mappings().all():
        o = _numbers(dict(r), "views", "people", "avg_seconds",
                     "total_seconds", "no_dwell")
        o["screen"] = SCREEN_NAMES.get(o["page_path"], o["page_path"])
        screens.append(o)

    # ── when ─────────────────────────────────────────────────────────────
    by_hour = {int(r[0]): int(r[1]) for r in db.execute(text("""
        SELECT HOUR(viewed_at), COUNT(*) FROM digital_apps_page_views
         WHERE app_source = :app AND DATE(viewed_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY 1
    """), p).all()}
    # Monday is 2 in MySQL's DAYOFWEEK; shifted so 0 is Monday, which is how
    # a mine week is read.
    by_weekday = {int(r[0]): int(r[1]) for r in db.execute(text("""
        SELECT (DAYOFWEEK(viewed_at) + 5) % 7, COUNT(*)
          FROM digital_apps_page_views
         WHERE app_source = :app AND DATE(viewed_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY 1
    """), p).all()}
    # Weekday against hour, as a grid. "Busy on Thursday" and "busy at 3pm"
    # are two totals that cannot tell you about Thursday at 3pm, which is the
    # question somebody scheduling a shift handover is actually asking.
    #
    # Sessions rather than page views: this is about when people come to the
    # dashboard, not how much they clicked once they were in.
    heatmap = [[0] * 24 for _ in range(7)]
    for r in db.execute(text("""
        SELECT (DAYOFWEEK(login_at) + 5) % 7 AS wd, HOUR(login_at) AS hr,
               COUNT(*) AS n
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY 1, 2
    """), p).all():
        heatmap[int(r[0])][int(r[1])] = int(r[2])

    by_weekday_sessions = {int(r[0]): {"sessions": int(r[1]), "people": int(r[2])}
                           for r in db.execute(text("""
        SELECT (DAYOFWEEK(login_at) + 5) % 7, COUNT(*), COUNT(DISTINCT emp_id)
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY 1
    """), p).all()}

    # Every day in the range, including the ones nobody signed in.
    #
    # Grouping only returns days that HAPPENED, so a chart drawn from it starts
    # at the first day with a session and silently redraws its own x-axis: a
    # range of 1-28 September opened at the 12th, and the three quiet days
    # before it — which are the interesting ones on an adoption screen —
    # simply were not there to see.
    seen_days = {str(r[0]): {"sessions": _int(r[1]), "people": _int(r[2])}
                 for r in db.execute(text("""
        SELECT DATE(login_at), COUNT(*), COUNT(DISTINCT emp_id)
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY 1 ORDER BY 1
    """), p).all()}
    by_day_sessions = {}
    day = frm
    while day <= to:
        key = day.isoformat()
        by_day_sessions[key] = seen_days.get(key, {"sessions": 0, "people": 0})
        day += timedelta(days=1)

    by_day = [{"day": str(r[0]), "views": int(r[1]), "people": int(r[2])}
              for r in db.execute(text("""
        SELECT DATE(viewed_at), COUNT(*), COUNT(DISTINCT emp_id)
          FROM digital_apps_page_views
         WHERE app_source = :app AND DATE(viewed_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY 1 ORDER BY 1
    """), p).all()]

    # ── how sessions ended, and on what ──────────────────────────────────
    endings = {str(r[0] or "still open"): int(r[1]) for r in db.execute(text("""
        SELECT COALESCE(end_reason, 'still open'), COUNT(*)
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY 1
    """), p).all()}
    browsers = {str(r[0] or "unknown"): int(r[1]) for r in db.execute(text("""
        SELECT COALESCE(browser, 'unknown'), COUNT(*)
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         GROUP BY 1 ORDER BY 2 DESC
    """), p).all()}

    recent = [dict(r) for r in db.execute(text("""
        SELECT session_id, emp_id, emp_name, login_at, logout_at,
               duration_minutes, end_reason, is_active, browser, os,
               device_type, ip_address
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
           AND NOT FIND_IN_SET(emp_id, :skip)
         ORDER BY login_at DESC LIMIT 60
    """), p).mappings().all()]
    for r in recent:
        r["session_id"] = (r["session_id"] or "")[:8]   # enough to tell apart
        _numbers(r, "duration_minutes", "is_active")

    # ── what they changed, from the other database ───────────────────────
    raw = pg.execute(text("""
        SELECT event_type, recorded_by, occurred_at, payload
          FROM event
         WHERE occurred_at >= :frm AND occurred_at < (CAST(:to AS date) + 1)
         ORDER BY occurred_at DESC
    """), {"frm": frm, "to": to}).mappings().all()

    kinds: dict[str, dict] = {}
    by_actor: dict[str, int] = {}
    unattributed: dict[str, int] = {}
    for e in raw:
        k = kinds.setdefault(e["event_type"], {"event_type": e["event_type"],
                                               "count": 0, "people": set(),
                                               "last": None})
        k["count"] += 1
        k["last"] = k["last"] or e["occurred_at"]
        emp = _emp_of(e["recorded_by"])
        if emp and emp in skipped:
            # Their changes come out too, or "633 changes" stays mostly the
            # test writes of the person reading the screen.
            k["count"] -= 1
            if k["count"] == 0:
                kinds.pop(e["event_type"], None)
            continue
        if emp:
            k["people"].add(emp)
            by_actor[emp] = by_actor.get(emp, 0) + 1
        else:
            unattributed[str(e["recorded_by"] or "(none)")] = \
                unattributed.get(str(e["recorded_by"] or "(none)"), 0) + 1

    changes = sorted(
        ({**k, "people": len(k["people"])} for k in kinds.values()),
        key=lambda x: -x["count"])

    # The two logs, side by side per person.
    names = {r["emp_id"]: r.get("name") for r in people}
    for r in people:
        r["changes"] = by_actor.get(r["emp_id"], 0)
    # Somebody who changed things without a session in this window still
    # belongs on the list — otherwise the change count and the people count
    # describe different sets of people.
    for emp, n in by_actor.items():
        if emp not in names:
            people.append({"emp_id": emp, "name": None, "department": None,
                           "role": None, "sessions": 0, "minutes": 0,
                           "last_seen": None, "browser": None, "device": None,
                           "timed_out": 0, "views": 0, "changes": n})

    # Name, department and designation for everybody, from the SAP master.
    #
    # The session log carries these, but only for somebody who has signed in —
    # so the people the adoption section is ABOUT were the people it could say
    # least about, and twenty of them sat under "Not recorded".
    #
    # EMPID there is zero-padded to eight digits, so the join is on the number:
    # '00003101' and '3101' are the same man and a string comparison says they
    # are not. Cheap enough to read whole (1,259 rows) and matched in Python,
    # which keeps the padding rule in one place instead of in every query.
    master: dict[str, dict] = {}
    try:
        for r in db.execute(text("""
            SELECT EMPID, EMPNAME, EMPDEPT, EMPDESG FROM sap_employee_details_new
        """)).mappings().all():
            key = str(r["EMPID"] or "").strip().lstrip("0")
            if key:
                master[key] = {"name": (r["EMPNAME"] or "").strip() or None,
                               "department": (r["EMPDEPT"] or "").strip() or None,
                               "designation": (r["EMPDESG"] or "").strip() or None}
    except Exception:                                   # noqa: BLE001
        # A master that cannot be read costs names on a few rows; it must not
        # cost the page.
        master = {}

    # Somebody provisioned who never arrived belongs on the list of people,
    # with zeroes. They are the entire point of having a denominator: a name
    # that shows up here is a licence nobody is using, or a colleague who was
    # never shown how.
    seen = {r["emp_id"] for r in people}
    roles_of = {r["emp_id"]: r["roles"] for r in provisioned}
    for r in people:
        r["roles"] = roles_of.get(r["emp_id"])
        r["provisioned"] = r["emp_id"] in roles_of
        m = master.get(str(r["emp_id"]).lstrip("0"), {})
        # The session log wins where it has something — it is what this person
        # was called when they actually signed in — and the master fills gaps.
        r["name"] = r.get("name") or m.get("name")
        r["department"] = r.get("department") or m.get("department")
        r["designation"] = m.get("designation")
    for r in provisioned:
        if r["emp_id"] not in seen:
            m = master.get(str(r["emp_id"]).lstrip("0"), {})
            people.append({"emp_id": r["emp_id"], "name": m.get("name"),
                           "department": m.get("department"),
                           "designation": m.get("designation"),
                           "role": None, "roles": r["roles"], "provisioned": True,
                           "sessions": 0, "minutes": 0, "active_days": 0,
                           "first_seen": None, "last_seen": None,
                           "browser": None, "device": None, "timed_out": 0,
                           "views": 0, "changes": 0})

    shown = [e for e in raw if _emp_of(e["recorded_by"]) not in skipped]
    latest = [{
        "occurred_at": e["occurred_at"], "event_type": e["event_type"],
        "by": e["recorded_by"], "emp_id": _emp_of(e["recorded_by"]),
        "payload": e["payload"],
    } for e in shown[:80]]

    return {
        "app_source": app_source, "from": frm.isoformat(), "to": to.isoformat(),
        "days": (to - frm).days + 1,
        "headline": {
            **{k: _int(v) for k, v in dict(head or {}).items()
               if k != "avg_minutes"},
            "avg_minutes": float(head["avg_minutes"]) if head else 0.0,
            "views": sum(s["views"] for s in screens),
            "changes": len(shown),
            "screens": len(screens),
            "provisioned": len(provisioned),
            "dau": int(reach["dau"] or 0) if reach else 0,
            "wau": int(reach["wau"] or 0) if reach else 0,
            "mau": int(reach["mau"] or 0) if reach else 0,
            "sessions_today": int(reach["sessions_today"] or 0) if reach else 0,
            "median_minutes": median_minutes,
            "engaged_sessions": engaged,
        },
        # A COUNT, and nothing else.
        #
        # This was a list of employee numbers, then a list of names, and both
        # were more than the page needs. The reader has to know the figures
        # exclude somebody, or they cannot reconcile them against the session
        # log. They do not have to know who, and sending it published the
        # platform's administrators to everybody holding usage.view.
        "excluded_count": len(skipped),
        "online": online,
        "heatmap": heatmap,
        "by_weekday_sessions": by_weekday_sessions,
        "by_day_sessions": by_day_sessions,
        "people": people,
        "screens": screens,
        "by_hour": by_hour, "by_weekday": by_weekday, "by_day": by_day,
        "endings": endings, "browsers": browsers,
        "recent_sessions": recent,
        "changes_by_kind": changes,
        "latest_changes": latest,
        "unattributed": [{"by": k, "count": v}
                         for k, v in sorted(unattributed.items(),
                                            key=lambda x: -x[1])],
    }


@router.get("/apps")
def apps(request: Request, days: int = Query(30, ge=1, le=365),
         day_from: date | None = Query(None),
         day_to: date | None = Query(None),
         db: Session = Depends(get_db)) -> list[dict]:
    """The applications this screen may report on — MINES and IMOS.

    Not all twenty-five that share the table. The others belong to other
    departments and their staff are not this page's business.
    """
    _require(request)
    frm, to = _window(days, day_from, day_to)
    rows = {r["app_source"]: _numbers(dict(r), "sessions", "people", "minutes")
            for r in db.execute(text("""
        SELECT app_source,
               COUNT(*) AS sessions,
               COUNT(DISTINCT emp_id) AS people,
               COALESCE(SUM(duration_minutes), 0) AS minutes,
               MAX(last_active_at) AS last_seen
          FROM digital_apps_user_sessions
         WHERE DATE(login_at) BETWEEN :frm AND :to
           AND app_source IN :apps
         GROUP BY app_source
    """).bindparams(bindparam("apps", expanding=True)),
        {"frm": frm, "to": to, "apps": list(ALLOWED_APPS)}).mappings().all()}

    # Listed in the order they are declared, and present even with no sessions
    # in the range — an application with nothing this fortnight is an answer,
    # and dropping the row makes the picker change shape as the dates move.
    return [rows.get(a, {"app_source": a, "sessions": 0, "people": 0,
                         "minutes": 0, "last_seen": None})
            for a in ALLOWED_APPS]


@router.get("/person/{emp_id}")
def person(emp_id: str, request: Request,
           days: int = Query(30, ge=1, le=365),
           day_from: date | None = Query(None),
           day_to: date | None = Query(None),
           app_source: str = Query(APP),
           db: Session = Depends(get_db),
           pg: Session = Depends(get_minehub_db)) -> dict:
    """One person: every session, every screen, everything they changed.

    The first thing anybody asks of an aggregate is which of these rows is me,
    and the second is what the person at the top of it was actually doing. A
    leaderboard that cannot be opened is a ranking nobody can check.

    Same permission as the page it opens from. Nothing new is exposed here —
    it is the same three logs, filtered to one person.
    """
    _require(request)
    app_source = _app(app_source)
    frm, to = _window(days, day_from, day_to)
    p = {"app": app_source, "frm": frm, "to": to, "e": emp_id}

    sessions = [dict(r) for r in db.execute(text("""
        SELECT session_id, login_at, logout_at, duration_minutes, end_reason,
               is_active, browser, os, device_type, ip_address
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND emp_id = :e
           AND DATE(login_at) BETWEEN :frm AND :to
         ORDER BY login_at DESC LIMIT 100
    """), p).mappings().all()]
    for r in sessions:
        r["session_id"] = (r["session_id"] or "")[:8]
        _numbers(r, "duration_minutes", "is_active")

    screens = []
    for r in db.execute(text("""
        SELECT page_path, COUNT(*) AS views,
               COALESCE(ROUND(AVG(time_spent_seconds)), 0) AS avg_seconds,
               COALESCE(SUM(time_spent_seconds), 0) AS total_seconds,
               MAX(viewed_at) AS last_seen
          FROM digital_apps_page_views
         WHERE app_source = :app AND emp_id = :e
           AND DATE(viewed_at) BETWEEN :frm AND :to
         GROUP BY page_path ORDER BY views DESC
    """), p).mappings().all():
        o = _numbers(dict(r), "views", "avg_seconds", "total_seconds")
        o["screen"] = SCREEN_NAMES.get(o["page_path"], o["page_path"])
        screens.append(o)

    # One row per day they were here, so the drill-down can show the shape of
    # somebody's month rather than only its total.
    by_day = [{"day": str(r[0]), "sessions": _int(r[1]), "minutes": _int(r[2])}
              for r in db.execute(text("""
        SELECT DATE(login_at), COUNT(*), COALESCE(SUM(duration_minutes), 0)
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND emp_id = :e
           AND DATE(login_at) BETWEEN :frm AND :to
         GROUP BY 1 ORDER BY 1
    """), p).all()]

    who = db.execute(text("""
        SELECT emp_name, department, role FROM digital_apps_user_sessions
         WHERE app_source = :app AND emp_id = :e
         ORDER BY login_at DESC LIMIT 1
    """), p).mappings().first()

    # The event log records who by a string, not an id — see _emp_of. Filtering
    # in SQL would mean LIKE on a dirty column; the range is already small
    # enough to read and match in Python, and it uses the same rule the rest of
    # the page uses rather than a second one that could disagree.
    changes = [{
        "occurred_at": e["occurred_at"], "event_type": e["event_type"],
        "by": e["recorded_by"], "payload": e["payload"],
    } for e in pg.execute(text("""
        SELECT event_type, recorded_by, occurred_at, payload FROM event
         WHERE occurred_at >= :frm AND occurred_at < (CAST(:to AS date) + 1)
         ORDER BY occurred_at DESC
    """), {"frm": frm, "to": to}).mappings().all()
        if _emp_of(e["recorded_by"]) == emp_id][:200]

    m = db.execute(text("""
        SELECT EMPNAME, EMPDEPT, EMPDESG FROM sap_employee_details_new
         WHERE CAST(EMPID AS UNSIGNED) = :n
    """), {"n": _int(emp_id)}).mappings().first() if emp_id.isdigit() else None

    return {
        "emp_id": emp_id,
        "name": (who or {}).get("emp_name") or (m or {}).get("EMPNAME"),
        "department": (who or {}).get("department") or (m or {}).get("EMPDEPT"),
        "role": (who or {}).get("role"),
        "designation": (m or {}).get("EMPDESG"),
        "sessions": sessions, "screens": screens, "changes": changes,
        "by_day": by_day,
    }
