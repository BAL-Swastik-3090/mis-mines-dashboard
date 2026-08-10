"""
Excavator OEE — Kaliapani Mines, plant 1200.

Implements Kaliapani_OEE_Logic_Spec.md verbatim. The formulas below are the
mine's own definitions; several look unusual but are deliberate — see the
"decisions to preserve" notes inline. Do not "improve" them.

    God Hours     = days_in_period × 24              (calendar, both ends inclusive)
    Loss Hours    = weekly_off + no_excavation_plan + planned_shut_down_hr
    Ideal Time    = max(God − Loss, 0)               ("Loading Time" in the LCM sheet)
    BD Hours      = min(SUM(BREAKDOWN_DURAION)/3600, God)
    PM Hours      = SUM(WORK_HOURS)
    Operating Hrs = max(Ideal Time − BD − PM, 0)
    Actual CuM    = (ore+lg+ob+boulder+tailing+feed_to_cobp)×6 + silt×4
    Ideal CuM     = Ideal Capacity × Operating Hrs

    Availability  = Operating Hrs / Ideal Time × 100   ← Ideal Time, NOT God Hours
    Performance   = min(Actual CuM / Ideal CuM × 100, 100)
    Quality       = 100 (fixed — no regrade loss is captured anywhere)
    OEE           = Availability × Performance × Quality / 10000

Fleet figures are WEIGHTED, never averaged — averaging would let a machine that
barely ran count as much as one that ran all month.

Reporting-only (feeds no formula):
    Deviation Hrs = SUM(deviation_hours)   — unplanned idle inside a manned shift
    Shift Hours   = SUM(running_hours + deviation_hours)
    Deviation %   = Deviation Hrs / Shift Hours × 100
"""
from __future__ import annotations
from datetime import date
from sqlalchemy import text
from sqlalchemy.orm import Session

PLANT           = "1200"
WORK_CENTRE     = "MINEAUTO"
BD_NOTIF_TYPE   = "M2"
PM_ORDER_TYPE   = "BA03"

# code      : token inside mines_tipper_details.equipment_name (pre-July CSV form)
# name      : full single value used from July 2026 onward
# sap_eq     : 18-digit zero-padded SAP EQUIPMENT / EQUIPMENT_NO
# ideal_cap : fixed engineering figure supplied by the mine (CuM/hr), not derived
EXCAVATORS = [
    {"name": "TATA-470(7)", "code": "470-7", "sap_eq": "000000000000700086", "ideal_cap": 17.0},
    {"name": "TATA-470(2)", "code": "470-2", "sap_eq": "000000000000700042", "ideal_cap": 17.0},
    {"name": "TATA-370(5)", "code": "370-5", "sap_eq": "000000000000700064", "ideal_cap": 39.0},
    {"name": "TATA-370(4)", "code": "370-4", "sap_eq": "000000000000700053", "ideal_cap": 39.0},
    {"name": "TATA-220(8)", "code": "220-8", "sap_eq": "000000000000700090", "ideal_cap": 29.0},
]


def _num(v) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


# ── IMOS shift log: planned losses, deviation, shift hours, excavated CuM ─────
# Every quantity/hour column here is varchar, hence NULLIF + CAST throughout.
# Machine matching needs BOTH branches: equipment_name switched from a CSV of the
# excavator plus its tippers ('470-7,MAN-67,80,...') to a single full name
# ('TATA-470(7)') in July 2026. FIND_IN_SET alone does not match the new form.
_SHIFT_SQL = text("""
    SELECT
        SUM(COALESCE(CAST(NULLIF(sunday_holiday_weekly_off,'') AS DECIMAL(14,2)),0)) AS holiday_hrs,
        SUM(COALESCE(CAST(NULLIF(no_excavation_plan,'')        AS DECIMAL(14,2)),0)) AS no_plan_hrs,
        SUM(COALESCE(CAST(NULLIF(planned_shut_down_hr,'')      AS DECIMAL(14,2)),0)) AS planned_sd_hrs,
        SUM(COALESCE(CAST(NULLIF(deviation_hours,'')           AS DECIMAL(14,2)),0)) AS deviation_hrs,
        SUM(COALESCE(CAST(NULLIF(running_hours,'')             AS DECIMAL(14,2)),0)) AS running_hrs,
        SUM(
            ( COALESCE(CAST(NULLIF(ore_quantity,'')   AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(lg_quantity,'')    AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(ob_quantity,'')    AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(boulder,'')        AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(tailing,'')        AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(feed_to_cobp,'')   AS DECIMAL(14,2)),0) ) * 6
            + COALESCE(CAST(NULLIF(silt_quantity,'')  AS DECIMAL(14,2)),0) * 4
        ) AS actual_cum
    FROM mines_tipper_details
    WHERE Prod_date BETWEEN :fd AND :td
      AND (FIND_IN_SET(:code, equipment_name) > 0 OR equipment_name = :name)
""")

# BREAKDOWN_DURAION is in SECONDS despite BREAKDOWN_DURTN_UNIT = 'H' on every
# row (note the typo in the column name — it is spelled that way in SAP's export).
# Open notifications carry no duration, so they contribute 0.
_BD_SQL = text("""
    SELECT COALESCE(SUM(BREAKDOWN_DURAION), 0) / 3600.0 AS bd_hours
    FROM zpm_iw29_notifications
    WHERE MAINTENANCE_PLANT = :plant
      AND NOTIFICATION_TYPE = :ntype
      AND MAIN_WORK_CENTER  = :wc
      AND EQUIPMENT         = :eq
      AND MALFUNCTION_START BETWEEN :fd AND :td
""")

# PM hours come from WORK_HOURS. The obvious-looking
# DATEDIFF(COMPLETION_DATE, BASIC_START_DATE) × 24 returns 0 for every BA03
# order, because they start and complete on the same day.
_PM_SQL = text("""
    SELECT COALESCE(SUM(WORK_HOURS), 0) AS pm_hours
    FROM mm_plant_maint_calibration
    WHERE ORDER_TYPE    = :otype
      AND PLANT         = :plant
      AND MAIN_WORK_CTR = :wc
      AND EQUIPMENT_NO  = :eq
      AND BASIC_START_DATE BETWEEN :fd AND :td
""")


def get_oee_per_machine(db: Session, from_date: date, to_date: date) -> dict:
    """Per-excavator OEE plus a weighted fleet roll-up."""
    days      = (to_date - from_date).days + 1
    god_hours = days * 24.0

    machines = []
    for ex in EXCAVATORS:
        shift = db.execute(_SHIFT_SQL, {
            "fd": from_date, "td": to_date, "code": ex["code"], "name": ex["name"],
        }).fetchone()

        bd_row = db.execute(_BD_SQL, {
            "plant": PLANT, "ntype": BD_NOTIF_TYPE, "wc": WORK_CENTRE,
            "eq": ex["sap_eq"], "fd": from_date, "td": to_date,
        }).fetchone()

        pm_row = db.execute(_PM_SQL, {
            "otype": PM_ORDER_TYPE, "plant": PLANT, "wc": WORK_CENTRE,
            "eq": ex["sap_eq"], "fd": from_date, "td": to_date,
        }).fetchone()

        holiday    = _num(shift.holiday_hrs)    if shift else 0.0
        no_plan    = _num(shift.no_plan_hrs)    if shift else 0.0
        planned_sd = _num(shift.planned_sd_hrs) if shift else 0.0
        deviation  = _num(shift.deviation_hrs)  if shift else 0.0
        running    = _num(shift.running_hrs)    if shift else 0.0
        actual_cum = max(0.0, _num(shift.actual_cum) if shift else 0.0)

        loss_hrs   = holiday + no_plan + planned_sd
        ideal_time = max(god_hours - loss_hrs, 0.0)

        bd_hrs = min(_num(bd_row.bd_hours) if bd_row else 0.0, god_hours)
        pm_hrs = max(0.0, _num(pm_row.pm_hours) if pm_row else 0.0)

        operating_hrs = max(ideal_time - bd_hrs - pm_hrs, 0.0)
        ideal_cum     = ex["ideal_cap"] * operating_hrs

        availability = (operating_hrs / ideal_time * 100) if ideal_time > 0 else 0.0
        performance  = min(actual_cum / ideal_cum * 100, 100.0) if ideal_cum > 0 else 0.0
        quality      = 100.0
        oee          = availability * performance * quality / 10000.0

        shift_hrs     = running + deviation
        deviation_pct = (deviation / shift_hrs * 100) if shift_hrs > 0 else None

        machines.append({
            "machine":        ex["name"],
            "ideal_cap":      ex["ideal_cap"],
            "god_hours":      round(god_hours, 2),
            "holiday_hrs":    round(holiday, 2),
            "no_plan_hrs":    round(no_plan, 2),
            "planned_sd_hrs": round(planned_sd, 2),
            "loss_hrs":       round(loss_hrs, 2),
            "ideal_time":     round(ideal_time, 2),
            "bd_hours":       round(bd_hrs, 2),
            "pm_hours":       round(pm_hrs, 2),
            "operating_hrs":  round(operating_hrs, 2),
            "actual_cum":     round(actual_cum, 2),
            "ideal_cum":      round(ideal_cum, 2),
            "availability":   round(availability, 2),
            "performance":    round(performance, 2),
            "quality":        round(quality, 2),
            "oee":            round(oee, 2),
            # reporting only — feeds no formula above
            "deviation_hrs":  round(deviation, 2),
            "running_hrs":    round(running, 2),
            "shift_hours":    round(shift_hrs, 2),
            "deviation_pct":  round(deviation_pct, 1) if deviation_pct is not None else None,
        })

    # ── Fleet roll-up: weight by hours and volume, never average percentages ──
    sum_ideal_time = sum(m["ideal_time"]    for m in machines)
    sum_operating  = sum(m["operating_hrs"] for m in machines)
    sum_actual     = sum(m["actual_cum"]    for m in machines)
    sum_ideal_cum  = sum(m["ideal_cum"]     for m in machines)
    sum_deviation  = sum(m["deviation_hrs"] for m in machines)
    sum_shift_hrs  = sum(m["shift_hours"]   for m in machines)

    f_avail = (sum_operating / sum_ideal_time * 100) if sum_ideal_time > 0 else 0.0
    f_perf  = min(sum_actual / sum_ideal_cum * 100, 100.0) if sum_ideal_cum > 0 else 0.0
    f_qual  = 100.0
    f_oee   = f_avail * f_perf * f_qual / 10000.0

    fleet = {
        "god_hours":     round(god_hours * len(machines), 2),
        "loss_hrs":      round(sum(m["loss_hrs"] for m in machines), 2),
        "ideal_time":    round(sum_ideal_time, 2),
        "bd_hours":      round(sum(m["bd_hours"] for m in machines), 2),
        "pm_hours":      round(sum(m["pm_hours"] for m in machines), 2),
        "operating_hrs": round(sum_operating, 2),
        "actual_cum":    round(sum_actual, 2),
        "ideal_cum":     round(sum_ideal_cum, 2),
        "availability":  round(f_avail, 2),
        "performance":   round(f_perf, 2),
        "quality":       round(f_qual, 2),
        "oee":           round(f_oee, 2),
        "deviation_hrs": round(sum_deviation, 2),
        "shift_hours":   round(sum_shift_hrs, 2),
        "deviation_pct": round(sum_deviation / sum_shift_hrs * 100, 1) if sum_shift_hrs > 0 else None,
        "machine_count": len(machines),
    }

    return {"machines": machines, "fleet": fleet}
