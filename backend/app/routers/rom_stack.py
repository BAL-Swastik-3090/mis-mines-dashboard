"""Building a ROM stack: which samples went into it, and the number it ships under.

── WHO MAY DO WHAT ─────────────────────────────────────────────────────────
Checked against request.state.permissions the way rom_entry and plan_entry do
it, which is stricter than the PREFIX_PAGE mapping in services/auth.py.

    romstack.view    read
    romstack.edit    build a stack and correct what went into it
    romstack.delete  remove a stack outright

NOT FOLDED INTO rom.edit. Filing what was dug and deciding what was built out
of it are different jobs, and the second one assigns the number the despatch
is invoiced under. It is the number, not the tonnage, that earns the separate
permission.

── A SAVE IS ONE STACK, ONE TRANSACTION ────────────────────────────────────
The screen holds a stack and submits it whole: lines added, lines corrected
and lines removed land together or none of them do. Half a stack in the
database is worse than none, because its weighted average would be computed
over the half and look perfectly reasonable.

── WHAT THE FORM SENDS AND WHAT IT DOES NOT ────────────────────────────────
It sends the figures, including the ones it fetched off the ROM sample, because
the mine may amend them. It does NOT send:

  amended         derived here by comparing against the sample. A client that
                  could assert "this is unamended" could hide a divergence,
                  and the flag exists precisely to make divergence visible.
  despatch_batch  resolved here from SAP. It is not the mine's to type: the
                  whole point of the key is that the ten-character batch is
                  SAP's answer, and typing it would reintroduce the mis-keying
                  the key was built to avoid.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db
from app.routers.rom_entry import _mrl
from app.services import rom_stack as st

router = APIRouter(prefix="/api/rom-stack", tags=["ROM Stack"])

VIEW = "romstack.view"
EDIT = "romstack.edit"
DELETE = "romstack.delete"

# One to four digits as typed; padded to four on the way in. The mine writes
# 414 where the batch ends 0414, so refusing the short form would be refusing
# the way they have written it for years -- padding is the right answer, not
# an error message.
_TAIL = re.compile(r"^[0-9]{1,4}$")


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _require(request: Request, code: str, doing: str) -> None:
    held = getattr(request.state, "permissions", None) or set()
    if code not in held:
        raise HTTPException(403, f"You do not have permission to {doing}.")


def _may(request: Request, code: str) -> bool:
    return code in (getattr(request.state, "permissions", None) or set())


def _tail(raw: Any) -> str:
    v = str(raw or "").strip()
    if not _TAIL.match(v):
        raise HTTPException(
            400, "A stack number is one to four digits — the last four of the "
                 "despatch batch. 414 is fine; it is stored as 0414.")
    return st.pad_no(v)


# ── read ────────────────────────────────────────────────────────────────────

@router.get("", summary="Stacks created in a window")
def get_range(
    request: Request,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    pg: Session = Depends(get_minehub_db),
) -> dict:
    _require(request, VIEW, "read the ROM stacks")
    to = to_date or date.today()
    frm = from_date or (to - timedelta(days=30))
    if frm > to:
        raise HTTPException(400, "The window starts after it ends.")
    stacks = st.range_stacks(pg, frm, to)
    # One lookup for the whole window rather than one per stack. See
    # services/rom_stack.despatch_for for why this is not a join on BATCH.
    shipped = st.despatch_for(pg, [s["stack_key"] for s in stacks])
    for s in stacks:
        s["despatch"] = shipped.get(s["stack_key"])
    return {
        "from_date": frm.isoformat(), "to_date": to.isoformat(),
        "stacks": stacks,
        "unmatched": sum(1 for s in stacks if not s["despatch"]),
        "may_edit": _may(request, EDIT),
        "may_delete": _may(request, DELETE),
    }


@router.get("/stack", summary="One stack, by its creation date and number")
def get_stack(request: Request,
              created_on: date = Query(...),
              stack_no: str = Query(...),
              pg: Session = Depends(get_minehub_db)) -> dict:
    """What the form opens on. A stack that does not exist yet answers with
    its key and `exists: false` rather than a 404 — the number is correct and
    useful before anything has been built under it, and a 404 would make the
    screen look broken every time somebody starts a new stack."""
    _require(request, VIEW, "read the ROM stacks")
    no = _tail(stack_no)
    key = st.stack_key(created_on, no)
    stack = st.find_stack(pg, created_on, no)
    lines = st.lines_of(pg, stack["stack_id"]) if stack else []
    return {
        "created_on": created_on.isoformat(),
        "stack_no": no,
        "stack_key": key,
        "exists": stack is not None,
        "stack": stack,
        "lines": lines,
        "summary": st.summarise(lines),
        "despatch": st.despatch_for(pg, [key]).get(key),
        "shifts": list(st.SHIFTS),
        "may_edit": _may(request, EDIT),
        "may_delete": _may(request, DELETE),
    }


@router.get("/samples", summary="The ROM samples a date and shift offers")
def get_samples(request: Request,
                on_date: date = Query(...),
                shift: str = Query(...),
                pg: Session = Depends(get_minehub_db)) -> dict:
    """The fetch. A production date and a shift, and back come that shift's
    samples with what is left of each after the stacks already built on them.

    A shifting-material shift answers with an empty list and says so, because
    shifting material was never filed as a ROM sample and there is nothing to
    fetch. That is the normal case for those three, not an error."""
    _require(request, VIEW, "read the ROM stacks")
    if shift not in st.SHIFTS:
        raise HTTPException(400, f"'{shift}' is not one of the shifts.")
    rows = st.available_samples(pg, on_date, shift)
    return {
        "on_date": on_date.isoformat(), "shift": shift,
        "is_shifting": st.is_shifting(shift),
        "samples": rows,
        "note": ("Shifting material is not filed as a ROM sample, so there is "
                 "nothing to fetch — type the line in full."
                 if st.is_shifting(shift) else None),
    }


# ── writing ─────────────────────────────────────────────────────────────────

def _num(item: dict, field: str, label: str, where: str, required: bool,
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
        # Two different complaints. A negative assay is a sign in the wrong
        # place; a nought quantity is a line somebody forgot to fill in or
        # forgot to remove, and saying "must be at least 0.001" would invite
        # them to type exactly that.
        raise HTTPException(
            400, f"{where}: {label} cannot be negative." if lo == 0
                 else f"{where}: {label} must be more than nought.")
    if hi is not None and f > hi:
        # The commonest mistake by far is a tonnage typed into an assay box.
        raise HTTPException(
            400, f"{where}: {label} must be between 0 and {hi:g} — got {f:g}. "
                 f"Is a tonnage in an assay column?")
    return f


def _clean_line(item: dict, i: int) -> dict:
    """One line, checked here as well as by the table's CHECK constraints so
    the screen gets a sentence instead of a database error."""
    where = f"Line {i + 1}"
    shift = str(item.get("shift") or "").strip()
    if shift not in st.SHIFTS:
        raise HTTPException(400, f"{where}: pick a shift.")
    try:
        on_date = date.fromisoformat(str(item.get("on_date", "")).strip())
    except ValueError:
        raise HTTPException(400, f"{where}: the production date is missing.")

    rom_id = item.get("rom_id")
    rom_id = int(rom_id) if rom_id not in (None, "") else None
    # SHIFTING MATERIAL HAS NO SAMPLE AND NEVER CAN HAVE. Enforced by the
    # table too; said here so the screen gets the reason rather than a
    # constraint name.
    if st.is_shifting(shift) and rom_id is not None:
        raise HTTPException(
            400, f"{where}: shifting material is not a ROM sample, so it "
                 f"cannot be linked to one.")
    if not st.is_shifting(shift) and rom_id is None:
        raise HTTPException(
            400, f"{where}: pick which {shift} shift sample this came off, or "
                 f"change the shift to shifting material.")

    loc = item.get("location_id")
    loc = int(loc) if loc not in (None, "") else None

    mrl, blk = item.get("block_mrl"), item.get("block_cr2o3_pct")
    mrl = str(mrl).strip() if mrl not in (None, "") else None
    if (mrl is None) != (blk in (None, "")):
        # Both or neither, which is what the ROM entry's own CHECK enforces.
        # A bench level with no grade beside it cannot be read against
        # anything.
        raise HTTPException(
            400, f"{where}: a block model needs both the mRL and the Cr2O3%. "
                 f"Leave both empty to clear it.")
    if mrl is not None:
        mrl = _mrl(mrl)
        if mrl is None:
            raise HTTPException(
                400, f"{where}: the mRL should be a bench level like 80, or a "
                     f"span like 80-82.")

    return {
        "line_id": item.get("line_id") or None,
        "rom_id": rom_id,
        "on_date": on_date,
        "shift": shift,
        "location_id": loc,
        "block_mrl": mrl,
        "block_cr2o3_pct": _num(item, "block_cr2o3_pct", "block Cr2O3%",
                                where, False, 0, 100),
        "cr2o3_pct": _num(item, "cr2o3_pct", "Cr2O3%", where, True, 0, 100),
        "feo_pct": _num(item, "feo_pct", "FeO%", where, True, 0, 100),
        "moisture_pct": _num(item, "moisture_pct", "moisture", where,
                             False, 0, 100),
        # Strictly more than nought, which the table enforces too. A line of
        # nothing is not a share of a sample; it is a line somebody forgot to
        # fill in or forgot to remove.
        "qty_mt": _num(item, "qty_mt", "quantity", where, True, 0.001),
    }


@router.put("", summary="Build or correct a stack")
def save_stack(request: Request, body: dict = Body(...),
               pg: Session = Depends(get_minehub_db)) -> dict:
    _require(request, EDIT, "build a ROM stack")
    try:
        created_on = date.fromisoformat(str(body.get("created_on", "")).strip())
    except ValueError:
        raise HTTPException(400, "A stack needs the date it was created.")
    if created_on > date.today():
        raise HTTPException(400, "A stack cannot be created in the future.")
    no = _tail(body.get("stack_no"))
    key = st.stack_key(created_on, no)

    raw = body.get("lines")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "A stack needs at least one line.")
    lines = [_clean_line(ln, i) for i, ln in enumerate(raw)]
    actor = _actor(request)

    # ── the samples the lines claim to have come off ────────────────────────
    # Read once, for two jobs: proving the link is true, and deciding which
    # figures have been amended. A line that names a sample whose date or
    # shift is not the line's own is a link that would read as provenance and
    # be a lie, so it is refused rather than stored.
    rom_ids = [ln["rom_id"] for ln in lines if ln["rom_id"]]
    samples = {r["rom_id"]: dict(r) for r in pg.execute(text("""
        SELECT rom_id, on_date, shift, location_id, moisture_pct,
               cr2o3_pct, feo_pct, block_mrl, block_cr2o3_pct
          FROM minehub.mines_rom_entry WHERE rom_id = ANY(:ids)
    """), {"ids": rom_ids or [0]}).mappings()} if rom_ids else {}

    for i, ln in enumerate(lines):
        if not ln["rom_id"]:
            ln["amended"] = False
            continue
        s = samples.get(ln["rom_id"])
        if s is None:
            raise HTTPException(
                404, f"Line {i + 1}: that ROM sample no longer exists. It may "
                     f"have been removed while this stack was open — reload "
                     f"and pick again.")
        if s["on_date"] != ln["on_date"] or s["shift"] != ln["shift"]:
            raise HTTPException(
                400, f"Line {i + 1}: that sample is "
                     f"{s['on_date'].isoformat()} shift {s['shift']}, not "
                     f"{ln['on_date'].isoformat()} shift {ln['shift']}.")
        # DERIVED, NEVER SENT. See the module docstring: a client that could
        # assert "unamended" could hide the very divergence this flag exists
        # to show.
        ln["amended"] = st.changed(
            s, ln, ("cr2o3_pct", "feo_pct", "moisture_pct",
                    "block_mrl", "block_cr2o3_pct"))

    # ── the stack itself ────────────────────────────────────────────────────
    stack = pg.execute(text("""
        SELECT stack_id, stack_key, created_on, stack_no, despatch_batch, note
          FROM minehub.mines_rom_stack WHERE stack_key = :k
    """), {"k": key}).mappings().first()
    # ABSENT IS NOT NULL. The entry form stopped sending a note on 25 Nov
    # 2026 when the box came off it, and the column is still there -- so a
    # body with no "note" key leaves whatever the stack holds alone, while a
    # body that sends an empty one clears it on purpose. Reading a missing key
    # as a clear would have every save silently erase a note some other client
    # had written.
    has_note = "note" in body
    note = str(body.get("note") or "").strip() or None

    inserted = updated = 0
    try:
        if stack is None:
            stack_id = pg.execute(text("""
                INSERT INTO minehub.mines_rom_stack
                       (created_on, stack_no, note, entry_id, updated_by)
                VALUES (:c, :n, :note, :a, :a)
             RETURNING stack_id
            """), {"c": created_on, "n": no,
                   "note": note if has_note else None, "a": actor}).scalar()
            st.log(pg, stack_id, key, "INSERT", "STACK", None,
                   {"created_on": created_on, "stack_no": no,
                    "note": note if has_note else None}, actor)
        else:
            stack_id = stack["stack_id"]
            if has_note and st.changed(dict(stack), {"note": note}, ("note",)):
                pg.execute(text("""
                    UPDATE minehub.mines_rom_stack
                       SET note = :note, updated_by = :a, updated_at = now()
                     WHERE stack_id = :id
                """), {"note": note, "a": actor, "id": stack_id})
                st.log(pg, stack_id, key, "UPDATE", "STACK",
                       {"note": stack["note"]}, {"note": note}, actor)

        before = {r["line_id"]: dict(r) for r in pg.execute(text("""
            SELECT line_id, rom_id, on_date, shift, location_id,
                   block_mrl, block_cr2o3_pct, cr2o3_pct, feo_pct,
                   moisture_pct, qty_mt
              FROM minehub.mines_rom_stack_line WHERE stack_id = :s
        """), {"s": stack_id}).mappings()}

        sent = {ln["line_id"] for ln in lines if ln["line_id"]}
        unknown = sent - set(before)
        if unknown:
            raise HTTPException(
                400, "A line being corrected is not on this stack.")

        for ln in lines:
            if ln["line_id"]:
                old = before[ln["line_id"]]
                pg.execute(text("""
                    UPDATE minehub.mines_rom_stack_line
                       SET rom_id = :rom_id, on_date = :on_date,
                           shift = :shift, location_id = :location_id,
                           block_mrl = :block_mrl,
                           block_cr2o3_pct = :block_cr2o3_pct,
                           cr2o3_pct = :cr2o3_pct, feo_pct = :feo_pct,
                           moisture_pct = :moisture_pct, qty_mt = :qty_mt,
                           amended = :amended,
                           updated_by = :a, updated_at = now()
                     WHERE line_id = :line_id
                """), {**ln, "a": actor})
                if st.changed(old, ln, st.LINE_FIELDS):
                    st.log(pg, stack_id, key, "UPDATE", "LINE",
                           {k: old[k] for k in st.LINE_FIELDS},
                           {k: ln[k] for k in st.LINE_FIELDS}, actor)
                    updated += 1
            else:
                pg.execute(text("""
                    INSERT INTO minehub.mines_rom_stack_line
                           (stack_id, rom_id, on_date, shift, location_id,
                            block_mrl, block_cr2o3_pct, cr2o3_pct, feo_pct,
                            moisture_pct, qty_mt, amended, entry_id, updated_by)
                    VALUES (:s, :rom_id, :on_date, :shift, :location_id,
                            :block_mrl, :block_cr2o3_pct, :cr2o3_pct, :feo_pct,
                            :moisture_pct, :qty_mt, :amended, :a, :a)
                """), {**ln, "s": stack_id, "a": actor})
                st.log(pg, stack_id, key, "INSERT", "LINE", None,
                       {k: ln[k] for k in st.LINE_FIELDS}, actor)
                inserted += 1

        dropped = set(before) - sent
        for lid in dropped:
            old = before[lid]
            st.log(pg, stack_id, key, "DELETE", "LINE",
                   {k: old[k] for k in st.LINE_FIELDS}, None, actor)
            pg.execute(text("DELETE FROM minehub.mines_rom_stack_line "
                            "WHERE line_id = :id"), {"id": lid})

        # ── and the despatch, if SAP has it ─────────────────────────────────
        # Resolved rather than typed. Written only when it is not already
        # there: once SAP has answered, the answer does not change, and
        # rewriting it on every save would put a no-op UPDATE in the way of
        # noticing if it ever did.
        if stack is None or stack["despatch_batch"] is None:
            found = st.despatch_for(pg, [key]).get(key)
            if found:
                pg.execute(text("""
                    UPDATE minehub.mines_rom_stack
                       SET despatch_batch = :b, updated_by = :a,
                           updated_at = now()
                     WHERE stack_id = :id
                """), {"b": found["batch"], "a": actor, "id": stack_id})
                st.log(pg, stack_id, key, "UPDATE", "STACK",
                       {"despatch_batch": None},
                       {"despatch_batch": found["batch"]}, actor)

        pg.commit()
    except HTTPException:
        pg.rollback()
        raise
    except Exception as exc:                                  # noqa: BLE001
        pg.rollback()
        msg = str(exc)
        if "ux_mines_rom_stack_key" in msg:
            raise HTTPException(
                409, f"Stack {key} already exists and this would be a second "
                     f"one. Open it instead, or use a different number.") from exc
        raise HTTPException(500, f"The stack was not saved: {exc}") from exc

    return {"saved": True, "stack_id": stack_id, "stack_key": key,
            "created_on": created_on.isoformat(), "stack_no": no,
            "inserted": inserted, "updated": updated,
            "deleted": len(dropped), "by": actor}


@router.delete("/{stack_id}", summary="Remove a stack")
def remove(request: Request, stack_id: int,
           pg: Session = Depends(get_minehub_db)) -> dict:
    """The lines go with it — the foreign key cascades. That is the right
    behaviour here and not a risk worth guarding: a stack's lines have no
    meaning apart from the stack, unlike a ROM sample, which stands on its own
    and is somebody else's work."""
    _require(request, DELETE, "remove a ROM stack")
    actor = _actor(request)
    old = pg.execute(text("""
        SELECT stack_id, stack_key, created_on, stack_no, despatch_batch, note
          FROM minehub.mines_rom_stack WHERE stack_id = :id
    """), {"id": stack_id}).mappings().first()
    if old is None:
        raise HTTPException(404, "There is no stack with that id.")

    try:
        lines = [dict(r) for r in pg.execute(text("""
            SELECT line_id, rom_id, on_date, shift, location_id,
                   block_mrl, block_cr2o3_pct, cr2o3_pct, feo_pct,
                   moisture_pct, qty_mt
              FROM minehub.mines_rom_stack_line WHERE stack_id = :s
        """), {"s": stack_id}).mappings()]
        # Every line into the log before the cascade takes them, so a deletion
        # leaves a record of exactly what was lost rather than a count of it.
        for ln in lines:
            st.log(pg, stack_id, old["stack_key"], "DELETE", "LINE", ln, None,
                   actor)
        st.log(pg, stack_id, old["stack_key"], "DELETE", "STACK", dict(old),
               None, actor)
        pg.execute(text("DELETE FROM minehub.mines_rom_stack "
                        "WHERE stack_id = :id"), {"id": stack_id})
        pg.commit()
    except Exception as exc:                                  # noqa: BLE001
        pg.rollback()
        raise HTTPException(500, f"The stack was not removed: {exc}") from exc
    return {"deleted": True, "stack_id": stack_id,
            "stack_key": old["stack_key"], "lines": len(lines), "by": actor}
