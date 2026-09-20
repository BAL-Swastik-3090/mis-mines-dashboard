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

# Contract workmen are recorded under the contractor's own numbering, and the
# readers know them by exactly those numbers — the 211 CLL workmen are all
# enrolled in SmartFace under their 17xxx codes. This wider set is used by the
# attendance register; the shift board keeps the narrower one until the mine
# decides to widen it, because that would change what a live screen shows.
ALL_IDENTITY_SYSTEMS = IDENTITY_SYSTEMS + ("CONTRACTOR",)


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


def register(db: Session, systems: tuple[str, ...] = ALL_IDENTITY_SYSTEMS) -> list[dict]:
    """Everyone on the register who can be matched to a reader, with the facts
    the attendance table shows beside their punches.

    Read from the platform in one query rather than joined per row: the
    register is the small side and the punches are the large one, so the shape
    of this decides whether the screen is one round trip or two hundred.
    """
    rows = db.execute(text("""
        SELECT DISTINCT ON (o.operator_id)
               o.operator_id, o.operator_ref, p.display_name,
               i.external_code AS emp_no,
               t.name AS trade, t.trade_group, t.operates_equipment,
               e.display_name AS employer, ou.name AS department,
               pl.name AS plant, o.designation
          FROM operator o
          JOIN party p            ON p.party_id = o.party_id
          JOIN party_identity i   ON i.party_id = o.party_id
          LEFT JOIN trade t       ON t.trade_id = o.trade_id
          LEFT JOIN party e       ON e.party_id = o.employer_party_id
          LEFT JOIN org_unit ou   ON ou.org_unit_id = o.org_unit_id
          LEFT JOIN plant pl      ON pl.plant_id = o.plant_id
         WHERE o.profile_status = 'ACTIVE'
           AND i.system = ANY(:systems) AND i.external_code IS NOT NULL
         ORDER BY o.operator_id, array_position(:systems, i.system)
    """), {"systems": list(systems)}).mappings().all()
    return [{**dict(r), "emp_no": (r["emp_no"] or "").strip()} for r in rows]


# EmpNo -> the reader database's own integer id, cached for the process.
#
# Filtering punches by EmpNo means LTRIM(RTRIM()) on a joined column, which
# stops SQL Server using its index on a 3.7-million-row table: one day took
# 7.5 seconds. Resolving the numbers to ids first and filtering on the indexed
# integer takes 1.7. The map is five thousand rows and half a second, and
# enrolment changes when somebody joins the mine.
_EMP_IDS: dict[str, int] = {}
_EMP_IDS_AT: float = 0.0
_EMP_TTL = 900.0


def _employee_ids(cur) -> dict[str, int]:
    global _EMP_IDS, _EMP_IDS_AT
    import time
    if _EMP_IDS and time.monotonic() - _EMP_IDS_AT < _EMP_TTL:
        return _EMP_IDS
    cur.execute("SELECT ID, LTRIM(RTRIM(EmpNo)) AS emp_no FROM dbo.tblMEmployee")
    _EMP_IDS = {r["emp_no"]: r["ID"] for r in cur.fetchall() if r["emp_no"]}
    _EMP_IDS_AT = time.monotonic()
    return _EMP_IDS


def punch_days(day_from: date | str, day_to: date | str,
               emp_nos: list[str]) -> dict[tuple[str, str], dict]:
    """Every punch day in a range, keyed by (employee number, date).

    One query for the whole range and the whole roll. The alternative — a query
    per day — is thirty round trips to another site for a month's table, and
    the reader database is shared with the HR application people are using
    while this runs.

    First in and last out rather than every punch, because that is what a day
    row shows; the individual punches are a separate question and a separate
    query, asked only when somebody opens one person.
    """
    if not configured() or not emp_nos:
        return {}

    frm = day_from.isoformat() if isinstance(day_from, date) else str(day_from)[:10]
    to = day_to.isoformat() if isinstance(day_to, date) else str(day_to)[:10]
    wanted = sorted({e.strip() for e in emp_nos if e and e.strip()})
    if not wanted:
        return {}

    try:
        with _connect() as conn:
            with conn.cursor(as_dict=True) as cur:
                ids = _employee_ids(cur)
                mine = {ids[e]: e for e in wanted if e in ids}
                if not mine:
                    return {}
                placeholders = ", ".join(["%d"] * len(mine))
                cur.execute(f"""
                    SELECT a.EmployeeID                                     AS emp_id,
                           a.AttendanceDate                                 AS on_date,
                           MIN(CASE WHEN a.InOutMode = 1 THEN a.PunchTime END) AS first_in,
                           MAX(CASE WHEN a.InOutMode = 2 THEN a.PunchTime END) AS last_out,
                           COUNT(*)                                         AS punches,
                           COUNT(DISTINCT a.DeviceID)                       AS devices
                      FROM Attendance.tblTAttendanceData a
                     WHERE a.AttendanceDate BETWEEN %s AND %s
                       AND a.EmployeeID IN ({placeholders})
                     GROUP BY a.EmployeeID, a.AttendanceDate
                """, tuple([frm, to] + list(mine)))
                rows = cur.fetchall()
    except Exception:                  # noqa: BLE001 — the register still works
        logger.warning("Attendance readers unreachable for %s..%s", frm, to, exc_info=True)
        raise

    return {
        (mine[r["emp_id"]], r["on_date"].isoformat()): {
            "first_in": r["first_in"],
            "last_out": r["last_out"],
            "punches": int(r["punches"] or 0),
            "devices": int(r["devices"] or 0),
        }
        for r in rows if r["emp_id"] in mine
    }


def punches_on(day: date | str, emp_no: str) -> list[dict]:
    """Every punch one person made on one day, in order, with the reader that
    took it. This is what a day row expands into."""
    if not configured() or not emp_no:
        return []
    on = day.isoformat() if isinstance(day, date) else str(day)[:10]
    sql = """
        SELECT a.PunchTime, a.InOutMode, a.DeviceID,
               d.Name AS device_name
        FROM Attendance.tblTAttendanceData a
        JOIN dbo.tblMEmployee e ON e.ID = a.EmployeeID
        LEFT JOIN dbo.tblMDevice d ON d.ID = a.DeviceID
        WHERE a.AttendanceDate = %s AND LTRIM(RTRIM(e.EmpNo)) = %s
        ORDER BY a.PunchTime
    """
    with _connect() as conn:
        with conn.cursor(as_dict=True) as cur:
            cur.execute(sql, (on, emp_no.strip()))
            return [{
                "at": r["PunchTime"],
                "direction": "IN" if r["InOutMode"] == 1 else "OUT",
                "device": (r["device_name"] or f"reader {r['DeviceID']}").strip(),
            } for r in cur.fetchall()]


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
