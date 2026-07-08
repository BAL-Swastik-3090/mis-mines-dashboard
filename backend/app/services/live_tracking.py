from sqlalchemy import text
from sqlalchemy.orm import Session
import re

# ---------------------------------------------------------------------------
# Tank capacity estimates (litres) — based on published specs.
# TODO: verify against actual fill-up records and update these values.
# ---------------------------------------------------------------------------
TANK_CAPACITY: dict[str, float] = {
    # MAN tippers – MAN TGS / TGM series ~200-220 L standard tank
    "MAN": 200.0,
    # Z AXIS 220 excavator – Zoomlion ZE220E  ~300 L
    "Z AXIS 220": 300.0,
    # Z AXIS 370 excavator – Zoomlion ZE370E  ~500 L
    "Z AXIS 370": 500.0,
    # Z AXIS 450 excavator – Zoomlion ZE450E  ~550 L
    "Z AXIS 450": 550.0,
    # Z AXIS 470 excavator – Zoomlion ZE470E  ~600 L
    "Z AXIS 470": 600.0,
    # CAT Grader – CAT 140M               ~265 L
    "CAT GRADER": 265.0,
    # CAT Dozer D6R                        ~530 L
    "DOZER CAT D6R": 530.0,
    # DOZER BD65 – BEML BD65               ~480 L
    "DOZER BD65": 480.0,
    # JCB 3DX                              ~80 L
    "JCB": 80.0,
    # Soil Compactor / Hydra               ~150 L (generic)
    "DEFAULT": 150.0,
}


def _resolve_tank_capacity(vehicle_desc: str) -> float:
    vd = vehicle_desc.upper()
    for key, cap in TANK_CAPACITY.items():
        if key in vd:
            return cap
    return TANK_CAPACITY["DEFAULT"]


def _category_from_desc(vehicle_desc: str) -> str:
    vd = vehicle_desc.upper()
    if "EXCAVATOR" in vd or "Z AXIS" in vd:
        return "Excavator"
    if "GRADER" in vd:
        return "Grader"
    if "DOZER" in vd:
        return "Dozer"
    if "JCB" in vd:
        return "JCB"
    if "COMPACTOR" in vd:
        return "Soil Compactor"
    if "HYDRA" in vd:
        return "Hydra"
    if "DRILL" in vd:
        return "Driller"
    if "TANKER" in vd:
        return "Diesel Tanker"
    # MAN trucks are tippers
    return "Tipper"


def _time_to_hours(t) -> float:
    """Convert TIME value (timedelta or HH:MM:SS string) to decimal hours."""
    if t is None:
        return 0.0
    if hasattr(t, "total_seconds"):
        return round(t.total_seconds() / 3600, 2)
    # string form  "HH:MM:SS"
    parts = str(t).split(":")
    try:
        return round(int(parts[0]) + int(parts[1]) / 60 + float(parts[2]) / 3600, 2)
    except Exception:
        return 0.0


def _clean_name(vehicle_desc: str) -> str:
    """Return a short display name: strip BAL_ prefix and trailing (Excavator) etc."""
    name = re.sub(r"^BAL_", "", vehicle_desc, flags=re.IGNORECASE)
    name = re.sub(r"\s*\(.*?\)\s*$", "", name).strip()
    return name


# Latest record per vehicle for today — using MAX(row_id) to get most recent sync
_QUERY = """
SELECT
    v.vehicle_desc,
    v.engine_hours,
    v.avg_speed,
    v.max_speed,
    v.distance,
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
    WHERE report_date = CURDATE()
    GROUP BY vehicle_desc
) latest ON v.vehicle_desc = latest.vehicle_desc AND v.row_id = latest.latest_id
ORDER BY v.vehicle_desc
"""


def get_live_tracking(db: Session) -> dict:
    vehicles = []

    for table, source in [
        ("mines_technoton_man_utilization", "man"),
        ("mines_technoton_rest_equipment_utilization", "equipment"),
    ]:
        rows = db.execute(text(_QUERY.format(table=table))).fetchall()
        for row in rows:
            (
                vehicle_desc, engine_hours, avg_speed, max_speed,
                distance, fuel_consumed, lph,
                initial_fuel_level, final_fuel_level,
                total_fillings, total_drains,
                filled, drained, trip_date,
            ) = row

            has_data = float(initial_fuel_level or 0) > 0

            tank_cap = _resolve_tank_capacity(vehicle_desc)

            vehicles.append({
                "vehicle_desc": vehicle_desc,
                "display_name": _clean_name(vehicle_desc),
                "category": _category_from_desc(vehicle_desc),
                "source": source,
                "has_data": has_data,
                # engine
                "engine_hours": _time_to_hours(engine_hours),
                # speed
                "avg_speed": float(avg_speed or 0),
                "max_speed": float(max_speed or 0),
                # movement
                "distance_km": float(distance or 0),
                # fuel
                "fuel_consumed": float(fuel_consumed or 0),
                "lph": float(lph or 0),
                "initial_fuel_level": float(initial_fuel_level or 0),
                "final_fuel_level": float(final_fuel_level or 0),
                "tank_capacity": tank_cap,
                # events
                "total_fillings": int(total_fillings or 0),
                "total_drains": int(total_drains or 0),
                "filled_litres": float(filled or 0),
                "drained_litres": float(drained or 0),
                # meta
                "last_seen": trip_date.isoformat() if trip_date else None,
            })

    # Sort: data-having vehicles first, then by category, then by name
    CATEGORY_ORDER = ["Tipper", "Diesel Tanker", "Excavator", "Grader", "Dozer", "JCB", "Compactor", "Hydra", "Drill"]
    def sort_key(v):
        cat_idx = CATEGORY_ORDER.index(v["category"]) if v["category"] in CATEGORY_ORDER else 99
        return (0 if v["has_data"] else 1, cat_idx, v["display_name"])

    vehicles.sort(key=sort_key)
    return {"vehicles": vehicles, "count": len(vehicles)}
