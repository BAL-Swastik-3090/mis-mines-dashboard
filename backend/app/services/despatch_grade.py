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

# The Despatch section scopes its actuals to this one transporter, and this
# section matches it so the two totals agree on the same page.
#
# BE AWARE THAT THIS DROPS REAL TONNAGE. It is an exact-match filter, so it also
# excludes ODISHA LOGISTIC (17 trips / 420 MT in Aug 2026, 34 / 845 in Jun),
# OMM GOODS CARRIER, and two obvious typo variants — 'SHREE GANESH LOGISTIC'
# without the S, and 'ODISHA LOGOSTIC'. That is 2.6% of August's mines despatch
# and 5.2% of June's. Those loads run at a flat 25.003 MT against Ganesh's usual
# 11-12, on their own PO series and their own batch numbering, so they look like
# a separate haulage arrangement rather than bad data.
#
# Widening it is a decision for the mine, not for this module, because it would
# move the headline Despatch figures too. Matching is the conservative choice;
# the exclusion is surfaced in the payload as `excluded` rather than hidden.
DESPATCH_TRANSPORTER = "SHREE GANESH LOGISTICS"

QUALITY_PLANT = "1200"
CHAR_CR2O3    = "Cr2O3"
CHAR_CRFE     = "Cr/Fe Ratio"

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

UNASSAYED_KEY   = "UNASSAYED"
UNASSAYED_LABEL = "Unassayed"


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
    """Mines despatch in the window that the transporter filter drops.

    Reported, not hidden. If this number is ever material the mine needs to
    know, and if the filter is one day widened this is the figure that moves.
    """
    ph = ", ".join(f":c{i}" for i in range(len(MINES_CUSTOMERS)))
    params = {"fd": fd, "td": td, "tr": DESPATCH_TRANSPORTER}
    for i, c in enumerate(MINES_CUSTOMERS):
        params[f"c{i}"] = c
    rows = db.execute(text(f"""
        SELECT TRANSPORTER AS transporter, COUNT(*) AS trips,
               COALESCE(SUM(NETWEIGHT + 0), 0) AS wt
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
        "transporters": [
            {"transporter": r.transporter, "trips": int(r.trips), "tonnage": round(_f(r.wt), 3)}
            for r in rows
        ],
    }


def _quality(db: Session, pos: list[str]) -> tuple[dict, dict, dict, dict]:
    """Assays for the POs in play, aggregated three ways.

    Scoped by PO rather than by date: an assay can be raised days after the
    truck leaves, so a date window around the despatch period would silently
    drop late lots and inflate the Unassayed row. The PO is the correct scope
    because it is the key the mine gave.

    Returns (assay by (po,batch), assay by po, material by (po,batch),
    material by po) — all tonnage-weighted.
    """
    if not pos:
        return {}, {}, {}, {}

    ph = ", ".join(f":p{i}" for i in range(len(pos)))
    params = {f"p{i}": p for i, p in enumerate(pos)}
    params.update({"plant": QUALITY_PLANT, "cr": CHAR_CR2O3, "fe": CHAR_CRFE})

    sql = text(f"""
        SELECT
            PO_NO        AS po,
            BATCH        AS batch,
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
        WHERE PLANT = :plant
          AND SHORT_TEXT_INS_CHAR IN (:cr, :fe)
          AND PO_NO IN ({ph})
        GROUP BY PO_NO, BATCH, MATERIAL_NO, MATERIAL_DESC
    """)
    rows = db.execute(sql, params).fetchall()

    def ratio(n, d):
        return (float(n) / float(d)) if (n is not None and d) else None

    by_batch:  dict = {}
    po_acc:    dict = {}
    mat_acc:   dict = {}
    mat_by_po: dict = {}

    for r in rows:
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

    return finish(by_batch), finish(po_acc), mat_acc, mat_by_po


# ── Main ─────────────────────────────────────────────────────────────────────
def get_grade_wise_despatch(db: Session, from_date: date, to_date: date) -> dict:
    trips = _despatch_rows(db, from_date, to_date)
    pos = sorted({r.po for r in trips if r.po})
    by_batch, by_po, by_material, mat_by_po = _quality(db, pos)

    bands:     dict[str, _Acc] = {k: _Acc() for k, *_ in GRADE_BANDS}
    bands[UNASSAYED_KEY] = _Acc()
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
        band = _band_of(cr)

        if tier == 1:   tier1 += wt
        elif tier == 2: tier2 += wt
        else:           tier3 += wt

        bands[band].add(wt, cr, fe)
        total.add(wt, cr, fe)

        fb = _fine_band_of(cr)
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

    band_rows = [{
        "key": key, "label": label,
        "trips": bands[key].trips,
        "tonnage": round(bands[key].tonnage, 3),
        "share_pct": share(bands[key].tonnage),
        "cr2o3": bands[key].cr,
        "cr_fe": bands[key].fe,
    } for key, label, _lo, _hi in GRADE_BANDS]

    band_rows.append({
        "key": UNASSAYED_KEY, "label": UNASSAYED_LABEL,
        "trips": bands[UNASSAYED_KEY].trips,
        "tonnage": round(bands[UNASSAYED_KEY].tonnage, 3),
        "share_pct": share(bands[UNASSAYED_KEY].tonnage),
        "cr2o3": None, "cr_fe": None,
    })

    assayed = tot_wt - bands[UNASSAYED_KEY].tonnage

    return {
        "from_date": from_date,
        "to_date":   to_date,

        "bands": band_rows,
        "totals": {
            "trips":   total.trips,
            "tonnage": round(tot_wt, 3),
            # Weighted over ASSAYED tonnage only — an unassayed tonne has no
            # grade to contribute and must not drag the average toward zero.
            "cr2o3":   total.cr,
            "cr_fe":   total.fe,
            "share_pct": 100.0 if tot_wt else None,
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

        "daily": [{
            "date": day,
            **{k: round(daily[day].get(k, 0.0), 3)
               for k in [b[0] for b in GRADE_BANDS] + [UNASSAYED_KEY]},
        } for day in sorted(daily)],

        "excluded": _excluded_rows(db, from_date, to_date),

        "coverage": {
            "tier1_tonnage": round(tier1, 3),
            "tier2_tonnage": round(tier2, 3),
            "unassayed_tonnage": round(tier3, 3),
            "assayed_pct": round((tier1 + tier2) / tot_wt * 100, 1) if tot_wt else None,
            "po_count": len(pos),
        },
    }
