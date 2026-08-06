from sqlalchemy import text
from sqlalchemy.orm import Session
from datetime import date, datetime, timedelta

from app.services.live_tracking import (
    _resolve_tank_capacity,
    _category_from_desc,
    _time_to_hours,
    _clean_name,
)

# Latest record per vehicle for a specific date using MAX(row_id)
_VEHICLES_QUERY = """
SELECT
    v.vehicle_desc,
    v.engine_hours,
    v.fuel_consumed,
    v.lph,
    v.initial_fuel_level,
    v.final_fuel_level,
    v.total_fillings,
    v.total_drains,
    v.filled,
    v.drained,
    v.tripDate
FROM {table} v
INNER JOIN (
    SELECT vehicle_desc, MAX(row_id) AS latest_id
    FROM {table}
    WHERE report_date >= :day_start AND report_date < :day_next
    GROUP BY vehicle_desc
) latest ON v.vehicle_desc = latest.vehicle_desc AND v.row_id = latest.latest_id
ORDER BY v.vehicle_desc
"""

# End-of-day cumulative consumption per vehicle per day, grouped by calendar day
_TREND_QUERY = """
SELECT
    DATE(v.report_date)            AS report_day,
    SUM(v.fuel_consumed)           AS total_consumed_l,
    COUNT(DISTINCT v.vehicle_desc) AS vehicle_count
FROM {table} v
INNER JOIN (
    SELECT vehicle_desc, MAX(row_id) AS latest_id
    FROM {table}
    WHERE report_date >= :range_start AND report_date < :range_next
    GROUP BY vehicle_desc, DATE(report_date)
) rd ON v.vehicle_desc = rd.vehicle_desc AND v.row_id = rd.latest_id
GROUP BY DATE(v.report_date)
"""


_TELEMATICS_TABLES = [
    "mines_technoton_man_utilization",
    "mines_technoton_rest_equipment_utilization",
]


def _as_date(v) -> date | None:
    """Normalise a DB value to a plain `date`.

    `report_date` is a DATETIME column (values land at 23:45:59), so MAX() hands
    back a `datetime`. Note `datetime` subclasses `date`, so an isinstance(v, date)
    check alone will silently let a datetime through — check datetime FIRST.
    """
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def _day_bounds(d: date) -> tuple[str, str]:
    """Half-open [start, next) bounds for one day.

    Used instead of `report_date = 'YYYY-MM-DD'`, which matches NOTHING against a
    DATETIME column carrying a time component, and instead of DATE(report_date),
    which would discard the idx_report_date index.
    """
    return d.isoformat(), (d + timedelta(days=1)).isoformat()


def _latest_report_date(db: Session) -> date | None:
    """Newest report_date across both telematics tables — the page's anchor, so
    it always shows the most recent data actually present."""
    latest: date | None = None
    for table in _TELEMATICS_TABLES:
        row = db.execute(text(f"SELECT MAX(report_date) AS mx FROM {table}")).fetchone()
        mx = _as_date(row.mx) if row else None
        if mx and (latest is None or mx > latest):
            latest = mx
    return latest


def _prev_date_with_data(db: Session, anchor: date) -> date | None:
    """Newest day strictly before `anchor` that has rows — day-on-day baseline
    that survives gaps in the feed."""
    prev: date | None = None
    for table in _TELEMATICS_TABLES:
        row = db.execute(
            text(f"SELECT MAX(report_date) AS mx FROM {table} WHERE report_date < :a"),
            {"a": anchor.isoformat()},
        ).fetchone()
        mx = _as_date(row.mx) if row else None
        if mx and (prev is None or mx > prev):
            prev = mx
    return prev


def _fuel_pct(level: float, capacity: float) -> float:
    if capacity <= 0:
        return 0.0
    return round(min(100.0, max(0.0, level / capacity * 100.0)), 1)


def _fuel_status(pct: float, has_data: bool) -> str:
    if not has_data:
        return "no_data"
    if pct >= 50:
        return "good"
    if pct >= 20:
        return "medium"
    return "low"


def _fetch_vehicles(db: Session, target_date: date) -> list:
    day_start, day_next = _day_bounds(target_date)
    vehicles = []
    for table, source in [
        ("mines_technoton_man_utilization", "man"),
        ("mines_technoton_rest_equipment_utilization", "equipment"),
    ]:
        rows = db.execute(
            text(_VEHICLES_QUERY.format(table=table)),
            {"day_start": day_start, "day_next": day_next},
        ).fetchall()

        for row in rows:
            (
                vehicle_desc, engine_hours, fuel_consumed, lph,
                initial_fuel_level, final_fuel_level,
                total_fillings, total_drains, filled, drained, trip_date,
            ) = row

            has_data  = float(initial_fuel_level or 0) > 0
            tank_cap  = _resolve_tank_capacity(vehicle_desc)
            fuel_lvl  = float(final_fuel_level or 0)
            consumed  = float(fuel_consumed or 0)
            lph_val   = float(lph or 0)
            pct       = _fuel_pct(fuel_lvl, tank_cap) if has_data else 0.0
            eng_hrs   = _time_to_hours(engine_hours)

            # Estimated hours remaining at current LPH rate
            est_hrs = round(fuel_lvl / lph_val, 1) if (lph_val > 0 and has_data) else None

            vehicles.append({
                "vehicle_desc":        vehicle_desc,
                "display_name":        _clean_name(vehicle_desc),
                "category":            _category_from_desc(vehicle_desc),
                "source":              source,
                "has_data":            has_data,
                "engine_hours":        eng_hrs,
                "fuel_pct":            pct,
                "fuel_level_l":        fuel_lvl,
                "tank_capacity":       tank_cap,
                "fuel_consumed":       consumed,
                "lph":                 lph_val,
                "est_hours_remaining": est_hrs,
                "total_fillings":      int(total_fillings or 0),
                "total_drains":        int(total_drains or 0),
                "filled_litres":       float(filled or 0),
                "drained_litres":      float(drained or 0),
                "status":              _fuel_status(pct, has_data),
                "last_seen":           trip_date.isoformat() if trip_date else None,
            })

    return vehicles


def _fleet_kpis(vehicles: list) -> dict:
    total       = len(vehicles)
    active      = sum(1 for v in vehicles if v["engine_hours"] > 0)
    with_data   = sum(1 for v in vehicles if v["has_data"])

    fuel_pcts   = [v["fuel_pct"] for v in vehicles if v["has_data"]]
    avg_pct     = round(sum(fuel_pcts) / len(fuel_pcts), 1) if fuel_pcts else 0.0

    total_fuel  = round(sum(v["fuel_level_l"]  for v in vehicles), 1)
    total_cap   = round(sum(v["tank_capacity"]  for v in vehicles), 1)
    fleet_pct   = round(total_fuel / total_cap * 100.0, 1) if total_cap > 0 else 0.0

    consumed_today = round(sum(v["fuel_consumed"]   for v in vehicles), 1)
    total_filled   = round(sum(v["filled_litres"]   for v in vehicles), 1)
    refilled_count = sum(1 for v in vehicles if v["total_fillings"] > 0)

    lph_vals = [v["lph"] for v in vehicles if v["lph"] > 0]
    avg_lph  = round(sum(lph_vals) / len(lph_vals), 1) if lph_vals else 0.0

    excellent = sum(1 for v in vehicles if v["has_data"] and v["fuel_pct"] >= 75)
    good      = sum(1 for v in vehicles if v["has_data"] and 50 <= v["fuel_pct"] < 75)
    medium    = sum(1 for v in vehicles if v["has_data"] and 20 <= v["fuel_pct"] < 50)
    low       = sum(1 for v in vehicles if v["has_data"] and v["fuel_pct"] < 20)
    no_data   = sum(1 for v in vehicles if not v["has_data"])

    return {
        "total_vehicles":      total,
        "active_vehicles":     active,
        "vehicles_with_data":  with_data,
        "avg_fuel_pct":        avg_pct,
        "total_fuel_l":        total_fuel,
        "total_capacity_l":    total_cap,
        "fleet_fuel_pct":      fleet_pct,
        "fuel_consumed_today": consumed_today,
        "total_filled_today":  total_filled,
        "vehicles_refilled":   refilled_count,
        "avg_lph":             avg_lph,
        "excellent_count":     excellent,
        "good_count":          good,
        "medium_count":        medium,
        "low_count":           low,
        "no_data_count":       no_data,
    }


def _fetch_trend(db: Session, start_date: date, end_date: date) -> list:
    # end_date is inclusive, so the half-open upper bound is the day after it
    range_start = start_date.isoformat()
    range_next  = (end_date + timedelta(days=1)).isoformat()
    combined: dict = {}

    for table in [
        "mines_technoton_man_utilization",
        "mines_technoton_rest_equipment_utilization",
    ]:
        rows = db.execute(
            text(_TREND_QUERY.format(table=table)),
            {"range_start": range_start, "range_next": range_next},
        ).fetchall()

        for row in rows:
            report_date, total_consumed, vehicle_count = row
            date_str = (
                report_date.isoformat()
                if hasattr(report_date, "isoformat")
                else str(report_date)
            )
            if date_str not in combined:
                combined[date_str] = {
                    "date":             date_str,
                    "total_consumed_l": 0.0,
                    "vehicle_count":    0,
                }
            combined[date_str]["total_consumed_l"] += float(total_consumed or 0)
            combined[date_str]["vehicle_count"]    += int(vehicle_count or 0)

    for entry in combined.values():
        entry["total_consumed_l"] = round(entry["total_consumed_l"], 1)

    return sorted(combined.values(), key=lambda x: x["date"])


_VEHICLE_HISTORY_QUERY = """
SELECT
    v.report_date,
    v.engine_hours,
    v.fuel_consumed,
    v.lph,
    v.initial_fuel_level,
    v.final_fuel_level,
    v.filled,
    v.drained,
    v.total_fillings,
    v.total_drains
FROM {table} v
INNER JOIN (
    SELECT MAX(row_id) AS latest_id
    FROM {table}
    WHERE vehicle_desc = :vehicle_desc
      AND report_date >= :range_start AND report_date < :range_next
    GROUP BY DATE(report_date)
) latest ON v.row_id = latest.latest_id
WHERE v.vehicle_desc = :vehicle_desc
ORDER BY v.report_date
"""


def get_vehicle_history(db: Session, vehicle_desc: str, days: int = 7) -> dict | None:
    # Anchor on the newest date with data so history isn't empty during feed gaps
    end_date   = _latest_report_date(db) or (date.today() - timedelta(days=1))
    start_date = end_date - timedelta(days=days - 1)

    history: dict = {}
    found_table: str | None = None

    for table in [
        "mines_technoton_man_utilization",
        "mines_technoton_rest_equipment_utilization",
    ]:
        rows = db.execute(
            text(_VEHICLE_HISTORY_QUERY.format(table=table)),
            {
                "vehicle_desc": vehicle_desc,
                "range_start":  start_date.isoformat(),
                "range_next":   (end_date + timedelta(days=1)).isoformat(),
            },
        ).fetchall()

        if rows:
            found_table = table
            for row in rows:
                (
                    report_date, engine_hours, fuel_consumed, lph,
                    initial_fuel_level, final_fuel_level,
                    filled, drained, total_fillings, total_drains,
                ) = row
                # report_date is a DATETIME (23:45:59) — collapse to the day so the
                # chart axis reads "2026-08-06", not "2026-08-06T23:45:59"
                d = _as_date(report_date)
                date_str = d.isoformat() if d else str(report_date)
                has_data = float(initial_fuel_level or 0) > 0
                tank_cap = _resolve_tank_capacity(vehicle_desc)
                fuel_lvl = float(final_fuel_level or 0)
                pct      = _fuel_pct(fuel_lvl, tank_cap) if has_data else 0.0
                history[date_str] = {
                    "date":           date_str,
                    "engine_hours":   _time_to_hours(engine_hours),
                    "fuel_consumed":  round(float(fuel_consumed or 0), 1),
                    "lph":            round(float(lph or 0), 2),
                    "fuel_pct":       pct,
                    "filled_litres":  round(float(filled or 0), 1),
                    "drained_litres": round(float(drained or 0), 1),
                    "total_fillings": int(total_fillings or 0),
                    "total_drains":   int(total_drains or 0),
                }
            break  # vehicle found in this table — no need to check the other

    if not history:
        return None

    return {
        "vehicle_desc":  vehicle_desc,
        "display_name":  _clean_name(vehicle_desc),
        "category":      _category_from_desc(vehicle_desc),
        "tank_capacity": _resolve_tank_capacity(vehicle_desc),
        "source_table":  found_table,
        "from_date":     start_date.isoformat(),
        "to_date":       end_date.isoformat(),
        "days":          sorted(history.values(), key=lambda x: x["date"]),
    }


_VEHICLE_INTRADAY_QUERY = """
SELECT
    v.tripDate,
    v.fuel_consumed,
    v.lph,
    v.final_fuel_level,
    v.engine_hours
FROM {table} v
WHERE v.vehicle_desc = :vehicle_desc
  AND v.report_date >= :day_start AND v.report_date < :day_next
ORDER BY v.tripDate ASC
"""


def get_vehicle_intraday(db: Session, vehicle_desc: str) -> dict | None:
    # Anchor on the newest date with data, not the calendar date
    anchor = _latest_report_date(db) or date.today()
    today = anchor.isoformat()
    day_start, day_next = _day_bounds(anchor)
    rows_found = []
    source_table = None

    for table in [
        "mines_technoton_man_utilization",
        "mines_technoton_rest_equipment_utilization",
    ]:
        rows = db.execute(
            text(_VEHICLE_INTRADAY_QUERY.format(table=table)),
            {"vehicle_desc": vehicle_desc, "day_start": day_start, "day_next": day_next},
        ).fetchall()
        if rows:
            rows_found = rows
            source_table = table
            break

    if not rows_found:
        return None

    tank_cap = _resolve_tank_capacity(vehicle_desc)
    readings = []
    for row in rows_found:
        trip_date, fuel_consumed, lph, final_fuel_level, engine_hours = row
        # Extract HH:MM from tripDate (datetime or string)
        if hasattr(trip_date, "strftime"):
            time_str = trip_date.strftime("%H:%M")
        elif trip_date and "T" in str(trip_date):
            time_str = str(trip_date).split("T")[1][:5]
        elif trip_date and " " in str(trip_date):
            time_str = str(trip_date).split(" ")[1][:5]
        else:
            time_str = str(trip_date or "")[:5]

        fuel_lvl = float(final_fuel_level or 0)
        pct = _fuel_pct(fuel_lvl, tank_cap)
        readings.append({
            "time":          time_str,
            "fuel_level_l":  round(fuel_lvl, 1),
            "fuel_pct":      pct,
            "fuel_consumed": round(float(fuel_consumed or 0), 1),
            "lph":           round(float(lph or 0), 2),
            "engine_hours":  _time_to_hours(engine_hours),
        })

    latest = readings[-1] if readings else None
    return {
        "vehicle_desc":  vehicle_desc,
        "display_name":  _clean_name(vehicle_desc),
        "category":      _category_from_desc(vehicle_desc),
        "tank_capacity": tank_cap,
        "date":          today,
        "reading_count": len(readings),
        "latest":        latest,
        "readings":      readings,
    }


def get_fuel_overview(db: Session) -> dict:
    # Anchor on the newest date that actually has data, not the calendar date.
    anchor_date = _latest_report_date(db) or date.today()
    prev_date   = _prev_date_with_data(db, anchor_date) or (anchor_date - timedelta(days=1))

    # Include the anchor day itself in the 7-day trend window
    trend_start = anchor_date - timedelta(days=6)

    days_stale = (date.today() - anchor_date).days

    today_vehicles     = _fetch_vehicles(db, anchor_date)
    yesterday_vehicles = _fetch_vehicles(db, prev_date)
    trend              = _fetch_trend(db, trend_start, anchor_date)

    today     = anchor_date.isoformat()
    yesterday = prev_date.isoformat()

    today_kpis     = _fleet_kpis(today_vehicles)
    yesterday_kpis = _fleet_kpis(yesterday_vehicles)

    distribution = [
        {"band": ">75%",    "key": "excellent", "count": today_kpis["excellent_count"], "color": "#2ea043"},
        {"band": "50–75%",  "key": "good",      "count": today_kpis["good_count"],      "color": "#0969da"},
        {"band": "20–50%",  "key": "medium",    "count": today_kpis["medium_count"],    "color": "#d29922"},
        {"band": "<20%",    "key": "low",        "count": today_kpis["low_count"],       "color": "#da3633"},
        {"band": "No Data", "key": "no_data",    "count": today_kpis["no_data_count"],   "color": "#6e7681"},
    ]

    top_consumers = sorted(
        [v for v in today_vehicles if v["fuel_consumed"] > 0],
        key=lambda v: v["fuel_consumed"],
        reverse=True,
    )[:5]

    refills_today = sorted(
        [v for v in today_vehicles if v["total_fillings"] > 0],
        key=lambda v: v["filled_litres"],
        reverse=True,
    )

    return {
        "as_of":         today,
        "compared_to":   yesterday,
        "days_stale":    max(0, days_stale),
        "is_stale":      days_stale > 0,
        "kpis":          {**today_kpis, "fuel_consumed_yesterday": yesterday_kpis["fuel_consumed_today"]},
        "distribution":  distribution,
        "vehicles":      today_vehicles,
        "top_consumers": top_consumers,
        "refills_today": refills_today,
        "trend":         trend,
    }
