"""The HOTO tablet app itself: its versions, what changed in each, and the files.

Asked for on 16 Nov: "upload, download the app from the dashboard itself, and
keep the app's history -- what we are changing". Until now a new build went
from a laptop to a tablet over a USB cable, and the only record of what was
in it was a commit message nobody at the mine reads.

── WHERE IT LIVES ──────────────────────────────────────────────────────────
Files on disk, like the machines' papers (routers/minehub.py,
ASSET_DOCUMENT_ROOT), under HOTO_APP_ROOT. The history is a manifest beside
them, releases.json, rather than a table: development and production share one
database here, and an app's release notes are no reason to change its schema.
Written to a temporary file and renamed into place, so a crash mid-write
leaves the previous history, never half of one.

── WHAT AN UPLOAD MUST BE ──────────────────────────────────────────────────
An APK of THIS app. The version, build number and package are read from the
APK itself (Expo puts its app config in assets/app.config), not typed in --
so the history cannot say 0.3.0 about a file that is 0.2.0, and a different
app cannot be published here by mistake. A version already here is refused:
Android installs an update only over a lower build, so every release needs
its own, raised in mobile/app.json before building.

What changed is required. A release with no notes is the history this exists
to stop.

── DOWNLOADING ON A PHONE ──────────────────────────────────────────────────
From the dashboard, signed in. And for a phone with no dashboard login, a
link signed with the server's key that works for seven days, shown as a QR
code -- served under /api/hoto/device/, the prefix a device reaches without a
session, by a handler that checks the signature itself.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PACKAGE = "in.balasorealloys.kaliapani.hoto"
MAX_BYTES = 200 * 1024 * 1024
LINK_DAYS = 7

ROOT = Path(os.environ.get(
    "HOTO_APP_ROOT",
    Path(__file__).resolve().parents[2] / "storage" / "hoto-app"))
_lock = threading.Lock()


class AppError(ValueError):
    def __init__(self, problems: list[str], status: int = 422):
        self.problems = problems
        self.status = status
        super().__init__("; ".join(problems))


# ── the manifest ─────────────────────────────────────────────────────────────

def _manifest_path() -> Path:
    return ROOT / "releases.json"


def _load() -> dict[str, Any]:
    p = _manifest_path()
    if not p.exists():
        return {"current": None, "releases": []}
    return json.loads(p.read_text(encoding="utf-8"))


def _save(m: dict[str, Any]) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    tmp = ROOT / f"releases.{uuid.uuid4().hex}.tmp"
    tmp.write_text(json.dumps(m, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, _manifest_path())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _public(r: dict[str, Any], current: str | None) -> dict[str, Any]:
    out = {k: v for k, v in r.items() if k != "stored_name"}
    out["is_current"] = r["id"] == current
    return out


def listing() -> dict[str, Any]:
    """Every release, newest first, and which one is current."""
    m = _load()
    # By build, which only rises: the order Android installs them in.
    rels = sorted(m["releases"], key=lambda r: r["build"], reverse=True)
    return {"current": m["current"], "releases": [_public(r, m["current"]) for r in rels]}


# ── reading an APK ───────────────────────────────────────────────────────────

def read_apk(payload: bytes) -> dict[str, Any]:
    """Version, build and package from the APK's own embedded app config."""
    if not payload.startswith(b"PK\x03\x04"):
        raise AppError(["That is not an APK (an Android app file)."])
    try:
        z = zipfile.ZipFile(io.BytesIO(payload))
        cfg = json.loads(z.read("assets/app.config"))
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError):
        raise AppError(["That APK does not say which version it is -- it was not built "
                        "from this project."])
    android = cfg.get("android") or {}
    pkg = android.get("package")
    if pkg != PACKAGE:
        raise AppError([f"That is a different app ({pkg or 'unknown'}), not the HOTO app."])
    version = str(cfg.get("version") or "").strip()
    build = android.get("versionCode")
    if not version or not isinstance(build, int):
        raise AppError(["That APK has no version or build number in it."])
    return {"version": version, "build": build, "package": pkg,
            "app_name": cfg.get("name") or "Kaliapani HOTO"}


# ── changing the history ─────────────────────────────────────────────────────

def upload(payload: bytes, file_name: str | None, notes: str | None, actor: str) -> dict[str, Any]:
    notes = (notes or "").strip()
    problems = []
    if not payload:
        problems.append("That file is empty.")
    elif len(payload) > MAX_BYTES:
        problems.append("That file is larger than 200 MB.")
    if len(notes) < 10:
        problems.append("Say what changed in this version -- the history is the point.")
    if problems:
        raise AppError(problems)
    info = read_apk(payload)

    with _lock:
        m = _load()
        same = [r for r in m["releases"] if r["build"] == info["build"]]
        if same:
            raise AppError([f"Build {info['build']} is already here (version {same[0]['version']}). "
                            "Raise the version and versionCode in mobile/app.json before "
                            "building: a phone only installs an update over a lower build."],
                           status=409)
        top = max((r["build"] for r in m["releases"]), default=0)
        if info["build"] < top:
            raise AppError([f"Build {info['build']} is older than build {top}, already here. "
                            "To go back to an older version, make that one current instead."],
                           status=409)
        rid = uuid.uuid4().hex[:12]
        stored = f"hoto-{info['version']}-b{info['build']}-{rid}.apk"
        ROOT.mkdir(parents=True, exist_ok=True)
        (ROOT / stored).write_bytes(payload)
        rel = {
            "id": rid, "version": info["version"], "build": info["build"],
            "package": info["package"], "app_name": info["app_name"],
            "file_name": f"Kaliapani-HOTO-{info['version']}-build{info['build']}.apk",
            "uploaded_as": (file_name or "")[:200], "stored_name": stored,
            "size_bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
            "notes": notes[:5000], "uploaded_by": actor, "uploaded_at": _now(),
            "withdrawn": False, "events": [{"at": _now(), "by": actor, "what": "uploaded"}],
        }
        m["releases"].append(rel)
        m["current"] = rid                      # the newest upload is what gets installed
        _save(m)
    return _public(rel, rid)


def _find(m: dict[str, Any], rid: str) -> dict[str, Any]:
    r = next((r for r in m["releases"] if r["id"] == rid), None)
    if not r:
        raise AppError(["No such version."], status=404)
    return r


def make_current(rid: str, actor: str) -> dict[str, Any]:
    with _lock:
        m = _load()
        r = _find(m, rid)
        if r["withdrawn"]:
            raise AppError(["That version was withdrawn. Upload a new one instead."], status=409)
        m["current"] = rid
        r["events"].append({"at": _now(), "by": actor, "what": "made current"})
        _save(m)
    return _public(r, rid)


def withdraw(rid: str, actor: str, reason: str | None) -> dict[str, Any]:
    """Take a version off download. It stays in the history, with why."""
    reason = (reason or "").strip()
    if not reason:
        raise AppError(["Say why it is being withdrawn -- the history keeps the reason."])
    with _lock:
        m = _load()
        r = _find(m, rid)
        r["withdrawn"] = True
        r["events"].append({"at": _now(), "by": actor, "what": f"withdrawn: {reason[:500]}"})
        if m["current"] == rid:
            live = sorted((x for x in m["releases"] if not x["withdrawn"]),
                          key=lambda x: x["build"], reverse=True)
            m["current"] = live[0]["id"] if live else None
        _save(m)
        return _public(r, m["current"])


def edit_notes(rid: str, actor: str, notes: str | None) -> dict[str, Any]:
    notes = (notes or "").strip()
    if len(notes) < 10:
        raise AppError(["Say what changed in this version."])
    with _lock:
        m = _load()
        r = _find(m, rid)
        r["notes"] = notes[:5000]
        r["events"].append({"at": _now(), "by": actor, "what": "notes edited"})
        _save(m)
        return _public(r, m["current"])


def file_for(rid: str, *, allow_withdrawn: bool = False) -> tuple[Path, str]:
    m = _load()
    r = _find(m, rid)
    if r["withdrawn"] and not allow_withdrawn:
        raise AppError(["That version was withdrawn."], status=410)
    p = ROOT / r["stored_name"]
    if not p.exists():
        raise AppError(["The record is here but the file is missing from storage."], status=410)
    return p, r["file_name"]


# ── a link a phone can open without signing in ──────────────────────────────

def _sign(rid: str, exp: int) -> str:
    from app.services.jwt_auth import _KEY          # the server's own secret
    return hmac.new(_KEY.encode(), f"hoto-app:{rid}:{exp}".encode(), "sha256").hexdigest()[:32]


def share_link(rid: str) -> dict[str, Any]:
    m = _load()
    r = _find(m, rid)
    if r["withdrawn"]:
        raise AppError(["That version was withdrawn."], status=410)
    exp = int(time.time()) + LINK_DAYS * 86400
    return {"path": f"/api/hoto/device/app/{rid}?exp={exp}&sig={_sign(rid, exp)}",
            "expires_at": datetime.fromtimestamp(exp, timezone.utc).isoformat(timespec="seconds")}


def check_link(rid: str, exp: int, sig: str) -> None:
    if exp < time.time():
        raise AppError(["This download link has expired. Ask for a new one from the dashboard."],
                       status=410)
    if not hmac.compare_digest(_sign(rid, exp), sig or ""):
        raise AppError(["This download link is not valid."], status=403)
