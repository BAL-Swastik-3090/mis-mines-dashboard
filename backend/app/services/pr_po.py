"""The PR register: one row per PR item, from release through to payment.

Part of the PR-to-Payment module. The plants are the Mines plants -- 1200
Kaliapani Chromite Mines and 1210 Kaliapani COB Plant -- and the caller
passes them in rather than this module deciding what "Mines" means.

WHAT THIS IS AND IS NOT. It is one read across SAP and the RFQ portal that
answers, for every released PR item at the Mines plants: who asked, who is
handling it, where it has got to, with whom it is sitting, since when, and
what the linked PO and payment position is. It is not a write path -- every
figure below belongs to SAP or the portal, and this application only reads.

-- WHY THE STAGE IS DERIVED AND NOT STORED -----------------------------------
No system holds "where is this PR". SAP knows a PR was released and whether a
PO exists; the portal knows whether an RFQ went out, quotations came back, an
NFA is under approval. The stage is the furthest point with EVIDENCE behind
it, computed at read time, so it cannot drift out of step with its sources.

STAGES is walked in order and the first match wins, so a PR carrying an
invoice reads INVOICED rather than falling back to "PO issued".
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

# Stage code -> what the screen calls it. Ordered furthest-along first.
STAGE_LABELS: dict[str, str] = {
    "PAID":         "Paid",
    "INVOICED":     "Invoice received",
    "RECEIVED":     "Goods/service received",
    "PO_RELEASED":  "PO released",
    "PO_CREATED":   "PO created, not released",
    "NFA_APPROVED": "NFA approved, PO awaited",
    "NFA_PENDING":  "NFA under approval",
    "EVALUATION":   "Technical evaluation",
    "QUOTES_IN":    "Quotations received",
    "RFQ_ISSUED":   "RFQ issued, quotations awaited",
    "ASSIGNED":     "Buyer assigned, RFQ pending",
    "UNASSIGNED":   "Released, not yet assigned",
}

REGISTER_SQL = """
WITH pr AS (
    SELECT r.pr_number, r.pr_item, r.short_text, r.requisition_date,
           r.pr_release_date, r.quantity, r.base_unit, r.net_value,
           r.currency_key, r.created_by, r.requisitioner, r.plant,
           r.purchasing_group, r.material_no, r.material_group_desc,
           r.cost_center, r.delivery_date, r.item_category,
           NULLIF(TRIM(r.po_no), '')   AS pr_po_no,
           r.pr_closed
      FROM sap_odata_api.scm_purchase_requisition r
     WHERE r.plant = ANY(:plants)
       AND COALESCE(r.delete_indicator, '') <> 'X'
       AND r.pr_release_date IS NOT NULL
       AND r.pr_release_date >= :from_date
),
po AS (
    SELECT p.pr_no, p.pr_item,
           count(*)                            AS po_item_count,
           min(p.po_no)                        AS po_no,
           min(p.po_date)                      AS po_date,
           min(p.vendor_name)                  AS vendor_name,
           min(p.vendor)                       AS vendor_code,
           min(p.zterm)                        AS payment_terms,
           min(p.zterm_desc)                   AS payment_terms_desc,
           sum(COALESCE(p.net_order_value, 0)) AS po_value,
           min(p.currency)                     AS po_currency,
           min(p.po_release_date)              AS po_release_date,
           max(p.release_state)                AS release_state,
           min(p.item_del_date)                AS po_delivery_date,
           sum(COALESCE(p.gr_qty, 0))          AS gr_qty,
           sum(COALESCE(p.quantity, 0))        AS po_qty,
           max(p.goods_receipt_date)           AS goods_receipt_date,
           max(p.del_complete)                 AS delivery_complete
      FROM sap_odata_api.scm_purchase_order p
     WHERE p.plant = ANY(:plants)
       AND COALESCE(p.delete_indicator, '') <> 'X'
     GROUP BY p.pr_no, p.pr_item
),
hist AS (
    SELECT h.po_number,
           sum(COALESCE(h.amount_local_currency,0)) FILTER (WHERE h.po_history_category = 'E') AS gr_value,
           max(h.posting_date)                      FILTER (WHERE h.po_history_category = 'E') AS last_gr_date,
           sum(COALESCE(h.amount_local_currency,0)) FILTER (WHERE h.po_history_category = 'Q') AS invoice_value,
           count(*)                                 FILTER (WHERE h.po_history_category = 'Q') AS invoice_docs,
           max(h.posting_date)                      FILTER (WHERE h.po_history_category = 'Q') AS last_invoice_date
      FROM sap_odata_api.scm_po_history h
     WHERE h.plant = ANY(:plants)
     GROUP BY h.po_number
),
pay AS (
    SELECT f.po_no,
           sum(COALESCE(f.payment_amt,0)) AS paid_amount,
           max(f.payment_date)            AS last_payment_date
      FROM sap_odata_api.finance_po_wise_payment f
     GROUP BY f.po_no
),
rfq AS (
    SELECT g.pr_number,
           count(DISTINCT g.rfq_number)  AS rfq_count,
           count(DISTINCT g.vendor_code) AS rfq_vendors,
           min(g.created_at)             AS rfq_issued_at,
           min(g.response_deadline)      AS rfq_deadline,
           min(g.created_by)             AS rfq_created_by
      FROM scm.scm_quot_generated_rfq g
     GROUP BY g.pr_number
),
quo AS (
    SELECT q.pr_number, count(*) AS quotation_count, max(q.created_at) AS last_quotation_at
      FROM scm.scm_quot_quotation q
     GROUP BY q.pr_number
),
nfa AS (
    SELECT n.pr_number,
           min(n.nfa_id::text)                  AS nfa_id,
           max(n.status)                        AS nfa_status,
           min(n.created_at)                    AS nfa_created_at,
           min(n.submitted_at)                  AS nfa_submitted_at,
           min(n.vendor_name)                   AS nfa_vendor,
           sum(COALESCE(n.total_landed_cost,0)) AS nfa_value
      FROM scm.scm_quot_nfa_master n
     GROUP BY n.pr_number
),
nfa_step AS (
    SELECT DISTINCT ON (a.pr_number)
           a.pr_number, a.approval_level, a.approver_email,
           a.sent_at AS pending_since
      FROM scm.scm_quot_nfa_approvals a
     WHERE a.action_at IS NULL AND a.sent_at IS NOT NULL
     ORDER BY a.pr_number, a.approval_level
),
tech AS (
    SELECT t.pr_number, count(*) AS tech_submissions
      FROM scm.scm_quot_technical_eval_submission t
     GROUP BY t.pr_number
),
-- The buyer behind the purchasing group code. P26 means nothing to anyone
-- outside SCM; Nitesh Kumar is who the meeting asks about. 'BLOCKED' is the
-- portal's word for a retired code and is treated as no name at all.
buyer AS (
    SELECT g.purchasing_group,
           NULLIF(TRIM(g.purchasing_name), '')    AS buyer_name,
           NULLIF(TRIM(g.department), '')         AS buyer_department,
           NULLIF(TRIM(g.e_mail), '')             AS buyer_email
      FROM scm.scm_pur_group g
     WHERE COALESCE(TRIM(g.purchasing_name), '') NOT IN ('', 'BLOCKED')
),
-- An approver is recorded as an email address. The meeting uses names.
approver AS (
    SELECT lower(TRIM(e.emailid)) AS emailid,
           min(TRIM(e.empname))   AS approver_name,
           min(TRIM(e.empdept))   AS approver_dept
      FROM sap_odata_api.sap_employee_details e
     WHERE COALESCE(TRIM(e.emailid), '') <> ''
     GROUP BY 1
)
SELECT pr.*,
       po.po_no, po.po_item_count, po.po_date, po.vendor_name, po.vendor_code,
       po.payment_terms, po.payment_terms_desc, po.po_value, po.po_currency,
       po.po_release_date,
       po.release_state, po.po_delivery_date, po.gr_qty, po.po_qty,
       po.goods_receipt_date, po.delivery_complete,
       hist.gr_value, hist.last_gr_date,
       hist.invoice_value, hist.invoice_docs, hist.last_invoice_date,
       pay.paid_amount, pay.last_payment_date,
       rfq.rfq_count, rfq.rfq_vendors, rfq.rfq_issued_at, rfq.rfq_deadline,
       rfq.rfq_created_by,
       quo.quotation_count, quo.last_quotation_at,
       nfa.nfa_id, nfa.nfa_status, nfa.nfa_submitted_at, nfa.nfa_vendor,
       nfa.nfa_value,
       nfa_step.approval_level AS nfa_level,
       nfa_step.approver_email AS nfa_approver,
       nfa_step.pending_since  AS nfa_pending_since,
       tech.tech_submissions,
       buyer.buyer_name, buyer.buyer_department, buyer.buyer_email,
       approver.approver_name, approver.approver_dept
  FROM pr
  LEFT JOIN po       ON po.pr_no = pr.pr_number AND po.pr_item = pr.pr_item
  LEFT JOIN hist     ON hist.po_number = COALESCE(po.po_no, pr.pr_po_no)
  LEFT JOIN pay      ON pay.po_no      = COALESCE(po.po_no, pr.pr_po_no)
  LEFT JOIN rfq      ON rfq.pr_number  = pr.pr_number
  LEFT JOIN quo      ON quo.pr_number  = pr.pr_number
  LEFT JOIN nfa      ON nfa.pr_number  = pr.pr_number
  LEFT JOIN nfa_step ON nfa_step.pr_number = pr.pr_number
  LEFT JOIN tech     ON tech.pr_number = pr.pr_number
  LEFT JOIN buyer    ON buyer.purchasing_group = TRIM(pr.purchasing_group)
  LEFT JOIN approver ON approver.emailid = lower(TRIM(nfa_step.approver_email))
 ORDER BY pr.pr_release_date DESC, pr.pr_number, pr.pr_item
"""


def _as_date(v: Any) -> date | None:
    """A real date, whatever the column happened to store.

    The SAP extracts keep some dates as text -- '2026-11-05', '20261105' and
    the occasional '0000-00-00' for "never" -- while the portal's own columns
    are proper timestamps. Normalising here rather than in each caller means
    an arithmetic error on a string cannot reach a screen.
    """
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if not s or s.startswith("0000"):
        return None
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[:10] if "-" in s or "." in s or "/" in s
                                     else s[:8], fmt).date()
        except ValueError:
            continue
    return None


def _age(since: Any, as_on: date) -> int | None:
    """Whole days from `since` to `as_on`. None when the date is unknown --
    an unknown age is not an age of zero."""
    d = _as_date(since)
    return (as_on - d).days if d else None


def derive_stage(r: dict[str, Any]) -> tuple[str, date | None]:
    """The furthest stage with evidence, and the date it was entered.

    Returns the stage code and the date that stage began, which is what the
    stage age is measured from. A stage whose own date is missing falls back
    to the PR release date rather than reporting an age of nothing.
    """
    if r.get("paid_amount"):
        return "PAID", _as_date(r.get("last_payment_date"))
    if r.get("invoice_docs"):
        return "INVOICED", _as_date(r.get("last_invoice_date"))
    if r.get("gr_qty") and float(r["gr_qty"]) > 0:
        return "RECEIVED", _as_date(r.get("last_gr_date") or r.get("goods_receipt_date"))
    if r.get("po_no"):
        # A released PO and a PO merely created are different events, and the
        # requirements are explicit that they must stay distinguishable.
        if r.get("po_release_date"):
            return "PO_RELEASED", _as_date(r.get("po_release_date"))
        return "PO_CREATED", _as_date(r.get("po_date"))
    status = (r.get("nfa_status") or "").strip().upper()
    if status in {"APPROVED", "COMPLETED"}:
        return "NFA_APPROVED", _as_date(r.get("nfa_submitted_at"))
    if r.get("nfa_pending_since"):
        return "NFA_PENDING", _as_date(r.get("nfa_pending_since"))
    if r.get("nfa_id"):
        return "NFA_PENDING", _as_date(r.get("nfa_submitted_at") or r.get("rfq_issued_at"))
    if r.get("tech_submissions"):
        return "EVALUATION", _as_date(r.get("rfq_deadline") or r.get("rfq_issued_at"))
    if r.get("quotation_count"):
        return "QUOTES_IN", _as_date(r.get("last_quotation_at"))
    if r.get("rfq_count"):
        return "RFQ_ISSUED", _as_date(r.get("rfq_issued_at"))
    if (r.get("purchasing_group") or "").strip():
        return "ASSIGNED", _as_date(r.get("pr_release_date"))
    return "UNASSIGNED", _as_date(r.get("pr_release_date"))


# What the person holding this case has to DO. The requirements ask every
# open case to answer "what action is required next", and a stage name is not
# an action: "NFA under approval" tells a buyer nothing, "Approve the NFA"
# tells the approver exactly what is wanted.
NEXT_ACTION: dict[str, str] = {
    "UNASSIGNED":   "Assign a buyer",
    "ASSIGNED":     "Issue the RFQ",
    "RFQ_ISSUED":   "Chase vendors for quotations",
    "QUOTES_IN":    "Start technical evaluation",
    "EVALUATION":   "Complete evaluation and raise the NFA",
    "NFA_PENDING":  "Approve or return the NFA",
    "NFA_APPROVED": "Create the PO",
    "PO_CREATED":   "Release the PO",
    "PO_RELEASED":  "Chase delivery",
    "RECEIVED":     "Obtain and pass the invoice",
    "INVOICED":     "Release payment",
    "PAID":         "Confirm closure",
}


_CREDIT_DAYS = re.compile(r"(\d{1,3})\s*day", re.IGNORECASE)


def credit_days(term_desc: str | None) -> int | None:
    """Credit days stated by the payment term, or None when it does not say.

    SAP's own due_payment column is empty throughout this plant, so a due
    date has to come from the term text: 'FT-100%-15day', '100% payment
    within 15 days'. Where the term states a number this reads it; where it
    says 'AS PER THE NOTE' or '100% advance against PI' it returns None and
    the item is reported as terms-not-parsed rather than assumed due today.

    Guessing zero here would turn every unparsed term into overdue payable,
    which is the one number Finance will check first.
    """
    if not term_desc:
        return None
    m = _CREDIT_DAYS.search(term_desc)
    if m:
        return int(m.group(1))
    if "advance" in term_desc.lower():
        return 0          # payable before despatch; due the moment invoiced
    return None


def pending_owner(r: dict[str, Any], stage: str) -> str | None:
    """Who the case is sitting WITH -- not who was assigned to it.

    The requirements keep assigned buyer and current pending owner apart on
    purpose: a PR assigned to a buyer but waiting on an approver is pending
    with the approver, and reporting the buyer there hides the queue.
    """
    if stage == "NFA_PENDING":
        # The approver by name where the employee master knows the address,
        # the address itself otherwise -- never nothing, because "pending
        # with nobody" is the answer that stops a case being chased.
        return r.get("approver_name") or r.get("nfa_approver")
    if stage in {"RFQ_ISSUED", "QUOTES_IN"}:
        return r.get("vendor_name") or "Vendor"
    if stage in {"RECEIVED", "INVOICED"}:
        return "Accounts"
    if stage == "UNASSIGNED":
        return "SCM lead"
    # P26 means nothing outside SCM. Fall back to the code only when the
    # purchasing group has no name against it.
    pg = (r.get("purchasing_group") or "").strip()
    return r.get("buyer_name") or (f"Buyer {pg}" if pg else None)


def shape(r: dict[str, Any], as_on: date) -> dict[str, Any]:
    """One register row, with everything derived that the screen needs."""
    stage, since = derive_stage(r)
    po_value = float(r["po_value"]) if r.get("po_value") is not None else None
    invoiced = float(r["invoice_value"]) if r.get("invoice_value") is not None else None
    paid = float(r["paid_amount"]) if r.get("paid_amount") is not None else None

    # Outstanding is invoiced minus paid, NOT PO value minus paid: a PO that
    # has not been invoiced is not money currently owed, and the requirements
    # say so in as many words.
    outstanding = None
    if invoiced is not None:
        outstanding = round(invoiced - (paid or 0.0), 2)

    # WHEN THE MONEY IS DUE, where the term says so. Measured from the last
    # invoice posting, because that is the event the credit period runs from.
    days = credit_days(r.get("payment_terms_desc"))
    inv_date = _as_date(r.get("last_invoice_date"))
    due_date = inv_date + timedelta(days=days) if (inv_date and days is not None) else None
    overdue_payable = None
    if outstanding and outstanding > 0:
        if due_date is not None:
            overdue_payable = outstanding if due_date < as_on else 0.0
        # due_date None means the term did not state a period. The balance is
        # outstanding but its due date is unknown, and unknown is not overdue.

    return {
        "pr_number": r["pr_number"],
        "pr_item": r["pr_item"],
        "description": r.get("short_text"),
        "pr_date": _as_date(r.get("requisition_date")),
        "release_date": _as_date(r.get("pr_release_date")),
        "quantity": float(r["quantity"]) if r.get("quantity") is not None else None,
        "unit": r.get("base_unit"),
        "pr_value": float(r["net_value"]) if r.get("net_value") is not None else None,
        "currency": r.get("currency_key"),

        "created_by": r.get("created_by"),
        "requisitioner": r.get("requisitioner"),
        "plant": r.get("plant"),
        "cost_center": r.get("cost_center"),
        "material": r.get("material_no"),
        "material_group": r.get("material_group_desc"),

        "purchasing_group": (r.get("purchasing_group") or "").strip() or None,
        "stage": stage,
        "stage_label": STAGE_LABELS.get(stage, stage),
        "stage_since": since,
        "stage_age_days": _age(since, as_on),
        "pr_age_days": _age(r.get("pr_release_date"), as_on),
        "pending_with": pending_owner(r, stage),
        "next_action": NEXT_ACTION.get(stage),

        "rfq_count": r.get("rfq_count"),
        "rfq_vendors": r.get("rfq_vendors"),
        "rfq_issued_at": _as_date(r.get("rfq_issued_at")),
        "rfq_deadline": _as_date(r.get("rfq_deadline")),
        "quotation_count": r.get("quotation_count"),
        "tech_submissions": r.get("tech_submissions"),

        "nfa_id": r.get("nfa_id"),
        "nfa_status": r.get("nfa_status"),
        "nfa_level": r.get("nfa_level"),
        "nfa_approver": r.get("nfa_approver"),
        "nfa_pending_since": _as_date(r.get("nfa_pending_since")),
        "nfa_pending_days": _age(r.get("nfa_pending_since"), as_on),

        "po_no": r.get("po_no") or r.get("pr_po_no"),
        "po_items": r.get("po_item_count"),
        "po_date": _as_date(r.get("po_date")),
        "po_release_date": _as_date(r.get("po_release_date")),
        "vendor": r.get("vendor_name"),
        "po_value": po_value,
        "po_currency": r.get("po_currency"),
        "payment_terms": r.get("payment_terms"),
        "po_delivery_date": _as_date(r.get("po_delivery_date")),
        "delivery_complete": (r.get("delivery_complete") or "").strip() == "X",

        "gr_qty": float(r["gr_qty"]) if r.get("gr_qty") is not None else None,
        "po_qty": float(r["po_qty"]) if r.get("po_qty") is not None else None,
        "last_gr_date": _as_date(r.get("last_gr_date")),

        "buyer_name": r.get("buyer_name"),
        "buyer_department": r.get("buyer_department"),
        "approver_name": r.get("approver_name"),
        "approver_dept": r.get("approver_dept"),
        "payment_terms_desc": r.get("payment_terms_desc"),

        "invoiced_value": invoiced,
        "invoice_docs": r.get("invoice_docs"),
        "last_invoice_date": _as_date(r.get("last_invoice_date")),
        "paid_amount": paid,
        "last_payment_date": _as_date(r.get("last_payment_date")),
        "outstanding": outstanding,
        "due_date": due_date,
        "overdue_payable": overdue_payable,
        "terms_parsed": days is not None,
    }


def register(db: Session, as_on: date, from_date: date,
             plants: list[str]) -> list[dict[str, Any]]:
    rows = db.execute(text(REGISTER_SQL),
                      {"plants": plants, "from_date": from_date}).mappings().all()
    return [shape(dict(r), as_on) for r in rows]
