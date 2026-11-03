"""The session cookie, as a signed JWT.

WHY A JWT WRAPPED ROUND A SESSION, AND NOT INSTEAD OF ONE
---------------------------------------------------------
A bare JWT is a bearer token the server cannot take back. Nothing in it can be
revoked before it expires, which would quietly undo three things this
application already promises:

    one session per employee   needs the server to close the OTHER sessions
    access revoked at once     checked on every request, not at next expiry
    twenty-minute idle         measured from last activity, not from issue

So the token carries a session id and proves nobody tampered with it; the
session row decides whether that id is still allowed. Signature first because
it is free, database second because it is the only thing that can say "no"
after the fact. A JWT whose signature verifies but whose row is closed is
refused — which is the whole point.

The alternative, a stateless JWT plus a revocation list, is the same database
lookup wearing a different hat.

WHAT IS IN IT
-------------
    iss  mines-dashboard        who minted it
    sub  employee id            who it is for
    sid  session id             the row this token stands for
    iat  issued at
    exp  issued + IDLE_MINUTES  so a stolen cookie dies on its own

No name, no role, no permissions. Those change while a session is open — a
role revoked at 10:05 must not keep working because a token minted at 10:00
still claims it. Anything that can change is read from the database, every
request.

SLIDING EXPIRY, WHICH ALSO FIXES AN OLD BUG
-------------------------------------------
The cookie used to be set once at login with max-age = IDLE_MINUTES and never
again, so the browser dropped it that many minutes after LOGIN however hard
somebody was working. The idle policy was always meant to run from last
activity. Now the token is re-minted once it is past half its life and the
cookie re-set with it, so an active session rolls forward and only a genuinely
idle one reaches exp.

THE KEY
-------
HS256, from JWT_SECRET in the environment. One service signs and verifies, so
a symmetric key is the right shape; RS256 would buy nothing and add a keypair
to manage. In production a missing or placeholder key is fatal at import —
refusing to start is the only safe failure, because the alternative is signing
every session with a value that is in the source history.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTError

from app.config import get_settings

log = logging.getLogger("mines.jwt")

ALGORITHM = "HS256"
ISSUER = "mines-dashboard"

# Anything a scaffold might have left behind. None of these may sign a token.
_PLACEHOLDERS = {"", "change-this-secret", "changeme", "secret", "your-secret-key"}


def _load_key() -> str:
    s = get_settings()
    for candidate in (getattr(s, "jwt_secret", ""), s.secret_key):
        if candidate and candidate not in _PLACEHOLDERS and len(candidate) >= 32:
            return candidate
    if s.app_env.lower() == "production":
        raise RuntimeError(
            "JWT_SECRET is missing, a placeholder, or shorter than 32 characters. "
            "Set it in .env before starting in production — an unsigned or "
            "guessably-signed session cookie is a forgeable login."
        )
    # Development only. Ephemeral on purpose: restarting invalidates tokens,
    # which is a visible nuisance rather than a silent weakness, and nobody
    # can accidentally ship a key that was never configured.
    log.warning("JWT_SECRET not configured — using an ephemeral development key. "
                "Sessions will not survive a restart. Set JWT_SECRET in .env.")
    return secrets.token_hex(32)


_KEY = _load_key()

Status = Literal["ok", "expired", "invalid", "absent"]


def issue(sid: str, emp_id: str, minutes: int) -> str:
    """Mint a token standing for an existing session row."""
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "iss": ISSUER,
            "sub": str(emp_id),
            "sid": sid,
            "iat": now,
            "exp": now + timedelta(minutes=minutes),
        },
        _KEY, algorithm=ALGORITHM,
    )


def read(raw: str | None) -> tuple[str | None, Status]:
    """Verify a cookie and return (session id, status).

    The status is separated from the id because the three failures mean
    different things to the person holding the cookie. Only "ok" returns an id
    to authenticate with.
    """
    if not raw:
        return None, "absent"
    try:
        claims = jwt.decode(raw, _KEY, algorithms=[ALGORITHM], issuer=ISSUER)
    except ExpiredSignatureError:
        return None, "expired"
    except JWTError:
        # A bad signature, a wrong issuer, a truncated cookie, or the raw
        # session id a browser is still holding from before this existed.
        return None, "invalid"
    sid = claims.get("sid")
    return (sid, "ok") if sid else (None, "invalid")


def sid_unverified(raw: str | None) -> str | None:
    """The session id out of a token that did NOT verify, for messaging only.

    An expired token still names the session it belonged to, and that row says
    whether the person was idle or was signed out because their ID was used
    somewhere else — two different things to tell them. Used ONLY to choose a
    sentence on a request that has already been refused. It authenticates
    nothing: the signature is still checked, only the expiry is not, so a
    forged token cannot reach even this.
    """
    if not raw:
        return None
    try:
        claims = jwt.decode(raw, _KEY, algorithms=[ALGORITHM], issuer=ISSUER,
                            options={"verify_exp": False})
    except JWTError:
        return None
    return claims.get("sid")


def needs_refresh(raw: str | None, minutes: int) -> bool:
    """True once a valid token is past half its life.

    Half, not "nearly expired": a tab that goes quiet for a few minutes and
    comes back must still find a cookie worth renewing. Renewing on every
    request instead would re-set the cookie on all fifteen calls a dashboard
    page fires, for no gain.
    """
    if not raw:
        return False
    try:
        claims = jwt.decode(raw, _KEY, algorithms=[ALGORITHM], issuer=ISSUER)
    except JWTError:
        return False
    iat, exp = claims.get("iat"), claims.get("exp")
    if not iat or not exp:
        return False
    return datetime.now(timezone.utc).timestamp() > iat + (exp - iat) / 2
