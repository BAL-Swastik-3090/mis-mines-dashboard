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
               d.platform, d.os_version, d.manufacturer, d.model, d.build_number,
               d.requested_at, d.requested_by_name, d.requested_note,
               d.approved_by, d.approved_at, d.decided_reason,
               d.last_location_at, d.last_lat, d.last_lon, d.last_accuracy_m,
               d.last_battery_pct, d.last_is_charging,
               d.track_location, d.location_interval_s,
               (d.pending_token IS NOT NULL
                AND d.pending_token_expires_at > now()) AS awaiting_pickup,
               (SELECT count(*) FROM hoto_device_location gl
                 WHERE gl.device_id = d.device_id) AS location_pings,
               (SELECT count(*) FROM hoto_session s WHERE s.device_id = d.device_id) AS sessions_filed,
               (SELECT max(s.received_at) FROM hoto_session s WHERE s.device_id = d.device_id) AS last_handover_at
          FROM hoto_device d
          LEFT JOIN plant p ON p.plant_id = d.plant_id
          LEFT JOIN location l ON l.location_id = d.location_id
         ORDER BY (d.status = 'PENDING') DESC, d.requested_at DESC NULLS LAST,
                  d.status, d.device_code
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


# ─────────────────────────────────────────────────────────────────────────────
# A DEVICE ASKS TO JOIN, AND THE OFFICE DECIDES  (migration 110)
#
# The flow above -- enrol(), which mints a token for a device that is not
# present and expects somebody to carry it -- is kept for the handful of places
# that genuinely want it (a bench test, a replacement tablet prepared before it
# leaves the office). It is no longer how a device joins.
#
# This is: the app registers itself, an approver sees what it is and says yes,
# and the app collects its own credential. Nobody types a token, and the
# approval carries a name and a time, which a command run against a database
# never did.
# ─────────────────────────────────────────────────────────────────────────────

import re
from datetime import datetime, timezone

#: How long an approved-but-uncollected credential stays collectable. A device
#: that has not called in within this has probably not been handed out yet, and
#: a credential sitting in a row for a fortnight is a credential, not a hand-off.
PICKUP_HOURS = 48

#: The device generates this and keeps it. It is NOT the credential -- it only
#: proves that the thing collecting the credential is the same installation
#: that asked for it, which is what stops anyone who learns a device code from
#: collecting somebody else's approval.
CLAIM_SECRET_MIN = 32

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _clean(v: str | None, limit: int) -> str | None:
    """Trim and cap. Everything here is self-reported by an unauthenticated
    caller, so nothing it says is allowed to be unbounded."""
    if v is None:
        return None
    v = str(v).strip()
    return v[:limit] or None


def _next_device_code(db: Session) -> str:
    """DEV-001, DEV-002 ... allocated by the server.

    The device does not choose its own name. It would mean two tablets could
    both arrive as "TAB-01" and the second would be refused, with nothing the
    person holding it could do about it. An approver can set a real code at
    approval, which is when somebody actually knows what to call it.
    """
    row = db.execute(text(r"""
        SELECT COALESCE(max((substring(device_code from '^DEV-([0-9]+)$'))::int), 0) + 1 AS n
          FROM hoto_device
         WHERE device_code ~ '^DEV-[0-9]+$'
    """)).mappings().first()
    return "DEV-%03d" % row["n"]


def _waiting_message(status: str, code: str) -> str:
    if status == "PENDING":
        return ("Waiting to be allowed. Ask the office to approve " + code +
                " on the HOTO dashboard, under Devices.")
    if status == "SUSPENDED":
        return code + " is paused. The office can switch it back on."
    if status == "ACTIVE":
        return code + " is allowed."
    return code + " is " + status.lower() + "."


def register(db: Session, *, install_id: str, claim_secret: str,
             label: str | None = None, requested_by_name: str | None = None,
             requested_note: str | None = None, platform: str | None = None,
             os_version: str | None = None, manufacturer: str | None = None,
             model: str | None = None, app_version: str | None = None,
             build_number: str | None = None) -> dict[str, Any]:
    """A device asks to be let in. Unauthenticated, and idempotent on install_id.

    Returns what the app should show whoever is holding it, and NEVER a
    credential: a PENDING row cannot hold one, which migration 110 enforces in
    the database rather than leaving to this function.
    """
    problems: list[str] = []
    install = (install_id or "").strip().lower()
    if not _UUID_RE.match(install):
        problems.append("this installation did not send a valid id")
    if len(claim_secret or "") < CLAIM_SECRET_MIN:
        problems.append("this installation did not send a valid claim secret")
    who = _clean(requested_by_name, 80)
    if not who:
        problems.append("say who is asking for this device to be allowed")
    if problems:
        raise DeviceError(problems)

    facts = {
        "pf": _clean(platform, 12), "os": _clean(os_version, 40),
        "mk": _clean(manufacturer, 60), "md": _clean(model, 80),
        "av": _clean(app_version, 20), "bn": _clean(build_number, 24),
        "who": who, "note": _clean(requested_note, 500),
    }
    # What the device was actually told to call itself, if anything. Kept apart
    # from the fallback below so that a re-registration which sends no label
    # does not overwrite one an approver has already corrected.
    label_in = _clean(label, 80)

    existing = db.execute(text("""
        SELECT device_id, device_code, status FROM hoto_device WHERE install_id = :i
    """), {"i": install}).mappings().first()

    if existing:
        # Asking twice is normal -- the app re-registers after a reinstall, and
        # while its request is still pending -- so this refreshes the facts
        # rather than creating a second row. It does NOT revive a device that
        # was turned down or stopped: that decision stands until a person
        # changes it.
        if existing["status"] in ("REJECTED", "REVOKED"):
            return {"device_code": existing["device_code"],
                    "status": existing["status"],
                    "message": ("This device was turned down. Speak to whoever "
                                "administers HOTO -- registering again will not "
                                "change it.")}
        # COALESCE on every fact, not just the version. A device that asks
        # again while sending less than it did the first time -- an older
        # build, a permission it has since lost, a field the OS stopped
        # answering -- must not blank what the approver is looking at. Found
        # by the second registration in the flow test erasing the make and the
        # Android version the first one had supplied.
        db.execute(text("""
            UPDATE hoto_device
               SET label = COALESCE(:l, label),
                   platform = COALESCE(:pf, platform),
                   os_version = COALESCE(:os, os_version),
                   manufacturer = COALESCE(:mk, manufacturer),
                   model = COALESCE(:md, model),
                   app_version = COALESCE(:av, app_version),
                   build_number = COALESCE(:bn, build_number),
                   requested_by_name = COALESCE(:who, requested_by_name),
                   requested_note = COALESCE(:note, requested_note),
                   requested_at = COALESCE(requested_at, now())
             WHERE device_id = :d
        """), {**facts, "l": label_in, "d": existing["device_id"]})
        db.commit()
        return {"device_code": existing["device_code"], "status": existing["status"],
                "message": _waiting_message(existing["status"], existing["device_code"])}

    # A label nobody typed beats a blank one: the hardware name is what the
    # approver would have written anyway.
    label = label_in or " ".join(
        x for x in (facts["mk"], facts["md"]) if x) or ("device " + install[:8])

    code = _next_device_code(db)
    row = db.execute(text("""
        INSERT INTO hoto_device
            (device_code, label, profile, status, install_id, claim_secret_hash,
             platform, os_version, manufacturer, model, app_version, build_number,
             requested_at, requested_by_name, requested_note, enrolled_by)
        VALUES (:c, :l, 'COMPANY', 'PENDING', CAST(:i AS uuid), :cs,
                :pf, :os, :mk, :md, :av, :bn, now(), :who, :note, 'self-registered')
        RETURNING device_code, status
    """), {**facts, "c": code, "l": label, "i": install,
           "cs": _hash(claim_secret)}).mappings().first()
    db.commit()
    logger.info("device %s registered itself (%s %s) for %s",
                code, facts["mk"], facts["md"], who)
    return {"device_code": row["device_code"], "status": row["status"],
            "message": _waiting_message(row["status"], row["device_code"])}


def claim(db: Session, install_id: str, claim_secret: str) -> dict[str, Any]:
    """The app asking whether it has been allowed yet, and collecting if so.

    The credential is handed over exactly once and then erased from the row --
    see migration 110 for why it is briefly there at all.
    """
    install = (install_id or "").strip().lower()
    if not _UUID_RE.match(install):
        raise DeviceError(["this installation did not send a valid id"], status=400)

    row = db.execute(text("""
        SELECT device_id, device_code, label, profile, status, claim_secret_hash,
               pending_token, pending_token_expires_at, decided_reason,
               track_location, location_interval_s
          FROM hoto_device WHERE install_id = CAST(:i AS uuid)
    """), {"i": install}).mappings().first()

    if not row:
        # Not an error worth showing: it means a reinstall, or a row an
        # administrator deleted. The app simply registers again.
        return {"status": "UNKNOWN",
                "message": "This device is not registered. It will ask again."}

    if not row["claim_secret_hash"] or not hmac.compare_digest(
            row["claim_secret_hash"], _hash(claim_secret or "")):
        # Someone knows a device code and is guessing. Say nothing useful.
        logger.warning("bad claim secret for install %s (%s)",
                       install, row["device_code"])
        raise DeviceError(
            ["this installation cannot collect that device's credential"], status=403)

    out: dict[str, Any] = {
        "device_code": row["device_code"], "label": row["label"],
        "profile": row["profile"], "status": row["status"],
        "track_location": row["track_location"],
        "location_interval_s": row["location_interval_s"],
        "message": _waiting_message(row["status"], row["device_code"]),
    }

    if row["status"] in ("REJECTED", "REVOKED"):
        out["message"] = (row["decided_reason"] or "").strip() or out["message"]
        return out

    if row["status"] != "ACTIVE":
        return out

    tok, expires = row["pending_token"], row["pending_token_expires_at"]
    if tok and expires and expires > datetime.now(timezone.utc):
        db.execute(text("""
            UPDATE hoto_device
               SET pending_token = NULL, pending_token_expires_at = NULL
             WHERE device_id = :d
        """), {"d": row["device_id"]})
        db.commit()
        logger.info("device %s collected its credential", row["device_code"])
        out["token"] = tok
        out["message"] = row["device_code"] + " is allowed. This device is ready."
        return out

    # Active, but there is nothing to collect: either this install already holds
    # the credential (the normal case -- it is just checking), or the pickup
    # expired and a person has to re-issue.
    out["message"] = (
        row["device_code"] + " is allowed." if not expires else
        row["device_code"] + " was allowed, but the credential was not collected "
        "in time. Ask the office to re-issue it.")
    return out


def approve(db: Session, device_code: str, actor: str, *,
            label: str | None = None, new_code: str | None = None,
            profile: str | None = None, plant_id: int | None = None,
            location_id: int | None = None, track_location: bool | None = None,
            location_interval_s: int | None = None,
            reason: str | None = None) -> dict[str, Any]:
    """Let a registered device in. This is where a credential first exists."""
    code = (device_code or "").strip().upper()
    row = db.execute(text("""
        SELECT device_id, device_code, status, install_id
          FROM hoto_device WHERE device_code = :c
    """), {"c": code}).mappings().first()
    if not row:
        raise DeviceError(["no device registered as " + code], status=404)
    if row["status"] == "ACTIVE":
        raise DeviceError([code + " is already allowed"], status=409)
    if row["status"] == "REVOKED":
        raise DeviceError([code + " was revoked. Register it again from the device."],
                          status=409)
    if not row["install_id"]:
        raise DeviceError(
            [code + " was enrolled by hand and has no installation to collect a "
                    "credential. Re-issue its token instead."], status=409)
    if profile is not None and profile not in ("PERSONAL", "COMPANY"):
        raise DeviceError(["profile must be COMPANY (a shared tablet) or "
                           "PERSONAL (one person's phone)"])

    wanted = _clean(new_code, 32)
    if wanted:
        wanted = wanted.upper()
        clash = db.execute(text("""
            SELECT 1 FROM hoto_device WHERE device_code = :c AND device_id <> :d
        """), {"c": wanted, "d": row["device_id"]}).first()
        if clash:
            raise DeviceError([wanted + " is already the code of another device"],
                              status=409)

    token = secrets.token_urlsafe(TOKEN_BYTES)
    out = db.execute(text("""
        UPDATE hoto_device
           SET status = 'ACTIVE',
               device_code = COALESCE(:nc, device_code),
               label = COALESCE(:l, label),
               profile = COALESCE(:pr, profile),
               plant_id = COALESCE(:pl, plant_id),
               location_id = COALESCE(:loc, location_id),
               track_location = COALESCE(:tl, track_location),
               location_interval_s = COALESCE(:iv, location_interval_s),
               token_hash = :h, token_issued_at = now(),
               pending_token = :t,
               pending_token_expires_at = now() + make_interval(hours => :ph),
               approved_by = :by, approved_at = now(),
               decided_reason = :why,
               revoked_by = NULL, revoked_at = NULL
         WHERE device_id = :d
        RETURNING device_code, label, profile, status, track_location,
                  location_interval_s, pending_token_expires_at
    """), {"nc": wanted, "l": _clean(label, 80), "pr": profile, "pl": plant_id,
           "loc": location_id, "tl": track_location, "iv": location_interval_s,
           "h": _hash(token), "t": token, "ph": PICKUP_HOURS, "by": actor,
           "why": _clean(reason, 500), "d": row["device_id"]}).mappings().first()
    db.commit()
    logger.info("device %s approved by %s", out["device_code"], actor)

    return {**dict(out),
            "pending_token_expires_at": out["pending_token_expires_at"].isoformat(),
            # Deliberately NOT the token. The device collects its own, and an
            # approver who never sees it cannot pass it on by mistake.
            "note": (out["device_code"] + " will pick this up the next time it "
                     "checks, usually within a minute. Nobody needs to type "
                     "anything into it.")}


def reject(db: Session, device_code: str, actor: str, reason: str) -> dict[str, Any]:
    """Turn a registration down. The device is told, and stops asking."""
    code = (device_code or "").strip().upper()
    if not (reason or "").strip():
        raise DeviceError(["say why this device is being turned down — the device "
                           "shows this to whoever is holding it"])
    n = db.execute(text("""
        UPDATE hoto_device
           SET status = 'REJECTED', decided_reason = :r,
               approved_by = :by, approved_at = now(),
               token_hash = NULL, pending_token = NULL,
               pending_token_expires_at = NULL
         WHERE device_code = :c AND status = 'PENDING'
    """), {"c": code, "r": _clean(reason, 500), "by": actor}).rowcount
    if not n:
        raise DeviceError(["no device is waiting for approval as " + code], status=404)
    db.commit()
    logger.info("device %s turned down by %s: %s", code, actor, reason)
    return {"device_code": code, "status": "REJECTED"}


def set_tracking(db: Session, device_code: str, actor: str, *,
                 track_location: bool,
                 location_interval_s: int | None = None) -> dict[str, Any]:
    """Whether a device reports where it is, and how often.

    Per device on purpose. A COMPANY tablet bolted in a cab and a worker's own
    PERSONAL phone are not the same consent question, and the mine has to be
    able to answer them differently without shipping a build.
    """
    code = (device_code or "").strip().upper()
    iv = location_interval_s
    if iv is not None and not (30 <= int(iv) <= 7200):
        raise DeviceError(["a device can report between every 30 seconds and "
                           "every two hours"])
    row = db.execute(text("""
        UPDATE hoto_device
           SET track_location = :t,
               location_interval_s = COALESCE(:iv, location_interval_s)
         WHERE device_code = :c
        RETURNING device_code, track_location, location_interval_s
    """), {"c": code, "t": track_location, "iv": iv}).mappings().first()
    if not row:
        raise DeviceError(["no device enrolled as " + code], status=404)
    db.commit()
    logger.info("device %s tracking set to %s by %s", code, track_location, actor)
    return dict(row)


# ── where a device has been ─────────────────────────────────────────────────

def record_locations(db: Session, device_id: int,
                     fixes: list[dict[str, Any]]) -> dict[str, Any]:
    """Store a batch of position fixes from one device.

    A device out of signal buffers and sends the lot at once, so this takes a
    batch and is idempotent on each fix's `client_uuid`: a batch resent after a
    dropped connection does not double the track.
    """
    if not isinstance(fixes, list):
        raise DeviceError(["expected a list of fixes"], status=400)
    if len(fixes) > 500:
        # A device holding a month of buffered track sends it in pages, rather
        # than one request that times out halfway and is retried forever.
        raise DeviceError(["send at most 500 fixes at a time"], status=413)

    def _num(f: dict[str, Any], k: str) -> float | None:
        v = f.get(k)
        try:
            return None if v is None else float(v)
        except (TypeError, ValueError):
            return None

    stored = 0
    skipped = 0
    newest: dict[str, Any] | None = None

    for f in fixes:
        if not isinstance(f, dict):
            skipped += 1
            continue
        try:
            lat = float(f["lat"])
            lon = float(f["lon"])
            rec = str(f["recorded_at"])
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            skipped += 1
            continue

        cu = str(f.get("client_uuid") or "").strip().lower()
        if cu and not _UUID_RE.match(cu):
            cu = ""

        src = str(f.get("source") or "BACKGROUND").upper()
        if src not in ("BACKGROUND", "FOREGROUND", "CAPTURE"):
            src = "BACKGROUND"

        bat = f.get("battery_pct")
        try:
            bat = None if bat is None else max(0, min(100, int(bat)))
        except (TypeError, ValueError):
            bat = None

        chg = f.get("is_charging")
        chg = None if chg is None else bool(chg)

        row = db.execute(text("""
            INSERT INTO hoto_device_location
                (device_id, recorded_at, lat, lon, accuracy_m, altitude_m,
                 speed_mps, heading, battery_pct, is_charging, source, client_uuid)
            VALUES (:d, CAST(:rec AS timestamptz), :lat, :lon, :acc, :alt,
                    :spd, :hdg, :bat, :chg, :src,
                    CASE WHEN :cu = '' THEN NULL ELSE CAST(:cu AS uuid) END)
            ON CONFLICT (client_uuid) DO NOTHING
            RETURNING ping_id, recorded_at
        """), {"d": device_id, "rec": rec, "lat": lat, "lon": lon,
               "acc": _num(f, "accuracy_m"), "alt": _num(f, "altitude_m"),
               "spd": _num(f, "speed_mps"), "hdg": _num(f, "heading"),
               "bat": bat, "chg": chg, "src": src, "cu": cu}).mappings().first()
        if row:
            stored += 1
            if newest is None or row["recorded_at"] > newest["recorded_at"]:
                newest = {"recorded_at": row["recorded_at"], "lat": lat, "lon": lon,
                          "acc": _num(f, "accuracy_m"), "bat": bat, "chg": chg}

    if newest:
        # Only ever moves forward. A late-arriving old fix from a device that
        # was out of signal must not drag "where is it now" backwards.
        db.execute(text("""
            UPDATE hoto_device
               SET last_location_at = :at, last_lat = :lat, last_lon = :lon,
                   last_accuracy_m = :acc,
                   last_battery_pct = COALESCE(:bat, last_battery_pct),
                   last_is_charging = COALESCE(:chg, last_is_charging)
             WHERE device_id = :d
               AND (last_location_at IS NULL OR last_location_at < :at)
        """), {"d": device_id, "at": newest["recorded_at"], "lat": newest["lat"],
               "lon": newest["lon"], "acc": newest["acc"], "bat": newest["bat"],
               "chg": newest["chg"]})
    db.commit()
    return {"stored": stored, "skipped": skipped,
            "duplicates": max(0, len(fixes) - stored - skipped)}


def track(db: Session, device_code: str, *, hours: int = 24,
          limit: int = 500) -> dict[str, Any]:
    """One device's recent track, newest first."""
    code = (device_code or "").strip().upper()
    dev_row = db.execute(text("""
        SELECT device_id, device_code, label, status, model, manufacturer,
               last_seen_at, last_location_at, last_lat, last_lon,
               last_accuracy_m, last_battery_pct, last_is_charging,
               track_location, location_interval_s
          FROM hoto_device WHERE device_code = :c
    """), {"c": code}).mappings().first()
    if not dev_row:
        raise DeviceError(["no device enrolled as " + code], status=404)

    hours = max(1, min(int(hours or 24), 24 * 30))
    limit = max(1, min(int(limit or 500), 2000))
    rows = db.execute(text("""
        SELECT recorded_at, received_at, lat, lon, accuracy_m, speed_mps,
               heading, battery_pct, is_charging, source
          FROM hoto_device_location
         WHERE device_id = :d
           AND recorded_at >= now() - make_interval(hours => :h)
         ORDER BY recorded_at DESC
         LIMIT :lim
    """), {"d": dev_row["device_id"], "h": hours, "lim": limit}).mappings().all()

    return {"device": dict(dev_row), "hours": hours,
            "fixes": [dict(r) for r in rows]}


def tracking_settings(db: Session, device_id: int) -> dict[str, Any]:
    """What this device should be doing about location, right now.

    Read on every hello so a setting changed in the dashboard reaches the
    device by itself. A device that cannot read its settings keeps the ones it
    has rather than falling back to tracking -- the safer direction when the
    question is whether to follow somebody around.
    """
    row = db.execute(text("""
        SELECT track_location, location_interval_s
          FROM hoto_device WHERE device_id = :d
    """), {"d": device_id}).mappings().first()
    if not row:
        return {"track_location": False, "location_interval_s": 300}
    return dict(row)


def set_site(db: Session, device_code: str, actor: str, *,
             plant_id: int | None) -> dict[str, Any]:
    """Assign the site a device belongs to.

    ── WHY THIS EXISTS ──────────────────────────────────────────────────────
    A device's plant decides which operators it may identify. Until the
    operator query was scoped, that column did nothing, so nobody ever set it
    and every enrolled tablet now has it NULL -- which is exactly why the
    unscoped case has to stay usable rather than returning nothing.

    Setting it here is what closes the hole for an existing device. New
    devices take it at approval.
    """
    row = db.execute(text("""
        SELECT device_id, device_code, status FROM hoto_device
         WHERE device_code = :c
    """), {"c": device_code}).mappings().first()
    if not row:
        raise DeviceError([f"no such device: {device_code}"], status=404)

    if plant_id is not None:
        exists = db.execute(text("SELECT 1 FROM plant WHERE plant_id = :p"),
                            {"p": plant_id}).scalar()
        if not exists:
            raise DeviceError([f"no such site: {plant_id}"])

    db.execute(text("""
        UPDATE hoto_device
           -- hoto_device has no updated_by/updated_at columns; the change is
           -- recorded in remarks rather than inventing a schema change for it.
           SET plant_id = :p,
               remarks = concat_ws(' | ', remarks,
                                   concat('site set by ', CAST(:by AS text), ' on ',
                                          to_char(now(), 'DD Mon YYYY')))
         WHERE device_id = :d
    """), {"p": plant_id, "by": actor, "d": row["device_id"]})
    db.commit()

    # The device does not learn this until its next sync, and its cache still
    # holds whatever it was given before. Said out loud rather than implied:
    # revoking breadth does not reach back into a tablet already carrying it.
    return {"device_code": device_code, "plant_id": plant_id,
            "note": ("The device applies this at its next sync. Operators it "
                     "already cached stay on it until then.")}
