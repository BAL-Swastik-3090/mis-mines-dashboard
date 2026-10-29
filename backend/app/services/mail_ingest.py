"""Read fleet-report attachments out of a configured mailbox.

STAGE ONE ONLY. This module lands files and parses nothing. It fetches
attachments, hashes them, and writes them to mail_report_file with status
LANDED. A parser reads from that table afterwards and never touches a mailbox.

The separation is the whole point:

  * a parser fixed next month can be re-run over this month's files;
  * somebody can drop a workbook in by hand when the mailbox is down, and it
    travels the same path as a fetched one;
  * a duplicate is caught by the bytes, not by the file name -- Tata resend
    the same attachment when it is asked for again.

── AUTHENTICATION ──────────────────────────────────────────────────────────
Microsoft Graph, app-only (client credentials). One Azure app registration
serves every configured mailbox; its tenant, client id and secret are
environment, never table data, so adding a mailbox is an INSERT and revoking
one is an Exchange policy change.

NOT IMAP. Basic authentication is off by default in Microsoft 365, and an IMAP
path would mean a mailbox password sitting in configuration -- which is both
the thing most likely to leak and the thing nobody can scope. Graph application
permission can be restricted to named mailboxes by an application access
policy; a password cannot be restricted to anything.

── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
It does not mark mail read, move it, or delete it. The mailbox is somebody's
and this is a reader. `last_seen_at` on the source row is how it avoids
re-reading, not a flag written back into the mailbox.
"""
from __future__ import annotations

import base64
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger("mines_dashboard")
settings = get_settings()

GRAPH = "https://graph.microsoft.com/v1.0"
TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
SCOPE = "https://graph.microsoft.com/.default"

# A fleet report is a spreadsheet, not a photograph. Anything larger than this
# is a mistake worth refusing rather than loading into a bytea column.
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

# How many messages one poll will look at. A mailbox that has been ignored for
# a year should not try to land everything in a single request.
PAGE_SIZE = 50


class MailConfigError(RuntimeError):
    """The Azure app is not configured. Says which value is missing."""


class MailGraphError(RuntimeError):
    """Graph refused. Carries its own message, which is usually specific."""


def _creds() -> tuple[str, str, str]:
    """Tenant, client id, secret — or a message naming what is absent.

    Checked together and reported together: finding out about the third
    missing value on the third attempt wastes somebody's afternoon.
    """
    missing = [
        name for name, value in (
            ("GRAPH_TENANT_ID", settings.graph_tenant_id),
            ("GRAPH_CLIENT_ID", settings.graph_client_id),
            ("GRAPH_CLIENT_SECRET", settings.graph_client_secret),
        ) if not value
    ]
    if missing:
        raise MailConfigError(
            "Mail ingestion is not configured. Missing from the server .env: "
            + ", ".join(missing)
            + ". These come from one Azure app registration with application "
              "Mail.Read; see docs/mail_ingestion.md."
        )
    return (settings.graph_tenant_id, settings.graph_client_id,
            settings.graph_client_secret)


def is_configured() -> bool:
    """Whether the Azure app credentials are present.

    The screen asks this so it can say "not configured yet" instead of
    offering a Test button that can only fail.
    """
    try:
        _creds()
        return True
    except MailConfigError:
        return False


def get_token() -> str:
    """An app-only access token. Not cached: a poll is a quarter-hourly event
    and a token request is one round trip, so caching would add a staleness
    bug to save nothing."""
    tenant, client_id, secret = _creds()
    r = httpx.post(
        TOKEN_URL.format(tenant=tenant),
        data={"client_id": client_id, "client_secret": secret,
              "grant_type": "client_credentials", "scope": SCOPE},
        timeout=30.0,
    )
    if r.status_code != 200:
        # Graph's own error text is specific and worth surfacing verbatim --
        # "AADSTS7000215: Invalid client secret" is the whole diagnosis.
        raise MailGraphError(f"Token request failed ({r.status_code}): {r.text[:400]}")
    return r.json()["access_token"]


def _graph_get(token: str, url: str, params: dict | None = None) -> dict[str, Any]:
    r = httpx.get(url, headers={"Authorization": f"Bearer {token}"},
                  params=params, timeout=60.0)
    if r.status_code == 404:
        raise MailGraphError(
            "Graph returned 404. Either the mailbox does not exist or the app "
            "has no access to it — an application access policy that excludes "
            "this mailbox looks exactly like a missing mailbox.")
    if r.status_code == 403:
        raise MailGraphError(
            "Graph returned 403. The app registration is missing application "
            "Mail.Read, or admin consent has not been granted for it.")
    if r.status_code != 200:
        raise MailGraphError(f"Graph {r.status_code}: {r.text[:400]}")
    return r.json()


def _filter_for(source: dict) -> str | None:
    """Server-side filter, so a quiet source costs one small request.

    Only the date is filtered at Graph: $filter on subject/from together with
    receivedDateTime needs an ordering Graph often refuses, and a sender or
    subject test in Python over fifty rows is free. The date is the one that
    matters for not re-reading a folder.
    """
    seen = source.get("last_seen_at")
    if not seen:
        return None
    if isinstance(seen, str):
        return f"receivedDateTime gt {seen}"
    return ("receivedDateTime gt "
            + seen.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))


def _wanted(source: dict, message: dict) -> bool:
    """Does this message match the source's sender/subject filters?

    Absent filters match everything, which is what a dedicated reports mailbox
    wants. Both tests are case-insensitive substrings -- a subject line gains a
    'FW:' or a date and should still match.
    """
    sender_needle = (source.get("sender_contains") or "").strip().lower()
    subject_needle = (source.get("subject_contains") or "").strip().lower()
    if sender_needle:
        addr = ((message.get("from") or {}).get("emailAddress") or {})
        if sender_needle not in (addr.get("address") or "").lower():
            return False
    if subject_needle:
        if subject_needle not in (message.get("subject") or "").lower():
            return False
    return True


def list_messages(token: str, source: dict, limit: int = PAGE_SIZE) -> list[dict]:
    """Candidate messages, newest-relevant first, already filtered."""
    folder = (source.get("folder") or "Inbox").strip()
    url = (f"{GRAPH}/users/{source['mailbox']}/mailFolders/"
           f"{httpx.URL(folder).path or folder}/messages")
    params: dict[str, Any] = {
        "$select": "id,subject,from,receivedDateTime,hasAttachments",
        "$top": limit,
        "$orderby": "receivedDateTime asc",
    }
    f = _filter_for(source)
    if f:
        params["$filter"] = f
    data = _graph_get(token, url, params)
    return [m for m in data.get("value", []) if _wanted(source, m)]


def _attachments(token: str, mailbox: str, message_id: str) -> list[dict]:
    url = f"{GRAPH}/users/{mailbox}/messages/{message_id}/attachments"
    return _graph_get(token, url).get("value", [])


def test_source(db: Session, source_id: int, peek: int = 5) -> dict:
    """Prove the configuration works, writing nothing.

    The first thing anybody needs from an integration like this is "can you
    see my mailbox", answered without it having already stored a hundred
    files. Every failure mode above returns its own message rather than a
    generic one, because 404-is-really-a-policy is the error that costs the
    most time.
    """
    source = db.execute(text("""
        SELECT mail_source_id, label, mailbox, folder, sender_contains,
               subject_contains, report_type, attachment_ext, is_enabled,
               last_seen_at
          FROM mail_source WHERE mail_source_id = :id
    """), {"id": source_id}).mappings().first()
    if not source:
        raise MailGraphError(f"No mail source with id {source_id}.")

    source = dict(source)
    token = get_token()
    messages = list_messages(token, source, limit=peek)

    exts = tuple(e.lower() for e in (source["attachment_ext"] or []))
    found = []
    for m in messages:
        if not m.get("hasAttachments"):
            continue
        for a in _attachments(token, source["mailbox"], m["id"]):
            name = (a.get("name") or "")
            if exts and not name.lower().endswith(exts):
                continue
            found.append({
                "filename": name,
                "size_bytes": a.get("size"),
                "subject": m.get("subject"),
                "received_at": m.get("receivedDateTime"),
                "sender": ((m.get("from") or {}).get("emailAddress") or {}).get("address"),
            })

    return {
        "ok": True,
        "mailbox": source["mailbox"],
        "folder": source["folder"],
        "messages_matched": len(messages),
        "attachments_found": found,
        "note": "Nothing was stored. This only proves the mailbox can be read.",
    }


def poll_source(db: Session, source_id: int, limit: int = PAGE_SIZE) -> dict:
    """Land every matching attachment this source has not seen.

    Idempotent on the bytes: a file already stored is reported as a duplicate
    and skipped, so re-running a poll after a half-failure cannot double
    anything. last_seen_at only advances for messages actually handled, so a
    message that threw is retried on the next pass rather than skipped.
    """
    source = db.execute(text("""
        SELECT mail_source_id, label, mailbox, folder, sender_contains,
               subject_contains, report_type, attachment_ext, is_enabled,
               last_seen_at
          FROM mail_source WHERE mail_source_id = :id
    """), {"id": source_id}).mappings().first()
    if not source:
        raise MailGraphError(f"No mail source with id {source_id}.")
    source = dict(source)
    if not source["is_enabled"]:
        return {"ok": False, "reason": "This source is switched off.",
                "landed": 0, "duplicates": 0}

    landed, duplicates, errors = 0, 0, []
    high_water = source["last_seen_at"]
    exts = tuple(e.lower() for e in (source["attachment_ext"] or []))

    try:
        token = get_token()
        for m in list_messages(token, source, limit=limit):
            received = m.get("receivedDateTime")
            try:
                if m.get("hasAttachments"):
                    for a in _attachments(token, source["mailbox"], m["id"]):
                        name = a.get("name") or ""
                        if exts and not name.lower().endswith(exts):
                            continue
                        raw = a.get("contentBytes")
                        if not raw:          # a reference or item attachment
                            continue
                        content = base64.b64decode(raw)
                        if len(content) > MAX_ATTACHMENT_BYTES:
                            errors.append(f"{name}: larger than 25 MB, refused")
                            continue
                        digest = hashlib.sha256(content).hexdigest()
                        res = db.execute(text("""
                            INSERT INTO mail_report_file (
                                mail_source_id, sha256, filename, size_bytes,
                                content, message_id, sender, subject, received_at)
                            VALUES (:sid, :sha, :fn, :sz, :content, :mid, :snd,
                                    :subj, :recv)
                            ON CONFLICT (sha256) DO NOTHING
                            RETURNING file_id
                        """), {
                            "sid": source["mail_source_id"], "sha": digest,
                            "fn": name, "sz": len(content), "content": content,
                            "mid": m.get("id"),
                            "snd": ((m.get("from") or {}).get("emailAddress") or {}).get("address"),
                            "subj": m.get("subject"), "recv": received,
                        }).first()
                        if res:
                            landed += 1
                        else:
                            duplicates += 1
                # Advanced only for a message that got through, so a failure
                # is retried next pass instead of being stepped over.
                if received and (high_water is None or str(received) > str(high_water)):
                    high_water = received
            except Exception as exc:                        # noqa: BLE001
                errors.append(f"{m.get('subject') or m.get('id')}: {exc}")

        db.execute(text("""
            UPDATE mail_source
               SET last_polled_at = now(),
                   last_seen_at   = COALESCE(:hw, last_seen_at),
                   last_error     = :err
             WHERE mail_source_id = :id
        """), {"id": source_id, "hw": high_water,
               "err": "; ".join(errors)[:1000] or None})
        db.commit()
    except Exception as exc:                                # noqa: BLE001
        db.rollback()
        db.execute(text("""
            UPDATE mail_source SET last_polled_at = now(), last_error = :err
             WHERE mail_source_id = :id
        """), {"id": source_id, "err": f"{type(exc).__name__}: {exc}"[:1000]})
        db.commit()
        raise

    return {"ok": True, "source": source["label"], "landed": landed,
            "duplicates": duplicates, "errors": errors}
