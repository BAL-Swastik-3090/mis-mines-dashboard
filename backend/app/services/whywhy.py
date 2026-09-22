"""Why-Why analysis — the facts an LLM is then asked to interpret.

WHAT THIS IS FOR. The Why-Why register in balmpicc records every automobile
breakdown at Kaliapani with a causal analysis attached. This module turns those
rows into a fixed set of ANALYSIS POINTS: counts, rates, shares, concentrations
and projections. It computes; it does not narrate. The narrative is generated
separately by BAL-AI (Qwen) from the numbers this returns.

That separation is deliberate and is the whole design. An LLM handed 345 rows and
asked to analyse them invents figures. An LLM handed "Ageing 178, Operator Error
81, Tyre 70" and asked for three sentences does not. It also means the section
still renders when the gateway is down: the charts come from here, and only the
prose is missing.

SCHEMAS. The register lives in balmpicc, everything else in balcorpdb. The two
use different collations (utf8mb4_unicode_ci vs utf8mb4_0900_ai_ci) and MySQL
refuses a join across them without an explicit COLLATE, so the engine-hour
denominator is assembled in Python against the same name maps the Equipment
section already uses rather than joined in SQL.

WHAT THE DATA WILL NOT SUPPORT, and is therefore not reported:
  * production_loss_cost, spare_cost and labour_cost are ZERO on all 345 rows.
    Only total_cost carries anything (297 rows). Breakdown cost is therefore
    reported as repair cost only; the production loss is left to the reader, who
    can weigh it against the breakdown hours that ARE recorded.
  * There is no operator-hours denominator anywhere, so operator event counts are
    counts of presence, never rates and never a ranking of blame. The response
    carries that caveat as data so the UI cannot quietly drop it.
"""
from __future__ import annotations

import logging
import re
import statistics
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

SCHEMA = "balmpicc"
ANALYSIS = f"{SCHEMA}.mpicc_whywhy_analysis"
ROWS = f"{SCHEMA}.mpicc_whywhy_rows"

logger = logging.getLogger(__name__)

# Failure modes are free text typed by the maintenance crew — 200+ distinct
# spellings over 345 rows, which Paretos into noise. These families are keyword
# matched in priority order: the first hit wins, so the more specific patterns
# must come first (a "hydraulic hose" is hydraulic, not a hose).
FAILURE_FAMILIES: list[tuple[str, tuple[str, ...]]] = [
    ("Tyre / wheel", ("TYRE", "TYER", "PUNCTURE", "WHEEL", "RIM")),
    ("Hydraulic", ("HYDRAULIC", "HYDROLIC", "CYLINDER")),
    ("Track / undercarriage", ("TRACK CHAIN", "TRACK", "IDLER", "SPROCKET", "UNDERCARRIAGE")),
    ("Gearbox / transmission", ("GEAR", "TRANSMISSION", "CLUTCH", "PROPELLER")),
    ("Bucket / boom / arm", ("BUCKET", "BOOM", "I LINK", "I-LINK", "LINK PIN")),
    ("Pins & bolts", ("PIN", "BOLT", "NUT", "STUD")),
    ("Air / brake", ("AIR LEAK", "BRAKE", "COMPRESSOR")),
    ("Engine / cooling", ("OVER HEAT", "OVERHEAT", "RADIATOR", "COOLANT", "ENGINE", "RPM", "TURBO")),
    ("Electrical", ("ELECTRIC", "BATTERY", "ALTERNATOR", "WIRING", "SENSOR")),
    ("Fuel / diesel", ("DIESEL", "FUEL", "INJECT")),
    ("Steering / suspension", ("STEERING", "SUSPENSION", "AXLE", "SPRING")),
    ("Body / structure", ("BODY", "CHASSIS", "CABIN", "GLASS", "DOOR")),
]
OTHER = "Other"

# Excavator names differ between the GPS feed and the maintenance register. Same
# map the Equipment section uses, so the two sections never disagree on a machine.
EXCAVATOR_SAP = {
    "BAL_Z AXIS 450-1(Excavator)": "EX-1 (EXCAVATOR)",
    "BAL_Z AXIS 470-2(Excavator)": "EX-2 (EXCAVATOR)",
    "BAL_Z AXIS 370 -4(Excavator)": "EX- 4 (EXCAVATOR)",
    "BAL_Z AXIS 370 -5(Excavator)": "EX- 5 (EXCAVATOR)",
    "BAL_Z AXIS 370-6(Excavator)": "EX- 6 (EXCAVATOR)",
    "BAL_Z AXIS 470 -7(Excavator)": "EX- 7 (EXCAVATOR)",
    "BAL_Z AXIS 220 -08(Excavator)": "EX- 8 (EXCAVATOR)",
}

# A machine needs enough operating time for a per-100-hour rate to mean anything.
# Below this the rate swings wildly on a single event and is reported as null.
MIN_HOURS_FOR_RATE = 100.0

# A defect needs to have recurred at least this often before a mean interval is
# worth projecting forward. Two events give one gap and no dispersion at all.
MIN_EVENTS_FOR_PROJECTION = 3


def _f(v) -> float:
    return float(v or 0)


def _norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().upper())


def family_of(desc: str | None) -> str:
    d = _norm(desc)
    if not d:
        return OTHER
    for name, keys in FAILURE_FAMILIES:
        if any(k in d for k in keys):
            return name
    return OTHER


def _machine_key(desc: str | None) -> str:
    """Strip the '(TIPPER)' / '(EXCAVATOR)' suffix for display and matching."""
    return re.sub(r"\s*\(.*?\)\s*$", "", (desc or "").strip()) or "(unnamed)"


# -- window -------------------------------------------------------------------
def data_extent(db: Session) -> tuple[date | None, date | None]:
    r = db.execute(
        text(f"SELECT MIN(breakdown_date) a, MAX(breakdown_date) b FROM {ANALYSIS}")
    ).fetchone()
    return (r.a, r.b) if r else (None, None)


def resolve_window(db: Session, from_date: date | None, to_date: date | None) -> dict:
    """Intersect the caller's range with the range the register actually covers.

    The section follows the dashboard's global date filter and only that. Where
    the filter overlaps the register the overlap is shown, and `clamped` says so
    — picking August to October shows August, which is the filter's own data.

    Where there is NO overlap the section reports empty. It deliberately does
    NOT substitute another period. An earlier version fell back to the whole
    register, which meant a September filter quietly rendered April-to-August
    figures under a September heading; the banner said so but the numbers were
    read first. Showing nothing and naming the register's range is the honest
    answer to "what happened in September" when the register has no September.
    """
    lo, hi = data_extent(db)
    if lo is None:
        return {
            "from": None, "to": None, "extent_from": None, "extent_to": None,
            "clamped": False, "no_overlap": False, "empty": True,
        }
    rf, rt = from_date or lo, to_date or hi
    f, t = max(rf, lo), min(rt, hi)
    if f > t:
        # Outside the register entirely — report the request back so the UI can
        # say which period was asked for and which period exists.
        return {
            "from": None, "to": None, "extent_from": lo, "extent_to": hi,
            "requested_from": rf, "requested_to": rt,
            "clamped": False, "no_overlap": True, "empty": True,
        }
    return {
        "from": f, "to": t, "extent_from": lo, "extent_to": hi,
        "requested_from": rf, "requested_to": rt,
        "clamped": (rf, rt) != (f, t),
        "no_overlap": False, "empty": False,
    }


# -- data access --------------------------------------------------------------
def _records(db: Session, f: date, t: date) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT a.id, a.notification_no, a.equipment_desc, a.breakdown_date,
               a.shift, a.breakdown_start_time, a.breakdown_duration_hr,
               a.total_cost, a.breakdown_description, a.immediate_action,
               a.rca_category, a.rca_sub_category, a.problem_who,
               TRIM(COALESCE(w.why1_a, '')) AS why1,
               TRIM(COALESCE(w.why2_a, '')) AS why2,
               TRIM(COALESCE(w.why3_a, '')) AS why3,
               TRIM(COALESCE(w.why4_a, '')) AS why4,
               TRIM(COALESCE(w.why5_a, '')) AS why5,
               TRIM(COALESCE(w.why1_q, '')) AS why1q,
               TRIM(COALESCE(w.why2_q, '')) AS why2q,
               TRIM(COALESCE(w.why3_q, '')) AS why3q,
               TRIM(COALESCE(w.why4_q, '')) AS why4q,
               TRIM(COALESCE(w.why5_q, '')) AS why5q,
               TRIM(COALESCE(w.item_examined, '')) AS item_examined,
               TRIM(COALESCE(w.final_verdict, '')) AS verdict
        FROM {ANALYSIS} a
        LEFT JOIN {ROWS} w ON w.whywhy_id = a.id
        WHERE a.breakdown_date >= :f AND a.breakdown_date <= :t
    """), {"f": f, "t": t}).fetchall()
    return [dict(r._mapping) for r in rows]


def _engine_hours(db: Session, f: date, t: date) -> dict[str, float]:
    """Operating hours per machine, so breakdown COUNTS can become RATES.

    Two traps, both already paid for once in the Equipment section:

      * engine_hours is a TIME column, not a number. SUM()ing it directly yields
        nonsense in the millions; it has to go through TIME_TO_SEC()/3600.
      * report_date is a DATETIME stamped 23:45:59, so the range is half-open on
        the day after `t` — a BETWEEN drops the last day of every window.

    Rows are deduplicated on the latest tripDate per machine-day, matching the
    Equipment section exactly, so the two never disagree on a machine's hours.
    """
    t_next = t + timedelta(days=1)
    out: dict[str, float] = defaultdict(float)

    man = db.execute(text("""
        SELECT t.vehicle_desc AS m,
               COALESCE(SUM(TIME_TO_SEC(t.engine_hours) / 3600.0), 0) AS h
        FROM mines_technoton_man_utilization t
        JOIN (SELECT vehicle_desc, report_date, MAX(tripDate) AS mx
                FROM mines_technoton_man_utilization
               WHERE report_date >= :f AND report_date < :t_next
               GROUP BY vehicle_desc, report_date) d
          ON d.vehicle_desc = t.vehicle_desc AND d.report_date = t.report_date
         AND d.mx = t.tripDate
        WHERE t.report_date >= :f AND t.report_date < :t_next
        GROUP BY t.vehicle_desc
    """), {"f": f, "t_next": t_next}).fetchall()
    for r in man:
        name = r.m or ""
        if name.startswith("MAN") and name[3:].isdigit():
            name = f"MAN-{name[3:]}"
        out[_machine_key(name)] += _f(r.h)

    rest = db.execute(text("""
        SELECT t.vehicle_desc AS m,
               COALESCE(SUM(TIME_TO_SEC(t.engine_hours) / 3600.0), 0) AS h
        FROM mines_technoton_rest_equipment_utilization t
        JOIN (SELECT vehicle_desc, report_date, MAX(tripDate) AS mx
                FROM mines_technoton_rest_equipment_utilization
               WHERE report_date >= :f AND report_date < :t_next
               GROUP BY vehicle_desc, report_date) d
          ON d.vehicle_desc = t.vehicle_desc AND d.report_date = t.report_date
         AND d.mx = t.tripDate
        WHERE t.report_date >= :f AND t.report_date < :t_next
        GROUP BY t.vehicle_desc
    """), {"f": f, "t_next": t_next}).fetchall()
    for r in rest:
        out[_machine_key(EXCAVATOR_SAP.get(r.m or "", r.m or ""))] += _f(r.h)

    return dict(out)


# -- analysis points ----------------------------------------------------------
def _headline(recs: list[dict], hours: dict[str, float]) -> dict:
    dur = [_f(r["breakdown_duration_hr"]) for r in recs]
    cost = [_f(r["total_cost"]) for r in recs]
    pairs = Counter(
        (_machine_key(r["equipment_desc"]), _norm(r["breakdown_description"]))
        for r in recs if _norm(r["breakdown_description"])
    )
    repeats = sum(n for n in pairs.values() if n > 1)
    graded = sum(1 for r in recs if r["rca_category"])
    return {
        "breakdowns": len(recs),
        "machines": len({_machine_key(r["equipment_desc"]) for r in recs}),
        "breakdown_hours": round(sum(dur), 1),
        "avg_hours": round(sum(dur) / len(recs), 2) if recs else None,
        "repair_cost": round(sum(cost), 0),
        "repair_cost_rows": sum(1 for c in cost if c > 0),
        "operating_hours": round(sum(hours.values()), 1) if hours else None,
        "repeat_events": repeats,
        "repeat_pct": round(100 * repeats / len(recs), 1) if recs else None,
        "cause_recorded_pct": round(100 * graded / len(recs), 1) if recs else None,
    }


def _by_month(recs: list[dict]) -> list[dict]:
    g: dict[str, list[dict]] = defaultdict(list)
    for r in recs:
        g[r["breakdown_date"].strftime("%Y-%m")].append(r)
    return [
        {
            "month": m,
            "breakdowns": len(v),
            "hours": round(sum(_f(x["breakdown_duration_hr"]) for x in v), 1),
            "cost": round(sum(_f(x["total_cost"]) for x in v), 0),
        }
        for m, v in sorted(g.items())
    ]


def _by_machine(recs: list[dict], hours: dict[str, float], limit: int = 12) -> list[dict]:
    g: dict[str, list[dict]] = defaultdict(list)
    for r in recs:
        g[_machine_key(r["equipment_desc"])].append(r)
    out = []
    for m, v in g.items():
        h = hours.get(m)
        out.append({
            "machine": m,
            "breakdowns": len(v),
            "hours": round(sum(_f(x["breakdown_duration_hr"]) for x in v), 1),
            "cost": round(sum(_f(x["total_cost"]) for x in v), 0),
            "operating_hours": round(h, 1) if h else None,
            # Null rather than a misleading figure when the machine barely ran.
            "per_100_hours": round(100 * len(v) / h, 2)
            if h and h >= MIN_HOURS_FOR_RATE else None,
            "top_failure": Counter(
                family_of(x["breakdown_description"]) for x in v
            ).most_common(1)[0][0],
        })
    out.sort(key=lambda d: (d["per_100_hours"] is None,
                            -(d["per_100_hours"] or 0), -d["breakdowns"]))
    return out[:limit]


def _share(counter: Counter, total: int) -> list[dict]:
    return [
        {"label": k, "count": n, "pct": round(100 * n / total, 1) if total else None}
        for k, n in counter.most_common()
    ]


def _failure_modes(recs: list[dict]) -> dict:
    fam = Counter(family_of(r["breakdown_description"]) for r in recs)
    raw = Counter(
        _norm(r["breakdown_description"]) for r in recs if _norm(r["breakdown_description"])
    )
    cost_by_fam: dict[str, float] = defaultdict(float)
    for r in recs:
        cost_by_fam[family_of(r["breakdown_description"])] += _f(r["total_cost"])
    fams = _share(fam, len(recs))
    for fm in fams:
        fm["cost"] = round(cost_by_fam[fm["label"]], 0)
    # How few families it takes to cover most of the register — the Pareto claim,
    # computed rather than asserted.
    run, covers = 0, 0
    for fm in fams:
        run += fm["count"]
        covers += 1
        if run >= 0.8 * len(recs):
            break
    return {
        "families": fams,
        "families_to_80pct": covers,
        "top_defects": [{"label": k, "count": n} for k, n in raw.most_common(10)],
    }


def _root_causes(recs: list[dict]) -> dict:
    known = [r for r in recs if r["rca_category"]]
    cat = Counter(r["rca_category"] for r in known)
    cost: dict[str, float] = defaultdict(float)
    hrs: dict[str, float] = defaultdict(float)
    for r in known:
        cost[r["rca_category"]] += _f(r["total_cost"])
        hrs[r["rca_category"]] += _f(r["breakdown_duration_hr"])
    out = _share(cat, len(known))
    for o in out:
        n = o["count"]
        o["cost"] = round(cost[o["label"]], 0)
        o["hours"] = round(hrs[o["label"]], 1)
        o["cost_per_event"] = round(cost[o["label"]] / n, 0) if n else None
    return {"categories": out, "recorded": len(known), "missing": len(recs) - len(known)}


def _timing(recs: list[dict]) -> dict:
    hour: Counter = Counter()
    for r in recs:
        t = r["breakdown_start_time"]
        if t is None:
            continue
        secs = t.seconds if hasattr(t, "seconds") else None
        if secs is not None:
            hour[secs // 3600] += 1
    peaks = [h for h, _ in hour.most_common(3)]
    return {
        "by_shift": _share(Counter(r["shift"] for r in recs if r["shift"]), len(recs)),
        "by_hour": [{"hour": h, "count": hour.get(h, 0)} for h in range(24)],
        "peak_hours": sorted(peaks),
    }


def _repeats(recs: list[dict], limit: int = 12) -> list[dict]:
    g: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in recs:
        d = _norm(r["breakdown_description"])
        if d:
            g[(_machine_key(r["equipment_desc"]), d)].append(r)
    out = [
        {
            "machine": m, "defect": d, "count": len(v),
            "hours": round(sum(_f(x["breakdown_duration_hr"]) for x in v), 1),
            "cost": round(sum(_f(x["total_cost"]) for x in v), 0),
            "last": max(x["breakdown_date"] for x in v).isoformat(),
        }
        for (m, d), v in g.items() if len(v) > 1
    ]
    out.sort(key=lambda x: (-x["count"], -x["hours"]))
    return out[:limit]


def _watchlist(recs: list[dict], as_of: date, limit: int = 10) -> list[dict]:
    """Next occurrence implied by the mean interval between past occurrences.

    This is a pattern projection, not a prediction: it says a defect that has
    recurred on a regular cadence is due again, nothing more. Dispersion is
    returned alongside so a wide, irregular gap is visibly weak evidence, and a
    pattern silent for more than twice its mean gap is reported as apparently
    stopped rather than ever more overdue.
    """
    g: dict[tuple[str, str], list[date]] = defaultdict(list)
    for r in recs:
        d = _norm(r["breakdown_description"])
        if d:
            g[(_machine_key(r["equipment_desc"]), d)].append(r["breakdown_date"])
    out = []
    for (m, d), ds in g.items():
        if len(ds) < MIN_EVENTS_FOR_PROJECTION:
            continue
        ds = sorted(ds)
        gaps = [(b - a).days for a, b in zip(ds, ds[1:])]
        gaps = [x for x in gaps if x > 0]
        if not gaps:
            continue
        mean = sum(gaps) / len(gaps)
        sd = statistics.pstdev(gaps) if len(gaps) > 1 else 0.0
        since = (as_of - ds[-1]).days
        due = round(mean - since)
        state = ("held" if since > 2 * mean
                 else "due" if due <= 0
                 else "soon" if due <= max(7, 0.25 * mean)
                 else "watch")
        out.append({
            "machine": m, "defect": d, "events": len(ds),
            "mean_gap_days": round(mean), "sd_days": round(sd),
            "last": ds[-1].isoformat(), "days_since": since,
            "due_in_days": due, "state": state,
        })
    order = {"due": 0, "soon": 1, "watch": 2, "held": 3}
    out.sort(key=lambda x: (order[x["state"]], x["due_in_days"]))
    return out[:limit]


def _operators(recs: list[dict], limit: int = 15) -> dict:
    named = [r for r in recs if (r["problem_who"] or "").strip() not in ("", "-")]
    c = Counter((r["problem_who"] or "").strip().upper() for r in named)
    rows = []
    for name, n in c.most_common(limit):
        mine = [r for r in named if (r["problem_who"] or "").strip().upper() == name]
        rows.append({
            "operator": name, "events": n,
            "machines": sorted({_machine_key(r["equipment_desc"]) for r in mine}),
            "causes": _share(Counter(r["rca_category"] for r in mine if r["rca_category"]), n),
            "cost": round(sum(_f(r["total_cost"]) for r in mine), 0),
            # The breakdowns themselves, newest first, so a name can be opened
            # and read rather than only counted. A bare count invites the
            # ranking this data cannot support; the events show what actually
            # happened, and usually show the cause was nothing to do with the
            # person who happened to be on the machine.
            "breakdowns": [
                {
                    "date": r["breakdown_date"].isoformat() if r["breakdown_date"] else None,
                    "shift": r["shift"],
                    "machine": _machine_key(r["equipment_desc"]),
                    "defect": (r["breakdown_description"] or "").strip() or None,
                    "family": family_of(r["breakdown_description"]),
                    "cause": r["rca_category"],
                    "hours": round(_f(r["breakdown_duration_hr"]), 1),
                    "cost": round(_f(r["total_cost"]), 0),
                    "notification_no": r["notification_no"],
                    "why_chain": _why_chain(r),
                }
                for r in sorted(
                    mine,
                    key=lambda x: (x["breakdown_date"] is None, x["breakdown_date"]),
                    reverse=True,
                )
            ],
        })
    blamed = sum(1 for r in named if (r["rca_category"] or "") == "Operator Error")
    return {
        "named_events": len(named),
        "unnamed_events": len(recs) - len(named),
        "distinct": len(c),
        "max_events": c.most_common(1)[0][1] if c else 0,
        "operator_error_events": blamed,
        "top": rows,
        # Carried as data, not left to the UI to remember.
        "caveat": (
            "Counts of events a person was present for, not a fault rate. There "
            "is no operator-hours denominator anywhere in the source systems, so "
            "these cannot be normalised and must not be read as a ranking. Only "
            f"{blamed} of {len(named)} named events carry a cause of operator "
            "error — being named records presence, not blame."
        ),
    }


def _completeness(recs: list[dict]) -> dict:
    n = len(recs) or 1

    def filled(v) -> bool:
        return (v or "").strip() not in ("", "-") if isinstance(v, str) else v is not None

    def pct(fn) -> float:
        return round(100 * sum(1 for r in recs if fn(r)) / n, 1)

    return {
        "records": len(recs),
        "fields": [
            {"field": "Notification no", "pct": pct(lambda r: filled(r["notification_no"]))},
            {"field": "Defect noted", "pct": pct(lambda r: filled(r["breakdown_description"]))},
            {"field": "Root cause", "pct": pct(lambda r: filled(r["rca_category"]))},
            {"field": "5-Why answers", "pct": pct(lambda r: filled(r["why1"]))},
            {"field": "Operator named", "pct": pct(lambda r: filled(r["problem_who"]))},
            {"field": "Duration", "pct": pct(lambda r: _f(r["breakdown_duration_hr"]) > 0)},
            {"field": "Repair cost", "pct": pct(lambda r: _f(r["total_cost"]) > 0)},
        ],
        # Stated rather than silently absent: an empty column is a finding.
        "not_recorded": [
            "Production loss cost — zero on every row, so breakdown cost cannot be "
            "weighed against lost output inside this register.",
            "Spare vs labour split — both zero; only a combined total_cost exists.",
            "Operator hours — absent from every source system, so operator event "
            "counts cannot become rates.",
        ],
    }



# A machine needs a handful of events before its own Pareto says anything: with
# one failure, that failure is 100% of the chart. This no longer HIDES a machine
# — hiding them meant a single-month filter showed 2 of 25 machines and looked
# broken — it only decides whether a concentration verdict is offered for it.
MIN_EVENTS_FOR_MACHINE_PARETO = 4

# Which recorded cause counts as an operating problem rather than a mechanical
# one. Kept as a set so a future taxonomy change is one edit, not a grep.
OPERATOR_CAUSES = {"Operator Error"}


def _machine_breakdown(recs: list[dict]) -> list[dict]:
    """Per machine: its own failure-mode Pareto and its own cause split.

    The fleet-wide Pareto says tyres are the biggest failure mode; it does not
    say that tyres are almost entirely a tipper problem and that the excavators
    fail hydraulically instead. Aggregating hides exactly the thing a maintenance
    plan needs, because the plan is written per machine.

    Ordered by breakdown count rather than by rate: this table answers "what is
    wrong with this machine", and the rate table above already answers "which
    machine is worst".

    EVERY machine that broke down appears. An earlier version required four
    events and returned only the top ten, which was calibrated against the full
    five-month register; on a one-month filter it showed 2 machines out of 25
    and read as a bug rather than as a threshold. A machine with two failures
    still has two failures worth seeing. What the event count now governs is
    only whether a concentration verdict is offered — `enough_for_pareto` — so
    a thin machine is shown without a shape being claimed for it.
    """
    g: dict[str, list[dict]] = defaultdict(list)
    for r in recs:
        g[_machine_key(r["equipment_desc"])].append(r)

    out = []
    for m, v in sorted(g.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        modes = _share(Counter(family_of(x["breakdown_description"]) for x in v), len(v))
        causes = _share(
            Counter(x["rca_category"] for x in v if x["rca_category"]),
            sum(1 for x in v if x["rca_category"]),
        )
        cost_by_mode: dict[str, float] = defaultdict(float)
        hrs_by_mode: dict[str, float] = defaultdict(float)
        for x in v:
            fam = family_of(x["breakdown_description"])
            cost_by_mode[fam] += _f(x["total_cost"])
            hrs_by_mode[fam] += _f(x["breakdown_duration_hr"])
        for mo in modes:
            mo["cost"] = round(cost_by_mode[mo["label"]], 0)
            mo["hours"] = round(hrs_by_mode[mo["label"]], 1)

        # How concentrated this machine's failures are. A machine whose top two
        # modes cover 80% has a fixable pattern; one spread across eight does not.
        run, top_n = 0, 0
        for mo in modes:
            run += mo["count"]
            top_n += 1
            if run >= 0.8 * len(v):
                break

        out.append({
            "machine": m,
            "breakdowns": len(v),
            "hours": round(sum(_f(x["breakdown_duration_hr"]) for x in v), 1),
            "cost": round(sum(_f(x["total_cost"]) for x in v), 0),
            "modes": modes,
            "causes": causes,
            "causes_recorded": sum(1 for x in v if x["rca_category"]),
            "modes_to_80pct": top_n,
            # Only meaningful once there are enough events for a shape to exist.
            "enough_for_pareto": len(v) >= MIN_EVENTS_FOR_MACHINE_PARETO,
            "concentrated": len(v) >= MIN_EVENTS_FOR_MACHINE_PARETO and top_n <= 2,
        })
    return out


def _problem_statement(r: dict) -> str:
    """One sentence saying what happened, from what was actually recorded.

    problem_what / _when / _where / _how are empty on every row in this
    register, so the statement is assembled from the fields that ARE filled:
    the machine, the date, the shift and the defect text. Nothing is inferred.
    """
    when = r["breakdown_date"].strftime("%d %b %Y") if r["breakdown_date"] else "date not recorded"
    shift = f", shift {r['shift']}" if r["shift"] else ""
    defect = (r["breakdown_description"] or "").strip() or "defect not described"
    return f"{_machine_key(r['equipment_desc'])} on {when}{shift}: {defect.title()}"


def _why_chain(r: dict) -> list[str]:
    return [r[f"why{i}"] for i in range(1, 6) if (r.get(f"why{i}") or "").strip()]



def _family_totals(issues: list[dict]) -> list[dict]:
    """Component groups with their hours and cost, not just a count.

    The generator was quoting totals it had worked out from the incident list —
    "478.5h, Rs 52,500" — which the number audit correctly flagged as figures it
    was never given. Giving it the real per-group totals removes the reason to
    compute, which works better than telling it not to.
    """
    hrs: dict[str, float] = defaultdict(float)
    cost: dict[str, float] = defaultdict(float)
    for r in issues:
        fam = family_of(r["breakdown_description"])
        hrs[fam] += _f(r["breakdown_duration_hr"])
        cost[fam] += _f(r["total_cost"])
    rows = _share(Counter(family_of(r["breakdown_description"]) for r in issues), len(issues))
    for x in rows:
        x["hours"] = round(hrs[x["label"]], 1)
        x["cost"] = round(cost[x["label"]], 0)
    return rows


def _operator_issues(recs: list[dict]) -> dict:
    """Breakdowns whose recorded cause is an operating error, stated in full.

    This is the input to training, so it carries the problem statement and the
    Why-chain rather than a count. A count tells you operator error is 24% of
    failures; it does not tell you that the failures are pins, bucket lugs and
    track chains, which is what a toolbox talk would have to cover.

    The operator name is carried where recorded but is NOT what selects a row —
    selection is on the recorded cause. Naming someone records presence.
    """
    issues = [r for r in recs if (r["rca_category"] or "") in OPERATOR_CAUSES]
    rows = []
    # Every operating-error breakdown, not a top slice. The cap was fine when
    # this fed a summary; it is wrong now that each breakdown gets its own
    # training topic, because 41 of 81 never reached the analysis.
    for r in sorted(issues, key=lambda x: -_f(x["total_cost"])):
        who = (r["problem_who"] or "").strip()
        rows.append({
            "id": r["id"],
            "notification_no": r["notification_no"],
            "machine": _machine_key(r["equipment_desc"]),
            "date": r["breakdown_date"].isoformat() if r["breakdown_date"] else None,
            "shift": r["shift"],
            "defect": (r["breakdown_description"] or "").strip(),
            "family": family_of(r["breakdown_description"]),
            "sub_category": (r["rca_sub_category"] or "").strip() or None,
            "operator": who if who not in ("", "-") else None,
            "problem_statement": _problem_statement(r),
            "why_chain": _why_chain(r),
            "hours": round(_f(r["breakdown_duration_hr"]), 1),
            "cost": round(_f(r["total_cost"]), 0),
        })
    named = sum(1 for r in issues if (r["problem_who"] or "").strip() not in ("", "-"))
    return {
        "events": len(issues),
        "named_events": named,
        "hours": round(sum(_f(r["breakdown_duration_hr"]) for r in issues), 1),
        "cost": round(sum(_f(r["total_cost"]) for r in issues), 0),
        "by_family": _family_totals(issues),
        "with_why_chain": sum(1 for r in issues if _why_chain(r)),
        "issues": rows,
    }


# -- production loss ----------------------------------------------------------
# The LCM section already values breakdown downtime as lost ore at the IBM
# plan-weighted rate, and that number is the mine's own. Recomputing it here
# with a different method would put two different rupee figures for the same
# thing on the same dashboard, so this reuses LCM's and only SPLITS it.
#
# Scope matters and is the reason this is not a naive allocation. LCM values ore
# loss against two machines only - TATA-470(7) and TATA-470(2), which the
# Why-Why register calls EX- 7 and EX-2 - and OB loss against three others. The
# rest of the fleet moves no ore, so breakdowns on them carry no ore loss no
# matter how long they last. Spreading the ore figure across all 38 machines
# would be arithmetically tidy and completely wrong.
#
# Within a scope the split is by SHARE of Why-Why breakdown hours, never by
# absolute hours. LCM's hours come from SAP and the register's come from the
# maintenance team, and the two disagree - 14,101 against 7,181 fleet-wide over
# the same notifications. Using shares means the parts always foot to LCM's
# total whichever hour basis is authoritative, which is still an open question
# for the mine to settle.
ORE_LOSS_MACHINES = {"EX- 7", "EX-2"}
OB_LOSS_MACHINES = {"EX- 5", "EX- 4", "EX- 8"}


def _allocate(recs: list[dict], amount: float | None, tonnes: float | None) -> dict:
    """Split one loss figure across the machines' failure modes and causes."""
    total_h = sum(_f(r["breakdown_duration_hr"]) for r in recs)
    if not recs or total_h <= 0 or amount is None:
        return {"by_machine": [], "by_mode": [], "by_cause": []}

    def group(key) -> list[dict]:
        acc: dict[str, dict] = defaultdict(lambda: {"hours": 0.0, "events": 0})
        for r in recs:
            k = key(r)
            if k is None:
                continue
            acc[k]["hours"] += _f(r["breakdown_duration_hr"])
            acc[k]["events"] += 1
        out = []
        for k, v in acc.items():
            share = v["hours"] / total_h
            out.append({
                "label": k,
                "events": v["events"],
                "hours": round(v["hours"], 1),
                "share_pct": round(share * 100, 1),
                "amount": round(amount * share, 0),
                "tonnes": round(tonnes * share, 1) if tonnes is not None else None,
            })
        out.sort(key=lambda x: -x["amount"])
        return out

    return {
        "by_machine": group(lambda r: _machine_key(r["equipment_desc"])),
        "by_mode": group(lambda r: family_of(r["breakdown_description"])),
        # "Not recorded" rather than dropped: a breakdown with no cause still
        # cost ore, and skipping it made the cause split miss its own total by
        # Rs 4.87 crore. An unattributable loss is a finding, not a rounding.
        "by_cause": group(lambda r: r["rca_category"] or "Not recorded"),
    }


# Breakdown production loss is COMPUTED BUT NOT SHOWN.
#
# Withheld on the user's instruction, 2026-09-22: the business has not yet
# signed off the costing, and a Rs 47.74 crore figure nobody can defend in a
# review is worse than no figure at all. The mechanism is sound - it reuses the
# LCM section's own valuation rather than inventing a second one - but the
# LCM method itself apportions the whole plan-vs-actual shortfall across every
# recorded loss hour, so the crore figure is an attribution, not a measurement.
# That is the part awaiting confirmation from the business users.
#
# Nothing is deleted. Flip this to True and the card returns, the narrative
# leads with the figure again, and the by-machine / by-mode / by-cause splits
# come back with it. The frontend already renders the card only when the API
# sends the block, so this one constant governs both.
SHOW_PRODUCTION_LOSS = False


def _production_loss(db: Session, f: date, t: date, recs: list[dict]) -> dict | None:
    """Breakdown production loss, taken from LCM and split by failure detail.

    Returns None rather than a zero if LCM cannot price the period - a missing
    IBM rate makes the whole column null there, and a zero here would read as
    "no loss" when it means "not priced".
    """
    try:
        from app.services import lcm as lcm_svc

        res = lcm_svc.get_lcm(db, f, t)
    except Exception:
        return None

    head = next((r for r in res.get("rows", [])
                 if "breakdown" in (r.get("loss_description") or "").lower()
                 and "preventive" not in (r.get("loss_description") or "").lower()), None)
    if head is None or head.get("loss_amount") is None:
        return None

    costing = res.get("costing") or {}
    totals = res.get("totals") or {}
    ore_recs = [r for r in recs if _machine_key(r["equipment_desc"]) in ORE_LOSS_MACHINES]
    ob_recs = [r for r in recs if _machine_key(r["equipment_desc"]) in OB_LOSS_MACHINES]
    repair = sum(_f(r["total_cost"]) for r in recs)

    return {
        "amount": head["loss_amount"],
        "tonnes": head.get("planned_ore_loss"),
        "loss_hours": head.get("ore_hours"),
        "ob_volume_cum": head.get("planned_ob_loss"),
        "share_of_all_loss_pct": head.get("loss_share_pct"),
        "loss_type": head.get("loss_type"),
        "rate_per_mt": costing.get("weighted_rate"),
        "rate_source": costing.get("source"),
        "lcm_total_loss": totals.get("loss_amount"),
        "repair_cost": round(repair, 0),
        # The comparison the whole section exists to make: what the breakdown
        # cost to fix against what it cost in ore never mined.
        "times_repair_cost": round(head["loss_amount"] / repair, 0) if repair > 0 else None,
        "ore_machines": sorted(ORE_LOSS_MACHINES),
        "ore_machine_events": len(ore_recs),
        "ob_machine_events": len(ob_recs),
        "allocation": _allocate(ore_recs, head["loss_amount"], head.get("planned_ore_loss")),
        "basis": (
            "Valued by the LCM section at the IBM plan-weighted rate, not "
            "recomputed here, so the two pages cannot disagree. Ore loss is "
            "scoped to the machines LCM prices it against - the rest of the "
            "fleet moves no ore - and split within them by each failure's share "
            "of Why-Why breakdown hours."
        ),
    }

# -- public -------------------------------------------------------------------
def compute_whywhy(db: Session, from_date: date | None, to_date: date | None) -> dict:
    """Every analysis point for the window, ready to chart and ready to narrate."""
    win = resolve_window(db, from_date, to_date)
    if win["empty"]:
        return {
            "window": {k: (v.isoformat() if isinstance(v, date) else v)
                       for k, v in win.items()},
            "headline": None, "months": [], "machines": [],
            "failure_modes": None, "root_causes": None, "timing": None,
            "repeats": [], "watchlist": [], "operators": None,
            "production_loss": None,
            "machine_detail": [], "operator_issues": None, "completeness": None,
        }

    f, t = win["from"], win["to"]
    recs = _records(db, f, t)
    try:
        hours = _engine_hours(db, f, t)
    except Exception:
        # The rate denominator is a bonus, not the analysis. If the GPS tables are
        # unavailable the counts still stand, so this must never fail the section.
        hours = {}

    return {
        "window": {k: (v.isoformat() if isinstance(v, date) else v) for k, v in win.items()},
        "headline": _headline(recs, hours),
        "months": _by_month(recs),
        "machines": _by_machine(recs, hours),
        "failure_modes": _failure_modes(recs),
        "root_causes": _root_causes(recs),
        "timing": _timing(recs),
        "repeats": _repeats(recs),
        "watchlist": _watchlist(recs, t),
        "operators": _operators(recs),
        "production_loss": (
            _production_loss(db, f, t, recs) if SHOW_PRODUCTION_LOSS else None
        ),
        "machine_detail": _machine_breakdown(recs),
        "operator_issues": _operator_issues(recs),
        "completeness": _completeness(recs),
    }



# -- register -----------------------------------------------------------------
def _why_pairs(r: dict) -> list[dict]:
    """The 5-Why ladder as question/answer pairs, in order, skipping blanks."""
    out = []
    for i in range(1, 6):
        q = (r.get(f"why{i}q") or "").strip()
        a = (r.get(f"why{i}") or "").strip()
        if q or a:
            out.append({"level": i, "question": q or None, "answer": a or None})
    return out


def breakdown_register(db: Session, from_date: date | None, to_date: date | None) -> dict:
    """Every breakdown in the window, with its Why-Why ladder and recorded cause.

    Served from its own endpoint rather than folded into /why-why. The analysis
    payload is read on every date change and must stay small; this is 143 KB for
    345 records and is only wanted when somebody opens the register. Filtering
    happens in the browser once it is loaded — 345 rows is nothing to filter
    client-side, and it avoids a round trip per keystroke.

    Rows carry what was recorded and nothing inferred. Where the 5-Why is
    missing the row still appears: 198 of 345 have no ladder, and hiding them
    would misrepresent the register as better documented than it is.
    """
    win = resolve_window(db, from_date, to_date)
    if win["empty"]:
        return {
            "window": {k: (v.isoformat() if isinstance(v, date) else v)
                       for k, v in win.items()},
            "rows": [], "machines": [], "causes": [], "families": [],
            "with_why": 0, "without_why": 0,
        }

    recs = _records(db, win["from"], win["to"])
    rows = []
    for r in recs:
        pairs = _why_pairs(r)
        rows.append({
            "id": r["id"],
            "notification_no": r["notification_no"],
            "date": r["breakdown_date"].isoformat() if r["breakdown_date"] else None,
            "shift": r["shift"],
            "machine": _machine_key(r["equipment_desc"]),
            "equipment_desc": r["equipment_desc"],
            "defect": (r["breakdown_description"] or "").strip() or None,
            "family": family_of(r["breakdown_description"]),
            "cause": r["rca_category"],
            "cause_detail": (r["rca_sub_category"] or "").strip() or None,
            "component": (r.get("item_examined") or "").strip() or None,
            "operator": ((r["problem_who"] or "").strip() or None)
                        if (r["problem_who"] or "").strip() != "-" else None,
            "hours": round(_f(r["breakdown_duration_hr"]), 1),
            "cost": round(_f(r["total_cost"]), 0),
            "why": pairs,
            "root_cause": (r.get("verdict") or "").strip() or None,
        })
    # Newest first: the register is read to check recent events far more often
    # than to browse April.
    rows.sort(key=lambda x: (x["date"] or "", x["id"]), reverse=True)

    with_why = sum(1 for x in rows if x["why"])
    return {
        "window": {k: (v.isoformat() if isinstance(v, date) else v)
                   for k, v in win.items()},
        "rows": rows,
        # Facets for the filter controls, built from what is actually present so
        # the dropdowns never offer an option that returns nothing.
        "machines": sorted({x["machine"] for x in rows}),
        "causes": sorted({x["cause"] for x in rows if x["cause"]}),
        "families": sorted({x["family"] for x in rows}),
        "with_why": with_why,
        "without_why": len(rows) - with_why,
    }

# -- narrative ----------------------------------------------------------------
# The model is handed FIGURES, never rows. Everything below exists to make that
# true, and to make a wrong answer obvious when it happens.
SYSTEM_PROMPT = (
    "You are a reliability engineer reviewing breakdown data for a chrome ore "
    "mine in Odisha, India. You are given figures that have already been "
    "computed from the maintenance register.\n\n"
    "RULES, in order of importance:\n"
    "1. Use ONLY the figures given. Never invent, estimate or extrapolate a "
    "number. If something is not in the figures, say it is not recorded.\n"
    "2. Quote figures exactly as given, with their units. Never strengthen "
    "a qualifier: 'mostly' is not 'all', and 'suggests' is not 'proves'.\n"
    "3. Operator event counts are NOT a performance ranking. There is no "
    "operator-hours denominator, so never rank, blame or compare operators.\n"
    "4. Write for a general manager, not an engineer. Short sentences. No "
    "jargon, no bullet padding, no restating the question.\n"
    "5. Say what the data supports and stop. Where evidence is weak, say so."
)

NARRATIVE_SECTIONS = [
    ("findings", "FINDINGS",
     "The 3 most important things this data shows. Write each as a short "
     "paragraph of 2-3 sentences that leads with the figure and then says what "
     "it means. Do not number them and do not write them as a list."),
    ("risks", "RISKS",
     "The 3 biggest reliability risks implied. One sentence each, on its own "
     "line. Do not number them."),
    # A pipe-delimited line rather than prose: the UI splits on it to render a
    # table, and a hyphen separator collides with hyphenated machine names. The
    # worked example is there because the format alone was not enough - the
    # model first returned the literal word "Action" as the opening field.
    ("actions", "ACTIONS",
     "4 specific actions, one per line, in exactly this format with two pipe "
     "characters and nothing else:\n"
     "<what to do> | <owner> | <what in the data triggers it>\n"
     "Example: Pressure-test and reseal the hydraulic circuits on EX-7 and "
     "EX-2 | Head Engineering | 47 hydraulic failures, the top mode on both "
     "machines\n"
     "Owner must be exactly one of: Head Engineering, Head Mines Operation, "
     "MPICC. Do not number the lines and do not write the word Action."),
    ("gaps", "GAPS",
     "What the register still cannot answer, and what recording it would "
     "unlock. 2-3 sentences."),
]

def _facts_block(d: dict) -> str:
    """The computed figures, flattened to text. This is the model's entire world."""
    h, w = d["headline"], d["window"]
    L: list[str] = [
        f"PERIOD {w['from']} to {w['to']} "
        f"(register covers {w['extent_from']} to {w['extent_to']})",
        f"BREAKDOWNS {h['breakdowns']} across {h['machines']} machines",
        f"DOWNTIME {h['breakdown_hours']} hours lost, "
        f"average {h['avg_hours']} hours per breakdown",
        f"OPERATING HOURS {h['operating_hours']} (from GPS telematics)",
        f"REPAIR COST Rs {h['repair_cost']:,.0f} recorded on "
        f"{h['repair_cost_rows']} of {h['breakdowns']} breakdowns",
        f"REPEAT FAILURES {h['repeat_events']} events ({h['repeat_pct']}%) are a "
        f"machine failing the same way again",
    ]
    # None while SHOW_PRODUCTION_LOSS is off, so the model is never told the
    # rupee figure and cannot lead with a number the business has not signed off.
    pl = d.get("production_loss")
    if pl:
        L += [
            "",
            f"PRODUCTION LOSS FROM BREAKDOWN Rs {pl['amount']:,.0f} "
            f"({pl['tonnes']} MT of ore not mined, valued at Rs "
            f"{pl['rate_per_mt']:,.0f} per MT), which is "
            f"{pl['share_of_all_loss_pct']}% of ALL production loss at the mine "
            f"and {pl['times_repair_cost']} times the Rs {pl['repair_cost']:,.0f} "
            f"repair bill. Ore loss is carried by "
            f"{', '.join(pl['ore_machines'])} only - no other machine moves ore.",
        ]
        if pl["allocation"]["by_mode"]:
            L += ["  split by failure mode:"]
            L += [f"    {x['label']}: Rs {x['amount']:,.0f} ({x['share_pct']}%, "
                  f"{x['events']} events)" for x in pl["allocation"]["by_mode"][:5]]
        if pl["allocation"]["by_cause"]:
            L += ["  split by root cause:"]
            L += [f"    {x['label']}: Rs {x['amount']:,.0f} ({x['share_pct']}%)"
                  for x in pl["allocation"]["by_cause"]]
    L += [
        "",
        f"ROOT CAUSE (recorded on {d['root_causes']['recorded']} of {h['breakdowns']}):",
    ]
    for c in d["root_causes"]["categories"]:
        L.append(
            f"  {c['label']}: {c['count']} events ({c['pct']}%), {c['hours']} hrs, "
            f"Rs {c['cost']:,.0f} total, Rs {c['cost_per_event']:,.0f} per event"
        )

    L += ["", f"FAILURE MODES ({d['failure_modes']['families_to_80pct']} families "
              f"cover 80% of breakdowns):"]
    for f in d["failure_modes"]["families"][:6]:
        L.append(f"  {f['label']}: {f['count']} ({f['pct']}%), Rs {f['cost']:,.0f}")

    L += ["", "WORST MACHINES by breakdowns per 100 operating hours:"]
    for m in d["machines"][:6]:
        rate = f"{m['per_100_hours']} per 100 hrs" if m["per_100_hours"] else "rate not available"
        L.append(
            f"  {m['machine']}: {m['breakdowns']} breakdowns, {rate}, "
            f"{m['operating_hours']} operating hrs, mostly {m['top_failure']}"
        )

    L += ["", "MONTHLY:"]
    for m in d["months"]:
        L.append(f"  {m['month']}: {m['breakdowns']} breakdowns, {m['hours']} hrs, "
                 f"Rs {m['cost']:,.0f}")

    L += ["", "RECURRING DEFECTS (same machine, same failure):"]
    for r in d["repeats"][:6]:
        L.append(f"  {r['machine']} - {r['defect']}: {r['count']} times, {r['hours']} hrs")

    if d["watchlist"]:
        L += ["", "PATTERN PROJECTION (mean interval between past occurrences; "
                  "a cadence, not a prediction):"]
        for x in d["watchlist"][:5]:
            L.append(
                f"  {x['machine']} - {x['defect']}: {x['events']} events, every "
                f"{x['mean_gap_days']}d +/-{x['sd_days']}d, last {x['last']}, "
                f"status {x['state']}"
            )

    t = d["timing"]
    L += ["", f"TIMING peak reporting hours {t['peak_hours']}; by shift " +
              ", ".join(f"{s['label']} {s['count']}" for s in t["by_shift"])]

    o = d["operators"]
    L += ["", f"OPERATORS {o['named_events']} events name a person, "
              f"{o['unnamed_events']} do not; {o['distinct']} distinct names, most "
              f"for any one person is {o['max_events']}. "
              f"{o['operator_error_events']} of the named events have cause "
              f"'Operator Error'.",
          f"  CAVEAT: {o['caveat']}"]

    L += ["", "NOT RECORDED AT ALL:"] + [f"  {x}" for x in d["completeness"]["not_recorded"]]
    L += ["", "FIELD COMPLETENESS: " +
              ", ".join(f"{f['field']} {f['pct']}%" for f in d["completeness"]["fields"])]
    return "\n".join(L)


def build_prompt(d: dict) -> str:
    spec = "\n".join(f"---{tag}---\n{desc}" for _, tag, desc in NARRATIVE_SECTIONS)
    return (
        f"{_facts_block(d)}\n\n"
        "Write the following sections, each preceded by its marker exactly as "
        "shown. Do not add any other text, headings or markers.\n\n"
        f"{spec}\n---END---"
    )


def _split_sections(raw: str) -> dict[str, str]:
    """Pull each marked section out, tolerating a model that drops one."""
    tags = [t for _, t, _ in NARRATIVE_SECTIONS] + ["END"]
    out: dict[str, str] = {}
    for (key, tag, _), nxt in zip(NARRATIVE_SECTIONS, tags[1:]):
        start = raw.find(f"---{tag}---")
        if start == -1:
            out[key] = ""
            continue
        start += len(tag) + 6
        end = raw.find(f"---{nxt}---", start)
        out[key] = (raw[start:end] if end != -1 else raw[start:]).strip()
    return out


_NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> set[str]:
    """Numeric tokens, comma-stripped and trailing-zero-normalised."""
    out = set()
    for raw in _NUM_RE.findall(text or ""):
        v = raw.replace(",", "")
        try:
            f = float(v)
        except ValueError:
            continue
        out.add(str(int(f)) if f == int(f) else str(f))
    return out


def audit_numbers(narrative: str, facts_text: str) -> list[str]:
    """Numbers in the prose that do not appear in the figures it was given.

    The model is instructed to quote figures verbatim and mostly does, but not
    always: asked about June it wrote "17 events" for operator error in one
    section and "15" in another, the first correct. A reader cannot catch that
    without the source numbers in front of them, so the drift is detected here
    and returned with the response rather than left to be believed.

    This flags, it does not correct. A figure listed here is unverified, not
    necessarily wrong - a legitimately derived number (a count of items in a
    list, a difference the model worked out) will also show up. It is a prompt
    for a second look, and a signal worth watching if it grows.
    """
    allowed = _numbers(facts_text)
    # Small integers are ordinals, list positions and section numbers far more
    # often than they are claims, and flagging them buries the real drift.
    return sorted(
        n for n in _numbers(narrative) - allowed
        if not (n.isdigit() and int(n) <= 12)
    )

async def generate_narrative(
    db: Session, from_date: date | None, to_date: date | None
) -> dict:
    """Ask BAL-AI to interpret the computed figures. Never to compute them.

    Returns the facts alongside the prose so the caller renders both from one
    response, and so any claim in the narrative can be checked against the
    numbers that produced it without a second request.
    """
    from openai import AsyncOpenAI

    from app.config import get_settings

    facts = compute_whywhy(db, from_date, to_date)
    if facts["headline"] is None or facts["headline"]["breakdowns"] == 0:
        return {
            "facts": facts,
            "sections": {k: "" for k, _, _ in NARRATIVE_SECTIONS},
            "model": None, "tokens": None, "generated_at": None,
            "unverified_numbers": [],
            "error": "No breakdown records in this period.",
        }

    prompt = build_prompt(facts)
    s = get_settings()
    client = AsyncOpenAI(
        base_url=s.qwen_base_url + "/v1", api_key=s.qwen_api_key, timeout=90.0
    )
    resp = await client.chat.completions.create(
        model=s.qwen_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,          # interpretation, not invention
        max_tokens=1600,          # thinking is off by default, so this is all answer
    )
    raw = resp.choices[0].message.content or ""
    return {
        "facts": facts,
        "sections": _split_sections(raw),
        # Every figure the prose states should have come from the block above.
        # Anything here did not - see audit_numbers.
        "unverified_numbers": audit_numbers(raw, prompt),
        "model": resp.model,
        "tokens": resp.usage.total_tokens if resp.usage else None,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "error": None,
    }


# -- training -----------------------------------------------------------------
# ONE TOPIC PER BREAKDOWN, not one per quarter.
#
# The earlier version grouped 81 operating-error breakdowns into five fleet-wide
# topics. Useful for a training calendar, useless at the row: it could not say
# why THIS failure happened or what THIS operator needed. The mine asked for the
# other thing — read the Why-Why of each operator-attributed breakdown, work out
# what the operator actually did, map that to a national qualification pack, and
# name the topic that would have prevented it.
#
# EVIDENCE IS NOT EVEN. Excavators carry a Why-Why on 100% of their
# operator-cause breakdowns; MAN trucks on 23%. So for an excavator the analysis
# reads the analysts' own chain, and for most MAN trucks it reads a defect string
# and a cause label. Both are produced, but every row says which it is —
# `basis: recorded | inferred` — because a topic derived from "CROSS BROKEN /
# MISS OPERATION" alone is an informed guess and must not be read as a finding.
TRAINING_SYSTEM = (
    "You are a mining training officer at a chrome ore mine in Odisha, India.\n\n"
    "For EACH breakdown you are given, all of which were attributed to operating "
    "error, you must:\n"
    "  1. state what the operator actually did or failed to do, from the "
    "Why-Why chain where one exists, or from the component and failure mode "
    "where it does not;\n"
    "  2. choose the ONE qualification pack from the list that covers that "
    "skill;\n"
    "  3. name the training topic that would have prevented this breakdown.\n\n"
    "RULES:\n"
    "1. Answer for every breakdown id you are given. Do not merge them, do not "
    "skip any, do not invent ids.\n"
    "2. REASON is about the operator's action, not the component's condition. "
    "'Bucket was side-loaded while prying rock' is a reason; 'bucket shell "
    "fatigued' is not.\n"
    "3. Where there is no Why-Why chain, say what the failure mode implies and "
    "keep it short. Do not manufacture detail you were not given.\n"
    "4. PACK must be an exact code from the list, or NONE. Never invent a code.\n"
    "5. TOPIC is a course title a coordinator could schedule — a noun phrase, "
    "not an instruction. 'Bucket Loading Technique and Load Limits' is a topic. "
    "'Do not side-load the bucket' is not.\n"
    "6. Do NOT name, rank or blame any operator. Train the skill, not the "
    "person.\n"
    "7. Quote no figures. This is about skills, not counts."
)

# One call per chunk. 25 breakdowns fit comfortably inside the context alongside
# the 60-pack catalogue, and a chunk that fails costs 25 rows rather than all 81.
TRAINING_CHUNK = 25


def skill_catalogue(limit: int = 60) -> list[dict]:
    """The national qualification packs the mine recognises, from MineHub.

    Optional on purpose: if the MineHub Postgres is unreachable the topics are
    still produced, just without a pack mapping. A training topic without an
    NSQF code is far more useful than no topic.
    """
    try:
        from sqlalchemy import text as _t

        from app.minehub_db import SessionLocal as PG

        db = PG()
        try:
            rows = db.execute(_t(
                "SELECT code, name, nsqf_level, category FROM skill "
                "WHERE status = 'ACTIVE' ORDER BY category, nsqf_level DESC, name"
            )).fetchall()
        finally:
            db.close()
        return [{"code": r[0], "name": r[1],
                 "nsqf": float(r[2]) if r[2] is not None else None,
                 "category": r[3]} for r in rows[:limit]]
    except Exception as exc:
        logger.warning("skill catalogue unavailable, topics carry no pack: %s", exc)
        return []


def _pack_block(packs: list[dict]) -> str:
    if not packs:
        return ("NO QUALIFICATION LIST IS AVAILABLE. Write PACK: NONE on every "
                "breakdown. Do not invent codes.")
    L = ["QUALIFICATION PACKS. Choose exactly one code per breakdown, or NONE:"]
    cat = None
    for p in packs:
        if p["category"] != cat:
            cat = p["category"]
            L.append(f"  [{cat}]")
        L.append(f"    {p['code']} | {p['name']} | NSQF {p['nsqf']}")
    return "\n".join(L)


def _incident_block(items: list[dict]) -> str:
    L = []
    for i in items:
        L.append(f"BREAKDOWN {i['id']}")
        L.append(f"  machine: {i['machine']}   defect: {i['defect']}   "
                 f"component group: {i['family']}")
        if i.get("component"):
            L.append(f"  component examined: {i['component']}")
        if i.get("sub_category"):
            L.append(f"  recorded as: {i['sub_category']}")
        if i["why_chain"]:
            for n, c in enumerate(i["why_chain"], 1):
                L.append(f"  Why {n}: {c}")
        else:
            L.append("  (no Why-Why chain recorded — infer from the failure mode)")
        L.append("")
    return "\n".join(L)


_PB_FIELD = re.compile(r"^(BREAKDOWN|REASON|PACK|TOPIC|OUTCOME)\s*:\s*(.*)$", re.I)


def _parse_per_breakdown(text: str, valid_codes: set[str]) -> dict[int, dict]:
    """Blocks keyed by breakdown id, with invented pack codes dropped."""
    out: dict[int, dict] = {}
    for block in re.split(r"^(?=BREAKDOWN\s*:)", text, flags=re.M | re.I):
        f: dict[str, str] = {}
        outcomes: list[str] = []
        for line in block.splitlines():
            m = _PB_FIELD.match(line.strip())
            if not m:
                continue
            k, v = m.group(1).lower(), m.group(2).strip()
            if k == "outcome":
                outcomes.append(v)
            else:
                f[k] = v
        raw_id = re.sub(r"[^0-9]", "", f.get("breakdown", ""))
        if not raw_id:
            continue
        pack_raw = f.get("pack", "")
        pack = None
        if pack_raw and pack_raw.strip().upper() not in ("NONE", "N/A", "-"):
            parts = [p.strip() for p in pack_raw.split("|")]
            if parts and parts[0] in valid_codes:
                pack = {"code": parts[0],
                        "name": parts[1] if len(parts) > 1 else "",
                        "nsqf": parts[2].replace("NSQF", "").strip() if len(parts) > 2 else ""}
        out[int(raw_id)] = {
            "reason": f.get("reason") or None,
            "topic": f.get("topic") or None,
            "pack": pack,
            "pack_claimed": pack_raw or None,
            "outcomes": outcomes,
        }
    return out


async def generate_training(
    db: Session, from_date: date | None, to_date: date | None
) -> dict:
    """A training topic for every operating-error breakdown in the window."""
    from openai import AsyncOpenAI

    from app.config import get_settings
    from app.services import websearch

    facts = compute_whywhy(db, from_date, to_date)
    issues = facts.get("operator_issues")
    if not issues or issues["events"] == 0:
        return {"period": facts["window"], "summary": None, "breakdowns": [],
                "packs": 0, "web": [], "model": None, "tokens": None,
                "generated_at": None, "error":
                "No breakdowns with a recorded operating-error cause in this period."}

    packs = skill_catalogue()
    valid = {p["code"] for p in packs}
    items = issues["issues"]

    web = await websearch.search(
        websearch.build_queries([x["label"] for x in issues["by_family"]],
                                [p["name"] for p in packs])
    ) if websearch.configured() else []
    ctx = websearch.as_context(web)

    st = get_settings()
    client = AsyncOpenAI(base_url=st.qwen_base_url + "/v1",
                         api_key=st.qwen_api_key, timeout=180.0)

    spec = (
        "For EVERY breakdown above, output one block in exactly this format, "
        "with a blank line between blocks and no other text:\n"
        "BREAKDOWN: <the id>\n"
        "REASON: <what the operator did or failed to do, one sentence>\n"
        "PACK: <exact code> | <exact title> | NSQF <level>   (or: PACK: NONE)\n"
        "TOPIC: <course title, 3-8 words, a noun phrase>\n"
        "OUTCOME: <one thing the attendee can do afterwards, starting with a verb>\n"
        "OUTCOME: <a second one>"
    )

    parsed: dict[int, dict] = {}
    tokens = 0
    model = None
    for k in range(0, len(items), TRAINING_CHUNK):
        chunk = items[k:k + TRAINING_CHUNK]
        prompt = (f"{_incident_block(chunk)}\n{_pack_block(packs)}\n\n"
                  + (f"{ctx}\n\n" if ctx else "") + spec)
        try:
            resp = await client.chat.completions.create(
                model=st.qwen_model,
                messages=[{"role": "system", "content": TRAINING_SYSTEM},
                          {"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=3600,
            )
            raw = resp.choices[0].message.content or ""
            parsed.update(_parse_per_breakdown(raw, valid))
            tokens += resp.usage.total_tokens if resp.usage else 0
            model = resp.model
        except Exception as exc:
            # A failed chunk costs its own rows, never the whole run.
            logger.warning("training chunk %d failed: %s", k // TRAINING_CHUNK, exc)

    rows = []
    for i in items:
        a = parsed.get(i["id"]) or {}
        rows.append({
            "id": i["id"],
            "notification_no": i["notification_no"],
            "date": i["date"], "shift": i["shift"],
            "machine": i["machine"], "defect": i["defect"],
            "family": i["family"], "component": i.get("component"),
            "hours": i["hours"], "cost": i["cost"],
            "why_chain": i["why_chain"],
            # Says how much the topic rests on. A chain is the analysts' own
            # words; without one the model is reading a defect string.
            "basis": "recorded" if i["why_chain"] else "inferred",
            "reason": a.get("reason"),
            "topic": a.get("topic"),
            "pack": a.get("pack"),
            "pack_claimed": a.get("pack_claimed"),
            "outcomes": a.get("outcomes") or [],
            "analysed": bool(a.get("topic")),
        })

    return {
        "period": facts["window"],
        "summary": {k: issues[k] for k in
                    ("events", "named_events", "hours", "cost", "by_family", "with_why_chain")},
        "breakdowns": rows,
        "analysed": sum(1 for r in rows if r["analysed"]),
        "recorded_basis": sum(1 for r in rows if r["basis"] == "recorded"),
        "packs": len(packs),
        "web": [{"title": h["title"], "url": h["url"]} for h in web],
        "model": model,
        "tokens": tokens or None,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "error": None,
    }
