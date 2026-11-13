"""A retry must be the same handover, not just the same machine.

── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
A device retries under the same `client_uuid` until the office acknowledges
it, which is right: the pit has no signal and a lost response must not become
a lost record. But the server decided whether a retry was the same handover by
comparing two fields:

    prior["asset_id"] == payload["asset_id"]
    prior["session_type"] == payload["session_type"]

So a retry carrying different ANSWERS, a different operator, a different meter
reading or different GPS was accepted as an identical replay. The server kept
its original, returned it, and the tablet marked its own different version as
successfully filed. Nobody was told — on a record somebody signs their name
to, about whether a machine is safe.

The rule has two halves and both matter. An honest retry must still be
recognised, or a tablet with no signal retries forever and duplicates records
the moment it gets one. A changed one must be refused, or a signed record
becomes editable by whoever sends last.

Run: python tests/test_hoto_replay.py
"""
import copy
import os
import sys

# This worktree's app must win over the production checkout that carries the
# virtualenv, or the test reports on a file nobody edited.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.hoto_capture import fingerprint        # noqa: E402

ok = True


def check(name, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {name}")
    if not good:
        print(f"        got {got!r}, wanted {want!r}")


BASE = {
    "client_uuid": "0f5f0f3a-0000-4000-8000-000000000001",
    "asset_id": 25,
    "session_type": "TAKE_OVER",
    "operator_id": 7,
    "operator_emp_id": "OPR-2026-0152",
    "meter_reading": 8335,
    "meter_uom": "HOURS",
    "fuel_level": 55,
    "captured_at": "2026-11-13T22:40:00+05:30",
    "captured_lat": 21.034675,
    "captured_lon": 85.758628,
    "bulk_answered": False,
    "responses": [
        {"item_id": 2, "answer": "OK"},
        {"item_id": 1, "answer": "NOT_OK", "remark": "hose weeping"},
        {"item_id": 3, "numeric_value": 4.2},
    ],
}
A = fingerprint(BASE)


def variant(**over):
    v = copy.deepcopy(BASE)
    v.update(over)
    return v


print("an honest retry is still a retry")
check("the identical payload", fingerprint(copy.deepcopy(BASE)) == A, True)

reordered = copy.deepcopy(BASE)
reordered["responses"].reverse()
check("answers serialised in another order", fingerprint(reordered) == A, True)

check("a reading that arrived as a string",
      fingerprint(variant(meter_reading="8335.00")) == A, True)
check("a decimal that lost its trailing zero",
      fingerprint(variant(fuel_level=55.0)) == A, True)
check("the same instant written in another offset",
      fingerprint(variant(captured_at="2026-11-13T17:10:00+00:00")) == A, True)
check("the same instant written with Z",
      fingerprint(variant(captured_at="2026-11-13T17:10:00Z")) == A, True)

absent = copy.deepcopy(BASE)
absent["location_id"] = None
check("a field that was absent rather than null", fingerprint(absent) == A, True)
check("an empty string where nothing was recorded",
      fingerprint(variant(remarks="")) == A, True)

# Photos arrive separately, under their own identities. One turning up later
# must never make the handover it belongs to look altered.
check("a photo arriving later", fingerprint(variant(photos=[{"uuid": "x"}])) == A, True)
check("retry metadata", fingerprint(variant(sync_attempts=4)) == A, True)

print("\na changed record is NOT a retry")
changed = copy.deepcopy(BASE)
changed["responses"][0]["answer"] = "CAUTION"
check("one answer changed", fingerprint(changed) == A, False)

remarked = copy.deepcopy(BASE)
remarked["responses"][1]["remark"] = "hose replaced"
check("a remark on an answer changed", fingerprint(remarked) == A, False)

numeric = copy.deepcopy(BASE)
numeric["responses"][2]["numeric_value"] = 1.1
check("a gauge reading changed", fingerprint(numeric) == A, False)

check("the operator changed", fingerprint(variant(operator_id=9)) == A, False)
check("the meter reading changed", fingerprint(variant(meter_reading=8336)) == A, False)
check("the fuel level changed", fingerprint(variant(fuel_level=10)) == A, False)
check("where it was signed changed",
      fingerprint(variant(captured_lat=22.0)) == A, False)
check("when it was captured changed",
      fingerprint(variant(captured_at="2026-11-13T23:40:00+05:30")) == A, False)
check("the template answered changed",
      fingerprint(variant(template_version=2)) == A, False)
check("the one-tap flag changed",
      fingerprint(variant(bulk_answered=True)) == A, False)

dropped = copy.deepcopy(BASE)
dropped["responses"] = dropped["responses"][:2]
check("an answer dropped", fingerprint(dropped) == A, False)

added = copy.deepcopy(BASE)
added["responses"].append({"item_id": 4, "answer": "OK"})
check("an answer added", fingerprint(added) == A, False)

print("\nthe hash is a hash")
check("it is 64 hex characters", len(A) == 64 and all(c in "0123456789abcdef" for c in A), True)
check("it is stable across runs",
      A == fingerprint(copy.deepcopy(BASE)), True)

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
