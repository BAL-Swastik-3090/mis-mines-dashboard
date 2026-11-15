"""The tablet app's versions on the dashboard: upload, history, download links.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
Asked for on 16 Nov: upload and download the app from the dashboard and keep
its history. These tests run against a folder of their own, so nothing in
the real store is touched, with small APK-shaped files built here -- and read
the real built APK, if there is one, to prove the version comes out of it.

Run: python tests/test_hoto_app_releases.py
"""
import io
import json
import os
import sys
import tempfile
import zipfile

ROOT = tempfile.mkdtemp(prefix="hoto-app-test-")
os.environ["HOTO_APP_ROOT"] = ROOT
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import hoto_app as appr                     # noqa: E402

ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {name}")
    if not good:
        print(f"        got {got!r}, wanted {want!r}")


def apk(version, build, package=appr.PACKAGE):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("assets/app.config", json.dumps(
            {"name": "Kaliapani HOTO", "version": version,
             "android": {"package": package, "versionCode": build}}))
        z.writestr("classes.dex", b"x" * 100)
    return b.getvalue()


def refusal(fn, *a, **kw):
    try:
        fn(*a, **kw)
        return None
    except appr.AppError as e:
        return e


NOTES = "Pairing code, whose device it is, photos kept safely."

print("what an upload must be")
check("notes are required", refusal(appr.upload, apk("0.2.0", 2), "a.apk", "", "t").status, 422)
check("not an APK is refused", refusal(appr.upload, b"%PDF-1.4", "a.pdf", NOTES, "t").status, 422)
e = refusal(appr.upload, apk("1.0", 9, package="com.other.app"), "a.apk", NOTES, "t")
check("another app is refused, by name", "com.other.app" in (e.problems[0] if e else ""), True)

print("the version comes out of the APK")
r1 = appr.upload(apk("0.2.0", 2), "hoto-local.apk", NOTES, "t")
check("version and build read from the file", (r1["version"], r1["build"]), ("0.2.0", 2))
check("named for what it is", r1["file_name"], "Kaliapani-HOTO-0.2.0-build2.apk")
check("the newest upload is current", r1["is_current"], True)
check("its storage name is not handed out", "stored_name" in r1, False)
e = refusal(appr.upload, apk("0.2.0", 2), "again.apk", NOTES, "t")
check("the same build twice is refused", e and e.status, 409)
r2 = appr.upload(apk("0.3.0", 3), "hoto-local.apk", "Version history on the dashboard.", "t")
e = refusal(appr.upload, apk("0.2.5", 2), "old.apk", NOTES, "t")
check("an older build is refused -- phones will not install it over a newer one", e and e.status, 409)

print("the history")
h = appr.listing()
check("newest first", [r["version"] for r in h["releases"]], ["0.3.0", "0.2.0"])
check("each says what changed", h["releases"][1]["notes"], NOTES)
appr.make_current(r1["id"], "t")
check("an older version can be made current again", appr.listing()["current"], r1["id"])
check("refused: withdrawing without a reason", refusal(appr.withdraw, r1["id"], "t", " ").status, 422)
appr.withdraw(r1["id"], "t", "crashed on start")
h = appr.listing()
check("withdrawing the current one falls back to the newest left", h["current"], r2["id"])
w = next(r for r in h["releases"] if r["id"] == r1["id"])
check("a withdrawn version stays in the history, with why",
      (w["withdrawn"], w["events"][-1]["what"]), (True, "withdrawn: crashed on start"))
check("and cannot be downloaded", refusal(appr.file_for, r1["id"]).status, 410)
check("except by an admin", appr.file_for(r1["id"], allow_withdrawn=True)[1], r1["file_name"])
appr.edit_notes(r2["id"], "t", "Version history and downloads on the dashboard.")
check("notes can be corrected, and that is recorded",
      appr.listing()["releases"][0]["events"][-1]["what"], "notes edited")

print("a link a phone can open")
link = appr.share_link(r2["id"])
q = dict(p.split("=") for p in link["path"].split("?")[1].split("&"))
check("a good link is let through", refusal(appr.check_link, r2["id"], int(q["exp"]), q["sig"]), None)
check("a changed one is not", refusal(appr.check_link, r2["id"], int(q["exp"]) + 1, q["sig"]).status, 403)
check("nor one for another version", refusal(appr.check_link, r1["id"], int(q["exp"]), q["sig"]).status, 403)
check("nor an expired one", refusal(appr.check_link, r2["id"], 1, q["sig"]).status, 410)

real = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    "mobile", "dist-apk", "hoto-local.apk")
if os.path.exists(real):
    print("the real built APK")
    info = appr.read_apk(open(real, "rb").read())
    check("is the HOTO app, with its version in it",
          (info["package"], bool(info["version"]), isinstance(info["build"], int)),
          (appr.PACKAGE, True, True))
    print(f"        (it says version {info['version']}, build {info['build']})")

print("\nALL PASS" if ok else "\nSOME FAILED")
sys.exit(0 if ok else 1)
