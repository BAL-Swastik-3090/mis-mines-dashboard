"""The HOTO register — the record, not a dashboard.

This is what gets opened when there is an argument: which machine, who signed,
when, what they found, and what was done about it. So it reads chronologically
and completely, and it shows the checklist AS ANSWERED rather than as it stands
today.

── WHY THE ANSWERS ARE NOT JOINED TO THE LIVE CHECKLIST ─────────────────────
`hoto_response` copies the item's label, its response type and the severity
resolved at capture. A register built by joining back to `hoto_checklist_item`
would show today's wording against last March's answer, and a retired item would
vanish from a record that definitely answered it. So the register reads the
copies, and only consults the template to say which version was in force.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def search(db: Session, *,
           from_date: date | None = None,
           to_date: date | None = None,
           asset_id: int | None = None,
           operator_id: int | None = None,
           status: str | None = None,
           session_type: str | None = None,
           only_adverse: bool = False,
           limit: int = 200) -> list[dict[str, Any]]:
    """Handovers, newest first.

    `only_adverse` is the filter people actually want: a register of clean
    handovers is long and says nothing, and the reason anybody opens this is
    usually that something was found.
    """
    rows = db.execute(text("""
        SELECT s.session_id, s.session_ref, s.client_uuid,
               s.session_type, s.sequence_no, s.status,
               s.captured_at, s.received_at, s.captured_offline,
               s.confirmed_by, s.confirmed_at,
               s.blocked_reason, s.reject_reason,
               s.meter_reading, s.meter_uom, s.fuel_level,
               s.gps_status, s.remarks,
               s.template_id, s.template_version,
               a.asset_id, a.fleet_code, at.name AS asset_type_name,
               o.operator_id, COALESCE(p.display_name, p.legal_name) AS operator_name,
               s.operator_emp_id,
               -- Migration 115. NULL and not absent means NOT RECORDED, which
               -- is every handover filed before it -- never shown as "nobody".
               s.counterpart_operator_id, s.counterpart_emp_id, s.counterpart_absent,
               COALESCE(cp.display_name, cp.legal_name) AS counterpart_name,
               s.recorded_by_operator_id, s.recorded_by_emp_id,
               COALESCE(rp.display_name, rp.legal_name) AS recorded_by_name,
               s.counterpart_session_id,
               -- SENT, at last. The Shift column has read these since 13 Nov
               -- and this query never selected them, so every row showed a
               -- dash while all thirty handovers had a shift stored.
               s.shift_code, s.production_day, s.bulk_answered,
               s.captured_lat, s.captured_lon, s.gps_accuracy_m,
               -- The other half of the handover, and on how many checks the
               -- two disagree about whether there was a fault. COALESCE:
               -- in_range is NULL on a check with no range, and NULL IS
               -- DISTINCT FROM false would count every such check as a
               -- disagreement.
               cs.session_ref AS counterpart_ref, cs.session_type AS counterpart_type,
               (SELECT count(*) FROM hoto_response r1
                  JOIN hoto_response r2 ON r2.item_id = r1.item_id
                                       AND r2.session_id = s.counterpart_session_id
                 WHERE r1.session_id = s.session_id
                   AND COALESCE(r1.severity IS NOT NULL OR r1.answer IN ('NOT_OK','CAUTION') OR r1.in_range = false, false)
                       IS DISTINCT FROM COALESCE(r2.severity IS NOT NULL OR r2.answer IN ('NOT_OK','CAUTION') OR r2.in_range = false, false)
               ) AS pair_differs,
               l.name AS location_name,
               d.device_code, d.profile AS device_profile,
               -- Resolved at capture and stored, so this is what the handover
               -- actually said, not what today's limits would make of it.
               (SELECT count(*) FROM hoto_response r
                 WHERE r.session_id = s.session_id
                   -- An answer with a severity is a fault: set at capture, on a
                   -- fault only. The answer-text test alone never counted a
                   -- yes/no fault. See hoto_defects.raise_from_session.
                   AND (r.severity IS NOT NULL
                        OR r.answer IN ('NOT_OK','CAUTION') OR r.in_range = false)) AS adverse_count,
               -- NOT max(r.severity): severity is text, so max() sorts it
               -- alphabetically and MEDIUM comes out above CRITICAL. This
               -- column read wrong from the day it was written.
               (SELECT r.severity FROM hoto_response r
                 WHERE r.session_id = s.session_id AND r.severity IS NOT NULL
                 ORDER BY CASE r.severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3
                                          WHEN 'MEDIUM' THEN 2 ELSE 1 END DESC
                 LIMIT 1) AS worst_severity,
               (SELECT count(*) FROM hoto_response r WHERE r.session_id = s.session_id) AS answer_count,
               (SELECT COALESCE(sum(r.photo_count), 0) FROM hoto_response r
                 WHERE r.session_id = s.session_id) AS photo_count
          FROM hoto_session s
          JOIN asset a       ON a.asset_id = s.asset_id
          JOIN asset_type at ON at.asset_type_id = a.asset_type_id
          LEFT JOIN operator o ON o.operator_id = s.operator_id
          LEFT JOIN party p    ON p.party_id = o.party_id
          LEFT JOIN operator co ON co.operator_id = s.counterpart_operator_id
          LEFT JOIN party cp    ON cp.party_id = co.party_id
          LEFT JOIN operator ro ON ro.operator_id = s.recorded_by_operator_id
          LEFT JOIN party rp    ON rp.party_id = ro.party_id
          LEFT JOIN hoto_session cs ON cs.session_id = s.counterpart_session_id
          LEFT JOIN location l ON l.location_id = s.location_id
          LEFT JOIN hoto_device d ON d.device_id = s.device_id
         WHERE (CAST(:frm AS date) IS NULL OR s.captured_at >= CAST(:frm AS date))
           AND (CAST(:to  AS date) IS NULL OR s.captured_at <  CAST(:to AS date) + 1)
           AND (CAST(:asset AS bigint)    IS NULL OR s.asset_id    = CAST(:asset AS bigint))
           AND (CAST(:op    AS bigint)    IS NULL OR s.operator_id = CAST(:op AS bigint))
           AND (CAST(:status AS text)     IS NULL OR s.status      = CAST(:status AS text))
           AND (CAST(:stype AS text)      IS NULL OR s.session_type = CAST(:stype AS text))
           AND (NOT :adverse OR EXISTS (
                 SELECT 1 FROM hoto_response r
                  WHERE r.session_id = s.session_id
                    AND (r.severity IS NOT NULL
                         OR r.answer IN ('NOT_OK','CAUTION') OR r.in_range = false)))
         ORDER BY s.captured_at DESC, s.session_id DESC
         LIMIT :lim
    """), {"frm": from_date, "to": to_date, "asset": asset_id, "op": operator_id,
           "status": status, "stype": session_type, "adverse": only_adverse,
           "lim": min(limit, 1000)}).mappings().all()
    return [_row(r) for r in rows]


def _row(r) -> dict[str, Any]:
    d = dict(r)
    # EVERY numeric, not a remembered subset.
    #
    # Postgres numeric arrives as a Decimal and serialises to a JSON STRING
    # unless it is converted here. meter_reading and fuel_level were on this
    # list and the coordinates were not, so a caller got 50.0 for one and
    # "21.0346752" for the other -- and a screen that quite reasonably called
    # .toFixed() on a latitude crashed on the first handover that had one.
    # A list of names is exactly the kind of thing that goes stale when a
    # column is added; this is the whole set.
    for k in ("meter_reading", "fuel_level",
              "captured_lat", "captured_lon", "gps_accuracy_m"):
        if d.get(k) is not None:
            d[k] = float(d[k])
    d["client_uuid"] = str(d["client_uuid"]) if d.get("client_uuid") else None
    # The gap between the two clocks. A handover that reached us six hours
    # after the moment it describes is a normal offline capture, but somebody
    # reading the register should be able to see that rather than infer it.
    if d.get("captured_at") and d.get("received_at"):
        d["sync_delay_minutes"] = round(
            (d["received_at"] - d["captured_at"]).total_seconds() / 60)
    return d


def detail(db: Session, session_id: int) -> dict[str, Any] | None:
    """One handover in full, with every answer as it was given."""
    head = db.execute(text("""
        SELECT s.*, a.fleet_code, at.name AS asset_type_name,
               COALESCE(p.display_name, p.legal_name) AS operator_name,
               l.name AS location_name, d.device_code, d.profile AS device_profile,
               t.name AS template_name,
               cs.session_ref AS counterpart_ref, cs.session_type AS counterpart_type,
               cs.status AS counterpart_status, cs.captured_at AS counterpart_captured_at,
               cs.operator_id AS counterpart_session_operator_id,
               cs.counterpart_operator_id AS counterpart_session_named_id,
               COALESCE(csp.display_name, csp.legal_name) AS counterpart_session_operator_name,
               COALESCE(cp.display_name, cp.legal_name) AS counterpart_name,
               COALESCE(rp.display_name, rp.legal_name) AS recorded_by_name
          FROM hoto_session s
          JOIN asset a       ON a.asset_id = s.asset_id
          JOIN asset_type at ON at.asset_type_id = a.asset_type_id
          LEFT JOIN operator o ON o.operator_id = s.operator_id
          LEFT JOIN party p    ON p.party_id = o.party_id
          LEFT JOIN location l ON l.location_id = s.location_id
          LEFT JOIN hoto_device d ON d.device_id = s.device_id
          LEFT JOIN hoto_checklist_template t ON t.template_id = s.template_id
          LEFT JOIN hoto_session cs ON cs.session_id = s.counterpart_session_id
          LEFT JOIN operator cso ON cso.operator_id = cs.operator_id
          LEFT JOIN party csp    ON csp.party_id = cso.party_id
          LEFT JOIN operator co  ON co.operator_id = s.counterpart_operator_id
          LEFT JOIN party cp     ON cp.party_id = co.party_id
          LEFT JOIN operator ro  ON ro.operator_id = s.recorded_by_operator_id
          LEFT JOIN party rp     ON rp.party_id = ro.party_id
         WHERE s.session_id = :s
    """), {"s": session_id}).mappings().first()
    if not head:
        return None

    # The answers, grouped by the section they were asked in. Joined to the
    # section only for its NAME and ORDER -- the label, type and severity come
    # from the response's own copies.
    answers = db.execute(text("""
        SELECT r.response_id, r.item_id, r.item_label, r.response_type,
               r.answer, r.numeric_value, r.in_range, r.severity,
               r.remark, r.photo_count,
               i.unit, i.min_value, i.max_value, i.is_critical,
               sec.name AS section_name, sec.display_order AS section_order,
               i.display_order AS item_order
          FROM hoto_response r
          LEFT JOIN hoto_checklist_item i ON i.item_id = r.item_id
          LEFT JOIN hoto_checklist_section sec ON sec.section_id = i.section_id
         WHERE r.session_id = :s
         ORDER BY sec.display_order NULLS LAST, i.display_order NULLS LAST, r.response_id
    """), {"s": session_id}).mappings().all()

    sections: list[dict[str, Any]] = []
    for a in answers:
        name = a["section_name"] or "Other"
        if not sections or sections[-1]["name"] != name:
            sections.append({"name": name, "answers": []})
        row = dict(a)
        for k in ("numeric_value", "min_value", "max_value"):
            if row.get(k) is not None:
                row[k] = float(row[k])
        # Same rule as the list and as defect raising: a severity is a fault.
        row["is_adverse"] = (row["severity"] is not None
                             or row["answer"] in ("NOT_OK", "CAUTION")
                             or row["in_range"] is False)
        sections[-1]["answers"].append(row)

    out = _row(head)
    out["sections"] = sections
    out["adverse"] = [a for s in sections for a in s["answers"] if a["is_adverse"]]
    out["comparison"] = (_compare(db, sections, head["counterpart_session_id"])
                         if head.get("counterpart_session_id") else None)
    return out


def _is_fault(a) -> bool:
    return (a["severity"] is not None or a["answer"] in ("NOT_OK", "CAUTION")
            or a["in_range"] is False)


def _said(a) -> str:
    """One answer as somebody would read it: "Not OK -- hose weeping"."""
    if a["numeric_value"] is not None:
        what = f"{float(a['numeric_value']):g}"
    else:
        what = (a["answer"] or "no answer").replace("_", " ").capitalize()
        what = {"Not ok": "Not OK", "Ok": "OK", "Na": "N/A"}.get(what, what)
    return f"{what} — {a['remark']}" if a.get("remark") else what


def _compare(db: Session, mine_sections, other_id: int) -> dict[str, Any]:
    """This half against the other, check by check.

    ── WHY ───────────────────────────────────────────────────────────────────
    The question a handover exists to answer: did the person going off and
    the person coming on say the same thing about this machine? A fault found
    on taking over that the handing-over operator did not report is either
    something that happened in the gap between them, or something one of
    them did not look at -- and either way it is the most useful line in the
    register. Until pairing (migration 115) nothing could even ask.

    Only checks BOTH halves answered are compared. A check one half was not
    asked -- a different checklist version -- is counted, not judged.
    """
    theirs = db.execute(text("""
        SELECT r.item_id, r.item_label, r.answer, r.numeric_value, r.in_range,
               r.severity, r.remark
          FROM hoto_response r WHERE r.session_id = :s
    """), {"s": other_id}).mappings().all()
    other = {t["item_id"]: dict(t) for t in theirs}
    mine = {a["item_id"]: a for sec in mine_sections for a in sec["answers"]}

    both = [i for i in mine if i in other]
    differ, both_found = [], []
    for i in both:
        m, t = mine[i], other[i]
        if t.get("numeric_value") is not None:
            t["numeric_value"] = float(t["numeric_value"])
        mf, tf = _is_fault(m), _is_fault(t)
        if mf and tf:
            both_found.append({"item_label": m["item_label"], "this": _said(m), "other": _said(t)})
        elif mf != tf:
            differ.append({"item_label": m["item_label"], "this": _said(m), "other": _said(t),
                           "this_found": mf, "other_found": tf,
                           "severity": m["severity"] or t.get("severity")})
    # Worst first: a critical fault one side did not report leads.
    rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, None: 4}
    differ.sort(key=lambda d: rank.get(d["severity"], 4))
    return {
        "compared": len(both),
        "agree": len(both) - len(differ),
        "differ": differ,
        "both_found": both_found,
        "only_this_asked": len([i for i in mine if i not in other]),
        "only_other_asked": len([i for i in other if i not in mine]),
    }


def compliance(db: Session, from_date: date, to_date: date) -> dict[str, Any]:
    """How many handovers happened against how many should have.

    THE FIRST REPORT TO BUILD, and the reason is uncomfortable: a HOTO system
    used on half the handovers produces a register whose SILENCES look like
    clean shifts. A reader cannot tell "nothing was wrong" from "nobody filled
    it in", and the second is the more common.

    What counts as "should have" is the open question -- see docs/hoto-scope.md
    section 9, item 2. Until the mine answers it, this reports what IS there and
    is explicit that the denominator is unsettled rather than quietly assuming
    one.
    """
    got = db.execute(text("""
        SELECT s.session_type, s.status, count(*) AS n,
               count(DISTINCT s.asset_id) AS machines,
               count(*) FILTER (WHERE s.captured_offline) AS offline
          FROM hoto_session s
         WHERE s.captured_at >= :frm AND s.captured_at < CAST(:to AS date) + 1
         GROUP BY 1, 2 ORDER BY 1, 2
    """), {"frm": from_date, "to": to_date}).mappings().all()

    machines = db.execute(text("""
        SELECT count(*) FROM asset WHERE status = 'ACTIVE'
    """)).scalar()

    blocked = db.execute(text("""
        SELECT count(*) FROM hoto_session
         WHERE status = 'BLOCKED' AND captured_at >= :frm
           AND captured_at < CAST(:to AS date) + 1
    """), {"frm": from_date, "to": to_date}).scalar()

    return {
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "by_type": [dict(r) for r in got],
        "captured": sum(r["n"] for r in got),
        "blocked": blocked,
        "active_machines": machines,
        # Stated, not computed. Three shifts a day times active machines is a
        # denominator that assumes every machine is manned every shift, which it
        # is not -- and publishing a compliance percentage against a wrong
        # denominator is worse than publishing none.
        "denominator_unsettled": True,
        "note": ("Expected-handover count is not yet agreed. Until the mine "
                 "decides what a missing handover means, this reports what was "
                 "captured rather than a percentage of a guessed total."),
    }
