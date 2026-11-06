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
from datetime import date
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.services.sap_source import sap_one

from app.services import breakdown as bd
from app.services import ibm_rates
from app.services import equipment_plan as eqp
from app.services import lcm_settings as lset
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


def get_kam_loss_tree(db: Session, from_date: date, to_date: date) -> dict:
    """Loss by accountability head, as a tree under Chief of Mines.

    Built ON TOP of get_lcm() rather than re-querying, so this section and the
    LCM table underneath it can never disagree: same rows, same rupee rounding,
    same period basis. The root is the sum of its children by construction.

    Measured in RUPEES, per the user's choice. Loss Amount goes null in get_lcm
    when an IBM rate is missing, so `rate_available` is reported and the page
    shows dashes instead of inventing zeros.

    Loss-head discovery is dynamic — a new column in the source table appears as
    a row without anyone updating ROLE_BY_COLUMN — so anything unmapped is
    collected into its own visible node rather than silently dropped. The root
    would otherwise stop matching the LCM total, which is the one thing this
    section must never do.
    """
    lcm = get_lcm(db, from_date, to_date)
    rows = lcm["rows"]

    # COB rides alongside rather than inside: a different plant, a different
    # deviation model and a different IBM rate line (concentrates at 24,560 vs
    # the mines plan-weighted fines rate). Both are rupees, so they add.
    from app.services.lcm_cob import get_cob_lcm
    cob       = get_cob_lcm(db, from_date, to_date)
    cob_total = (cob.get("totals") or {}).get("loss_amount")

    def blank():
        return {"controllable": 0.0, "non_controllable": 0.0, "unclassified": 0.0,
                "total": 0.0, "heads": 0, "loss_heads": []}

    # THE NODES COME FROM THE SAME TABLE THE OWNERS DO. lcm_role_master holds
    # all of them, including the Chief at the root and COB alongside; this
    # section needs the ones in between, in the mine's own left-to-right
    # order. ROLE_META is the fallback for an unreachable minehub.
    settings = lset.resolve_detached(from_date)
    all_roles = (settings or {}).get("roles") or []
    mid = [r for r in all_roles
           if r["role_code"] not in (CHIEF_OF_MINES["role"], ROLE_COB,
                                     ROLE_UNMAPPED)]
    role_meta = ([{"role": r["role_code"], "title": r["title"],
                   "owner": r["owner_kam"] or "—"} for r in mid]
                 if mid else ROLE_META)
    chief = next((r for r in all_roles
                  if r["role_code"] == CHIEF_OF_MINES["role"]), None)
    chief_meta = ({"role": chief["role_code"], "title": chief["title"],
                   "owner": chief["owner_kam"] or "—"}
                  if chief else CHIEF_OF_MINES)
    cob_role = next((r for r in all_roles if r["role_code"] == ROLE_COB), None)
    cob_meta = ({"role": cob_role["role_code"], "title": cob_role["title"],
                 "owner": cob_role["owner_kam"] or "—"}
                if cob_role else COB_META)

    buckets = {m["role"]: blank() for m in role_meta}
    buckets[ROLE_UNMAPPED] = blank()

    rate_available = lcm["totals"]["loss_amount"] is not None

    for r in rows:
        # The row carries the role the matrix used, so the two sections cannot
        # disagree. A role that is not one of the nodes above -- a head
        # assigned to COB, or to a node since removed -- falls to UNMAPPED,
        # where it is still SHOWN. Dropping it would break the one invariant
        # this section has: the root must keep matching the matrix total.
        role = r.get("role") or ROLE_BY_COLUMN.get(r["column"], ROLE_UNMAPPED)
        if role not in buckets:
            role = ROLE_UNMAPPED
        b = buckets[role]
        amt = r["loss_amount"] or 0.0
        if r["loss_type"] == "Controllable":
            b["controllable"] += amt
        elif r["loss_type"] == "Non Controllable":
            b["non_controllable"] += amt
        else:
            b["unclassified"] += amt
        b["total"] += amt
        b["heads"] += 1
        if amt > 0:
            b["loss_heads"].append({
                "loss_description": r["loss_description"],
                "loss_type":        r["loss_type"],
                "loss_amount":      r["loss_amount"],
            })

    def node(role: str, title: str, owner: str) -> dict:
        b = buckets[role]
        b["loss_heads"].sort(key=lambda x: -(x["loss_amount"] or 0))
        return {
            "role": role, "title": title, "owner": owner,
            "controllable":     round(b["controllable"], 2) if rate_available else None,
            "non_controllable": round(b["non_controllable"], 2) if rate_available else None,
            "unclassified":     round(b["unclassified"], 2) if rate_available else None,
            "total":            round(b["total"], 2) if rate_available else None,
            "head_count":       b["heads"],
            "loss_heads":       b["loss_heads"],
        }

    children = [node(m["role"], m["title"], m["owner"]) for m in role_meta]
    # Only shown when it has something in it — an empty node is noise.
    if buckets[ROLE_UNMAPPED]["heads"]:
        children.append(node(ROLE_UNMAPPED, "Unmapped loss heads", "—"))

    # COB node. controllable / non_controllable stay null so the card renders a
    # single line; cob_loss is null (dash) whenever LCM for COB has no plan for
    # the window — mines_cobp_plan starts April 2026, and individual days can be
    # missing too. Null must not become zero: "nobody planned it" and "the plant
    # lost nothing" are different statements.
    children.append({
        **cob_meta,
        "controllable":     None,
        "non_controllable": None,
        "unclassified":     None,
        "cob_loss":         round(cob_total, 2) if cob_total is not None else None,
        "total":            round(cob_total, 2) if cob_total is not None else None,
        "head_count":       0,
        "loss_heads":       [],
    })

    def rollup(field: str):
        if not rate_available:
            return None
        return round(sum(c.get(field) or 0.0 for c in children), 2)

    # Chief of Mines carries the mines split PLUS COB as its own line, and the
    # total spans all four heads. A negative COB is preserved and reduces the
    # total, matching how the LCM for COB section above already renders a plant
    # that beat plan — as a gain, not something to hide.
    root_total = None
    if rate_available:
        root_total = round(
            (rollup("controllable") or 0.0)
            + (rollup("non_controllable") or 0.0)
            + (rollup("unclassified") or 0.0)
            + (cob_total or 0.0), 2)

    root = {
        **chief_meta,
        "controllable":     rollup("controllable"),
        "non_controllable": rollup("non_controllable"),
        "unclassified":     rollup("unclassified"),
        "cob_loss":         round(cob_total, 2) if cob_total is not None else None,
        "total":            root_total,
        "head_count":       sum(c["head_count"] for c in children),
        "loss_heads":       [],
    }

    return {
        "from_date": from_date.isoformat(),
        "to_date":   to_date.isoformat(),
        "measure":   "loss_amount_rs",
        "rate_available": rate_available,
        "root":      root,
        "children":  children,
        # The reconciliation the page states rather than assumes. Root is the sum
        # of its children by construction, so this checks the tree against the
        # two sources it is built from.
        #
        # NOTE the expected total is now mines + COB. Leaving it at mines alone
        # would fire the red "does not reconcile" banner on every single load
        # the moment COB was added.
        "lcm_total_loss_amount": lcm["totals"]["loss_amount"],
        "cob_total_loss_amount": round(cob_total, 2) if cob_total is not None else None,
        "expected_total": (
            round((lcm["totals"]["loss_amount"] or 0.0) + (cob_total or 0.0), 2)
            if lcm["totals"]["loss_amount"] is not None else None
        ),
        "reconciles": (
            (root["total"] is None and lcm["totals"]["loss_amount"] is None)
            or abs((root["total"] or 0)
                   - ((lcm["totals"]["loss_amount"] or 0) + (cob_total or 0))) < 1.0
        ),
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
