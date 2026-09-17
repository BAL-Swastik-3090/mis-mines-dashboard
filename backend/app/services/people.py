"""Employee ids, turned into the names people recognise.

The platform stores who did something as the id the intranet authenticates —
"3101" — because that is the only identifier guaranteed to be stable and unique.
An audit trail written in employee numbers is technically complete and
practically unreadable: nobody reviewing a register recognises the person who
changed it, so nobody checks.

Names live in the MySQL employee master, which is a read-only source shared with
every other application on the box and already close to its connection ceiling.
So lookups are batched and cached, and a failure falls back to the id rather
than failing the screen — a trail showing "3101" is worse than one showing the
name, but far better than no trail.
"""
from __future__ import annotations

import logging
import time

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

EMP_TBL = "sap_employee_details"
_TTL = 300.0                       # names change rarely; five minutes is plenty
_cache: dict[str, tuple[str, float]] = {}


def names_for(db: Session, emp_ids: list[str]) -> dict[str, str]:
    """Map employee ids to names, for the ones that can be found."""
    wanted = {e for e in emp_ids if e and e.strip()}
    if not wanted:
        return {}

    now = time.monotonic()
    out = {e: v for e, (v, at) in _cache.items() if e in wanted and now - at < _TTL}
    missing = sorted(wanted - out.keys())
    if not missing:
        return out

    try:
        stmt = text(f"SELECT EMPID, EMPNAME FROM {EMP_TBL} WHERE EMPID IN :ids").bindparams(
            bindparam("ids", expanding=True))
        for row in db.execute(stmt, {"ids": missing}).mappings():
            name = (row["EMPNAME"] or "").strip()
            if name:
                out[row["EMPID"]] = name
                _cache[row["EMPID"]] = (name, now)
    except Exception:                       # noqa: BLE001 — the id still works
        logger.warning("Could not read employee names; falling back to ids", exc_info=True)

    return out
