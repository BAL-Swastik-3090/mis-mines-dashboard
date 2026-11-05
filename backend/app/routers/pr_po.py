"""PR-to-Payment: released requisitions from SCM assignment through payment.

Reads SAP's extracts (sap_odata_api) and the RFQ portal's own tables (scm).
Writes nothing -- every figure here belongs to SAP or to the portal, and the
operational fields the requirements call for (priority, blocker, meeting
action) are a later step that will have its own tables in minehub.

NO response_model ON THESE. The register's row shape is decided by the
service and moves with it, and a schema naming the fields is a second place
to keep in step -- a field the service adds that the schema does not name is
dropped on the way out with no error anywhere to say so. That has already
cost this application once. When these responses are stabilised for another
consumer, the models arrive together with a check that compares service
output against response output.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import access as access_svc
from app.services import pr_po as svc
from app.services import pr_po_summary as summ

router = APIRouter(prefix="/api/pr-po", tags=["PR to Payment"])

# Kaliapani Chromite Mines and the Kaliapani COB Plant.
MINES_PLANTS = ["1200", "1210"]

# A year of released PRs is what a daily meeting reads. The whole history is
# 27,000 rows across the estate and nobody opens a dashboard to scroll it.
DEFAULT_WINDOW_DAYS = 365

# Either opens this module. mines.prpo.view is the precise code and is not
# granted to anyone yet; link.prpo.view already gates the other team's PR/PO
# Status link, so the audience that may already look at Mines procurement can
# use this from day one. See the matching note in pageAccess.ts -- the screen
# and the endpoint must agree, or the page appears and then refuses to load.
VIEW_PERMISSIONS = ("mines.prpo.view", "link.prpo.view")


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or ""


def _guard(db: Session, request: Request) -> None:
    """Commercial information -- quotation values, vendor pricing, payment
    positions -- is not for every holder of a dashboard login.

    Either code opens it, and superadmin passes regardless -- see
    VIEW_PERMISSIONS above for why the new code alone would lock everyone out.
    """
    emp = _actor(request)
    if any(access_svc.has_permission(db, emp, code) for code in VIEW_PERMISSIONS):
        return
    if access_svc.is_superadmin(db, emp):
        return
    raise HTTPException(403, "You do not have access to procurement data.")


def _window(from_date: date | None, as_on: date | None) -> tuple[date, date]:
    today = date.today()
    on = as_on or today
    frm = from_date or (on - timedelta(days=DEFAULT_WINDOW_DAYS))
    if frm > on:
        raise HTTPException(422, "from_date is after the reporting date.")
    return frm, on


def _load(db: Session, from_date: date | None,
          as_on: date | None) -> tuple[list[dict], date, date]:
    frm, on = _window(from_date, as_on)
    rows = svc.register(db, on, frm, MINES_PLANTS)
    for r in rows:
        r["rag"] = summ.rag(r["stage"], r["stage_age_days"])

    # WORST FIRST, NOT NEWEST FIRST. Sorted by release date the first screen
    # was entirely items released today -- every row reading "0d, on track"
    # while 1,695 of the 2,191 sat past their target further down. A meeting
    # view that opens on the healthiest rows is worse than no view: it
    # answers "is anything wrong?" with "no" by accident of ordering.
    #
    # Overdue first, then oldest in stage. An unknown age sorts last rather
    # than first: it is not evidence of a problem, only of a missing date.
    severity = {"red": 0, "amber": 1, "green": 2, "unknown": 3}
    rows.sort(key=lambda r: (severity.get(r["rag"], 3),
                             -(r["stage_age_days"] or 0)))
    return rows, on, frm


@router.get("/summary")
def summary(request: Request,
            from_date: date | None = Query(default=None),
            as_on: date | None = Query(default=None),
            db: Session = Depends(get_minehub_db)) -> dict[str, Any]:
    """The cards, the stage breakdown and the owner queue.

    Counted from the same rows the register returns, never from a second
    query: a card counted independently of the list it opens is a card that
    will one day disagree with it.
    """
    _guard(db, request)
    rows, on, frm = _load(db, from_date, as_on)
    out = summ.summarise(rows, on)
    out["window"] = {"from": frm, "to": on}
    return out


# What the table may be sorted by. A allow-list rather than a free field:
# the sort key reaches a dict lookup, and an unchecked one is a way to probe
# for fields the response does not otherwise show.
SORTABLE = {
    "stage_age_days", "pr_age_days", "release_date", "pr_date", "pr_number",
    "po_value", "outstanding", "overdue_payable", "due_date", "buyer_name",
    "pending_with", "stage", "vendor", "po_date", "po_delivery_date",
}


def _apply_sort(rows: list[dict[str, Any]], field: str,
                descending: bool) -> list[dict[str, Any]]:
    """Sort by `field`, with missing values last in BOTH directions.

    The obvious one-liner -- sorted(key=lambda r: (r[f] is None, r[f] or ""),
    reverse=desc) -- gets this wrong, and did: `reverse` flips the None flag
    too, so descending put every empty row at the top and the table looked
    like it had not sorted at all. A missing value is not a small one, and
    it is not a large one either; it is absent, and it belongs at the end
    whichever way the column is pointing. So the rows are partitioned first
    and only the ones that have a value are ordered.

    Mixed types within a column (a date beside a string, which the SAP
    extracts can produce) would raise on comparison, so that falls back to
    comparing as text rather than returning a 500 for a sort click.
    """
    have = [r for r in rows if r.get(field) is not None]
    missing = [r for r in rows if r.get(field) is None]
    try:
        have.sort(key=lambda r: r[field], reverse=descending)
    except TypeError:
        have.sort(key=lambda r: str(r[field]), reverse=descending)
    return have + missing


@router.get("/register")
def register(request: Request,
             from_date: date | None = Query(default=None),
             to_date: date | None = Query(default=None),
             as_on: date | None = Query(default=None),
             stage: str | None = Query(default=None),
             rag: str | None = Query(default=None),
             owner: str | None = Query(default=None),
             buyer: str | None = Query(default=None),
             q: str | None = Query(default=None, max_length=80),
             sort: str | None = Query(default=None),
             dir: str = Query(default="desc", pattern="^(asc|desc)$"),
             limit: int = Query(default=500, ge=1, le=5000),
             db: Session = Depends(get_minehub_db)) -> dict[str, Any]:
    """The register, filtered the way a summary card filters it."""
    _guard(db, request)
    rows, on, frm = _load(db, from_date, as_on)

    if to_date:
        # Released on or before this date. The pair reads as "released
        # between", which is the question a date filter is asked here --
        # not "touched between", which would move rows in and out of the
        # table as SAP syncs and make the count unrepeatable.
        rows = [r for r in rows
                if r.get("release_date") and r["release_date"] <= to_date]
    if stage:
        wanted = {s.strip().upper() for s in stage.split(",")}
        if "EVALUATION" in wanted:
            wanted.add("QUOTES_IN")
        rows = [r for r in rows if r["stage"] in wanted]
    if rag:
        wanted_rag = {x.strip().lower() for x in rag.split(",")}
        rows = [r for r in rows if r["rag"] in wanted_rag]
    if owner:
        rows = [r for r in rows if (r.get("pending_with") or "") == owner]
    if buyer:
        rows = [r for r in rows if (r.get("buyer_name") or "") == buyer]
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if any(
            needle in str(r.get(f) or "").lower()
            for f in ("pr_number", "po_no", "description", "vendor", "nfa_id",
                      "created_by", "requisitioner", "buyer_name",
                      "pending_with", "material", "cost_center"))]

    if sort in SORTABLE:
        rows = _apply_sort(rows, sort, dir == "desc")

    return {"as_on": on, "total": len(rows),
            # The window actually covered, not the one requested: with no
            # dates given the server picks them, and a screen that says
            # "last year" where it could say the two dates is making the
            # reader guess what they are looking at.
            "window": {"from": frm, "to": to_date or on},
            "rows": rows[:limit], "truncated": len(rows) > limit,
            "buyers": sorted({r["buyer_name"] for r in rows if r.get("buyer_name")})}


@router.get("/case/{pr_number}")
def case(request: Request, pr_number: str,
         as_on: date | None = Query(default=None),
         db: Session = Depends(get_minehub_db)) -> dict[str, Any]:
    """Every item of one PR, for the detailed case view.

    The window opens to 2000 on purpose: a case is looked up by number, and a
    PR released before the register's default year must still be findable.
    """
    _guard(db, request)
    _, on = _window(date(2000, 1, 1), as_on)
    rows = [r for r in svc.register(db, on, date(2000, 1, 1), MINES_PLANTS)
            if r["pr_number"] == pr_number]
    if not rows:
        raise HTTPException(404, f"PR {pr_number} is not in the Mines scope.")
    for r in rows:
        r["rag"] = summ.rag(r["stage"], r["stage_age_days"])
    return {"pr_number": pr_number, "as_on": on, "items": rows}
