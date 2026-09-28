"""Things that are wrong right now, things that were, and who has read them.

WHY THIS EXISTS. The weighbridge agent at WB3 stopped sending readings on
Saturday morning and nobody knew until somebody thought to ask, two days later.
Nothing was broken in a way that shows: the screen still loads, the bridge
still has a page, and the last reading it ever took sits there looking like a
reading. A machine that has stopped talking looks exactly like a machine with
nothing to say.

AN ALERT IS AN EPISODE, NOT A FLASH. Each poll used to recompute the present
and forget it, so "how long has this been going on", "has it happened before"
and "did anybody see it" had no answers. Now a fault opens a row when it starts
and closes it when it clears — one row per episode, not one per poll, because
sixty rows an hour saying the same thing is a log and nobody reads a log.

RECOVERY IS NEWS TOO. Closing the row is what lets the bell say "WB3 is back",
which people want to hear at least as much as the failure and which no amount
of looking at the present can tell you.

CLEARING IS PERSONAL. "Clear all" marks alerts read by the person who clicked.
It does not delete them and it does not clear them for anybody else — the
weighbridge is still not weighing, and one person deciding they have read it
must not take it off a colleague's screen. An alert that is cleared and then
gets WORSE comes back, because what was acknowledged was the thing as it stood.

WHO SEES WHAT. An alert reaches only somebody holding a permission to act on
it. A notification you cannot act on is noise, and a platform that shows
everybody everything teaches them to ignore the bell — which costs you the one
alert that mattered.

WHAT IT DOES NOT DO. It does not decide WHY something is quiet. An agent that
has not reported can be a laptop switched off at shift end, a network port, a
serial cable, or a bridge that simply is not weighing today. The alert says how
long it has been silent and stops. That is a fact; the cause belongs to whoever
walks over and looks.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])

# How long an agent may be silent before it is worth saying so.
#
# It polls about once a second and posts in batches, so a minute of silence is
# a hiccup and ten is a fact. Late before down: a laptop rebooting should not
# read the same as a bridge dark since Saturday.
AGENT_QUIET_WARN = timedelta(minutes=10)
AGENT_QUIET_DOWN = timedelta(hours=1)

# How long a recovery stays on the bell. Long enough that somebody who was at
# the bridge sees it when they get back to a desk; short enough that good news
# does not accumulate into a list nobody reads.
RECOVERED_FOR = timedelta(hours=12)

SEVERITY_RANK = {"WARN": 1, "DOWN": 2}


def _held(request: Request) -> set[str]:
    return set(getattr(request.state, "permissions", None) or ())


def _me(request: Request) -> str:
    return str(getattr(request.state, "emp_id", "") or "")


def _ago(seconds: float | None) -> tuple[float, str]:
    """Minutes since, and how a person would say it.

    TAKES SECONDS, MEASURED BY THE DATABASE — not a timestamp to subtract from
    this server's clock. Those are two different clocks and on this site they
    are nearly seven minutes apart, which made every age here seven minutes too
    old: an agent that had just reported was "late", and the one-hour threshold
    fired after fifty-three minutes.

    The weighbridge router already carried a comment warning about exactly
    this. Subtracting two readings of the same clock is right whichever of them
    is wrong.
    """
    if seconds is None:
        return (float("inf"), "never")
    mins = float(seconds) / 60
    if mins < 1:
        return (mins, "just now")
    if mins < 60:
        return (mins, f"{int(mins)} minutes ago")
    if mins < 60 * 24:
        h = int(mins // 60)
        return (mins, f"{h} hour{'s' if h != 1 else ''} ago")
    d = int(mins // 1440)
    return (mins, f"{d} day{'s' if d != 1 else ''} ago")


def _span(seconds: float | None) -> str | None:
    """How long something ran, from seconds the database measured."""
    if seconds is None:
        return None
    mins = float(seconds) / 60
    if mins < 60:
        return f"{int(mins)} minutes"
    if mins < 60 * 24:
        return f"{mins / 60:.1f} hours"
    return f"{mins / 1440:.1f} days"


# ═══════════════════════════════════════════════════════════════════════════
# What is wrong at this moment — computed, not stored
# ═══════════════════════════════════════════════════════════════════════════
def _current(pg: Session, held: set[str]) -> list[dict]:
    """Every fault happening now that this person could act on."""
    out: list[dict] = []

    # Weighbridge agents that have gone quiet. Shown to whoever runs the bridge
    # (wb.view — can walk over and look) and whoever runs the platform
    # (access.users.view — can reach the machine). Nobody else can do either.
    if held & {"wb.view", "access.users.view"}:
        for r in pg.execute(text("""
            SELECT w.code, w.name, a.machine_name, a.last_seen_at, a.last_error,
                   -- Measured here, by the clock that wrote the timestamp.
                   EXTRACT(EPOCH FROM (now() - a.last_seen_at)) AS quiet_seconds
              FROM weighbridge_agent a
              JOIN weighbridge w ON w.weighbridge_id = a.weighbridge_id
             WHERE a.status = 'ACTIVE'
             ORDER BY a.last_seen_at NULLS FIRST
        """)).mappings().all():
            mins, said = _ago(r["quiet_seconds"])
            if mins <= AGENT_QUIET_WARN.total_seconds() / 60:
                continue
            down = mins > AGENT_QUIET_DOWN.total_seconds() / 60
            where = r["machine_name"] or "the bridge PC"
            out.append({
                "key": f"wb-agent-{r['code']}",
                "severity": "DOWN" if down else "WARN",
                "kind": "Weighbridge",
                "title": f"{r['code']} is not sending readings",
                "detail": (
                    f"The agent on {where} was last heard from {said}. "
                    f"No weights can be captured at {r['name']} until it is back."
                    + (f" Its last error was: {r['last_error']}"
                       if r["last_error"] else
                       " It stopped without reporting an error, which usually "
                       "means the machine was switched off or lost the network "
                       "rather than the agent failing.")
                ),
                "since": r["last_seen_at"],
                "minutes": None if mins == float("inf") else round(mins),
                "page": "weighbridge",
            })
    return out


def _record(pg: Session, current: list[dict], families: set[str]) -> None:
    """Open episodes that have started, close the ones that have ended.

    `families` is what the caller actually LOOKED FOR — the key prefixes it
    evaluated. Only those are closed. Without it, a reader with no weighbridge
    permission would poll the bell, see no weighbridge faults because they are
    not allowed to, and mark a two-day outage as recovered.

    Absence is evidence only where somebody went and checked.
    """
    now_keys = {a["key"] for a in current}

    for a in current:
        pg.execute(text("""
            INSERT INTO platform_alert
                   (alert_key, kind, title, detail, severity, since_at, last_seen_at)
            VALUES (:k, :kind, :t, :d, :sev, :since, now())
            ON CONFLICT (alert_key) WHERE resolved_at IS NULL
            DO UPDATE SET last_seen_at = now(),
                          detail  = EXCLUDED.detail,
                          -- The worst it reached, never downgraded while it
                          -- runs: an agent that goes late then down had one bad
                          -- episode, not a wobble followed by a separate fault.
                          severity = CASE
                              WHEN EXCLUDED.severity = 'DOWN' THEN 'DOWN'
                              ELSE platform_alert.severity END
        """), {"k": a["key"], "kind": a["kind"], "t": a["title"],
               "d": a["detail"], "sev": a["severity"], "since": a["since"]})

    # Anything still open in a family we DID evaluate, and did not find, has
    # ended. Evaluated-but-empty is the whole point: it is the only way a
    # recovery is ever noticed.
    for family in families:
        pg.execute(text("""
            UPDATE platform_alert SET resolved_at = now()
             WHERE resolved_at IS NULL
               AND alert_key LIKE :pattern
               AND NOT (alert_key = ANY(:keys))
        """), {"pattern": f"{family}%", "keys": list(now_keys)})
    pg.commit()


# ═══════════════════════════════════════════════════════════════════════════
@router.get("/live")
def live(request: Request, pg: Session = Depends(get_minehub_db)) -> dict:
    """What needs attention, what has just recovered, and how many.

    One call, cheap enough to poll, so the bell can show a number without a
    second request asking how many.
    """
    held = _held(request)
    me = _me(request)
    may_see_wb = bool(held & {"wb.view", "access.users.view"})

    current = _current(pg, held)
    # Only families this caller was actually allowed to look for. A
    # dashboard-only user polling the bell must not "resolve" an outage by not
    # being permitted to see it.
    families = {"wb-agent-"} if may_see_wb else set()
    if families:
        _record(pg, current, families)

    acked = {r[0]: r[1] for r in pg.execute(text("""
        SELECT a.alert_id, a.severity FROM platform_alert_ack a WHERE a.emp_id = :e
    """), {"e": me}).all()}

    rows = pg.execute(text("""
        SELECT alert_id, alert_key, kind, title, detail, severity,
               opened_at, since_at, resolved_at,
               EXTRACT(EPOCH FROM (now() - COALESCE(since_at, opened_at)))
                   AS running_seconds,
               EXTRACT(EPOCH FROM (COALESCE(resolved_at, now())
                                   - COALESCE(since_at, opened_at))) AS ran_seconds
          FROM platform_alert
         WHERE (resolved_at IS NULL OR resolved_at > now() - :window)
           AND alert_key LIKE 'wb-agent-%'
         ORDER BY resolved_at NULLS FIRST, opened_at DESC
    """), {"window": RECOVERED_FOR}).mappings().all()

    out: list[dict] = []
    for r in rows:
        if not may_see_wb:
            continue
        seen_at = acked.get(r["alert_id"])
        # Cleared, and no worse than when it was cleared -> stays cleared.
        if seen_at and SEVERITY_RANK.get(r["severity"], 0) <= SEVERITY_RANK.get(seen_at, 0):
            continue
        resolved = r["resolved_at"] is not None
        mins, said = _ago(r["running_seconds"])
        out.append({
            "id": r["alert_id"],
            "key": r["alert_key"],
            "severity": "OK" if resolved else r["severity"],
            "kind": r["kind"],
            "title": (r["title"].replace("is not sending readings", "is sending readings again")
                      if resolved else r["title"]),
            "detail": (
                f"Back at {r['resolved_at']:%d %b %H:%M}. It was out for "
                f"{_span(r['ran_seconds'])}."
                if resolved else r["detail"]),
            "since": (r["since_at"] or r["opened_at"]).isoformat(),
            "minutes": None if mins == float("inf") else round(mins),
            "page": "weighbridge",
            "resolved": resolved,
        })

    out.sort(key=lambda a: (a["severity"] == "OK",
                            a["severity"] != "DOWN",
                            -(a["minutes"] or 0)))
    return {
        "alerts": out,
        "count": len(out),
        "worst": ("DOWN" if any(a["severity"] == "DOWN" for a in out)
                  else "WARN" if any(a["severity"] == "WARN" for a in out)
                  else "OK" if out else None),
    }


@router.post("/clear")
def clear(request: Request, pg: Session = Depends(get_minehub_db)) -> dict:
    """Mark everything currently showing as read, for the person who clicked.

    Not a delete. The fault is still happening and the history is still the
    history; this records that one reader has seen it at this severity. If it
    gets worse, it is news again and comes back.
    """
    me = _me(request)
    if not me:
        return {"cleared": 0}
    n = pg.execute(text("""
        INSERT INTO platform_alert_ack (alert_id, emp_id, severity)
        SELECT alert_id, :e,
               CASE WHEN resolved_at IS NOT NULL THEN 'DOWN' ELSE severity END
          FROM platform_alert
         WHERE resolved_at IS NULL OR resolved_at > now() - :window
        ON CONFLICT (alert_id, emp_id)
        DO UPDATE SET acked_at = now(), severity = EXCLUDED.severity
    """), {"e": me, "window": RECOVERED_FOR}).rowcount
    pg.commit()
    return {"cleared": int(n or 0)}


@router.get("/history")
def history(request: Request,
            days: int = Query(30, ge=1, le=365),
            pg: Session = Depends(get_minehub_db)) -> list[dict]:
    """Every episode in the window, open or closed, newest first.

    This is the thing that was missing when WB3 went quiet: not "is it down"
    but "how often does this happen, and for how long". A bridge that drops for
    ten minutes every morning is a different problem from one that died on
    Saturday, and only the history tells them apart.
    """
    if not (_held(request) & {"wb.view", "access.users.view"}):
        return []
    out = []
    for r in pg.execute(text("""
        SELECT alert_id, alert_key, kind, title, severity,
               opened_at, since_at, resolved_at, last_seen_at,
               -- Measured by the clock that wrote both ends of it. Doing this
               -- in Python against datetime.now() added the app server's
               -- 411-second lead over this database to every open episode.
               EXTRACT(EPOCH FROM (COALESCE(resolved_at, now())
                                   - COALESCE(since_at, opened_at))) AS lasted_seconds
          FROM platform_alert
         WHERE opened_at > now() - make_interval(days => :d)
         ORDER BY opened_at DESC LIMIT 200
    """), {"d": days}).mappings().all():
        began = r["since_at"] or r["opened_at"]
        out.append({
            **dict(r),
            "began": began.isoformat() if began else None,
            "lasted": _span(r["lasted_seconds"]),
            "ongoing": r["resolved_at"] is None,
        })
    return out
