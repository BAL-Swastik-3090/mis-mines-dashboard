"""Who uses this dashboard, what they look at, and what they change.

TWO LOGS, AND NEITHER IS THE WHOLE STORY.

  usage_session, usage_page_view   our own mirror in minehub of two tables
  in the shared balcorpdb, kept current by services/usage_sync.py. The source
  has no index led by app_source, so reading it meant scanning every other
  application's rows; the mirror is indexed on (app_source, date) and the
  screen never touches a shared server. The source of record is still
  balcorpdb -- see the sync.

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

from collections import OrderedDict
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db
from app.services import usage_sync

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
# One application. IMOS was here because the screen could report on it; it no
# longer does, and the mirror stopped carrying it. Adding another back is this
# line and nothing else.
ALLOWED_APPS = ("MINES",)

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


# The assembled answer, held briefly.
#
# The endpoint is fourteen quick queries rather than one slow one, and nearly
# all of the three seconds is round trips to a MySQL server on another host.
# That is long enough that somebody switching tabs aborts it — which is exactly
# what happened at 13:38 today, and the screen reported it as a failure of
# ours.
#
# A past range cannot change and today's changes slowly.
_ANSWER: "OrderedDict[tuple, tuple[float, dict]]" = OrderedDict()
_ANSWER_TTL = 60.0
_ANSWER_MAX = 12


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
          pg: Session = Depends(get_minehub_db),
          # Still MySQL, and rightly: this is the SAP employee master, not the
          # usage log. It is the one thing on this screen the mirror does not
          # hold, because it is not ours to mirror and it is read by name, not
          # scanned by range.
          db: Session = Depends(get_db)) -> dict:
    """Everything the page draws, in one request.

    One call rather than six. The page is read top to bottom in a meeting and
    six requests means six chances for one panel to be describing a different
    fortnight from the one above it.
    """
    _require(request)
    app_source = _app(app_source)
    frm, to = _window(days, day_from, day_to)

    # The same answer was assembled a moment ago for somebody else, or for
    # this reader before they changed tab. Fourteen round trips to another host
    # is long enough to be abandoned mid-flight.
    import time as _time
    # `cache_key`, not `key`: this function reuses `key` twice further down —
    # for the day loop and for the employee master — and the cache is written
    # at the very end, by which time a plain `key` holds the last employee
    # number read. Every answer was filed under '17331' and none was ever found
    # again.
    cache_key = (app_source, frm, to, bool(include_admins))
    hit = _ANSWER.get(cache_key)
    if hit and _time.monotonic() - hit[0] < _ANSWER_TTL:
        _ANSWER.move_to_end(cache_key)
        return hit[1]

    # Superadmins are excluded by default — see _superadmins. A real array
    # now that this reads Postgres: `= ANY(:skip)` takes the list directly,
    # where MySQL had no arrays and needed it comma-joined into a string.
    # Empty excludes nobody, so "include them" needs no second code path.
    skipped = [] if include_admins else _superadmins(pg)
    p = {"app": app_source, "frm": frm, "to": to, "skip": list(skipped)}

    # ── the month, fetched whole, twice ──────────────────────────────────
    #
    # Everything below used to be its own query. Twenty of them, each walking
    # a table shared by every application in the company to pick out the few
    # hundred rows that are ours: 128,725 scanned for 604 sessions, 155,551
    # for 2,419 page views, and 5.4 seconds of it.
    #
    # They are all the same rows grouped differently, so they are fetched once
    # and grouped here. The worst offender was the people list, whose page-view
    # count was a correlated subquery -- one full scan of the page-view table
    # per person on the list.
    ses = pg.execute(text("""
        SELECT session_id, emp_id, emp_name, department, role,
               login_at, logout_at, last_active_at, duration_minutes,
               end_reason, browser, os, device_type, ip_address, is_active
          FROM usage_session
         WHERE app_source = :app AND login_at::date BETWEEN :frm AND :to
           AND NOT (emp_id = ANY(:skip))
    """), p).mappings().all()

    views_rows = pg.execute(text("""
        SELECT emp_id, session_id, page_path, viewed_at, time_spent_seconds
          FROM usage_page_view
         WHERE app_source = :app AND viewed_at::date BETWEEN :frm AND :to
           AND NOT (emp_id = ANY(:skip))
    """), p).mappings().all()

    def _n(v) -> int:
        """A count, whatever the driver handed back. Pydantic serialises a
        Decimal as a JSON string and the browser then concatenates it."""
        return 0 if v is None else int(v)

    def _biggest(vals) -> str | None:
        """MAX() over a text column, which ignores nulls."""
        real = [v for v in vals if v is not None]
        return max(real) if real else None

    # ── who signed in ────────────────────────────────────────────────────
    _mins = [_n(r["duration_minutes"]) for r in ses
             if r["duration_minutes"] is not None]
    head = {
        "sessions": len(ses),
        "people": len({r["emp_id"] for r in ses}),
        "minutes": sum(_mins),
        "avg_minutes": round(sum(_mins) / len(_mins), 1) if _mins else 0,
        "live": len({r["emp_id"] for r in ses if r["is_active"]}),
    }

    # Page views per person, in one pass rather than one query each.
    views_by_emp: dict = {}
    for v in views_rows:
        views_by_emp[v["emp_id"]] = views_by_emp.get(v["emp_id"], 0) + 1

    by_emp: dict = {}
    for r in ses:
        by_emp.setdefault(r["emp_id"], []).append(r)

    people = []
    for emp_id, rs in by_emp.items():
        mins = [_n(r["duration_minutes"]) for r in rs
                if r["duration_minutes"] is not None]
        people.append({
            "emp_id": emp_id,
            "name": _biggest(r["emp_name"] for r in rs),
            "department": _biggest(r["department"] for r in rs),
            "role": _biggest(r["role"] for r in rs),
            "sessions": len(rs),
            "minutes": sum(mins),
            # On how many separate days, which says something sessions cannot:
            # 40 sessions on 3 days is a week of work, 40 across 20 days is a
            # habit.
            "active_days": len({r["login_at"].date() for r in rs
                                if r["login_at"]}),
            "first_seen": min((r["login_at"] for r in rs if r["login_at"]),
                              default=None),
            "last_seen": max((r["last_active_at"] for r in rs
                              if r["last_active_at"]), default=None),
            "browser": _biggest(r["browser"] for r in rs),
            "device": _biggest(r["device_type"] for r in rs),
            "timed_out": sum(1 for r in rs if r["end_reason"] == "TIMEOUT"),
            "views": views_by_emp.get(emp_id, 0),
        })
    # Longest first, and the employee number settles a tie. Ordering by
    # minutes alone leaves everyone on the same total in whatever order they
    # arrived, which is not the same order twice -- two readers comparing the
    # same screen would see the same people in different places.
    people.sort(key=lambda o: (-o["minutes"], str(o["emp_id"])))

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
    _today = date.today()
    _week_ago = datetime.now() - timedelta(days=7)
    reach = {
        "dau": len({r["emp_id"] for r in ses
                    if r["login_at"] and r["login_at"].date() == _today}),
        "wau": len({r["emp_id"] for r in ses
                    if r["login_at"] and r["login_at"] >= _week_ago}),
        "mau": len({r["emp_id"] for r in ses}),
        "sessions_today": sum(1 for r in ses
                              if r["login_at"] and r["login_at"].date() == _today),
    }

    # Every finished session's length, for a median. A mean is moved by one
    # person who left a tab open over lunch; a median is not, and the two
    # printed together say whether that happened.
    durations = sorted(_mins)
    median_minutes = (durations[len(durations) // 2] if durations else 0)

    # Sessions that reached at least one screen. A sign-in that arrived
    # nowhere is not use, and dividing page views by ALL sessions quietly
    # counts it as though it were.
    engaged = len({v["session_id"] for v in views_rows})

    # Who is in there right now — one row per PERSON, not per session.
    #
    # A session is a browser tab, and somebody with the dashboard open on their
    # desk and again on the wall display is one colleague, not two. Listing the
    # sessions made "3 signed in now" out of two people, which is the kind of
    # number that gets repeated in a meeting.
    #
    # The session count is kept, because two tabs is worth seeing once you know
    # it is one person.
    #
    # Still its own query: this one is not bounded by the range at all -- it
    # asks who is signed in NOW, which is a different question from what the
    # rest of the screen reports on.
    online = [dict(r) for r in pg.execute(text("""
        SELECT emp_id,
               MAX(emp_name)       AS emp_name,
               MAX(department)     AS department,
               MAX(role)           AS role,
               MAX(last_active_at) AS last_active_at,
               MIN(login_at)       AS login_at,
               COUNT(*)            AS sessions
          FROM usage_session
         WHERE app_source = :app AND is_active
           AND NOT (emp_id = ANY(:skip))
         GROUP BY emp_id
         ORDER BY last_active_at DESC
    """), p).mappings().all()]
    for r in online:
        _numbers(r, "sessions")

    # ── what they opened ─────────────────────────────────────────────────
    by_path: dict = {}
    for v in views_rows:
        by_path.setdefault(v["page_path"], []).append(v)
    screens = []
    for path, vs in by_path.items():
        dwell = [_n(v["time_spent_seconds"]) for v in vs
                 if v["time_spent_seconds"] is not None]
        screens.append({
            "page_path": path,
            "views": len(vs),
            "people": len({v["emp_id"] for v in vs}),
            "avg_seconds": round(sum(dwell) / len(dwell)) if dwell else 0,
            "total_seconds": sum(dwell),
            "no_dwell": sum(1 for v in vs if v["time_spent_seconds"] is None),
            "screen": SCREEN_NAMES.get(path, path),
        })
    screens.sort(key=lambda o: (-o["views"], o["page_path"]))

    # ── when ─────────────────────────────────────────────────────────────
    by_hour: dict = {}
    for v in views_rows:
        if v["viewed_at"]:
            h = v["viewed_at"].hour
            by_hour[h] = by_hour.get(h, 0) + 1
    # Monday is 0, which is how a mine week is read.
    by_weekday: dict = {}
    for v in views_rows:
        if v["viewed_at"]:
            w = v["viewed_at"].weekday()
            by_weekday[w] = by_weekday.get(w, 0) + 1

    # Weekday against hour, as a grid. "Busy on Thursday" and "busy at 3pm"
    # are two totals that cannot tell you about Thursday at 3pm, which is the
    # question somebody scheduling a shift handover is actually asking.
    #
    # Sessions rather than page views: this is about when people come to the
    # dashboard, not how much they clicked once they were in.
    heatmap = [[0] * 24 for _ in range(7)]
    for r in ses:
        if r["login_at"]:
            heatmap[r["login_at"].weekday()][r["login_at"].hour] += 1

    _wd: dict = {}
    for r in ses:
        if r["login_at"]:
            w = r["login_at"].weekday()
            b = _wd.setdefault(w, {"sessions": 0, "people": set()})
            b["sessions"] += 1
            b["people"].add(r["emp_id"])
    by_weekday_sessions = {w: {"sessions": b["sessions"],
                               "people": len(b["people"])}
                           for w, b in _wd.items()}

    # Every day in the range, including the ones nobody signed in.
    #
    # Grouping only returns days that HAPPENED, so a chart drawn from it starts
    # at the first day with a session and silently redraws its own x-axis: a
    # range of 1-28 September opened at the 12th, and the three quiet days
    # before it — which are the interesting ones on an adoption screen —
    # simply were not there to see.
    seen_days: dict = {}
    for r in ses:
        if r["login_at"]:
            k = r["login_at"].date().isoformat()
            b = seen_days.setdefault(k, {"sessions": 0, "people": set()})
            b["sessions"] += 1
            b["people"].add(r["emp_id"])
    by_day_sessions = {}
    day = frm
    while day <= to:
        key = day.isoformat()
        got = seen_days.get(key)
        by_day_sessions[key] = ({"sessions": got["sessions"],
                                 "people": len(got["people"])} if got
                                else {"sessions": 0, "people": 0})
        day += timedelta(days=1)

    _vd: dict = {}
    for v in views_rows:
        if v["viewed_at"]:
            k = v["viewed_at"].date().isoformat()
            b = _vd.setdefault(k, {"views": 0, "people": set()})
            b["views"] += 1
            b["people"].add(v["emp_id"])
    by_day = [{"day": k, "views": b["views"], "people": len(b["people"])}
              for k, b in sorted(_vd.items())]

    # ── how sessions ended, and on what ──────────────────────────────────
    endings: dict = {}
    for r in ses:
        k = r["end_reason"] or "still open"
        endings[k] = endings.get(k, 0) + 1
    _br: dict = {}
    for r in ses:
        k = r["browser"] or "unknown"
        _br[k] = _br.get(k, 0) + 1
    browsers = dict(sorted(_br.items(), key=lambda kv: -kv[1]))

    recent = []
    # ORDER BY login_at DESC, and MySQL sorts NULLs last that way round.
    for r in sorted(ses, key=lambda r: r["login_at"] or datetime.min,
                    reverse=True)[:60]:
        o = {k: r[k] for k in (
            "session_id", "emp_id", "emp_name", "login_at", "logout_at",
            "duration_minutes", "end_reason", "is_active", "browser", "os",
            "device_type", "ip_address")}
        o["session_id"] = (o["session_id"] or "")[:8]   # enough to tell apart
        _numbers(o, "duration_minutes", "is_active")
        recent.append(o)

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

    answer = {
        "app_source": app_source, "from": frm.isoformat(), "to": to.isoformat(),
        # This screen reads a mirror, so it is by design a little behind. A
        # figure whose age cannot be established is a figure nobody can defend.
        "mirror": usage_sync.freshness(pg),
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
    _ANSWER[cache_key] = (_time.monotonic(), answer)
    _ANSWER.move_to_end(cache_key)
    while len(_ANSWER) > _ANSWER_MAX:
        _ANSWER.popitem(last=False)
    return answer


@router.get("/apps")
def apps(request: Request, days: int = Query(30, ge=1, le=365),
         day_from: date | None = Query(None),
         day_to: date | None = Query(None),
         pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """The applications this screen may report on.

    Not the twenty-five that share the session table. The others belong to
    other departments and their staff are not this page's business.
    """
    _require(request)
    frm, to = _window(days, day_from, day_to)
    rows = {r["app_source"]: _numbers(dict(r), "sessions", "people", "minutes")
            for r in pg.execute(text("""
        SELECT app_source,
               COUNT(*) AS sessions,
               COUNT(DISTINCT emp_id) AS people,
               COALESCE(SUM(duration_minutes), 0) AS minutes,
               MAX(last_active_at) AS last_seen
          FROM usage_session
         WHERE login_at::date BETWEEN :frm AND :to
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
           pg: Session = Depends(get_minehub_db),
           db: Session = Depends(get_db)) -> dict:   # the SAP master only
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

    sessions = [dict(r) for r in pg.execute(text("""
        SELECT session_id, login_at, logout_at, duration_minutes, end_reason,
               is_active, browser, os, device_type, ip_address
          FROM usage_session
         WHERE app_source = :app AND emp_id = :e
           AND login_at::date BETWEEN :frm AND :to
         ORDER BY login_at DESC LIMIT 100
    """), p).mappings().all()]
    for r in sessions:
        r["session_id"] = (r["session_id"] or "")[:8]
        _numbers(r, "duration_minutes", "is_active")

    screens = []
    for r in pg.execute(text("""
        SELECT page_path, COUNT(*) AS views,
               COALESCE(ROUND(AVG(time_spent_seconds)), 0) AS avg_seconds,
               COALESCE(SUM(time_spent_seconds), 0) AS total_seconds,
               MAX(viewed_at) AS last_seen
          FROM usage_page_view
         WHERE app_source = :app AND emp_id = :e
           AND viewed_at::date BETWEEN :frm AND :to
         GROUP BY page_path ORDER BY views DESC
    """), p).mappings().all():
        o = _numbers(dict(r), "views", "avg_seconds", "total_seconds")
        o["screen"] = SCREEN_NAMES.get(o["page_path"], o["page_path"])
        screens.append(o)

    # One row per day they were here, so the drill-down can show the shape of
    # somebody's month rather than only its total.
    by_day = [{"day": str(r[0]), "sessions": _int(r[1]), "minutes": _int(r[2])}
              for r in pg.execute(text("""
        SELECT login_at::date, COUNT(*), COALESCE(SUM(duration_minutes), 0)
          FROM usage_session
         WHERE app_source = :app AND emp_id = :e
           AND login_at::date BETWEEN :frm AND :to
         GROUP BY 1 ORDER BY 1
    """), p).all()]

    who = pg.execute(text("""
        SELECT emp_name, department, role FROM usage_session
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
