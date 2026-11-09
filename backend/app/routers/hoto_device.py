"""The endpoints a tablet talks to.

── WHY THESE ARE SEPARATE FROM THE REST OF /api/hoto ────────────────────────
Everything under `/api/hoto` is behind the session middleware, which refuses a
request with no cookie before any handler runs. A tablet has no cookie and
should not have one. The weighbridge agent faced exactly this and the answer
there was one exempt path whose handler authenticates its own token
(`/api/weighbridge/readings`, see main.py) -- so this follows it rather than
teaching the middleware a second kind of principal.

The exemption is narrow on purpose. These four endpoints are everything a
device may do, and the dashboard's own HOTO endpoints -- the register, the
board, the defect queue, the template editor -- are untouched and still behind
the session check. A stolen device token can file handovers; it cannot read the
operator register, see the fleet's defects, or edit a checklist.

── THE ACTOR ON A DEVICE CAPTURE IS THE OPERATOR, NOT THE TABLET ────────────
A defect raised from a handover is attributed to the person who found it, which
is what makes it answerable. The tablet is recorded too -- `hoto_session
.device_id` -- but "TAB-01 reported the brakes NOT OK" is not something a
supervisor can go and ask about.
"""
from __future__ import annotations

from fastapi import (APIRouter, Depends, File, Form, Header, HTTPException,
                     Request, UploadFile)
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import hoto_capture as cap
from app.services import hoto_devices as dev
from app.services import hoto_masters as svc
from app.services import hoto_photos as pho

router = APIRouter(prefix="/api/hoto/device", tags=["HOTO device"])


def _device(x_hoto_device: str | None = Header(default=None),
            db: Session = Depends(get_minehub_db)) -> dict:
    """The enrolled tablet making this request."""
    try:
        return dev.authenticate(db, x_hoto_device)
    except dev.DeviceError as e:
        raise HTTPException(e.status, {"message": "This device is not allowed.",
                                       "problems": e.problems})


@router.post("/hello")
def hello(request: Request, app_version: str | None = Form(default=None),
          device: dict = Depends(_device),
          db: Session = Depends(get_minehub_db)) -> dict:
    """Check a token and say who the tablet is.

    The first thing the app calls after enrolment, so somebody standing next to
    the tablet finds out the token is wrong THEN, rather than when a handover
    fails to send at the end of a shift.
    """
    dev.seen(db, device["device_id"], app_version)
    return {"device_code": device["device_code"], "label": device["label"],
            "profile": device["profile"],
            # The device obeys this: a COMPANY tablet never carries an operator
            # between captures. Sent rather than hardcoded so the mine can
            # change a tablet's profile without a release.
            "may_inherit_identity": device["profile"] == "PERSONAL",
            "server_time": __import__("datetime").datetime.now().astimezone().isoformat()}


@router.get("/sync")
def device_sync(device: dict = Depends(_device),
                db: Session = Depends(get_minehub_db)) -> dict:
    """The masters this tablet caches.

    Scoped to the device's plant when it has one: a tablet at Kaliapani has no
    business holding another plant's operator register, and a smaller bundle
    also syncs through a shorter window of signal.
    """
    bundle = svc.sync_bundle(db, plant_id=device.get("plant_id"))
    dev.seen(db, device["device_id"], synced=True)
    return bundle


@router.post("/sessions", status_code=201)
def device_submit(payload: dict, device: dict = Depends(_device),
                  db: Session = Depends(get_minehub_db)):
    """File one captured handover from a tablet.

    Idempotent on `client_uuid`, exactly as the person-facing endpoint is -- it
    is the same service -- so a retry after a dropped connection returns the
    original record rather than filing a second handover.
    """
    # The operator who signed it. Falls back to the tablet only when the
    # capture names nobody, which the device's own rules already refuse.
    actor = (payload.get("operator_emp_id")
             or payload.get("confirmed_by")
             or f"device:{device['device_code']}")
    payload = {**payload, "device_id": device["device_id"]}
    try:
        result = cap.submit(db, payload, actor)
    except cap.CaptureConflict as e:
        raise HTTPException(409, str(e))
    except cap.CaptureError as e:
        raise HTTPException(e.status, {"message": "The handover was not filed.",
                                       "problems": e.problems})
    dev.seen(db, device["device_id"])
    if not result["created"]:
        from fastapi.responses import JSONResponse
        from app.routers.hoto import _jsonable
        return JSONResponse(status_code=200, content=_jsonable(result))
    return result


@router.post("/photos", status_code=201)
async def device_photo(photo_uuid: str = Form(...),
                       client_uuid: str = Form(...),
                       item_id: int | None = Form(default=None),
                       captured_at: str | None = Form(default=None),
                       sha256: str | None = Form(default=None),
                       lat: float | None = Form(default=None),
                       lon: float | None = Form(default=None),
                       accuracy_m: float | None = Form(default=None),
                       file: UploadFile = File(...),
                       device: dict = Depends(_device),
                       db: Session = Depends(get_minehub_db)) -> dict:
    """One photo from a tablet, uploaded on its own."""
    content = await file.read()
    try:
        out = pho.receive(
            db, photo_uuid=photo_uuid, client_uuid=client_uuid, content=content,
            actor=f"device:{device['device_code']}", item_id=item_id,
            captured_at=captured_at, content_type=file.content_type or "image/jpeg",
            sha256=sha256, lat=lat, lon=lon, accuracy_m=accuracy_m)
    except pho.PhotoError as e:
        raise HTTPException(e.status, {"message": "The photo was not stored.",
                                       "problems": e.problems})
    dev.seen(db, device["device_id"])
    return out
