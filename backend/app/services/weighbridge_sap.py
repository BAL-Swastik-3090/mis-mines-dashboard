"""The weighbridge as SAP recorded it: sap_odata_api.mines_weighbridge3.

WHY THIS IS NOT A RECONCILIATION. The screen beside it, "Report from
Application", reads minehub.trip -- this platform's own record of the same
bridge. Measured on 28 October 2026, over the window SAP covers: SAP holds
1,094 weighings across 26 days, the application holds 5 across 2. The
application's weighbridge is barely in use, so matching one against the other
would produce a page that is 99% "missing from the application" and says
nothing anybody needs. This reports what the bridge weighed, full stop. If
the application's screen ever carries the shift, a comparison becomes worth
building; it is not worth building now.

── EVERYTHING IS IN TONNES ─────────────────────────────────────────────────
tare_wt, gross_wt and net_wt are tonnes, not kilograms -- net averages 15.36
and gross runs to 46.87. The application's own weighment table stores
weight_kg, so the two are a thousand apart and must never be summed together
without saying which is which. net = gross - tare holds exactly on all 1,094
rows, so net is used as given rather than recomputed.

── THE COLUMNS THAT ARE ALWAYS EMPTY ───────────────────────────────────────
material_doc_no and veh_type are NULL on every row in the feed, and
transporter_name on 323 of 1,094. The first two are left out of the report
entirely: a column that is blank for everybody is a column that makes a
reader wonder what they are missing. transporter is kept, because it is
present for the two-thirds that are contractor hauls and absent precisely
where the mine's own fleet did the work, which is information.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

#: Kaliapani. The feed carries this plant only today, but it is a SAP table
#: and SAP tables grow other plants without warning — filtering here means a
#: COB or Balasore row appearing tomorrow cannot quietly inflate the mine's
#: tonnage.
PLANT = "1200"

#: The order the mine reads its materials in, ore first. Anything the feed
#: grows that is not in this list sorts after, alphabetically, rather than
#: being dropped — a grade nobody anticipated still has to appear.
GRADE_ORDER = ("ORE", "COB", "OVERBURDEN", "SILT", "REHANDLING")

#: The register is drawn in full rather than paged — a month is about 1,100
#: rows and the filtering is done on what is already on screen, which is
#: faster than a round trip per keystroke. This is the guard against somebody
#: asking for a year: the rows stop, the counts and totals above them do not,
#: and the response says it was capped so the screen can say so too.
MAX_ROWS = 5000

_WHERE = """
    plant = :plant
    AND production_date BETWEEN :fd AND :td
"""


def _f(v) -> float:
    return round(float(v), 3) if v is not None else 0.0


def _grade_key(g: str) -> tuple[int, str]:
    g = g or ""
    return (GRADE_ORDER.index(g), "") if g in GRADE_ORDER else (len(GRADE_ORDER), g)


def get_report(db: Session, from_date: date, to_date: date) -> dict[str, Any]:
    """Totals, the day-by-grade grid, and the trips themselves.

    Three queries rather than one pass summed in Python: the day grid and the
    grade totals are aggregates the database does better, and the register is
    the only one that carries every row. At ~1,100 rows a month the whole
    thing is one round trip's worth of work either way, and keeping the
    aggregates in SQL means the totals cannot drift from the rows beneath
    them by way of a rounding done twice.
    """
    p = {"plant": PLANT, "fd": from_date, "td": to_date}

    totals = db.execute(text(f"""
        SELECT count(*)                        AS trips,
               coalesce(sum(net_wt), 0)        AS net_t,
               coalesce(sum(gross_wt), 0)      AS gross_t,
               coalesce(sum(tare_wt), 0)       AS tare_t,
               count(DISTINCT vehicle_no)      AS vehicles,
               count(DISTINCT production_date) AS days,
               max(last_synced_at)             AS synced_at
        FROM sap_odata_api.mines_weighbridge3
        WHERE {_WHERE}
    """), p).mappings().first()

    by_grade = db.execute(text(f"""
        SELECT coalesce(mat_grade, '(none)')     AS grade,
               count(*)                          AS trips,
               coalesce(sum(net_wt), 0)          AS net_t,
               count(DISTINCT vehicle_no)        AS vehicles
        FROM sap_odata_api.mines_weighbridge3
        WHERE {_WHERE}
        GROUP BY 1
    """), p).mappings().all()

    day_rows = db.execute(text(f"""
        SELECT production_date                   AS d,
               coalesce(mat_grade, '(none)')     AS grade,
               count(*)                          AS trips,
               coalesce(sum(net_wt), 0)          AS net_t
        FROM sap_odata_api.mines_weighbridge3
        WHERE {_WHERE}
        GROUP BY 1, 2
    """), p).mappings().all()

    trips = db.execute(text(f"""
        SELECT transaction_id, production_date, shift, vehicle_no,
               transporter_name, mat_grade, material_desc, mat_sub_grade,
               source, destination, str_location,
               tare_wt, gross_wt, net_wt,
               tare_wt_date, tare_wt_time, gross_wt_date, gross_wt_time,
               tare_wt_by, gross_wt_by
        FROM sap_odata_api.mines_weighbridge3
        WHERE {_WHERE}
        ORDER BY production_date DESC, gross_wt_date DESC NULLS LAST,
                 gross_wt_time DESC NULLS LAST, transaction_id DESC
        LIMIT :cap
    """), {**p, "cap": MAX_ROWS}).mappings().all()

    grades = sorted({r["grade"] for r in by_grade}, key=_grade_key)

    # One row per day carrying every grade, so the grid has no holes — a day
    # the mine shifted no overburden shows 0.00 under Overburden rather than
    # an empty cell the reader has to interpret.
    per_day: dict[date, dict[str, Any]] = {}
    for r in day_rows:
        e = per_day.setdefault(r["d"], {"date": r["d"].isoformat(),
                                        "trips": 0, "net_t": 0.0,
                                        "grades": {g: 0.0 for g in grades}})
        e["trips"] += r["trips"]
        e["net_t"] = round(e["net_t"] + _f(r["net_t"]), 3)
        e["grades"][r["grade"]] = _f(r["net_t"])

    return {
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "grades": grades,
        "totals": {
            "trips":    totals["trips"],
            "net_t":    _f(totals["net_t"]),
            "gross_t":  _f(totals["gross_t"]),
            "tare_t":   _f(totals["tare_t"]),
            "vehicles": totals["vehicles"],
            "days":     totals["days"],
            # When the feed last ran, so a reader can tell "no trips" from
            # "nothing has arrived since Tuesday" without leaving the page.
            "synced_at": (totals["synced_at"].isoformat()
                          if totals["synced_at"] else None),
        },
        "by_grade": sorted(
            [{"grade": r["grade"], "trips": r["trips"],
              "net_t": _f(r["net_t"]), "vehicles": r["vehicles"]}
             for r in by_grade],
            key=lambda x: _grade_key(x["grade"])),
        "by_day": [per_day[d] for d in sorted(per_day, reverse=True)],
        "trips": [{
            "transaction_id":  r["transaction_id"],
            "production_date": r["production_date"].isoformat()
                               if r["production_date"] else None,
            "shift":           r["shift"],
            "vehicle_no":      r["vehicle_no"],
            "transporter":     r["transporter_name"],
            "grade":           r["mat_grade"],
            "material":        r["material_desc"],
            "sub_grade":       r["mat_sub_grade"],
            "source":          r["source"],
            "destination":     r["destination"],
            "location":        r["str_location"],
            "tare_t":          _f(r["tare_wt"]),
            "gross_t":         _f(r["gross_wt"]),
            "net_t":           _f(r["net_wt"]),
            # The moment the LOADED truck crossed, which is when the trip
            # actually happened. The tare may have been taken hours earlier,
            # or on another day, and ordering by it would scatter a shift.
            "weighed_at":      (f"{r['gross_wt_date']} "
                                f"{r['gross_wt_time']}".strip()
                               if r["gross_wt_date"] else None),
            "tare_at":         (f"{r['tare_wt_date']} {r['tare_wt_time']}".strip()
                               if r["tare_wt_date"] else None),
            "weighed_by":      r["gross_wt_by"],
        } for r in trips],
        # The register stops at MAX_ROWS; the totals above it never do.
        "truncated": len(trips) >= MAX_ROWS,
    }
