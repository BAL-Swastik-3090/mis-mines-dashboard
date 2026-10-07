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

from app.services import breakdown as bd

PLANT           = "1200"
WORK_CENTRE     = "MINEAUTO"
BD_NOTIF_TYPE   = "M2"
PM_ORDER_TYPE   = "BA03"

# WHO IS ON THIS SCREEN, AND WHERE EACH ONE'S DOWNTIME COMES FROM.
#
# code      : token inside mines_tipper_details.equipment_name (pre-July CSV form).
#             None for anything that arrived after July 2026, when the mine
#             switched to writing the full name in that column.
# name      : full single value used from July 2026 onward
# sap_eq    : 18-digit zero-padded SAP EQUIPMENT / EQUIPMENT_NO, or None
# ideal_cap : fixed engineering figure supplied by the mine (CuM/hr), not derived
# hired     : contractor machine, not owned
#
# TWO SOURCES FOR BREAKDOWN, AND WHY. The owned machines keep SAP, which is where
# the mine raises an M2 notification against an equipment number. The hired ones
# have no equipment number — they are not Balasore assets, so SAP has never heard
# of them — and their downtime is instead written into the daily shift log, in
# mines_tipper_details.breakdown and .maintenance. Checked over 1 Jul - 3 Oct
# 2026, those two columns are filled for every hired machine (SANY-2 41.9 h,
# TATA-490 20.3 h breakdown plus 160.4 h maintenance, TATA-210 16.4 h), so the
# figure is real rather than a stand-in for a missing one.
#
# The two do not agree where both exist — TATA-470(7) is 664.7 h in the shift log
# against 90.0 h in SAP — because they measure different things: SAP counts from
# notification open to close including unmanned nights, the shift log counts
# downtime inside a manned shift. Mixing them in one column is therefore a
# compromise the mine chose deliberately, and the table says which is which
# rather than hiding it.
EXCAVATORS = [
    # ── owned: breakdown and PM from SAP ──────────────────────────────────────
    {"name": "TATA-470(7)", "code": "470-7", "sap_eq": "000000000000700086",
     "ideal_cap": 17.0, "bd_source": "sap", "hired": False},
    {"name": "TATA-470(2)", "code": "470-2", "sap_eq": "000000000000700042",
     "ideal_cap": 17.0, "bd_source": "sap", "hired": False},
    {"name": "TATA-370(5)", "code": "370-5", "sap_eq": "000000000000700064",
     "ideal_cap": 39.0, "bd_source": "sap", "hired": False},
    {"name": "TATA-370(4)", "code": "370-4", "sap_eq": "000000000000700053",
     "ideal_cap": 39.0, "bd_source": "sap", "hired": False},
    {"name": "TATA-220(8)", "code": "220-8", "sap_eq": "000000000000700090",
     "ideal_cap": 29.0, "bd_source": "sap", "hired": False},

    # ── hired: breakdown and PM from the shift log ────────────────────────────
    # TATA-350(1) and (2) exist only from 3 October 2026. Before that the mine
    # logged a single "TATA-350", which is deliberately NOT listed here: it was
    # one name over a changing number of machines (6 shift rows on 2 October, so
    # 30.3 running hours in a 24-hour day), and splitting that history between
    # the two successors would be guesswork. Those rows are left out.
    {"name": "TATA-350(1)", "code": None, "sap_eq": None,
     "ideal_cap": 58.0, "bd_source": "imos", "hired": True},
    {"name": "TATA-350(2)", "code": None, "sap_eq": None,
     "ideal_cap": 58.0, "bd_source": "imos", "hired": True},
    {"name": "SANY-2",      "code": None, "sap_eq": None,
     "ideal_cap": 17.0, "bd_source": "imos", "hired": True},
    {"name": "TATA-490",    "code": None, "sap_eq": None,
     "ideal_cap": 26.0, "bd_source": "imos", "hired": True},
    {"name": "TATA-210",    "code": None, "sap_eq": None,
     "ideal_cap": 29.0, "bd_source": "imos", "hired": True},

    # NOT HERE, ON PURPOSE:
    #   EV 1 / EV 2  — SAP 113531 / 113532, shift log and downtime both present.
    #                  Held back only because the mine has not yet given their
    #                  ideal capacity; add a line each when it arrives.
    #   TATA-370(6)  — SAP 700075, in the fleet master, but has never once
    #                  appeared in the shift log, so there is no production to
    #                  measure. Excluded by the mine.
    #   EV LOADER / EV GRADER — a wheel loader and a motor grader. Type 13 in
    #                  the fleet master alongside the excavators, but not
    #                  excavators. Excluded by the mine.
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
        -- Downtime as the shift supervisor recorded it. Read only for machines
        -- whose bd_source is 'imos'; pulled unconditionally because it costs
        -- nothing here and keeps the per-machine branch to a single if.
        SUM(COALESCE(CAST(NULLIF(breakdown,'')                 AS DECIMAL(14,2)),0)) AS log_bd_hrs,
        SUM(COALESCE(CAST(NULLIF(maintenance,'')               AS DECIMAL(14,2)),0)) AS log_pm_hrs,
        -- Zero here means the machine was not at the mine during the window at
        -- all, which is not the same as a machine that was there and idle.
        COUNT(*) AS shift_rows,
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

# An open notification carries no duration in SAP, so it used to contribute 0 —
# a machine down since the 3rd and still down on the 28th counted as nothing.
# services/breakdown.py is the single definition; it counts an open event from
# its start to now, and needs a :bd_upto parameter.
_BD_SQL = text(f"""
    SELECT COALESCE(SUM({bd.DURATION_SECONDS}), 0) / 3600.0 AS bd_hours
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


# THE DAY A HIRED MACHINE ACTUALLY STARTED, ever — not within the window.
#
# Not simply MIN(Prod_date): one stray row would decide it, and there are stray
# rows. TATA-210 has a single row dated 5 March 2026 standing 141 days before
# the next one, and the table also holds dates typed as 0026-02-25 and
# 0206-07-25. Taking the minimum would have charged TATA-210 from March.
#
# So a date only counts as a start if the machine was logged again within the
# following week. A real arrival is followed by more shifts; a typo or a one-off
# is not. Checked against all five hired machines, this returns the date the
# mine's own log shows them beginning work: 24 July for SANY-2 and TATA-210,
# 9 August for TATA-490, 3 October for both TATA-350s.
_FIRST_SEEN_SQL = text("""
    SELECT MIN(a.Prod_date) AS first_seen
    FROM mines_tipper_details a
    WHERE (FIND_IN_SET(:code, a.equipment_name) > 0 OR a.equipment_name = :name)
      AND a.Prod_date > '2020-01-01'
      AND EXISTS (
          SELECT 1 FROM mines_tipper_details b
          WHERE (FIND_IN_SET(:code, b.equipment_name) > 0 OR b.equipment_name = :name)
            AND b.Prod_date >  a.Prod_date
            AND b.Prod_date <= a.Prod_date + INTERVAL 7 DAY
      )
""")


def get_oee_per_machine(db: Session, from_date: date, to_date: date) -> dict:
    """Per-excavator OEE plus a weighted fleet roll-up."""
    days            = (to_date - from_date).days + 1
    full_god_hours  = days * 24.0

    machines = []
    absent: list[str] = []
    for ex in EXCAVATORS:
        shift = db.execute(_SHIFT_SQL, {
            "fd": from_date, "td": to_date, "code": ex["code"], "name": ex["name"],
        }).fetchone()

        # A MACHINE WITH NO SHIFT ROWS IS LEFT OUT, NOT SHOWN AS ZERO.
        # Carried through the arithmetic it would read God Hours in full, no
        # breakdown, Availability 100% and Performance 0% — a machine that looks
        # perfectly available and produced nothing, which then drags the weighted
        # fleet figure down. That is an artefact of the machine not being here,
        # not a fact about it. TATA-350(1) and (2) are the live case: they do not
        # exist before 3 October, so any September range must not invent them.
        if not shift or not shift.shift_rows:
            absent.append(ex["name"])
            continue

        # ── GOD HOURS START WHEN A HIRED MACHINE ARRIVED ────────────────────
        # The spec says days x 24 and the OWNED fleet keeps exactly that — those
        # five are permanent, so their clock has always been running and nothing
        # about their figures changes.
        #
        # Hired machines come and go, and charging one for time before it reached
        # the mine says more about the date range than about the machine:
        # TATA-350(1) first appears on 3 October, so a 1 July - 3 October range
        # charged it 2,280 hours of which it was present for 24, and its
        # Performance read 0.40%.
        #
        # ONLY THE START MOVES, NEVER THE END. Trimming the end to the last
        # logged shift would look identical whether the machine had left or the
        # log had simply not been filled in yet, and the second is ordinary — on
        # 6 October several machines' latest row is still 2 October. A machine
        # that has left therefore keeps accruing God Hours until the window moves
        # past it, which is the safer way to be wrong.
        god_hours = full_god_hours
        if ex["hired"]:
            first_seen = db.execute(_FIRST_SEEN_SQL,
                                    {"code": ex["code"], "name": ex["name"]}).scalar()
            if first_seen and first_seen > from_date:
                god_hours = max((to_date - first_seen).days + 1, 0) * 24.0

        if ex["bd_source"] == "sap":
            bd_row = db.execute(_BD_SQL, {
                "plant": PLANT, "ntype": BD_NOTIF_TYPE, "wc": WORK_CENTRE,
                "eq": ex["sap_eq"], "fd": from_date, "td": to_date,
                **bd.params(to_date),
            }).fetchone()
            pm_row = db.execute(_PM_SQL, {
                "otype": PM_ORDER_TYPE, "plant": PLANT, "wc": WORK_CENTRE,
                "eq": ex["sap_eq"], "fd": from_date, "td": to_date,
            }).fetchone()
            raw_bd = _num(bd_row.bd_hours) if bd_row else 0.0
            raw_pm = _num(pm_row.pm_hours) if pm_row else 0.0
        else:
            # Hired: no SAP equipment number exists to query, so the shift log
            # is the only record of this machine stopping.
            raw_bd = _num(shift.log_bd_hrs)
            raw_pm = _num(shift.log_pm_hrs)

        holiday    = _num(shift.holiday_hrs)    if shift else 0.0
        no_plan    = _num(shift.no_plan_hrs)    if shift else 0.0
        planned_sd = _num(shift.planned_sd_hrs) if shift else 0.0
        deviation  = _num(shift.deviation_hrs)  if shift else 0.0
        running    = _num(shift.running_hrs)    if shift else 0.0
        actual_cum = max(0.0, _num(shift.actual_cum) if shift else 0.0)

        loss_hrs   = holiday + no_plan + planned_sd
        ideal_time = max(god_hours - loss_hrs, 0.0)

        bd_hrs = min(raw_bd, god_hours)
        pm_hrs = max(0.0, raw_pm)

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
            # So the table can say where this row's BD/PM came from instead of
            # one footer claiming SAP for every machine.
            "bd_source":      ex["bd_source"],
            "hired":          ex["hired"],
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
        # Summed, not len(machines) x the window: machines no longer all carry
        # the same God Hours once a mid-window arrival is clamped to its own
        # start date.
        "god_hours":     round(sum(m["god_hours"] for m in machines), 2),
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
        # Named rather than merely absent, so a reader who expects twelve rows
        # and counts ten is told why instead of wondering.
        "absent_machines": absent,
    }

    return {"machines": machines, "fleet": fleet}
