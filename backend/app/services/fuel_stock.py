"""What diesel is standing at each plant, how long it lasts, and what is coming.

── WHY THIS READS SAP AND WRITES NOTHING ───────────────────────────────────
Stock is entered in SAP. Every receipt is booked against a purchase order and
every issue against a cost centre, and the mine has no reason to key the same
delivery twice -- two systems owning one delivery is two systems that will
disagree about it within a month.

── WHAT CHANGED ON 14 NOVEMBER 2026, AND WHY ───────────────────────────────
Measured against SAP the same day, the first version of this screen was wrong
in four ways, all of them about WHICH SAP figure it read:

1. BURN WAS POSTINGS, NOT CONSUMPTION. It took MB5B's "issued" column, which
   counts every litre that left a plant's books -- including diesel SENT TO
   ANOTHER PLANT. Sukinda moved 296,200 L to the mine in ninety days by stock
   transfer, and the screen read that as Sukinda burning 6,656 L a day. It
   consumed 204. Its red "1.6 days" was a false alarm; it held about fifty.

   Consumption is now the sum of the movements `fuel_movement_class` calls
   CONSUMPTION -- issue to a cost centre (one per machine at the mine), to an
   order, to a transporter -- netted against their returns. Transfers and
   stock-take write-offs are shown, but they are not burn.

2. STOCK WAS A DAY OLD. MB5B lags; MB52 (`scm_stock_mb52`) carries today. On
   the 14th the mine read 1,636 L on screen and 39 L in SAP that morning.

3. "SAP CARRIES NO SAFETY STOCK" WAS TRUE OF ONE PLANT. Sukinda has a minimum
   of 3,954 L, a reorder point of 4,219 and a maximum of 54,219; Balasore
   12,000 / 19,000 / 22,000. Only the mine has none. They come from MB52 now,
   per plant, and the screen says which plants have them.

4. THE PROJECTION LANDED CONTRACTS IN A TANK. A whole supply-agreement line
   was added on its due date -- 3,28,452 L on 20 November -- into a tank that
   holds a fraction of that. The mine is actually fed by STO from Sukinda in
   18,000 L tankers every four or five days. The forward line now follows that
   rhythm, measured from the receipts SAP holds, and stops at the tank's
   capacity.

And one thing the mine's own workbook does that this did not: a tank's last
2,000 L cannot be lifted by the pump. Days of cover are worked out from the
stock above `fuel_plant_setting.dead_stock_l`, not the whole tank.

── WHERE EACH FIGURE COMES FROM ────────────────────────────────────────────
  in the tank today       sap_odata_api.scm_stock_mb52       (MB52, current)
  held, not usable        scm_stock_mb5b_sb minus MB52       (quality/suspense)
  min, reorder, maximum   scm_stock_mb52                     (SAP's own levels)
  consumed, received,
  transferred, written off  sap_odata_api.mm_inventory_new   (by movement class)
  stock on past days      fuel_stock_snapshot                (MB5B mirror, history)
  on order                fuel_purchase_line                 (PO mirror)
  plants, names, order,
  dead stock, capacity    plant + fuel_plant_setting
  which material is fuel  fuel_material.counts_as_fuel
"""
from __future__ import annotations

import threading
import time
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

# SAP's own material group for fuels. Used only to NOTICE a material nobody
# has classified yet -- what counts as fuel is fuel_material, not this.
FUEL_GROUP = "1046"

# How far back consumption is averaged. Long enough to absorb SAP posting in
# batches, short enough to follow a change in how hard the mine is working.
BURN_DAYS = 30

# How far back the supply rhythm is read. Longer than the burn window: at one
# tanker every four or five days, thirty days is six arrivals, which is a thin
# basis for an average.
RHYTHM_DAYS = 60

# How far forward the projection runs before it stops being a forecast.
PROJECT_DAYS = 45

# An order this far past its date is not late, it is abandoned -- paperwork to
# close rather than fuel to expect.
STALE_AFTER_DAYS = 90

# How long one assembled reading of mm_inventory_new is reused. The page asks
# four questions at once and each would otherwise scan 1.5 M rows; a minute is
# far shorter than SAP's own posting cycle.
_CACHE_SECONDS = 60
_cache: dict[tuple, tuple[float, object]] = {}


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _r(v: float, n: int = 2) -> float:
    """Round, and never show "-0": a transfer of nothing is not negative."""
    return round(v, n) + 0.0


def _cached(key: tuple, build):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_SECONDS:
        return hit[1]
    value = build()
    _cache[key] = (time.monotonic(), value)
    if len(_cache) > 64:
        _cache.pop(next(iter(_cache)))
    return value


# ═══════════════════════════════════════════════════════════════════════════
# The masters: which plants, which materials, what a movement means
# ═══════════════════════════════════════════════════════════════════════════
def _masters(pg: Session) -> dict:
    """Plants, materials and the MB52 date in ONE round trip, reused a minute.

    The database is across the network: every query costs ~95 ms before it
    does any work, so three tiny lookups were a third of a second of waiting.
    """
    def build():
        row = pg.execute(text("""
            SELECT
              (SELECT COALESCE(json_agg(x ORDER BY x.display_order, x.plant), '[]')
                 FROM (SELECT p.code AS plant, p.name, s.display_order,
                              s.dead_stock_l, s.tank_capacity_l
                         FROM fuel_plant_setting s JOIN plant p USING (plant_id)
                        WHERE s.is_shown) x)                         AS plants,
              (SELECT COALESCE(json_agg(m), '[]')
                 FROM (SELECT LTRIM(sap_material, '0') AS sap, code, label,
                              counts_as_fuel
                         FROM fuel_material
                        WHERE sap_material IS NOT NULL AND is_active) m) AS mats,
              (SELECT MAX(snapshot_date) FROM sap_odata_api.scm_stock_mb52) AS snap,
              (SELECT MAX(report_date) FROM fuel_stock_snapshot)            AS mb5b
        """)).mappings().one()
        return {
            "plants": list(row["plants"]),
            "mats": {m["sap"]: {"code": m["code"], "label": m["label"],
                                "counts_as_fuel": m["counts_as_fuel"]}
                     for m in row["mats"]},
            "snap": row["snap"], "mb5b": row["mb5b"],
        }
    return _cached(("masters",), build)


def _plants(pg: Session) -> list[dict]:
    """The plants on the fuel screens, in their display order, named once.

    Names come from the plant master so a plant cannot be called one thing on
    this tab and another on the next -- which it was.
    """
    return _masters(pg)["plants"]


def _materials(pg: Session) -> dict[str, dict]:
    """SAP material number -> how this platform treats it."""
    return _masters(pg)["mats"]


def _movement_rows(pg: Session, codes: list[str], fuel: list[str],
                   since: date, until: date) -> list[dict]:
    """Fuel movements per plant, per day, per class -- one scan, reused."""
    def build():
        return [dict(r) for r in pg.execute(text("""
            SELECT i.plant, i.posting_date AS day,
                   COALESCE(c.class, 'UNCLASSIFIED') AS class,
                   SUM(i.post_quantity) AS qty,
                   SUM(CASE WHEN i.post_quantity < 0 THEN i.post_quantity END) AS qty_out,
                   SUM(CASE WHEN i.post_quantity > 0 THEN i.post_quantity END) AS qty_in,
                   COUNT(*) AS docs
              FROM sap_odata_api.mm_inventory_new i
              LEFT JOIN fuel_movement_class c ON c.movement_type = i.movement_type
             WHERE i.plant = ANY(:plants)
               AND LTRIM(i.material_no, '0') = ANY(:fuel)
               AND i.posting_date > :since AND i.posting_date <= :until
             GROUP BY 1, 2, 3
        """), {"plants": codes, "fuel": fuel, "since": since,
               "until": until}).mappings()]
    return _cached(("mv", tuple(codes), tuple(fuel), since, until), build)


def _window_moves(pg: Session, since: date, until: date) -> list[dict]:
    """Movements for a window, read from the stock panel's sixty-day reading
    when it covers the window -- so the calendar and the day-by-day table do
    not scan mm_inventory_new again for a subset of what is already in hand."""
    codes = [p["plant"] for p in _plants(pg)]
    fuel = [m for m, v in _materials(pg).items() if v["counts_as_fuel"]]
    snap = _mb52_date(pg)
    if snap and until == snap and since >= snap - timedelta(days=RHYTHM_DAYS):
        rows = _movement_rows(pg, codes, fuel, snap - timedelta(days=RHYTHM_DAYS), snap)
        return [r for r in rows if r["day"] > since]
    return _movement_rows(pg, codes, fuel, since, until)


def _receipt_docs(pg: Session, codes: list[str], fuel: list[str],
                  since: date, until: date) -> list[dict]:
    """Every goods receipt of fuel, document by document.

    The arrival detail and the supply rhythm both need the documents rather
    than a daily sum: which tanker, against which order, challan against what
    was accepted, and when it came through the gate.
    """
    def build():
        return [dict(r) for r in pg.execute(text("""
            SELECT i.plant, i.posting_date AS day, i.movement_type,
                   i.post_quantity AS qty, i.challan_qty, i.grqan,
                   i.in_date, i.in_time, i.po_no, i.vendor_name,
                   i.doc_headr_text AS header, i.reference,
                   i.material_no, i.material_desc, i.post_amount
              FROM sap_odata_api.mm_inventory_new i
              JOIN fuel_movement_class c
                ON c.movement_type = i.movement_type AND c.class = 'RECEIPT'
             WHERE i.plant = ANY(:plants)
               AND LTRIM(i.material_no, '0') = ANY(:fuel)
               AND i.posting_date > :since AND i.posting_date <= :until
             ORDER BY i.posting_date, i.in_time
        """), {"plants": codes, "fuel": fuel, "since": since,
               "until": until}).mappings()]
    return _cached(("rc", tuple(codes), tuple(fuel), since, until), build)


def _mb52_date(pg: Session) -> date | None:
    return _masters(pg)["snap"]


# ═══════════════════════════════════════════════════════════════════════════
# The supply rhythm
# ═══════════════════════════════════════════════════════════════════════════
def _rhythm(docs: list[dict], plant: str, today: date) -> dict:
    """How this plant is actually supplied, read from the receipts.

    An ARRIVAL is a day something was received, not a document: an 18,000 L
    tanker and a 1,500 L top-up on the same day are one delivery to the tank.
    """
    by_day: dict[date, float] = {}
    challan = gr = 0.0
    for d in docs:
        if d["plant"] != plant:
            continue
        q = _f(d["qty"])
        by_day[d["day"]] = by_day.get(d["day"], 0.0) + q
        if _f(d["challan_qty"]) > 0 and q > 0:
            challan += _f(d["challan_qty"])
            gr += q
    days = sorted(k for k, v in by_day.items() if v > 0)
    if not days:
        return {"arrivals": 0, "avg_arrival_l": None, "every_days": None,
                "last_arrival": None, "next_expected": None, "yield": None}
    gaps = [(b - a).days for a, b in zip(days, days[1:])]
    every = round(sum(gaps) / len(gaps), 1) if gaps else None
    last = days[-1]
    nxt = None
    if every:
        nxt = last + timedelta(days=max(1, round(every)))
        if nxt <= today:
            # Due by the rhythm and not here yet. It is not assumed to have
            # come; it is expected tomorrow at the earliest.
            nxt = today + timedelta(days=1)
    return {
        "arrivals": len(days),
        "avg_arrival_l": round(sum(by_day[d] for d in days) / len(days), 0),
        "every_days": every,
        "last_arrival": last.isoformat(),
        "next_expected": nxt.isoformat() if nxt else None,
        # What was accepted against what the challan said. 1.0 means every
        # tanker arrived as billed -- which it has, at the mine, on every
        # receipt in the window.
        "yield": round(gr / challan, 4) if challan else None,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Stock — the main panel
# ═══════════════════════════════════════════════════════════════════════════
def fuel_stock(pg: Session, as_on: date | None = None) -> dict:
    """Fuel at every plant: what is there, how long it lasts, what is coming.

    Assembled once a minute. The projection, the calendar and the calculator
    all start from it, and each used to assemble it again.
    """
    key = ("stock", as_on)
    hit = _cache.get(key)
    if hit and as_on is None and _CACHE_SECONDS <= time.monotonic() - hit[0] < _STALE_SERVE_SECONDS:
        # A minute old: answer with it now and refresh behind the request, so
        # nobody waits the ~2 s it takes to read SAP across the network.
        _refresh_behind(key)
        return hit[1]
    return _cached(key, lambda: _fuel_stock(pg, as_on))


_STALE_SERVE_SECONDS = 15 * 60
_refreshing: set[tuple] = set()
_refresh_lock = threading.Lock()


def _refresh_behind(key: tuple) -> None:
    with _refresh_lock:
        if key in _refreshing:
            return
        _refreshing.add(key)

    def run():
        from app.minehub_db import SessionLocal
        s = SessionLocal()
        try:
            for k in [k for k in _cache if k[0] in ("masters", "mv", "rc")]:
                _cache.pop(k, None)
            _cache[key] = (time.monotonic(), _fuel_stock(s, key[1]))
        except Exception:                               # noqa: BLE001
            pass                                        # the stale answer stands
        finally:
            s.close()
            with _refresh_lock:
                _refreshing.discard(key)
    threading.Thread(target=run, daemon=True, name="fuel-stock-refresh").start()


def _fuel_stock(pg: Session, as_on: date | None) -> dict:
    plants = _plants(pg)
    mats = _materials(pg)
    codes = [p["plant"] for p in plants]
    fuel = [m for m, v in mats.items() if v["counts_as_fuel"]]
    every_mat = list(mats.keys())

    snap = _mb52_date(pg)
    if not snap or not plants:
        return {"as_on": None, "plants": [], "inbound": [], "stale_days": None}
    if as_on and as_on < snap:
        snap = as_on

    # ── today's stock, by plant and material, from MB52 ─────────────────
    mb52 = pg.execute(text("""
        SELECT plant, LTRIM(materialno, '0') AS material,
               MAX(materialdesc)          AS description,
               SUM(unrestrictedstock)     AS usable,
               SUM(unrestrictedvalue)     AS value,
               MAX(uom)                   AS unit,
               COUNT(DISTINCT storeloc)   AS locations
          FROM sap_odata_api.scm_stock_mb52
         WHERE snapshot_date = :snap
           AND plant = ANY(:plants)
           AND LTRIM(materialno, '0') = ANY(:mats)
         GROUP BY 1, 2
    """), {"snap": snap, "plants": codes, "mats": every_mat}).mappings().all()

    # SAP's own levels. MB52 drops a row whose usable stock is zero, so the
    # levels are read from the latest snapshot that still carried the row --
    # a tank that ran dry yesterday has not lost its reorder point.
    levels = {(r["plant"], r["material"]): r for r in pg.execute(text("""
        SELECT DISTINCT ON (plant, LTRIM(materialno, '0'))
               plant, LTRIM(materialno, '0') AS material,
               minstock, reorderpoint, maxstock
          FROM sap_odata_api.scm_stock_mb52
         WHERE snapshot_date > :snap - 30 AND snapshot_date <= :snap
           AND plant = ANY(:plants)
           AND LTRIM(materialno, '0') = ANY(:fuel)
           -- Levels are held per storage location and repeated on each, so
           -- the largest is the plant's -- a SUM would double them.
         ORDER BY plant, LTRIM(materialno, '0'), snapshot_date DESC,
                  maxstock DESC NULLS LAST
    """), {"snap": snap, "plants": codes, "fuel": fuel}).mappings()}

    # Stock that is in the books but not usable: quality, suspense, blocked.
    # MB5B by storage location counts it; MB52 counts only unrestricted. The
    # difference, on the same day, is what is held.
    held = {r["plant"]: _f(r["held"]) for r in pg.execute(text("""
        SELECT b.plant, GREATEST(SUM(b.closingstock) - COALESCE(MAX(u.usable), 0), 0) AS held
          FROM sap_odata_api.scm_stock_mb5b_sb b
          LEFT JOIN (
                SELECT plant, SUM(unrestrictedstock) AS usable
                  FROM sap_odata_api.scm_stock_mb52
                 WHERE snapshot_date = :snap AND LTRIM(materialno, '0') = ANY(:fuel)
                 GROUP BY plant) u USING (plant)
         WHERE b.tdate = :snap AND b.plant = ANY(:plants)
           AND LTRIM(b.material, '0') = ANY(:fuel)
         GROUP BY b.plant
    """), {"snap": snap, "plants": codes, "fuel": fuel}).mappings()}

    # A material in SAP's fuel group that nobody has said is fuel or not.
    # Left out of every figure until classified, and SAID, so a new diesel
    # code cannot quietly drop out of the burn.
    unclassified = [dict(r) for r in pg.execute(text("""
        SELECT DISTINCT plant, LTRIM(materialno, '0') AS material,
               MAX(materialdesc) AS description
          FROM sap_odata_api.scm_stock_mb52
         WHERE snapshot_date = :snap AND plant = ANY(:plants)
           AND materialgroup = :grp
           AND NOT (LTRIM(materialno, '0') = ANY(:mats))
         GROUP BY 1, 2
    """), {"snap": snap, "plants": codes, "grp": FUEL_GROUP,
           "mats": every_mat}).mappings()]

    # ── what moved, by class ────────────────────────────────────────────
    moves = _movement_rows(pg, codes, fuel, snap - timedelta(days=RHYTHM_DAYS), snap)
    win_start = snap - timedelta(days=BURN_DAYS)

    def window_sum(plant: str, cls: str, part: str = "qty") -> float:
        return sum(_f(m[part]) for m in moves
                   if m["plant"] == plant and m["class"] == cls
                   and m["day"] > win_start)

    docs = _receipt_docs(pg, codes, fuel, snap - timedelta(days=RHYTHM_DAYS), snap)

    # ── what is still owed ──────────────────────────────────────────────
    inbound: list[dict] = []
    for r in pg.execute(text("""
        SELECT po, plant, vendor, material, pending_l AS pending, unit,
               due_on AS due
          FROM fuel_purchase_line
         WHERE pending_l > 0
         ORDER BY due_on NULLS LAST
    """)).mappings():
        due = r["due"]
        inbound.append({
            "po": str(r["po"]).strip(), "plant": r["plant"],
            "vendor": (r["vendor"] or "").strip() or None,
            "material": r["material"], "pending_l": _f(r["pending"]),
            "unit": r["unit"], "due_on": due.isoformat() if due else None,
            "days_late": (snap - due).days if due and due < snap else None,
            "overdue": bool(due and due < snap),
            "stale": bool(due and (snap - due).days > STALE_AFTER_DAYS),
        })

    out_plants: list[dict] = []
    for p in plants:
        code = p["plant"]
        dead = _f(p["dead_stock_l"])
        rows = [r for r in mb52 if r["plant"] == code]

        consumed = -window_sum(code, "CONSUMPTION")
        per_day = max(consumed, 0.0) / BURN_DAYS

        materials = []
        for r in rows:
            m = r["material"]
            info = mats.get(m, {})
            lv = levels.get((code, m))
            materials.append({
                "material": m,
                "description": (r["description"] or info.get("label") or "").strip(),
                "unit": r["unit"] or "L",
                "closing_l": round(_f(r["usable"]), 2),
                "value": round(_f(r["value"]), 2),
                "is_fuel": bool(info.get("counts_as_fuel")),
                "locations": r["locations"],
                "min_l": _f(lv["minstock"]) if lv else None,
                "reorder_l": _f(lv["reorderpoint"]) if lv else None,
                "max_l": _f(lv["maxstock"]) if lv else None,
            })

        fuel_rows = [m for m in materials if m["is_fuel"]]
        usable = sum(m["closing_l"] for m in fuel_rows)
        above_dead = max(usable - dead, 0.0)

        # The plant's levels: SAP's, where SAP has them. Zero is SAP's way of
        # saying "none set", not a level of nothing.
        def level(k: str) -> float | None:
            vals = [m[k] for m in fuel_rows if m[k]]
            if not vals:
                vals = [_f(l[{"min_l": "minstock", "reorder_l": "reorderpoint",
                              "max_l": "maxstock"}[k]])
                        for (pl, _m), l in levels.items() if pl == code]
                vals = [v for v in vals if v]
            return max(vals) if vals else None

        min_l, reorder_l, max_l = level("min_l"), level("reorder_l"), level("max_l")
        capacity = _f(p["tank_capacity_l"]) or max_l

        cover = round(above_dead / per_day, 1) if per_day > 0 else None
        dry_on = None
        if per_day > 0:
            dry_on = (snap + timedelta(days=min(int(above_dead / per_day),
                                                PROJECT_DAYS))).isoformat()

        mine = [i for i in inbound if i["plant"] == code
                and mats.get(str(i["material"]).lstrip("0"), {}).get("counts_as_fuel")]
        rh = _rhythm(docs, code, snap)

        state = ("dormant" if per_day <= 0
                 else "below_dead" if usable <= dead and dead > 0
                 else "below_reorder" if reorder_l and usable <= reorder_l
                 else "below_min" if min_l and usable <= min_l
                 else "ok")

        out_plants.append({
            "plant": code, "name": p["name"],
            "materials": materials,
            "fuel_l": round(usable, 2),
            "fuel_value": round(sum(m["value"] for m in fuel_rows), 2),
            "held_l": round(held.get(code, 0.0), 2),
            "dead_stock_l": round(dead, 2),
            "available_l": round(above_dead, 2),
            "capacity_l": round(capacity, 2) if capacity else None,
            "min_l": min_l, "reorder_l": reorder_l, "max_l": max_l,
            "levels_from_sap": bool(min_l or reorder_l or max_l),
            "state": state,
            "burn_per_day_l": round(per_day, 1),
            "consumed_l": round(max(consumed, 0.0), 2),
            "received_l": round(window_sum(code, "RECEIPT"), 2),
            "transferred_out_l": _r(-window_sum(code, "TRANSFER", "qty_out")),
            "adjusted_l": _r(window_sum(code, "ADJUSTMENT")),
            "days_cover": cover,
            "dry_on": dry_on,
            "dormant": per_day <= 0,
            "rhythm": rh,
            "inbound_overdue_l": round(sum(i["pending_l"] for i in mine
                                           if i["overdue"] and not i["stale"]), 2),
            "inbound_stale_l": round(sum(i["pending_l"] for i in mine if i["stale"]), 2),
            "inbound_open_l": round(sum(i["pending_l"] for i in mine if not i["overdue"]), 2),
        })

    mb5b_on = _masters(pg)["mb5b"]
    today = as_on or date.today()
    return {
        "as_on": snap.isoformat(),
        "history_as_on": mb5b_on.isoformat() if mb5b_on else None,
        "stale_days": (today - snap).days,
        "burn_window_days": BURN_DAYS,
        "rhythm_window_days": RHYTHM_DAYS,
        "stale_after_days": STALE_AFTER_DAYS,
        "plants": out_plants,
        "inbound": inbound,
        "unclassified": unclassified,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Movement — day by day, what arrived and what was burned
# ═══════════════════════════════════════════════════════════════════════════
def fuel_movement(pg: Session, days: int = 30) -> dict:
    """Day by day, at every plant: what arrived, what was consumed, what moved.

    Consumption is consumption: a transfer to another plant is shown in its own
    column, because counting it as burn is what made Sukinda look thirty times
    thirstier than it is. Opening and closing come from the MB5B history.
    """
    plants = _plants(pg)
    names = {p["plant"]: p["name"] for p in plants}
    codes = list(names)
    mats = _materials(pg)
    fuel = [m for m, v in mats.items() if v["counts_as_fuel"]]
    until = _mb52_date(pg) or date.today()
    since = until - timedelta(days=days)
    moves = _window_moves(pg, since, until)

    agg: dict[tuple, dict] = {}
    for m in moves:
        k = (m["day"], m["plant"])
        a = agg.setdefault(k, {"received": 0.0, "consumed": 0.0,
                               "out": 0.0, "adjusted": 0.0})
        if m["class"] == "RECEIPT":
            a["received"] += _f(m["qty"])
        elif m["class"] == "CONSUMPTION":
            a["consumed"] += -_f(m["qty"])
        elif m["class"] == "TRANSFER":
            a["out"] += -_f(m["qty_out"])
        elif m["class"] == "ADJUSTMENT":
            a["adjusted"] += _f(m["qty"])

    stock = {(r["report_date"], r["plant"]): r for r in pg.execute(text("""
        SELECT report_date, plant, SUM(opening_l) AS opening, SUM(closing_l) AS closing
          FROM fuel_stock_snapshot
         WHERE report_date > :since AND report_date <= :until
           AND plant = ANY(:plants) AND material = ANY(:fuel)
         GROUP BY 1, 2
    """), {"since": since, "until": until, "plants": codes, "fuel": fuel}).mappings()}

    out = []
    for (day, plant), a in sorted(agg.items(), key=lambda x: (x[0][0], x[0][1]),
                                  reverse=True):
        if not any(abs(v) > 0.001 for v in a.values()):
            continue
        s = stock.get((day, plant))
        out.append({
            "day": day.isoformat(), "plant": plant,
            "name": names.get(plant, plant),
            "opening_l": round(_f(s["opening"]), 1) if s else None,
            "received_l": round(a["received"], 1),
            # Kept as `issued_l` for the screen; it is consumption now.
            "issued_l": _r(a["consumed"], 1),
            "transferred_out_l": _r(a["out"], 1),
            "adjusted_l": round(a["adjusted"], 1),
            "closing_l": round(_f(s["closing"]), 1) if s else None,
            "gained": a["received"] > a["consumed"] + a["out"],
        })
    return {"days": days, "movements": out}


# ═══════════════════════════════════════════════════════════════════════════
# Projection — two lines, both honest
# ═══════════════════════════════════════════════════════════════════════════
def fuel_projection(pg: Session, plant: str, days: int = PROJECT_DAYS) -> dict:
    """Day by day: what the tank holds if supply keeps its rhythm, and if it stops.

    Two lines rather than one, because they answer different questions:

      `litres`          supply arrives as it has been arriving -- the average
                        delivery, at the average interval, read from SAP's own
                        receipts -- and the tank stops at its capacity.
      `nothing_l`       nothing arrives at all. The day this reaches the dead
                        stock is the day the mine stops if the next tanker
                        does not come.

    Purchase-order lines are NOT dropped into the tank on their due date any
    more. A supply agreement running to March is an entitlement, not a lorry,
    and landing 3,28,452 L on one day is what that produced.
    """
    snap = fuel_stock(pg)
    if not snap["as_on"]:
        return {"plant": plant, "days": []}
    start = date.fromisoformat(snap["as_on"])
    p = next((x for x in snap["plants"] if x["plant"] == plant), None)
    if not p:
        return {"plant": plant, "days": []}

    burn = p["burn_per_day_l"]
    dead = p["dead_stock_l"]
    cap = p["capacity_l"]
    rh = p["rhythm"]

    arrivals: dict[date, float] = {}
    if rh["next_expected"] and rh["avg_arrival_l"] and rh["every_days"]:
        d = date.fromisoformat(rh["next_expected"])
        step = max(1, round(rh["every_days"]))
        while d <= start + timedelta(days=days):
            arrivals[d] = rh["avg_arrival_l"]
            d += timedelta(days=step)

    level = nothing = p["fuel_l"]
    out = []
    for n in range(days + 1):
        d = start + timedelta(days=n)
        arriving = arrivals.get(d, 0.0) if n else 0.0
        if n:
            level = level - burn + arriving
            nothing = nothing - burn
            if cap:
                level = min(level, cap)
        level = max(level, 0.0)
        nothing = max(nothing, 0.0)
        out.append({
            "day": d.isoformat(),
            "litres": round(level, 1),
            "nothing_l": round(nothing, 1),
            "arriving_l": round(arriving, 1),
            # Dry means below the dead stock: the pump draws nothing more.
            "dry": level <= dead,
            "nothing_dry": nothing <= dead,
        })
    return {"plant": plant, "name": p["name"], "burn_per_day_l": burn,
            "dead_stock_l": dead, "capacity_l": cap, "rhythm": rh,
            "days": out}


# ═══════════════════════════════════════════════════════════════════════════
# Arrival — one day's receipts, traced to the document
# ═══════════════════════════════════════════════════════════════════════════
def fuel_arrival(pg: Session, plant: str, day: str) -> dict:
    """What landed at a plant on one day -- every goods receipt, with its paper.

    The first version could only guess: it matched the size of a receipt here
    against an issue elsewhere and offered "possibly from Sukinda". SAP holds
    the receipt itself -- the order, the vendor, the challan quantity against
    what was accepted, the gate-in time, and a header that says "STO SUKINDA
    PLANT TO MINE" when that is what it was. So this now shows the documents.
    """
    plants = _plants(pg)
    names = {x["plant"]: x["name"] for x in plants}
    mats = _materials(pg)
    fuel = [m for m, v in mats.items() if v["counts_as_fuel"]]
    on = date.fromisoformat(day)
    docs = [d for d in _receipt_docs(pg, [plant], fuel, on - timedelta(days=1), on)
            if d["day"] == on]

    def gate(d) -> str | None:
        dt, tm = str(d["in_date"] or ""), str(d["in_time"] or "")
        if len(dt) == 8 and dt.isdigit():
            s = f"{dt[6:8]}-{dt[4:6]}-{dt[:4]}"
            if len(tm) >= 4 and tm[:4].isdigit():
                s += f" {tm[:2]}:{tm[2:4]}"
            return s
        return None

    receipts = [{
        "po": (d["po_no"] or "").strip() or None,
        "vendor": (d["vendor_name"] or "").strip() or None,
        "header": (d["header"] or "").strip() or None,
        "reference": (d["reference"] or "").strip() or None,
        "material": str(d["material_no"]).lstrip("0"),
        "description": (d["material_desc"] or "").strip(),
        "qty_l": round(_f(d["qty"]), 2),
        "challan_l": round(_f(d["challan_qty"]), 2) if d["challan_qty"] is not None else None,
        "short_l": (round(_f(d["challan_qty"]) - _f(d["qty"]), 2)
                    if d["challan_qty"] is not None else None),
        "gate_in": gate(d),
        "value": round(_f(d["post_amount"]), 2) if d["post_amount"] is not None else None,
        # A stock transfer is told by its order, not guessed from a size match.
        "is_transfer": str(d["po_no"] or "").startswith("61")
                       or "STO" in str(d["header"] or "").upper(),
    } for d in docs]

    total = sum(r["qty_l"] for r in receipts)
    value = sum(r["value"] or 0 for r in receipts)
    return {
        "plant": plant, "name": names.get(plant, plant), "day": day,
        "received_l": round(total, 2),
        "rate_per_l": round(value / total, 2) if total and value else None,
        "receipts": receipts,
        "traced": bool(receipts),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Calendar — every day a square
# ═══════════════════════════════════════════════════════════════════════════
def fuel_calendar(pg: Session, plant: str, back: int = 35,
                  forward: int = 14) -> dict:
    """Every day as a square: what was standing, what came, what was consumed.

    Past squares: closing from the MB5B history, today's from MB52, and the
    day's consumption from the movements -- so a transfer out of Sukinda no
    longer shows as Sukinda burning eighteen thousand litres.

    SAP posts issues in batches, so a zero on a working day means "nothing was
    posted", not "nothing was burned"; the squares say posted. Future squares
    carry only the projected level, marked as projected: a day that has not
    happened has no consumption to show.
    """
    stock = fuel_stock(pg)
    if not stock["as_on"]:
        return {"plant": plant, "days": []}
    today = date.fromisoformat(stock["as_on"])
    p = next((x for x in stock["plants"] if x["plant"] == plant), None)
    if not p:
        return {"plant": plant, "days": []}
    burn, dead = p["burn_per_day_l"], p["dead_stock_l"]

    mats = _materials(pg)
    fuel = [m for m, v in mats.items() if v["counts_as_fuel"]]
    closing = {r["report_date"]: _f(r["closing"]) for r in pg.execute(text("""
        SELECT report_date, SUM(closing_l) AS closing
          FROM fuel_stock_snapshot
         WHERE plant = :p AND material = ANY(:fuel)
           AND report_date > :today - make_interval(days => :back)
           AND report_date < :today
         GROUP BY report_date
    """), {"p": plant, "fuel": fuel, "today": today, "back": back}).mappings()}
    closing[today] = p["fuel_l"]

    moves = _window_moves(pg, today - timedelta(days=back), today)
    day_mv: dict[date, dict] = {}
    for m in moves:
        if m["plant"] != plant:
            continue
        a = day_mv.setdefault(m["day"], {"in": 0.0, "used": 0.0, "out": 0.0})
        if m["class"] == "RECEIPT":
            a["in"] += _f(m["qty"])
        elif m["class"] == "CONSUMPTION":
            a["used"] += -_f(m["qty"])
        elif m["class"] == "TRANSFER":
            a["out"] += -_f(m["qty_out"])

    proj = {date.fromisoformat(d["day"]): d
            for d in fuel_projection(pg, plant, forward)["days"]}

    def cover(level: float) -> float | None:
        return round(max(level - dead, 0.0) / burn, 1) if burn > 0 else None

    out = []
    for n in range(-back + 1, forward + 1):
        d = today + timedelta(days=n)
        if d <= today and d in closing:
            mv = day_mv.get(d, {"in": 0.0, "used": 0.0, "out": 0.0})
            out.append({
                "day": d.isoformat(), "actual": True,
                "closing_l": round(closing[d], 1),
                "issued_l": _r(mv["used"], 1),
                "transferred_out_l": _r(mv["out"], 1),
                "received_l": round(mv["in"], 1),
                "days_cover": cover(closing[d]),
                "dry": closing[d] <= dead and dead > 0,
            })
        elif d > today and d in proj:
            lvl = proj[d]["litres"]
            out.append({
                "day": d.isoformat(), "actual": False,
                "closing_l": lvl,
                "issued_l": None,
                "received_l": proj[d]["arriving_l"] or 0.0,
                "days_cover": cover(lvl),
                "dry": proj[d]["dry"],
            })
    return {"plant": plant, "name": p["name"], "today": today.isoformat(),
            "burn_per_day_l": burn, "dead_stock_l": dead, "days": out}


# ═══════════════════════════════════════════════════════════════════════════
# Calculator — everything a planner needs, filled in from what SAP knows
# ═══════════════════════════════════════════════════════════════════════════
def fuel_calculator(pg: Session, db: Session, plant: str, days: int = 14) -> dict:
    """The starting figures for the diesel calculator, all from live data.

    The mine's own workbook asks the better question: not when the tank runs
    dry, but HOW MUCH PRODUCTION THE DIESEL WE HAVE CAN SUPPORT. This returns
    every number that workbook types by hand -- opening stock, dead stock, the
    supply rhythm, the production target, the litres a cubic metre takes, the
    ore density -- measured instead of assumed, so the screen can work the
    days out and let the planner change any of them.

    The production basis exists only where the plant digs. At Sukinda and
    Balasore diesel is not driven by excavation, and the calculator works on
    the burn rate alone.
    """
    return _cached(("calc", plant, days), lambda: _fuel_calculator(pg, db, plant, days))


def _fuel_calculator(pg: Session, db: Session, plant: str, days: int) -> dict:
    stock = fuel_stock(pg)
    p = next((x for x in stock["plants"] if x["plant"] == plant), None)
    if not p or not stock["as_on"]:
        return {"plant": plant, "ready": False}
    as_on = date.fromisoformat(stock["as_on"])

    # ── the factors, measured ───────────────────────────────────────────
    ore_t_per_cum = pg.execute(text("""
        SELECT ore_t_per_cum FROM productivity_assumption
         WHERE effective_to IS NULL ORDER BY effective_from DESC LIMIT 1
    """)).scalar()
    ore_t_per_cum = float(ore_t_per_cum) if ore_t_per_cum else 3.0

    excavation = None
    plan_days: list[dict] = []
    if plant == "1200":
        # What the mine actually dug, the same thirty days the burn covers.
        # Variant 1 ore (mostly in tonnes), 3 overburden, 4 silt, in Cum.
        try:
            ex = {"ore_mt": 0.0, "ore_cum": 0.0, "ob_cum": 0.0, "silt_cum": 0.0}
            for r in db.execute(text("""
                SELECT Variant AS v, Units AS u, SUM(CAST(Qty AS DECIMAL(15,3))) AS q
                  FROM mines_day_wise_excavation
                 WHERE Prod_date > :a AND Prod_date <= :b
                 GROUP BY Variant, Units
            """), {"a": as_on - timedelta(days=BURN_DAYS), "b": as_on}).mappings():
                q, u, v = _f(r["q"]), (r["u"] or "").strip().upper(), str(r["v"]).strip()
                if v == "1":
                    if u == "MT":
                        ex["ore_mt"] += q
                        ex["ore_cum"] += q / ore_t_per_cum
                    else:
                        ex["ore_cum"] += q
                elif v == "3":
                    ex["ob_cum"] += q / ore_t_per_cum if u == "MT" else q
                elif v == "4":
                    ex["silt_cum"] += q / ore_t_per_cum if u == "MT" else q
            total = ex["ore_cum"] + ex["ob_cum"] + ex["silt_cum"]
            excavation = {
                **{k: round(v, 1) for k, v in ex.items()},
                "total_cum": round(total, 1),
                "per_day_cum": round(total / BURN_DAYS, 1),
                # The figure the audit slide calls litres per Cum: every litre
                # the mine consumed, over every Cum it moved. Not only the
                # excavators' -- the cars and the generators are in it, as they
                # were in the audit's.
                "l_per_cum": round(p["consumed_l"] / total, 2) if total else None,
            }
        except Exception:                               # noqa: BLE001
            excavation = None

        # The plan, day by day, from the mine's own daily excavation plan.
        try:
            for r in db.execute(text("""
                SELECT Prod_date AS d,
                       SUM(CAST(OB_QTY_Cum AS DECIMAL(12,2))) AS ob,
                       SUM(ORE_QTY) AS ore
                  FROM mines_daily_excavation_plan
                 WHERE Prod_date > :a AND Prod_date <= :b
                 GROUP BY Prod_date ORDER BY Prod_date
            """), {"a": as_on, "b": as_on + timedelta(days=days)}).mappings():
                plan_days.append({"day": r["d"].isoformat(),
                                  "ore_mt": round(_f(r["ore"]), 1),
                                  "ob_cum": round(_f(r["ob"]), 1)})
        except Exception:                               # noqa: BLE001
            plan_days = []

    rh = p["rhythm"]
    projection = fuel_projection(pg, plant, days)["days"]
    return {
        "plant": plant, "name": p["name"], "ready": True,
        "as_on": stock["as_on"], "days": days,
        "opening_l": p["fuel_l"],
        "dead_stock_l": p["dead_stock_l"],
        "capacity_l": p["capacity_l"],
        "reorder_l": p["reorder_l"], "min_l": p["min_l"],
        "burn_per_day_l": p["burn_per_day_l"],
        "consumed_l": p["consumed_l"],
        "burn_window_days": BURN_DAYS,
        "rhythm": rh,
        # Expected deliveries, day by day, on the rhythm -- the planner edits
        # these, so they start where SAP's history says they will be.
        "receipts": [{"day": d["day"], "litres": d["arriving_l"]}
                     for d in projection[1:]],
        "production": None if plant != "1200" else {
            "ore_t_per_cum": ore_t_per_cum,
            "actual": excavation,
            "plan": plan_days,
            "plan_source": "mines_daily_excavation_plan" if plan_days else None,
        },
        "inbound_open_l": p["inbound_open_l"],
    }
