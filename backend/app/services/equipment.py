"""
Equipment Utilization service.

Sensor tables store a ~60-second cumulative snapshot per vehicle per day.
Strategy: grab the LAST snapshot of each (vehicle, day) — it holds the
full day's cumulative total — then SUM those across the date range.

Name mapping
────────────
Excavators
  Sensor  : "BAL_Z AXIS 450-1(Excavator)"
  SAP     : "EX- 1 (EXCAVATOR)"
  Display : "ZAXIS-450-1"
  Rule    : number after the LAST '-' = SAP excavator number

Tippers
  Sensor  : "MAN55"
  SAP     : "MAN-55"
  Rule    : insert '-' after 'MAN'
  Exclude : "MAN_Diesel Tanker"

Availability formula
────────────────────
  total_possible_hours = days_in_range × 24
  AVAIL% = (1 − BD_hours / total_possible_hours) × 100
  clamped to [0, 100]

MTTR / MTBF  (both date-filter dependent)
──────────────────────────────────────────
  Calendar Hours = (to_date − from_date + 1) × 24  [follows the date filter]
  B/D Hours      = SUM(BREAKDOWN_DURAION) for CLOSED breakdowns in period
                   (closed = BREAKDOWN_DURAION > 0, i.e. SAP has posted an end time)

  MTTR = B/D Hours  ÷  No. of closed breakdowns in period
  MTBF = (Calendar Hours − B/D Hours)  ÷  No. of breakdowns started in period

  Fleet MTTR = total fleet B/D hrs  ÷  total fleet closed breakdown count
  Fleet MTBF = (machines_with_bd × Calendar Hours − total B/D hrs) ÷ total breakdown count
"""
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import text


# ── Excavator map: sensor name → (SAP name, display name) ─────
EXCAVATOR_MAP: dict[str, tuple[str, str]] = {
    "BAL_Z AXIS 450-1(Excavator)":   ("EX-1 (EXCAVATOR)",  "ZAXIS-450-1"),
    "BAL_Z AXIS 470-2(Excavator)":   ("EX-2 (EXCAVATOR)",  "ZAXIS-470-2"),
    "BAL_Z AXIS 370 -4(Excavator)":  ("EX- 4 (EXCAVATOR)", "ZAXIS-370-4"),
    "BAL_Z AXIS 370 -5(Excavator)":  ("EX- 5 (EXCAVATOR)", "ZAXIS-370-5"),
    "BAL_Z AXIS 370-6(Excavator)":   ("EX- 6 (EXCAVATOR)", "ZAXIS-370-6"),
    "BAL_Z AXIS 470 -7(Excavator)":  ("EX- 7 (EXCAVATOR)", "ZAXIS-470-7"),
    "BAL_Z AXIS 220 -08(Excavator)": ("EX- 8 (EXCAVATOR)", "ZAXIS-220-8"),
}

EXC_DISPLAY_ORDER = [v[1] for v in EXCAVATOR_MAP.values()]


def _f(v) -> float:
    return float(v or 0)


def _tipper_sap_name(vehicle_desc: str) -> str:
    if vehicle_desc.startswith("MAN") and vehicle_desc[3:].isdigit():
        return f"MAN-{vehicle_desc[3:]} (TIPPER)"
    return vehicle_desc


def _calc_metrics(
    bd_hours: float, eng_hours: float, from_date: date, to_date: date
) -> dict:
    days      = (to_date - from_date).days + 1
    avail_hrs = days * 24.0
    if avail_hrs <= 0:
        return {"avail_pct": None, "util_pct": None}

    available_hrs = max(0.0, avail_hrs - bd_hours)
    avail_pct     = round((available_hrs / avail_hrs) * 100, 1)
    util_pct      = (
        round(min(100.0, (eng_hours / available_hrs) * 100), 1)
        if available_hrs > 0 else None
    )
    return {"avail_pct": avail_pct, "util_pct": util_pct}


# ── Core snapshot queries ──────────────────────────────────────

def _last_snap_excavator(db: Session, from_date: date, to_date: date) -> list:
    sql = text("""
        SELECT t.vehicle_desc,
               ROUND(SUM(TIME_TO_SEC(t.engine_hours) / 3600.0), 2) AS eng_hr_mtd,
               ROUND(SUM(t.fuel_consumed), 2)                        AS fuel_mtd
        FROM   mines_technoton_rest_equipment_utilization t
        JOIN (
            SELECT vehicle_desc, report_date, MAX(tripDate) AS mx
            FROM   mines_technoton_rest_equipment_utilization
            WHERE  report_date BETWEEN :f AND :t
              AND  vehicle_desc LIKE '%Z AXIS%'
            GROUP BY vehicle_desc, report_date
        ) sub ON t.vehicle_desc = sub.vehicle_desc
              AND t.report_date  = sub.report_date
              AND t.tripDate     = sub.mx
        GROUP BY t.vehicle_desc
        ORDER BY eng_hr_mtd DESC
    """)
    return db.execute(sql, {"f": from_date, "t": to_date}).fetchall()


def _last_snap_tipper(db: Session, from_date: date, to_date: date) -> list:
    sql = text("""
        SELECT t.vehicle_desc,
               ROUND(SUM(TIME_TO_SEC(t.engine_hours) / 3600.0), 2) AS eng_hr_mtd,
               ROUND(SUM(t.fuel_consumed), 2)                        AS fuel_mtd,
               ROUND(SUM(t.distance),      2)                        AS dist_mtd
        FROM   mines_technoton_man_utilization t
        JOIN (
            SELECT vehicle_desc, report_date, MAX(tripDate) AS mx
            FROM   mines_technoton_man_utilization
            WHERE  report_date BETWEEN :f AND :t
              AND  vehicle_desc LIKE 'MAN%'
              AND  vehicle_desc != 'MAN_Diesel Tanker'
            GROUP BY vehicle_desc, report_date
        ) sub ON t.vehicle_desc = sub.vehicle_desc
              AND t.report_date  = sub.report_date
              AND t.tripDate     = sub.mx
        GROUP BY t.vehicle_desc
        ORDER BY eng_hr_mtd DESC
    """)
    return db.execute(sql, {"f": from_date, "t": to_date}).fetchall()


def _get_bd_hours(
    db: Session, from_date: date, to_date: date, sap_names: list[str]
) -> dict[str, dict]:
    """SAP breakdown hours + counts for a given list of machine names.
    Returns {machine_name: {"hours": float, "count": int, "count_start": int}}
      - count       : events with BREAKDOWN_DURAION IS NOT NULL (used for MTTR/MTBF)
      - count_start : events with MALFUNCTION_START present (shown in B/D Count column)
    """
    if not sap_names:
        return {}
    ph = ", ".join(f":n{i}" for i in range(len(sap_names)))
    sql = text(f"""
        SELECT DESC_TECH_OBJECT,
               ROUND(SUM(CASE WHEN BREAKDOWN_DURAION IS NOT NULL
                              THEN BREAKDOWN_DURAION ELSE 0 END) / 3600.0, 2) AS bd_hours,
               COUNT(CASE WHEN BREAKDOWN_DURAION IS NOT NULL THEN 1 END)       AS bd_count,
               COUNT(*)                                                         AS bd_count_start,
               COUNT(CASE WHEN BREAKDOWN_DURAION > 0 THEN 1 END)               AS bd_count_closed
        FROM   zpm_iw29_notifications
        WHERE  MAINTENANCE_PLANT = :plant
          AND  MAIN_WORK_CENTER  = :wc
          AND  NOTIFICATION_TYPE = :ntype
          AND  MALFUNCTION_START IS NOT NULL
          AND  MALFUNCTION_START BETWEEN :f AND :t
          AND  DESC_TECH_OBJECT  IN ({ph})
        GROUP BY DESC_TECH_OBJECT
    """)
    params: dict = {
        "plant": "1200", "wc": "MINEAUTO", "ntype": "M2",
        "f": from_date, "t": to_date,
    }
    for i, name in enumerate(sap_names):
        params[f"n{i}"] = name
    return {
        r.DESC_TECH_OBJECT: {
            "hours":        _f(r.bd_hours),
            "count":        int(r.bd_count        or 0),
            "count_start":  int(r.bd_count_start  or 0),
            "count_closed": int(r.bd_count_closed or 0),
        }
        for r in db.execute(sql, params).fetchall()
    }


def _get_tipper_bd_hours(
    db: Session, from_date: date, to_date: date
) -> dict[str, dict]:
    """SAP breakdown hours + counts for ALL MAN tippers.
    Returns {machine_name: {"hours": float, "count": int, "count_start": int}}
    """
    sql = text("""
        SELECT DESC_TECH_OBJECT,
               ROUND(SUM(CASE WHEN BREAKDOWN_DURAION IS NOT NULL AND BREAKDOWN_DURAION > 0
                              THEN BREAKDOWN_DURAION ELSE 0 END) / 3600.0, 2) AS bd_hours,
               COUNT(CASE WHEN BREAKDOWN_DURAION IS NOT NULL THEN 1 END)       AS bd_count,
               COUNT(*)                                                         AS bd_count_start,
               COUNT(CASE WHEN BREAKDOWN_DURAION > 0 THEN 1 END)               AS bd_count_closed
        FROM   zpm_iw29_notifications
        WHERE  MAINTENANCE_PLANT = :plant
          AND  MAIN_WORK_CENTER  = :wc
          AND  NOTIFICATION_TYPE = :ntype
          AND  MALFUNCTION_START IS NOT NULL
          AND  MALFUNCTION_START BETWEEN :f AND :t
          AND  DESC_TECH_OBJECT  LIKE 'MAN-%'
        GROUP BY DESC_TECH_OBJECT
    """)
    return {
        r.DESC_TECH_OBJECT: {
            "hours":        _f(r.bd_hours),
            "count":        int(r.bd_count        or 0),
            "count_start":  int(r.bd_count_start  or 0),
            "count_closed": int(r.bd_count_closed or 0),
        }
        for r in db.execute(sql, {
            "plant": "1200", "wc": "MINEAUTO", "ntype": "M2",
            "f": from_date, "t": to_date,
        }).fetchall()
    }


def get_breakdown_details(
    db: Session, machine_sap_name: str, from_date: date, to_date: date
) -> list[dict]:
    """Return individual breakdown events for a machine in the date range.
    Tries a full-column query first; if any column is missing in the SAP export
    table it falls back to the minimal confirmed-column query so the modal
    always shows data rather than silently returning empty.
    """
    params = {"machine": machine_sap_name, "f": from_date, "t": to_date}
    _where = """
        FROM   zpm_iw29_notifications
        WHERE  MAINTENANCE_PLANT = '1200'
          AND  MAIN_WORK_CENTER  = 'MINEAUTO'
          AND  NOTIFICATION_TYPE = 'M2'
          AND  MALFUNCTION_START IS NOT NULL
          AND  MALFUNCTION_START BETWEEN :f AND :t
          AND  DESC_TECH_OBJECT  = :machine
        ORDER BY MALFUNCTION_START DESC
    """

    # ── Attempt 1: full column set ────────────────────────────────
    try:
        rows = db.execute(text(f"""
            SELECT NOTIFICATION_NO,
                   MALFUNCTION_START,
                   MALFUNCTION_END,
                   ROUND(BREAKDOWN_DURAION / 3600.0, 2) AS bd_hrs,
                   SHORT_TEXT                             AS reason
            {_where}
        """), params).fetchall()
        return [
            {
                "notification_no": str(r.NOTIFICATION_NO or ""),
                "start":  str(r.MALFUNCTION_START) if r.MALFUNCTION_START else None,
                "end":    str(r.MALFUNCTION_END)   if r.MALFUNCTION_END   else None,
                "bd_hrs": float(r.bd_hrs)           if r.bd_hrs is not None else None,
                "reason": (str(r.reason or "").strip() or None),
            }
            for r in rows
        ]
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    # ── Attempt 2: minimal confirmed columns only ─────────────────
    try:
        rows = db.execute(text(f"""
            SELECT MALFUNCTION_START,
                   ROUND(BREAKDOWN_DURAION / 3600.0, 2) AS bd_hrs
            {_where}
        """), params).fetchall()
        return [
            {
                "notification_no": "",
                "start":  str(r.MALFUNCTION_START) if r.MALFUNCTION_START else None,
                "end":    None,
                "bd_hrs": float(r.bd_hrs) if r.bd_hrs is not None else None,
                "reason": None,
            }
            for r in rows
        ]
    except Exception:
        return []


# ── Public service functions ───────────────────────────────────

def get_excavator_summary(db: Session, from_date: date, to_date: date) -> dict:
    sensor_rows = _last_snap_excavator(db, from_date, to_date)
    found = {r.vehicle_desc: _f(r.eng_hr_mtd) for r in sensor_rows}

    all_entries = [
        (vdesc, *EXCAVATOR_MAP[vdesc], found.get(vdesc, 0.0))
        for vdesc in EXCAVATOR_MAP
    ]
    sap_names  = [e[1] for e in all_entries]
    bd_map     = _get_bd_hours(db, from_date, to_date, sap_names)

    days       = (to_date - from_date).days + 1
    period_hrs = days * 24.0

    machines = []
    for vdesc, sap_name, display_name, eng_hr in all_entries:
        bd_entry        = bd_map.get(sap_name, {"hours": 0.0, "count": 0, "count_start": 0, "count_closed": 0})
        bd_hr           = min(bd_entry["hours"], period_hrs)
        bd_count        = bd_entry["count"]
        bd_count_start  = bd_entry["count_start"]
        bd_count_closed = bd_entry["count_closed"]
        metrics         = _calc_metrics(bd_hr, eng_hr, from_date, to_date)
        # MTTR = B/D Hours ÷ No. of closed breakdowns (only when SAP has posted end time)
        mttr = round(bd_hr / bd_count_closed, 1) if bd_count_closed > 0 else None
        # MTBF = (Calendar Hours − B/D Hours) ÷ No. of breakdowns started in period
        mtbf = round((period_hrs - bd_hr) / bd_count_start, 1) if bd_count_start > 0 else None
        machines.append({
            "vehicle_desc":   vdesc,
            "display_name":   display_name,
            "sap_name":       sap_name,
            "eng_hr_mtd":     eng_hr,
            "bd_hr":          bd_hr,
            "bd_count":       bd_count,
            "bd_count_start": bd_count_start,
            "avail_pct":      metrics["avail_pct"],
            "util_pct":       metrics["util_pct"],
            "mttr":           mttr,
            "mtbf":           mtbf,
        })

    machines.sort(key=lambda x: (-x["eng_hr_mtd"], x["display_name"]))

    total_bd_hrs          = sum(m["bd_hr"] for m in machines)
    total_bd_count_start  = sum(m["bd_count_start"]  for m in machines)
    total_bd_count_closed = sum(
        bd_map.get(m["sap_name"], {"count_closed": 0})["count_closed"] for m in machines
    )
    n_with_bd    = sum(1 for m in machines if m["bd_count_start"] > 0)
    # Fleet MTTR = total closed B/D hrs ÷ total closed count
    fleet_mttr   = round(total_bd_hrs / total_bd_count_closed, 1) if total_bd_count_closed > 0 else None
    # Fleet MTBF = (machines_with_bd × Calendar Hrs − total B/D hrs) ÷ total breakdown count
    fleet_mtbf   = round(
        (n_with_bd * period_hrs - total_bd_hrs) / total_bd_count_start, 1
    ) if total_bd_count_start > 0 else None
    total_bd_count = total_bd_count_start

    return {
        "from_date":      from_date,
        "to_date":        to_date,
        "machines":       machines,
        "total_eng_hr":   round(sum(m["eng_hr_mtd"] for m in machines), 2),
        "total_bd_hr":    round(total_bd_hrs, 2),
        "active_count":   sum(1 for m in machines if m["eng_hr_mtd"] > 0),
        "total_count":    len(machines),
        "total_bd_count": total_bd_count,
        "fleet_mttr":     fleet_mttr,
        "fleet_mtbf":     fleet_mtbf,
    }


def get_excavator_trend(db: Session, from_date: date, to_date: date) -> dict:
    sql = text("""
        SELECT t.vehicle_desc,
               t.report_date AS dt,
               ROUND(SUM(TIME_TO_SEC(t.engine_hours) / 3600.0), 2) AS eng_hr
        FROM   mines_technoton_rest_equipment_utilization t
        JOIN (
            SELECT vehicle_desc, report_date, MAX(tripDate) AS mx
            FROM   mines_technoton_rest_equipment_utilization
            WHERE  report_date BETWEEN :f AND :t
              AND  vehicle_desc LIKE '%Z AXIS%'
            GROUP BY vehicle_desc, report_date
        ) sub ON t.vehicle_desc = sub.vehicle_desc
              AND t.report_date  = sub.report_date
              AND t.tripDate     = sub.mx
        GROUP BY t.vehicle_desc, t.report_date
        ORDER BY t.report_date, t.vehicle_desc
    """)
    rows = db.execute(sql, {"f": from_date, "t": to_date}).fetchall()

    pivot: dict[str, dict[date, float]] = {}
    date_set: set[date] = set()
    for r in rows:
        if r.vehicle_desc not in EXCAVATOR_MAP:
            continue
        _, display = EXCAVATOR_MAP[r.vehicle_desc]
        pivot.setdefault(display, {})[r.dt] = _f(r.eng_hr)
        date_set.add(r.dt)

    all_dates    = sorted(date_set)
    active_names = [n for n in EXC_DISPLAY_ORDER if n in pivot
                    and any(v > 0 for v in pivot[n].values())]

    return {
        "from_date":     from_date,
        "to_date":       to_date,
        "machine_names": active_names,
        "dates":         [str(d) for d in all_dates],
        "series": {
            name: [pivot[name].get(d) for d in all_dates]
            for name in active_names
        },
    }


def get_excavator_fuel(db: Session, from_date: date, to_date: date) -> dict:
    """Excavator fuel consumption from sensor table (fuel_consumed column)."""
    sensor_rows = _last_snap_excavator(db, from_date, to_date)

    machines = []
    for r in sensor_rows:
        eng  = _f(r.eng_hr_mtd)
        fuel = _f(r.fuel_mtd)
        lph  = round(fuel / eng, 2) if eng > 0 else None
        # Map sensor name → display name
        display = EXCAVATOR_MAP.get(r.vehicle_desc, (r.vehicle_desc, r.vehicle_desc))[1]
        machines.append({
            "vehicle_desc": display,
            "eng_hr_mtd":   eng,
            "fuel_mtd":     fuel,
            "lph_avg":      lph,
        })

    # Only machines with fuel data
    machines.sort(key=lambda x: -(x["fuel_mtd"]))
    reporting  = [m for m in machines if m["lph_avg"] is not None]
    avg_lph    = round(sum(m["lph_avg"] for m in reporting) / len(reporting), 2) if reporting else None
    total_fuel = round(sum(m["fuel_mtd"] for m in machines), 1)

    return {
        "from_date":   from_date,
        "to_date":     to_date,
        "machines":    machines,
        "avg_lph":     avg_lph,
        "fleet_count": len(reporting),
        "oem_lph":     25.0,
        "total_fuel":  total_fuel,
    }


def get_tipper_summary(db: Session, from_date: date, to_date: date) -> dict:
    sensor_rows    = _last_snap_tipper(db, from_date, to_date)
    sensor_by_sap: dict[str, dict] = {}
    for r in sensor_rows:
        sap = _tipper_sap_name(r.vehicle_desc)
        sensor_by_sap[sap] = {
            "vehicle_desc": r.vehicle_desc,
            "eng_hr": _f(r.eng_hr_mtd),
        }

    bd_map        = _get_tipper_bd_hours(db, from_date, to_date)
    all_sap_names = set(sensor_by_sap) | set(bd_map)

    days       = (to_date - from_date).days + 1
    period_hrs = days * 24.0

    machines = []
    for sap_name in all_sap_names:
        eng_hr          = sensor_by_sap.get(sap_name, {}).get("eng_hr", 0.0)
        bd_entry        = bd_map.get(sap_name, {"hours": 0.0, "count": 0, "count_start": 0, "count_closed": 0})
        bd_hr           = min(bd_entry["hours"], period_hrs)
        bd_count        = bd_entry["count"]
        bd_count_start  = bd_entry["count_start"]
        bd_count_closed = bd_entry["count_closed"]

        if sap_name in sensor_by_sap:
            vdesc = sensor_by_sap[sap_name]["vehicle_desc"]
        else:
            vdesc = sap_name.replace(" (TIPPER)", "").replace("-", "", 1)

        has_data = eng_hr > 0 or bd_hr > 0
        if has_data:
            metrics = _calc_metrics(bd_hr, eng_hr, from_date, to_date)
        else:
            metrics = {"avail_pct": None, "util_pct": None}

        # MTTR = B/D Hours ÷ No. of closed breakdowns
        mttr = round(bd_hr / bd_count_closed, 1) if bd_count_closed > 0 else None
        # MTBF = (Calendar Hours − B/D Hours) ÷ No. of breakdowns started in period
        mtbf = round((period_hrs - bd_hr) / bd_count_start, 1) if bd_count_start > 0 else None
        machines.append({
            "vehicle_desc":   vdesc,
            "sap_name":       sap_name,
            "eng_hr_mtd":     eng_hr,
            "bd_hr":          bd_hr,
            "bd_count":       bd_count,
            "bd_count_start": bd_count_start,
            "avail_pct":      metrics["avail_pct"],
            "util_pct":       metrics["util_pct"],
            "mttr":           mttr,
            "mtbf":           mtbf,
        })

    machines.sort(key=lambda x: (-x["eng_hr_mtd"], x["vehicle_desc"]))

    total_bd_hrs          = sum(m["bd_hr"] for m in machines)
    total_bd_count_start  = sum(m["bd_count_start"] for m in machines)
    total_bd_count_closed = sum(
        bd_map.get(m["sap_name"], {"count_closed": 0})["count_closed"] for m in machines
    )
    n_with_bd    = sum(1 for m in machines if m["bd_count_start"] > 0)
    fleet_mttr   = round(total_bd_hrs / total_bd_count_closed, 1) if total_bd_count_closed > 0 else None
    fleet_mtbf   = round(
        (n_with_bd * period_hrs - total_bd_hrs) / total_bd_count_start, 1
    ) if total_bd_count_start > 0 else None
    total_bd_count = total_bd_count_start

    return {
        "from_date":      from_date,
        "to_date":        to_date,
        "machines":       machines,
        "total_eng_hr":   round(sum(m["eng_hr_mtd"] for m in machines), 2),
        "total_bd_hr":    round(total_bd_hrs, 2),
        "active_count":   sum(1 for m in machines if m["eng_hr_mtd"] > 0),
        "total_count":    len(machines),
        "total_bd_count": total_bd_count,
        "fleet_mttr":     fleet_mttr,
        "fleet_mtbf":     fleet_mtbf,
    }


def get_tipper_fuel(db: Session, from_date: date, to_date: date) -> dict:
    sensor_rows = _last_snap_tipper(db, from_date, to_date)

    machines = []
    for r in sensor_rows:
        eng   = _f(r.eng_hr_mtd)
        fuel  = _f(r.fuel_mtd)
        dist  = _f(r.dist_mtd)
        lph   = round(fuel / eng,  2) if eng  > 0 else None
        kmpl  = round(dist / fuel, 3) if fuel > 0 else None
        machines.append({
            "vehicle_desc": r.vehicle_desc,
            "eng_hr_mtd":   eng,
            "fuel_mtd":     fuel,
            "dist_mtd":     dist,
            "lph_avg":      lph,
            "kmpl_avg":     kmpl,
        })

    reporting = [m for m in machines if m["lph_avg"] is not None]
    avg_lph   = round(sum(m["lph_avg"] for m in reporting) / len(reporting), 2) if reporting else None
    tot_fuel  = sum(m["fuel_mtd"] for m in machines)
    tot_dist  = sum(m["dist_mtd"] for m in machines)
    avg_kmpl  = round(tot_dist / tot_fuel, 3) if tot_fuel > 0 else None

    return {
        "from_date":   from_date,
        "to_date":     to_date,
        "machines":    machines,
        "avg_lph":     avg_lph,
        "avg_kmpl":    avg_kmpl,
        "fleet_count": len(reporting),
        "oem_lph":     8.0,
    }
