# A deleted purchase order still reads as live

Raised 06 November 2026, from PO 6200004111 (PR 1200000189 item 00100),
deleted in SAP and still showing in PR to Payment as an open order.

## What is wrong

The PO extract does not carry SAP's deletion indicator (`EKPO-LOEKZ`).
The column exists and is always empty.

| Table | Rows | Rows with a deletion flag |
|---|---:|---:|
| `crm.scm_purchase_order` | 22,450 | **0** |
| `sap_odata_api.scm_purchase_order` | 22,450 | **0** |
| `crm.scm_purchase_requisition` | 27,139 | 1,507 |
| `sap_odata_api.scm_purchase_requisition` | 27,139 | 1,507 |

`sap_odata_api` is a mirror of `crm`; both agree, so the gap is upstream of
both. The requisition rows prove the pipeline carries the field perfectly
well when SAP sends it — this is a missing mapping on the PO feed, not a
limitation of the sync.

The extract is not stale: its newest `changed_on` is the current date.

## Why no application can work around it

A deleted PO item is indistinguishable from a healthy open one in these
columns. PO 6200004111 has its full `still_del_qty`, no goods receipt, no
`scm_po_history` rows and no payment — exactly like an order placed
yesterday. `release_state` is null, but so is every PO awaiting release, so
it cannot be used: it would hide live orders.

Every consumer of this extract has the same blind spot, not just the Mines
dashboard. The filter in `backend/app/services/pr_po.py` reads
`COALESCE(p.delete_indicator, '') <> 'X'` and has never excluded a row.

## What needs to happen

Whoever owns the feed into `crm.scm_purchase_order` must map `EKPO-LOEKZ`
into `DELETE_INDICATOR`, the way the requisition feed already does. Nothing
in this repository needs to change once it arrives — the filter is already
in place and will begin working the day the column is populated.

Not in `D:\Projects\sap_sync`: that project does not mention the table or
the field.

## Fixed here in the meantime

A PR item can carry several POs — one raised, deleted, and raised again.
The register was grouping by PR item and taking `min()`/`max()` of each
column independently, so a row described no single order: the PO number
came from the oldest PO and the release state from the newest. 114 Mines
PR items have more than one PO and 93 named the wrong one. The query now
picks one PO per PR item — released, then latest, then highest number —
and reads every field from it. See commit `45eb1bb`.

That does not help a PR item whose only PO was deleted, which is the case
above. That one waits on the extract.
