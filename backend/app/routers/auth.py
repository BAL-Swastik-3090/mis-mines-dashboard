"""Authentication + activity-tracking endpoints (intranet SSO).

The session id lives in an httpOnly cookie, so page scripts cannot read it and a
stolen XSS payload cannot exfiltrate it. The browser holds nothing else: there is
no token in localStorage to forge, and every request is validated against a row
in digital_apps_user_sessions.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.services import auth

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

settings = get_settings()

COOKIE = "mines_session"
MAX_AGE = auth.IDLE_HOURS * 3600
# The production site is HTTPS-only (nginx 301s port 80), so the cookie is marked
# Secure there. Local development runs on plain http, where Secure would stop the
# browser storing it at all.
COOKIE_SECURE = settings.app_env.lower() == "production"


def _set_cookie(response: Response, sid: str) -> None:
    response.set_cookie(
        COOKIE, sid,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=MAX_AGE,
        path="/",
    )


@router.post("/login")
def login(response: Response, request: Request, body: dict = Body(...),
          db: Session = Depends(get_db)) -> dict:
    empid = (body.get("empid") or "").strip()
    password = body.get("password") or ""
    if not empid or not password:
        raise HTTPException(400, "Employee ID and password are required.")

    emp = auth.authenticate(db, empid, password)
    if not emp:
        # Deliberately identical for an unknown EMPID, a wrong password and an
        # inactive account — otherwise this endpoint enumerates employee IDs.
        raise HTTPException(401, "Invalid Employee ID or Password")

    sid = auth.create_session(
        db, emp,
        request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )
    _set_cookie(response, sid)
    return {"status": "success", "user": emp}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)) -> dict:
    """The signed-in user. The frontend calls this on load to decide whether to
    show the app or the login screen — the server is the only authority."""
    s = auth.get_session(db, request.cookies.get(COOKIE))
    if not s:
        raise HTTPException(401, "Not authenticated.")
    return {"user": auth.employee(db, s["emp_id"])}


@router.post("/logout")
def logout(response: Response, request: Request, db: Session = Depends(get_db)) -> dict:
    sid = request.cookies.get(COOKIE)
    if sid:
        auth.end_session(db, sid, "LOGOUT")
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.post("/track")
def track(request: Request, body: dict = Body(...), db: Session = Depends(get_db)) -> dict:
    """Record a page view against the current session."""
    sid = request.cookies.get(COOKIE)
    s = auth.get_session(db, sid)
    if not s:
        raise HTTPException(401, "Not authenticated.")
    auth.record_page_view(db, sid, s["emp_id"], body.get("path", "/"),
                          body.get("time_spent"), body.get("referrer"))
    return {"ok": True}


@router.post("/heartbeat")
def heartbeat(request: Request, db: Session = Depends(get_db)) -> dict:
    """Keep a session alive while a dashboard is left open on a wall display."""
    sid = request.cookies.get(COOKIE)
    if sid:
        auth.touch(db, sid)
    return {"ok": True}
