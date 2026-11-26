"""Filing the day-wise ROM analysis, in two halves by two people.

── WHO MAY DO WHAT ─────────────────────────────────────────────────────────
Every route here requires a permission of its own, checked against
request.state.permissions the way plan_entry does it. That is stricter than
the PREFIX_PAGE mapping in services/auth.py, which gates a whole prefix behind
one page: here the two halves of a single row are authorised separately, so a
page gate could not express it.

    rom.view        read
    rom.edit        the production half, and adding a location
    rom.block.edit  the block model half
    rom.delete      removing a sample outright

One person may hold both editing permissions and fill a row end to end. The
split is about what each permission authorises, not about how many people are
expected to be involved.

── A PRODUCTION SAVE IS ONE DAY, ONE TRANSACTION ───────────────────────────
The screen holds a day and submits it whole: rows added, rows corrected and
rows removed all land together or none of them do. Half a day in the database
is worse than none, because the totals would be computed over it and look
perfectly reasonable.

── AND IT WILL NOT SILENTLY DESTROY THE OTHER HALF ─────────────────────────
A row left out of the submission is deleted — that is how a line removed on
screen disappears. But if geology has already filed a block model against that
row, the deletion is refused by name. Removing it then has to be deliberate,
through DELETE, which is its own permission. Losing somebody else's work as a
side effect of omitting a line is not a thing this endpoint will do.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.services import rom_entry as rom

router = APIRouter(prefix="/api/rom-entry", tags=["Day-wise ROM"])

VIEW = "rom.view"
EDIT = "rom.edit"
BLOCK = "rom.block.edit"
DELETE = "rom.delete"

#: ...and what the ROM STACK form holds. The two forms share one list of
#: locations -- a stack is built out of the places the day's ROM came from --
#: so the stack form reads, and extends, this router's /locations.
#:
#: That was free while both forms rode on dashboard.mis. Once migration 137
#: gave each its own pair, a person granted only "Entry · ROM Stack" could
#: open their tab and the location dropdown came back 403, which is the form
#: not working at all. Named here rather than imported from rom_stack to keep
#: the two routers independent; e2e asserts the strings still match.
STACK_VIEW = "romstack.view"
STACK_EDIT = "romstack.edit"


#: The longest mRL the column holds. varchar(40) since migration 136; a value
#: over it is refused here with a sentence rather than by the database with a
#: driver error nobody on the screen can read.
_MRL_MAX = 40


def _mrl(raw: str) -> str | None:
    """The stored form of an mRL, or None if there is nothing in it.

    FREE TEXT SINCE 26 NOVEMBER 2026. It used to be a number or a span of two
    -- 80, 27.5, 80-82 -- and anything else was refused here and again by a
    CHECK constraint. The mine asked for the box to take what Geology actually
    writes, which includes '>80' and 'below 27': a bench is not always a
    number, and people were flattening what the survey said in order to get
    past the form. Migration 136 drops the matching constraints on both
    mines_rom_entry and mines_rom_stack_line.

    Two things are still done to it, and neither rejects anything:

    - RUNS OF WHITESPACE COLLAPSE TO ONE SPACE and the ends are trimmed, and
      SPACES AROUND A DASH ARE CLOSED UP. The second rule is kept from the old
      numeric version on purpose: '80 - 82' and '80-82' are one bench, the
      mine already has the closed-up spelling stored, and the form now offers
      what has been typed before -- so a rule that let those drift apart would
      split one entry in the very list that exists to stop that happening.
    - A value of nothing but spaces reads as no mRL at all, which is what the
      caller already treats as "clear the block model".

    Nothing else is touched. '>80', 'below 27' and 'RL 80 ~ 82' are stored
    exactly as typed.
    """
    v = re.sub(r"\s*-\s*", "-", re.sub(r"\s+", " ", raw)).strip()
    if not v:
        return None
    return v[:_MRL_MAX]


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _require(request: Request, code: str, doing: str) -> None:
    held = getattr(request.state, "permissions", None) or set()
    if code not in held:
        raise HTTPException(403, f"You do not have permission to {doing}.")


def _require_any(request: Request, codes: tuple[str, ...], doing: str) -> None:
    held = getattr(request.state, "permissions", None) or set()
    if not held.intersection(codes):
        raise HTTPException(403, f"You do not have permission to {doing}.")


def _may(request: Request, code: str) -> bool:
    return code in (getattr(request.state, "permissions", None) or set())


# ── read ────────────────────────────────────────────────────────────────────

@router.get("", summary="ROM samples over a window, by day")
def get_range(
    request: Request,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    pg: Session = Depends(get_minehub_db),
) -> dict:
    _require(request, VIEW, "read the ROM analysis")
    to = to_date or date.today()
    frm = from_date or (to - timedelta(days=30))
    if frm > to:
        raise HTTPException(400, "The window starts after it ends.")
    days = rom.range_days(pg, frm, to)
    flat = [r for d in days for r in d["rows"]]
    return {
        "from_date": frm.isoformat(), "to_date": to.isoformat(),
        "days": days,
        # The window read as one period, which is what a month's heading needs.
        "summary": rom.summarise(flat),
        "may_edit": _may(request, EDIT),
        "may_edit_block": _may(request, BLOCK),
        "may_delete": _may(request, DELETE),
    }


@router.get("/day", summary="One day, exactly as it was filed")
def get_day(request: Request, on_date: date = Query(...),
            pg: Session = Depends(get_minehub_db)) -> dict:
    _require(request, VIEW, "read the ROM analysis")
    rows = rom.day_rows(pg, on_date)
    return {
        "on_date": on_date.isoformat(),
        "exists": bool(rows),
        "rows": rows,
        "summary": rom.summarise(rows),
        "may_edit": _may(request, EDIT),
        "may_edit_block": _may(request, BLOCK),
        "may_delete": _may(request, DELETE),
    }


@router.get("/pending", summary="Samples still waiting on a block model")
def get_pending(request: Request, limit: int = Query(200, ge=1, le=1000),
                pg: Session = Depends(get_minehub_db)) -> dict:
    _require(request, VIEW, "read the ROM analysis")
    rows = rom.pending_block(pg, limit)
    return {"rows": rows, "count": len(rows),
            "may_edit_block": _may(request, BLOCK)}


@router.get("/locations", summary="The locations the entry form offers")
def get_locations(request: Request, include_inactive: bool = Query(False),
                  pg: Session = Depends(get_minehub_db)) -> dict:
    # Either form's audience: see STACK_VIEW above.
    _require_any(request, (VIEW, EDIT, STACK_VIEW, STACK_EDIT),
                 "read the ROM locations")
    # THE mRLs COME BACK WITH THE LOCATIONS, on one request rather than two.
    # The entry form needs both the moment it opens and neither changes while
    # it is open, so a second round trip would buy nothing but a second thing
    # to keep in step. They are both "what the dropdowns offer".
    return {"locations": rom.locations(pg, include_inactive),
            "mrls": rom.mrls(pg),
            # Whether THIS caller may extend the list. Both forms offer
            # "+ Add location", so both editors get it.
            "may_edit": _may(request, EDIT) or _may(request, STACK_EDIT)}


# ── locations ───────────────────────────────────────────────────────────────

@router.post("/locations", summary="Add a location to the list")
def add_location(request: Request, body: dict = Body(...),
                 pg: Session = Depends(get_minehub_db)) -> dict:
    """Typed on the entry form, because a dropdown nobody can extend is a
    dropdown people work around — and working around it is how the mine's
    workbook reached eighty-five spellings of about twenty places.

    The name is matched case-folded, so 'PIT BOTTOM' typed against an existing
    'Pit Bottom' returns that one instead of creating a second. The database
    refuses it either way; answering with the existing row is what stops the
    person on the screen from inventing a third spelling to get past the
    error.
    """
    _require_any(request, (EDIT, STACK_EDIT), "add a ROM location")
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "A location needs a name.")
    if len(name) > 60:
        raise HTTPException(400, "A location name is at most 60 characters.")

    existing = pg.execute(text("""
        SELECT location_id, name, is_active FROM minehub.mines_rom_location
         WHERE upper(btrim(name)) = upper(btrim(:n))
    """), {"n": name}).mappings().first()
    if existing:
        return {"created": False, "location_id": existing["location_id"],
                "name": existing["name"], "is_active": existing["is_active"],
                "note": f"'{existing['name']}' is already on the list."}

    actor = _actor(request)
    try:
        row = pg.execute(text("""
            INSERT INTO minehub.mines_rom_location (name, note, entry_id, updated_by)
            VALUES (:n, :note, :a, :a)
            RETURNING location_id, name, is_active
        """), {"n": name, "note": str(body.get("note") or "").strip() or None,
               "a": actor}).mappings().first()
        pg.commit()
    except Exception as exc:                                  # noqa: BLE001
        pg.rollback()
        raise HTTPException(500, f"The location was not added: {exc}") from exc
    return {"created": True, **dict(row)}


@router.patch("/locations/{location_id}", summary="Rename or retire a location")
def edit_location(request: Request, location_id: int, body: dict = Body(...),
                  pg: Session = Depends(get_minehub_db)) -> dict:
    """Retiring is the normal end of a location's life. Deleting is not
    offered at all: samples cite it, and a list that can lose an entry out
    from under the rows that name it is not a list anybody can trust."""
    _require(request, EDIT, "change a ROM location")
    sets, params = [], {"id": location_id, "a": _actor(request)}
    if "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "A location needs a name.")
        sets.append("name = :n")
        params["n"] = name
    if "is_active" in body:
        sets.append("is_active = :act")
        params["act"] = bool(body["is_active"])
    if "note" in body:
        sets.append("note = :note")
        params["note"] = str(body.get("note") or "").strip() or None
    if not sets:
        raise HTTPException(400, "Nothing to change.")

    try:
        row = pg.execute(text(f"""
            UPDATE minehub.mines_rom_location
               SET {', '.join(sets)}, updated_by = :a, updated_at = now()
             WHERE location_id = :id
         RETURNING location_id, name, is_active, note
        """), params).mappings().first()
        if row is None:
            pg.rollback()
            raise HTTPException(404, "There is no location with that id.")
        pg.commit()
    except HTTPException:
        raise
    except Exception as exc:                                  # noqa: BLE001
        pg.rollback()
        raise HTTPException(
            400, "That name is already on the list under a different "
                 "spelling." if "unique" in str(exc).lower()
                 else f"The location was not changed: {exc}") from exc
    return dict(row)


# ── the production half ─────────────────────────────────────────────────────

def _clean_row(item: dict, i: int) -> dict:
    """One sample, checked here as well as by the table's CHECK constraints so
    the screen gets a sentence instead of a database error."""
    where = f"Row {i + 1}"
    shift = str(item.get("shift") or "").strip().upper()
    if shift not in rom.SHIFTS:
        raise HTTPException(400, f"{where}: shift must be A, B or C.")
    try:
        loc = int(item["location_id"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, f"{where}: pick a location.")

    def num(field: str, label: str, required: bool,
            lo: float | None = None, hi: float | None = None) -> float | None:
        v = item.get(field)
        if v in (None, ""):
            if required:
                raise HTTPException(400, f"{where}: {label} is needed.")
            return None
        try:
            f = float(v)
        except (TypeError, ValueError):
            raise HTTPException(400, f"{where}: {label} is not a number.")
        if lo is not None and f < lo:
            raise HTTPException(400, f"{where}: {label} cannot be negative.")
        if hi is not None and f > hi:
            # The commonest mistake by far is a tonnage typed into an assay box.
            raise HTTPException(
                400, f"{where}: {label} must be between 0 and {hi:g} — got "
                     f"{f:g}. Is a tonnage in an assay column?")
        return f

    # REQUIRED SINCE 24 NOV 2026, at the mine's instruction, and required HERE
    # and not only on the form. The screen's own check is the sentence a user
    # reads; this is the one that keeps a half-filled row out of the table,
    # because every other way in -- a replayed request, a script, a second
    # client -- goes through here and not through the form.
    #
    # Nothing historical is shut out by the change: all 52 rows then in
    # mines_rom_entry already carried trips, moisture, Cr2O3 and FeO, so no
    # existing day became unsavable. Check that again before adding another.
    moisture = num("moisture_pct", "moisture", True, 0, 100)

    return {
        "rom_id": item.get("rom_id"),
        "shift": shift,
        "location_id": loc,
        "trips": num("trips", "trips", True, 0),
        "qty_mt": num("qty_mt", "tonnage", True, 0),
        "moisture_pct": moisture,
        # DERIVED HERE, NEVER SENT BY THE FORM. A figure arriving through this
        # endpoint was typed against this parcel by the mine, which is what
        # MEASURED means -- so the client has nothing to decide and no way to
        # claim a provenance it does not have. The pair also has to move
        # together: clearing the box clears the source, or migration 134's
        # CHECK rejects the row, which is exactly what it is for.
        "moisture_source": "MEASURED" if moisture is not None else None,
        "cr2o3_pct": num("cr2o3_pct", "Cr2O3%", True, 0, 100),
        "feo_pct": num("feo_pct", "FeO%", True, 0, 100),
    }


@router.put("/day", summary="File or correct a day's ROM samples")
def save_day(request: Request, body: dict = Body(...),
             pg: Session = Depends(get_minehub_db)) -> dict:
    _require(request, EDIT, "file the ROM analysis")
    try:
        on_date = date.fromisoformat(str(body.get("on_date", "")).strip())
    except ValueError:
        raise HTTPException(400, "A ROM entry needs the date of production.")
    if on_date > date.today():
        raise HTTPException(400, "A day that has not happened cannot be filed.")

    raw = body.get("rows")
    if not isinstance(raw, list):
        raise HTTPException(400, "Send the day's rows.")
    rows = [_clean_row(r, i) for i, r in enumerate(raw)]
    actor = _actor(request)

    before = {r["rom_id"]: r for r in pg.execute(text("""
        SELECT rom_id, shift, location_id, trips, qty_mt, moisture_pct,
               moisture_source, cr2o3_pct, feo_pct, block_cr2o3_pct
          FROM minehub.mines_rom_entry WHERE on_date = :d
    """), {"d": on_date}).mappings()}

    sent = {r["rom_id"] for r in rows if r["rom_id"]}
    unknown = sent - set(before)
    if unknown:
        raise HTTPException(400, "A row being corrected is not on that date.")

    # THE ONE THING THIS ENDPOINT REFUSES. See the module docstring.
    dropped = [i for i in set(before) - sent]
    blocked = [i for i in dropped if before[i]["block_cr2o3_pct"] is not None]
    if blocked:
        raise HTTPException(
            409, f"{len(blocked)} row(s) being removed already carry a block "
                 f"model filed by Geology. Remove those rows one at a time so "
                 f"it is deliberate, or leave them in place.")

    inserted = updated = 0
    try:
        for r in rows:
            if r["rom_id"]:
                old = before[r["rom_id"]]
                pg.execute(text("""
                    UPDATE minehub.mines_rom_entry
                       SET shift = :shift, location_id = :location_id,
                           trips = :trips, qty_mt = :qty_mt,
                           moisture_pct = :moisture_pct,
                           moisture_source = :moisture_source,
                           cr2o3_pct = :cr2o3_pct, feo_pct = :feo_pct,
                           updated_by = :a, updated_at = now()
                     WHERE rom_id = :rom_id
                """), {**r, "a": actor})
                if rom.changed(dict(old), r, rom.ROM_FIELDS):
                    rom.log(pg, r["rom_id"], on_date, "UPDATE", "ROM",
                            {k: old[k] for k in rom.ROM_FIELDS},
                            {k: r[k] for k in rom.ROM_FIELDS}, actor)
                    updated += 1
            else:
                new_id = pg.execute(text("""
                    INSERT INTO minehub.mines_rom_entry
                           (on_date, shift, location_id, trips, qty_mt,
                            moisture_pct, moisture_source,
                            cr2o3_pct, feo_pct, rom_entry_id, updated_by)
                    VALUES (:d, :shift, :location_id, :trips, :qty_mt,
                            :moisture_pct, :moisture_source,
                            :cr2o3_pct, :feo_pct, :a, :a)
                 RETURNING rom_id
                """), {**r, "d": on_date, "a": actor}).scalar()
                rom.log(pg, new_id, on_date, "INSERT", "ROM", None,
                        {k: r[k] for k in rom.ROM_FIELDS}, actor)
                inserted += 1

        for rid in dropped:
            old = before[rid]
            rom.log(pg, rid, on_date, "DELETE", "ROM",
                    {k: old[k] for k in rom.ROM_FIELDS}, None, actor)
            pg.execute(text("DELETE FROM minehub.mines_rom_entry "
                            "WHERE rom_id = :id"), {"id": rid})
        pg.commit()
    except HTTPException:
        pg.rollback()
        raise
    except Exception as exc:                                  # noqa: BLE001
        pg.rollback()
        raise HTTPException(500, f"The day was not saved: {exc}") from exc

    return {"saved": True, "on_date": on_date.isoformat(),
            "inserted": inserted, "updated": updated,
            "deleted": len(dropped), "by": actor}


# ── the block half ──────────────────────────────────────────────────────────

@router.put("/block", summary="File or correct the block model figures")
def save_block(request: Request, body: dict = Body(...),
               pg: Session = Depends(get_minehub_db)) -> dict:
    """Geology's submission. Takes whatever set of rows they have worked on,
    which may be one day's or several — the queue is ordered oldest first and
    a block is often shared across days, so being forced to submit a day at a
    time would mean filing the same two figures over and over.

    Sending both figures as null CLEARS the block half and hands the row back
    to the queue. That is a real action, not an empty save: a figure entered
    against the wrong row has to be removable without deleting the sample
    somebody else filed.
    """
    _require(request, BLOCK, "file the block model figures")
    raw = body.get("rows")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "Send the rows to fill in.")
    actor = _actor(request)

    wanted: dict[int, dict] = {}
    for i, item in enumerate(raw):
        try:
            rid = int(item["rom_id"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, f"Row {i + 1}: which sample is this for?")
        mrl, cr = item.get("block_mrl"), item.get("block_cr2o3_pct")
        if mrl in (None, "") and cr in (None, ""):
            wanted[rid] = {"block_mrl": None, "block_cr2o3_pct": None}
            continue
        # Both or neither, which is what the table's CHECK enforces too. A
        # bench level with no grade beside it cannot be read against anything.
        if mrl in (None, "") or cr in (None, ""):
            raise HTTPException(
                400, f"Row {i + 1}: a block model needs both the mRL and the "
                     f"Cr2O3%. Leave both empty to clear it.")
        try:
            cr_f = float(cr)
        except (TypeError, ValueError):
            raise HTTPException(400, f"Row {i + 1}: a figure is not a number.")
        if not 0 <= cr_f <= 100:
            raise HTTPException(
                400, f"Row {i + 1}: block Cr2O3% must be between 0 and 100 — "
                     f"got {cr_f:g}.")
        mrl_s = _mrl(str(mrl))
        if mrl_s is None:
            # The only way to get here now that the mRL is free text: a box
            # holding nothing but spaces. It looks filled on screen while the
            # Cr2O3 beside it genuinely is, so saying "it is empty" would read
            # as wrong to the person looking at it.
            raise HTTPException(
                400, f"Row {i + 1}: the mRL is blank. Type the bench — "
                     f"anything the survey says, such as 80, 80-82 or >80 — "
                     f"or clear the Cr2O3% beside it to drop the block model.")
        wanted[rid] = {"block_mrl": mrl_s, "block_cr2o3_pct": round(cr_f, 3)}

    before = {r["rom_id"]: r for r in pg.execute(text("""
        SELECT rom_id, on_date, block_mrl, block_cr2o3_pct
          FROM minehub.mines_rom_entry WHERE rom_id = ANY(:ids)
    """), {"ids": list(wanted)}).mappings()}
    missing = set(wanted) - set(before)
    if missing:
        raise HTTPException(
            404, f"{len(missing)} of those samples no longer exist — they may "
                 f"have been removed while the queue was open. Reload and try "
                 f"again.")

    filled = cleared = 0
    try:
        for rid, v in wanted.items():
            old = before[rid]
            is_clear = v["block_cr2o3_pct"] is None
            pg.execute(text("""
                UPDATE minehub.mines_rom_entry
                   SET block_mrl = :block_mrl,
                       block_cr2o3_pct = :block_cr2o3_pct,
                       block_entry_id = :bid,
                       -- The table requires the pair to travel with its
                       -- owner, so clearing the figures clears the name and
                       -- the date too. A date left behind would say somebody
                       -- filed something that is no longer there. Written as
                       -- SQL rather than a bound value because now() is the
                       -- database's clock, not the web server's.
                       block_entry_date = CASE WHEN CAST(:bid AS varchar) IS NULL
                                               THEN NULL ELSE now() END
                 WHERE rom_id = :id
            """), {**v, "id": rid,
                   "bid": None if is_clear else actor})
            if rom.changed(dict(old), v, rom.BLOCK_FIELDS):
                rom.log(pg, rid, old["on_date"], "UPDATE", "BLOCK",
                        {k: old[k] for k in rom.BLOCK_FIELDS}, v, actor)
            cleared += int(is_clear)
            filled += int(not is_clear)
        pg.commit()
    except HTTPException:
        pg.rollback()
        raise
    except Exception as exc:                                  # noqa: BLE001
        pg.rollback()
        raise HTTPException(
            500, f"The block model figures were not saved: {exc}") from exc

    return {"saved": True, "filled": filled, "cleared": cleared, "by": actor}


# ── removing a sample ───────────────────────────────────────────────────────

@router.delete("/{rom_id}", summary="Remove a sample")
def remove(request: Request, rom_id: int,
           pg: Session = Depends(get_minehub_db)) -> dict:
    _require(request, DELETE, "remove a ROM sample")
    actor = _actor(request)
    old = pg.execute(text("""
        SELECT rom_id, on_date, shift, location_id, trips, qty_mt,
               moisture_pct, moisture_source,
               cr2o3_pct, feo_pct, block_mrl, block_cr2o3_pct
          FROM minehub.mines_rom_entry WHERE rom_id = :id
    """), {"id": rom_id}).mappings().first()
    if old is None:
        raise HTTPException(404, "There is no sample with that id.")

    try:
        # The whole row goes into the log, block figures included, so a
        # deletion that also loses Geology's work leaves a record of exactly
        # what was lost.
        rom.log(pg, rom_id, old["on_date"], "DELETE", "ROM", dict(old), None,
                actor)
        pg.execute(text("DELETE FROM minehub.mines_rom_entry WHERE rom_id = :id"),
                   {"id": rom_id})
        pg.commit()
    except Exception as exc:                                  # noqa: BLE001
        pg.rollback()
        raise HTTPException(500, f"The sample was not removed: {exc}") from exc
    return {"deleted": True, "rom_id": rom_id,
            "on_date": old["on_date"].isoformat(), "by": actor}
