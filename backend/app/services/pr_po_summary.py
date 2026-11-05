"""The management summary: counts that open their own records.

Every indicator here is computed from the SAME register rows the table shows,
not from a second query. The requirements ask that each card opens its
filtered records, and a card counted independently of the list it opens is a
card that will one day disagree with it.

Each indicator carries the filter that reproduces it, so the screen does not
have to encode the rule a second time in the browser.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Callable

# A stage target in calendar days. Beyond this an item is overdue; at 80% of
# it, approaching. These are placeholders until SCM agrees them -- the
# requirements list stage targets as an input still needed, and inventing
# them quietly would be worse than showing them and being corrected.
STAGE_TARGET_DAYS: dict[str, int] = {
    "UNASSIGNED":   2,
    "ASSIGNED":     5,
    "RFQ_ISSUED":   10,
    "QUOTES_IN":    5,
    "EVALUATION":   7,
    "NFA_PENDING":  5,
    "NFA_APPROVED": 3,
    "PO_CREATED":   2,
    "PO_RELEASED": 30,
    "RECEIVED":     7,
    "INVOICED":    30,
}

TARGETS_ARE_PROVISIONAL = True


def rag(stage: str, age: int | None) -> str:
    """green / amber / red / unknown, with the text label alongside.

    'unknown' rather than green when the age cannot be computed: the
    requirements are explicit that missing information must not read as
    completed, and a green light on an unknown age is exactly that.
    """
    target = STAGE_TARGET_DAYS.get(stage)
    if age is None or target is None:
        return "unknown"
    if age > target:
        return "red"
    if age >= target * 0.8:
        return "amber"
    return "green"


Indicator = dict[str, Any]


def _count(rows: list[dict], pred: Callable[[dict], bool]) -> int:
    return sum(1 for r in rows if pred(r))


def _money_once(rows: list[dict], field: str) -> float:
    """Sum a PO-level amount once per PO, however many PR items carry it.

    Invoices and payments are recorded against the purchase order. A PO that
    covers five PR items produces five register rows, each showing that PO's
    invoice position -- correct on the row, catastrophic in a total. Rows
    with no PO are summed individually, because there is nothing to collapse
    them onto and each is its own case.
    """
    seen: set[str] = set()
    total = 0.0
    for r in rows:
        amount = r.get(field) or 0
        if not amount:
            continue
        po = r.get("po_no")
        if po:
            if po in seen:
                continue
            seen.add(po)
        total += float(amount)
    return round(total, 2)


def summarise(rows: list[dict[str, Any]], as_on: date) -> dict[str, Any]:
    """The cards, plus the totals that have to stay separate.

    PR, PR-item, PO and invoice counts are deliberately NOT merged into one
    "open items" number. They count different things, and a single figure
    would be wrong for every audience at once.
    """
    for r in rows:
        r["rag"] = rag(r["stage"], r["stage_age_days"])

    pr_numbers = {r["pr_number"] for r in rows}
    po_numbers = {r["po_no"] for r in rows if r.get("po_no")}

    cards: list[Indicator] = [
        {"key": "unassigned", "label": "Released, not assigned",
         "count": _count(rows, lambda r: r["stage"] == "UNASSIGNED"),
         "filter": {"stage": "UNASSIGNED"}, "tone": "alert"},
        {"key": "rfq_pending", "label": "Buyer assigned, RFQ pending",
         "count": _count(rows, lambda r: r["stage"] == "ASSIGNED"),
         "filter": {"stage": "ASSIGNED"}, "tone": "watch"},
        {"key": "quotes_awaited", "label": "Quotations awaited",
         "count": _count(rows, lambda r: r["stage"] == "RFQ_ISSUED"),
         "filter": {"stage": "RFQ_ISSUED"}, "tone": "watch"},
        {"key": "evaluation", "label": "Evaluation in progress",
         "count": _count(rows, lambda r: r["stage"] in ("QUOTES_IN", "EVALUATION")),
         "filter": {"stage": "EVALUATION"}, "tone": "watch"},
        {"key": "nfa_pending", "label": "NFA under approval",
         "count": _count(rows, lambda r: r["stage"] == "NFA_PENDING"),
         "filter": {"stage": "NFA_PENDING"}, "tone": "alert"},
        {"key": "nfa_approved", "label": "NFA approved, PO awaited",
         "count": _count(rows, lambda r: r["stage"] == "NFA_APPROVED"),
         "filter": {"stage": "NFA_APPROVED"}, "tone": "alert"},
        {"key": "po_unreleased", "label": "PO created, not released",
         "count": _count(rows, lambda r: r["stage"] == "PO_CREATED"),
         "filter": {"stage": "PO_CREATED"}, "tone": "watch"},
        {"key": "delivery_overdue", "label": "Delivery overdue",
         "count": _count(rows, lambda r: (
             r.get("po_delivery_date") is not None
             and r["po_delivery_date"] < as_on
             and not r.get("delivery_complete")
             and r["stage"] in ("PO_RELEASED", "PO_CREATED", "RECEIVED"))),
         "filter": {"delivery": "overdue"}, "tone": "alert"},
        {"key": "outstanding", "label": "Outstanding payable",
         "count": _count(rows, lambda r: (r.get("outstanding") or 0) > 0),
         # PER PO, ONCE. Invoices and payments are recorded against the PO,
         # not the PR item, so a PO covering five PR items appears on five
         # register rows carrying the same invoice total. Summing the rows
         # counted it five times and read Rs 2.9 bn against a real figure
         # five times smaller. The requirements say it plainly: do not count
         # a full PO value repeatedly when it links to several PRs.
         "amount": _money_once(rows, "outstanding"),
         "filter": {"payment": "outstanding"}, "tone": "money"},
        {"key": "overdue_stage", "label": "Past stage target",
         "count": _count(rows, lambda r: r["rag"] == "red"),
         "filter": {"rag": "red"}, "tone": "alert"},
    ]

    return {
        "as_on": as_on,
        "totals": {
            "pr_items": len(rows),
            "pr_numbers": len(pr_numbers),
            "po_numbers": len(po_numbers),
            "invoices": sum(r.get("invoice_docs") or 0 for r in rows),
        },
        "cards": cards,
        "by_stage": _by_stage(rows),
        "by_owner": _by_owner(rows),
        "targets_provisional": TARGETS_ARE_PROVISIONAL,
    }


def _by_stage(rows: list[dict]) -> list[dict]:
    out: dict[str, dict] = {}
    for r in rows:
        b = out.setdefault(r["stage"], {
            "stage": r["stage"], "label": r["stage_label"],
            "count": 0, "red": 0, "oldest_days": None})
        b["count"] += 1
        if r["rag"] == "red":
            b["red"] += 1
        age = r["stage_age_days"]
        if age is not None and (b["oldest_days"] is None or age > b["oldest_days"]):
            b["oldest_days"] = age
    return sorted(out.values(), key=lambda b: -b["count"])


def _by_owner(rows: list[dict]) -> list[dict]:
    """The approval and action queue, grouped by who is holding it."""
    out: dict[str, dict] = {}
    for r in rows:
        owner = r.get("pending_with") or "Unassigned owner"
        b = out.setdefault(owner, {"owner": owner, "count": 0, "red": 0,
                                   "oldest_days": None})
        b["count"] += 1
        if r["rag"] == "red":
            b["red"] += 1
        age = r["stage_age_days"]
        if age is not None and (b["oldest_days"] is None or age > b["oldest_days"]):
            b["oldest_days"] = age
    return sorted(out.values(), key=lambda b: (-b["red"], -b["count"]))
