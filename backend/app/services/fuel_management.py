from sqlalchemy import text
from sqlalchemy.orm import Session
from datetime import date, timedelta

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
    WHERE report_date = :target_date
    GROUP BY vehicle_desc
) latest ON v.vehicle_desc = latest.vehicle_desc AND v.row_id = latest.latest_id
ORDER BY v.vehicle_desc
"""

# End-of-day cumulative consumption per vehicle per day, grouped by date
_TREND_QUERY = """
SELECT
    rd.report_date,
    SUM(v.fuel_consumed)         AS total_consumed_l,
    COUNT(DISTINCT v.vehicle_desc) AS vehicle_count
FROM {table} v
INNER JOIN (
    SELECT vehicle_desc, report_date, MAX(row_id) AS latest_id
    FROM {table}
    WHERE report_date BETWEEN :start_date AND :end_date
    GROUP BY vehicle_desc, report_date
) rd ON v.vehicle_desc = rd.vehicle_desc AND v.row_id = rd.latest_id
GROUP BY rd.report_date
"""


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


def _fetch_vehicles(db: Session, target_date: str) -> list:
    vehicles = []
    for table, source in [
        ("mines_technoton_man_utilization", "man"),
        ("mines_technoton_rest_equipment_utilization", "equipment"),
    ]:
        rows = db.execute(
            text(_VEHICLES_QUERY.format(table=table)),
            {"target_date": target_date},
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


def _fetch_trend(db: Session, start_date: str, end_date: str) -> list:
    combined: dict = {}

    for table in [
        "mines_technoton_man_utilization",
        "mines_technoton_rest_equipment_utilization",
    ]:
        rows = db.execute(
            text(_TREND_QUERY.format(table=table)),
            {"start_date": start_date, "end_date": end_date},
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
    SELECT report_date, MAX(row_id) AS latest_id
    FROM {table}
    WHERE vehicle_desc = :vehicle_desc
      AND report_date BETWEEN :start_date AND :end_date
    GROUP BY report_date
) latest ON v.report_date = latest.report_date AND v.row_id = latest.latest_id
WHERE v.vehicle_desc = :vehicle_desc
ORDER BY v.report_date
"""


def get_vehicle_history(db: Session, vehicle_desc: str, days: int = 7) -> dict | None:
    end_date   = date.today() - timedelta(days=1)
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
                "start_date":   start_date.isoformat(),
                "end_date":     end_date.isoformat(),
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
                date_str = (
                    report_date.isoformat()
                    if hasattr(report_date, "isoformat")
                    else str(report_date)
                )
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


def get_fuel_overview(db: Session) -> dict:
    today       = date.today().isoformat()
    yesterday   = (date.today() - timedelta(days=1)).isoformat()
    trend_start = (date.today() - timedelta(days=7)).isoformat()
    trend_end   = yesterday

    today_vehicles     = _fetch_vehicles(db, today)
    yesterday_vehicles = _fetch_vehicles(db, yesterday)
    trend              = _fetch_trend(db, trend_start, trend_end)

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
        "as_of":        today,
        "kpis":         {**today_kpis, "fuel_consumed_yesterday": yesterday_kpis["fuel_consumed_today"]},
        "distribution": distribution,
        "vehicles":     today_vehicles,
        "top_consumers": top_consumers,
        "refills_today": refills_today,
        "trend":         trend,
    }
