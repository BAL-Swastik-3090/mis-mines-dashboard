"""Carry our own sign-in history out of the shared database and into ours.

WHY. The usage screen read `digital_apps_user_sessions` and
`digital_apps_page_views` in balcorpdb, which every application in the company
writes to. Neither has an index led by `app_source`, so finding our rows meant
reading everybody's — 128,725 scanned for the 606 that are ours. The index
that would fix it is not ours to add: twenty-five applications share that
database.

So the rows are mirrored into minehub, where the index costs nobody anything,
and the screen reads them there. See migration 072.

WHAT IS COPIED. MINES, and nothing else. IMOS was mirrored at first because
the screen could report on it; it no longer does, and 2,273 of its sessions
were sitting in our database being kept current for a page nobody looks at.
Copying data we have no use for is collecting it for nothing.

A COPY, NEVER THE RECORD. balcorpdb stays the place a session is written. This
table can be dropped and rebuilt from the source at any time, and on an empty
database that is exactly what the first pass does.

── WHY IT IS NOT A WATERMARK ON login_at ────────────────────────────────────
A session row keeps changing after it is written. `last_active_at` moves while
somebody works, `logout_at`, `duration_minutes` and `end_reason` arrive when
they leave, and `is_active` flips. "Everything newer than last time" would
copy each session once, in its opening state, and never notice it ended —
every session in the mirror would read as still open.

So the question asked is "everything that CHANGED since last time", on
`last_active_at`, and the watermark is rewound by a margin before each pass.
The margin covers a row written while the previous pass was mid-flight, which
would otherwise fall in the gap between the two runs and never be seen again.

Page views are nearly append-only, but `time_spent_seconds` is written when
the reader leaves the page rather than when they arrive, so those are re-read
over a window too.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# What the screen shows, and therefore all we copy. One application: a tuple
# rather than a bare string because the queries below use IN, and because the
# day another of ours needs reporting on, this is the only line that changes.
APPS = ("MINES",)

# How often a pass runs. The screen holds its assembled answer for sixty
# seconds anyway, so a shorter cycle would buy nothing a reader could see.
SYNC_SECONDS = 45

# How far back each pass re-reads. Covers a row written while the previous
# pass was mid-flight, and a clock difference between the two servers — the
# minehub host has run minutes behind before now, and a margin measured in
# seconds would silently drop rows when it does.
OVERLAP = timedelta(minutes=30)

# The first pass on an empty mirror reads everything. 606 sessions and 2,428
# page views is the whole history since the dashboard opened on 12 September,
# so "everything" is a second's work — but it will not always be, hence the
# batching below rather than one statement holding the lot in memory.
BATCH = 5_000


def _mysql_dt(v):
    """MySQL hands back datetimes; be explicit about nulls rather than hopeful."""
    return v if isinstance(v, datetime) else None


def _since(pg: Session, source_table: str, full: bool) -> datetime:
    """Where this pass starts reading.

    `full` forces the beginning of time, which is what an empty mirror needs
    and what a rebuild asks for.
    """
    if full:
        return datetime(2000, 1, 1)
    row = pg.execute(text(
        "SELECT watermark FROM usage_sync_state WHERE source_table = :t"),
        {"t": source_table}).first()
    if not row or not row[0]:
        return datetime(2000, 1, 1)
    return row[0] - OVERLAP


def _mark(pg: Session, source_table: str, watermark: datetime | None,
          rows: int, error: str | None) -> None:
    pg.execute(text("""
        INSERT INTO usage_sync_state (source_table, watermark, last_run_at,
                                      last_rows, last_error)
        VALUES (:t, :w, now(), :n, :e)
        ON CONFLICT (source_table) DO UPDATE
           SET watermark   = COALESCE(EXCLUDED.watermark, usage_sync_state.watermark),
               last_run_at = EXCLUDED.last_run_at,
               last_rows   = EXCLUDED.last_rows,
               last_error  = EXCLUDED.last_error
    """), {"t": source_table, "w": watermark, "n": rows, "e": error})


def _sync_sessions(db: Session, pg: Session, full: bool) -> int:
    since = _since(pg, "digital_apps_user_sessions", full)
    rows = db.execute(text("""
        SELECT session_id, app_source, emp_id, emp_name, role, department,
               login_at, last_active_at, logout_at, duration_minutes,
               is_active, end_reason, ip_address, device_type, browser, os
          FROM digital_apps_user_sessions
         WHERE app_source IN :apps AND last_active_at >= :since
         ORDER BY last_active_at
    """).bindparams(bindparam("apps", expanding=True)),
        {"apps": list(APPS), "since": since}).mappings().all()

    high = None
    for i in range(0, len(rows), BATCH):
        chunk = [dict(r) for r in rows[i:i + BATCH]]
        for r in chunk:
            r["is_active"] = bool(r["is_active"])
        pg.execute(text("""
            INSERT INTO usage_session (
                session_id, app_source, emp_id, emp_name, role, department,
                login_at, last_active_at, logout_at, duration_minutes,
                is_active, end_reason, ip_address, device_type, browser, os,
                synced_at)
            VALUES (:session_id, :app_source, :emp_id, :emp_name, :role,
                    :department, :login_at, :last_active_at, :logout_at,
                    :duration_minutes, :is_active, :end_reason, :ip_address,
                    :device_type, :browser, :os, now())
            ON CONFLICT (session_id) DO UPDATE SET
                emp_name = EXCLUDED.emp_name, role = EXCLUDED.role,
                department = EXCLUDED.department,
                last_active_at = EXCLUDED.last_active_at,
                logout_at = EXCLUDED.logout_at,
                duration_minutes = EXCLUDED.duration_minutes,
                is_active = EXCLUDED.is_active,
                end_reason = EXCLUDED.end_reason,
                ip_address = EXCLUDED.ip_address,
                device_type = EXCLUDED.device_type,
                browser = EXCLUDED.browser, os = EXCLUDED.os,
                synced_at = now()
        """), chunk)
    if rows:
        high = _mysql_dt(rows[-1]["last_active_at"])

    # A session the source has ended while we were not looking, whose
    # last_active_at is older than the window we re-read. Rare, but a mirror
    # that reports somebody as still signed in three days later is worse than
    # one that is a minute behind.
    stale = pg.execute(text("""
        SELECT session_id FROM usage_session
         WHERE is_active AND last_active_at < :cut"""),
        {"cut": datetime.now() - OVERLAP}).scalars().all()
    if stale:
        live = {r[0] for r in db.execute(text("""
            SELECT session_id FROM digital_apps_user_sessions
             WHERE is_active = 1 AND session_id IN :ids
        """).bindparams(bindparam("ids", expanding=True)),
            {"ids": list(stale)}).all()}
        ended = [s for s in stale if s not in live]
        if ended:
            pg.execute(text("""
                UPDATE usage_session SET is_active = false, synced_at = now()
                 WHERE session_id = ANY(:ids)"""), {"ids": ended})

    _mark(pg, "digital_apps_user_sessions", high, len(rows), None)
    return len(rows)


def _sync_page_views(db: Session, pg: Session, full: bool) -> int:
    since = _since(pg, "digital_apps_page_views", full)
    rows = db.execute(text("""
        SELECT id AS page_view_id, session_id, app_source, emp_id, page_path,
               referrer_path, viewed_at, time_spent_seconds
          FROM digital_apps_page_views
         WHERE app_source IN :apps AND viewed_at >= :since
         ORDER BY viewed_at
    """).bindparams(bindparam("apps", expanding=True)),
        {"apps": list(APPS), "since": since}).mappings().all()

    for i in range(0, len(rows), BATCH):
        chunk = [dict(r) for r in rows[i:i + BATCH]]
        pg.execute(text("""
            INSERT INTO usage_page_view (
                page_view_id, session_id, app_source, emp_id, page_path,
                referrer_path, viewed_at, time_spent_seconds, synced_at)
            VALUES (:page_view_id, :session_id, :app_source, :emp_id,
                    :page_path, :referrer_path, :viewed_at,
                    :time_spent_seconds, now())
            ON CONFLICT (page_view_id) DO UPDATE SET
                -- The only field that changes after the fact: it is written
                -- when the reader leaves the page, not when they arrive.
                time_spent_seconds = EXCLUDED.time_spent_seconds,
                synced_at = now()
        """), chunk)

    high = _mysql_dt(rows[-1]["viewed_at"]) if rows else None
    _mark(pg, "digital_apps_page_views", high, len(rows), None)
    return len(rows)


def run_once(db: Session, pg: Session, full: bool = False) -> dict:
    """One pass. Commits, and says what it carried.

    `full` re-reads everything, which is what an empty mirror gets and what a
    rebuild asks for. Each table is committed separately: if page views fail,
    the sessions that already landed should stay landed rather than be rolled
    back into a gap.
    """
    out: dict = {"sessions": 0, "page_views": 0, "errors": []}

    empty = pg.execute(text("SELECT NOT EXISTS (SELECT 1 FROM usage_session)")).scalar()
    full = bool(full or empty)

    for name, fn, key in (("digital_apps_user_sessions", _sync_sessions, "sessions"),
                          ("digital_apps_page_views", _sync_page_views, "page_views")):
        try:
            out[key] = fn(db, pg, full)
            pg.commit()
        except Exception as exc:                        # noqa: BLE001
            pg.rollback()
            out["errors"].append(f"{name}: {type(exc).__name__}: {exc}")
            logger.warning("usage sync failed for %s", name, exc_info=True)
            try:
                _mark(pg, name, None, 0, f"{type(exc).__name__}: {exc}")
                pg.commit()
            except Exception:                           # noqa: BLE001
                pg.rollback()
    return out


def freshness(pg: Session) -> dict:
    """How old the mirror is, for the screen to admit to.

    A figure whose age cannot be established is a figure nobody can defend,
    and this one is by design a little behind.
    """
    rows = pg.execute(text("""
        SELECT source_table, watermark, last_run_at, last_rows, last_error
          FROM usage_sync_state""")).mappings().all()
    if not rows:
        return {"ready": False, "seconds_old": None, "error": None}
    oldest = min((r["last_run_at"] for r in rows if r["last_run_at"]), default=None)
    err = next((r["last_error"] for r in rows if r["last_error"]), None)
    age = None
    if oldest is not None:
        age = pg.execute(text("SELECT EXTRACT(EPOCH FROM (now() - :t))"),
                         {"t": oldest}).scalar()
        age = int(age) if age is not None else None
    return {"ready": True, "seconds_old": age, "error": err}
