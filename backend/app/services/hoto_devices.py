"""Enrolling a tablet, and letting it in afterwards.

── WHY A TABLET DOES NOT SIGN IN AS A PERSON ────────────────────────────────
It was going to. The app read a dashboard session cookie out of secure storage,
and that would have failed on the first morning of the trial for three separate
reasons, none of which are obvious until you try it:

  * the session JWT expires after twenty minutes of idle, and a tablet in a cab
    is idle for most of a shift;
  * the platform permits ONE session per employee, so two tablets enrolled
    against the same person evict each other, silently, mid-shift;
  * it would mean typing a dashboard password into a shared tablet in a pit,
    which is the opposite of what `hoto_device.profile = 'COMPANY'` exists to
    describe.

So a tablet carries a DEVICE credential: long-lived, revocable, naming a device
rather than a person, and granting exactly the three things a device does --
pull masters, file handovers, upload photos. It can read nothing else.

── IDENTITY IS STILL PER CAPTURE ────────────────────────────────────────────
The device token says which tablet. It says nothing about who is holding it,
and must not: the operator is identified inside each payload, once, for that
handover only. A device credential that doubled as a login would reintroduce
exactly the inherited-identity problem the whole capture flow is built to
avoid.

── THE TOKEN IS SHOWN ONCE ──────────────────────────────────────────────────
Only its hash is stored, as `hoto_device.token_hash` (migration 106) was always
shaped for. A lost token is not recoverable; the device is re-enrolled, which
is one command and leaves a trail. Recoverable secrets are how a credential
ends up in a WhatsApp group.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

TOKEN_BYTES = 32


class DeviceError(ValueError):
    def __init__(self, problems: list[str], status: int = 422):
        self.problems = problems
        self.status = status
        super().__init__("; ".join(problems))


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ── enrolment (a person with hoto.admin does this) ───────────────────────────

def enrol(db: Session, *, device_code: str, label: str, profile: str,
          actor: str, plant_id: int | None = None,
          location_id: int | None = None, remarks: str | None = None) -> dict[str, Any]:
    """Register a tablet and issue its credential.

    Returns the token in the clear EXACTLY ONCE. Nothing stores it, including
    this function's caller, beyond the one response.
    """
    problems: list[str] = []
    code = (device_code or "").strip().upper()
    if not code:
        problems.append("a device code is required — something written on the tablet")
    if len(code) > 32:
        problems.append("the device code is longer than 32 characters")
    if not (label or "").strip():
        problems.append("a label is required — where this tablet lives")
    if profile not in ("PERSONAL", "COMPANY"):
        problems.append("profile must be COMPANY (a shared tablet) or PERSONAL (one person's phone)")
    if problems:
        raise DeviceError(problems)

    existing = db.execute(text("""
        SELECT device_id, status FROM hoto_device WHERE device_code = :c
    """), {"c": code}).mappings().first()
    if existing:
        raise DeviceError(
            [f"{code} is already enrolled. Re-issue its token or revoke it first."],
            status=409)

    token = secrets.token_urlsafe(TOKEN_BYTES)
    row = db.execute(text("""
        INSERT INTO hoto_device
            (device_code, label, profile, plant_id, location_id,
             token_hash, token_issued_at, status, enrolled_by, remarks)
        VALUES (:c, :l, :p, :pl, :loc, :h, now(), 'ACTIVE', :by, :rem)
        RETURNING device_id, device_code, label, profile, enrolled_at
    """), {"c": code, "l": label.strip(), "p": profile, "pl": plant_id,
           "loc": location_id, "h": _hash(token), "by": actor,
           "rem": remarks}).mappings().first()
    db.commit()
    logger.info("device %s enrolled by %s", code, actor)

    return {**dict(row),
            "enrolled_at": row["enrolled_at"].isoformat(),
            # Shown once. Say so in the payload itself, so a UI that forgets to
            # say it is still handing over something that says it.
            "token": token,
            "token_note": ("Write this into the tablet now. It is not stored and "
                           "cannot be shown again — a lost token means re-enrolling "
                           "the device, which is one command.")}


def reissue(db: Session, device_code: str, actor: str) -> dict[str, Any]:
    """A new token for a tablet that lost its one. The old token stops working."""
    code = device_code.strip().upper()
    dev = db.execute(text("""
        SELECT device_id, status FROM hoto_device WHERE device_code = :c
    """), {"c": code}).mappings().first()
    if not dev:
        raise DeviceError([f"no device enrolled as {code}"], status=404)
    if dev["status"] == "REVOKED":
        raise DeviceError(
            [f"{code} is revoked. Enrol it again rather than re-issuing to it."], status=409)

    token = secrets.token_urlsafe(TOKEN_BYTES)
    db.execute(text("""
        UPDATE hoto_device SET token_hash = :h, token_issued_at = now(),
               status = 'ACTIVE', remarks = COALESCE(remarks, '') ||
               ' | token re-issued by ' || :by || ' on ' || to_char(now(), 'DD Mon YYYY')
         WHERE device_id = :d
    """), {"h": _hash(token), "d": dev["device_id"], "by": actor})
    db.commit()
    logger.info("device %s token re-issued by %s", code, actor)
    return {"device_code": code, "token": token,
            "token_note": "The tablet's previous token stopped working the moment this was issued."}


def revoke(db: Session, device_code: str, actor: str, reason: str) -> dict[str, Any]:
    """Stop a tablet. Its queued handovers are not deleted — see below."""
    code = device_code.strip().upper()
    if not (reason or "").strip():
        raise DeviceError(["say why the device is being revoked"])

    n = db.execute(text("""
        UPDATE hoto_device
           SET status = 'REVOKED', revoked_by = :by, revoked_at = now(),
               token_hash = NULL,
               remarks = COALESCE(remarks || ' | ', '') || :r
         WHERE device_code = :c AND status <> 'REVOKED'
    """), {"c": code, "by": actor, "r": reason.strip()}).rowcount
    if not n:
        raise DeviceError([f"no active device enrolled as {code}"], status=404)
    db.commit()
    logger.warning("device %s revoked by %s: %s", code, actor, reason)

    # SAID OUT LOUD, because it is the consequence somebody will not think of.
    # Anything that tablet captured and has not sent is now unsendable, and
    # nothing on the server can retrieve it.
    return {"device_code": code, "status": "REVOKED",
            "warning": ("Anything this tablet captured and has not yet sent can no "
                        "longer be sent. Sync it before revoking if that matters.")}


def listing(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(text("""
        SELECT d.device_id, d.device_code, d.label, d.profile, d.status,
               d.plant_id, p.name AS plant_name, d.location_id, l.name AS location_name,
               d.token_issued_at, d.last_seen_at, d.last_sync_at, d.app_version,
               d.enrolled_by, d.enrolled_at, d.revoked_by, d.revoked_at, d.remarks,
               (SELECT count(*) FROM hoto_session s WHERE s.device_id = d.device_id) AS sessions_filed,
               (SELECT max(s.received_at) FROM hoto_session s WHERE s.device_id = d.device_id) AS last_handover_at
          FROM hoto_device d
          LEFT JOIN plant p ON p.plant_id = d.plant_id
          LEFT JOIN location l ON l.location_id = d.location_id
         ORDER BY d.status, d.device_code
    """)).mappings().all()
    return [dict(r) for r in rows]


# ── letting a tablet in ──────────────────────────────────────────────────────

def authenticate(db: Session, token: str | None) -> dict[str, Any]:
    """Resolve a device token, or refuse.

    Compared with `hmac.compare_digest` against the stored hash. A plain `==`
    on a hash leaks its prefix through timing, which is a small thing until the
    credential it protects can file handovers against any machine in the mine.
    """
    if not token:
        raise DeviceError(["this endpoint is for enrolled devices and needs a device token"],
                          status=401)

    digest = _hash(token)
    # Candidates are narrowed by the hash itself; the comparison below is what
    # actually decides, and is constant-time.
    rows = db.execute(text("""
        SELECT device_id, device_code, label, profile, status, plant_id, token_hash
          FROM hoto_device WHERE token_hash IS NOT NULL
    """)).mappings().all()

    for r in rows:
        if hmac.compare_digest(r["token_hash"], digest):
            if r["status"] != "ACTIVE":
                raise DeviceError(
                    [f"{r['device_code']} is {r['status'].lower()}. "
                     "Ask whoever administers HOTO to re-enable it."], status=403)
            return {k: r[k] for k in
                    ("device_id", "device_code", "label", "profile", "plant_id")}

    raise DeviceError(["this device token is not recognised — the tablet may need "
                       "re-enrolling"], status=401)


def seen(db: Session, device_id: int, app_version: str | None = None,
         synced: bool = False) -> None:
    """Record that a tablet called in. Best-effort: never fails a real request."""
    try:
        db.execute(text("""
            UPDATE hoto_device
               SET last_seen_at = now(),
                   last_sync_at = CASE WHEN :s THEN now() ELSE last_sync_at END,
                   app_version = COALESCE(:v, app_version)
             WHERE device_id = :d
        """), {"d": device_id, "v": app_version, "s": synced})
        db.commit()
    except Exception:                                        # noqa: BLE001
        logger.exception("could not record device %s calling in", device_id)
        db.rollback()
