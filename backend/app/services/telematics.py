"""What the machines actually did, according to the boxes on them.

Two feeds, both in the shared MySQL: one for the MAN tippers, one for everything
else. They have the same shape, so they are read as one.

WHAT A ROW MEANS. Each row is a reading for a machine on a day: engine time, of
which some was moving and some idling, plus distance and fuel. On a finished day
there is normally one row per machine; while a day is still running the poller
writes several, and their figures are not cumulative in any order that can be
relied on. So the latest reading of the day is taken as the day's figure, and
the number of readings is carried alongside it — a screen that says "6.7 hours"
from four disagreeing readings should be able to say so rather than pretending.

WHAT THIS IS NOT. It is not production. The weighbridge records despatch trucks
belonging to transporters, not the mine's own machines, so tonnage does not join
to a deployment through this route. Saying so is better than inventing a join
that looks right and is not.

IDENTITY. The feeds name machines as the telematics box names them — MAN18,
BAL_JCB_3DX/OD04L0327 — which is not what the register calls them. They are
joined through asset_identity, the same mapping the equipment screen fills in.
A machine transmitting under a name nobody has linked is reported as exactly
that, rather than being guessed at by string similarity: MAN18 and MAN-18 are
the same machine, and MAN18 and MAN81 are not, and no amount of fuzzy matching
knows which case it is looking at.
"""
from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

FEEDS = (
    ("mines_technoton_man_utilization", "MAN"),
    ("mines_technoton_rest_equipment_utilization", "REST"),
)


def readings_for(corp: Session, on: date | str) -> dict[str, dict]:
    """Every machine the telematics saw on a day, keyed by the name it uses.

    One query per feed rather than one per machine: this is read for a whole
    shift board at a time, and the database is at the end of a WAN link.
    """
    day = on.isoformat() if isinstance(on, date) else str(on)[:10]
    out: dict[str, dict] = {}

    for table, feed in FEEDS:
        try:
            rows = corp.execute(text(f"""
                SELECT t.vehicle_desc,
                       TIME_TO_SEC(t.engine_hours) / 3600.0            AS engine_hours,
                       TIME_TO_SEC(t.in_motion_engine_hours) / 3600.0  AS moving_hours,
                       TIME_TO_SEC(t.idling_engine_hours) / 3600.0     AS idle_hours,
                       t.distance, t.fuel_consumed, t.avg_speed, t.max_speed,
                       t.tripDate                                      AS read_at,
                       c.readings
                FROM {table} t
                JOIN (
                    SELECT vehicle_desc, MAX(tripDate) AS latest, COUNT(*) AS readings
                    FROM {table} WHERE DATE(tripDate) = :day
                    GROUP BY vehicle_desc
                ) c ON c.vehicle_desc = t.vehicle_desc AND c.latest = t.tripDate
                WHERE DATE(t.tripDate) = :day
            """), {"day": day}).mappings().all()
        except Exception:                      # noqa: BLE001 — a feed being down
            logger.warning("Telematics feed %s unavailable", table, exc_info=True)
            continue

        for r in rows:
            out[r["vehicle_desc"]] = {
                "feed": feed,
                "vehicle_desc": r["vehicle_desc"],
                "engine_hours": float(r["engine_hours"] or 0),
                "moving_hours": float(r["moving_hours"] or 0),
                "idle_hours": float(r["idle_hours"] or 0),
                "distance": float(r["distance"] or 0),
                "fuel_consumed": float(r["fuel_consumed"] or 0),
                "avg_speed": float(r["avg_speed"] or 0),
                "max_speed": float(r["max_speed"] or 0),
                "read_at": r["read_at"],
                # More than one reading on a day that has not finished is normal;
                # the figure above is the latest of them, and this says how many
                # there were so nobody has to assume.
                "readings": int(r["readings"] or 1),
            }
    return out


def identity_map(db: Session) -> dict[str, int]:
    """Telematics name → asset, as the register has been told.

    Only what somebody has actually linked. An unlinked name stays unlinked
    here, because the point of the mapping is that it was decided by a person.
    """
    rows = db.execute(text("""
        SELECT external_code, asset_id FROM asset_identity
        WHERE system = 'TELEMATICS' AND external_code IS NOT NULL
    """)).mappings().all()
    return {r["external_code"]: r["asset_id"] for r in rows}
