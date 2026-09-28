"""Things that are wrong right now, for the people who can do something.

WHY THIS EXISTS. The weighbridge agent at WB3 stopped sending readings on
Saturday morning and nobody knew until somebody thought to ask, two days later.
Nothing was broken in a way that shows: the screen still loads, the bridge
still has a page, and the last reading it ever took sits there looking like a
reading. A machine that has stopped talking looks exactly like a machine with
nothing to say.

So: something that notices silence. An agent that has gone quiet is the first
rule here and the reason for the file; the shape is meant to take others.

WHO SEES WHAT. An alert appears only for somebody who holds a permission that
would let them act on it. A notification you cannot act on is noise, and a
platform that shows everybody everything teaches them to ignore the bell —
which costs you the one alert that mattered.

WHAT IT DOES NOT DO. It does not decide WHY something is quiet. An agent that
has not reported can be a laptop switched off at the end of a shift, a network
port, a serial cable, or a bridge that simply is not weighing today. The alert
says how long it has been silent and stops. That is a fact; the cause belongs
to whoever walks over and looks.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])

# How long an agent may be silent before it is worth saying so.
#
# The agent polls about once a second and posts in batches, so a minute of
# silence is a hiccup and ten is a fact. WARN first rather than straight to a
# red banner: a laptop rebooting should not read the same as a bridge that has
# been dark since Saturday.
AGENT_QUIET_WARN = timedelta(minutes=10)
AGENT_QUIET_DOWN = timedelta(hours=1)


def _held(request: Request) -> set[str]:
    return set(getattr(request.state, "permissions", None) or ())


def _ago(then: datetime | None) -> tuple[float, str]:
    """Minutes since, and how a person would say it."""
    if then is None:
        return (float("inf"), "never")
    now = datetime.now(timezone.utc)
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    mins = (now - then).total_seconds() / 60
    if mins < 1:
        return (mins, "just now")
    if mins < 60:
        return (mins, f"{int(mins)} minutes ago")
    if mins < 60 * 24:
        h = int(mins // 60)
        return (mins, f"{h} hour{'s' if h != 1 else ''} ago")
    d = int(mins // 1440)
    return (mins, f"{d} day{'s' if d != 1 else ''} ago")


@router.get("/live")
def live(request: Request, pg: Session = Depends(get_minehub_db)) -> dict:
    """Everything wrong that this person could act on.

    One call, cheap enough to poll. Returns the alerts and a count, so the bell
    can show a number without a second request asking how many.
    """
    held = _held(request)
    out: list[dict] = []

    # ── weighbridge agents that have gone quiet ──────────────────────────
    #
    # Shown to whoever runs the bridge (wb.view) and to whoever runs the
    # platform (access.users.view). A weighbridge operator can walk over and
    # look at the laptop; IT can reach it. Nobody else can do either.
    if held & {"wb.view", "access.users.view"}:
        for r in pg.execute(text("""
            SELECT w.code, w.name, a.machine_name, a.last_seen_at,
                   a.last_error, a.last_error_at, a.version
              FROM weighbridge_agent a
              JOIN weighbridge w ON w.weighbridge_id = a.weighbridge_id
             WHERE a.status = 'ACTIVE'
             ORDER BY a.last_seen_at NULLS FIRST
        """)).mappings().all():
            mins, said = _ago(r["last_seen_at"])
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
                    f"No weights can be captured at {r['name']} until it is "
                    f"back."
                    + (f" Its last error was: {r['last_error']}"
                       if r["last_error"] else
                       " It stopped without reporting an error, which usually "
                       "means the machine was switched off or lost the network "
                       "rather than the agent failing.")
                ),
                "since": r["last_seen_at"].isoformat() if r["last_seen_at"] else None,
                "minutes": round(mins) if mins != float("inf") else None,
                "page": "weighbridge",
            })

    # Worst first, then longest-standing: a bell with one red line above three
    # amber ones is read; the same four in arrival order are scrolled past.
    out.sort(key=lambda a: (a["severity"] != "DOWN", -(a["minutes"] or 0)))
    return {
        "alerts": out,
        "count": len(out),
        "worst": ("DOWN" if any(a["severity"] == "DOWN" for a in out)
                  else "WARN" if out else None),
    }
