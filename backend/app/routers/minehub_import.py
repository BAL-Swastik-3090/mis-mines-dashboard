"""Reading a spreadsheet into the machine register.

Its own module rather than another three hundred lines in minehub.py, because
bulk import is a different kind of work from the rest of that router: it reads
a file somebody made by hand, and almost all of it is about saying clearly what
is wrong with that file rather than about writing rows.

Two things this deliberately does not do.

It does not approve anything. Everything it writes lands as DRAFT however the
row arrived, including rows that change a machine already approved — a
spreadsheet is somebody's working copy, and the register's whole claim is that
a person looked at each entry before it counted.

It does not invent reference data. A type or a contractor the register has
never heard of is an error on that row, not a new row in asset_type. One
misspelling would otherwise become a permanent second spelling that every
later report has to know about.

The caller asks for the plan first (dry_run), shows it, and asks again to
apply it. The plan is computed by the same code both times, so what was shown
is what happens.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.routers.minehub import (ASSET_FIELDS, _activity, _actor, _clean,
                                 _jsonable, _require_manage, _revise)

router = APIRouter(prefix="/api/minehub", tags=["MineHub"])

# Headings a spreadsheet carries, against the columns they mean. The export
# writes the left-hand names, so a register exported, corrected in Excel and
# sent back round-trips without anybody mapping anything by hand.
HEADINGS = {
    "machine": "fleet_code", "fleet code": "fleet_code", "fleet_code": "fleet_code",
    "code": "fleet_code",
    "reference": "asset_ref", "asset ref": "asset_ref", "asset_ref": "asset_ref",
    "name": "nickname", "nickname": "nickname",
    "registration": "registration_no", "registration no": "registration_no",
    "registration_no": "registration_no",
    "type": "asset_type", "asset type": "asset_type", "asset_type": "asset_type",
    "equipment type": "asset_type",
    "make": "make", "model": "model",
    "owner": "owner", "ownership": "ownership",
    "status": "status", "stage": "status",
    "fuel": "fuel_type", "fuel type": "fuel_type", "fuel_type": "fuel_type",
    "propulsion": "propulsion", "electric": "propulsion",
    "capacity": "capacity", "capacity uom": "capacity_uom",
    "capacity_uom": "capacity_uom",
    "chassis": "chassis_no", "chassis no": "chassis_no", "chassis_no": "chassis_no",
    "engine": "engine_no", "engine no": "engine_no", "engine_no": "engine_no",
    "year": "year_of_make", "year of make": "year_of_make",
    "year_of_make": "year_of_make",
    "sap equipment no": "sap_equipment_no", "sap_equipment_no": "sap_equipment_no",
    "remarks": "remarks", "note": "remarks", "notes": "remarks",
}

# Fields written to the row without interpretation, once _clean has turned the
# spreadsheet's strings into database values.
PASSTHROUGH = ("fleet_code", "nickname", "registration_no", "make", "model",
               "capacity", "capacity_uom", "chassis_no", "engine_no",
               "year_of_make", "fuel_type", "sap_equipment_no", "remarks")

# A spreadsheet is a person's working copy, and a person will paste ten
# thousand rows by accident. Large enough for the whole fleet several times
# over, small enough that the mistake is a refusal rather than an outage.
LIMIT = 2000

STAGES = {
    "active": "ACTIVE", "working": "ACTIVE", "running": "ACTIVE",
    "maintenance": "MAINTENANCE", "inworkshop": "MAINTENANCE",
    "workshop": "MAINTENANCE", "breakdown": "MAINTENANCE",
    "standby": "STANDBY", "idle": "IDLE",
    "offroad": "OFF_ROAD", "cannibalised": "CANNIBALISED",
    "cannibalized": "CANNIBALISED", "scrapped": "SCRAPPED",
    "disposed": "DISPOSED", "sold": "DISPOSED",
}

OURS = ("bal", "balasorealloys", "balasorealloysltd", "balasorealloyslimited",
        "own", "owned", "company")


def _key(v) -> str:
    """Case, spacing and punctuation removed, because a spreadsheet contains
    "Tipper ", "tipper" and "TIPPER" and they are one type."""
    return re.sub(r"[^a-z0-9]", "", str(v or "").lower())


@router.post("/assets/import")
def import_assets(request: Request, body: dict = Body(...),
                  db: Session = Depends(get_minehub_db)) -> dict:
    """Plan a spreadsheet import, or apply a plan that had no errors."""
    _require_manage(request, "import machines")

    rows = body.get("rows") or []
    if not isinstance(rows, list):
        raise HTTPException(400, "Expected a list of rows.")
    if len(rows) > LIMIT:
        raise HTTPException(
            400, f"{len(rows):,} rows is more than this will take in one go "
                 f"(the limit is {LIMIT:,}). Split the file.")
    dry_run = bool(body.get("dry_run", True))

    # Reference data, read once for the whole file rather than per row.
    types = {_key(r["name"]): r["asset_type_id"] for r in db.execute(text(
        "SELECT asset_type_id, name FROM asset_type")).mappings()}
    parties = {_key(r["display_name"]): r["party_id"] for r in db.execute(text(
        "SELECT party_id, display_name FROM party")).mappings()}
    by_ref = {str(r["asset_ref"]).upper(): r for r in db.execute(text(
        "SELECT asset_id, asset_ref, fleet_code, version FROM asset "
        "WHERE asset_ref IS NOT NULL")).mappings()}
    by_code = {_key(r["fleet_code"]): r for r in db.execute(text(
        "SELECT asset_id, asset_ref, fleet_code, version FROM asset")).mappings()}

    plan: list[dict] = []
    seen: set[str] = set()

    for i, raw in enumerate(rows):
        line = i + 2                 # row 1 is the headings, as Excel counts
        if not isinstance(raw, dict):
            plan.append({"line": line, "action": "ERROR", "machine": "",
                         "message": "Not a row."})
            continue

        # Headings to fields. A column we do not recognise is ignored rather
        # than failing the file — people keep their own working columns, and
        # refusing the import over one of them helps nobody.
        row: dict = {}
        for k, v in raw.items():
            field = HEADINGS.get(str(k).strip().lower())
            if field and str(v if v is not None else "").strip() != "":
                row[field] = str(v).strip()

        name = row.get("fleet_code") or row.get("asset_ref") or ""
        if not row:
            plan.append({"line": line, "action": "SKIP", "machine": name,
                         "message": "Nothing on this row the register uses."})
            continue

        problems: list[str] = []
        data: dict = {}

        if "asset_type" in row:
            found = types.get(_key(row["asset_type"]))
            if found:
                data["asset_type_id"] = found
            else:
                problems.append(
                    f'No equipment type called "{row["asset_type"]}". '
                    "Correct the spelling, or add the type first.")

        if "owner" in row:
            owner = row["owner"]
            if _key(owner) in OURS:
                data["ownership"] = "OWN"
                data["owner_party_id"] = None
            else:
                found = parties.get(_key(owner))
                if found:
                    data["ownership"] = "HIRED"
                    data["owner_party_id"] = found
                else:
                    problems.append(
                        f'No contractor called "{owner}" is registered.')
        elif "ownership" in row:
            o = _key(row["ownership"])
            if o in OURS:
                data["ownership"] = "OWN"
            elif o in ("hired", "hire", "rented", "rent"):
                data["ownership"] = "HIRED"
            else:
                problems.append(
                    f'Ownership must be Own or Hired, not "{row["ownership"]}".')

        if "status" in row:
            found = STAGES.get(_key(row["status"]))
            if found:
                data["status"] = found
            else:
                problems.append(
                    f'"{row["status"]}" is not a stage a machine can be in.')

        if "propulsion" in row:
            p = _key(row["propulsion"])
            data["propulsion"] = ("EV" if p in ("ev", "electric", "battery", "yes")
                                  else "HYBRID" if p == "hybrid" else "NON_EV")

        for f in PASSTHROUGH:
            if f in row:
                data[f] = row[f]

        # _clean turns "" into None and text into numbers, and raises on a
        # number that is not one. Fields it does not own are carried across.
        try:
            cleaned = _clean({k: v for k, v in data.items() if k in ASSET_FIELDS})
            data = {**cleaned,
                    **{k: v for k, v in data.items() if k not in ASSET_FIELDS}}
        except HTTPException as e:
            problems.append(str(e.detail))

        # ── is this a machine we already have? ──────────────────────────────
        match = None
        if row.get("asset_ref"):
            match = by_ref.get(row["asset_ref"].upper())
            if not match:
                problems.append(
                    f"No machine has reference {row['asset_ref']}. Clear that "
                    "cell to register it as a new machine.")
        elif row.get("fleet_code"):
            match = by_code.get(_key(row["fleet_code"]))

        # A file naming the same machine twice would apply both rows and keep
        # whichever came last, without saying so.
        if row.get("fleet_code"):
            k = _key(row["fleet_code"])
            if k in seen:
                problems.append("This machine appears more than once in the file.")
            seen.add(k)
        elif not match:
            problems.append("A new machine needs a Machine code.")

        if problems:
            plan.append({"line": line, "action": "ERROR", "machine": name,
                         "message": " ".join(problems)})
            continue

        if match:
            plan.append({"line": line, "action": "UPDATE", "machine": name,
                         "asset_id": match["asset_id"],
                         "asset_ref": match["asset_ref"],
                         "version": match["version"] or 1,
                         "message": f"Changes {len(data)} field(s) on "
                                    f"{match['fleet_code']} and returns it to draft.",
                         "_data": data})
        else:
            plan.append({"line": line, "action": "CREATE", "machine": name,
                         "message": f"Registers {name} as a new draft.",
                         "_data": data})

    counts = {a: sum(1 for p in plan if p["action"] == a)
              for a in ("CREATE", "UPDATE", "SKIP", "ERROR")}
    visible = [{k: v for k, v in p.items() if k != "_data"} for p in plan]

    if dry_run:
        return {"dry_run": True, "counts": counts, "plan": visible}

    # Nothing is written while the file still has a bad row in it. A partial
    # import is the worst outcome available: the person cannot tell what landed
    # and what did not, and running it again double-registers whatever worked.
    if counts["ERROR"]:
        raise HTTPException(
            400, f"{counts['ERROR']} row(s) still have problems. Nothing was "
                 "imported — fix them in the file and try again.")

    actor = _actor(request)
    created = updated = unchanged = 0

    for p in plan:
        data = p.get("_data") or {}
        if not data:
            continue

        if p["action"] == "CREATE":
            cols = list(data.keys())
            new = db.execute(text(
                f"INSERT INTO asset ({', '.join(cols)}, created_by, approval_status) "
                f"VALUES ({', '.join(':' + c for c in cols)}, :by, 'DRAFT') "
                f"RETURNING asset_id, asset_ref"
            ), {**data, "by": actor}).mappings().first()
            _revise(db, request, new["asset_id"], 1, "CREATED",
                    {k: {"from": None, "to": _jsonable(v)} for k, v in data.items()},
                    remarks="Imported from a spreadsheet")
            _activity(db, request, "ASSET_IMPORTED", asset_id=new["asset_id"],
                      payload={"asset_ref": new["asset_ref"], "line": p["line"],
                               "fields": sorted(data.keys())})
            created += 1

        else:
            asset_id = p["asset_id"]
            before = db.execute(text("SELECT * FROM asset WHERE asset_id = :i"),
                                {"i": asset_id}).mappings().first()
            changes = {k: {"from": _jsonable(before[k]), "to": _jsonable(v)}
                       for k, v in data.items()
                       if _jsonable(before[k]) != _jsonable(v)}
            # A row that matches what is already there is not a change, and
            # writing it would burn a version and a revision saying nothing.
            if not changes:
                unchanged += 1
                continue
            sets = ", ".join(f"{c} = :{c}" for c in data)
            db.execute(text(
                f"UPDATE asset SET {sets}, version = version + 1, "
                f"approval_status = 'DRAFT', updated_at = now() "
                f"WHERE asset_id = :i"), {**data, "i": asset_id})
            _revise(db, request, asset_id, p["version"] + 1, "UPDATED", changes,
                    remarks="Imported from a spreadsheet")
            _activity(db, request, "ASSET_IMPORTED", asset_id=asset_id,
                      payload={"asset_ref": p.get("asset_ref"), "line": p["line"],
                               "fields": sorted(changes.keys())})
            updated += 1

    db.commit()
    return {"dry_run": False, "created": created, "updated": updated,
            "unchanged": unchanged, "counts": counts}
