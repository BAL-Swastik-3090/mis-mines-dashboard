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
from sqlalchemy import bindparam, text
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


# ── ONE READ PER SOURCE, NOT ONE PER MACHINE ─────────────────────────
#
# This screen used to issue twenty-five queries for a single load: the shift log
# once per machine, the first-seen check once per hired machine, and breakdown
# and maintenance once per owned machine. In production that measured 1,096 ms,
# almost none of it real work — mines_tipper_details holds 5,409 rows in total,
# so no individual read is expensive. There were simply twenty-five round trips
# to a database on another host, and the waiting was the cost.
#
# Each source is now read once for the whole fleet and divided up afterwards.
#
# THE MATCHING STAYS IN MYSQL. Which log rows belong to which excavator is
# decided by FIND_IN_SET plus an equality test, under a collation that ignores
# case and trailing spaces. Re-implementing that in Python would have created a
# second definition of the rule, free to drift from the first and wrong in ways
# nobody would see — a machine quietly losing a day of production. So the same
# two predicates are written into a CASE that labels every row with the machine
# it belongs to, and the grouping happens on that label.


def _machine_list() -> str:
    """The fleet as a derived table of (machine, code), to join the log against.

    WHY A JOIN AND NOT A CASE. A CASE labels each log row with one machine, and
    that is not what the per-machine queries did. Each of those ran its own
    predicate across the whole table, so a row naming two excavators was counted
    by both of them — and seventeen rows from the CSV era do name two, for
    instance '470-2,470-7,MAN-57,20,71,...' on 28 May, where the pair worked the
    same shift and the log holds one line for the two of them.

    Whether crediting that shift's output to both machines is right is a real
    question, and not one a change to the query count should answer quietly. So
    the join reproduces the existing behaviour exactly, double count and all,
    and the question is left where it belongs — with the mine.
    """
    return " UNION ALL ".join(
        f"SELECT :name{i} AS machine, CAST(:code{i} AS CHAR) AS code"
        for i in range(len(EXCAVATORS)))


def _machine_params() -> dict:
    """Both keys for every machine; code is NULL for the hired ones, which is
    what makes FIND_IN_SET fall through to the name test, exactly as it did."""
    p: dict = {}
    for i, ex in enumerate(EXCAVATORS):
        p[f"name{i}"] = ex["name"]
        p[f"code{i}"] = ex["code"]
    return p


# The matching rule itself, in one place: a machine owns a log row if its CSV
# token is in equipment_name, or the whole field is its full name.
_MATCH_ON = ("(FIND_IN_SET(m.code, t.equipment_name) > 0 "
             "OR t.equipment_name = m.machine)")


# ── IMOS shift log: planned losses, deviation, shift hours, excavated CuM ─────
# Every quantity/hour column here is varchar, hence NULLIF + CAST throughout.
# Machine matching needs BOTH branches: equipment_name switched from a CSV of the
# excavator plus its tippers ('470-7,MAN-67,80,...') to a single full name
# ('TATA-470(7)') in July 2026. FIND_IN_SET alone does not match the new form.
_SHIFT_ALL_SQL = text(f"""
    SELECT m.machine AS machine,
        SUM(COALESCE(CAST(NULLIF(t.sunday_holiday_weekly_off,'') AS DECIMAL(14,2)),0)) AS holiday_hrs,
        SUM(COALESCE(CAST(NULLIF(t.no_excavation_plan,'')        AS DECIMAL(14,2)),0)) AS no_plan_hrs,
        SUM(COALESCE(CAST(NULLIF(t.planned_shut_down_hr,'')      AS DECIMAL(14,2)),0)) AS planned_sd_hrs,
        SUM(COALESCE(CAST(NULLIF(t.deviation_hours,'')           AS DECIMAL(14,2)),0)) AS deviation_hrs,
        SUM(COALESCE(CAST(NULLIF(t.running_hours,'')             AS DECIMAL(14,2)),0)) AS running_hrs,
        -- Downtime as the shift supervisor recorded it. Read only for machines
        -- whose bd_source is 'imos'; pulled unconditionally because it costs
        -- nothing here and keeps the per-machine branch to a single if.
        SUM(COALESCE(CAST(NULLIF(t.breakdown,'')                 AS DECIMAL(14,2)),0)) AS log_bd_hrs,
        SUM(COALESCE(CAST(NULLIF(t.maintenance,'')               AS DECIMAL(14,2)),0)) AS log_pm_hrs,
        -- Zero here means the machine was not at the mine during the window at
        -- all, which is not the same as a machine that was there and idle.
        COUNT(*) AS shift_rows,
        SUM(
            ( COALESCE(CAST(NULLIF(t.ore_quantity,'')   AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(t.lg_quantity,'')    AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(t.ob_quantity,'')    AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(t.boulder,'')        AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(t.tailing,'')        AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(t.feed_to_cobp,'')   AS DECIMAL(14,2)),0) ) * 6
            + COALESCE(CAST(NULLIF(t.silt_quantity,'')  AS DECIMAL(14,2)),0) * 4
        ) AS actual_cum,
        -- THE SAME CuM, SPLIT BY WHAT WAS IN THE BUCKET. Same x6 / x4 factors
        -- as actual_cum above, so the three always add back to it exactly and
        -- the share can never total 101%.
        --
        -- ORE and OB are the two the mine asked for; OTHER exists because five
        -- of the ten machines spend most of their time on neither. EV 2 is 100%
        -- tailing, COB feed and silt, and SANY-2 is 87% — folding that into
        -- either column would label a tailing machine an ore machine.
        SUM(
            ( COALESCE(CAST(NULLIF(t.ore_quantity,'') AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(t.lg_quantity,'')  AS DECIMAL(14,2)),0) ) * 6
        ) AS ore_cum,
        SUM(
            ( COALESCE(CAST(NULLIF(t.ob_quantity,'')  AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(t.boulder,'')      AS DECIMAL(14,2)),0) ) * 6
        ) AS ob_cum,
        SUM(
            ( COALESCE(CAST(NULLIF(t.tailing,'')      AS DECIMAL(14,2)),0)
            + COALESCE(CAST(NULLIF(t.feed_to_cobp,'') AS DECIMAL(14,2)),0) ) * 6
            + COALESCE(CAST(NULLIF(t.silt_quantity,'') AS DECIMAL(14,2)),0) * 4
        ) AS other_cum
    FROM mines_tipper_details t
    JOIN ({_machine_list()}) m ON {_MATCH_ON}
    WHERE t.Prod_date BETWEEN :fd AND :td
    GROUP BY m.machine
""")

# Breakdown hours come from services/breakdown.py, which selects notifications
# that OVERLAP the window rather than ones that START inside it, and merges a
# machine's simultaneous notifications so no hour is counted twice. Both
# mattered here: TATA-470(7), open since 10 September, reported 0.00 hours for
# 1-7 October, while TATA-370(5) reported exactly its God Hours because five
# overlapping notifications summed past the window and were then clamped.
#
# Asked for the whole fleet in ONE call rather than once per machine: hours_by
# already groups by equipment, so the per-machine loop would have been five
# round trips to fetch what a single grouped read returns.

# PM hours come from WORK_HOURS. The obvious-looking
# DATEDIFF(COMPLETION_DATE, BASIC_START_DATE) x 24 returns 0 for every BA03
# order, because they start and complete on the same day.
_PM_ALL_SQL = text("""
    SELECT EQUIPMENT_NO AS eq, COALESCE(SUM(WORK_HOURS), 0) AS pm_hours
    FROM mm_plant_maint_calibration
    WHERE ORDER_TYPE    = :otype
      AND PLANT         = :plant
      AND MAIN_WORK_CTR = :wc
      AND EQUIPMENT_NO IN :eqs
      AND BASIC_START_DATE BETWEEN :fd AND :td
    GROUP BY EQUIPMENT_NO
""").bindparams(bindparam("eqs", expanding=True))


# THE DAY A HIRED MACHINE ACTUALLY STARTED, ever — not within the window.
#
# Not simply MIN(Prod_date): one stray row would decide it, and there are stray
# rows. TATA-210 has a single row dated 5 March 2026 standing 141 days before
# the next one, and the table also holds dates typed as 0026-02-25 and
# 0206-07-25. Taking the minimum would have charged TATA-210 from March.
#
# So a date only counts as a start if the machine was logged again within the
# following week. A real arrival is followed by more shifts; a typo or a one-off
# is not.
#
# The rule used to be a correlated EXISTS run once per hired machine. It is now
# one read of the distinct dates each machine was logged on — 224 names across
# 5,409 rows, so a handful of dates each — with the week test applied in Python
# below. Same rule, same answers: 24 July for SANY-2 and TATA-210, 9 August for
# TATA-490, 3 October for both TATA-350s.
_SEEN_DAYS_SQL = text(f"""
    SELECT m.machine AS machine, t.Prod_date AS d
      FROM mines_tipper_details t
      JOIN ({_machine_list()}) m ON {_MATCH_ON}
     WHERE t.Prod_date > '2020-01-01'
     GROUP BY m.machine, t.Prod_date
""")


def _shift_by_machine(db: Session, fd: date, td: date) -> dict:
    """One row per machine that has any shift row in the window."""
    return {r["machine"]: r for r in db.execute(
        _SHIFT_ALL_SQL, {"fd": fd, "td": td, **_machine_params()}).mappings()}


def _sap_hours(db: Session, fd: date, td: date) -> tuple[dict, dict]:
    """Breakdown and maintenance hours per SAP equipment number, in two reads."""
    eqs = [ex["sap_eq"] for ex in EXCAVATORS if ex["sap_eq"]]
    if not eqs:
        return {}, {}

    # One grouped read for every machine. The equipment numbers are bound by
    # name rather than interpolated -- breakdown.py ANDs `where` into its own
    # SQL as text, so anything put there must already be a placeholder.
    eq_names = {f"eq{i}": e for i, e in enumerate(eqs)}
    in_list = ", ".join(f":{k}" for k in eq_names)
    bd_by = bd.hours_by(
        db, key="EQUIPMENT", from_date=fd, to_date=td,
        where=("MAINTENANCE_PLANT = :plant AND NOTIFICATION_TYPE = :ntype"
               f" AND MAIN_WORK_CENTER = :wc AND EQUIPMENT IN ({in_list})"),
        bind={"plant": PLANT, "ntype": BD_NOTIF_TYPE, "wc": WORK_CENTRE,
              **eq_names})
    pm_by = {r["eq"]: _num(r["pm_hours"]) for r in db.execute(_PM_ALL_SQL, {
        "otype": PM_ORDER_TYPE, "plant": PLANT, "wc": WORK_CENTRE,
        "eqs": eqs, "fd": fd, "td": td,
    }).mappings()}
    return bd_by, pm_by


def _first_seen_by_machine(db: Session) -> dict:
    """First logged date that was followed by another within the week."""
    days: dict = {}
    for r in db.execute(_SEEN_DAYS_SQL, _machine_params()).mappings():
        days.setdefault(r["machine"], []).append(r["d"])

    out: dict = {}
    for machine, ds in days.items():
        ds.sort()
        for i, d in enumerate(ds):
            # ds is sorted, so the very next date is the nearest candidate: if
            # even that one is more than a week out, no later date can qualify d.
            if i + 1 < len(ds) and (ds[i + 1] - d).days <= 7:
                out[machine] = d
                break
    return out


# A machine is called an ORE or an OB machine only when most of what it moved
# was that. Below this it is reported as MIXED rather than rounded to whichever
# class happens to be ahead — TATA-490 ran 57% ore against 32% OB in July-Oct,
# and calling that an ore machine hides a third of its work.
DOMINANT_SHARE = 0.60

MATERIAL_LABELS = (("ORE", "ore_cum"), ("OB", "ob_cum"), ("OTHER", "other_cum"))


def _material_split(ore: float, ob: float, other: float) -> dict:
    """What the buckets carried, as shares of the machine's own CuM."""
    total = ore + ob + other
    if total <= 0:
        return {"material": None, "material_pct": None,
                "ore_pct": None, "ob_pct": None, "other_pct": None}
    pct = {k: v / total * 100.0 for k, v in
           (("ORE", ore), ("OB", ob), ("OTHER", other))}
    top = max(pct, key=lambda k: pct[k])
    return {
        "material": top if pct[top] >= DOMINANT_SHARE * 100 else "MIXED",
        "material_pct": round(pct[top], 1),
        "ore_pct": round(pct["ORE"], 1),
        "ob_pct": round(pct["OB"], 1),
        "other_pct": round(pct["OTHER"], 1),
    }


def _utilisation(running_hrs: float, god_hours: float, bd_hrs: float) -> float | None:
    """Of the hours the machine was not broken down, how many did it run?

    THE MIS DASHBOARD'S FORMULA, with the shift log in place of the GPS feed:
    services/equipment.py divides sensor engine-hours by (calendar - breakdown)
    and caps at 100. The denominator is deliberately NOT this table's Operating
    Hrs, which also subtracts PM — matching the Equipment section matters more
    than matching the column next to it, because the two screens are read
    against each other and a figure called Utilisation on both must mean one
    thing.

    WHY NOT THE GPS FEED. EXCAVATOR_MAP in services/equipment.py carries seven
    Z-AXIS machines; none of the five hired ones has a Technoton sensor, so
    engine hours do not exist for half this table. running_hours covers all ten.

    Capped at 100 like the original: an open breakdown notification shrinks the
    denominator while the machine keeps digging, and TATA-470(7) did 1,872 CuM
    after its notification opened.
    """
    available = god_hours - bd_hrs
    if available <= 0:
        return None
    return round(min(100.0, running_hrs / available * 100.0), 2)


def get_oee_per_machine(db: Session, from_date: date, to_date: date) -> dict:
    """Per-excavator OEE plus a weighted fleet roll-up."""
    days            = (to_date - from_date).days + 1
    full_god_hours  = days * 24.0

    # Four reads for the whole fleet, before the loop, instead of twenty-five
    # inside it. first_seen is not restricted to the window on purpose: it asks
    # when a machine first arrived at the mine, ever.
    shift_by   = _shift_by_machine(db, from_date, to_date)
    bd_by, pm_by = _sap_hours(db, from_date, to_date)
    first_by   = _first_seen_by_machine(db)

    machines = []
    absent: list[str] = []
    for ex in EXCAVATORS:
        shift = shift_by.get(ex["name"])

        # A MACHINE WITH NO SHIFT ROWS IS LEFT OUT, NOT SHOWN AS ZERO.
        # Carried through the arithmetic it would read God Hours in full, no
        # breakdown, Availability 100% and Performance 0% — a machine that looks
        # perfectly available and produced nothing, which then drags the weighted
        # fleet figure down. That is an artefact of the machine not being here,
        # not a fact about it. TATA-350(1) and (2) are the live case: they do not
        # exist before 3 October, so any September range must not invent them.
        if not shift or not shift["shift_rows"]:
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
            first_seen = first_by.get(ex["name"])
            if first_seen and first_seen > from_date:
                god_hours = max((to_date - first_seen).days + 1, 0) * 24.0

        if ex["bd_source"] == "sap":
            # Absent from the dict means SAP recorded no event overlapping
            # this window for this machine, which is zero hours down rather
            # than missing data.
            raw_bd = bd_by.get(ex["sap_eq"], 0.0)
            raw_pm = pm_by.get(ex["sap_eq"], 0.0)
        else:
            # Hired: no SAP equipment number exists to query, so the shift log
            # is the only record of this machine stopping.
            raw_bd = _num(shift["log_bd_hrs"])
            raw_pm = _num(shift["log_pm_hrs"])

        holiday    = _num(shift["holiday_hrs"])
        no_plan    = _num(shift["no_plan_hrs"])
        planned_sd = _num(shift["planned_sd_hrs"])
        deviation  = _num(shift["deviation_hrs"])
        running    = _num(shift["running_hrs"])
        actual_cum = max(0.0, _num(shift["actual_cum"]))
        ore_cum    = max(0.0, _num(shift["ore_cum"]))
        ob_cum     = max(0.0, _num(shift["ob_cum"]))
        other_cum  = max(0.0, _num(shift["other_cum"]))

        loss_hrs   = holiday + no_plan + planned_sd
        ideal_time = max(god_hours - loss_hrs, 0.0)

        # No min(..., god_hours). That clamp existed because overlapping
        # notifications could sum past the window; merged intervals are clipped
        # to the window by construction, so a clamp could now only hide a bug
        # rather than prevent one.
        bd_hrs = max(0.0, raw_bd)
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
            "ore_cum":        round(ore_cum, 2),
            "ob_cum":         round(ob_cum, 2),
            "other_cum":      round(other_cum, 2),
            **_material_split(ore_cum, ob_cum, other_cum),
            "utilisation":    _utilisation(running, god_hours, bd_hrs),
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
        "ore_cum":       round(sum(m["ore_cum"]   for m in machines), 2),
        "ob_cum":        round(sum(m["ob_cum"]    for m in machines), 2),
        "other_cum":     round(sum(m["other_cum"] for m in machines), 2),
        **_material_split(sum(m["ore_cum"]   for m in machines),
                          sum(m["ob_cum"]    for m in machines),
                          sum(m["other_cum"] for m in machines)),
        # WEIGHTED, NOT AVERAGED. Averaging ten machines' percentages would let
        # a machine that ran two shifts count as much as one that ran the month
        # — the same reason Availability and Performance are summed first.
        "utilisation":   _utilisation(
            sum(m["running_hrs"] for m in machines),
            sum(m["god_hours"]   for m in machines),
            sum(m["bd_hours"]    for m in machines)),
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
