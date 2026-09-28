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

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/usage", tags=["Usage"])

APP = "MINES"
VIEW = "access.users.view"

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


def _require(request: Request) -> None:
    perms = getattr(request.state, "permissions", None) or set()
    if VIEW not in perms:
        raise HTTPException(403, "You do not have permission to see usage. "
                                 "An Access Manager can add it to your role.")


def _window(days: int) -> tuple[date, date]:
    to = date.today()
    return to - timedelta(days=days - 1), to


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
          app_source: str = Query(APP),
          db: Session = Depends(get_db),
          pg: Session = Depends(get_minehub_db)) -> dict:
    """Everything the page draws, in one request.

    One call rather than six. The page is read top to bottom in a meeting and
    six requests means six chances for one panel to be describing a different
    fortnight from the one above it.
    """
    _require(request)
    frm, to = _window(days)
    p = {"app": app_source, "frm": frm, "to": to}

    # ── who signed in ────────────────────────────────────────────────────
    head = db.execute(text("""
        SELECT COUNT(*)                                    AS sessions,
               COUNT(DISTINCT emp_id)                      AS people,
               COALESCE(SUM(duration_minutes), 0)          AS minutes,
               COALESCE(ROUND(AVG(duration_minutes), 1), 0) AS avg_minutes,
               SUM(is_active = 1)                          AS live
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
    """), p).mappings().first()

    people = [dict(r) for r in db.execute(text("""
        SELECT s.emp_id, MAX(s.emp_name) AS name, MAX(s.department) AS department,
               MAX(s.role) AS role,
               COUNT(*) AS sessions,
               COALESCE(SUM(s.duration_minutes), 0) AS minutes,
               MAX(s.last_active_at) AS last_seen,
               MAX(s.browser) AS browser, MAX(s.device_type) AS device,
               SUM(s.end_reason = 'TIMEOUT') AS timed_out,
               (SELECT COUNT(*) FROM digital_apps_page_views v
                 WHERE v.emp_id = s.emp_id AND v.app_source = :app
                   AND DATE(v.viewed_at) BETWEEN :frm AND :to) AS views
          FROM digital_apps_user_sessions s
         WHERE s.app_source = :app AND DATE(s.login_at) BETWEEN :frm AND :to
         GROUP BY s.emp_id ORDER BY minutes DESC
    """), p).mappings().all()]

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
         GROUP BY page_path ORDER BY views DESC
    """), p).mappings().all():
        o = dict(r)
        o["screen"] = SCREEN_NAMES.get(o["page_path"], o["page_path"])
        screens.append(o)

    # ── when ─────────────────────────────────────────────────────────────
    by_hour = {int(r[0]): int(r[1]) for r in db.execute(text("""
        SELECT HOUR(viewed_at), COUNT(*) FROM digital_apps_page_views
         WHERE app_source = :app AND DATE(viewed_at) BETWEEN :frm AND :to
         GROUP BY 1
    """), p).all()}
    # Monday is 2 in MySQL's DAYOFWEEK; shifted so 0 is Monday, which is how
    # a mine week is read.
    by_weekday = {int(r[0]): int(r[1]) for r in db.execute(text("""
        SELECT (DAYOFWEEK(viewed_at) + 5) % 7, COUNT(*)
          FROM digital_apps_page_views
         WHERE app_source = :app AND DATE(viewed_at) BETWEEN :frm AND :to
         GROUP BY 1
    """), p).all()}
    by_day = [{"day": str(r[0]), "views": int(r[1]), "people": int(r[2])}
              for r in db.execute(text("""
        SELECT DATE(viewed_at), COUNT(*), COUNT(DISTINCT emp_id)
          FROM digital_apps_page_views
         WHERE app_source = :app AND DATE(viewed_at) BETWEEN :frm AND :to
         GROUP BY 1 ORDER BY 1
    """), p).all()]

    # ── how sessions ended, and on what ──────────────────────────────────
    endings = {str(r[0] or "still open"): int(r[1]) for r in db.execute(text("""
        SELECT COALESCE(end_reason, 'still open'), COUNT(*)
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
         GROUP BY 1
    """), p).all()}
    browsers = {str(r[0] or "unknown"): int(r[1]) for r in db.execute(text("""
        SELECT COALESCE(browser, 'unknown'), COUNT(*)
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
         GROUP BY 1 ORDER BY 2 DESC
    """), p).all()}

    recent = [dict(r) for r in db.execute(text("""
        SELECT session_id, emp_id, emp_name, login_at, logout_at,
               duration_minutes, end_reason, is_active, browser, os,
               device_type, ip_address
          FROM digital_apps_user_sessions
         WHERE app_source = :app AND DATE(login_at) BETWEEN :frm AND :to
         ORDER BY login_at DESC LIMIT 60
    """), p).mappings().all()]
    for r in recent:
        r["session_id"] = (r["session_id"] or "")[:8]   # enough to tell apart

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

    latest = [{
        "occurred_at": e["occurred_at"], "event_type": e["event_type"],
        "by": e["recorded_by"], "emp_id": _emp_of(e["recorded_by"]),
        "payload": e["payload"],
    } for e in raw[:80]]

    return {
        "app_source": app_source, "from": frm.isoformat(), "to": to.isoformat(),
        "days": days,
        "headline": {
            **{k: (int(v) if v is not None else 0) for k, v in dict(head or {}).items()
               if k != "avg_minutes"},
            "avg_minutes": float(head["avg_minutes"]) if head else 0.0,
            "views": sum(s["views"] for s in screens),
            "changes": len(raw),
            "screens": len(screens),
        },
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
         db: Session = Depends(get_db)) -> list[dict]:
    """Every application sharing the session table, for scope and for scale.

    Twenty-two of them write here. Seeing this dashboard's numbers beside the
    others is the difference between "494 sessions" and "494 sessions, which
    is sixth of twenty-two".
    """
    _require(request)
    frm, to = _window(days)
    return [dict(r) for r in db.execute(text("""
        SELECT app_source,
               COUNT(*) AS sessions,
               COUNT(DISTINCT emp_id) AS people,
               COALESCE(SUM(duration_minutes), 0) AS minutes,
               MAX(last_active_at) AS last_seen
          FROM digital_apps_user_sessions
         WHERE DATE(login_at) BETWEEN :frm AND :to
         GROUP BY app_source ORDER BY sessions DESC
    """), {"frm": frm, "to": to}).mappings().all()]
