"""Receiving evidence from a tablet.

── THE UPLOAD IS IDEMPOTENT, BECAUSE IT WILL BE INTERRUPTED ─────────────────
A photo upload at a mine gate is a few hundred kilobytes over a signal that
lasts seconds. It will be cut off halfway, and the device will send it again.
So the device's own `photo_uuid` is the key: the same photo retried returns the
record that already exists rather than storing a second copy, exactly as
`client_uuid` does for the session itself.

── AND IT VERIFIES THE BYTES ────────────────────────────────────────────────
The device sends the sha256 it computed when it wrote the file. If the bytes
that arrive do not hash to it, the upload is refused rather than stored. A
truncated JPEG is not evidence, and the one thing worse than no photo is a
corrupt one that looks like a photo in the register until somebody opens it in
a dispute.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# The device downsizes to 1600px at 70% before upload, which lands at 200-400 kB.
# This is the ceiling on something having gone wrong, not a target.
MAX_BYTES = 6 * 1024 * 1024
ALLOWED_TYPES = ("image/jpeg", "image/png", "image/webp")


class PhotoError(ValueError):
    def __init__(self, problems: list[str], status: int = 422):
        self.problems = problems
        self.status = status
        super().__init__("; ".join(problems))


def _existing(db: Session, photo_uuid: str) -> dict[str, Any] | None:
    row = db.execute(text("""
        SELECT p.photo_id, p.photo_uuid, p.session_id, p.item_id, p.sha256,
               p.size_bytes, p.received_at, s.session_ref
          FROM hoto_photo p
          JOIN hoto_session s ON s.session_id = p.session_id
         WHERE p.photo_uuid = CAST(:u AS uuid)
    """), {"u": photo_uuid}).mappings().first()
    return dict(row) if row else None


def receive(db: Session, *, photo_uuid: str, client_uuid: str, content: bytes,
            actor: str, item_id: int | None = None,
            captured_at: str | None = None, content_type: str = "image/jpeg",
            sha256: str | None = None, lat: float | None = None,
            lon: float | None = None, accuracy_m: float | None = None,
            kind: str = 'ITEM') -> dict[str, Any]:
    """Store one photo against a handover the device has already filed.

    `client_uuid` is the SESSION's id, not the photo's. The device does not know
    the server's session_id -- it never has one until the session has synced --
    so a photo is addressed by the same key the session was filed under.
    """
    kind = (kind or 'ITEM').upper()
    if kind not in ('ITEM', 'OPERATOR'):
        kind = 'ITEM'
    if kind == 'OPERATOR':
        # A photograph of a person is not evidence against a check, and the
        # database will not let it pretend to be.
        item_id = None

    problems: list[str] = []
    if not photo_uuid:
        problems.append("photo_uuid is required — it is what makes a retry safe")
    if not client_uuid:
        problems.append("client_uuid (the handover's) is required")
    if not content:
        problems.append("the photo is empty")
    if content and len(content) > MAX_BYTES:
        problems.append(f"the photo is {len(content) // 1024} kB, over the "
                        f"{MAX_BYTES // 1024} kB limit")
    if content_type not in ALLOWED_TYPES:
        problems.append(f"{content_type} is not an image type this accepts")
    for name, value in (("photo_uuid", photo_uuid), ("client_uuid", client_uuid)):
        if value:
            try:
                UUID(value)
            except ValueError:
                problems.append(f"{name} is not a UUID")
    if problems:
        raise PhotoError(problems)

    # ── already here? ───────────────────────────────────────────────────────
    prior = _existing(db, photo_uuid)
    if prior:
        # A retry of the same photo. Returning the original is the correct
        # answer; the device clears it from its queue and moves on.
        return {"created": False, **prior}

    digest = hashlib.sha256(content).hexdigest()
    if sha256 and sha256.lower() != digest:
        # THE BYTES DID NOT SURVIVE THE JOURNEY. Refused, so the device keeps
        # it queued and sends it again, rather than the register holding
        # something that is not the photograph anybody took.
        raise PhotoError(
            ["the photo did not arrive intact — the device computed "
             f"{sha256.lower()[:12]}… and {digest[:12]}… arrived. "
             "Keep it queued and send it again."], status=409)

    session = db.execute(text("""
        SELECT session_id, session_ref FROM hoto_session
         WHERE client_uuid = CAST(:u AS uuid)
    """), {"u": client_uuid}).mappings().first()
    if not session:
        # The session has not synced yet. NOT an error the device should treat
        # as fatal: the ordering is the device's to fix, and it will send the
        # session first and retry this.
        raise PhotoError(
            [f"no handover has been filed under {client_uuid} yet — "
             "send the handover first, then the photo"], status=409)

    label = None
    response_id = None
    if item_id is not None:
        r = db.execute(text("""
            SELECT response_id, item_label FROM hoto_response
             WHERE session_id = :s AND item_id = :i
        """), {"s": session["session_id"], "i": item_id}).mappings().first()
        if r:
            response_id = r["response_id"]
            label = r["item_label"]

    row = db.execute(text("""
        INSERT INTO hoto_photo
            (photo_uuid, session_id, response_id, item_id, item_label,
             sha256, size_bytes, content_type, content, captured_at,
             captured_lat, captured_lon, gps_accuracy_m, uploaded_by, kind)
        VALUES (CAST(:pu AS uuid), :s, :r, :i, :lbl, :h, :n, :ct, :blob,
                COALESCE(CAST(:cap AS timestamptz), now()),
                :lat, :lon, :acc, :by, :kind)
        ON CONFLICT (session_id, COALESCE(item_id, -1), sha256) DO NOTHING
        RETURNING photo_id, photo_uuid, received_at
    """), {"pu": photo_uuid, "s": session["session_id"], "r": response_id,
           "i": item_id, "lbl": label, "h": digest, "n": len(content),
           "ct": content_type, "blob": content, "cap": captured_at,
           "lat": lat, "lon": lon, "acc": accuracy_m, "by": actor,
           "kind": kind}).mappings().first()

    if row is None:
        # These exact bytes are already attached to this check under a different
        # uuid -- a device whose local row was lost and recreated. One photo,
        # not two, and the device should stop sending it.
        same = db.execute(text("""
            SELECT photo_id, photo_uuid, received_at FROM hoto_photo
             WHERE session_id = :s AND COALESCE(item_id, -1) = COALESCE(:i, -1)
               AND sha256 = :h
        """), {"s": session["session_id"], "i": item_id, "h": digest}).mappings().first()
        db.commit()
        logger.info("photo %s is a duplicate of %s", photo_uuid,
                    same["photo_uuid"] if same else "?")
        return {"created": False, "duplicate_of": str(same["photo_uuid"]) if same else None,
                "session_id": session["session_id"],
                "session_ref": session["session_ref"],
                "photo_id": same["photo_id"] if same else None,
                "sha256": digest, "size_bytes": len(content)}

    db.commit()
    logger.info("photo %s (%d kB) stored against %s",
                photo_uuid, len(content) // 1024, session["session_ref"])
    return {"created": True,
            "photo_id": row["photo_id"],
            "photo_uuid": str(row["photo_uuid"]),
            "session_id": session["session_id"],
            "session_ref": session["session_ref"],
            "response_id": response_id,
            "sha256": digest,
            "size_bytes": len(content),
            "received_at": row["received_at"].isoformat()}


def listing(db: Session, session_id: int) -> list[dict[str, Any]]:
    """What has arrived for this handover. Metadata only — never the bytes."""
    rows = db.execute(text("""
        SELECT ph.photo_id, ph.photo_uuid, ph.item_id, ph.item_label,
               ph.sha256, ph.size_bytes, ph.content_type,
               ph.captured_at, ph.received_at, ph.uploaded_by,
               -- ITEM evidence or the OPERATOR's own photo: a screen has to
               -- tell them apart, and a defect's photo list must never show a
               -- photograph of a person as evidence of a fault.
               ph.kind,
               -- Where it was taken. For a picture of a machine in a pit this
               -- is most of what makes it evidence.
               ph.captured_lat, ph.captured_lon, ph.gps_accuracy_m,

               -- WHICH TABLET TOOK IT. A photograph is evidence, and evidence
               -- is worth what its provenance is worth: "a photo" and "a photo
               -- from the tablet issued to the Kaliapani night shift, running
               -- app 0.1.0" are different things to anybody checking a claim
               -- months later. All of it is already recorded at enrolment;
               -- until now none of it reached the screen.
               d.device_code, d.label AS device_label, d.profile AS device_profile,
               d.manufacturer AS device_manufacturer, d.model AS device_model,
               d.platform AS device_platform, d.os_version AS device_os_version,
               d.app_version AS device_app_version,

               -- AND WHO WAS ON THE MACHINE. Carried on the handover rather
               -- than on the photograph, which is the point: it says whose
               -- shift this evidence belongs to.
               s.operator_emp_id,
               COALESCE(pa.display_name, pa.legal_name) AS operator_name
          FROM hoto_photo ph
          JOIN hoto_session s   ON s.session_id = ph.session_id
          LEFT JOIN hoto_device d ON d.device_id = s.device_id
          LEFT JOIN operator o    ON o.operator_id = s.operator_id
          LEFT JOIN party pa      ON pa.party_id = o.party_id
         WHERE ph.session_id = :s
         ORDER BY ph.captured_at, ph.photo_id
    """), {"s": session_id}).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["photo_uuid"] = str(d["photo_uuid"])
        for k in ("captured_lat", "captured_lon", "gps_accuracy_m"):
            if d.get(k) is not None:
                d[k] = float(d[k])
        out.append(d)
    return out


def content_of(db: Session, photo_id: int) -> tuple[bytes, str] | None:
    row = db.execute(text("""
        SELECT content, content_type FROM hoto_photo WHERE photo_id = :p
    """), {"p": photo_id}).mappings().first()
    if not row:
        return None
    return bytes(row["content"]), row["content_type"]


def evidence_gaps(db: Session, days: int = 7) -> list[dict[str, Any]]:
    """Checks whose photos were attested to but have not arrived.

    The question this answers is "is anything still stuck on a tablet", and it
    is the one report that makes an offline system honest: a photo that never
    arrives is indistinguishable from one never taken unless somebody looks.
    """
    rows = db.execute(text("""
        SELECT e.response_id, e.session_id, s.session_ref, a.fleet_code,
               e.item_label, e.photos_attested, e.photos_arrived,
               s.captured_at, s.operator_emp_id,
               EXTRACT(DAY FROM now() - s.captured_at)::int AS age_days
          FROM hoto_response_evidence e
          JOIN hoto_session s ON s.session_id = e.session_id
          JOIN asset a ON a.asset_id = s.asset_id
         WHERE e.evidence_state = 'PENDING'
           AND s.captured_at >= now() - make_interval(days => :d)
         ORDER BY s.captured_at DESC
    """), {"d": days}).mappings().all()
    return [dict(r) for r in rows]
