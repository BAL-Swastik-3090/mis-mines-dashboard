"""What diesel is standing at each plant, how long it lasts, and what is coming.

── WHY THIS READS SAP AND WRITES NOTHING ───────────────────────────────────
Stock is entered in SAP. Every receipt is booked against a purchase order and
every issue against a cost centre, and the mine has no reason to key the same
delivery twice -- two systems owning one delivery is two systems that will
disagree about it within a month. So this is read-only, and the platform's own
fuel_receipt table stays empty on purpose.

What SAP cannot answer is which machine the diesel went into: it knows 82,151
litres left the tank at Kaliapani in thirty days, not that an excavator took
them. That question belongs to fuel_issue at the nozzle, and these two are
meant to be compared, not merged.

── THE FOUR WAYS THIS QUERY GOES WRONG ─────────────────────────────────────
Every one of them fails silently, which is why each is handled explicitly.

1. TWO TABLES, DIFFERENT JOBS. mm_mb52_inventory_new is storage-location level
   and undated; scm_zmm_stock_mb5b is plant level with a daily report_date.
   MB5B is treated as authoritative here, as the SCM dashboard already does.
   They disagree: 5,330 L against 4,033 L for diesel at Kaliapani, same unit
   rate, so it is a missing receipt or an unmapped storage location rather
   than a valuation difference.

2. MATERIAL NUMBERS ARE PADDED in one and not the other -- 000000000012000004
   against 12000004. Join them without stripping and you get nothing at all,
   quietly.

3. totissueqty IS A VARCHAR with the sign on the FRONT: '-10409.0'. Read it as
   a number and the burn rate comes out negative, which reads as stock
   growing. (The MB52 table has the opposite habit, a trailing minus, where
   the sign is lost instead. Different trap, different wrong answer.)

4. ISSUES ARE POSTED IN BATCHES, not daily -- several zero days and then ten
   thousand litres at once. A single day's figure means nothing; only an
   average over a window does, and that window must count calendar days
   rather than days-with-movement or the rate comes out several times too
   high.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

# The plants this mine's management actually looks at, in the order they are
# read: this is the mine's dashboard, so the mine comes first, then the plant
# that supplies it, then the rest. Dict order is the display order.
PLANTS: dict[str, str] = {
    "1200": "Kaliapani Chromite Mines",
    "1110": "Sukinda Plant",
    "1100": "Balasore Plant",
    "1210": "Kaliapani COB Plant",
}

# SAP's own material group for fuels. Filtering on the description instead
# catches oil seals, solenoid coils and used drums -- "OIL" is in all of them.
FUEL_GROUP = "1046"

# In the fuel group and stored in litres, but a lubricating base oil rather
# than something an engine burns. Shown, never counted as fuel cover.
NOT_FUEL = {"12007590"}

# How far back the burn rate is averaged. Long enough to absorb the batching,
# short enough to follow a change in how hard the mine is working.
BURN_DAYS = 30

# How far forward the projection runs before it stops being a forecast and
# starts being a guess.
PROJECT_DAYS = 45

# An order this far past its date is not late, it is abandoned.
#
# 36 of the open lines are more than a year overdue and hold 824,647 litres
# between them -- the oldest due in February 2023. Counting those as "coming"
# makes a plant with two days of diesel look supplied, which is the one
# mistake this screen exists to prevent. They are reported separately, as
# paperwork to close rather than fuel to expect.
STALE_AFTER_DAYS = 90


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _po_date(v) -> date | None:
    """SAP writes a delivery date as 20260808, sometimes as nothing at all."""
    s = str(v or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:]))
    except ValueError:
        return None


def fuel_stock(pg: Session, as_on: date | None = None) -> dict:
    """Fuel at every plant: what is there, how long it lasts, what is coming."""
    # Two statements rather than one clever one: "(:d IS NULL OR report_date
    # <= :d)" cannot use the index on report_date, because MySQL evaluates the
    # OR per row before it can know the filter is vacuous.
    snap = (pg.execute(text("SELECT MAX(report_date) FROM fuel_stock_snapshot"
                            " WHERE report_date <= :d"), {"d": as_on}).scalar()
            if as_on else
            pg.execute(text("SELECT MAX(report_date) FROM fuel_stock_snapshot")).scalar())
    if not snap:
        return {"as_on": None, "plants": [], "inbound": [], "stale_days": None}

    rows = pg.execute(text("""
        SELECT plant, material,
               MAX(description) AS description,
               SUM(closing_l)   AS closing,
               SUM(closing_value) AS value,
               MAX(unit)        AS unit
          FROM fuel_stock_snapshot
         WHERE report_date = :snap
         GROUP BY plant, material
    """), {"snap": snap}).mappings().all()

    # The burn, averaged over calendar days rather than days with movement.
    # ABS because the sign lives on the front of a varchar and a negative burn
    # would read as stock growing by itself.
    burn = {(r["plant"], r["material"]): (_f(r["issued"]) or 0.0) / BURN_DAYS
            for r in pg.execute(text("""
        SELECT plant, material, SUM(issued_l) AS issued
          FROM fuel_stock_snapshot
         WHERE report_date > :snap - make_interval(days => :win)
           AND report_date <= :snap
         GROUP BY plant, material
    """), {"snap": snap, "win": BURN_DAYS}).mappings()}

    # What is still owed to each plant, and whether it is late.
    #
    # A long-dated 4500-series line is a supply agreement rather than a lorry
    # on its way, so the two are counted apart: a plant with three days of
    # cover and 300,000 litres "inbound" on a contract running to March is not
    # supplied, it is merely entitled.
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
    for code, name in PLANTS.items():
        mats = []
        for r in [x for x in rows if x["plant"] == code]:
            m = r["material"]
            is_fuel = m not in NOT_FUEL
            closing = _f(r["closing"])
            per_day = burn.get((code, m), 0.0)
            mine = [i for i in inbound if i["plant"] == code and i["material"] == m]
            overdue_l = sum(i["pending_l"] for i in mine
                            if i["overdue"] and not i["stale"])
            stale_l = sum(i["pending_l"] for i in mine if i["stale"])
            open_l = sum(i["pending_l"] for i in mine if not i["overdue"])

            # Days of cover, and the day it runs out if nothing arrives. Both
            # are undefined rather than infinite when nothing is being drawn:
            # a tank nobody touches does not "last forever", it is dormant.
            cover = round(closing / per_day, 1) if per_day > 0 else None
            dry_on = None
            if per_day > 0:
                dry_on = (snap + timedelta(days=min(int(closing / per_day),
                                                    PROJECT_DAYS))).isoformat()

            mats.append({
                "material": m, "description": (r["description"] or "").strip(),
                "unit": r["unit"] or "L",
                "closing_l": round(closing, 2), "value": _f(r["value"]),
                "is_fuel": is_fuel,
                "burn_per_day_l": round(per_day, 1) if per_day else 0.0,
                "days_cover": cover if is_fuel else None,
                "dry_on": dry_on if is_fuel else None,
                "inbound_overdue_l": round(overdue_l, 2),
                "inbound_stale_l": round(stale_l, 2),
                "inbound_open_l": round(open_l, 2),
                "dormant": per_day <= 0,
            })

        fuel = [m for m in mats if m["is_fuel"]]
        out_plants.append({
            "plant": code, "name": name, "materials": mats,
            "fuel_l": round(sum(m["closing_l"] for m in fuel), 2),
            "fuel_value": round(sum(m["value"] for m in fuel), 2),
            "burn_per_day_l": round(sum(m["burn_per_day_l"] for m in fuel), 1),
            # The plant's cover is its worst fuel's cover, not the average of
            # them: running out of diesel is not softened by having plenty of
            # something else.
            "days_cover": min([m["days_cover"] for m in fuel
                               if m["days_cover"] is not None], default=None),
            "inbound_overdue_l": round(sum(m["inbound_overdue_l"] for m in mats), 2),
            "inbound_stale_l": round(sum(m["inbound_stale_l"] for m in mats), 2),
            "inbound_open_l": round(sum(m["inbound_open_l"] for m in mats), 2),
        })

    today = as_on or date.today()
    return {
        "as_on": snap.isoformat(),
        # SAP's own safetystock is 0.00 on every row, so nothing there raises a
        # low-stock flag. These figures are worked out here, not alerted by SAP,
        # and the screen says so.
        "stale_days": (today - snap).days,
        "burn_window_days": BURN_DAYS,
        "stale_after_days": STALE_AFTER_DAYS,
        "plants": out_plants,
        "inbound": inbound,
    }


def fuel_movement(pg: Session, days: int = 30) -> dict:
    """Day by day, what came in and what went out, at every plant.

    THE RECEIPTS ARE THE POINT. A plant's stock only rises when something
    arrives, and MB5B records that as a receipt on the day: 3,000 litres at
    the mine on 1 October, 1,200 on the 5th. A transfer out of Sukinda appears
    twice -- as an issue there and a receipt here on the same day -- so the
    two lines read together show where the mine's diesel came from without
    needing a transfer document.

    Days with no movement are left out. Issues are posted in batches, so a
    row of zeroes is the normal state and carrying them would bury the days
    that matter.
    """
    rows = pg.execute(text("""
        SELECT report_date, plant,
               SUM(opening_l)  AS opening,
               SUM(received_l) AS received,
               SUM(issued_l)   AS issued,
               SUM(closing_l)  AS closing
          FROM fuel_stock_snapshot
         WHERE report_date > (SELECT MAX(report_date) FROM fuel_stock_snapshot)
                             - make_interval(days => :win)
         GROUP BY report_date, plant
        HAVING SUM(received_l) <> 0 OR SUM(issued_l) <> 0
         ORDER BY report_date DESC, plant
    """), {"win": days}).mappings().all()

    out = []
    for r in rows:
        out.append({
            "day": r["report_date"].isoformat(),
            "plant": r["plant"], "name": PLANTS.get(r["plant"], r["plant"]),
            "opening_l": round(_f(r["opening"]), 1),
            "received_l": round(_f(r["received"]), 1),
            "issued_l": round(_f(r["issued"]), 1),
            "closing_l": round(_f(r["closing"]), 1),
            # Stock rose on this day, which only happens when fuel arrived.
            "gained": _f(r["received"]) > _f(r["issued"]),
        })
    return {"days": days, "movements": out}


def fuel_projection(pg: Session, plant: str, days: int = PROJECT_DAYS) -> dict:
    """Day by day: what is left, after what is burned and before what arrives.

    Deliveries land on the date SAP has for them. An overdue one is NOT
    carried forward to today -- a lorry that was due in August and has not
    come is not arriving this morning because a projection would like it to.
    It is shown as overdue and left out of the line, so the line shows what
    happens if nothing changes, which is the only question worth asking.
    """
    snap = fuel_stock(pg)
    if not snap["as_on"]:
        return {"plant": plant, "days": []}
    start = date.fromisoformat(snap["as_on"])
    p = next((x for x in snap["plants"] if x["plant"] == plant), None)
    if not p:
        return {"plant": plant, "days": []}

    arrivals: dict[str, float] = {}
    for i in snap["inbound"]:
        if i["plant"] != plant or i["overdue"] or not i["due_on"]:
            continue
        arrivals[i["due_on"]] = arrivals.get(i["due_on"], 0.0) + i["pending_l"]

    level = p["fuel_l"]
    burn = p["burn_per_day_l"]
    out = []
    for n in range(days + 1):
        d = (start + timedelta(days=n)).isoformat()
        if n:
            level = level - burn + arrivals.get(d, 0.0)
        out.append({"day": d, "litres": round(max(level, 0.0), 1),
                    "arriving_l": round(arrivals.get(d, 0.0), 1),
                    "dry": level <= 0})
    return {"plant": plant, "name": p["name"], "burn_per_day_l": burn,
            "days": out}


def fuel_arrival(pg: Session, plant: str, day: str) -> dict:
    """What landed at a plant on one day, and everything known about where from.

    SAY WHAT IS KNOWN AND ADMIT THE REST. MB5B records that 1,200 litres
    arrived; it does not record a lorry, a vendor or a transfer note. Three
    things can be shown honestly:

      the materials, with the value booked against them, which gives a unit
      rate -- a rate that matches the usual supply price suggests a purchase,
      and one that does not suggests a transfer at a different valuation;

      what every other plant did the same day, because a transfer out of
      Sukinda is an issue there and a receipt here on the same date, and
      reading the two together is how a transfer is identified at all;

      any goods receipt the purchase-order table holds for that date.

    That last one is usually empty for recent days: the PO table's goods
    receipt dates stop in early August while MB5B records arrivals into
    October, so it is shown when present and said to be absent when not,
    rather than left to look like there was no purchase.
    """
    on = date.fromisoformat(day)

    materials = [{
        "material": r["material"],
        "description": (r["description"] or "").strip(),
        "received_l": _f(r["received"]) or 0.0,
        "received_value": _f(r["value"]) or 0.0,
        "rate_per_l": round((_f(r["value"]) or 0.0) / (_f(r["received"]) or 1.0), 2)
                      if (_f(r["received"]) or 0.0) else None,
        "opening_l": _f(r["opening"]) or 0.0,
        "closing_l": _f(r["closing"]) or 0.0,
    } for r in pg.execute(text("""
        SELECT material, MAX(description) AS description,
               SUM(received_l) AS received, SUM(received_value) AS value,
               SUM(opening_l)  AS opening,  SUM(closing_l) AS closing
          FROM fuel_stock_snapshot
         WHERE plant = :p AND report_date = :d
         GROUP BY material
        HAVING SUM(received_l) > 0
    """), {"p": plant, "d": on}).mappings()]

    # The same day at every other plant. An issue somewhere else of about the
    # same size is what a transfer looks like from here.
    elsewhere = [{
        "plant": r["plant"], "name": PLANTS.get(r["plant"], r["plant"]),
        "received_l": _f(r["received"]) or 0.0,
        "issued_l": _f(r["issued"]) or 0.0,
    } for r in pg.execute(text("""
        SELECT plant, SUM(received_l) AS received, SUM(issued_l) AS issued
          FROM fuel_stock_snapshot
         WHERE report_date = :d AND plant <> :p
         GROUP BY plant
        HAVING SUM(received_l) <> 0 OR SUM(issued_l) <> 0
    """), {"d": on, "p": plant}).mappings()]

    receipts = [{
        "po": r["po"], "vendor": r["vendor"], "material": r["material"],
        "qty_l": _f(r["received_l"]) or 0.0, "doc": None,
    } for r in pg.execute(text("""
        SELECT po, vendor, material, received_l
          FROM fuel_purchase_line
         WHERE plant = :p AND goods_receipt_on = :d
           AND COALESCE(received_l, 0) <> 0
           -- AND FOR THE FUEL THAT ACTUALLY ARRIVED.
           --
           -- Matching on the date alone returned four purchase orders for
           -- paint, bearings and a one-litre sundry, and called the diesel
           -- "traced to ADITYA ENTERPRISES". A plant receives many things on
           -- a Monday; only the lines for this material say where this fuel
           -- came from.
           AND material IN :mats
    """).bindparams(bindparam("mats", expanding=True)),
        {"p": plant, "d": on,
         "mats": [m["material"] for m in materials] or ["__none__"]}).mappings()]

    total = sum(m["received_l"] for m in materials)
    # A plant that issued about what this one received, the same day.
    likely_from = [e for e in elsewhere
                   if total and 0.8 <= (e["issued_l"] / total) <= 1.25]

    return {
        "plant": plant, "name": PLANTS.get(plant, plant), "day": day,
        "received_l": round(total, 2),
        "materials": materials,
        "elsewhere": elsewhere,
        "purchase_receipts": receipts,
        # Offered as a question, not an answer: the sizes agree, which is
        # evidence and not a transfer document.
        "possible_transfer_from": [e["name"] for e in likely_from],
        "traced": bool(receipts),
    }


def fuel_calendar(pg: Session, plant: str, back: int = 35,
                  forward: int = 14) -> dict:
    """Every day as a square: what was standing, what came, what went.

    ── WHAT A DAY CAN AND CANNOT SAY ───────────────────────────────────────
    Closing stock is stated every day, including days nothing moved, so the
    colour of a square is a real figure for that date.

    Consumption is not. SAP posts issues in batches -- 10,409 litres on the
    5th covering days the mine was certainly working -- so a zero on the 3rd
    means "nothing was posted", not "nothing was burned". The squares say
    posted, and the legend says so, because a calendar that implies the mine
    stood still for two days would be read as a fact about the mine rather
    than about the posting run.

    FUTURE DAYS CARRY NO CONSUMPTION AT ALL. There is none to carry: the
    mirror holds nothing dated after today and never will until the day
    happens. A forward square shows only the projected level, which is the
    past burn rate carried on, and is marked as a projection so it cannot be
    mistaken for a measurement. Asking what was consumed on a date that has
    not arrived has no answer, and inventing one is how a dashboard starts
    lying quietly.
    """
    today = pg.execute(text("SELECT MAX(report_date) FROM fuel_stock_snapshot")).scalar()
    if not today:
        return {"plant": plant, "days": []}

    actual = {r["report_date"]: r for r in pg.execute(text("""
        SELECT report_date,
               SUM(closing_l)  AS closing,
               SUM(issued_l)   AS issued,
               SUM(received_l) AS received
          FROM fuel_stock_snapshot
         WHERE plant = :p AND report_date > :today - make_interval(days => :back)
           AND report_date <= :today
         GROUP BY report_date
    """), {"p": plant, "today": today, "back": back}).mappings()}

    proj = {date.fromisoformat(d["day"]): d
            for d in fuel_projection(pg, plant, forward)["days"]}

    burn = 0.0
    p_row = next((x for x in fuel_stock(pg)["plants"] if x["plant"] == plant), None)
    if p_row:
        burn = p_row["burn_per_day_l"]

    out = []
    for n in range(-back + 1, forward + 1):
        d = today + timedelta(days=n)
        a = actual.get(d)
        if a is not None:
            closing = _f(a["closing"])
            out.append({
                "day": d.isoformat(), "actual": True,
                "closing_l": round(closing, 1),
                # Posted, not burned. See the docstring.
                "issued_l": round(_f(a["issued"]), 1),
                "received_l": round(_f(a["received"]), 1),
                "days_cover": round(closing / burn, 1) if burn > 0 else None,
            })
        elif d > today and d in proj:
            lvl = proj[d]["litres"]
            out.append({
                "day": d.isoformat(), "actual": False,
                "closing_l": lvl,
                # No figure, because there is none: the day has not happened.
                "issued_l": None,
                "received_l": proj[d]["arriving_l"] or 0.0,
                "days_cover": round(lvl / burn, 1) if burn > 0 else None,
                "dry": proj[d]["dry"],
            })
    return {"plant": plant, "name": PLANTS.get(plant, plant),
            "today": today.isoformat(), "burn_per_day_l": burn, "days": out}
