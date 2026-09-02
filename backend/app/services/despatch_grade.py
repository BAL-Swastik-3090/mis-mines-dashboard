"""
Grade-wise Despatch — what grade actually left the mine, not what was billed.

zsd_outbound_despatch carries no grade at all: MATDESC is NULL on every mines
despatch row. The grade has to come from pp_quality_inspection, joined on the key
the mine specified — SALESNO = PO_NO — plus BATCH, which both tables also carry
and which matches to the kilogram:

    batch H261300427   despatch  42 trips / 493.52 MT
                       quality   42 lots  / 493.52 MT

In pp_quality_inspection one LOT is one truck-load (~11-12 MT), so the assay is
traceable to the consignment rather than averaged over a month of PO.

BATCH ALONE IS NOT A SAFE KEY. For 2026, 52 batches span more than one PO and 70
carry more than one Cr2O3 value. Joined on (PO_NO, BATCH) together, 247 of 290
groups resolve to a single grade and the rest are tonnage-weighted.

Three tiers, and which tier a tonne landed in is reported:

    Tier 1  PO + BATCH   consignment assay          73.7% of Aug 2026 tonnage
    Tier 2  PO only      PO-level weighted average  16.2%
    Tier 3  no match     "Unassayed" band           10.1%

Tier 3 is never dropped and never folded into a grade band — the table has to
foot to the same total the Despatch section reports. It is mostly assay lag on
late-month despatches and shrinks as SAP catches up.

WHY ASSAY AND NOT THE MATERIAL CODE. What a load was billed as and what it
assayed are different things. August 2026:

    sold as 40-52% CHROME ORE   18,097 MT lots   assays 35.09 - 50.95
    sold as LOW GRADE ORE(-40%)  3,036 MT lots   assays span into the MG band

MG-billed material drops below the 40% LG boundary and LG-billed material reaches
above it. Banding on MATERIAL_DESC would hide that completely, so the bands are
built on the assay and the material code is carried alongside as a reconciliation.

TWO BAND SCHEMES, on purpose. HG/MG/LG keeps this consistent with the LCM and the
IBM rate schedule, but it discriminates poorly here — nothing ever reaches HG and
MG holds ~78% of tonnage. The fine 2% bands exist for the distribution chart,
where that same tonnage resolves into a real shape.

PERFORMANCE. Neither zsd_outbound_despatch.SALESNO nor pp_quality_inspection.PO_NO
is indexed, and a correlated-subquery form of this join timed out at two minutes
during development. The quality side is therefore pre-aggregated once, scoped to
only the POs present in the despatch window, and joined a single time. Both
columns are index candidates worth raising with the DBA.
"""
from __future__ import annotations
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

# Mines despatch. Same classification the Despatch section already uses, so the
# two can never disagree on what a mines despatch is.
MINES_CUSTOMERS = ("BAL", "JABAMOYEE")
CUSTOMER_LABELS = {"BAL": "Balasore Plant", "JABAMOYEE": "Sukinda Plant"}

# Mines despatch is TRANSPORTER = 'SHREE GANESH LOGISTICS' only, matching the
# Despatch section so the two agree on the same page.
#
# CONFIRMED BY THE MINE on 2026-09-03: Ganesh is the despatch haulier; the other
# carriers on this table are not despatch at all. The data says the same thing,
# and the real distinction is product form, not carrier. May-Sep:
#
#   SHREE GANESH LOGISTICS  5,433 rows   0 bagged  avg 11.79 MT  batch on every row
#   ODISHA LOGISTIC            99 rows  95 bagged  avg 24.85 MT  16 with no batch
#   OMM GOODS CARRIER           8 rows   8 bagged  avg 26.25 MT
#   ODISHA LOGOSTIC             1 row    1 bagged  avg 20.00 MT
#
# The bag profile is exact — 25 bags to 25.002 MT, 1.000 MT a bag, so jumbo bags.
# Of 104 bagged loads across 5 POs, NOT ONE has a row in pp_quality_inspection at
# any plant. That material is never assayed and so could never carry a grade.
#
# This filter was briefly removed earlier the same day while plan was added, on
# the theory that the plan covers all despatch and both sides needed matching
# scope. That was wrong: the plan carries MG/LG/COB — bulk ore and concentrate,
# exactly what Ganesh hauls — so plan and actual already agree in scope. The
# widening also pushed August's assay coverage from 100% down to 97.4% by pulling
# in tonnage that can never be assayed.
DESPATCH_TRANSPORTER = "SHREE GANESH LOGISTICS"

# Quality lives in TWO plants and both must be read.
#
# 1200 is the mine — run-of-mine chrome ore, banded HG/MG/LG.
# 1210 is the COB plant — CONCENTRATE WITH STD MOISTURE.
#
# Scoping this to 1200 alone was a real defect: every tonne of COB concentrate
# despatched fell through as "Unassayed", and the page then blamed assay lag for
# it. The match was exact every month — May 157 trips/1,858.1 MT, Jun 157/1,851.3,
# Jul 159/1,864.7, Aug 103/1,207.2 — the whole Unassayed band was concentrate,
# never missing assays. The mine's own user department caught it.
#
# The assays were always there and are good: trips == lots exactly and tonnage
# matching to the kilogram, the same one-lot-per-truck signature as the ore.
QUALITY_PLANTS = ("1200", "1210")
PLANT_MINE     = "1200"
PLANT_COB      = "1210"
CHAR_CR2O3     = "Cr2O3"
CHAR_CRFE      = "Cr/Fe Ratio"

# Headline bands — the HG/MG/LG cut-offs the LCM and the IBM schedule use.
# (key, label, lower inclusive, upper exclusive)
GRADE_BANDS = [
    ("HG", "HG · ≥ 52%",      52.0, 1e9),
    ("MG", "MG · 40 – 52%",   40.0, 52.0),
    ("LG", "LG · < 40%",      -1e9, 40.0),
]

# Distribution bands. Two-point steps through the range the mine actually
# despatches in; the outer two are open-ended so nothing can fall outside.
FINE_BANDS = [
    ("< 38%",     -1e9, 38.0),
    ("38 – 40%",  38.0, 40.0),
    ("40 – 42%",  40.0, 42.0),
    ("42 – 44%",  42.0, 44.0),
    ("44 – 46%",  44.0, 46.0),
    ("46 – 48%",  46.0, 48.0),
    ("48 – 52%",  48.0, 52.0),
    ("≥ 52%",     52.0, 1e9),
]

# COB concentrate is NOT banded with the ore. It is a beneficiated product: at
# roughly 40% Cr2O3 it would land in MG/LG and distort the run-of-mine mix, and
# it is valued on IBM's CONCENTRATES line rather than the fines schedule — the
# same separation the LCM for COB already makes.
COB_KEY   = "COB"
COB_LABEL = "COB Concentrate"

UNASSAYED_KEY   = "UNASSAYED"
UNASSAYED_LABEL = "Unassayed"


# ── Plan (mines_despatch_plan) ───────────────────────────────────────────────
# Verified 2026-09-03. Arithmetic in this table is clean: Tot_* = Bal_* + Suk_*
# for every category, and the six categories sum EXACTLY to Grand_Total_Qty in
# all five months present. The plan total here therefore matches the figure the
# Despatch section already shows from despatch.get_plan_summary.
#
# Only three categories are ever populated. Tot_CrFe_Qty, Tot_HG_Qty and
# Tot_Lump_Qty are zero in every row of the table — 0 non-zero rows out of 153 —
# so MG, LG and COB carry the whole plan. They are still read and still summed,
# because a column that is always zero today is not guaranteed to stay that way
# and the total must keep reconciling if one is ever filled in.
#
# CrFe and Lump have no counterpart among the assay bands, so they cannot be
# compared band-for-band; they are carried in `plan.unmapped` so the plan total
# stays honest instead of quietly losing them.
#
# JUNE 2026 HAS NO PLAN ROWS AT ALL (April, May, July, August, September do).
# That is reported through `plan.has_plan` / `plan.days_with_plan` rather than
# rendered as a plan of zero, which would read as "planned nothing, shipped
# 20,464 MT".
PLAN_BAND_COLUMNS = {
    "HG":  "Tot_HG_Qty",
    "MG":  "Tot_MG_Qty",
    "LG":  "Tot_LG_Qty",
    COB_KEY: "Tot_COB_Qty",
}
PLAN_UNMAPPED_COLUMNS = ("Tot_CrFe_Qty", "Tot_Lump_Qty")


def _plan_rows(db: Session, fd: date, td: date) -> tuple[dict, dict, float, int]:
    """Plan per day and per band.

    Returns (by_day, by_band, unmapped_total, days_with_plan).
    """
    cols = ", ".join(f"COALESCE({c}, 0) AS {c}"
                     for c in list(PLAN_BAND_COLUMNS.values()) + list(PLAN_UNMAPPED_COLUMNS))
    rows = db.execute(text(f"""
        SELECT Plan_date AS dt, {cols},
               COALESCE(Grand_Total_Qty, 0) AS grand
        FROM   mines_despatch_plan
        WHERE  Plan_date BETWEEN :fd AND :td
        ORDER BY Plan_date
    """), {"fd": fd, "td": td}).fetchall()

    by_day: dict[date, dict] = {}
    by_band: dict[str, float] = {k: 0.0 for k in PLAN_BAND_COLUMNS}
    unmapped = 0.0

    for r in rows:
        m = r._mapping
        day = {}
        for band, col in PLAN_BAND_COLUMNS.items():
            v = _f(m[col])
            day[band] = v
            by_band[band] += v
        by_day[r.dt] = day
        unmapped += sum(_f(m[c]) for c in PLAN_UNMAPPED_COLUMNS)

    return by_day, by_band, round(unmapped, 3), len(rows)


def _f(v) -> float:
    return float(v) if v is not None else 0.0


def _band_of(grade: float | None) -> str:
    if grade is None:
        return UNASSAYED_KEY
    for key, _label, lo, hi in GRADE_BANDS:
        if lo <= grade < hi:
            return key
    return UNASSAYED_KEY


def _fine_band_of(grade: float | None) -> str | None:
    if grade is None:
        return None
    for label, lo, hi in FINE_BANDS:
        if lo <= grade < hi:
            return label
    return None


class _Acc:
    """Tonnage-weighted accumulator. Numerator and denominator are summed
    separately and divided once — never an average of per-trip percentages,
    which would let a 5 MT trip count the same as a 25 MT one."""

    __slots__ = ("tonnage", "trips", "cr_num", "cr_den", "fe_num", "fe_den")

    def __init__(self):
        self.tonnage = 0.0
        self.trips = 0
        self.cr_num = self.cr_den = 0.0
        self.fe_num = self.fe_den = 0.0

    def add(self, wt: float, cr: float | None, fe: float | None):
        self.tonnage += wt
        self.trips += 1
        if cr is not None:
            self.cr_num += cr * wt
            self.cr_den += wt
        if fe is not None:
            self.fe_num += fe * wt
            self.fe_den += wt

    @property
    def cr(self):
        return round(self.cr_num / self.cr_den, 3) if self.cr_den else None

    @property
    def fe(self):
        return round(self.fe_num / self.fe_den, 3) if self.fe_den else None


# ── Data access ──────────────────────────────────────────────────────────────
def _despatch_rows(db: Session, fd: date, td: date) -> list:
    """One row per outbound trip in the window.

    Tonnage is NETWEIGHT, matching the Despatch section exactly. It is VARCHAR
    in this table, hence the +0.
    """
    ph = ", ".join(f":c{i}" for i in range(len(MINES_CUSTOMERS)))
    params = {"fd": fd, "td": td, "tr": DESPATCH_TRANSPORTER}
    for i, c in enumerate(MINES_CUSTOMERS):
        params[f"c{i}"] = c
    sql = text(f"""
        SELECT
            DATE(GATEINDATE)                 AS dt,
            SALESNO                          AS po,
            BATCH                            AS batch,
            CUSTOMERNO                       AS customer,
            COALESCE(NETWEIGHT + 0, 0)       AS wt
        FROM zsd_outbound_despatch
        WHERE DATE(GATEINDATE) BETWEEN :fd AND :td
          AND CUSTOMERNO IN ({ph})
          AND TRANSPORTER = :tr
    """)
    return db.execute(sql, params).fetchall()


def _excluded_rows(db: Session, fd: date, td: date) -> dict:
    """Non-despatch movements on this table in the window.

    Bagged material hauled by the other carriers. Reported rather than hidden so
    the number is never a surprise, but it is NOT a pending decision: the mine
    confirmed on 2026-09-03 that only Ganesh is despatch, and none of this
    material is assayed, so it could not be graded even if it were included.
    """
    ph = ", ".join(f":c{i}" for i in range(len(MINES_CUSTOMERS)))
    params = {"fd": fd, "td": td, "tr": DESPATCH_TRANSPORTER}
    for i, c in enumerate(MINES_CUSTOMERS):
        params[f"c{i}"] = c
    rows = db.execute(text(f"""
        SELECT TRANSPORTER AS transporter, COUNT(*) AS trips,
               COALESCE(SUM(NETWEIGHT + 0), 0) AS wt,
               SUM(COALESCE(BAGCOUNT, 0) > 0)  AS bagged
        FROM zsd_outbound_despatch
        WHERE DATE(GATEINDATE) BETWEEN :fd AND :td
          AND CUSTOMERNO IN ({ph})
          AND (TRANSPORTER <> :tr OR TRANSPORTER IS NULL)
        GROUP BY TRANSPORTER
        ORDER BY wt DESC
    """), params).fetchall()
    return {
        "trips":   sum(int(r.trips) for r in rows),
        "tonnage": round(sum(_f(r.wt) for r in rows), 3),
        "bagged_trips": sum(int(r.bagged or 0) for r in rows),
        "transporters": [
            {"transporter": r.transporter, "trips": int(r.trips),
             "tonnage": round(_f(r.wt), 3), "bagged_trips": int(r.bagged or 0)}
            for r in rows
        ],
    }


def _quality(db: Session, pos: list[str]) -> tuple[dict, dict, dict, dict, dict]:
    """Assays for the POs in play, aggregated three ways.

    Scoped by PO rather than by date: an assay can be raised days after the
    truck leaves, so a date window around the despatch period would silently
    drop late lots and inflate the Unassayed row. The PO is the correct scope
    because it is the key the mine gave.

    Reads BOTH plants — mine ore at 1200 and COB concentrate at 1210. Which one
    a PO belongs to is returned separately: verified across Apr-Aug 2026, no PO
    ever carries rows from both, so the plant classifies the PO cleanly.

    Returns (assay by (po,batch), assay by po, material by (po,batch),
    material by po, is-COB by po) — all tonnage-weighted.
    """
    if not pos:
        return {}, {}, {}, {}, {}

    ph = ", ".join(f":p{i}" for i in range(len(pos)))
    params = {f"p{i}": p for i, p in enumerate(pos)}
    plant_ph = ", ".join(f":pl{i}" for i in range(len(QUALITY_PLANTS)))
    for i, pl in enumerate(QUALITY_PLANTS):
        params[f"pl{i}"] = pl
    params.update({"cr": CHAR_CR2O3, "fe": CHAR_CRFE})

    sql = text(f"""
        SELECT
            PO_NO        AS po,
            BATCH        AS batch,
            PLANT        AS plant,
            MATERIAL_NO  AS material_no,
            MATERIAL_DESC AS material_desc,
            SUM(CASE WHEN SHORT_TEXT_INS_CHAR = :cr
                     THEN RESULT * ACTUAL_LOT_QUANTITY END)                    AS cr_num,
            SUM(CASE WHEN SHORT_TEXT_INS_CHAR = :cr AND RESULT IS NOT NULL
                     THEN ACTUAL_LOT_QUANTITY END)                             AS cr_den,
            SUM(CASE WHEN SHORT_TEXT_INS_CHAR = :fe
                     THEN RESULT * ACTUAL_LOT_QUANTITY END)                    AS fe_num,
            SUM(CASE WHEN SHORT_TEXT_INS_CHAR = :fe AND RESULT IS NOT NULL
                     THEN ACTUAL_LOT_QUANTITY END)                             AS fe_den,
            MIN(CASE WHEN SHORT_TEXT_INS_CHAR = :cr THEN RESULT END)           AS cr_min,
            MAX(CASE WHEN SHORT_TEXT_INS_CHAR = :cr THEN RESULT END)           AS cr_max,
            COUNT(DISTINCT LOT_NUMBER)                                         AS lots
        FROM pp_quality_inspection
        WHERE PLANT IN ({plant_ph})
          AND SHORT_TEXT_INS_CHAR IN (:cr, :fe)
          AND PO_NO IN ({ph})
        GROUP BY PO_NO, BATCH, PLANT, MATERIAL_NO, MATERIAL_DESC
    """)
    rows = db.execute(sql, params).fetchall()

    def ratio(n, d):
        return (float(n) / float(d)) if (n is not None and d) else None

    by_batch:  dict = {}
    po_acc:    dict = {}
    mat_acc:   dict = {}
    mat_by_po: dict = {}
    is_cob:    dict = {}

    for r in rows:
        # A PO belongs to whichever plant assayed it. Checked across Apr-Aug
        # 2026: never both, so this cannot flip mid-PO.
        if r.plant == PLANT_COB:
            is_cob[r.po] = True
        else:
            is_cob.setdefault(r.po, False)

        cr = ratio(r.cr_num, r.cr_den)
        fe = ratio(r.fe_num, r.fe_den)
        qty = _f(r.cr_den)

        # A batch can appear under more than one material; weight into one value.
        key = (r.po, r.batch)
        b = by_batch.setdefault(key, {"cr_num": 0.0, "cr_den": 0.0,
                                      "fe_num": 0.0, "fe_den": 0.0})
        b["cr_num"] += _f(r.cr_num); b["cr_den"] += _f(r.cr_den)
        b["fe_num"] += _f(r.fe_num); b["fe_den"] += _f(r.fe_den)

        p = po_acc.setdefault(r.po, {"cr_num": 0.0, "cr_den": 0.0,
                                     "fe_num": 0.0, "fe_den": 0.0})
        p["cr_num"] += _f(r.cr_num); p["cr_den"] += _f(r.cr_den)
        p["fe_num"] += _f(r.fe_num); p["fe_den"] += _f(r.fe_den)

        # Material as billed. Recorded at BOTH grains, because a trip that falls
        # back to a PO-level assay still has a billed material — keying only on
        # (po, batch) left those trips labelled "Not assayed" in the sold-as
        # table while carrying a grade from tier 2, which reads as a
        # contradiction. Where a PO carries more than one material the dominant
        # one by lot quantity wins.
        for key, store in (((r.po, r.batch), mat_acc), (r.po, mat_by_po)):
            m = store.setdefault(key, {"qty": 0.0})
            if qty >= m["qty"]:
                m["qty"] = qty
                m["material_no"] = r.material_no
                m["material_desc"] = (r.material_desc or "").strip()
            lo, hi = r.cr_min, r.cr_max
            if lo is not None:
                m["cr_min"] = min(m.get("cr_min", float(lo)), float(lo))
            if hi is not None:
                m["cr_max"] = max(m.get("cr_max", float(hi)), float(hi))

    def finish(d):
        return {k: {
            "cr": round(v["cr_num"] / v["cr_den"], 4) if v["cr_den"] else None,
            "fe": round(v["fe_num"] / v["fe_den"], 4) if v["fe_den"] else None,
        } for k, v in d.items()}

    return finish(by_batch), finish(po_acc), mat_acc, mat_by_po, is_cob


# ── Main ─────────────────────────────────────────────────────────────────────
def get_grade_wise_despatch(db: Session, from_date: date, to_date: date) -> dict:
    trips = _despatch_rows(db, from_date, to_date)
    pos = sorted({r.po for r in trips if r.po})
    by_batch, by_po, by_material, mat_by_po, po_is_cob = _quality(db, pos)
    plan_by_day, plan_by_band, plan_unmapped, plan_days = _plan_rows(db, from_date, to_date)

    bands:     dict[str, _Acc] = {k: _Acc() for k, *_ in GRADE_BANDS}
    bands[COB_KEY]       = _Acc()
    bands[UNASSAYED_KEY] = _Acc()
    ore = _Acc()   # mine ore only — the basis for the total weighted grade
    fine:      dict[str, _Acc] = {label: _Acc() for label, _lo, _hi in FINE_BANDS}
    customers: dict[str, dict] = {}
    sold_as:   dict[str, dict] = {}
    daily:     dict[date, dict] = {}
    total = _Acc()

    tier1 = tier2 = tier3 = 0.0

    for t in trips:
        wt = _f(t.wt)
        q = by_batch.get((t.po, t.batch))
        tier = 1
        if q is None or q["cr"] is None:
            q = by_po.get(t.po)
            tier = 2
        if q is None or q["cr"] is None:
            q, tier = None, 3

        cr = q["cr"] if q else None
        fe = q["fe"] if q else None

        # COB concentrate is a product, not a grade band. It keeps its own row
        # rather than being banded against a run-of-mine schedule it was never
        # priced on. A concentrate PO with no assay yet still falls to Unassayed.
        is_cob = po_is_cob.get(t.po, False)
        band = COB_KEY if (is_cob and cr is not None) else _band_of(cr)

        if tier == 1:   tier1 += wt
        elif tier == 2: tier2 += wt
        else:           tier3 += wt

        bands[band].add(wt, cr, fe)
        total.add(wt, cr, fe)
        if not is_cob:
            ore.add(wt, cr, fe)

        # The distribution chart is the ORE grade profile. Concentrate assays
        # around 40% and would pile into the middle of it, describing a mix that
        # does not exist.
        fb = _fine_band_of(cr) if not is_cob else None
        if fb:
            fine[fb].add(wt, cr, fe)

        # Per customer
        c = customers.setdefault(t.customer, {"acc": _Acc(), "bands": {}})
        c["acc"].add(wt, cr, fe)
        c["bands"][band] = c["bands"].get(band, 0.0) + wt

        # Per day, for the trend
        d = daily.setdefault(t.dt, {})
        d[band] = d.get(band, 0.0) + wt

        # Sold-as reconciliation. The material code lives on the quality rows,
        # so a trip with no assay has no billed grade either — it is reported
        # under its own heading rather than guessed at.
        mat = by_material.get((t.po, t.batch)) or mat_by_po.get(t.po) or {}
        desc = mat.get("material_desc") or "Not assayed"
        s = sold_as.setdefault(desc, {
            "material_no": mat.get("material_no"),
            "acc": _Acc(), "cr_min": None, "cr_max": None, "bands": {},
        })
        s["acc"].add(wt, cr, fe)
        s["bands"][band] = s["bands"].get(band, 0.0) + wt
        for k, src in (("cr_min", mat.get("cr_min")), ("cr_max", mat.get("cr_max"))):
            if src is None:
                continue
            cur = s[k]
            s[k] = src if cur is None else (min(cur, src) if k == "cr_min" else max(cur, src))

    tot_wt = total.tonnage

    def share(w):
        return round(w / tot_wt * 100, 1) if tot_wt else None

    def achievement(actual: float, plan: float | None):
        """Actual as a percentage of plan.

        None when there is no plan to measure against. A zero plan is NOT 0% or
        infinity — HG is planned at zero yet 762.7 MT shipped in May, and
        reporting that as an achievement figure would be meaningless.
        """
        if plan is None or plan <= 0:
            return None
        return round(actual / plan * 100, 1)

    def plan_of(key: str) -> float | None:
        # Unassayed is an absence of assay, not a product — the plan has no such
        # concept and must not be given one.
        if key == UNASSAYED_KEY or plan_days == 0:
            return None
        return round(plan_by_band.get(key, 0.0), 3)

    band_rows = [{
        "key": key, "label": label,
        "trips": bands[key].trips,
        "tonnage": round(bands[key].tonnage, 3),
        "share_pct": share(bands[key].tonnage),
        "plan_tonnage": plan_of(key),
        "achievement_pct": achievement(bands[key].tonnage, plan_of(key)),
        "cr2o3": bands[key].cr,
        "cr_fe": bands[key].fe,
    } for key, label, _lo, _hi in GRADE_BANDS]

    band_rows.append({
        "key": COB_KEY, "label": COB_LABEL,
        "trips": bands[COB_KEY].trips,
        "tonnage": round(bands[COB_KEY].tonnage, 3),
        "share_pct": share(bands[COB_KEY].tonnage),
        "plan_tonnage": plan_of(COB_KEY),
        "achievement_pct": achievement(bands[COB_KEY].tonnage, plan_of(COB_KEY)),
        "cr2o3": bands[COB_KEY].cr,
        "cr_fe": bands[COB_KEY].fe,
    })

    band_rows.append({
        "key": UNASSAYED_KEY, "label": UNASSAYED_LABEL,
        "trips": bands[UNASSAYED_KEY].trips,
        "tonnage": round(bands[UNASSAYED_KEY].tonnage, 3),
        "share_pct": share(bands[UNASSAYED_KEY].tonnage),
        "plan_tonnage": plan_of(UNASSAYED_KEY),
        "achievement_pct": achievement(bands[UNASSAYED_KEY].tonnage, plan_of(UNASSAYED_KEY)),
        "cr2o3": None, "cr_fe": None,
    })

    # Fine bands describe ore only, so their shares divide by ore assayed tonnage.
    assayed = ore.tonnage - bands[UNASSAYED_KEY].tonnage

    return {
        "from_date": from_date,
        "to_date":   to_date,

        "bands": band_rows,
        "totals": {
            "trips":   total.trips,
            "tonnage": round(tot_wt, 3),
            # MINE ORE ONLY, weighted over assayed tonnage. Tonnage above covers
            # everything despatched, but blending a beneficiated concentrate
            # grade into a run-of-mine average produces a number that describes
            # nothing physical, so concentrate is reported on its own row and
            # excluded here. An unassayed tonne contributes nothing either — it
            # has no grade, and must not drag the average toward zero.
            "cr2o3":   ore.cr,
            "cr_fe":   ore.fe,
            "ore_tonnage": round(ore.tonnage, 3),
            "share_pct": 100.0 if tot_wt else None,
            # Plan total is every category including CrFe/Lump, so it equals
            # SUM(Grand_Total_Qty) and therefore the figure the Despatch section
            # already shows. Verified against despatch.get_plan_summary.
            "plan_tonnage": (round(sum(plan_by_band.values()) + plan_unmapped, 3)
                             if plan_days else None),
            "achievement_pct": achievement(
                tot_wt,
                (sum(plan_by_band.values()) + plan_unmapped) if plan_days else None),
        },

        "fine_bands": [{
            "label": label,
            "tonnage": round(fine[label].tonnage, 3),
            "trips": fine[label].trips,
            # Share of ASSAYED tonnage, not of the total: this is a distribution
            # of the grades that are known, and including the unassayed slice
            # would make the bars sum to less than 100 for no useful reason.
            "share_pct": round(fine[label].tonnage / assayed * 100, 1) if assayed else None,
        } for label, _lo, _hi in FINE_BANDS],

        "sold_as": sorted([{
            "material_no":   v["material_no"],
            "material_desc": desc,
            "trips":         v["acc"].trips,
            "tonnage":       round(v["acc"].tonnage, 3),
            "cr2o3":         v["acc"].cr,
            "cr_min":        round(v["cr_min"], 3) if v["cr_min"] is not None else None,
            "cr_max":        round(v["cr_max"], 3) if v["cr_max"] is not None else None,
            "bands":         {k: round(w, 3) for k, w in v["bands"].items()},
        } for desc, v in sold_as.items()], key=lambda x: -x["tonnage"]),

        "customers": sorted([{
            "code":    code,
            "name":    CUSTOMER_LABELS.get(code, code),
            "trips":   v["acc"].trips,
            "tonnage": round(v["acc"].tonnage, 3),
            "cr2o3":   v["acc"].cr,
            "bands":   {k: round(w, 3) for k, w in v["bands"].items()},
        } for code, v in customers.items()], key=lambda x: -x["tonnage"]),

        # A day appears if it had despatch OR carried a plan. A planned day with
        # nothing despatched is the most informative bar on the chart — it used
        # to be invisible because only despatch days were emitted.
        "daily": [{
            "date": day,
            **{k: round(daily.get(day, {}).get(k, 0.0), 3)
               for k in [b[0] for b in GRADE_BANDS] + [COB_KEY, UNASSAYED_KEY]},
            **{f"plan_{k}": round(plan_by_day.get(day, {}).get(k, 0.0), 3)
               for k in PLAN_BAND_COLUMNS},
        } for day in sorted(
            set(daily) | {d for d, v in plan_by_day.items() if sum(v.values()) > 0}
        )],


        "coverage": {
            "tier1_tonnage": round(tier1, 3),
            "tier2_tonnage": round(tier2, 3),
            "unassayed_tonnage": round(tier3, 3),
            "cob_tonnage": round(bands[COB_KEY].tonnage, 3),
            "assayed_pct": round((tier1 + tier2) / tot_wt * 100, 1) if tot_wt else None,
            "po_count": len(pos),
        },

        "excluded": _excluded_rows(db, from_date, to_date),

        "plan": {
            # False for June 2026, which has no rows in mines_despatch_plan.
            "has_plan":        plan_days > 0,
            "days_with_plan":  plan_days,
            "days_in_range":   (to_date - from_date).days + 1,
            "by_band":         {k: round(v, 3) for k, v in plan_by_band.items()},
            # CrFe and Lump: no assay band to compare against. Always zero so far,
            # carried so the plan total cannot silently lose them.
            "unmapped_tonnage": plan_unmapped,
        },
    }
