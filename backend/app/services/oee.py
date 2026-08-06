from __future__ import annotations
from datetime import date
from sqlalchemy import text
from sqlalchemy.orm import Session

# ── Excavator master ──────────────────────────────────────────────────────────
# code      : value that appears inside mines_tipper_details.equipment_name CSV
# sap_eq    : SAP equipment number in zpm/mm tables
# ideal_cap : ideal capacity in CuM/hr (used for Performance formula)
EXCAVATORS = [
    {"name": "TATA-470(7)", "code": "470-7", "sap_eq": "000000000000700086", "ideal_cap": 17.0},
    {"name": "TATA-470(2)", "code": "470-2", "sap_eq": "000000000000700042", "ideal_cap": 17.0},
    {"name": "TATA-370(5)", "code": "370-5", "sap_eq": "000000000000700064", "ideal_cap": 39.0},
    {"name": "TATA-370(4)", "code": "370-4", "sap_eq": "000000000000700053", "ideal_cap": 39.0},
    {"name": "TATA-220(8)", "code": "220-8", "sap_eq": "000000000000700090", "ideal_cap": 29.0},
]


def _days_in_range(from_date: date, to_date: date) -> int:
    return (to_date - from_date).days + 1


def _safe_float(val) -> float:
    try:
        return float(val) if val else 0.0
    except (TypeError, ValueError):
        return 0.0


def _get_loss_hours(db: Session, code: str, name: str, from_date: date, to_date: date) -> dict:
    """Sum loss-hour columns from mines_tipper_details for a specific excavator.
    Matches both the old CSV short-code format (e.g. '470-7') and the new
    single full-name format (e.g. 'TATA-470(7)').
    """
    sql = text("""
        SELECT
            SUM(COALESCE(CAST(NULLIF(sunday_holiday_weekly_off,'') AS DECIMAL(10,2)), 0)) AS holiday_hrs,
            SUM(COALESCE(CAST(NULLIF(no_excavation_plan,'')         AS DECIMAL(10,2)), 0)) AS no_plan_hrs,
            SUM(COALESCE(CAST(NULLIF(planned_shut_down_hr,'')       AS DECIMAL(10,2)), 0)) AS planned_sd_hrs
        FROM mines_tipper_details
        WHERE Prod_date BETWEEN :fd AND :td
          AND (FIND_IN_SET(:code, equipment_name) > 0 OR equipment_name = :name)
    """)
    row = db.execute(sql, {"fd": from_date, "td": to_date, "code": code, "name": name}).fetchone()
    return {
        "holiday_hrs":    _safe_float(row.holiday_hrs)    if row else 0.0,
        "no_plan_hrs":    _safe_float(row.no_plan_hrs)    if row else 0.0,
        "planned_sd_hrs": _safe_float(row.planned_sd_hrs) if row else 0.0,
    }


def _get_breakdown_hours(db: Session, sap_eq: str, from_date: date, to_date: date) -> float:
    """Breakdown hours from SAP notifications (seconds → hours, same logic as Equipment section)."""
    sql = text("""
        SELECT ROUND(
            SUM(CASE WHEN BREAKDOWN_DURAION IS NOT NULL THEN BREAKDOWN_DURAION ELSE 0 END) / 3600.0,
            2
        ) AS bd_hours
        FROM zpm_iw29_notifications
        WHERE MAINTENANCE_PLANT  = '1200'
          AND NOTIFICATION_TYPE  = 'M2'
          AND MAIN_WORK_CENTER   = 'MINEAUTO'
          AND EQUIPMENT          = :eq
          AND MALFUNCTION_START  BETWEEN :fd AND :td
    """)
    row = db.execute(sql, {"eq": sap_eq, "fd": from_date, "td": to_date}).fetchone()
    return _safe_float(row.bd_hours) if row else 0.0


def _get_pm_hours(db: Session, sap_eq: str, from_date: date, to_date: date) -> float:
    """PM hours from plant-maintenance calibration orders.
    Duration = DATEDIFF(completion, start) × 24.
    Records with completion '0000-00-00' or NULL contribute 0 hours.
    (SAP team will add time columns later; logic will be updated then.)
    """
    sql = text("""
        SELECT SUM(
            CASE
                WHEN COMPLETION_DATE IS NULL
                  OR COMPLETION_DATE = '0000-00-00' THEN 0
                ELSE DATEDIFF(
                    STR_TO_DATE(COMPLETION_DATE, '%Y-%m-%d'),
                    BASIC_START_DATE
                ) * 24
            END
        ) AS pm_hours
        FROM mm_plant_maint_calibration
        WHERE ORDER_TYPE      = 'BA03'
          AND PLANT           = '1200'
          AND MAIN_WORK_CTR   = 'MINEAUTO'
          AND EQUIPMENT_NO    = :eq
          AND BASIC_START_DATE BETWEEN :fd AND :td
    """)
    row = db.execute(sql, {"eq": sap_eq, "fd": from_date, "td": to_date}).fetchone()
    return max(0.0, _safe_float(row.pm_hours) if row else 0.0)


def _get_actual_excavation(db: Session, code: str, name: str, from_date: date, to_date: date) -> float:
    """Actual excavation in CuM from mines_tipper_details.
    Trips × conversion: silt=4, all others=6.
    Matches both old CSV short-code format and new single full-name format.
    """
    sql = text("""
        SELECT SUM(
            (
                COALESCE(CAST(NULLIF(ore_quantity,'')    AS DECIMAL(12,2)), 0)
              + COALESCE(CAST(NULLIF(lg_quantity,'')     AS DECIMAL(12,2)), 0)
              + COALESCE(CAST(NULLIF(ob_quantity,'')     AS DECIMAL(12,2)), 0)
              + COALESCE(CAST(NULLIF(boulder,'')         AS DECIMAL(12,2)), 0)
              + COALESCE(CAST(NULLIF(tailing,'')         AS DECIMAL(12,2)), 0)
              + COALESCE(CAST(NULLIF(feed_to_cobp,'')    AS DECIMAL(12,2)), 0)
            ) * 6
            + COALESCE(CAST(NULLIF(silt_quantity,'')    AS DECIMAL(12,2)), 0) * 4
        ) AS actual_cum
        FROM mines_tipper_details
        WHERE Prod_date BETWEEN :fd AND :td
          AND (FIND_IN_SET(:code, equipment_name) > 0 OR equipment_name = :name)
    """)
    row = db.execute(sql, {"fd": from_date, "td": to_date, "code": code, "name": name}).fetchone()
    return max(0.0, _safe_float(row.actual_cum) if row else 0.0)


def get_oee_per_machine(db: Session, from_date: date, to_date: date) -> list[dict]:
    """Return OEE breakdown for each excavator over the given date range."""
    god_hours = _days_in_range(from_date, to_date) * 24.0
    results = []

    for ex in EXCAVATORS:
        loss     = _get_loss_hours(db, ex["code"], ex["name"], from_date, to_date)
        bd_hrs   = _get_breakdown_hours(db, ex["sap_eq"], from_date, to_date)
        pm_hrs   = _get_pm_hours(db, ex["sap_eq"], from_date, to_date)
        actual   = _get_actual_excavation(db, ex["code"], ex["name"], from_date, to_date)

        total_loss_hrs   = loss["holiday_hrs"] + loss["no_plan_hrs"] + loss["planned_sd_hrs"]
        operating_hrs    = max(0.0, god_hours - total_loss_hrs - bd_hrs - pm_hrs)

        availability = (operating_hrs / god_hours * 100) if god_hours > 0 else 0.0
        ideal_prod   = ex["ideal_cap"] * operating_hrs
        performance  = min((actual / ideal_prod * 100), 100.0) if ideal_prod > 0 else 0.0
        quality      = 100.0
        oee          = (availability / 100) * (performance / 100) * (quality / 100) * 100

        results.append({
            "machine":        ex["name"],
            "ideal_cap":      ex["ideal_cap"],
            "god_hours":      round(god_hours, 2),
            "holiday_hrs":    round(loss["holiday_hrs"], 2),
            "no_plan_hrs":    round(loss["no_plan_hrs"], 2),
            "planned_sd_hrs": round(loss["planned_sd_hrs"], 2),
            "bd_hours":       round(bd_hrs, 2),
            "pm_hours":       round(pm_hrs, 2),
            "operating_hrs":  round(operating_hrs, 2),
            "actual_cum":     round(actual, 2),
            "ideal_cum":      round(ideal_prod, 2),
            "availability":   round(availability, 2),
            "performance":    round(performance, 2),
            "quality":        round(quality, 2),
            "oee":            round(oee, 2),
        })

    return results
