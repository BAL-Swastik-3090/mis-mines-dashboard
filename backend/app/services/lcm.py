"""
LCM (Lost Cost Matrix) — Kaliapani Mines excavators, plant 1200.

Own equipment only. Loss heads and hours come from the database — the shift log
in mines_tipper_details and SAP for breakdown and PM. The mine's LCM spreadsheet
was a reference for the layout and the controllability split; it is not a data
source and nothing here reads from it.

    Ore Deviation = Plan Ore − Actual Ore                       (MT)
    OB  Deviation = Plan OB  − Actual OB                        (CuM)

    Ore Factor    = Ore Deviation ÷ Σ Ore Production Hour Loss  (MT/hr)
    OB  Factor    = OB  Deviation ÷ Σ OB  Production Hour Loss  (CuM/hr)

    Planned Ore Loss (head) = Ore Hour Loss (head) × Ore Factor
    Planned OB  Loss (head) = OB  Hour Loss (head) × OB  Factor

Because each factor is derived from the same hour total it divides, the Planned
Loss column always sums back to the Deviation exactly. That also means changing
one head's source only reallocates share between heads — it never breaks the total.

Machine split supplied by the mine:
    Ore excavation → TATA-470(7), TATA-470(2)
    OB  excavation → TATA-370(5), TATA-370(4), TATA-220(8)
"""
from __future__ import annotations
import math
from datetime import date
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.services.sap_source import sap_one

from app.services import breakdown as bd
from app.services import ibm_rates
from app.services import equipment_plan as eqp
from app.services import lcm_settings as lset
from app.services import equipment_settings as eqs
from app.services.oee import EXCAVATORS as _FLEET_SPEC

# Actuals are net of SAP reversal documents. Without this the ore deviation
# was UNDERSTATED — Aug 2026 read 8,366 MT / Rs 13.75 Cr instead of
# 11,806 MT / Rs 19.41 Cr, because reversals inflated the actual.
from app.services.sap_movement import PRODUCTION_QTY

# ── Machine groups ───────────────────────────────────────────────────────────
# WHICH MACHINE DIGS WHAT IS NO LONGER WRITTEN HERE. The mine assigns each
# excavator to ORE or OB at the start of the month through "Equipment
# Excavation Plan", and services/equipment_plan.py resolves the month. These
# two lists are only what the page falls back to when that plan cannot be READ
# -- minehub is reached over the VPN and is not always up -- and when they are
# used the response says so, so a stale default is never mistaken for the
# mine's own answer.
DEFAULT_ORE = ("TATA-470(7)", "TATA-470(2)")
DEFAULT_OB  = ("TATA-370(5)", "TATA-370(4)", "TATA-220(8)")

# How each machine is found in the two systems that hold its hours: `code` and
# `name` for the IMOS shift log, `sap_eq` for breakdown and PM. Taken from the
# OEE section's own fleet list rather than copied, so the two sections cannot
# describe the same machine differently. A machine in the equipment master with
# no entry here cannot be matched to any hours at all -- that is reported, not
# silently dropped.
_SPEC = {m["name"]: {"name": m["name"], "code": m["code"],
                     "sap_eq": m["sap_eq"]} for m in _FLEET_SPEC}


def _specs(names) -> list[dict]:
    return [_SPEC[n] for n in names if n in _SPEC]


#: What the machine split is, and how confident the page may be about it.
PLAN_ENTERED, PLAN_CARRIED = "entered", "carried"
PLAN_NONE, PLAN_UNAVAILABLE = "none", "unavailable"


def _resolve_plan(fd: date, td: date) -> dict:
    """This period's ORE/OB split, with its provenance attached.

    FOUR OUTCOMES, AND THE PAGE MUST BE ABLE TO TELL THEM APART:

        entered      the mine assigned every machine for this month
        carried      some or all came from an earlier month, which is named
        none         the plan table is reachable and empty -- the mine has
                     never assigned these machines
        unavailable  minehub could not be read, so these are the built-in
                     defaults and nobody should take them as the mine's answer

    The last two look identical if both are reported as "no plan", and they
    are not the same thing at all: one is a mine that has not entered a plan,
    the other is a database nobody could reach.
    """
    plan = eqp.resolve_detached(fd)
    if plan is None:
        return {
            "status": PLAN_UNAVAILABLE,
            "month": fd.replace(day=1).isoformat(),
            "ore": list(DEFAULT_ORE), "ob": list(DEFAULT_OB),
            "excluded": [], "no_spec": [], "unassigned": [],
            "carried": [], "carried_from": None, "month_entered": False,
            "spans_months": fd.replace(day=1) != td.replace(day=1),
        }

    # A machine the mine assigned that the OEE fleet list does not describe
    # cannot be matched to any hours in either system, so it is excluded --
    # BY NAME, into the coverage line, never quietly.
    no_spec = sorted(n for n in plan["assignments"] if n not in _SPEC)
    ore = [n for n in plan["ore"] if n in _SPEC]
    ob  = [n for n in plan["ob"]  if n in _SPEC]

    if not ore and not ob:
        status = PLAN_NONE
    elif plan["carried"]:
        status = PLAN_CARRIED
    else:
        status = PLAN_ENTERED

    return {
        "status": status,
        "month": plan["month"],
        "ore": ore, "ob": ob,
        # Everything whose hours reach neither bucket: never assigned, or
        # assigned but unmatchable.
        "excluded": sorted(set(plan["unassigned"]) | set(no_spec)),
        "no_spec": no_spec,
        "unassigned": plan["unassigned"],
        "carried": plan["carried"],
        "carried_from": plan["carried_from"],
        "month_entered": plan["month_entered"],
        # The plan has no grain finer than a month, by the mine's decision, so
        # a range crossing a month boundary is resolved on the month it starts
        # in. Said rather than assumed.
        "spans_months": fd.replace(day=1) != td.replace(day=1),
    }

# Plan / actual sources — identical to the Production and OB sections so the
# LCM denominators always agree with what those pages already display.
ORE_MATERIALS = ("000000000025000002", "000000000025000001", "000000000025000003")
OB_MATERIAL   = "000000000016000009"
PLANT         = "1200"
WORK_CENTRE   = "MINEAUTO"

# ── Costing ──────────────────────────────────────────────────────────────────
# Loss Amount values the planned ore loss at the IBM (Indian Bureau of Mines)
# published rate. The rate is grade-wise, so the single figure applied to the
# loss column is the plan-weighted average across HG/MG/LG:
#
#     Weighted Rate = Σ(Plan Qty[g] × IBM Rate[g]) ÷ Σ Plan Qty[g]
#     Loss Amount   = Planned Ore Loss (MT) × Weighted Rate
#
# The weighting uses the PLAN mix, not the actual mix — the loss being valued is
# ore that was planned and never came out of the ground, so it carries the grade
# mix the plan intended. Being a ratio, the weighting is scale-invariant: it does
# not matter whether HG+MG+LG equals ORE_QTY exactly, only their proportions.
#
# Rates come from minehub.mineral_price, which the market collector fills from
# the IBM monthly bulletin — see services/ibm_rates.py. They used to be three
# constants copied in by hand, and by the time anyone looked they were a month
# behind the published issue. The `source` field still travels with every
# response so the page can always state which issue it is quoting.
#
# IBM's published bands map one-to-one onto the HG/MG/LG buckets the mine plans
# in, so no band has to be chosen as representative:
#
#   IBM band                       Bucket
#   52% and above Cr2O3, Fines     HG   (+52% CHROME ORE)
#   40% to below 52% Cr2O3, Fines  MG   (40-52% CHROME ORE)
#   Below 40% Cr2O3, Fines         LG   (-40% Cr2O3)
#
# These are FINES prices. The plan carries only the HG/MG/LG columns and does
# not split lump from fines, so every planned tonne is valued as fines. If the
# mine later plans lump separately it needs its own rate — lump prices differ.
#
# While ANY grade carrying plan quantity has no rate, the whole Loss Amount
# column reports null rather than a number: dropping the unpriced grade would
# silently understate every row, which is worse than showing nothing. That path
# now also covers minehub being unreachable with nothing cached.

# OB carries no rupee value. It is waste rock moved to expose ore, not a saleable
# product, so there is no IBM rate for it — the OB loss stays a volume in CuM.
# If the mine later wants OB costed at an internal ₹/CuM excavation cost, that is
# a different figure with a different meaning and should be labelled as such.

# ── Loss heads — discovered from the table, not hardcoded ─────────────────────
# The head list is read from mines_tipper_details' own columns at request time.
# A new loss reason added to the entry form therefore appears in the LCM matrix
# on the next request, with no code change. This replaced a list copied out of
# a reference spreadsheet, which went stale the moment the form changed.
#
# Everything in the table is a loss head EXCEPT the columns below. That is the
# inverse of the old approach on purpose: an unrecognised column is treated as a
# loss and shows up, rather than being silently dropped.
NON_LOSS_COLUMNS = {
    # identity / metadata
    "entry_row_id", "prod_date", "shift", "loc_id", "type_work", "party_name",
    "shift_incharge", "equipment_name", "remark", "entry_id", "entry_date",
    # production quantities
    "ore_quantity", "lg_quantity", "ob_quantity", "silt_quantity", "boulder",
    "tailing", "feed_to_cobp",
    # meters and worked hours
    "omr", "cmr", "running_hours", "deviation_hours",
    # a stored sum of the loss columns — including it would double the total
    "total",
    # PLANNED loss, excluded by the mine's definition: these three are deducted
    # to reach Ideal Time in OEE and are not production loss heads
    "sunday_holiday_weekly_off", "no_excavation_plan", "planned_shut_down_hr",
}

# Breakdown and PM hours come from SAP, not the shift log, per the OEE spec the
# calculation was validated against (78/78). The columns exist in the table, so
# they are discovered like any other head — only their VALUE is overridden.
SAP_SOURCED = {"breakdown": "SAP_BD", "maintenance": "SAP_PM"}

# Acronyms that must not be sentence-cased into nonsense.
_ACRONYMS = {"hsd": "H.S.D", "lmv": "LMV", "imfa": "IMFA"}

# Labels for columns whose name does not say what the head means. Anything not
# listed here is formatted from the column name, so a new column still gets a
# readable label without being added to this map.
LABEL_OVERRIDES = {
    "maintenance":       "Preventive maintenance",
    "lmv_availability":  "LMV unavailability",
    "trains_truck":      "Trans. truck jam",
    "idle":              "Idle (no work)",
    "not_operation":     "Not in operation",
    "idle_safety":       "Idle due to safety concern",
    "absence_operator":  "Absence of operator",
    "rain_slippery":     "Rain & slippery problem",
    "mines_restriction": "Mining restriction",
}

# Controllability and ownership are business classifications with no home in the
# database — see memory note on the deferred master table. Keyed by column so a
# renamed label cannot break the mapping. A column absent from these maps is
# reported as Unclassified rather than guessed at, and the page says so.
LOSS_TYPE_BY_COLUMN = {
    "breakdown": "Controllable",          "maintenance": "Non Controllable",
    "late_start": "Controllable",         "tiffin": "Non Controllable",
    "hsd_shortage": "Controllable",       "strike": "Controllable",
    "idle_requ_basic": "Controllable",    "safety_talk": "Non Controllable",
    "dump_jam": "Controllable",           "lmv_availability": "Controllable",
    "illumination_problem": "Controllable", "absence_operator": "Controllable",
    "idle": "Controllable",               "tipper_shortage": "Controllable",
    "early_close": "Controllable",        "hsd_filling": "Non Controllable",
    "not_operation": "Controllable",      "rain_slippery": "Non Controllable",
    "trains_truck": "Controllable",       "imfa_blasting": "Non Controllable",
    "face_preparation": "Non Controllable", "job_allocation": "Controllable",
    "idle_safety": "Controllable",        "other": "Controllable",
    "mines_restriction": "Non Controllable",
}
KAM_BY_COLUMN = {
    "breakdown":           "Amarendra Sarangi",
    "maintenance":         "Amarendra Sarangi",
    "late_start":          "Rana Vikash Singh",
    "tiffin":              "Gurpreet Singh",
    "hsd_shortage":        "Praspero Sahoo",
    "strike":              "Gurpreet Singh",
    "idle_requ_basic":     "Rana Vikash Singh",
    "safety_talk":         "Rana Vikash Singh",
    "dump_jam":            "Rana Vikash Singh",
    "lmv_availability":    "Gurpreet Singh",
    "illumination_problem": "K L Das",
    "absence_operator":    "Gurpreet Singh",
    "idle":                "Rana Vikash Singh",
    "tipper_shortage":     "Amarendra Sarangi",
    "early_close":         "Rana Vikash Singh",
    "hsd_filling":         "Praspero Sahoo",
    "not_operation":       "Rana Vikash Singh",
    "rain_slippery":       "Rana Vikash Singh",
    "trains_truck":        "Maheswar Mohanty",
    "imfa_blasting":       "Rana Vikash Singh",
    "face_preparation":    "Rana Vikash Singh",
    "job_allocation":      "Rana Vikash Singh",
    "idle_safety":         "Rana Vikash Singh",
    "other":               "Rana Vikash Singh",
    "mines_restriction":   "Rana Vikash Singh",
}
UNCLASSIFIED = "Unclassified"

# The mine's conventional reporting sequence for loss heads — equipment-related
# heads first, then shift and operational ones, with Other and Mining Restriction
# last. This governs DISPLAY ORDER and Sl numbers only; which heads exist comes
# from the table. The sequence is a reporting convention, not a data source: the
# reference spreadsheet happens to follow it, but nothing here is driven by that
# file.
#
# Discovery stays dynamic — a column absent from this map is appended after the
# highest known Sl rather than dropped, so a new loss reason appears at the
# bottom of the table instead of vanishing, and without renumbering the rest.
DISPLAY_ORDER = {
    "breakdown": 1,             "maintenance": 2,          "late_start": 3,
    "tiffin": 4,                "hsd_shortage": 5,         "strike": 6,
    "idle_requ_basic": 7,       "safety_talk": 8,          "dump_jam": 9,
    "lmv_availability": 10,     "illumination_problem": 11, "absence_operator": 12,
    "idle": 13,                 "tipper_shortage": 14,     "early_close": 15,
    "hsd_filling": 16,          "not_operation": 17,       "rain_slippery": 18,
    "trains_truck": 19,         "imfa_blasting": 20,       "face_preparation": 21,
    "job_allocation": 22,       "idle_safety": 24,         "other": 25,
    "mines_restriction": 26,
}


def _label_from_column(col: str) -> str:
    """snake_case column -> sentence-case label, acronyms preserved.

    'late_start' -> 'Late start', 'hsd_filling' -> 'H.S.D filling'.
    """
    if col in LABEL_OVERRIDES:
        return LABEL_OVERRIDES[col]
    words = [_ACRONYMS.get(w, w) for w in col.split("_")]
    out = []
    for i, w in enumerate(words):
        if w in _ACRONYMS.values():
            out.append(w)                       # acronym: leave as-is
        elif i == 0 or not out:
            out.append(w.capitalize())
        else:
            out.append(w.lower())
    # if the first token was an acronym the next word still starts the sentence
    if out and out[0] in _ACRONYMS.values() and len(out) > 1:
        out[1] = out[1].lower()
    return " ".join(out)


def discover_loss_heads(db: Session,
                        settings: dict | None = None) -> list[dict]:
    """Loss heads, discovered from the table, in the mine's reporting sequence.

    WHICH HEADS EXIST IS STILL DYNAMIC — read from the table's columns, as it
    always was. What changed on 6 November 2026 is where their label, loss
    type, owner and Sl come from: the LCM KAM Selector
    (minehub.lcm_loss_head_setting), resolved for the day the window opens,
    instead of four maps compiled into this file.

    `settings` is the resolved head map. None means minehub could not be
    reached, and the maps below answer instead — the matrix then shows the
    classifications it showed before the selector existed, which is better
    than a matrix with no owners on it. Either way a column nobody has
    classified is reported as Unclassified at the bottom rather than dropped.
    """
    rows = db.execute(text("""
        SELECT COLUMN_NAME AS col
        FROM   INFORMATION_SCHEMA.COLUMNS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'mines_tipper_details'
        ORDER BY ORDINAL_POSITION
    """)).fetchall()

    cols = [r.col for r in rows if r.col.lower() not in NON_LOSS_COLUMNS]
    chosen = (settings or {})

    def pick(col: str, field: str, fallback):
        """The mine's choice for this head, or what the code used to say."""
        row = chosen.get(col)
        if row is not None and row.get(field) is not None:
            return row[field]
        return fallback

    # Known columns keep their conventional Sl; anything new is numbered after
    # the highest one so it lands at the bottom rather than shifting the rest.
    known_sl = {c: r["sl_order"] for c, r in chosen.items()
                if r.get("sl_order") is not None} or DISPLAY_ORDER
    next_sl = max(known_sl.values(), default=0)
    sl_of: dict[str, int] = {}
    for col in cols:
        if col in known_sl:
            sl_of[col] = known_sl[col]
        else:
            next_sl += 1
            sl_of[col] = next_sl

    heads = [{
        "sl_no":     sl_of[col],
        "column":    col,
        "label":     pick(col, "label", _label_from_column(col)),
        "source":    SAP_SOURCED.get(col, col),
        "loss_type": pick(col, "loss_type",
                          LOSS_TYPE_BY_COLUMN.get(col, UNCLASSIFIED)),
        "kam":       pick(col, "kam_name", KAM_BY_COLUMN.get(col, "—")),
        # Carried through to the KAM Wise Loss Tree so the two sections can
        # never put one head under two different owners.
        "role":      pick(col, "role_code",
                          ROLE_BY_COLUMN.get(col, ROLE_UNMAPPED)),
        "is_active": pick(col, "is_active", True),
        # THE STANDING REMEDY, AND NO FALLBACK. Where the owner and the type
        # fall back to the maps compiled into this file when minehub is
        # unreachable, an action has nowhere to fall back TO -- it exists only
        # because somebody at the mine wrote it. A blank panel is the honest
        # answer; an invented instruction addressed to a named department is
        # not.
        "action_text":     pick(col, "action_text", None),
        "owning_function": pick(col, "owning_function", None),
    } for col in cols]
    heads.sort(key=lambda h: h["sl_no"])
    return heads


def _n(v) -> float:
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _machine_filter(machines: list[dict]) -> str:
    """equipment_name switched from a CSV of excavator + tippers (pre-July 2026)
    to a single full name. Both forms must match."""
    return " OR ".join(
        f"(FIND_IN_SET(:c{i}, equipment_name) > 0 OR equipment_name = :n{i})"
        for i in range(len(machines))
    )


def _shift_hours(db: Session, machines: list[dict], fd: date, td: date,
                 columns: list[str]) -> dict:
    """Per-head hour totals from the IMOS shift log for one machine group.

    `columns` comes from discover_loss_heads(), so a newly added loss column is
    summed here without this function changing.
    """
    # An empty group is a real state now that the groups come from a plan --
    # a month where every machine was put on ore leaves the OB group empty.
    # Without this the WHERE clause would be built as "AND ()".
    if not machines:
        return {c: 0.0 for c in columns} | {"_rows": 0, "_days": 0}
    sums = ", ".join(
        f"SUM(COALESCE(CAST(NULLIF(`{c}`,'') AS DECIMAL(14,2)),0)) AS s_{c}" for c in columns
    )
    params: dict = {"fd": fd, "td": td}
    for i, m in enumerate(machines):
        params[f"c{i}"] = m["code"]
        params[f"n{i}"] = m["name"]

    row = db.execute(text(f"""
        SELECT COUNT(*) AS n_rows,
               COUNT(DISTINCT Prod_date) AS n_days,
               {sums}
        FROM mines_tipper_details
        WHERE Prod_date BETWEEN :fd AND :td AND ({_machine_filter(machines)})
    """), params).fetchone()

    m = dict(row._mapping) if row else {}
    out = {c: _n(m.get(f"s_{c}")) for c in columns}
    out["_rows"] = int(m.get("n_rows") or 0)
    out["_days"] = int(m.get("n_days") or 0)
    return out


def _sap_breakdown(db: Session, machines: list[dict], fd: date, td: date) -> float:
    """SAP M2 notification hours for these machines — see services/breakdown.py.

    Merged per machine and then added across them: one excavator with three
    open notifications is down once, but two excavators down together is two
    machine-hours lost. Selected by OVERLAP with the window, so a breakdown
    that began last month and is still running counts the part that falls in
    this one.
    """
    machines = [m for m in machines if m.get("sap_eq")]
    if not machines:
        return 0.0
    ph = ", ".join(f":e{i}" for i in range(len(machines)))
    bind = {f"e{i}": m["sap_eq"] for i, m in enumerate(machines)}
    bind |= {"plant": PLANT, "wc": WORK_CENTRE}
    return bd.total_hours(
        db, key="EQUIPMENT", from_date=fd, to_date=td,
        where=("MAINTENANCE_PLANT = :plant AND NOTIFICATION_TYPE = 'M2'"
               f" AND MAIN_WORK_CENTER = :wc AND EQUIPMENT IN ({ph})"),
        bind=bind)


def _sap_pm(db: Session, machines: list[dict], fd: date, td: date) -> float:
    """SAP BA03 order hours. WORK_HOURS is the only usable duration column —
    DATEDIFF(completion, start) is 0 because orders open and close same-day."""
    # Only own machines are in SAP at all; a hired one carries sap_eq = NULL,
    # and an empty list would build "IN ()" and fail to parse.
    machines = [m for m in machines if m.get("sap_eq")]
    if not machines:
        return 0.0
    ph = ", ".join(f":e{i}" for i in range(len(machines)))
    params: dict = {"fd": fd, "td": td, "plant": PLANT, "wc": WORK_CENTRE}
    for i, m in enumerate(machines):
        params[f"e{i}"] = m["sap_eq"]
    row = db.execute(text(f"""
        SELECT COALESCE(SUM(WORK_HOURS), 0) AS hrs
        FROM mm_plant_maint_calibration
        WHERE ORDER_TYPE = 'BA03' AND PLANT = :plant AND MAIN_WORK_CTR = :wc
          AND EQUIPMENT_NO IN ({ph}) AND BASIC_START_DATE BETWEEN :fd AND :td
    """), params).fetchone()
    return _n(row.hrs) if row else 0.0


def _downtime(db: Session, machines: list[dict], fd: date, td: date
              ) -> tuple[float, float]:
    """Breakdown and preventive-maintenance hours for a group — from whichever
    system actually recorded them.

    THE SOURCE IS A PROPERTY OF THE MACHINE, NOT OF THE HEAD. Own equipment is
    a Balasore asset with a SAP equipment number, and its downtime is an M2
    notification and a BA03 order. A hired machine is not an asset of ours, so
    SAP has never heard of it; its downtime is written into the shift log's
    own `breakdown` and `maintenance` columns. This is the rule the OEE table
    has always applied -- it prints SAP or SHIFT LOG against each row's BD Hrs
    -- and the mine confirmed it for the LCM on 2026-11-03.

    This replaces reading both heads from SAP for everybody, which returned a
    flat 0.00 for every hired machine. That was harmless only while the LCM
    covered own equipment alone; the moment the mine can assign a hired
    machine to ore or OB, it would have brought the machine's other heads in
    and silently dropped its breakdown -- in October, 114.70 hrs of breakdown
    and 17.90 of maintenance across the five hired excavators.

    THE TWO FIGURES ARE STILL NOT THE SAME MEASUREMENT, and nothing here
    pretends otherwise. SAP counts from notification open to close, including
    unmanned nights; the shift log counts downtime inside a manned shift. On
    TATA-470(7) that is 604.88 hours against 752.00. They are added into one
    head because each machine has exactly one of them, so no machine is ever
    counted on both bases -- not because the bases agree.
    """
    own   = [m for m in machines if m.get("sap_eq")]
    hired = [m for m in machines if not m.get("sap_eq")]

    bd = _sap_breakdown(db, own, fd, td)
    pm = _sap_pm(db, own, fd, td)

    if hired:
        cols = list(SAP_SOURCED)                    # breakdown, maintenance
        log = _shift_hours(db, hired, fd, td, cols)
        bd += log.get("breakdown", 0.0)
        pm += log.get("maintenance", 0.0)
    return bd, pm


def _plan_actual(db: Session, fd: date, td: date) -> dict:
    """Plan from IMOS, actual from SAP — the same expressions the Production and
    OB sections use, so LCM never disagrees with those pages."""
    ore_plan = db.execute(text("""
        SELECT COALESCE(SUM(ORE_QTY), 0) AS q FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :fd AND :td
    """), {"fd": fd, "td": td}).fetchone()

    # OB_QTY_Cum is NOT cumulative despite the name — the table is one row per
    # shift per location per face, and the value repeats identically across
    # shifts A/B/C for a given face (e.g. 2026-08-04 loc 26 reads 446.5 three
    # times). It is a per-shift-per-face plan quantity, the same grain as
    # ORE_QTY, so it sums the same way. MAX-per-date discards every row but one
    # and understates the OB plan roughly fivefold.
    ob_plan = db.execute(text("""
        SELECT COALESCE(SUM(CAST(NULLIF(OB_QTY_Cum,'') AS DECIMAL(16,3))), 0) AS q
        FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :fd AND :td
    """), {"fd": fd, "td": td}).fetchone()

    ph = ", ".join(f":m{i}" for i in range(len(ORE_MATERIALS)))
    p = {"fd": fd, "td": td, "plant": PLANT}
    for i, mat in enumerate(ORE_MATERIALS):
        p[f"m{i}"] = mat
    ore_act = sap_one(db, text(f"""
        SELECT COALESCE(SUM({PRODUCTION_QTY}), 0) AS q FROM pp_production
        WHERE PLANT = :plant AND MATERIAL_NO IN ({ph})
          AND POSTING_DATE BETWEEN :fd AND :td
    """), p)

    ob_act = sap_one(db, text(f"""
        SELECT COALESCE(SUM({PRODUCTION_QTY}), 0) AS q FROM pp_production
        WHERE PLANT = :plant AND MATERIAL_NO = :mat
          AND POSTING_DATE BETWEEN :fd AND :td
    """), {"plant": PLANT, "mat": OB_MATERIAL, "fd": fd, "td": td})

    return {
        "ore_plan":   _n(ore_plan.q),
        "ob_plan":    _n(ob_plan.q),
        "ore_actual": _n(ore_act.q),
        "ob_actual":  _n(ob_act.q),
    }


def _grade_plan(db: Session, fd: date, td: date) -> dict[str, float]:
    """Grade-wise planned ore (MT) from IMOS.

    HG_QTY / MG_QTY / LG_QTY sit on mines_daily_excavation_plan at the same
    shift x location x face grain as ORE_QTY, so they sum the same way.
    """
    r = db.execute(text("""
        SELECT COALESCE(SUM(HG_QTY), 0) AS hg,
               COALESCE(SUM(MG_QTY), 0) AS mg,
               COALESCE(SUM(LG_QTY), 0) AS lg
        FROM mines_daily_excavation_plan
        WHERE Prod_date BETWEEN :fd AND :td
    """), {"fd": fd, "td": td}).fetchone()
    return {"HG": _n(r.hg), "MG": _n(r.mg), "LG": _n(r.lg)}


def _weighted_rate(grade_qty: dict[str, float], quoted: dict) -> dict:
    """Plan-weighted average IBM rate across the grades.

    `quoted` is one issue of the bulletin, from services/ibm_rates.py. Returns
    the rate plus the full per-grade working, so the page can show how the
    number was arrived at instead of asking anyone to trust a bare figure.
    """
    quoted_rates = quoted["rates"]
    total_qty = sum(grade_qty.values())
    missing   = [g for g, q in grade_qty.items() if q > 0 and quoted_rates.get(g) is None]

    breakdown = [{
        "grade":  g,
        "qty":    round(grade_qty.get(g, 0.0), 3),
        "rate":   quoted_rates.get(g),
        "share":  round(grade_qty.get(g, 0.0) / total_qty * 100, 2) if total_qty > 0 else 0.0,
        "value":  round(grade_qty.get(g, 0.0) * quoted_rates[g], 2) if quoted_rates.get(g) is not None else None,
    } for g in ("HG", "MG", "LG")]

    if total_qty <= 0:
        status, rate = "no_plan_qty", None
    elif missing:
        status, rate = "rate_missing", None
    else:
        # Only grades actually carrying plan quantity contribute. A grade with
        # zero qty is skipped outright rather than multiplied by its rate — it
        # adds nothing to either side of the ratio, and skipping it means an
        # unpriced-but-unplanned grade cannot break the calculation.
        rate = sum(q * quoted_rates[g] for g, q in grade_qty.items() if q > 0) / total_qty
        status = "ok"

    return {
        "weighted_rate":   round(rate, 2) if rate is not None else None,
        "status":          status,
        "missing_grades":  missing,
        "total_plan_qty":  round(total_qty, 3),
        "source":          quoted["source"],
        "rate_period":     quoted["period"],
        "rate_is_stale":   quoted["stale"],
        "rate_flagged":    quoted["flagged"],
        "breakdown":       breakdown,
    }


# ── KAM Wise Loss Tree ───────────────────────────────────────────────────────
# The mine's accountability hierarchy, supplied by the user on 2026-09-07.
#
# NOTE THIS IS KEYED BY LOSS HEAD, NOT BY PERSON, and that is deliberate — the
# two do not roll up cleanly. KAM_BY_COLUMN above names six individual owners,
# but the org structure has three heads, and the three smaller owners sit under
# them:
#
#     Head Engineering       absorbs Praspero Sahoo (H.S.D shortage / filling)
#                                and K L Das       (Illumination problem)
#     Head Human Resource    absorbs Maheswar Mohanty (Trans. truck jam)
#
# So a person -> role map would misplace three loss heads. The head-level map is
# also what the user actually specified, head by head.
#
# 'dump_jam' was not in the list the user first sent — their Head Mines Operation
# named 13 heads while the code has 14 for Rana Vikash Singh. It was assigned here to
# Head Mines Operation because KAM_BY_COLUMN already gives it to Rana Vikash Singh,
# who is that head, and the mine CONFIRMED that placement on 2026-09-07. It
# carries zero loss in every month checked (Jun/Jul/Aug 2026) so nothing moved
# either way, but the placement is now settled rather than inferred.
# COB is the fourth head and is SHAPED DIFFERENTLY from the other three.
#
# The mines heads own loss HEADS, each classified Controllable or Non
# Controllable. The COB plant has no downtime log at all, so LCM for COB
# attributes its deviation to CAUSES (feed volume, recovery) with no
# controllability dimension anywhere in it. Inventing one here would be
# fabrication, so the COB node carries a single "COB Loss" figure and its
# controllable / non_controllable fields are null — not zero. Zero would state
# that COB had no controllable loss, which is a claim nobody has made.
#
ROLE_COB      = "COB"
COB_META      = {"role": ROLE_COB, "title": "Head COB", "owner": "Bijan Kr Chand"}

ROLE_MINES_OP = "MINES_OPERATION"
ROLE_ENGG     = "ENGINEERING"
ROLE_HR       = "HUMAN_RESOURCE"
ROLE_UNMAPPED = "UNMAPPED"

CHIEF_OF_MINES = {"role": "CHIEF", "title": "Chief of Mines", "owner": "BK Padhi"}

# Display order follows the user's diagram, left to right.
ROLE_META = [
    {"role": ROLE_MINES_OP, "title": "Head Mines Operation", "owner": "Rana Vikash Singh"},
    {"role": ROLE_ENGG,     "title": "Head Engineering",     "owner": "Amarendra Sarangi"},
    {"role": ROLE_HR,       "title": "Head Human Resource",  "owner": "Gurpreet Singh"},
]

ROLE_BY_COLUMN = {
    # Head Mines Operation — Rana Vikash Singh
    "late_start":           ROLE_MINES_OP,
    "idle_requ_basic":      ROLE_MINES_OP,
    "safety_talk":          ROLE_MINES_OP,
    "idle":                 ROLE_MINES_OP,
    "early_close":          ROLE_MINES_OP,
    "not_operation":        ROLE_MINES_OP,
    "rain_slippery":        ROLE_MINES_OP,
    "imfa_blasting":        ROLE_MINES_OP,
    "face_preparation":     ROLE_MINES_OP,
    "job_allocation":       ROLE_MINES_OP,
    "idle_safety":          ROLE_MINES_OP,
    "other":                ROLE_MINES_OP,
    "mines_restriction":    ROLE_MINES_OP,
    "dump_jam":             ROLE_MINES_OP,   # confirmed 2026-09-07 — see note above
    # Head Engineering — Amarendra Sarangi
    "breakdown":            ROLE_ENGG,
    "maintenance":          ROLE_ENGG,
    "hsd_shortage":         ROLE_ENGG,
    "illumination_problem": ROLE_ENGG,
    "tipper_shortage":      ROLE_ENGG,
    "hsd_filling":          ROLE_ENGG,
    # Head Human Resource — Gurpreet Singh
    "tiffin":               ROLE_HR,
    "strike":               ROLE_HR,
    "lmv_availability":     ROLE_HR,
    "absence_operator":     ROLE_HR,
    "trains_truck":         ROLE_HR,
}


def get_lcm(db: Session, from_date: date, to_date: date) -> dict:
    days = (to_date - from_date).days + 1

    pa = _plan_actual(db, from_date, to_date)
    # Clamp at 0 — a period where actual beats plan has no production loss to
    # distribute, and a negative factor would render every row as a negative loss.
    ore_dev = max(pa["ore_plan"] - pa["ore_actual"], 0.0)
    ob_dev  = max(pa["ob_plan"]  - pa["ob_actual"],  0.0)

    # WHO OWNS EACH LOSS HEAD, AS THE MINE SET IT FOR THE DAY THE WINDOW
    # OPENS. Resolved on from_date, the same rule the excavation plan and the
    # fleet follow, so all three answer one window with one version.
    settings   = lset.resolve_detached(from_date)
    # Head list comes from the table, so a new loss column needs no code change.
    heads      = discover_loss_heads(db, (settings or {}).get("heads"))
    shift_cols = [h["column"] for h in heads if h["column"] not in SAP_SOURCED]

    # ── WHICH MACHINE DUG WHAT, THIS MONTH ──────────────────────────────────
    # The month is taken from from_date. A range inside one month -- which is
    # what the page sends, MTD -- resolves to that month's plan; a range that
    # straddles a month boundary uses the month it STARTS in, and says so, as
    # the plan has no finer grain than a month by the mine's own decision.
    plan = _resolve_plan(from_date, to_date)
    ore_machines = _specs(plan["ore"])
    ob_machines  = _specs(plan["ob"])

    ore_shift = _shift_hours(db, ore_machines, from_date, to_date, shift_cols)
    ob_shift  = _shift_hours(db, ob_machines,  from_date, to_date, shift_cols)

    ore_bd, ore_pm = _downtime(db, ore_machines, from_date, to_date)
    ob_bd,  ob_pm  = _downtime(db, ob_machines,  from_date, to_date)

    def hours(source: str) -> tuple[float, float]:
        if source == "SAP_BD": return ore_bd, ob_bd
        if source == "SAP_PM": return ore_pm, ob_pm
        return ore_shift.get(source, 0.0), ob_shift.get(source, 0.0)

    # `column` is carried through so KAM Wise Loss Tree can key on it. Keying the
    # tree on the label would break the moment a label is reworded, which is the
    # same reason LOSS_TYPE_BY_COLUMN and KAM_BY_COLUMN are column-keyed.
    raw = [(h["sl_no"], h["label"], *hours(h["source"]), h["loss_type"],
            h["kam"], h["column"], h["role"]) for h in heads]

    tot_ore_hrs = sum(r[2] for r in raw)
    tot_ob_hrs  = sum(r[3] for r in raw)

    # ── THE COVERAGE GUARD ──────────────────────────────────────────────────
    # Hours belonging to a fleet machine that reached NEITHER bucket, because
    # it has never been assigned or because nothing in the OEE fleet list says
    # how to find its hours.
    #
    # WHY THIS LINE EXISTS AT ALL. Each factor is Deviation / its own hour
    # total, so the Planned Loss column foots to the Deviation whatever the
    # hours are -- a machine missing from the plan does not break the total and
    # leaves no symptom on the page. What it does instead is shrink the
    # denominator, which lifts every head in proportion and moves the
    # controllable / non-controllable split of the rupee value. 200 OB hours
    # missing takes the factor from 5.5627 to 6.2584 CuM/hr and overstates
    # every OB head by 12.5%, with nothing on screen to say so. This number is
    # the thing to read before the rupee figure.
    excluded = _specs(plan["excluded"])
    if excluded:
        ex_shift = _shift_hours(db, excluded, from_date, to_date, shift_cols)
        ex_bd, ex_pm = _downtime(db, excluded, from_date, to_date)
        ex_hrs = sum(ex_shift.get(c, 0.0) for c in shift_cols) + ex_bd + ex_pm
    else:
        ex_hrs = 0.0
    counted_hrs = tot_ore_hrs + tot_ob_hrs
    fleet_hrs   = counted_hrs + ex_hrs

    ore_factor = (ore_dev / tot_ore_hrs) if tot_ore_hrs > 0 else 0.0
    ob_factor  = (ob_dev  / tot_ob_hrs)  if tot_ob_hrs  > 0 else 0.0

    grade_qty = _grade_plan(db, from_date, to_date)
    # The issue current for the month the report ends in — read, not typed.
    costing   = _weighted_rate(grade_qty, ibm_rates.rates_for(to_date))
    rate      = costing["weighted_rate"]

    def amount(ore_loss_mt: float) -> float | None:
        return round(ore_loss_mt * rate, 2) if rate is not None else None

    # Loss Amount is costed off the ROUNDED planned ore loss — the same figure
    # the page prints — so that every row is reproducible by hand from what is on
    # screen, and the column foots exactly to the total. Costing the unrounded
    # value instead is marginally more precise but leaves the printed table not
    # adding up: rows drifted from their own displayed MT by up to ~Rs 530, and
    # the column missed its own total by ~Rs 640. On a Rs 4.5 crore figure the
    # precision is worth nothing and the inconsistency costs trust.
    rows = []
    for (sl, label, oh, bh, lt, kam, col, role) in raw:
        pol = round(oh * ore_factor, 1)
        rows.append({
            "sl_no":            sl,
            "loss_description": label,
            "ore_hours":        round(oh, 2),
            "planned_ore_loss": pol,
            "ob_hours":         round(bh, 2),
            "planned_ob_loss":  round(bh * ob_factor, 0),
            "loss_amount":      amount(pol),
            "loss_share_pct":   None,   # filled below, once the total is known
            "loss_type":        lt,
            "kam":              kam,
            "column":           col,
            # For the KAM Wise Loss Tree, so the matrix and the tree can never
            # put one head under two different owners.
            "role":             role,
        })

    # Loss Share — each head's rupee loss as a percentage of the period total.
    #
    #     Loss Share % = Loss Amount (head) / Total Loss Amount x 100
    #
    # Computed from the ROUNDED row amounts, i.e. the figures the page prints,
    # so the column reconciles against what a reader can add up by hand. Held to
    # one decimal: at two the independently-rounded shares drifted to 100.01%.
    #
    # Note this is numerically identical to the share of planned ore loss (MT)
    # and of ore loss hours, because planned loss is hours x one factor and
    # rupees is that x one rate — both constants cancel in a ratio. The rupee
    # basis was chosen deliberately, which does mean the column goes null
    # alongside Loss Amount if an IBM rate is ever missing.
    # A period where actual beat plan has a zero deviation and therefore a zero
    # loss total. Share is then 0/0 — undefined, not zero — so every row and the
    # footer stay None and the page renders a dash rather than a fabricated 0.0%.
    total_amount = round(sum(r["loss_amount"] for r in rows), 2) if rate is not None else None
    shares_valid = bool(total_amount)
    if shares_valid:
        for r in rows:
            r["loss_share_pct"] = round(r["loss_amount"] / total_amount * 100, 1)

    controllable     = [r for r in rows if r["loss_type"] == "Controllable"]
    non_controllable = [r for r in rows if r["loss_type"] == "Non Controllable"]
    # Anything Unclassified falls in neither bucket, so controllable +
    # non-controllable can be less than the total. That is deliberate — a head
    # nobody has classified should not be quietly counted as either, and the
    # page already names it in a banner.

    return {
        "from_date": from_date.isoformat(),
        "to_date":   to_date.isoformat(),
        "basis": {
            "days":       days,
            "ore_plan":   round(pa["ore_plan"], 2),
            "ore_actual": round(pa["ore_actual"], 2),
            "ore_deviation": round(ore_dev, 2),
            "ob_plan":    round(pa["ob_plan"], 2),
            "ob_actual":  round(pa["ob_actual"], 2),
            "ob_deviation":  round(ob_dev, 2),
            "total_ore_loss_hours": round(tot_ore_hrs, 2),
            "total_ob_loss_hours":  round(tot_ob_hrs, 2),
            "ore_factor": round(ore_factor, 4),
            "ob_factor":  round(ob_factor, 4),
            "ore_machines": [m["name"] for m in ore_machines],
            "ob_machines":  [m["name"] for m in ob_machines],
            # Ore hours + OB hours against the fleet's own total. Equal means
            # no machine is missing and both factors are sound; anything less
            # says exactly how much is unaccounted for. See the note above
            # tot_ore_hrs for why a percentage is the only visible symptom.
            "hours_counted":  round(counted_hrs, 2),
            "hours_excluded": round(ex_hrs, 2),
            "hours_fleet":    round(fleet_hrs, 2),
            "hours_coverage_pct":
                round(counted_hrs / fleet_hrs * 100, 1) if fleet_hrs > 0 else None,
        },
        # How the machine split above was arrived at, and everything the page
        # must say about it: the month it came from, machines carried forward
        # from an earlier month, and any left out entirely.
        "plan": plan,
        # Grade-wise plan feeding the weighted IBM rate. ore_plan is carried
        # alongside grade_plan_total so a mismatch between ORE_QTY and
        # HG+MG+LG is visible rather than silently absorbed — it does not
        # affect the rate (a ratio) but it does signal incomplete grade entry.
        "costing": {
            **costing,
            "ore_plan":         round(pa["ore_plan"], 2),
            "grade_plan_total": costing["total_plan_qty"],
            "grade_plan_matches_ore_plan":
                abs(costing["total_plan_qty"] - pa["ore_plan"]) < 0.5,
            "ob_costed": False,
        },
        # Shift-log completeness. A thin month understates every hour figure, so
        # the page surfaces this rather than reporting a low total as fact.
        "coverage": {
            "days_in_period":   days,
            "ore_days_present": ore_shift["_days"],
            "ob_days_present":  ob_shift["_days"],
            "ore_rows":         ore_shift["_rows"],
            "ob_rows":          ob_shift["_rows"],
        },
        "rows": rows,
        "totals": {
            "ore_hours":        round(tot_ore_hrs, 2),
            "planned_ore_loss": round(sum(r["planned_ore_loss"] for r in rows), 1),
            "ob_hours":         round(tot_ob_hrs, 2),
            "planned_ob_loss":  round(sum(r["planned_ob_loss"] for r in rows), 0),
            "controllable_ore_loss":     round(sum(r["planned_ore_loss"] for r in controllable), 1),
            "controllable_ob_loss":      round(sum(r["planned_ob_loss"] for r in controllable), 0),
            "controllable_ore_hours":    round(sum(r["ore_hours"] for r in controllable), 2),
            "controllable_ob_hours":     round(sum(r["ob_hours"] for r in controllable), 2),
            # Sum the rows' own amounts rather than re-costing the total, so the
            # printed column adds up to the printed total exactly.
            "loss_amount":
                round(sum(r["loss_amount"] for r in rows), 2)
                if rate is not None else None,
            # The true sum of the per-row shares, not a hardcoded 100.0. Rounding
            # can land it on 99.9 or 100.1; the page shows what the column
            # actually adds to rather than a tidier number that disagrees with it.
            "loss_share_pct":
                round(sum(r["loss_share_pct"] for r in rows), 1)
                if shares_valid else None,
            "controllable_loss_amount":
                round(sum(r["loss_amount"] for r in controllable), 2)
                if rate is not None else None,
            "non_controllable_loss_amount":
                round(sum(r["loss_amount"] for r in non_controllable), 2)
                if rate is not None else None,
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# Equipment-wise LCM
# ═════════════════════════════════════════════════════════════════════════════
# THE MATRIX ABOVE GIVES EVERY MACHINE ON A SIDE THE SAME RATE. One Ore Factor
# divides the whole ore deviation by the whole ore fleet's hours, so an hour
# lost on a 26 CuM/hr excavator and an hour lost on a 17 CuM/hr one cost the
# same tonnes. They do not: the bigger machine was planned to produce more, so
# an hour of its downtime loses more.
#
# This section says so, by giving each machine its own factor:
#
#   1. Split the deviation across the machines on that side, in the ratio of
#      their ideal capacity:
#
#          Share(m) = Deviation x Capacity(m) / SUM Capacity(side)
#
#   2. Divide each machine's share by ITS OWN loss hours:
#
#          Factor(m) = Share(m) / SUM hours(m)
#
#   3. Cost every loss head at the factor of the machine the hours fell on:
#
#          Loss(head, m) = Hours(head, m) x Factor(m)
#
# WHY THE TOTAL CANNOT MOVE. Each machine's column foots to its own share by
# construction, and the shares are a partition of the deviation, so the whole
# table still foots to the deviation. Nothing is created or destroyed here --
# the loss is only attributed differently between heads. Verified head by head
# against get_lcm() over six windows: hours agree to 0.0000, and the rupee
# total to within Rs 1,962 of Rs 15.5 crore, which is row rounding alone.
#
# WHICH MACHINES APPEAR IS NOT WRITTEN HERE. The sides come from the mine's
# Equipment Excavation Plan and the capacities from the Equipment Status
# Selector, both resolved for the day the window opens -- the same two sources
# the matrix above already uses. Move a machine from OB to ore, change its
# capacity, or mark it inactive, and this section follows on the next request
# with no code change.

#: A machine on the plan that the selector gives no capacity cannot be given a
#: share -- there is no ratio to put it in. It is NAMED in the response rather
#: than dropped, because its hours are still in the denominator of the matrix
#: above and somebody has to know its loss went unattributed.
CAP_FROM_SELECTOR, CAP_FROM_FLEET = "selector", "fleet_default"


def _capacities(on_date: date) -> tuple[dict[str, float | None], str]:
    """Ideal capacity per machine, as the Equipment Status Selector holds it.

    Read for the DAY THE WINDOW OPENS, so a capacity the mine corrected in
    November does not rewrite October. Falls back to the OEE fleet list when
    minehub cannot be reached, exactly as the fleet itself does, and says
    which of the two answered so a stale default is never taken for the
    mine's own figure.
    """
    rows = eqs.resolve_detached(on_date, klass=eqs.EXCAVATOR, active_only=False)
    fleet = {m["name"]: float(m["ideal_cap"]) for m in _FLEET_SPEC}
    if rows is None:
        return fleet, CAP_FROM_FLEET
    caps: dict[str, float | None] = {}
    for r in rows:
        v = r.get("ideal_cum_per_hr")
        caps[r["equipment_name"]] = float(v) if v is not None else None
    # A machine the selector has never carried still gets the built-in figure
    # rather than losing its share.
    for name, cap in fleet.items():
        caps.setdefault(name, cap)
    return caps, CAP_FROM_SELECTOR


def _lr_units(scaled: dict[str, float], target: int) -> dict[str, int]:
    """Largest remainder, in whole last-place units.

    Floor every cell, then hand the leftover units to the cells with the
    biggest discarded fraction. When units have to be taken back instead, they
    come off the smallest fractions first and never off a cell already at
    zero -- a negative loss cell would be a nonsense the page cannot render.
    """
    if not scaled:
        return {}
    out = {k: math.floor(v) for k, v in scaled.items()}
    need = target - sum(out.values())
    if need > 0:
        # ONLY A CELL THAT EARNED SOMETHING MAY RECEIVE A SPARE UNIT. A loss
        # head a machine did not lose an hour to must read zero; handing it a
        # rounding unit would put a loss where the shift log records none.
        order = [k for k in sorted(scaled, key=lambda k: scaled[k] - out[k],
                                   reverse=True) if scaled[k] > 0]
        for i in range(need):
            if not order:
                break
            out[order[i % len(order)]] += 1
    elif need < 0:
        order = sorted(scaled, key=lambda k: scaled[k] - out[k])
        taken = 0
        while taken < -need:
            moved = False
            for k in order:
                if out[k] > 0:
                    out[k] -= 1
                    taken += 1
                    moved = True
                    if taken >= -need:
                        break
            if not moved:            # nothing left to take; stop rather than
                break                # drive a cell negative
    return out


def _fit_matrix(raw: dict[str, dict[str, float]],
                col_targets: dict[str, float], dp: int,
                grand_total: float) -> dict[str, dict[str, float]]:
    """Round a loss-head x machine grid so it foots BOTH ways.

    ROUNDING A GRID IS NOT ROUNDING A LIST. Round each cell on its own and
    neither the rows nor the columns add up; round the rows only -- which is
    what largest remainder alone does -- and every row foots while a machine's
    column drifts from the share its capacity earned it. On 15 October that
    drift was 0.16 MT on TATA-490 and the opposite 0.16 on TATA-470(2): the
    table still totalled 633 MT, but a reader comparing a machine's column to
    its own stated share would find two figures that disagree, with nothing on
    screen to explain why.

    So the grid is fitted against all three constraints at once:

      0. The row totals are themselves largest-remaindered against the
         DEVIATION, so the table's grand total is the deviation exactly rather
         than 25 independently rounded rows landing near it.
      1. Largest remainder down each ROW, against that head's fitted total.
      2. Single last-place units are then moved BETWEEN MACHINES INSIDE A ROW
         -- which leaves every row total untouched -- until each machine's
         column reaches its own target.

    A unit is only ever moved to a machine that actually lost hours on that
    head. A head a machine did not lose an hour to must read zero, and no
    amount of tidy arithmetic justifies putting a loss there.

    The adjustment is bounded by the rounding residual itself -- a handful of
    units across the whole grid -- so no displayed figure moves by more than
    one unit in its last decimal place.
    """
    q = 10 ** dp
    machines = sorted({m for cells in raw.values() for m in cells})
    if not machines:
        return {k: {} for k in raw}

    row_units = _lr_units({k: sum(v.values()) * q for k, v in raw.items()},
                          int(round((grand_total or 0.0) * q)))
    total = sum(row_units.values())

    # Column targets, themselves largest-remaindered so they add to the grid
    # total rather than to the unrounded deviation.
    col_units = _lr_units({m: (col_targets.get(m) or 0.0) * q for m in machines},
                          total)

    cells = {k: _lr_units({m: (v.get(m) or 0.0) * q for m in machines},
                          row_units[k])
             for k, v in raw.items()}

    # Pass 2 — move single units sideways within a row.
    for _ in range(2000):
        col_now = {m: sum(cells[k][m] for k in cells) for m in machines}
        over = [m for m in machines if col_now[m] > col_units[m]]
        under = [m for m in machines if col_now[m] < col_units[m]]
        if not over or not under:
            break
        moved = False
        for a in over:
            for b in under:
                for k in cells:
                    # `a` must have a unit to give, and `b` must have lost
                    # hours on this head for a loss there to be truthful.
                    if cells[k][a] > 0 and (raw[k].get(b) or 0.0) > 0:
                        cells[k][a] -= 1
                        cells[k][b] += 1
                        moved = True
                        break
                if moved:
                    break
            if moved:
                break
        if not moved:
            break        # nowhere truthful to put it; the row total still foots

    return {k: {m: v / q for m, v in row.items()} for k, row in cells.items()}


def _per_machine_hours(db: Session, names: list[str], fd: date, td: date,
                       shift_cols: list[str]) -> dict[str, dict[str, float]]:
    """The same hours the matrix above counts, resolved one machine at a time.

    A DECOMPOSITION, NOT A SECOND OPINION. Every figure comes from the exact
    functions get_lcm() uses -- _shift_hours for the log and _downtime for the
    SAP-or-shift-log breakdown rule -- called with a one-machine group. That is
    what makes the parts provably sum to the whole: checked head by head over
    six windows, worst difference 0.0000 hours.
    """
    per: dict[str, dict[str, float]] = {}
    for n in names:
        spec = _specs([n])
        if not spec:                      # named on the plan, unknown to OEE
            continue
        log = _shift_hours(db, spec, fd, td, shift_cols)
        bdh, pmh = _downtime(db, spec, fd, td)
        hours = {c: log.get(c, 0.0) for c in shift_cols}
        hours["SAP_BD"], hours["SAP_PM"] = bdh, pmh
        per[n] = hours
    return per


def _allocate(per: dict[str, dict[str, float]], caps: dict[str, float | None],
              deviation: float) -> dict:
    """Capacity-share allocation, and everything that could not take part.

    ONLY MACHINES THAT ACTUALLY LOST HOURS ARE GIVEN A SHARE. A machine that
    ran all month without a single lost hour has nothing to carry its share
    on -- Share / 0 is undefined, and leaving the share with it would strand
    that tonnage where no loss head could ever show it. Its share goes to the
    machines that did lose hours, which keeps the column footing. This is a
    real case: 1-10 October had an ore machine idle on the loss side.
    """
    totals = {n: sum(h.values()) for n, h in per.items()}
    carrying = [n for n in per if totals[n] > 0 and caps.get(n)]
    idle = sorted(n for n in per if totals[n] <= 0)
    no_cap = sorted(n for n in per if totals[n] > 0 and not caps.get(n))

    cap_sum = sum(caps[n] for n in carrying)
    share = ({n: deviation * caps[n] / cap_sum for n in carrying}
             if cap_sum > 0 else {})
    factor = {n: (share[n] / totals[n]) for n in share}
    return {"totals": totals, "share": share, "factor": factor,
            "carrying": carrying, "idle": idle, "no_capacity": no_cap,
            "capacity_sum": cap_sum}


def get_lcm_by_equipment(db: Session, from_date: date, to_date: date) -> dict:
    """The Lost Cost Matrix, one factor per machine instead of one per side.

    Built ON TOP of get_lcm() rather than beside it, the same way the KAM Wise
    Loss Tree is, so the two tables on the page can never disagree about the
    period, the deviation, the loss heads, their owners or the IBM rate. The
    only thing this adds is the split.
    """
    base = get_lcm(db, from_date, to_date)
    b = base["basis"]
    rate = base["costing"]["weighted_rate"]

    settings = lset.resolve_detached(from_date)
    heads = discover_loss_heads(db, (settings or {}).get("heads"))
    shift_cols = [h["column"] for h in heads if h["column"] not in SAP_SOURCED]
    caps, cap_source = _capacities(from_date)

    ore_per = _per_machine_hours(db, b["ore_machines"], from_date, to_date, shift_cols)
    ob_per = _per_machine_hours(db, b["ob_machines"], from_date, to_date, shift_cols)
    ore_a = _allocate(ore_per, caps, b["ore_deviation"])
    ob_a = _allocate(ob_per, caps, b["ob_deviation"])

    hired = {m["name"]: m["hired"] for m in _FLEET_SPEC}

    # ── The machines, in the order the page lists them: ore first, then OB,
    #    each by descending capacity so the biggest contributor reads first.
    def machine_rows(per, alloc, side, unit):
        out = []
        for n in per:
            out.append({
                "equipment_name": n,
                "side": side,
                "unit": unit,
                "capacity": caps.get(n),
                "has_capacity": caps.get(n) is not None,
                "hours": round(alloc["totals"][n], 2),
                "share": round(alloc["share"][n], 2) if n in alloc["share"] else None,
                "share_pct": (round(caps[n] / alloc["capacity_sum"] * 100, 2)
                              if n in alloc["share"] and alloc["capacity_sum"] else None),
                "factor": round(alloc["factor"][n], 4) if n in alloc["factor"] else None,
                # Why a machine is on the list but carries nothing.
                "carries_share": n in alloc["share"],
                "reason": (None if n in alloc["share"]
                           else "no_loss_hours" if alloc["totals"][n] <= 0
                           else "no_capacity"),
                "hired": hired.get(n, False),
                # Which system its breakdown came from, so the page can say so
                # exactly as the OEE table does.
                "bd_source": "SHIFT LOG" if hired.get(n, False) else "SAP",
            })
        out.sort(key=lambda m: (-(m["capacity"] or 0), m["equipment_name"]))
        return out

    machines = (machine_rows(ore_per, ore_a, "ORE", "MT")
                + machine_rows(ob_per, ob_a, "OB", "CuM"))

    # ── The grid, rounded once for the whole table rather than row by row.
    #    Fitting it in one pass is what lets both the rows and the machine
    #    columns foot -- see _fit_matrix. Done per head it cannot: a row-only
    #    fit leaves each machine's column adrift from the share its capacity
    #    earned, with nothing on screen to explain the gap.
    ore_raw_all = {h["column"]: {n: ore_per[n].get(h["source"], 0.0)
                                 * ore_a["factor"].get(n, 0.0)
                                 for n in ore_per} for h in heads}
    ob_raw_all = {h["column"]: {n: ob_per[n].get(h["source"], 0.0)
                                * ob_a["factor"].get(n, 0.0)
                                for n in ob_per} for h in heads}
    # Fitted to the SUM OF THE SHARES, which is the deviation whenever any
    # machine can carry one and zero when none can -- a month with no
    # excavation plan then produces an empty grid rather than a deviation
    # spread over machines nobody assigned. Written as the sum rather than as
    # `ore_deviation` so the two can never drift apart if _allocate changes.
    ore_grid = _fit_matrix(ore_raw_all, ore_a["share"], 1,
                           sum(ore_a["share"].values()))
    ob_grid = _fit_matrix(ob_raw_all, ob_a["share"], 0,
                          sum(ob_a["share"].values()))

    # ── The rows. Each head carries its per-machine cells AND the roll-up,
    #    so the page can show one machine, or all of them side by side, from
    #    one payload.
    rows = []
    for h in heads:
        src = h["source"]
        ore_cell = ore_grid[h["column"]]
        ob_cell = ob_grid[h["column"]]
        # The printed row total IS the sum of the printed cells, so the row
        # foots on screen by construction rather than by tolerance.
        ore_tot = round(sum(ore_cell.values()), 1)
        ob_tot = round(sum(ob_cell.values()), 0)

        cells = {}
        for n in ore_per:
            loss = ore_cell.get(n, 0.0)
            cells[n] = {
                "side": "ORE", "unit": "MT",
                "hours": round(ore_per[n].get(src, 0.0), 2),
                "planned_loss": loss,
                # OB carries no rupee value -- it is waste rock, not a
                # saleable product -- so only ore machines get an amount.
                "loss_amount": round(loss * rate, 2) if rate is not None else None,
            }
        for n in ob_per:
            cells[n] = {
                "side": "OB", "unit": "CuM",
                "hours": round(ob_per[n].get(src, 0.0), 2),
                "planned_loss": ob_cell.get(n, 0.0),
                "loss_amount": None,
            }

        rows.append({
            "sl_no": h["sl_no"],
            "loss_description": h["label"],
            "column": h["column"],
            "loss_type": h["loss_type"],
            "kam": h["kam"],
            "role": h["role"],
            "action_text":     h["action_text"],
            "owning_function": h["owning_function"],
            # The equipment-wise roll-up: every machine's cell added together.
            "ore_hours": round(sum(ore_per[n].get(src, 0.0) for n in ore_per), 2),
            "planned_ore_loss": ore_tot,
            "ob_hours": round(sum(ob_per[n].get(src, 0.0) for n in ob_per), 2),
            "planned_ob_loss": ob_tot,
            "loss_amount": round(ore_tot * rate, 2) if rate is not None else None,
            "loss_share_pct": None,            # filled once the total is known
            # What the same head reads on the matrix below, so the page can
            # show the movement rather than leaving a reader to wonder why two
            # tables on one screen disagree.
            "overall_planned_ore_loss": None,  # filled below
            "overall_planned_ob_loss": None,
            "machines": cells,
        })
    rows.sort(key=lambda r: r["sl_no"])

    overall = {r["column"]: r for r in base["rows"]}
    for r in rows:
        o = overall.get(r["column"])
        if o:
            r["overall_planned_ore_loss"] = o["planned_ore_loss"]
            r["overall_planned_ob_loss"] = o["planned_ob_loss"]

    total_amount = (round(sum(r["loss_amount"] for r in rows), 2)
                    if rate is not None else None)
    if total_amount:
        for r in rows:
            r["loss_share_pct"] = round(r["loss_amount"] / total_amount * 100, 1)

    ctrl = [r for r in rows if r["loss_type"] == "Controllable"]
    nctrl = [r for r in rows if r["loss_type"] == "Non Controllable"]

    # ── Per-machine column totals, for the foot of each machine's table.
    m_tot = {}
    for m in machines:
        n = m["equipment_name"]
        m_tot[n] = {
            "hours": round(sum(r["machines"][n]["hours"] for r in rows), 2),
            "planned_loss": round(sum(r["machines"][n]["planned_loss"] for r in rows),
                                  1 if m["side"] == "ORE" else 0),
            "loss_amount": (round(sum((r["machines"][n]["loss_amount"] or 0.0)
                                      for r in rows), 2)
                            if m["side"] == "ORE" and rate is not None else None),
        }

    return {
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "machines": machines,
        "machine_totals": m_tot,
        "rows": rows,
        "capacity_source": cap_source,
        # Everything the matrix below already resolved, echoed rather than
        # re-queried so the two tables are answering one question.
        "basis": b,
        "plan": base["plan"],
        "costing": base["costing"],
        "coverage": base["coverage"],
        "totals": {
            "ore_hours": round(sum(r["ore_hours"] for r in rows), 2),
            "planned_ore_loss": round(sum(r["planned_ore_loss"] for r in rows), 1),
            "ob_hours": round(sum(r["ob_hours"] for r in rows), 2),
            "planned_ob_loss": round(sum(r["planned_ob_loss"] for r in rows), 0),
            "loss_amount": total_amount,
            "loss_share_pct": (round(sum(r["loss_share_pct"] for r in rows), 1)
                               if total_amount else None),
            "controllable_loss_amount":
                round(sum(r["loss_amount"] for r in ctrl), 2) if rate is not None else None,
            "non_controllable_loss_amount":
                round(sum(r["loss_amount"] for r in nctrl), 2) if rate is not None else None,
        },
        # ── The reconciliation, STATED rather than assumed ──────────────────
        # This section exists to re-attribute a total, never to change it. The
        # page prints these so a reader can see the two tables agree instead of
        # being asked to trust it.
        "reconciliation": {
            "ore_deviation": b["ore_deviation"],
            "ob_deviation": b["ob_deviation"],
            "overall_loss_amount": base["totals"]["loss_amount"],
            "overall_ore_hours": b["total_ore_loss_hours"],
            "overall_ob_hours": b["total_ob_loss_hours"],
            "hours_match": (
                abs(sum(r["ore_hours"] for r in rows) - b["total_ore_loss_hours"]) < 0.05
                and abs(sum(r["ob_hours"] for r in rows) - b["total_ob_loss_hours"]) < 0.05),
            "ore_loss_match":
                abs(sum(r["planned_ore_loss"] for r in rows) - b["ore_deviation"]) < 1.0,
            "ob_loss_match":
                abs(sum(r["planned_ob_loss"] for r in rows) - b["ob_deviation"]) < 25.0,
            "amount_match": (
                base["totals"]["loss_amount"] is None or total_amount is None
                or abs(total_amount - base["totals"]["loss_amount"]) < 5000.0),
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# KAM Wise Loss Structure
# ═════════════════════════════════════════════════════════════════════════════
# The mine's own layout, supplied as a workbook on 11 November 2026. Two parts:
#
#   SUMMARY   ORE and OB, each Plan / Actual / -ve Variance / Value, and then
#             the same variance split per excavator.
#   STRUCTURE Chief of Mines over SEVEN heads drawn on ONE line, each card
#             carrying Total / Controllable / Non Controllable in BOTH units
#             the mine reads -- production variance in MT and its value in
#             rupees -- with COB Loss on Head COB and the Chief alone.
#
# ── IT IS BUILT ON THE EQUIPMENT WISE MATRIX, NOT BESIDE IT ─────────────────
# One call to get_lcm_by_equipment() supplies the deviation, the costing, the
# per-machine split and the per-head rows. That is deliberate: the matrix on
# the page above is the equipment-wise one, and a tree that re-derived its own
# figures could disagree with the table it is supposed to summarise. The
# grand totals are identical either way -- both foot to the deviation -- but
# the per-head attribution differs, and so would each card.
#
# ── THE REPORTING LINE DOES NOT ADD UP, AND MUST NOT ────────────────────────
# Head Electrical and Head Store report to Head Engineering, Head Security to
# Head Human Resource. The mine asked for all seven on one line, which is also
# the only arrangement that can be read: each node carries ONLY the loss heads
# assigned to it, the seven are disjoint, and the root is their sum. Nothing
# sums through parent_role_code -- it is carried so a card can say who its
# head reports to, nothing more.
#
# ── PRODUCTION VARIANCE IS ORE ONLY ─────────────────────────────────────────
# By the mine's instruction. Ore is MT and OB is CuM; they cannot be added,
# and only ore carries an IBM rate, so the MT column and the rupee column
# describe the same loss. OB is reported in the summary above and stays out of
# the cards.

#: Nodes that are never drawn as a child card: the Chief is the root, and
#: Unmapped is shown only when a head nobody has classified lands in it.
_ROOT_ROLE = "CHIEF"


def _money(v: float | None) -> float | None:
    """Rupees to lakhs, as every card on this structure is labelled."""
    return None if v is None else round(v / 100000.0, 2)


def get_loss_structure(db: Session, from_date: date, to_date: date) -> dict:
    """The summary and the seven-head loss structure, for one window."""
    eq = get_lcm_by_equipment(db, from_date, to_date)
    basis = eq["basis"]
    rows = eq["rows"]
    rate = eq["costing"]["weighted_rate"]

    # COB rides alongside: a different plant, a different deviation model and
    # a different IBM line. It is rupees, so it adds to the root -- but it has
    # no MT, because what it lost is concentrate, not ore.
    from app.services.lcm_cob import get_cob_lcm
    cob = get_cob_lcm(db, from_date, to_date)
    cob_total = (cob.get("totals") or {}).get("loss_amount")

    settings = lset.resolve_detached(from_date)
    all_roles = (settings or {}).get("roles") or []
    if not all_roles:                       # minehub unreachable
        all_roles = ([{"role_code": CHIEF_OF_MINES["role"],
                       "title": CHIEF_OF_MINES["title"],
                       "owner_kam": CHIEF_OF_MINES["owner"], "sl_order": 1,
                       "parent_role_code": None}]
                     + [{"role_code": m["role"], "title": m["title"],
                         "owner_kam": m["owner"], "sl_order": i + 2,
                         "parent_role_code": CHIEF_OF_MINES["role"]}
                        for i, m in enumerate(ROLE_META)]
                     + [{"role_code": ROLE_COB, "title": COB_META["title"],
                         "owner_kam": COB_META["owner"], "sl_order": 9,
                         "parent_role_code": CHIEF_OF_MINES["role"]}])
    by_code = {r["role_code"]: r for r in all_roles}
    # The employee behind each name, so a card can carry a photo later. Keyed
    # on the id, never the spelling -- a renamed KAM keeps their photo.
    emp_of = {k["kam_name"]: k.get("emp_id")
              for k in ((settings or {}).get("kams") or [])}

    # ── Aggregate the matrix rows onto the nodes ────────────────────────────
    def blank():
        return {"ctrl_mt": 0.0, "ctrl_rs": 0.0,
                "nctrl_mt": 0.0, "nctrl_rs": 0.0,
                "uncl_mt": 0.0, "uncl_rs": 0.0, "heads": 0, "loss_heads": []}

    buckets = {code: blank() for code in by_code}
    buckets.setdefault(ROLE_UNMAPPED, blank())

    for r in rows:
        code = r.get("role") or ROLE_UNMAPPED
        # A head pointing at a node that no longer exists is SHOWN, in
        # Unmapped, never dropped -- the root must keep matching the matrix.
        if code not in buckets or code == _ROOT_ROLE:
            code = ROLE_UNMAPPED
        b = buckets[code]
        mt = r["planned_ore_loss"] or 0.0
        rs = r["loss_amount"] or 0.0
        if r["loss_type"] == "Controllable":
            b["ctrl_mt"] += mt
            b["ctrl_rs"] += rs
        elif r["loss_type"] == "Non Controllable":
            b["nctrl_mt"] += mt
            b["nctrl_rs"] += rs
        else:
            b["uncl_mt"] += mt
            b["uncl_rs"] += rs
        b["heads"] += 1
        # EVERY HEAD IS LISTED, INCLUDING THE ZEROS. The mine's own sheet
        # carries "Not in operation 0.00" on its face, and it earns its line:
        # a head the KAM is answerable for that cost nothing this period is a
        # result, and dropping it would leave the reader unable to tell it
        # apart from a head nobody has assigned.
        b["loss_heads"].append({
            "loss_description": r["loss_description"],
            "loss_type":        r["loss_type"],
            "column":           r["column"],
            "kam":              r["kam"],
            "variance_mt":      mt,
            "value_lacs":       _money(rs),
        })

    rate_available = rate is not None

    def node(code: str) -> dict:
        meta = by_code.get(code, {"role_code": code, "title": code,
                                  "owner_kam": None, "sl_order": 999,
                                  "parent_role_code": None})
        b = buckets[code]
        b["loss_heads"].sort(key=lambda x: -(x["variance_mt"] or 0))
        is_cob = code == ROLE_COB
        # COB carries ONE figure and no split: LCM for COB attributes the
        # plant's deviation to causes, and has no controllability dimension
        # anywhere in it. Zeros here would claim the plant had no controllable
        # loss, which is a statement nobody has made.
        ctrl_rs = None if is_cob else round(b["ctrl_rs"], 2) if rate_available else None
        nctrl_rs = None if is_cob else round(b["nctrl_rs"], 2) if rate_available else None
        uncl_rs = None if is_cob else round(b["uncl_rs"], 2) if rate_available else None
        cob_rs = cob_total if is_cob else None
        total_rs = (cob_total if is_cob
                    else (round(b["ctrl_rs"] + b["nctrl_rs"] + b["uncl_rs"], 2)
                          if rate_available else None))
        owner = meta.get("owner_kam")
        return {
            "role_code":        code,
            "title":            meta.get("title") or code,
            "owner":            owner,
            "emp_id":           emp_of.get(owner) if owner else None,
            "parent_role_code": meta.get("parent_role_code"),
            "sl_order":         meta.get("sl_order") or 999,
            "head_count":       b["heads"],
            # MT is ore only, by the mine's instruction. COB has none -- what
            # it lost is concentrate at the plant, not ore at the face.
            "total":            {"variance_mt": None if is_cob else round(b["ctrl_mt"] + b["nctrl_mt"] + b["uncl_mt"], 1),
                                 "value_lacs": _money(total_rs)},
            "controllable":     {"variance_mt": None if is_cob else round(b["ctrl_mt"], 1),
                                 "value_lacs": _money(ctrl_rs)},
            "non_controllable": {"variance_mt": None if is_cob else round(b["nctrl_mt"], 1),
                                 "value_lacs": _money(nctrl_rs)},
            "unclassified":     {"variance_mt": None if is_cob else round(b["uncl_mt"], 1),
                                 "value_lacs": _money(uncl_rs)},
            # Shown on Head COB and the Chief alone, per the mine's layout.
            "cob":              {"variance_mt": None, "value_lacs": _money(cob_rs)},
            "shows_cob":        is_cob,
            # What the MT column of this node's list is measured in. Ore at
            # the face everywhere except COB, whose causes are concentrate at
            # the plant -- which is exactly why the card itself shows a dash.
            "loss_heads_unit":  "concentrate_mt" if is_cob else "ore_mt",
            "loss_heads":       b["loss_heads"],
        }

    children = [node(c["role_code"]) for c in
                sorted(all_roles, key=lambda r: r["sl_order"] or 999)
                if c["role_code"] not in (_ROOT_ROLE, ROLE_UNMAPPED)]
    if buckets[ROLE_UNMAPPED]["heads"]:
        children.append({**node(ROLE_UNMAPPED), "title": "Unmapped loss heads"})

    # HEAD COB'S CAUSES COME FROM THE COB MATRIX, NOT THIS ONE. No mines loss
    # head reports to it -- its money is the plant's own deviation, broken
    # down by LCM for COB into feed volume, recovery and the two beneath it.
    # Without this the one card carrying rupees would open on an empty list.
    for c in children:
        if c["role_code"] != ROLE_COB:
            continue
        c["loss_heads"] = [{
            "loss_description": r.get("loss_description"),
            "loss_type":        None,      # COB has no controllability axis
            "column":           None,
            "kam":              c["owner"],
            # Its own tree: Feed grade and Plant efficiency sit under
            # Recovery / yield, so the list can indent them rather than
            # reading as six things that add up.
            "level":            r.get("level") or 1,
            "parent":           r.get("parent"),
            "variance_mt":      r.get("loss_mt"),
            "value_lacs":       _money(r.get("loss_amount")),
        } for r in (cob.get("rows") or [])]

    # ── The root. Its figures are the sum of its children, by construction ──
    def across(field: str, unit: str) -> float | None:
        vals = [c[field][unit] for c in children if c[field][unit] is not None]
        return round(sum(vals), 1 if unit == "variance_mt" else 2) if vals else None

    root_meta = by_code.get(_ROOT_ROLE, {})
    root_owner = root_meta.get("owner_kam")
    root_total_rs = across("total", "value_lacs")
    root = {
        "role_code":        _ROOT_ROLE,
        "title":            root_meta.get("title") or "Chief of Mines",
        "owner":            root_owner,
        "emp_id":           emp_of.get(root_owner) if root_owner else None,
        "parent_role_code": None,
        "sl_order":         root_meta.get("sl_order") or 1,
        "head_count":       sum(c["head_count"] for c in children),
        "total":            {"variance_mt": across("total", "variance_mt"),
                             "value_lacs": root_total_rs},
        "controllable":     {"variance_mt": across("controllable", "variance_mt"),
                             "value_lacs": across("controllable", "value_lacs")},
        "non_controllable": {"variance_mt": across("non_controllable", "variance_mt"),
                             "value_lacs": across("non_controllable", "value_lacs")},
        "unclassified":     {"variance_mt": across("unclassified", "variance_mt"),
                             "value_lacs": across("unclassified", "value_lacs")},
        "cob":              {"variance_mt": None, "value_lacs": _money(cob_total)},
        "shows_cob":        True,
        "loss_heads_unit":  "ore_mt",
        # THE CHIEF'S LIST IS EVERY HEAD UNDER HIM, AND IT FOOTS TO HIS CARD.
        # His Total carries COB, so the list carries a COB line too -- the
        # alternative is a list that visibly adds up to less than the figure
        # printed above it. It has no MT, for the same reason the COB card
        # shows a dash: concentrate at the plant is not ore at the face.
        "loss_heads": sorted(
            [h for c in children if c["role_code"] != ROLE_COB
             for h in c["loss_heads"]],
            key=lambda x: -(x["variance_mt"] or 0))
        + ([{"loss_description": "COB Loss", "loss_type": None,
             "column": None, "kam": by_code.get(ROLE_COB, {}).get("owner_kam"),
             "variance_mt": None, "value_lacs": _money(cob_total)}]
           if cob_total else []),
    }

    # ── The summary block ───────────────────────────────────────────────────
    # Plan, actual and variance exactly as the matrix computed them, and the
    # value of the ore shortfall at the plan-weighted IBM rate. OB carries no
    # value and reports a dash rather than a zero -- waste rock has no price,
    # which is not the same as being worth nothing to lose.
    summary = {
        "ore": {"plan": basis["ore_plan"], "actual": basis["ore_actual"],
                "variance": basis["ore_deviation"], "unit": "MT",
                "value_lacs": _money(eq["totals"]["loss_amount"])},
        "ob":  {"plan": basis["ob_plan"], "actual": basis["ob_actual"],
                "variance": basis["ob_deviation"], "unit": "CuM",
                "value_lacs": None},
    }

    equipment = []
    for m in eq["machines"]:
        t = eq["machine_totals"].get(m["equipment_name"], {})
        equipment.append({
            "equipment_name": m["equipment_name"],
            "side":           m["side"],
            "unit":           m["unit"],
            "capacity":       m["capacity"],
            "variance":       t.get("planned_loss"),
            "value_lacs":     _money(t.get("loss_amount")),
            "carries_share":  m["carries_share"],
            "reason":         m["reason"],
        })

    return {
        "from_date": from_date.isoformat(),
        "to_date":   to_date.isoformat(),
        "summary":   summary,
        "equipment": equipment,
        "root":      root,
        "nodes":     children,
        "rate_available": rate_available,
        "costing":   eq["costing"],
        "plan":      eq["plan"],
        "capacity_source": eq["capacity_source"],
        # ── Stated, not assumed ────────────────────────────────────────────
        # The structure re-cuts a total it must not change. These are what a
        # reader would otherwise have to check by adding up seven cards.
        "reconciliation": {
            "ore_deviation":        basis["ore_deviation"],
            "matrix_value_lacs":    _money(eq["totals"]["loss_amount"]),
            "cob_value_lacs":       _money(cob_total),
            "root_mt":              root["total"]["variance_mt"],
            "root_value_lacs":      root["total"]["value_lacs"],
            "expected_value_lacs":  _money((eq["totals"]["loss_amount"] or 0.0)
                                           + (cob_total or 0.0))
                                    if rate_available else None,
            "mt_matches": (root["total"]["variance_mt"] is not None
                           and abs(root["total"]["variance_mt"]
                                   - basis["ore_deviation"]) < 1.0),
            "value_matches": (
                not rate_available
                or (root["total"]["value_lacs"] is not None
                    and abs(root["total"]["value_lacs"]
                            - _money((eq["totals"]["loss_amount"] or 0.0)
                                     + (cob_total or 0.0))) < 0.05)),
        },
    }
