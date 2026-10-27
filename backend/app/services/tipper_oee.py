"""OEE for the tipper fleet — old (MAN) and new (PRIMA), as two tables.

Asked for by the mine on 26 October 2026, to sit below the excavator tables and
reproduce the workbook they keep by hand.

── THE FORMULAE, AS THE MINE STATED THEM ────────────────────────────────────
    Availability = (God Hrs − BD Hrs) ÷ God Hrs
    Utilisation  = Engine Hrs ÷ (God Hrs − BD Hrs)
    Yield        = Actual Trip ÷ Ideal Trip
    OEE          = Availability × Utilisation × Yield

Availability and Utilisation are the SAME definitions the MIS Equipment screen
and the excavator table already use, so a reader comparing screens sees one
meaning per word. Yield is new here: the excavator table calls its third factor
Performance and measures volume against capacity, while a tipper is measured in
trips against the trips it should have turned.

NOTHING IS CAPPED. The excavator table caps Utilisation at 100 because an
unclosed breakdown notification shrinks its denominator while the machine keeps
working. Here the mine asked for the arithmetic as written, so a figure over
100% is printed as it falls out — it is a visible signal that the breakdown
hours behind it are wrong, which a cap would hide. See the 26 October finding
on unclosed notifications.

── WHERE EACH NUMBER COMES FROM, AND WHY IT DIFFERS BETWEEN THE TWO TABLES ──
                    OLD (MAN)                      NEW (PRIMA)
  God Hrs           days × 24                      days × 24
  Engine Hrs        Technoton telematics           shift log running_hours
  BD Hrs            SAP M2 notifications           shift log breakdown
  Ideal Trip        Engine Hrs × 1.5               fixed per machine
  Actual Trip       shift log, all trip classes    shift log, all trip classes

THE SPLIT IS NOT A PREFERENCE, IT IS WHAT EXISTS. The ten PRIMA tippers have no
Technoton unit (0 rows) and no SAP equipment record (0 notifications), so
neither telematics nor SAP can say anything about them at all. The shift log is
the only place they appear. Confirmed with the mine before building this.

Each row therefore carries `engine_source` and `bd_source` so the table can say
which, rather than one footnote claiming telematics for thirty-seven machines.

── IDEAL TRIP ───────────────────────────────────────────────────────────────
The mine supplied a fixed Ideal Trip per machine. For the MAN fleet every one
of those eighteen figures is EXACTLY its engine hours × 1.5 over 1-21 October —
not approximately, exactly, on all eighteen. They are therefore a rate, not a
constant, and hardcoding them would silently break Yield on every other date
range: a ten-day window would read about half its true yield. So MAN ideal trips
are computed at 1.5 trips per engine-hour and reproduce the mine's own numbers.

PRIMA keeps the supplied constants, because its ideal/running-hours ratio
scatters from 2.38 to 2.96 with no rate behind it, so there is nothing to
compute. That is the mine's decision of 26 October, and it carries a known cost:
PRIMA Yield does not scale with the date range the way MAN Yield does. Agreeing
a trips-per-hour rate for PRIMA would remove it.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import breakdown as bd

OLD, NEW = "old", "new"

TELEMATICS, SHIFT_LOG, SAP = "telematics", "shift_log", "sap"

#: Trips a tipper should turn per engine-hour. The mine's own Ideal Trip column
#: divided by its own Engine Hrs gives exactly this on all 18 working MAN
#: tippers, so it is their figure, not an assumption of ours.
TRIPS_PER_ENGINE_HOUR = 1.5

#: The old fleet, in the mine's order. Listed rather than discovered so a truck
#: that did not work still appears as a row of zeros, which is how the mine's
#: own sheet reads it — MAN12, MAN41, MAN50 and the rest are on the roster.
OLD_TIPPERS: tuple[str, ...] = (
    "MAN11", "MAN12", "MAN14", "MAN18", "MAN20", "MAN41", "MAN43", "MAN49",
    "MAN50", "MAN51", "MAN52", "MAN53", "MAN55", "MAN56", "MAN57", "MAN58",
    "MAN65", "MAN66", "MAN67", "MAN69", "MAN71", "MAN72", "MAN74", "MAN75",
    "MAN77", "MAN80", "MAN81",
)

#: The new fleet with its fixed Ideal Trip, as supplied by the mine.
NEW_TIPPER_IDEAL: dict[str, int] = {
    "PRIMA - 5135": 323, "PRIMA - 5235": 317, "PRIMA - 5335": 342,
    "PRIMA - 5435": 328, "PRIMA - 5535": 338, "PRIMA - 5635": 304,
    "PRIMA - 5735": 246, "PRIMA - 5835": 332, "PRIMA - 5935": 352,
    "PRIMA - 6035": 325,
}

# ── THREE SYSTEMS, THREE SPELLINGS OF THE SAME TRUCK ─────────────────────────
# Telematics says MAN11, the shift log says MAN-11, SAP says
# "MAN-11 (TIPPER)", and the mine's sheet says MAN11. Every join here goes
# through these two functions so the mapping lives in one place; a truck lost to
# a hyphen reads as a truck that did no work, which is indistinguishable from
# the real thing.
def _log_name(display: str) -> str:
    """Display name -> equipment_name in mines_tipper_details."""
    if display.startswith("MAN"):
        return f"MAN-{display[3:]}"
    return display.replace(" - ", "-")          # 'PRIMA - 5135' -> 'PRIMA-5135'


def _sap_name(display: str) -> str:
    """Display name -> DESC_TECH_OBJECT in zpm_iw29_notifications."""
    return f"MAN-{display[3:]} (TIPPER)"


# Engine hours, from the LAST snapshot filed for each vehicle each day. The
# Technoton rows are cumulative within a day, so summing them all would count
# the same hours repeatedly — this is the same guard _last_snap_tipper uses in
# services/equipment.py, and the reason the two screens agree.
_ENGINE_SQL = text("""
    SELECT t.vehicle_desc AS veh,
           ROUND(SUM(TIME_TO_SEC(t.engine_hours) / 3600.0), 2) AS eng
    FROM   mines_technoton_man_utilization t
    JOIN (
        SELECT vehicle_desc, report_date, MAX(tripDate) AS mx
        FROM   mines_technoton_man_utilization
        WHERE  report_date >= :f AND report_date < :t_next
          AND  vehicle_desc LIKE 'MAN%'
        GROUP BY vehicle_desc, report_date
    ) s ON t.vehicle_desc = s.vehicle_desc
       AND t.report_date  = s.report_date
       AND t.tripDate     = s.mx
    GROUP BY t.vehicle_desc
""")

# Trips, running hours and breakdown from the mine's own shift log.
#
# ACTUAL TRIP IS EVERY CLASS THE TRUCK CARRIED, not ore alone: ore, LG, OB,
# silt, boulder, tailing and COB feed. A tipper on overburden all month has
# still turned its trips, and counting only ore would print it as idle. The
# `total` column already holds exactly that sum, and is used rather than
# re-adding the seven parts so this agrees with whatever the mine sees on its
# own entry screen.
#
# Stored as VARCHAR, every one of them, so each needs NULLIF(TRIM(...)) before
# CAST or a blank cell raises instead of counting as nothing.
_SHIFT_SQL = text("""
    SELECT equipment_name AS veh,
           ROUND(SUM(CAST(NULLIF(TRIM(total),         '') AS DECIMAL(12,2))), 2) AS trips,
           ROUND(SUM(CAST(NULLIF(TRIM(running_hours), '') AS DECIMAL(12,2))), 2) AS run_hrs,
           ROUND(SUM(CAST(NULLIF(TRIM(breakdown),     '') AS DECIMAL(12,2))), 2) AS bd_hrs,
           COUNT(DISTINCT Prod_date) AS days_logged
    FROM   mines_tipper_details
    WHERE  Prod_date BETWEEN :f AND :t
    GROUP BY equipment_name
""")


def _f(v: Any) -> float:
    return float(v or 0)


def _pct(num: float, den: float) -> float | None:
    """A percentage, or None when the denominator says the question is empty.

    None, never nought. Zero reads as "it was available and did not run", and
    for a machine whose whole period was breakdown — or whose Ideal Trip is
    zero because it recorded no engine hours — that is the opposite of true.
    """
    return round(num / den * 100.0, 2) if den > 0 else None


def _row(display: str, generation: str, god: float, eng: float, bd_hrs: float,
         ideal: float, actual: float, engine_source: str, bd_source: str,
         days_logged: int) -> dict:
    available = round(god, 2) - round(bd_hrs, 2)

    # ROUNDED BEFORE THE RATIO, NOT AFTER. Engine Hrs x 1.5 gives 311.175 trips,
    # and a truck cannot turn a fifth of a trip. Computing Yield from the
    # unrounded figure while printing the rounded one leaves the row failing its
    # own arithmetic: a reader dividing the two columns on screen would get a
    # different answer from the column beside them, which is exactly the kind of
    # discrepancy that costs a dashboard its credibility.
    ideal  = float(round(ideal))
    actual = float(round(actual))

    availability = _pct(available, god)
    utilisation  = _pct(eng, available)
    yield_pct    = _pct(actual, ideal)

    # OEE only exists where all three factors do. Treating a missing factor as
    # 1.0 would quietly promote a machine with no Ideal Trip above one that
    # worked and fell short.
    oee = (round(availability * utilisation * yield_pct / 10000.0, 2)
           if None not in (availability, utilisation, yield_pct) else None)

    return {
        "machine":        display,
        "generation":     generation,
        "god_hours":      round(god, 2),
        "engine_hrs":     round(eng, 2),
        "bd_hours":       round(bd_hrs, 2),
        "available_hrs":  round(max(available, 0.0), 2),
        "ideal_trip":     round(ideal, 0),
        "actual_trip":    round(actual, 0),
        "availability":   availability,
        "utilisation":    utilisation,
        "yield_pct":      yield_pct,
        "oee":            oee,
        "engine_source":  engine_source,
        "bd_source":      bd_source,
        # How many days of the window this truck appears in the shift log at
        # all. A truck logged on 12 of 21 days has not necessarily been idle for
        # nine — it may simply not have been written down, and Actual Trip
        # cannot tell the two apart.
        "days_logged":    days_logged,
    }


def _roll_up(rows: list[dict], generation: str) -> dict:
    """Weighted roll-up: sum the hours and trips, then apply the formulae once.

    Never an average of the machine percentages — a truck that worked two days
    would count as much as one that worked the month.
    """
    god    = sum(r["god_hours"]   for r in rows)
    eng    = sum(r["engine_hrs"]  for r in rows)
    bd_hrs = sum(r["bd_hours"]    for r in rows)
    ideal  = sum(r["ideal_trip"]  for r in rows)
    actual = sum(r["actual_trip"] for r in rows)
    available = round(god, 2) - round(bd_hrs, 2)

    availability = _pct(available, god)
    utilisation  = _pct(eng, available)
    yield_pct    = _pct(actual, ideal)
    oee = (round(availability * utilisation * yield_pct / 10000.0, 2)
           if None not in (availability, utilisation, yield_pct) else None)

    return {
        "generation":    generation,
        "god_hours":     round(god, 2),
        "engine_hrs":    round(eng, 2),
        "bd_hours":      round(bd_hrs, 2),
        "available_hrs": round(max(available, 0.0), 2),
        "ideal_trip":    round(ideal, 0),
        "actual_trip":   round(actual, 0),
        "availability":  availability,
        "utilisation":   utilisation,
        "yield_pct":     yield_pct,
        "oee":           oee,
        "machine_count": len(rows),
        # Trucks on the roster that the shift log never mentions in this window.
        "unlogged":      [r["machine"] for r in rows if r["days_logged"] == 0],
    }


def get_tipper_oee(db: Session, from_date: date, to_date: date) -> dict:
    """Both tipper tables and their roll-ups, for the selected range."""
    days = (to_date - from_date).days + 1
    god  = max(days, 0) * 24.0

    engine = {r.veh: _f(r.eng)
              for r in db.execute(_ENGINE_SQL,
                                  {"f": from_date,
                                   "t_next": date.fromordinal(to_date.toordinal() + 1)})}

    shift: dict[str, dict] = {}
    for r in db.execute(_SHIFT_SQL, {"f": from_date, "t": to_date}):
        shift[str(r.veh).strip()] = {
            "trips": _f(r.trips), "run": _f(r.run_hrs),
            "bd": _f(r.bd_hrs), "days": int(r.days_logged or 0),
        }

    # SAP breakdown for the MAN fleet, on the same definition every other screen
    # uses — merged per machine, selected by the range it was raised in.
    sap_bd = bd.hours_by(
        db, key="DESC_TECH_OBJECT", from_date=from_date, to_date=to_date,
        where=("MAINTENANCE_PLANT = :plant AND MAIN_WORK_CENTER = :wc"
               " AND NOTIFICATION_TYPE = :ntype"
               " AND DESC_TECH_OBJECT LIKE 'MAN-%'"),
        bind={"plant": "1200", "wc": "MINEAUTO", "ntype": "M2"})

    old_rows = []
    for name in OLD_TIPPERS:
        log = shift.get(_log_name(name), {})
        eng = engine.get(name, 0.0)
        old_rows.append(_row(
            display=name, generation=OLD, god=god, eng=eng,
            bd_hrs=sap_bd.get(_sap_name(name), 0.0),
            # The mine's own rate, so the figures reproduce their sheet and
            # still move when the date range does.
            ideal=eng * TRIPS_PER_ENGINE_HOUR,
            actual=log.get("trips", 0.0),
            engine_source=TELEMATICS, bd_source=SAP,
            days_logged=log.get("days", 0)))

    new_rows = []
    for name, ideal in NEW_TIPPER_IDEAL.items():
        log = shift.get(_log_name(name), {})
        new_rows.append(_row(
            display=name, generation=NEW, god=god,
            # No Technoton unit on these ten, so the shift log is the only
            # record of hours that exists for them.
            eng=log.get("run", 0.0),
            # Read from the shift log's own breakdown column at the mine's
            # instruction. It is zero today for every tipper; this reports
            # whatever is entered, so the column fills itself once they start.
            bd_hrs=log.get("bd", 0.0),
            ideal=float(ideal),
            actual=log.get("trips", 0.0),
            engine_source=SHIFT_LOG, bd_source=SHIFT_LOG,
            days_logged=log.get("days", 0)))

    return {
        "old_machines": old_rows,
        "new_machines": new_rows,
        "old_fleet":    _roll_up(old_rows, OLD),
        "new_fleet":    _roll_up(new_rows, NEW),
    }
