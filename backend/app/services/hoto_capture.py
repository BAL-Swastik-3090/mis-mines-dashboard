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

import hashlib
import json
import logging
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

#: Adverse regardless of the question, because the words carry their own
#: meaning. A yes/no answer does not -- see `adverse_answer` on the item and
#: migration 112.
def _shift_for(db: Session, captured_at: Any) -> dict[str, Any]:
    """Which shift a capture belongs to, from its own timestamp.

    Best-effort: a mine with no shift calendar still files handovers, and a
    missing shift is a gap in a report rather than a reason to refuse a record
    of something that actually happened.
    """
    from datetime import datetime as _dtm
    try:
        at = captured_at
        if isinstance(at, str):
            at = _dtm.fromisoformat(at.replace("Z", "+00:00"))
        if at is None:
            at = _dtm.now().astimezone()
        # ALWAYS to local time, not only when it is naive.
        #
        # A device sends captured_at in UTC. Resolving the shift against the
        # UTC hour put a handover captured at 15:16 IST -- B shift -- into A
        # shift, because 09:46 UTC is a morning. astimezone() on an aware
        # value converts it; on a naive one it assumes local, which is what a
        # bare timestamp from this server means anyway.
        at = at.astimezone()
        from app.services.hoto_board import current_shift
        sh = current_shift(db, at)
        if sh:
            return {"shift_code": sh["code"], "prod_day": sh["production_day"]}
    except Exception:                                        # noqa: BLE001
        logger.exception("could not resolve the shift for a handover")
    return {"shift_code": None, "prod_day": None}


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
            # A yes/no item says which of its two answers is the finding.
            # Unclassified items raise nothing, which is the safe default:
            # guessing would report a greased machine as ungreased.
            if item.get("adverse_answer") and answer == item["adverse_answer"]:
                adverse = True

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
               i.is_critical, i.requires_photo_if_not_ok, i.default_severity,
               -- WITHOUT THIS COLUMN EVERY YES/NO FINDING IS SILENTLY LOST.
               -- _evaluate_one reads item["adverse_answer"] to decide whether YES
               -- or NO is the answer that reports a fault (migration 112).
               -- It was never selected, so the key was always absent, the
               -- branch never fired, and a yes/no check could not raise
               -- anything however it was answered: "ROPS / FOPS visible
               -- damage" was answered YES on seventeen handovers and the
               -- system recorded no finding, no severity and no defect.
               --
               -- The identical omission existed in the device's own item
               -- query and was fixed there. Fixing one end of a two-ended
               -- bug is how it survives.
               i.adverse_answer
          FROM hoto_checklist_item i
          JOIN hoto_checklist_section s ON s.section_id = i.section_id
         WHERE s.template_id = :t AND i.status = 'ACTIVE'
         ORDER BY s.display_order, i.display_order
    """), {"t": template_id}).mappings().all()
    return [dict(r) for r in rows]


# ── what makes two submissions the same handover ─────────────────────────────

#: The fields that make a handover what it is. Everything outside this list is
#: either generated by the server, or is retry machinery that may legitimately
#: differ between attempts at sending the same record.
_IMMUTABLE = (
    "asset_id", "session_type", "shift_instance_id", "deployment_id",
    "operator_id", "operator_emp_id",
    "meter_reading", "meter_uom", "fuel_level", "location_id",
    "template_id", "template_version",
    "captured_at", "confirmed_at", "confirmed_by",
    "captured_lat", "captured_lon", "gps_accuracy_m", "gps_status",
    "remarks", "bulk_answered", "status",
)

#: Added by migration 115: the other side of the handover, and who held the
#: tablet. Hashed ONLY WHEN THEY CARRY SOMETHING, unlike the fields above.
#:
#: Every key in _IMMUTABLE is hashed whether present or not, so adding one
#: there changes the fingerprint of every payload -- including the retry of a
#: handover filed yesterday, which would then be refused as altered content
#: and the tablet would never be able to clear it. A payload that does not
#: carry these hashes exactly as it did before they existed.
_IMMUTABLE_IF_PRESENT = (
    "counterpart_operator_id", "counterpart_emp_id", "counterpart_absent",
    "recorded_by_operator_id", "recorded_by_emp_id",
)

#: Likewise for one answer.
_IMMUTABLE_RESPONSE = (
    "item_id", "answer", "numeric_value", "remark", "photo_count",
)


def _norm(v: Any) -> Any:
    """One value, in a form that compares equal to its honest equivalents.

    A device that resends a handover must produce the same fingerprint, and
    the things that differ harmlessly between two sends of one record are
    nearly all of this kind: a number that arrived as a string, a decimal that
    lost a trailing zero, a timestamp written with a different offset, a field
    that was absent rather than null.
    """
    if v is None or v == "":
        # Missing and null are the same statement: nothing was recorded.
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float, Decimal)):
        # 25, 25.0 and "25.00" are one reading. Normalised through Decimal so
        # 8335.50 and 8335.5 agree, and formatted so floats do not leak their
        # binary representation into the hash.
        d = Decimal(str(v)).normalize()
        return format(d, "f")
    if isinstance(v, str):
        t = v.strip()
        if not t:
            return None
        # A timestamp is the instant, not the way it was written. 22:40+05:30
        # and 17:10Z are the same moment and must hash the same.
        try:
            return datetime.fromisoformat(t.replace("Z", "+00:00"))                 .astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
        try:
            return format(Decimal(t).normalize(), "f")
        except (InvalidOperation, ValueError):
            return t
    if isinstance(v, datetime):
        return v.astimezone(timezone.utc).isoformat()
    return v


def fingerprint(payload: dict[str, Any]) -> str:
    """A hash of everything about this handover that may never change.

    ── WHY THE SERVER COMPUTES THIS, NOT THE DEVICE ─────────────────────────
    A device-supplied hash proves only that the device is self-consistent. The
    question being answered is "is what you are sending me now the same as
    what I stored", and only the server can answer that about its own record.

    Answers are sorted by item_id, so a device that serialises them in a
    different order on a retry is still recognised as sending the same
    handover. Photos are deliberately absent: they arrive separately, under
    their own identities, and a photo turning up later must not make the
    handover it belongs to look altered.
    """
    body = {k: _norm(payload.get(k)) for k in _IMMUTABLE}
    for k in _IMMUTABLE_IF_PRESENT:
        v = _norm(payload.get(k))
        # False is "nobody was stated absent", which is what a payload that
        # never heard of the field also says.
        if v is not None and v is not False:
            body[k] = v
    body["responses"] = sorted(
        ({k: _norm(r.get(k)) for k in _IMMUTABLE_RESPONSE}
         for r in (payload.get("responses") or [])),
        key=lambda r: (r.get("item_id") is None, str(r.get("item_id"))),
    )
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _differences(prior_payload_hash: str | None, now_hash: str) -> bool:
    """True when this submission is not the one already stored."""
    return prior_payload_hash is not None and prior_payload_hash != now_hash


def _existing(db: Session, client_uuid: str) -> dict | None:
    row = db.execute(text("""
        SELECT session_id, session_ref, client_uuid, asset_id, session_type, status,
               blocked_reason, confirmed_at, received_at, payload_sha256
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
    sent_hash = fingerprint(payload)

    prior = _existing(db, client_uuid)
    if prior:
        # ── IS THIS THE SAME HANDOVER, OR A DIFFERENT ONE WEARING ITS NAME? ──
        #
        # This compared asset_id and session_type and nothing else, so a retry
        # carrying different answers, a different operator, a different meter
        # reading or different GPS was accepted as an identical replay: the
        # server kept its original, returned it, and the tablet marked its own
        # different version as filed. On a record somebody signs their name to,
        # about whether a machine is safe.
        if prior["asset_id"] != payload.get("asset_id")                 or prior["session_type"] != payload.get("session_type"):
            raise CaptureConflict(
                f"client_uuid {client_uuid} already filed as {prior['session_ref']} "
                f"for a different machine or session type")

        if _differences(prior.get("payload_sha256"), sent_hash):
            # Deliberately not overwritten. The stored record was confirmed by
            # somebody; replacing it on the strength of a later request would
            # make a signed record editable by whoever sends last.
            raise CaptureConflict(
                f"{prior['session_ref']} was already filed under this id with "
                f"different content — the answers, operator, readings or "
                f"position differ from what is stored. The original is "
                f"unchanged. Send the correction as its own handover, or have "
                f"a supervisor compare the two.")

        if prior.get("payload_sha256") is None:
            # Filed before migration 114, so there is nothing to compare
            # against and none can be invented: the payload as sent was never
            # kept. Treated as a replay, which is what it almost always is.
            logger.info("hoto replay with no stored fingerprint: %s",
                     prior["session_ref"])

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

    # Fuel is a percentage and the column CHECKs it. Left to the database, a
    # tablet that let 150 through got a 500, retried it on every sync, and had
    # no way to correct a handover already confirmed.
    fuel = payload.get("fuel_level")
    if fuel is not None:
        try:
            ok_fuel = 0 <= float(fuel) <= 100
        except (TypeError, ValueError):
            ok_fuel = False
        if not ok_fuel:
            problems.append(f"fuel_level must be a percentage between 0 and 100, got {fuel!r}")

    # ── the people in it (migration 115) ────────────────────────────────────
    # Refused here in words rather than left to the CHECK constraints, which
    # would surface as a database error on a tablet in a cab.
    other = payload.get("counterpart_operator_id")
    absent = bool(payload.get("counterpart_absent"))
    if other is not None and absent:
        problems.append("the other side of the handover is both named and stated "
                        "absent — it can be one or the other")
    if session_type == "MID_SHIFT" and (other is not None or absent):
        problems.append("a mid-shift check has no other side; it names one operator")
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
             remarks, created_by, bulk_answered, shift_code, production_day,
             payload_sha256,
             counterpart_operator_id, counterpart_emp_id, counterpart_absent,
             recorded_by_operator_id, recorded_by_emp_id)
        VALUES (CAST(:u AS uuid), :a, :si, :dep, :st, :seq, :op, :emp, :tpl, :ver,
                :meter, :uom, :fuel, :loc, :status, :blocked, :reject, :by, :at,
                :dev, CAST(:cap AS timestamptz), :off, :lat, :lon, :acc, :gps, :rem, :by,
                :bulk, :shift_code, CAST(:prod_day AS date), :fp,
                :cp_op, :cp_emp, :cp_absent, :rec_op, :rec_emp)
        RETURNING session_id
    """), {
        "bulk": bool(payload.get("bulk_answered")),
        # NOT DEFAULTED. A tablet on an older build sends none of these, and
        # its record must say "not recorded" -- not "nobody", and not that the
        # operator filled it in themself, neither of which anybody said.
        "cp_op": other, "cp_emp": payload.get("counterpart_emp_id"),
        "cp_absent": absent,
        "rec_op": payload.get("recorded_by_operator_id"),
        "rec_emp": payload.get("recorded_by_emp_id"),
        # Computed here, from what actually arrived, so a later retry is
        # compared against what was stored rather than against a hash the
        # device chose for itself.
        "fp": sent_hash,
        # RESOLVED ONCE, FROM THE DEVICE'S OWN CLOCK, and stored.
        #
        # A handover captured at 22:40 and synced at 09:00 the next morning
        # belongs to the night shift, not the morning one it happened to
        # arrive in. Deriving it at read time -- which is all anything did
        # before migration 113 -- gets that backwards, and re-buckets every
        # old record whenever a shift timing is edited.
        **_shift_for(db, payload.get("captured_at")),
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

    # ── the other half of the handover ──────────────────────────────────────
    paired = pair(db, session_id, actor)

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
        "paired_with": paired["session_ref"] if paired else None,
        "names_disagree": bool(paired and paired["names_disagree"]),
    }


# ── pairing a takeover with the handover it follows ──────────────────────────

#: How far apart a handover and its takeover may be and still be one event.
#: The person going off normally fills theirs in minutes before the person
#: coming on. Four hours covers a shift that ran over or a machine left at the
#: bay over a meal break; longer than that, and it is not one handover but a
#: machine that stood idle -- which pairing would misrepresent.
PAIR_BEFORE = "4 hours"
#: Two tablets' clocks disagree, and the incoming operator sometimes starts
#: their walk-round before the outgoing one has pressed confirm.
PAIR_AFTER = "30 minutes"


def pair(db: Session, session_id: int, actor: str) -> dict[str, Any] | None:
    """Point a takeover and the handover it follows at each other.

    ── WHY THE SERVER DOES THIS, AND ON EVERY FILING ─────────────────────────
    The two halves are filed by different people, often on different tablets,
    and reach us in whichever order those tablets found a signal. Neither
    device can know about the other. So whichever half arrives second finds
    the first, whatever order they were captured in.

    ── WHICH ONE ────────────────────────────────────────────────────────────
    The unpaired session of the opposite type on the same machine, inside the
    window. Where the record names the other person, a session BY that person
    is preferred over a nearer one by somebody else -- the name is the better
    evidence. Otherwise the nearest in time.

    ── WHEN THE NAMES DISAGREE ──────────────────────────────────────────────
    The takeover says it was handed over by A; the handover was filed by B.
    Still paired -- they are still the two halves of what happened to this
    machine -- and raised for a supervisor, because one of the two records
    names the wrong person and only somebody on site can say which.
    """
    me = db.execute(text("""
        SELECT session_id, session_ref, asset_id, session_type, captured_at,
               operator_id, counterpart_operator_id, counterpart_session_id,
               shift_instance_id
          FROM hoto_session WHERE session_id = :s
    """), {"s": session_id}).mappings().first()
    if not me or me["counterpart_session_id"] is not None:
        return None
    if me["session_type"] == "START_HANDOVER":
        want, lo, hi = "END_HANDOVER", f"- interval '{PAIR_BEFORE}'", f"+ interval '{PAIR_AFTER}'"
    elif me["session_type"] == "END_HANDOVER":
        want, lo, hi = "START_HANDOVER", f"- interval '{PAIR_AFTER}'", f"+ interval '{PAIR_BEFORE}'"
    else:
        return None     # a mid-shift check has no other half

    # The intervals are module constants, not request data, so formatting them
    # into the statement is safe; the values that come from a device are bound.
    other = db.execute(text(f"""
        SELECT session_id, session_ref, operator_id, counterpart_operator_id
          FROM hoto_session
         WHERE asset_id = :a AND session_type = :want
           AND counterpart_session_id IS NULL
           AND session_id <> :me
           AND status <> 'CANCELLED'
           AND captured_at BETWEEN CAST(:t AS timestamptz) {lo}
                               AND CAST(:t AS timestamptz) {hi}
         ORDER BY (operator_id IS NOT DISTINCT FROM CAST(:named AS bigint)
                   AND CAST(:named AS bigint) IS NOT NULL) DESC,
                  abs(extract(epoch FROM captured_at - CAST(:t AS timestamptz))),
                  session_id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
    """), {"a": me["asset_id"], "want": want, "me": session_id,
           "t": me["captured_at"], "named": me["counterpart_operator_id"]}).mappings().first()
    if not other:
        return None

    db.execute(text("""
        UPDATE hoto_session
           SET counterpart_session_id = CASE session_id WHEN :a THEN :b ELSE :a END,
               updated_by = :by, updated_at = now()
         WHERE session_id IN (:a, :b)
    """), {"a": session_id, "b": other["session_id"], "by": actor})

    def disagree(named, actual) -> bool:
        return named is not None and actual is not None and int(named) != int(actual)

    names_disagree = (disagree(me["counterpart_operator_id"], other["operator_id"])
                      or disagree(other["counterpart_operator_id"], me["operator_id"]))
    if names_disagree:
        lo_id, hi_id = sorted((session_id, other["session_id"]))
        db.execute(text("""
            INSERT INTO ops_exception
                (kind, severity, shift_instance_id, asset_id, operator_id, detail,
                 owner_role, status, raised_by, dedupe_key)
            VALUES ('HOTO_COUNTERPART_MISMATCH', 'MEDIUM', :si, :a, :op, :d,
                    'SUPERVISOR', 'OPEN', :by, :k)
            ON CONFLICT DO NOTHING
        """), {"si": me["shift_instance_id"], "a": me["asset_id"],
               "op": me["operator_id"],
               "d": (f"{me['session_ref'] or f'HOTO-{session_id:07d}'} and "
                     f"{other['session_ref']} are the two halves of one handover, "
                     f"but they do not agree on who was on the other side. "
                     f"One of them names the wrong person."),
               "by": actor, "k": f"pair:{lo_id}:{hi_id}"})
        logger.warning("HOTO pair %s/%s names disagree", session_id, other["session_id"])

    return {"session_id": other["session_id"], "session_ref": other["session_ref"],
            "names_disagree": names_disagree}
