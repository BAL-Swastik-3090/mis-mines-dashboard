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

# ── Machine groups (own equipment only) ───────────────────────────────────────
ORE_MACHINES = [
    {"name": "TATA-470(7)", "code": "470-7", "sap_eq": "000000000000700086"},
    {"name": "TATA-470(2)", "code": "470-2", "sap_eq": "000000000000700042"},
]
OB_MACHINES = [
    {"name": "TATA-370(5)", "code": "370-5", "sap_eq": "000000000000700064"},
    {"name": "TATA-370(4)", "code": "370-4", "sap_eq": "000000000000700053"},
    {"name": "TATA-220(8)", "code": "220-8", "sap_eq": "000000000000700090"},
]

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
# Rates are supplied by the mine today and are to be scraped from the IBM site
# later, behind a user confirmation step — hence the explicit `source` field, so
# the page can always state where the number in use came from.
IBM_RATE_SOURCE = "IBM average sale price, June 2026 — chrome ore fines"

# IBM's published bands map one-to-one onto the HG/MG/LG buckets the mine plans
# in, so no band has to be chosen as representative:
#
#   IBM band                       Rs/MT     Bucket
#   52% and above Cr2O3, Fines     28,436    HG   (+52% CHROME ORE)
#   40% to below 52% Cr2O3, Fines  23,551    MG   (40-52% CHROME ORE)
#   Below 40% Cr2O3, Fines         11,294    LG   (-40% Cr2O3)
#
# These are FINES prices. The plan carries only the HG/MG/LG columns and does
# not split lump from fines, so every planned tonne is valued as fines. If the
# mine later plans lump separately it needs its own rate — lump prices differ.
#
# ₹ per MT. None = not yet determined. While ANY grade carrying plan quantity
# has no rate, the whole Loss Amount column reports null rather than a number:
# dropping the unpriced grade would silently understate every row, which is
# worse than showing nothing.
IBM_RATES: dict[str, float | None] = {
    "HG": 28436.0,   # +52% CHROME ORE            -> 52% and above, Fines
    "MG": 23551.0,   # 40-52% CHROME ORE          -> 40% to below 52%, Fines
    "LG": 11294.0,   # LOW GRADE ORE (-40% Cr2O3) -> Below 40%, Fines
}

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
    "breakdown": "Amarendra Sarangi",     "maintenance": "Amarendra Sarangi",
    "late_start": "Pramod Kumar",         "tiffin": "Gurpreet Singh",
    "hsd_shortage": "Bhimsen Barik",      "strike": "Gurpreet Singh",
    "idle_requ_basic": "Pramod Kumar",    "safety_talk": "Pramod Kumar",
    "dump_jam": "Pramod Kumar",           "lmv_availability": "Gurpreet Singh",
    "illumination_problem": "K L Das",    "absence_operator": "Gurpreet Singh",
    "idle": "Pramod Kumar",               "tipper_shortage": "Amarendra Sarangi",
    "early_close": "Pramod Kumar",        "hsd_filling": "Bhimsen Barik",
    "not_operation": "Pramod Kumar",      "rain_slippery": "Pramod Kumar",
    "trains_truck": "Maheswar Mohanty",   "imfa_blasting": "Pramod Kumar",
    "face_preparation": "Pramod Kumar",   "job_allocation": "Pramod Kumar",
    "idle_safety": "Pramod Kumar",        "other": "Pramod Kumar",
    "mines_restriction": "Pramod Kumar",
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


def discover_loss_heads(db: Session) -> list[dict]:
    """Loss heads, discovered from the table, in the mine's reporting sequence.

    Which heads exist is dynamic — read from the table's columns. Only their
    order and Sl numbers come from DISPLAY_ORDER, so the matrix reads in a
    familiar sequence while still picking up new columns automatically.
    """
    rows = db.execute(text("""
        SELECT COLUMN_NAME AS col
        FROM   INFORMATION_SCHEMA.COLUMNS
        WHERE  TABLE_SCHEMA = DATABASE()
          AND  TABLE_NAME   = 'mines_tipper_details'
        ORDER BY ORDINAL_POSITION
    """)).fetchall()

    cols = [r.col for r in rows if r.col.lower() not in NON_LOSS_COLUMNS]

    # Known columns keep their conventional Sl; anything new is numbered after the
    # highest one so it lands at the bottom rather than shifting the rest.
    next_sl = max(DISPLAY_ORDER.values(), default=0)
    sl_of: dict[str, int] = {}
    for col in cols:
        if col in DISPLAY_ORDER:
            sl_of[col] = DISPLAY_ORDER[col]
        else:
            next_sl += 1
            sl_of[col] = next_sl

    heads = [{
        "sl_no":     sl_of[col],
        "column":    col,
        "label":     _label_from_column(col),
        "source":    SAP_SOURCED.get(col, col),
        "loss_type": LOSS_TYPE_BY_COLUMN.get(col, UNCLASSIFIED),
        "kam":       KAM_BY_COLUMN.get(col, "—"),
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
    """SAP M2 notification hours. BREAKDOWN_DURAION is stored in SECONDS."""
    ph = ", ".join(f":e{i}" for i in range(len(machines)))
    params: dict = {"fd": fd, "td": td, "plant": PLANT, "wc": WORK_CENTRE}
    for i, m in enumerate(machines):
        params[f"e{i}"] = m["sap_eq"]
    row = db.execute(text(f"""
        SELECT COALESCE(SUM(BREAKDOWN_DURAION), 0) / 3600.0 AS hrs
        FROM zpm_iw29_notifications
        WHERE MAINTENANCE_PLANT = :plant AND NOTIFICATION_TYPE = 'M2'
          AND MAIN_WORK_CENTER = :wc AND EQUIPMENT IN ({ph})
          AND MALFUNCTION_START BETWEEN :fd AND :td
    """), params).fetchone()
    return _n(row.hrs) if row else 0.0


def _sap_pm(db: Session, machines: list[dict], fd: date, td: date) -> float:
    """SAP BA03 order hours. WORK_HOURS is the only usable duration column —
    DATEDIFF(completion, start) is 0 because orders open and close same-day."""
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
    ore_act = db.execute(text(f"""
        SELECT COALESCE(SUM(QUANTITY), 0) AS q FROM pp_production
        WHERE PLANT = :plant AND MATERIAL_NO IN ({ph})
          AND POSTING_DATE BETWEEN :fd AND :td
    """), p).fetchone()

    ob_act = db.execute(text("""
        SELECT COALESCE(SUM(QUANTITY), 0) AS q FROM pp_production
        WHERE PLANT = :plant AND MATERIAL_NO = :mat
          AND POSTING_DATE BETWEEN :fd AND :td
    """), {"plant": PLANT, "mat": OB_MATERIAL, "fd": fd, "td": td}).fetchone()

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


def _weighted_rate(grade_qty: dict[str, float]) -> dict:
    """Plan-weighted average IBM rate across the grades.

    Returns the rate plus the full per-grade working, so the page can show how
    the number was arrived at instead of asking anyone to trust a bare figure.
    """
    total_qty = sum(grade_qty.values())
    missing   = [g for g, q in grade_qty.items() if q > 0 and IBM_RATES.get(g) is None]

    breakdown = [{
        "grade":  g,
        "qty":    round(grade_qty.get(g, 0.0), 3),
        "rate":   IBM_RATES.get(g),
        "share":  round(grade_qty.get(g, 0.0) / total_qty * 100, 2) if total_qty > 0 else 0.0,
        "value":  round(grade_qty.get(g, 0.0) * IBM_RATES[g], 2) if IBM_RATES.get(g) is not None else None,
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
        rate = sum(q * IBM_RATES[g] for g, q in grade_qty.items() if q > 0) / total_qty
        status = "ok"

    return {
        "weighted_rate":   round(rate, 2) if rate is not None else None,
        "status":          status,
        "missing_grades":  missing,
        "total_plan_qty":  round(total_qty, 3),
        "source":          IBM_RATE_SOURCE,
        "breakdown":       breakdown,
    }


def get_lcm(db: Session, from_date: date, to_date: date) -> dict:
    days = (to_date - from_date).days + 1

    pa = _plan_actual(db, from_date, to_date)
    # Clamp at 0 — a period where actual beats plan has no production loss to
    # distribute, and a negative factor would render every row as a negative loss.
    ore_dev = max(pa["ore_plan"] - pa["ore_actual"], 0.0)
    ob_dev  = max(pa["ob_plan"]  - pa["ob_actual"],  0.0)

    # Head list comes from the table, so a new loss column needs no code change.
    heads      = discover_loss_heads(db)
    shift_cols = [h["column"] for h in heads if h["column"] not in SAP_SOURCED]

    ore_shift = _shift_hours(db, ORE_MACHINES, from_date, to_date, shift_cols)
    ob_shift  = _shift_hours(db, OB_MACHINES,  from_date, to_date, shift_cols)

    ore_bd = _sap_breakdown(db, ORE_MACHINES, from_date, to_date)
    ob_bd  = _sap_breakdown(db, OB_MACHINES,  from_date, to_date)
    ore_pm = _sap_pm(db, ORE_MACHINES, from_date, to_date)
    ob_pm  = _sap_pm(db, OB_MACHINES,  from_date, to_date)

    def hours(source: str) -> tuple[float, float]:
        if source == "SAP_BD": return ore_bd, ob_bd
        if source == "SAP_PM": return ore_pm, ob_pm
        return ore_shift.get(source, 0.0), ob_shift.get(source, 0.0)

    raw = [(h["sl_no"], h["label"], *hours(h["source"]), h["loss_type"], h["kam"])
           for h in heads]

    tot_ore_hrs = sum(r[2] for r in raw)
    tot_ob_hrs  = sum(r[3] for r in raw)

    ore_factor = (ore_dev / tot_ore_hrs) if tot_ore_hrs > 0 else 0.0
    ob_factor  = (ob_dev  / tot_ob_hrs)  if tot_ob_hrs  > 0 else 0.0

    grade_qty = _grade_plan(db, from_date, to_date)
    costing   = _weighted_rate(grade_qty)
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
    for (sl, label, oh, bh, lt, kam) in raw:
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
            "ore_machines": [m["name"] for m in ORE_MACHINES],
            "ob_machines":  [m["name"] for m in OB_MACHINES],
        },
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
