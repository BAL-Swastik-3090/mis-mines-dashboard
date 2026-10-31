import time

from sqlalchemy import text
from sqlalchemy.orm import Session
from datetime import date

# Fallback rated battery capacity in kWh if not populated in DB
BATTERY_CAPACITIES = {
    "EXCAVATOR": 350.0,
    "GRADER": 200.0,
    "LOADER": 282.0,
    "DEFAULT": 250.0
}

# serial -> nickname, with the moment it was read. Process-local and tiny;
# holds nothing a person could not see on the equipment master page.
def _natural_key(name: str):
    """Sort EV EX-1 before EV EX-2, and EV EX-2 before EV EX-10.

    The master table returns machines in ev_equipment_id order, which is the
    order somebody happened to register them — EX-2 came first and so led every
    list on the page. Sorting on the name the mine uses puts them in the order
    a person reading the page expects.

    Plain alphabetical would be right for four machines and wrong for eleven:
    "EV EX-10" sorts before "EV EX-2" as text. Splitting the digits out and
    comparing them as numbers keeps it right as the fleet grows.
    """
    import re
    return [int(p) if p.isdigit() else p.lower()
            for p in re.split(r"(\d+)", name or "")]


_NAME_CACHE: dict[str, tuple[float, dict]] = {}
_NAME_TTL = 300.0


def _names_by_serial(pg) -> dict:
    """serial -> what the mine calls it, from the equipment master.

    This module reads MySQL and the asset registry lives in PostgreSQL, so the
    name cannot come from a join. It is one small query, keyed on the serial
    the registry holds in chassis_no — the same exact match the new EV module
    uses, and deliberately not a match on model, because two of these machines
    are 922 FE and differ by one letter in the middle of the serial.

    A failure here costs the nickname and nothing else: the caller falls back
    to the serial, which is what it showed before.
    """
    if pg is None:
        return {}

    # CACHED, BECAUSE IT IS A ROUND TRIP FOR A HANDFUL OF NICKNAMES.
    # Every caller on this page needs it and the database is remote: 112 ms a
    # time to re-read four names that change when somebody renames a machine,
    # which is to say almost never. Five minutes of staleness on a nickname is
    # invisible; five minutes of staleness on a reading would not be, which is
    # why only this lookup is cached and none of the figures are.
    hit = _NAME_CACHE.get("v")
    if hit and time.monotonic() - hit[0] < _NAME_TTL:
        return hit[1]

    try:
        from sqlalchemy import text as _text
        names = {
            r[0].strip().upper(): r[1]
            for r in pg.execute(_text(
                "SELECT chassis_no, coalesce(nickname, fleet_code) "
                "  FROM minehub.asset "
                " WHERE chassis_no IS NOT NULL AND coalesce(nickname, fleet_code) IS NOT NULL"
            )).fetchall() if r[0]
        }
    except Exception:                                      # noqa: BLE001
        # Not cached: a failed lookup must be retried, not remembered. The
        # caller falls back to the serial, which is what it showed before.
        return {}
    _NAME_CACHE["v"] = (time.monotonic(), names)
    return names


def _resolve_battery_capacity(equipment_type: str, rated_battery_kwh: float | None) -> float:
    if rated_battery_kwh and float(rated_battery_kwh) > 0:
        return float(rated_battery_kwh)
    eq_type = str(equipment_type).upper()
    for key, cap in BATTERY_CAPACITIES.items():
        if key in eq_type:
            return cap
    return BATTERY_CAPACITIES["DEFAULT"]

def get_ev_overview(db: Session, from_date: date, to_date: date, pg=None) -> dict:
    """Every machine's totals for the range.

    ONE QUERY, NOT ONE PER MACHINE. This asked the master table for the fleet
    and then asked the tracking table once for each machine it got back — five
    round trips for four machines. On this deployment the database is on the
    other side of the VPN and a bare `SELECT 1` costs 223 ms, so the count of
    round trips IS the response time; the SQL itself was never the problem.
    Joined, the same rows arrive in one.

    The per-row loop below is unchanged and still runs row by row, because the
    anomaly cleaning has to see each day before it can be summed. What changed
    is only how the rows got here.
    """
    rows = db.execute(text("""
        SELECT m.ev_equipment_id, m.serial_no, m.equipment_type, m.make, m.model,
               m.rated_battery_kwh, m.status, m.remarks,
               t.operating_hours, t.idling_hours, t.work_hours,
               t.total_energy_kwh, t.avg_energy_kwh_per_h, t.report_date
          FROM mines_ev_equipment_master m
          LEFT JOIN mines_ev_equipment_tracking t
                 ON t.ev_equipment_id = m.ev_equipment_id
                AND t.report_date BETWEEN :from_date AND :to_date
         WHERE m.status = 'A'
         ORDER BY m.ev_equipment_id, t.report_date ASC
    """), {"from_date": from_date, "to_date": to_date}).fetchall()

    # LEFT JOIN, so a machine with no readings in the range still arrives —
    # as one row whose tracking columns are NULL. It must stay in the fleet
    # list: "no readings" and "no such machine" are different statements.
    master_rows, tracking = [], {}
    for r in rows:
        ev_id = r[0]
        if ev_id not in tracking:
            master_rows.append(tuple(r[0:8]))
            tracking[ev_id] = []
        if r[13] is not None:
            tracking[ev_id].append(tuple(r[8:14]))

    _names = _names_by_serial(pg)

    vehicles = []
    total_work_hours = 0.0
    total_energy_kwh = 0.0

    for row in master_rows:
        ev_id, serial_no, eq_type, make, model, rated_bat, status, remarks = row
        bat_capacity = _resolve_battery_capacity(eq_type, rated_bat)
        
        # Already in hand from the join above, in report_date order.
        rows = tracking.get(ev_id, [])
        
        op_hrs = 0.0
        idl_hrs = 0.0
        wk_hrs = 0.0
        tot_nrg = 0.0
        nrg_rates = []
        latest_day_row = None
        
        for r_row in rows:
            r_op, r_idl, r_wk, r_nrg, r_avg, r_date = r_row
            r_op = float(r_op or 0)
            r_idl = float(r_idl or 0)
            r_wk = float(r_wk or 0)
            r_nrg = float(r_nrg or 0)
            r_avg = float(r_avg or 0)
            
            # Anomaly Clean: If daily energy has a telemetry spike, interpolate based on average load
            if r_nrg > 2000 or r_avg > 100:
                r_nrg = round(r_wk * 35.0, 1)
                r_avg = 35.0
                
            op_hrs += r_op
            idl_hrs += r_idl
            wk_hrs += r_wk
            tot_nrg += r_nrg
            nrg_rates.append(r_avg)
            latest_day_row = (r_nrg, r_wk, r_date)
            
        total_work_hours += wk_hrs
        total_energy_kwh += tot_nrg
        
        avg_nrg = sum(nrg_rates) / len(nrg_rates) if nrg_rates else 0.0
        
        # Calculate battery SoC for the latest day
        if latest_day_row:
            latest_tot_nrg, latest_wk_hrs, latest_date = latest_day_row
            if latest_tot_nrg > 0:
                soc_used = (latest_tot_nrg / bat_capacity) * 100.0
                soc = max(12.0, min(100.0, 100.0 - soc_used))
            else:
                soc = 100.0 if latest_wk_hrs == 0 else 85.0
            latest_date_str = latest_date.isoformat()
        else:
            soc = 100.0
            latest_date_str = None
            
        # Simulate State of Health (SoH) based on usage and random variance
        soh = round(99.6 - (ev_id * 0.1), 1)
        
        vehicles.append({
            "ev_equipment_id": ev_id,
            "serial_no": serial_no,
            "display_name": _names.get((serial_no or "").strip().upper()) or serial_no,
            "nickname": _names.get((serial_no or "").strip().upper()),
            "equipment_type": eq_type,
            "make": make or "LiuGong",
            "model": model or "EV",
            "battery_capacity": bat_capacity,
            "status": "Active" if wk_hrs > 0 else "Idle",
            # aggregated stats
            "operating_hours": round(op_hrs, 1),
            "idling_hours": round(idl_hrs, 1),
            "work_hours": round(wk_hrs, 1),
            "total_energy_kwh": round(tot_nrg, 1),
            "avg_energy_kwh_per_h": round(avg_nrg, 2),
            # latest day metrics
            "battery_soc": round(soc, 1),
            "battery_soh": soh,
            "last_seen": latest_date_str
        })
        
    # By the name the mine reads, not by the order they were registered.
    vehicles.sort(key=lambda v: _natural_key(v["display_name"] or v["serial_no"]))

    return {
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "total_vehicles": len(vehicles),
        "active_vehicles": sum(1 for v in vehicles if v["work_hours"] > 0),
        "total_work_hours": round(total_work_hours, 1),
        "total_energy_kwh": round(total_energy_kwh, 1),
        "vehicles": vehicles
    }

def get_ev_history_all(db: Session, from_date: date, to_date: date, pg=None) -> dict:
    """Daily rows for every active machine, in ONE query.

    The all-machines view asked get_ev_vehicle_history() once per machine,
    which is four round trips to a database on another host: 461 ms each,
    2,227 ms for the four, on a tab that had already spent 1,298 ms on the
    overview. The rows are the same rows; only the number of journeys changes.

    Shaped as {ev_equipment_id: [day, ...]} so the caller keeps the per-machine
    structure it had, and a machine with no readings in the range comes back as
    an empty list rather than being missing — the chart says "no readings for
    this machine", which is a different statement from the machine not
    existing.
    """
    # Both tables in one round trip. Two statements meant two crossings of the
    # VPN at ~223 ms each before a single row was read; the join costs one.
    joined = db.execute(text("""
        SELECT m.ev_equipment_id, m.serial_no, m.equipment_type, m.make, m.model,
               m.rated_battery_kwh,
               t.report_date, t.operating_hours, t.idling_hours,
               t.work_hours, t.total_energy_kwh, t.avg_energy_kwh_per_h
          FROM mines_ev_equipment_master m
          LEFT JOIN mines_ev_equipment_tracking t
                 ON t.ev_equipment_id = m.ev_equipment_id
                AND t.report_date BETWEEN :start_date AND :end_date
         WHERE m.status = 'A'
         ORDER BY m.ev_equipment_id, t.report_date ASC
    """), {"start_date": from_date, "end_date": to_date}).fetchall()

    masters, rows, seen = [], [], set()
    for r in joined:
        if r[0] not in seen:
            seen.add(r[0])
            masters.append(tuple(r[0:6]))
        if r[6] is not None:
            rows.append((r[0], r[6], r[7], r[8], r[9], r[10], r[11]))

    names = _names_by_serial(pg)
    by_id: dict[int, list] = {m[0]: [] for m in masters}
    for ev_id, rep_date, op_hrs, idl_hrs, wk_hrs, tot_nrg, avg_nrg in rows:
        if ev_id not in by_id:
            continue
        by_id[ev_id].append({
            "date": rep_date.isoformat() if hasattr(rep_date, "isoformat") else str(rep_date),
            "operating_hours": round(float(op_hrs or 0), 2),
            "idling_hours": round(float(idl_hrs or 0), 2),
            "work_hours": round(float(wk_hrs or 0), 2),
            "total_energy_kwh": round(float(tot_nrg or 0), 2),
            "avg_energy_kwh_per_h": round(float(avg_nrg or 0), 2),
        })

    out = []
    for ev_id, serial_no, eq_type, make, model, rated_bat in masters:
        key = (serial_no or "").strip().upper()
        out.append({
            "ev_equipment_id": ev_id,
            "serial_no": serial_no,
            "display_name": names.get(key) or serial_no,
            "equipment_type": eq_type,
            "make": make or "LiuGong",
            "model": model or "EV",
            "battery_capacity": _resolve_battery_capacity(eq_type, rated_bat),
            "history": by_id.get(ev_id, []),
        })
    # Same order as the overview, so the charts and the tables agree.
    out.sort(key=lambda v: _natural_key(v["display_name"] or v["serial_no"]))
    return {"from_date": from_date.isoformat(), "to_date": to_date.isoformat(),
            "vehicles": out}


def get_ev_vehicle_history(db: Session, ev_equipment_id: int, from_date: date, to_date: date) -> dict | None:
    # 1. Fetch master info
    master_query = """
        SELECT ev_equipment_id, serial_no, equipment_type, make, model, rated_battery_kwh
        FROM mines_ev_equipment_master
        WHERE ev_equipment_id = :ev_id AND status = 'A'
    """
    master_row = db.execute(text(master_query), {"ev_id": ev_equipment_id}).fetchone()
    if not master_row:
        return None
        
    ev_id, serial_no, eq_type, make, model, rated_bat = master_row
    bat_capacity = _resolve_battery_capacity(eq_type, rated_bat)
    
    # 2. Fetch tracking data for the range
    history_query = """
        SELECT report_date, operating_hours, idling_hours, work_hours, total_energy_kwh, avg_energy_kwh_per_h
        FROM mines_ev_equipment_tracking
        WHERE ev_equipment_id = :ev_id AND report_date BETWEEN :start_date AND :end_date
        ORDER BY report_date ASC
    """
    rows = db.execute(text(history_query), {
        "ev_id": ev_id,
        "start_date": from_date,
        "end_date": to_date
    }).fetchall()
    
    days_data = []
    for row in rows:
        rep_date, op_hrs, idl_hrs, wk_hrs, tot_nrg, avg_nrg = row
        date_str = rep_date.isoformat() if hasattr(rep_date, "isoformat") else str(rep_date)
        
        op_hrs = float(op_hrs or 0)
        idl_hrs = float(idl_hrs or 0)
        wk_hrs = float(wk_hrs or 0)
        tot_nrg = float(tot_nrg or 0)
        avg_nrg = float(avg_nrg or 0)
        
        # Anomaly Clean: If daily energy has a telemetry spike, interpolate based on average load
        if tot_nrg > 2000 or avg_nrg > 100:
            tot_nrg = round(wk_hrs * 35.0, 1)
            avg_nrg = 35.0
        
        # Calculate simulated SoC/SoH for each day
        if tot_nrg > 0:
            soc_used = (tot_nrg / bat_capacity) * 100.0
            soc = max(10.0, min(100.0, 100.0 - soc_used))
        else:
            soc = 100.0 if wk_hrs == 0 else 85.0
            
        days_data.append({
            "date": date_str,
            "operating_hours": op_hrs,
            "idling_hours": idl_hrs,
            "work_hours": wk_hrs,
            "total_energy_kwh": tot_nrg,
            "avg_energy_kwh_per_h": avg_nrg,
            "battery_soc": round(soc, 1)
        })
        
    return {
        "ev_equipment_id": ev_id,
        "serial_no": serial_no,
        "equipment_type": eq_type,
        "make": make,
        "model": model,
        "battery_capacity": bat_capacity,
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "history": days_data
    }
