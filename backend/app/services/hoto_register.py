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
               l.name AS location_name,
               d.device_code, d.profile AS device_profile,
               -- Resolved at capture and stored, so this is what the handover
               -- actually said, not what today's limits would make of it.
               (SELECT count(*) FROM hoto_response r
                 WHERE r.session_id = s.session_id
                   AND (r.answer IN ('NOT_OK','CAUTION') OR r.in_range = false)) AS adverse_count,
               (SELECT max(r.severity) FROM hoto_response r
                 WHERE r.session_id = s.session_id AND r.severity IS NOT NULL) AS worst_severity,
               (SELECT count(*) FROM hoto_response r WHERE r.session_id = s.session_id) AS answer_count,
               (SELECT COALESCE(sum(r.photo_count), 0) FROM hoto_response r
                 WHERE r.session_id = s.session_id) AS photo_count
          FROM hoto_session s
          JOIN asset a       ON a.asset_id = s.asset_id
          JOIN asset_type at ON at.asset_type_id = a.asset_type_id
          LEFT JOIN operator o ON o.operator_id = s.operator_id
          LEFT JOIN party p    ON p.party_id = o.party_id
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
                    AND (r.answer IN ('NOT_OK','CAUTION') OR r.in_range = false)))
         ORDER BY s.captured_at DESC, s.session_id DESC
         LIMIT :lim
    """), {"frm": from_date, "to": to_date, "asset": asset_id, "op": operator_id,
           "status": status, "stype": session_type, "adverse": only_adverse,
           "lim": min(limit, 1000)}).mappings().all()
    return [_row(r) for r in rows]


def _row(r) -> dict[str, Any]:
    d = dict(r)
    for k in ("meter_reading", "fuel_level"):
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
               cs.status AS counterpart_status
          FROM hoto_session s
          JOIN asset a       ON a.asset_id = s.asset_id
          JOIN asset_type at ON at.asset_type_id = a.asset_type_id
          LEFT JOIN operator o ON o.operator_id = s.operator_id
          LEFT JOIN party p    ON p.party_id = o.party_id
          LEFT JOIN location l ON l.location_id = s.location_id
          LEFT JOIN hoto_device d ON d.device_id = s.device_id
          LEFT JOIN hoto_checklist_template t ON t.template_id = s.template_id
          LEFT JOIN hoto_session cs ON cs.session_id = s.counterpart_session_id
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
        row["is_adverse"] = (row["answer"] in ("NOT_OK", "CAUTION")
                             or row["in_range"] is False)
        sections[-1]["answers"].append(row)

    out = _row(head)
    out["sections"] = sections
    out["adverse"] = [a for s in sections for a in s["answers"] if a["is_adverse"]]
    return out


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
