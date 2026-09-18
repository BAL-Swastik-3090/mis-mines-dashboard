"""Who actually came in, according to the face readers at the gate.

The mine already runs SmartFace: readers at the gates write to an MSSQL
database, and an HR application reads it. This platform reads the same punches
and nothing else — it never writes there, never corrects them, and never
becomes a second version of attendance. Where the two disagree, SmartFace is
right and this is stale.

WHY IT MATTERS HERE. Deployment readiness asks whether an operator is present,
and until now the only answer came from a supervisor ticking boxes on a screen
at half past five in the morning. A gate reader already knows. Taking presence
from the reader means the shift board starts the day half-filled and the
supervisor corrects the exceptions rather than entering the roll.

WHAT IT CANNOT SAY. A punch at the gate is not presence on a machine, and this
distinction is kept: the punch sets availability, which is one of the things
readiness reads, and nothing here decides that somebody operated anything.
Someone who punched in and went to the workshop is present and undeployed, and
that is the correct answer rather than a gap.

A punch is also not a decision. When the reader says nothing about a person —
no punch either way — that is recorded as nothing, not as absence. The mine has
gates people walk through without punching, and an operator marked absent by
silence is an operator who cannot be deployed for a reason nobody can see.
"""
from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# The systems whose codes are the same numbers the readers know people by. The
# driver master's own codes are in there too — five digits that turned out to
# exist in SmartFace, which is what makes this join possible at all.
IDENTITY_SYSTEMS = ("SAP", "HRMS", "DRIVER_MASTER")


def configured() -> bool:
    """Whether the mine has told this platform where the readers write."""
    return bool(settings.frs_host and settings.frs_user)


def _connect():
    import pymssql                     # imported here so a missing driver is a
                                       # feature being off, not the app failing
    return pymssql.connect(
        server=settings.frs_host, port=settings.frs_port,
        user=settings.frs_user, password=settings.frs_password,
        database=settings.frs_database, timeout=30, login_timeout=15,
    )


def punches_for(day: date | str, emp_nos: list[str]) -> dict[str, dict]:
    """First in and last out per person on a day, for the people asked about.

    One query for everybody rather than the stored procedure the HR application
    uses, which takes a single employee: a shift board asks about a hundred and
    thirty people at once, and a hundred and thirty round trips to another site
    is a screen nobody waits for.
    """
    if not configured() or not emp_nos:
        return {}

    on = day.isoformat() if isinstance(day, date) else str(day)[:10]
    wanted = sorted({e.strip() for e in emp_nos if e and e.strip()})
    if not wanted:
        return {}

    placeholders = ", ".join(["%s"] * len(wanted))
    sql = f"""
        SELECT e.EmpNo,
               e.Name,
               MIN(CASE WHEN a.InOutMode = 1 THEN a.PunchTime END) AS first_in,
               MAX(CASE WHEN a.InOutMode = 2 THEN a.PunchTime END) AS last_out,
               COUNT(*)                                            AS punches
        FROM Attendance.tblTAttendanceData a
        JOIN dbo.tblMEmployee e ON e.ID = a.EmployeeID
        WHERE a.AttendanceDate = %s AND e.EmpNo IN ({placeholders})
        GROUP BY e.EmpNo, e.Name
    """

    try:
        with _connect() as conn:
            with conn.cursor(as_dict=True) as cur:
                cur.execute(sql, tuple([on] + wanted))
                rows = cur.fetchall()
    except Exception:                  # noqa: BLE001 — the board still works
        logger.warning("Attendance readers unreachable for %s", on, exc_info=True)
        raise

    return {
        r["EmpNo"]: {
            "emp_no": r["EmpNo"],
            "name": r["Name"],
            "first_in": r["first_in"],
            "last_out": r["last_out"],
            "punches": int(r["punches"] or 0),
        }
        for r in rows
    }


def operator_codes(db: Session) -> dict[int, str]:
    """Operator → the employee number the readers know them by.

    The first identity found among the systems that use that numbering. An
    operator with none is simply not in the answer: they cannot be matched, and
    guessing by name is how two people called Sahoo become one.
    """
    rows = db.execute(text("""
        SELECT DISTINCT ON (o.operator_id) o.operator_id, i.external_code
        FROM operator o
        JOIN party_identity i ON i.party_id = o.party_id
        WHERE o.profile_status = 'ACTIVE'
          AND i.system = ANY(:systems) AND i.external_code IS NOT NULL
        ORDER BY o.operator_id,
                 array_position(:systems, i.system)
    """), {"systems": list(IDENTITY_SYSTEMS)}).mappings().all()
    return {r["operator_id"]: r["external_code"].strip() for r in rows}
