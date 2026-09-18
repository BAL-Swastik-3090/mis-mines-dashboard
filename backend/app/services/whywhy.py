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

import re
import statistics
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

SCHEMA = "balmpicc"
ANALYSIS = f"{SCHEMA}.mpicc_whywhy_analysis"
ROWS = f"{SCHEMA}.mpicc_whywhy_rows"

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

    The dashboard's global date filter drives this section like every other, but
    the register is a retrospective bulk load covering a fixed span. Asking for a
    month outside it would render an empty section that looks broken rather than
    empty. So the requested range is clamped to the data, and when there is no
    overlap at all the full extent is returned with a flag saying so — the UI
    says which period it is showing instead of silently showing nothing.
    """
    lo, hi = data_extent(db)
    if lo is None:
        return {
            "from": None, "to": None, "extent_from": None, "extent_to": None,
            "clamped": False, "fell_back": False, "empty": True,
        }
    rf, rt = from_date or lo, to_date or hi
    f, t = max(rf, lo), min(rt, hi)
    fell_back = f > t
    if fell_back:
        f, t = lo, hi
    return {
        "from": f, "to": t, "extent_from": lo, "extent_to": hi,
        "requested_from": rf, "requested_to": rt,
        "clamped": (not fell_back) and ((rf, rt) != (f, t)),
        "fell_back": fell_back, "empty": False,
    }


# -- data access --------------------------------------------------------------
def _records(db: Session, f: date, t: date) -> list[dict]:
    rows = db.execute(text(f"""
        SELECT a.id, a.notification_no, a.equipment_desc, a.breakdown_date,
               a.shift, a.breakdown_start_time, a.breakdown_duration_hr,
               a.total_cost, a.breakdown_description, a.immediate_action,
               a.rca_category, a.rca_sub_category, a.problem_who,
               TRIM(COALESCE(w.why1_a, '')) AS why1
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


# -- public -------------------------------------------------------------------
def compute_whywhy(db: Session, from_date: date | None, to_date: date | None) -> dict:
    """Every analysis point for the window, ready to chart and ready to narrate."""
    win = resolve_window(db, from_date, to_date)
    if win["empty"]:
        return {
            "window": win, "headline": None, "months": [], "machines": [],
            "failure_modes": None, "root_causes": None, "timing": None,
            "repeats": [], "watchlist": [], "operators": None, "completeness": None,
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
        "completeness": _completeness(recs),
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
