"""Taking a captured handover from a device.

── THE RULES ARE EVALUATED TWICE, ON PURPOSE ────────────────────────────────
The device evaluates at the machine, because an operator who fails the brake
check has to be told there and then -- telling him when the tablet reaches the
gate is useless, the machine has already been driven. The server evaluates
again here.

They should agree. The inputs are identical: the item carries its own range and
severity (migration 105), and `mobile/src/core/evaluation.ts` implements the
same rules as `_evaluate_one` below. Two implementations of one specification
is a deliberate cost of working offline, not an accident.

WHEN THEY DISAGREE, THE SERVER WINS AND THE DIFFERENCE IS RECORDED. It is never
smoothed over. A capture whose verdict changed on arrival means either the
device is running old rules or a template moved under it, and both are things a
supervisor needs to see rather than discover from a machine that went to work
when it should not have.

── IDEMPOTENCY ──────────────────────────────────────────────────────────────
`client_uuid` is generated on the device at the moment of capture. A retry
after a dropped connection carries the same one, so the same handover cannot be
filed twice. Replaying an identical capture returns the original record. Reusing
the key with *different* content is a conflict, not an update -- somebody would
be rewriting a signed record.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ADVERSE_ANSWERS = {"NOT_OK", "CAUTION"}
VALID_ANSWERS = {
    "OK_CAUTION_NOTOK": {"OK", "CAUTION", "NOT_OK", "NA"},
    "YES_NO": {"YES", "NO", "NA"},
    "LEVEL": {"LOW", "NORMAL", "HIGH", "NA"},
    "NUMERIC": set(),
}
SEVERITY_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}


class CaptureError(ValueError):
    """The capture cannot be accepted, with every problem rather than the first
    -- a device that has to round-trip once per mistake is a device nobody
    uses."""

    def __init__(self, problems: list[str], status: int = 422):
        self.problems = problems
        self.status = status
        super().__init__("; ".join(problems))


class CaptureConflict(ValueError):
    """The same client_uuid arrived carrying different content."""


# ── the rules ────────────────────────────────────────────────────────────────

def _num(v: Any) -> str:
    f = float(v)
    return str(int(f)) if f == int(f) else str(f)


def _range_label(item: dict) -> str | None:
    lo, hi, unit = item["min_value"], item["max_value"], item["unit"]
    if lo is None and hi is None:
        return None
    u = f" {unit}" if unit else ""
    if lo is not None and hi is not None:
        return f"{_num(lo)}–{_num(hi)}{u}"
    return f"≥ {_num(lo)}{u}" if lo is not None else f"≤ {_num(hi)}{u}"


def _evaluate_one(item: dict, raw: dict) -> dict:
    """One answer against its item. Mirrors `evaluateOne` in evaluation.ts."""
    problems: list[str] = []
    in_range: bool | None = None
    adverse = False

    answer = raw.get("answer")
    numeric = raw.get("numeric_value")
    if answer is None and numeric is None:
        return {"item": item, "raw": raw, "adverse": False, "in_range": None,
                "severity": None, "problems": ["Not answered"], "blocks": False}

    if item["response_type"] == "NUMERIC":
        if numeric is None:
            problems.append("Needs a reading")
        elif item["min_value"] is not None or item["max_value"] is not None:
            # An unbounded numeric is recorded, not judged. Boom pressure has no
            # range in the mine's own list, and inventing one here would start
            # blocking machines on a limit nobody agreed.
            lo, hi = item["min_value"], item["max_value"]
            in_range = ((lo is None or float(numeric) >= float(lo)) and
                        (hi is None or float(numeric) <= float(hi)))
            adverse = not in_range
    else:
        allowed = VALID_ANSWERS[item["response_type"]]
        if answer not in allowed:
            problems.append(f"{answer} is not an answer to a {item['response_type']} item")
        elif answer == "NA":
            # A critical item cannot be waved away. If the extinguisher
            # genuinely does not apply to this machine, that is a template
            # correction in the admin panel, not a tap in a cab.
            if item["is_critical"]:
                problems.append("A critical item cannot be marked Not applicable")
        else:
            adverse = answer in ADVERSE_ANSWERS

    if adverse:
        if not (raw.get("remark") or "").strip():
            problems.append("Say what is wrong")
        if item["requires_photo_if_not_ok"] and int(raw.get("photo_count") or 0) == 0:
            problems.append("Add a photo")

    return {
        "item": item, "raw": raw,
        "adverse": adverse,
        "in_range": in_range,
        "severity": item["default_severity"] if adverse else None,
        "problems": problems,
        "blocks": adverse and item["is_critical"],
    }


def evaluate(items: list[dict], answers: dict[int, dict]) -> dict:
    """A whole session. Mirrors `evaluateSession` in evaluation.ts."""
    evaluated, unanswered, problems = [], [], []

    for item in items:
        raw = answers.get(item["item_id"])
        if not raw or (raw.get("answer") is None and raw.get("numeric_value") is None):
            unanswered.append(item)
            continue
        ev = _evaluate_one(item, raw)
        evaluated.append(ev)
        problems.extend(f"{item['label']}: {p}" for p in ev["problems"])

    blocking = [e for e in evaluated if e["blocks"]]
    adverse = [e for e in evaluated if e["adverse"]]

    highest = None
    for e in adverse:
        s = e["severity"]
        if s and (highest is None or SEVERITY_RANK[s] > SEVERITY_RANK[highest]):
            highest = s

    reason = None
    if blocking:
        parts = []
        for e in blocking:
            it, raw = e["item"], e["raw"]
            if it["response_type"] == "NUMERIC" and raw.get("numeric_value") is not None:
                parts.append(f"{it['label']} {_num(raw['numeric_value'])}"
                             f"{it['unit'] or ''} outside {_range_label(it)}")
            else:
                parts.append(f"{it['label']} {str(raw.get('answer','')).replace('_',' ').lower()}")
        reason = "; ".join(parts)

    return {
        "responses": evaluated,
        "blocking": blocking,
        "adverse_count": len(adverse),
        "highest_severity": highest,
        "unanswered": unanswered,
        "problems": problems,
        "is_blocked": bool(blocking),
        "blocked_reason": reason,
    }


# ── taking a capture ─────────────────────────────────────────────────────────

def _items_for(db: Session, template_id: int) -> list[dict]:
    rows = db.execute(text("""
        SELECT i.item_id, i.label, i.response_type, i.unit, i.min_value, i.max_value,
               i.is_critical, i.requires_photo_if_not_ok, i.default_severity
          FROM hoto_checklist_item i
          JOIN hoto_checklist_section s ON s.section_id = i.section_id
         WHERE s.template_id = :t AND i.status = 'ACTIVE'
         ORDER BY s.display_order, i.display_order
    """), {"t": template_id}).mappings().all()
    return [dict(r) for r in rows]


def _existing(db: Session, client_uuid: str) -> dict | None:
    row = db.execute(text("""
        SELECT session_id, session_ref, client_uuid, asset_id, session_type, status,
               blocked_reason, confirmed_at, received_at
          FROM hoto_session WHERE client_uuid = CAST(:u AS uuid)
    """), {"u": client_uuid}).mappings().first()
    return dict(row) if row else None


def submit(db: Session, payload: dict[str, Any], actor: str) -> dict[str, Any]:
    """Accept one captured session.

    Returns `{"created": bool, ...}` — `created=False` means this capture had
    already been filed and the original is being returned unchanged, which is
    what a device's retry should see.
    """
    if not actor:
        raise CaptureError(["no employee id on the request"])

    client_uuid = payload.get("client_uuid")
    if not client_uuid:
        raise CaptureError(["client_uuid is required — it is what makes a retry safe"])

    # ── already filed? ───────────────────────────────────────────────────────
    prior = _existing(db, client_uuid)
    if prior:
        # Identical replay: hand back the original. Different content under the
        # same key would be rewriting a signed record, so that is a conflict.
        same = (prior["asset_id"] == payload.get("asset_id")
                and prior["session_type"] == payload.get("session_type"))
        if not same:
            raise CaptureConflict(
                f"client_uuid {client_uuid} already filed as {prior['session_ref']} "
                f"for a different machine or session type")
        return {"created": False, **prior}

    problems: list[str] = []
    asset_id = payload.get("asset_id")
    session_type = payload.get("session_type")
    if not asset_id:
        problems.append("asset_id is required")
    if session_type not in ("START_HANDOVER", "MID_SHIFT", "END_HANDOVER"):
        problems.append("session_type must be START_HANDOVER, MID_SHIFT or END_HANDOVER")
    if not payload.get("captured_at"):
        problems.append("captured_at is required — the device's own clock reading")
    if problems:
        raise CaptureError(problems)

    asset = db.execute(text("""
        SELECT a.asset_id, a.asset_type_id, a.current_reading, a.reading_uom, a.plant_id
          FROM asset a WHERE a.asset_id = :a
    """), {"a": asset_id}).mappings().first()
    if not asset:
        raise CaptureError([f"no such machine: {asset_id}"], status=404)

    # ── the template, as resolved for the production day ────────────────────
    from app.services import hoto_masters as masters
    on_date = payload.get("production_day")
    if isinstance(on_date, str):
        on_date = date.fromisoformat(on_date)
    head = masters.resolve_template(db, asset["asset_type_id"],
                                    plant_id=asset["plant_id"], on_date=on_date)
    if not head:
        raise CaptureError(
            ["no active checklist is published for this machine type"], status=409)

    # A DEVICE MAY NOT CHOOSE ITS OWN TEMPLATE. If it answered a version other
    # than the one in force, that is recorded and the capture still accepted --
    # refusing it would throw away a handover that actually happened -- but the
    # divergence is raised.
    claimed_tpl = payload.get("template_id")
    claimed_ver = payload.get("template_version")
    template_drift = (claimed_tpl is not None and claimed_tpl != head["template_id"]) or \
                     (claimed_ver is not None and claimed_ver != head["version"])

    items = _items_for(db, head["template_id"])
    answers = {int(r["item_id"]): r for r in (payload.get("responses") or [])}
    verdict = evaluate(items, answers)

    # ── did the device reach the same verdict? ──────────────────────────────
    device_status = payload.get("status")
    server_status = "BLOCKED" if verdict["is_blocked"] else (
        device_status if device_status in ("ACCEPTED", "REJECTED", "SUBMITTED") else "SUBMITTED")
    if verdict["is_blocked"] and device_status in ("ACCEPTED", "SUBMITTED"):
        verdict_drift = True
    elif not verdict["is_blocked"] and device_status == "BLOCKED":
        verdict_drift = True
    else:
        verdict_drift = False

    if verdict["unanswered"]:
        raise CaptureError(
            [f"unanswered: {i['label']}" for i in verdict["unanswered"]])
    if verdict["problems"]:
        raise CaptureError(verdict["problems"])

    # ── store it ────────────────────────────────────────────────────────────
    seq = db.execute(text("""
        SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM hoto_session
         WHERE asset_id = :a AND shift_instance_id IS NOT DISTINCT FROM :s
           AND session_type = :t
    """), {"a": asset_id, "s": payload.get("shift_instance_id"),
           "t": session_type}).scalar()

    row = db.execute(text("""
        INSERT INTO hoto_session
            (client_uuid, asset_id, shift_instance_id, deployment_id, session_type,
             sequence_no, operator_id, operator_emp_id, template_id, template_version,
             meter_reading, meter_uom, fuel_level, location_id, status, blocked_reason,
             reject_reason, confirmed_by, confirmed_at, device_id, captured_at,
             captured_offline, captured_lat, captured_lon, gps_accuracy_m, gps_status,
             remarks, created_by)
        VALUES (CAST(:u AS uuid), :a, :si, :dep, :st, :seq, :op, :emp, :tpl, :ver,
                :meter, :uom, :fuel, :loc, :status, :blocked, :reject, :by, :at,
                :dev, CAST(:cap AS timestamptz), :off, :lat, :lon, :acc, :gps, :rem, :by)
        RETURNING session_id
    """), {
        "u": client_uuid, "a": asset_id, "si": payload.get("shift_instance_id"),
        "dep": payload.get("deployment_id"), "st": session_type, "seq": seq,
        "op": payload.get("operator_id"), "emp": payload.get("operator_emp_id"),
        "tpl": head["template_id"], "ver": head["version"],
        "meter": payload.get("meter_reading"),
        "uom": payload.get("meter_uom") or asset["reading_uom"],
        "fuel": payload.get("fuel_level"), "loc": payload.get("location_id"),
        "status": server_status, "blocked": verdict["blocked_reason"],
        "reject": payload.get("reject_reason"), "by": actor,
        "at": payload.get("confirmed_at") or datetime.now().astimezone(),
        "dev": payload.get("device_id"), "cap": payload["captured_at"],
        "off": bool(payload.get("captured_offline", True)),
        "lat": payload.get("captured_lat"), "lon": payload.get("captured_lon"),
        "acc": payload.get("gps_accuracy_m"), "gps": payload.get("gps_status"),
        "rem": payload.get("remarks"),
    }).mappings().first()
    session_id = row["session_id"]

    db.execute(text("""
        UPDATE hoto_session SET session_ref = 'HOTO-' || LPAD(CAST(:id AS text), 7, '0')
         WHERE session_id = :id
    """), {"id": session_id})

    for ev in verdict["responses"]:
        it, raw = ev["item"], ev["raw"]
        db.execute(text("""
            INSERT INTO hoto_response
                (session_id, item_id, item_label, response_type, answer,
                 numeric_value, in_range, severity, remark, photo_count)
            VALUES (:s, :i, :lbl, :rt, :ans, :num, :rng, :sev, :rem, :pc)
        """), {"s": session_id, "i": it["item_id"], "lbl": it["label"],
               "rt": it["response_type"], "ans": raw.get("answer"),
               "num": raw.get("numeric_value"), "rng": ev["in_range"],
               "sev": ev["severity"], "rem": raw.get("remark"),
               "pc": int(raw.get("photo_count") or 0)})

    # ── divergence is raised, not swallowed ─────────────────────────────────
    if verdict_drift or template_drift:
        detail = []
        if verdict_drift:
            detail.append(f"device said {device_status}, server says {server_status}")
        if template_drift:
            detail.append(f"device answered template {claimed_tpl} v{claimed_ver}, "
                          f"in force was {head['template_id']} v{head['version']}")
        # ops_exception.hoto_id points at the superseded `hoto` table, so the
        # session reference goes in the detail until phase 8 repoints it.
        db.execute(text("""
            INSERT INTO ops_exception
                (kind, severity, shift_instance_id, asset_id, operator_id, detail,
                 owner_role, status, raised_by, dedupe_key)
            VALUES ('HOTO_VERDICT_DRIFT', :sev, :si, :a, :op, :d,
                    'SUPERVISOR', 'OPEN', :by, :k)
            ON CONFLICT DO NOTHING
        """), {"sev": "HIGH" if verdict_drift else "MEDIUM",
               "si": payload.get("shift_instance_id"), "a": asset_id,
               "op": payload.get("operator_id"),
               "d": f"HOTO-{session_id:07d}: " + "; ".join(detail),
               "by": actor, "k": f"drift:{client_uuid}"})
        logger.warning("HOTO verdict drift on session %s: %s", session_id, detail)

    # ── what the findings mean ───────────────────────────────────────────────
    # The device decided whether each ANSWER was adverse -- it had to, to tell
    # the operator at the machine. Whether an adverse answer is a NEW defect or
    # the fourth sighting of one raised last Tuesday depends on what is open
    # across every device and every shift, which no single tablet knows. So the
    # server decides that, here, before the commit that files the handover --
    # one transaction, so a handover and the defects it raised cannot come apart.
    from app.services import hoto_defects as defects
    outcome = defects.raise_from_session(db, session_id, actor)

    db.commit()

    return {
        "created": True,
        "session_id": session_id,
        "session_ref": f"HOTO-{session_id:07d}",
        "client_uuid": client_uuid,
        "status": server_status,
        "blocked_reason": verdict["blocked_reason"],
        "adverse_count": verdict["adverse_count"],
        "highest_severity": verdict["highest_severity"],
        "responses_stored": len(verdict["responses"]),
        "verdict_drift": verdict_drift,
        "template_drift": template_drift,
        "defects_raised": outcome["raised"],
        "defects_sighted": outcome["sighted"],
        "machine_state_change": outcome["state_change"],
    }
