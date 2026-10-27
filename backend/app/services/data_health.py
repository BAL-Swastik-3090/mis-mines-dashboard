"""Data health — how current is the data behind each screen.

A dashboard that shows a figure says nothing about whether that figure is
today's. Every section here reads a table somebody has to fill in, or a sync
that has to run, and when one stops the screen does not go blank: it goes on
showing the last day that did arrive, which reads exactly like a quiet day at
the mine. `mines_ev_equipment_tracking` last received a row on 8 July 2026 and
the Electric Vehicles screen never said so.

So each feed is asked one question — what is the latest date you hold — and the
answer is compared against the date it ought to hold.

── ONE REGISTRY, NOT A CHECK PER PAGE ───────────────────────────────────────
Every feed is declared once in FEEDS below, with the sections it serves. The
page banner, the sidebar dot and the Data Health page all read the same probe,
so they cannot disagree about whether something is late, and adding a feed is
one entry here rather than an edit in three places.

A SECTION IS NOT A TABLE. MIS Dashboard draws on a dozen feeds and they fall
behind independently; "MIS Dashboard is stale" tells nobody what to do. The
unit of the alert is therefore the feed, and a section's status is the worst of
the feeds it serves.

── TWO KINDS OF FEED, BECAUSE THEY FAIL IN OPPOSITE DIRECTIONS ──────────────
A DAILY feed is filled in arrears: yesterday's figures arrive this morning, so
it is late when its latest date is older than yesterday.

A PLAN feed is filled in advance and runs into the future, so "latest = today"
is not healthy, it means the plan runs out tonight. It is judged on how far
ahead it still reaches. Treating the two alike would flag every plan table as
three weeks late, every day, and the alerting would be ignored inside a week.

── WHAT IS DELIBERATELY NOT WATCHED ─────────────────────────────────────────
Weather is a live API with nothing to enter. Equipment 360, Organisation,
Capacity and Access Control hold master data with no daily cadence — a register
that did not change yesterday is not stale, it is simply unchanged. The
weighbridge, gate and shift tables hold a handful of pilot rows and are not in
daily use yet; registering them would produce an alert that is permanently red
and therefore permanently ignored. A section with no feed shows no banner,
which is the honest answer rather than a reassuring green tick.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MYSQL = "mysql"
MINEHUB = "minehub"

DAILY = "daily"
PLAN = "plan"

OK, WARN, STALE, UNKNOWN = "ok", "warn", "stale", "unknown"

# Worst-first, so a section's status is max() over its feeds by this order.
SEVERITY = {OK: 0, UNKNOWN: 1, WARN: 2, STALE: 3}

# -- WHAT DATE A FEED IS EXPECTED TO HOLD ------------------------------------
# Almost every screen reports the last day that has ENDED, so its feeds are
# expected to hold yesterday. That is reportDay() in frontend/src/lib/prevDay.ts
# and it is the default here.
#
# STOCK IS THE EXCEPTION, and not by oversight. A stock snapshot is filed at the
# START of a day and dated that day: the position left by yesterday's work is
# THIS MORNING's snapshot, which is why the Executive Summary asks for
# stock_as_on = report_day + 1. Judged against yesterday it would read healthy
# on a morning when nobody had filed -- the screen would be showing a day-old
# position while this said it was fine.
#
# Feeds that WRITE THEMSELVES as things happen are held to today for the same
# reason: yesterday's row is no evidence they are still running. A feed somebody
# fills in afterwards is not, because filling in yesterday's figures today is
# exactly what is supposed to happen.
YESTERDAY = "yesterday"
TODAY = "today"

# -- WHERE THE DATA COMES FROM -----------------------------------------------
# Asked for by name, and it changes who gets chased. A SAP feed that stops is an
# interface for IT to restart; a form that stops is a person at the mine who has
# not filled it in. The two share nothing but the symptom.
SAP = "sap"
ENTRY = "entry"
TELEMATICS = "telematics"
PLATFORM = "platform"

ORIGIN_LABEL = {
    SAP: "SAP (interfaced)",
    ENTRY: "Entered at the mine",
    TELEMATICS: "Telematics (automatic)",
    PLATFORM: "Platform (automatic)",
}


@dataclass(frozen=True)
class Feed:
    """One table whose freshness is worth reporting.

    `sections` are AppPage ids from the frontend's sidebar, so a feed serving
    four screens is declared once and appears on all four.

    EVERY FEED HERE MUST BE READ BY A LIVE QUERY. Three were not in the first
    version of this file: `mines_stock`, superseded by `mines_stock_entry`;
    `mines_cob_production_despatch`, retired when COB production moved to SAP;
    and `mines_daywise_rom_entry`, which survives only in a comment about a
    future AMIRA phase. Each was reported weeks behind -- true, and meaningless,
    because nothing on any screen reads them. An alert for a retired table
    teaches people to ignore the alerts.
    """
    key: str
    label: str
    sections: tuple[str, ...]
    source: str
    table: str
    date_col: str
    origin: str
    #: What this feed is, in one line, for whoever has to chase it.
    note: str
    kind: str = DAILY
    #: Which date this feed should hold -- see the block above.
    expects: str = YESTERDAY
    #: Days a feed may legitimately lag before it counts as late. Left at 0
    #: everywhere: a grace period granted in advance hides exactly the drift
    #: this exists to surface. Raise one only when the mine confirms that feed
    #: genuinely arrives later.
    grace_days: int = 0
    #: PLAN feeds only -- how far ahead the plan should still reach before it is
    #: worth warning that it is about to run out.
    horizon_days: int = 3


FEEDS: tuple[Feed, ...] = (
    # -- SAP, interfaced -----------------------------------------------------
    Feed("sap_production", "SAP production postings",
         ("executive-summary", "mis", "amira", "oee", "intelligence"),
         MYSQL, "pp_production", "POSTING_DATE", SAP,
         "Goods receipts for ore, OB and concentrate. Every production tonnage "
         "on the dashboard is this table, netted of its reversals."),
    Feed("sap_quality", "SAP quality inspection (assays)",
         ("executive-summary", "mis", "amira", "intelligence"),
         MYSQL, "pp_quality_inspection", "QLT_START_DATE", SAP,
         "Cr2O3, Cr/Fe, FeO and moisture, one row per characteristic. The lab "
         "files after the material moves, so a tonnage can be present a day or "
         "two before its grade is."),
    Feed("sap_despatch", "Despatch gate records",
         ("executive-summary", "mis", "amira", "intelligence"),
         MYSQL, "zsd_outbound_despatch", "GATEINDATE", SAP,
         "Outbound trips to Balasore and Jabamoyee, one row per truck."),
    Feed("sap_plant_output", "Ferrochrome plant output",
         ("executive-summary", "mis"),
         MYSQL, "pp_prod_order_confirmation", "POSTING_DATE", SAP,
         "Furnace order confirmations at Balasore and Jabamoyee."),
    Feed("sap_maintenance", "Maintenance and breakdown orders",
         ("oee",),
         MYSQL, "mm_plant_maint_calibration", "BASIC_START_DATE", SAP,
         "Breakdown hours for the five owned excavators. The hired machines are "
         "not in SAP -- their downtime comes from the tipper log."),

    # -- Entered at the mine -------------------------------------------------
    Feed("stock_entry", "Mine stock position",
         ("executive-summary", "mis"),
         MYSQL, "mines_stock_entry", "Stock_Date", ENTRY,
         "Filed each morning on the dashboard. A Stock_Date is the START of "
         "that day, so today's entry is what yesterday's work left behind -- "
         "which is why this one is expected to hold TODAY, not yesterday.",
         expects=TODAY),
    Feed("tipper_details", "Tipper and shift log",
         ("oee", "mis"),
         MYSQL, "mines_tipper_details", "Prod_date", ENTRY,
         "Running hours, idle reasons and breakdown per shift and location. "
         "Carries the downtime for the hired excavators."),
    Feed("excavation_actual", "Day-wise excavation - contractors",
         ("mis",),
         MYSQL, "mines_day_wise_excavation", "Prod_date", ENTRY,
         "The CONTRACTOR half of overburden. BAL's own OB comes from SAP and is "
         "not affected when this stops, so the OB section keeps showing a "
         "figure -- just a smaller one than the mine actually moved."),
    Feed("cob_samples", "COB plant sample analysis",
         ("mis",),
         MYSQL, "mines_cobp_sample_analysis", "Prod_date", ENTRY,
         "Feed, concentrate and tailings grades from the COB plant's own lab "
         "sheet."),
    Feed("dewatering", "Dewatering",
         ("mis", "intelligence"),
         MYSQL, "mines_dewatering_daily_data", "date", ENTRY,
         "Pump readings filed per area."),

    # -- Telematics, automatic -----------------------------------------------
    Feed("telematics_man", "Telematics - MAN tippers",
         ("oee", "mis"),
         MYSQL, "mines_technoton_man_utilization", "tripDate", TELEMATICS,
         "Trip-level fuel and utilisation from the on-board units. It writes as "
         "trips happen, so a missing today means the sync has stopped.",
         expects=TODAY),
    Feed("telematics_rest", "Telematics - other equipment",
         ("oee", "intelligence"),
         MYSQL, "mines_technoton_rest_equipment_utilization", "tripDate",
         TELEMATICS,
         "The same feed for excavators, dozers and the rest of the fleet.",
         expects=TODAY),
    Feed("ev_tracking", "EV tracking",
         ("ev-tracking",),
         MYSQL, "mines_ev_equipment_tracking", "report_date", TELEMATICS,
         "One daily report per electric vehicle."),

    # -- Plans: filled forward, judged on how far ahead they reach -----------
    Feed("plan_excavation", "Daily excavation plan",
         ("mis", "intelligence"), MYSQL,
         "mines_daily_excavation_plan", "Prod_date", ENTRY,
         "Planned ore and OB per shift, location and face. Loaded ahead, so it "
         "is judged on how far forward it still reaches.",
         kind=PLAN),
    Feed("plan_cob", "COB plant plan",
         ("mis",), MYSQL, "mines_cobp_plan", "Plan_date", ENTRY,
         "Planned feed, concentrate and tailings for the COB plant.",
         kind=PLAN),
    Feed("plan_despatch", "Despatch plan",
         ("mis",), MYSQL, "mines_despatch_plan", "Plan_date", ENTRY,
         "Planned despatch to each plant, by grade.",
         kind=PLAN),

    # -- MineHub platform (PostgreSQL) ---------------------------------------
    Feed("fuel_stock", "Fuel stock snapshot",
         ("fuel-management",), MINEHUB, "fuel_stock_snapshot", "report_date",
         PLATFORM,
         "Plant-level diesel stock, synced from SAP MB5B each day."),
    Feed("market_news", "Market news feed",
         ("market",), MINEHUB, "market_news", "published_at", PLATFORM,
         "Headlines gathered from the configured sources.",
         expects=TODAY),
    Feed("usage", "Application usage",
         ("usage",), MINEHUB, "usage_session", "login_at", PLATFORM,
         "Sign-ins to this dashboard. The application writes these itself, so a "
         "gap means the recorder has stopped rather than that nobody logged in.",
         expects=TODAY),
    Feed("roster", "Roster coverage",
         ("workforce",), MINEHUB, "roster_day", "on_date", ENTRY,
         "Who is rostered on which day. Judged a week ahead: a roster that runs "
         "out tomorrow is already a problem, not a surprise.",
         kind=PLAN, horizon_days=7),
)

#: Sections deliberately not monitored, with the reason. Returned to the
#: frontend so a screen can say "not monitored" rather than implying a clean
#: bill of health it has not earned.
UNMONITORED: dict[str, str] = {
    "weather": "Live forecast API - nothing is entered or stored.",
    "minehub": "Equipment register - master data, no daily cadence.",
    "organisation": "Master data, no daily cadence.",
    "capacity": "Derived from the registers; has no feed of its own.",
    "access-control": "Administration screen.",
    "manpower": "Master data, no daily cadence.",
    "operations": "Shift board is not yet in daily use.",
    "weighbridge": "Not yet in daily use.",
    "gate": "Not yet in daily use.",
}


def _quote(source: str, ident: str) -> str:
    return f"`{ident}`" if source == MYSQL else f'"{ident}"'


def _probe(db: Session, source: str, feeds: list[Feed]) -> dict[str, date | None]:
    """Latest date held by each distinct (table, column), in ONE round trip.

    MAX() on these columns is a full table scan — none of them is indexed, and
    pp_production alone is 390,000 rows and 2.3 seconds on its own. Issued one
    statement at a time the whole probe cost three and a half seconds, which is
    far too much to hang off every page load, so the probes are folded into a
    single statement of scalar sub-selects and the result is cached.

    Deduplicated by (table, column) as well: four sections read pp_production,
    and asking it four times would cost four scans to learn one fact.
    """
    pairs: list[tuple[str, str]] = []
    for f in feeds:
        if (f.table, f.date_col) not in pairs:
            pairs.append((f.table, f.date_col))
    if not pairs:
        return {}

    selects = ", ".join(
        f"(SELECT MAX({_quote(source, c)}) FROM {_quote(source, t)}) AS c{i}"
        for i, (t, c) in enumerate(pairs)
    )
    try:
        row = db.execute(text(f"SELECT {selects}")).fetchone()
    except Exception:
        # ONE BAD TABLE MUST NOT BLANK THE WHOLE REPORT. A renamed or dropped
        # table takes the combined statement down with it, so fall back to
        # probing individually and let that feed alone come back unknown.
        logger.warning("combined freshness probe failed on %s; probing singly",
                       source, exc_info=True)
        # ROLL BACK BEFORE RETRYING. PostgreSQL aborts the whole transaction on
        # a failed statement and refuses every later one in it with "current
        # transaction is aborted" — so without this the fallback would report
        # every feed unknown instead of the one table that is actually missing,
        # and a single renamed column would blank the whole MineHub side.
        db.rollback()
        out: dict[str, date | None] = {}
        for t, c in pairs:
            try:
                out[f"{t}.{c}"] = db.execute(
                    text(f"SELECT MAX({_quote(source, c)}) FROM {_quote(source, t)}")
                ).scalar()
            except Exception:
                logger.warning("freshness probe failed for %s.%s", t, c)
                out[f"{t}.{c}"] = None
                db.rollback()
        return out

    return {f"{t}.{c}": row[i] for i, (t, c) in enumerate(pairs)}


def _as_date(v: Any) -> date | None:
    """Narrow a timestamp to its calendar date.

    isinstance(v, date) is NOT the test: datetime SUBCLASSES date, so it passes
    that check and falls through untouched, and `date - datetime` then raises.
    The timestamp columns are all on the MineHub side.
    """
    if v is None:
        return None
    return v.date() if isinstance(v, datetime) else v


def _assess(feed: Feed, last: date | None, today: date) -> dict[str, Any]:
    """One feed's verdict, and the sentence the screen shows for it."""
    # PER FEED, NOT ONE RULE FOR ALL. Most screens report the day that has
    # ended; a stock snapshot and the self-writing feeds are about today. See
    # the YESTERDAY/TODAY block above for why that is not an inconsistency.
    expected = today if feed.expects == TODAY else today - timedelta(days=1)

    if last is None:
        return {
            "status": UNKNOWN, "last_date": None, "expected_date": None,
            "days_behind": None,
            "message": f"{feed.label}: no data found, and no date to report.",
        }

    if feed.kind == PLAN:
        # Forward-looking: the question is how far ahead it still reaches.
        ahead = (last - today).days
        if ahead < 0:
            status = STALE
            msg = (f"{feed.label} has run out — it is loaded only to "
                   f"{_d(last)}, which is already past.")
        elif ahead <= feed.horizon_days:
            status = WARN
            msg = (f"{feed.label} runs out on {_d(last)} — "
                   f"{'today' if ahead == 0 else f'in {ahead} day(s)'}.")
        else:
            status = OK
            msg = f"{feed.label} is loaded to {_d(last)}."
        return {"status": status, "last_date": last.isoformat(),
                "expected_date": today.isoformat(), "days_behind": -ahead,
                "message": msg}

    behind = (expected - last).days
    if behind <= feed.grace_days:
        return {"status": OK, "last_date": last.isoformat(),
                "expected_date": expected.isoformat(),
                "days_behind": max(behind, 0),
                "message": f"{feed.label} is current to {_d(last)}."}

    # THE SENTENCE THE MINE ASKED FOR, kept to their wording: it names the day
    # that is missing AND the last day that is present, because "no data for
    # yesterday" does not say whether the gap is one day or three months.
    #
    # THE VERB FOLLOWS THE ORIGIN. "Data was not entered" is exactly right for
    # a form somebody fills in and simply false for SAP — nobody enters
    # pp_production, it arrives on an interface — and a message that misnames
    # what happened sends the reader to the wrong person. Same facts, same
    # shape, accurate verb.
    verb = {
        ENTRY: f"Data was not entered for {_d(expected)}",
        SAP: f"No data has arrived from SAP for {_d(expected)}",
        TELEMATICS: f"No telematics data has arrived for {_d(expected)}",
        PLATFORM: f"Nothing has been synced for {_d(expected)}",
    }[feed.origin]

    status = STALE if behind > 1 else WARN
    return {
        "status": status,
        "last_date": last.isoformat(),
        "expected_date": expected.isoformat(),
        "days_behind": behind,
        "message": f"{verb} and the last data present is for {_d(last)}.",
    }


def _d(d: date) -> str:
    """'14 Oct 2026' — the form the rest of the dashboard uses."""
    return f"{d.day} {d.strftime('%b')} {d.year}"


def _worst(statuses: list[str]) -> str:
    return max(statuses, key=lambda s: SEVERITY[s]) if statuses else OK


def get_data_health(mysql: Session, minehub: Session | None,
                    today: date | None = None) -> dict[str, Any]:
    """Every feed's freshness, plus a per-section roll-up.

    `minehub` may be None — the platform database is optional on a server and
    its absence must degrade to "unknown" for those four feeds rather than
    failing the whole report, or a VPN blip would take the health of the SAP
    feeds down with it.
    """
    today = today or date.today()

    by_source: dict[str, list[Feed]] = {}
    for f in FEEDS:
        by_source.setdefault(f.source, []).append(f)

    latest: dict[str, date | None] = {}
    for source, feeds in by_source.items():
        db = mysql if source == MYSQL else minehub
        if db is None:
            continue
        try:
            latest.update(_probe(db, source, feeds))
        except Exception:
            logger.warning("freshness probe unavailable for %s", source,
                           exc_info=True)

    rows: list[dict[str, Any]] = []
    for f in FEEDS:
        last = _as_date(latest.get(f"{f.table}.{f.date_col}"))
        rows.append({
            "key": f.key, "label": f.label, "sections": list(f.sections),
            "source": f.source, "table": f.table, "kind": f.kind,
            "note": f.note,
            # Who to chase, and what date this feed is held to. Both are
            # carried rather than inferred on the client: the rule lives here,
            # beside the registry that sets it.
            "origin": f.origin,
            "origin_label": ORIGIN_LABEL[f.origin],
            # A plan is judged on how far FORWARD it reaches, so neither
            # "yesterday" nor "today" describes it. Reporting the field's
            # default there would put a word on the screen that the rule does
            # not use.
            "expects": "ahead" if f.kind == PLAN else f.expects,
            **_assess(f, last, today),
        })

    by_key = {r["key"]: r for r in rows}
    sections: dict[str, Any] = {}
    for f in FEEDS:
        for s in f.sections:
            sections.setdefault(s, {"status": OK, "feeds": [], "stale_count": 0})
            sections[s]["feeds"].append(f.key)
    for s, v in sections.items():
        rs = [by_key[k] for k in v["feeds"]]
        v["status"] = _worst([r["status"] for r in rs])
        v["stale_count"] = sum(1 for r in rs
                               if r["status"] in (STALE, WARN, UNKNOWN))
        # Worst first, so a banner that shows only the top line shows the
        # thing most worth acting on.
        v["feeds"] = [r["key"] for r in
                      sorted(rs, key=lambda r: (-SEVERITY[r["status"]],
                                                -(r["days_behind"] or 0)))]

    return {
        "as_of": today.isoformat(),
        "expected_date": (today - timedelta(days=1)).isoformat(),
        "feeds": rows,
        "sections": sections,
        "unmonitored": UNMONITORED,
        "summary": {
            "total": len(rows),
            "ok": sum(1 for r in rows if r["status"] == OK),
            "warn": sum(1 for r in rows if r["status"] == WARN),
            "stale": sum(1 for r in rows if r["status"] == STALE),
            "unknown": sum(1 for r in rows if r["status"] == UNKNOWN),
        },
    }
