"""
Stock service — reads current ore + COB inventory from mm_mb52_inventory_new.
No date filtering: table is a live SAP snapshot (no date column).

Sources:
  PLANT='1200', MATERIAL_TYPE='ZORE'           → Ore grades (HG/MG/LG/LUMP)
  PLANT='1210', STORE_LOC='CST1', CONCENTRATE  → COB production stock
"""
from sqlalchemy.orm import Session
from sqlalchemy import text


# ── Grade classification ──────────────────────────────────────────
# material_desc → (grade_key, grade_label, sort_order)
GRADE_MAP: dict[str, tuple[str, str, int]] = {
    "+52% CHROME ORE":               ("HG",     "High Grade >52%",     1),
    "40-52% CHROME ORE":             ("MG",     "Medium Grade 40–52%", 2),
    "40-52% CHROME ORE-BPM EAST":    ("MG",     "Medium Grade 40–52%", 2),  # merged into MG
    "LOW GRADE ORE(-40%CR2O3)":      ("LG",     "Low Grade <40%",      3),
    "LUMP -100MM +40% CR2O3":        ("LUMP_H", "Lump >40% Cr₂O₃",    4),
    "LUMP -100MM -40% CR2O3":        ("LUMP_L", "Lump <40% Cr₂O₃",    5),
    "CONCENTRATE WITH STD MOISTURE": ("COB",    "COB Concentrate",     6),  # CST1
}

# ── Human-readable location names (overrides SAP STORE_LOC_DESC) ──
LOCATION_NAMES: dict[str, str] = {
    "RYRD": "Remaining Stock after Despatch",
    "DY01": "Despatch Stock",
    "ROM1": "ROM Stock",
    "LGCR": "Low Grade ROM Stock",
    "CST1": "COB Production Stock",
}

# Fixed display order for locations in table
LOCATION_ORDER = ["RYRD", "DY01", "ROM1", "LGCR", "CST1"]


def _friendly(sloc: str, fallback: str) -> str:
    """Return human-readable location name, falling back to SAP desc."""
    return LOCATION_NAMES.get(sloc, fallback)


def get_stock_position(db: Session) -> dict:
    # ── Query 1: Ore stock (PLANT=1200) ──────────────────────────
    sql_ore = text("""
        SELECT
            MATERIAL_DESC,
            STORE_LOC,
            COALESCE(STORE_LOC_DESC, STORE_LOC) AS raw_desc,
            ROUND(SUM(UNRESTRICTED_STOCK), 2)   AS stock,
            ROUND(SUM(UNRESTRICTED_VALUE), 2)   AS value
        FROM mm_mb52_inventory_new
        WHERE PLANT = '1200'
          AND MATERIAL_TYPE = 'ZORE'
        GROUP BY MATERIAL_DESC, STORE_LOC, STORE_LOC_DESC
        ORDER BY MATERIAL_DESC, STORE_LOC
    """)

    # ── Query 2: COB concentrate stock (PLANT=1210, CST1 only) ───
    sql_cob = text("""
        SELECT
            MATERIAL_DESC,
            STORE_LOC,
            'COB Production Stock'              AS raw_desc,
            ROUND(SUM(UNRESTRICTED_STOCK), 2)   AS stock,
            ROUND(SUM(UNRESTRICTED_VALUE), 2)   AS value
        FROM mm_mb52_inventory_new
        WHERE PLANT = '1210'
          AND STORE_LOC = 'CST1'
          AND MATERIAL_DESC = 'CONCENTRATE WITH STD MOISTURE'
        GROUP BY MATERIAL_DESC, STORE_LOC
    """)

    all_rows = list(db.execute(sql_ore).fetchall()) + \
               list(db.execute(sql_cob).fetchall())

    grade_agg: dict[str, dict] = {}
    loc_agg:   dict[str, dict] = {}

    for r in all_rows:
        mat  = (r.MATERIAL_DESC or "").strip()
        info = GRADE_MAP.get(mat)
        if not info:
            continue

        gk, glabel, gorder = info
        stock = float(r.stock or 0)
        value = float(r.value or 0)
        sloc  = r.STORE_LOC
        sdesc = _friendly(sloc, (r.raw_desc or sloc).strip())

        # ── Grade aggregation ─────────────────────────────────────
        if gk not in grade_agg:
            grade_agg[gk] = {
                "grade_key":   gk,
                "grade_label": glabel,
                "order":       gorder,
                "total_stock": 0.0,
                "total_value": 0.0,
                "locations":   {},
            }
        ga = grade_agg[gk]
        ga["total_stock"] += stock
        ga["total_value"] += value

        if sloc not in ga["locations"]:
            ga["locations"][sloc] = {
                "store_loc":      sloc,
                "store_loc_desc": sdesc,
                "stock":          0.0,
                "value":          0.0,
            }
        ga["locations"][sloc]["stock"] += stock
        ga["locations"][sloc]["value"] += value

        # ── Location aggregation ──────────────────────────────────
        if sloc not in loc_agg:
            loc_agg[sloc] = {
                "store_loc":      sloc,
                "store_loc_desc": sdesc,
                "stock":          0.0,
                "value":          0.0,
            }
        loc_agg[sloc]["stock"] += stock
        loc_agg[sloc]["value"] += value

    # ── Build grade items (sorted by order) ──────────────────────
    items = []
    for ga in sorted(grade_agg.values(), key=lambda x: x["order"]):
        # Sort locations by the fixed LOCATION_ORDER
        locs = sorted(
            [
                {
                    "store_loc":      k,
                    "store_loc_desc": v["store_loc_desc"],
                    "stock":          round(v["stock"], 2),
                    "value":          round(v["value"], 2),
                }
                for k, v in ga["locations"].items()
            ],
            key=lambda x: LOCATION_ORDER.index(x["store_loc"])
                          if x["store_loc"] in LOCATION_ORDER else 99,
        )
        items.append({
            "grade_key":   ga["grade_key"],
            "grade_label": ga["grade_label"],
            "total_stock": round(ga["total_stock"], 2),
            "total_value": round(ga["total_value"], 2),
            "locations":   locs,
        })

    grand_total = round(sum(g["total_stock"] for g in grade_agg.values()), 2)

    # ── Location totals in fixed display order ────────────────────
    by_location = [
        {
            "store_loc":      sloc,
            "store_loc_desc": loc_agg[sloc]["store_loc_desc"],
            "stock":          round(loc_agg[sloc]["stock"], 2),
            "value":          round(loc_agg[sloc]["value"], 2),
        }
        for sloc in LOCATION_ORDER
        if sloc in loc_agg
    ]

    # ── All Locations totals (Mines + BAL Plant + SUK Plant) ─────
    sql_plants = text("""
        SELECT
            PLANT,
            ROUND(SUM(UNRESTRICTED_STOCK), 2) AS total
        FROM mm_mb52_inventory_new
        WHERE PLANT IN ('1100', '1110')
          AND MATERIAL_TYPE = 'ZORE'
        GROUP BY PLANT
    """)
    plant_rows = db.execute(sql_plants).fetchall()
    plant_map  = {r.PLANT: float(r.total or 0) for r in plant_rows}

    bal_stock = plant_map.get("1100", 0.0)
    suk_stock = plant_map.get("1110", 0.0)
    # Mines = grand_total already computed (PLANT=1200 ore + COB at CST1)
    all_grand  = round(grand_total + bal_stock + suk_stock, 2)

    return {
        "items":       items,
        "grand_total": grand_total,
        "by_location": by_location,
        "all_locations": {
            "mines_total": grand_total,
            "bal_plant":   round(bal_stock, 2),
            "suk_plant":   round(suk_stock, 2),
            "grand_total": all_grand,
        },
    }
