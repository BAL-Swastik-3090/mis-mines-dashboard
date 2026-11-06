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

# The procurement sequence, in order. A requisition is only as far along as
# its furthest-behind line.
STAGE_ORDER = [
    "UNASSIGNED", "ASSIGNED", "RFQ_ISSUED", "QUOTES_IN", "EVALUATION",
    "NFA_PENDING", "NFA_APPROVED", "PO_CREATED", "PO_RELEASED", "RECEIVED",
    "INVOICED", "PAID",
]
_STAGE_AT = {name: i for i, name in enumerate(STAGE_ORDER)}


def _leads(rows: list[dict]) -> list[dict]:
    """One row per requisition: the line that is holding it up.

    THE PANELS COUNT REQUISITIONS, NOT LINES. PR 1600003149 is eighteen
    spare parts on one order from one buyer; counted per line it put
    eighteen into "Issue RFQ" and made one piece of work look like
    eighteen. Every queue on the screen was inflated the same way -- 1,045
    at Payment out of 2,190 lines -- and none of it could be reconciled
    with anything a person does, because nobody chases a line.

    The furthest-behind line decides, matching the table: it is the one
    that has to move before the requisition is finished, and it carries the
    owner and the next action the meeting needs. Where two lines sit in the
    same stage the older is taken, so the age shown is the real wait.

    MONEY DOES NOT COME THROUGH HERE. Invoices and payments belong to the
    purchase order, which is neither a line nor a requisition, and those
    figures stay with _money_once.
    """
    best: dict[str, dict] = {}
    for r in rows:
        pr = r["pr_number"]
        cur = best.get(pr)
        if cur is None:
            best[pr] = r
            continue
        a = (_STAGE_AT.get(r["stage"], 0), -(r.get("stage_age_days") or 0))
        b = (_STAGE_AT.get(cur["stage"], 0), -(cur.get("stage_age_days") or 0))
        if a < b:
            best[pr] = r
    return list(best.values())


def _prs_where(rows: list[dict], pred: Callable[[dict], bool]) -> int:
    """Requisitions with AT LEAST ONE line matching.

    For facts that belong to a line rather than to the requisition's
    position: an overdue delivery on one of six items still makes the
    requisition late.
    """
    return len({r["pr_number"] for r in rows if pred(r)})


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
        # POSITIVES ONLY. A negative balance means more has been paid than
        # invoiced -- an advance against a PO not yet billed. That is money
        # the company has already handed over, not money it owes, and
        # netting it off understates what is payable. The count beside this
        # figure has always used `> 0`; the amount now agrees with it.
        # Advances belong in their own line once Finance defines one.
        if amount <= 0:
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

    # Counts are of requisitions; money stays per PO. See _leads.
    leads = _leads(rows)

    cards: list[Indicator] = [
        {"key": "unassigned", "label": "Released, not assigned",
         "count": _count(leads, lambda r: r["stage"] == "UNASSIGNED"),
         "filter": {"stage": "UNASSIGNED"}, "tone": "alert"},
        {"key": "rfq_pending", "label": "Buyer assigned, RFQ pending",
         "count": _count(leads, lambda r: r["stage"] == "ASSIGNED"),
         "filter": {"stage": "ASSIGNED"}, "tone": "watch"},
        {"key": "quotes_awaited", "label": "Quotations awaited",
         "count": _count(leads, lambda r: r["stage"] == "RFQ_ISSUED"),
         "filter": {"stage": "RFQ_ISSUED"}, "tone": "watch"},
        {"key": "evaluation", "label": "Evaluation in progress",
         "count": _count(leads, lambda r: r["stage"] in ("QUOTES_IN", "EVALUATION")),
         "filter": {"stage": "EVALUATION"}, "tone": "watch"},
        {"key": "nfa_pending", "label": "NFA under approval",
         "count": _count(leads, lambda r: r["stage"] == "NFA_PENDING"),
         "filter": {"stage": "NFA_PENDING"}, "tone": "alert"},
        {"key": "nfa_approved", "label": "NFA approved, PO awaited",
         "count": _count(leads, lambda r: r["stage"] == "NFA_APPROVED"),
         "filter": {"stage": "NFA_APPROVED"}, "tone": "alert"},
        {"key": "po_unreleased", "label": "PO created, not released",
         "count": _count(leads, lambda r: r["stage"] == "PO_CREATED"),
         "filter": {"stage": "PO_CREATED"}, "tone": "watch"},
        {"key": "delivery_overdue", "label": "Delivery overdue",
         "count": _prs_where(rows, lambda r: (
             r.get("po_delivery_date") is not None
             and r["po_delivery_date"] < as_on
             and not r.get("delivery_complete")
             and r["stage"] in ("PO_RELEASED", "PO_CREATED", "RECEIVED"))),
         "filter": {"delivery": "overdue"}, "tone": "alert"},
        {"key": "outstanding", "label": "Outstanding payable",
         # COUNTED IN POs, not requisitions, because the amount beside it is
         # per PO. A count on a different footing from the figure next to it
         # invites exactly the arithmetic that does not work.
         "count": len({r.get("po_no") or ("~" + r["pr_number"] + "/" + r["pr_item"])
                       for r in rows if (r.get("outstanding") or 0) > 0}),
         "count_unit": "PO",
         # PER PO, ONCE. Invoices and payments are recorded against the PO,
         # not the PR item, so a PO covering five PR items appears on five
         # register rows carrying the same invoice total. Summing the rows
         # counted it five times and read Rs 2.9 bn against a real figure
         # five times smaller. The requirements say it plainly: do not count
         # a full PO value repeatedly when it links to several PRs.
         "amount": _money_once(rows, "outstanding"),
         "filter": {"payment": "outstanding"}, "tone": "money"},
        {"key": "overdue_stage", "label": "Past stage target",
         "count": _count(leads, lambda r: r["rag"] == "red"),
         "filter": {"rag": "red"}, "tone": "alert"},
    ]

    return {
        "as_on": as_on,
        "ageing": _ageing(leads),
        "payment_profile": _payment_profile(rows, as_on),
        "buyer_workload": _buyer_workload(leads),
        "approval_bottlenecks": _approval_bottlenecks(leads),
        "review_first": _review_first(rows, leads, as_on),
        "totals": {
            "pr_items": len(rows),
            "pr_numbers": len(pr_numbers),
            "po_numbers": len(po_numbers),
            "invoices": sum(r.get("invoice_docs") or 0 for r in rows),
        },
        # Every count on this screen is of requisitions unless the
        # indicator carries its own count_unit, so the screen can label
        # them without guessing.
        "count_unit": "PR",
        "cards": cards,
        "by_stage": _by_stage(leads),
        "by_owner": _by_owner(leads),
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


# ── the panels the meeting reads before the table ───────────────────────────

AGE_BANDS: list[tuple[str, int, int | None]] = [
    ("0-7 days",   0,   7),
    ("8-15 days",  8,  15),
    ("16-30 days", 16, 30),
    ("Over 30",    31, None),
]


def _ageing(rows: list[dict]) -> list[dict]:
    """How long open items have been sitting in their current stage.

    Items whose stage age is unknown are counted in their own band rather
    than dropped, so the bands add up to the population and nobody has to
    wonder where the difference went.
    """
    out = [{"band": name, "count": 0, "red": 0} for name, _, _ in AGE_BANDS]
    unknown = {"band": "No date", "count": 0, "red": 0}
    for r in rows:
        age = r.get("stage_age_days")
        if age is None:
            unknown["count"] += 1
            continue
        for slot, (_, lo, hi) in zip(out, AGE_BANDS):
            if age >= lo and (hi is None or age <= hi):
                slot["count"] += 1
                if r["rag"] == "red":
                    slot["red"] += 1
                break
    return out + ([unknown] if unknown["count"] else [])


def _payment_profile(rows: list[dict], as_on: date) -> dict:
    """Open invoice balance split by when it falls due -- once per PO.

    SAP's own due_payment column is empty at these plants, so the due date
    comes from the payment term text. Terms that state no period are kept in
    their own bucket: an unknown due date is not an overdue one, and rolling
    them into "overdue" would overstate the figure Finance checks first.
    """
    seen: set[str] = set()
    buckets = {"overdue": 0.0, "due_7": 0.0, "due_later": 0.0, "no_terms": 0.0}
    counts = {"overdue": 0, "due_7": 0, "due_later": 0, "no_terms": 0}
    for r in rows:
        amount = r.get("outstanding") or 0
        if amount <= 0:
            continue
        po = r.get("po_no")
        if po:
            if po in seen:
                continue
            seen.add(po)
        due = r.get("due_date")
        if due is None:
            key = "no_terms"
        elif due < as_on:
            key = "overdue"
        elif (due - as_on).days <= 7:
            key = "due_7"
        else:
            key = "due_later"
        buckets[key] += float(amount)
        counts[key] += 1
    return {
        "bands": [
            {"band": "Overdue",        "amount": round(buckets["overdue"], 2),   "count": counts["overdue"]},
            {"band": "Due in 7 days",  "amount": round(buckets["due_7"], 2),     "count": counts["due_7"]},
            {"band": "Due later",      "amount": round(buckets["due_later"], 2), "count": counts["due_later"]},
            {"band": "Terms not stated", "amount": round(buckets["no_terms"], 2), "count": counts["no_terms"]},
        ],
        "basis": "Open invoice balance, counted once per PO. Due date derived "
                 "from the payment term; SAP records no due date at these plants.",
    }


def _median(values: list[int]) -> int | None:
    if not values:
        return None
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) // 2


def _buyer_workload(rows: list[dict]) -> list[dict]:
    """Per buyer: what they are carrying and how long it has sat.

    Median rather than mean stage age. One PR stuck for two years drags a
    mean so far that every buyer looks the same; the median says what a
    typical item on that desk is actually waiting.
    """
    out: dict[str, dict] = {}
    for r in rows:
        # Only the stages a buyer owns. Counting invoices against a buyer
        # would make Accounts' backlog look like SCM's.
        if r["stage"] in ("INVOICED", "PAID", "RECEIVED"):
            continue
        name = r.get("buyer_name") or (
            f"Buyer {r['purchasing_group']}" if r.get("purchasing_group") else None)
        if not name:
            continue
        b = out.setdefault(name, {
            "buyer": name, "department": r.get("buyer_department"),
            "open_items": 0, "past_target": 0, "_ages": []})
        b["open_items"] += 1
        if r["rag"] == "red":
            b["past_target"] += 1
        if r["stage_age_days"] is not None:
            b["_ages"].append(r["stage_age_days"])
    result = []
    for b in out.values():
        ages = b.pop("_ages")
        b["median_age_days"] = _median(ages)
        result.append(b)
    return sorted(result, key=lambda b: (-b["past_target"], -b["open_items"]))


def _approval_bottlenecks(rows: list[dict]) -> list[dict]:
    """NFAs waiting on an approver, worst first.

    Only the NFA stage: this answers "whose signature is the hold-up", and
    mixing in cases waiting on a vendor or on Accounts would bury it.
    """
    out: dict[str, dict] = {}
    for r in rows:
        if r["stage"] != "NFA_PENDING":
            continue
        who = r.get("approver_name") or r.get("nfa_approver") or "Approver not named"
        b = out.setdefault(who, {"approver": who, "department": r.get("approver_dept"),
                                 "pending": 0, "overdue": 0, "oldest_days": None})
        b["pending"] += 1
        if r["rag"] == "red":
            b["overdue"] += 1
        age = r.get("nfa_pending_days") if r.get("nfa_pending_days") is not None \
            else r.get("stage_age_days")
        if age is not None and (b["oldest_days"] is None or age > b["oldest_days"]):
            b["oldest_days"] = age
    return sorted(out.values(), key=lambda b: (-b["overdue"], -b["pending"]))


def _review_first(rows: list[dict], leads: list[dict], as_on: date) -> list[str]:
    """The one line somebody reads out at the start of the meeting.

    In requisitions, like every other count here -- the deliveries included,
    counted as requisitions with at least one late line.
    """
    lines: list[str] = []
    pay_late = sum(1 for r in leads if r["stage"] == "INVOICED" and r["rag"] == "red")
    if pay_late:
        lines.append(f"{pay_late} PRs at payment stage past target")
    deliv = _prs_where(rows, lambda r: bool(
        r.get("po_delivery_date") and r["po_delivery_date"] < as_on
        and not r.get("delivery_complete")
        and r["stage"] in ("PO_RELEASED", "PO_CREATED", "RECEIVED")))
    if deliv:
        lines.append(f"{deliv} PRs with an overdue delivery")
    nfa_late = sum(1 for r in leads if r["stage"] == "NFA_PENDING" and r["rag"] == "red")
    if nfa_late:
        lines.append(f"{nfa_late} NFA approvals past target")
    oldest = max((r["stage_age_days"] or 0) for r in leads) if leads else 0
    if oldest:
        lines.append(f"oldest open PR {oldest} days in stage")
    return lines
