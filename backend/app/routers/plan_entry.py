"""Filing the mine's three plans: despatch, the COB plant, and excavation.

The data moved to this platform in migrations 127 and 128 and has been READ
from here since 16 November. Nothing wrote it, because the screens did not
exist -- PPIC and Geology went on filing wherever they filed before, and that
copy stopped reaching the dashboard the moment the reads moved. This closes
that.

── ONE ROUTER, THREE PLANS ────────────────────────────────────────────────
They differ in their columns and in nothing else: a month of days, each day a
row, filed by one person and corrected by another. Three routers would be the
same four endpoints written three times, and the third would drift.

So the shape of each plan is DATA -- see PLANS below -- and the endpoints are
written once. A column that is generated in the database is not listed there
and so cannot be written here; the database would refuse it, but the screen
should never offer it in the first place.

── A MONTH AT A TIME, DELIBERATELY ────────────────────────────────────────
Both the people who file these work a month at a time: a sheet is prepared for
November and pasted in one go. Saving a day at a time would mean thirty
requests and thirty chances to stop half way, and the mine's own sheet has no
notion of a single day being "saved".

So a save is one transaction: either the month lands or none of it does.

── AND NOTHING IS DELETED TO MAKE ROOM ────────────────────────────────────
A save UPSERTS the days it was given and leaves every other day alone. A month
posted with ten days does not erase the other twenty. Removing a day is its
own endpoint, behind its own permission, because "I did not include it" and "I
want it gone" are different intentions and only one of them is reversible by
typing the figure again.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.minehub_db import get_minehub_db

router = APIRouter(prefix="/api/plan-entry", tags=["Plan Entry"])

VIEW = "plan.view"
DELETE = "plan.delete"


class Plan:
    """What one plan is: its table, its key, and the columns a person types."""

    def __init__(self, kind: str, table: str, date_col: str, edit_perm: str,
                 label: str, columns: list[tuple[str, str, str]],
                 extra_key: list[tuple[str, str]] | None = None,
                 text_columns: tuple[str, ...] = ("remarks",),
                 generated_group: str = "Computed"):
        self.kind = kind
        self.table = table
        self.date_col = date_col
        self.edit_perm = edit_perm
        self.label = label
        self.generated_group = generated_group
        #: (column, heading, group) in the order the screen shows them. The
        #: group is what the mine's own sheet calls that block of columns --
        #: Balasore, Sukinda -- and the grid bands them under it. Twenty-two
        #: columns in one flat run was unreadable; the first version of this
        #: screen proved it.
        #:
        #: GENERATED
        #: columns are absent on purpose -- the database computes them and
        #: would refuse a write, and offering them would invite a figure that
        #: disagrees with its own inputs.
        self.columns = columns
        #: Columns beyond the date that identify a row. Excavation is filed
        #: per shift and face, so a date alone does not name one.
        self.extra_key = extra_key or []
        self.text_columns = text_columns

    @property
    def key_columns(self) -> list[str]:
        return [self.date_col] + [c for c, _ in self.extra_key]


PLANS: dict[str, Plan] = {
    "despatch": Plan(
        kind="despatch", table="despatch_plan", date_col="plan_date",
        edit_perm="plan.despatch.edit", label="Despatch Plan",
        columns=[
            ("bal_crfe_qty", "Cr/Fe", "Balasore"),
            ("bal_hg_qty", "HG", "Balasore"),
            ("bal_mg_qty", "MG", "Balasore"),
            ("bal_lg_qty", "LG", "Balasore"),
            ("bal_cob_qty", "COB", "Balasore"),
            ("bal_lump_qty", "Lump", "Balasore"),
            ("suk_crfe_qty", "Cr/Fe", "Sukinda"),
            ("suk_hg_qty", "HG", "Sukinda"),
            ("suk_mg_qty", "MG", "Sukinda"),
            ("suk_lg_qty", "LG", "Sukinda"),
            ("suk_cob_qty", "COB", "Sukinda"),
            ("suk_lump_qty", "Lump", "Sukinda"),
            ("remarks", "Remarks", "Note"),
        ],
    ),
    # ELEVEN FIGURES, NOT SIXTEEN. Running hours, feed quantity, concentrate,
    # tailings and chrome recovery are generated -- see migration 127, where
    # each was proved against all 244 stored rows before being made so.
    "cobp": Plan(
        kind="cobp", table="cobp_plan", date_col="plan_date",
        edit_perm="plan.despatch.edit", label="COB Plant Plan",
        columns=[
            ("total_avail_hr", "Available", "Hours"),
            ("shutdown_hr", "Shutdown", "Hours"),
            ("throughput_capacity", "Capacity", "Rate MT/hr"),
            ("planned_feed_rate", "Planned feed", "Rate MT/hr"),
            ("feed_grade_cr2o3", "Cr2O3 %", "Feed"),
            ("feed_ratio_crfe", "Cr/Fe", "Feed"),
            ("weight_recovery", "Wt recovery %", "Feed"),
            ("concentrate_grade_cr2o3", "Cr2O3 %", "Concentrate"),
            ("concentrate_ratio_crfe", "Cr/Fe", "Concentrate"),
            ("tailings_grade_cr2o3", "Cr2O3 %", "Tailings"),
            ("remarks", "Remarks", "Note"),
        ],
    ),
    "excavation": Plan(
        kind="excavation", table="excavation_plan", date_col="prod_date",
        edit_perm="plan.excavation.edit", label="Excavation Plan",
        # face_desc is GONE from the typed columns. It was the only
        # description a face had, and that is exactly why seventeen faces
        # collected a hundred and nine spellings of themselves. The name now
        # comes from mine_face, through the foreign key migration 130 added,
        # and the server fills face_desc from it on write so the stored row
        # still reads on its own.
        columns=[
            ("ob_qty_cum", "OB CuM", "Overburden"),
            ("ore_qty", "Ore MT", "Ore"),
            ("hg_qty", "HG", "Ore"),
            ("mg_qty", "MG", "Ore"),
            ("lg_qty", "LG", "Ore"),
        ],
        extra_key=[("shift", "Shift"), ("loc_id", "Face #")],
        text_columns=(),
    ),
}


def _plan(kind: str) -> Plan:
    p = PLANS.get(kind)
    if p is None:
        raise HTTPException(404, f"There is no plan called '{kind}'.")
    return p


def _actor(request: Request) -> str:
    return getattr(request.state, "emp_id", None) or "unknown"


def _require(request: Request, code: str, doing: str) -> None:
    """Refuse plainly, naming what was being attempted.

    The permissions live per plan, not per module: PPIC files despatch and
    COB, Geology files excavation, and neither should be able to rewrite the
    other's by accident. See migration 129.
    """
    held = getattr(request.state, "permissions", None) or set()
    if code not in held:
        raise HTTPException(403, f"You do not have permission to {doing}.")


def _month_bounds(month: str) -> tuple[date, date]:
    """'YYYY-MM' to its first and last day.

    The month is a string rather than two dates because the screen works in
    months and a caller cannot then send a 'month' that is really six weeks.
    """
    try:
        year, mon = (int(x) for x in month.split("-"))
        first = date(year, mon, 1)
    except (ValueError, TypeError):
        raise HTTPException(400, f"'{month}' is not a month. Use YYYY-MM.")
    last = date(year + (mon == 12), (mon % 12) + 1, 1)
    return first, date.fromordinal(last.toordinal() - 1)


@router.get("/{kind}", summary="A month of one plan, as filed")
def get_month(kind: str, request: Request,
              month: str = Query(..., description="YYYY-MM"),
              db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, VIEW, f"read the {_plan(kind).label.lower()}")
    p = _plan(kind)
    first, last = _month_bounds(month)

    cols = ", ".join(["t." + c for c in p.key_columns]
                     + ["t." + c for c, _, _g in p.columns]
                     + ["t.entry_id", "t.entry_date", "t.updated_by",
                        "t.updated_at", "t.revision"])
    # The excavation plan carries a face number. On its own it means nothing
    # to the person reading it, so the master's name comes along -- and the
    # text that was typed against the row before the master existed, which is
    # kept and shown when the two disagree.
    join, extra = "", ""
    if p.table == "excavation_plan":
        join = " LEFT JOIN minehub.mine_face f ON f.face_no = t.loc_id"
        extra = ", f.name AS face_name, f.face_kind, f.status AS face_status, t.face_desc AS face_typed"
    rows = db.execute(text(f"""
        SELECT {cols}{extra} FROM minehub.{p.table} t{join}
         WHERE t.{p.date_col} BETWEEN :f AND :t
         ORDER BY {', '.join('t.' + c for c in p.key_columns)}
    """), {"f": first, "t": last}).mappings().all()

    # The generated columns come back too, read-only, so the screen can show
    # the totals the mine checks its own sheet against without computing them
    # a second time in the browser and risking a different answer.
    generated = [r[0] for r in db.execute(text("""
        SELECT column_name FROM information_schema.columns
         WHERE table_schema='minehub' AND table_name=:t AND is_generated='ALWAYS'
         ORDER BY ordinal_position"""), {"t": p.table}).all()]
    gen_rows: dict[tuple, dict] = {}
    if generated:
        gcols = ", ".join(p.key_columns + generated)
        for g in db.execute(text(f"""
                SELECT {gcols} FROM minehub.{p.table}
                 WHERE {p.date_col} BETWEEN :f AND :t
            """), {"f": first, "t": last}).mappings().all():
            gen_rows[tuple(g[k] for k in p.key_columns)] = {
                c: g[c] for c in generated}

    out = []
    for r in rows:
        d = dict(r)
        d["computed"] = gen_rows.get(tuple(r[k] for k in p.key_columns), {})
        out.append(d)

    return {
        "kind": p.kind, "label": p.label, "month": month,
        "from": first.isoformat(), "to": last.isoformat(),
        "key_columns": p.key_columns,
        # The headings for the key columns, which the screen was rendering as
        # the raw column name -- "loc id" meant nothing to anybody.
        "key_headings": [{"name": p.date_col, "heading": "Day"}]
                        + [{"name": c, "heading": h} for c, h in p.extra_key],
        "columns": [{"name": c, "heading": h, "group": g,
                     "kind": "text" if c in p.text_columns else "number"}
                    for c, h, g in p.columns],
        "generated_group": p.generated_group,
        "generated": generated,
        "count": len(out),
        "rows": out,
        "may_edit": p.edit_perm in (getattr(request.state, "permissions", None) or set()),
        "may_delete": DELETE in (getattr(request.state, "permissions", None) or set()),
    }


@router.put("/{kind}", summary="File a month of one plan")
def save_month(kind: str, request: Request,
               month: str = Body(..., embed=True),
               rows: list[dict] = Body(..., embed=True),
               db: Session = Depends(get_minehub_db)) -> dict:
    p = _plan(kind)
    _require(request, p.edit_perm, f"file the {p.label.lower()}")
    first, last = _month_bounds(month)
    if not rows:
        raise HTTPException(400, "Nothing to file.")

    who = _actor(request)
    editable = {c for c, _, _g in p.columns}

    # ── VALIDATE EVERYTHING FIRST ───────────────────────────────────────────
    # A month is one action to the person who pasted it. Half a month stored
    # behind a rejected row is worse than nothing stored, because it looks
    # complete.
    prepared: list[dict] = []
    for i, raw in enumerate(rows, start=1):
        rec: dict[str, Any] = {}
        try:
            d = date.fromisoformat(str(raw.get(p.date_col, "")).strip()[:10])
        except ValueError:
            raise HTTPException(400, f"Row {i}: '{raw.get(p.date_col)}' is not a date.")
        if not (first <= d <= last):
            raise HTTPException(
                400, f"Row {i}: {d.isoformat()} is not in {month}. "
                     "A sheet for the wrong month is a mistake, not something "
                     "to be accommodated.")
        rec[p.date_col] = d
        for col, heading in p.extra_key:
            v = raw.get(col)
            if v is None or str(v).strip() == "":
                raise HTTPException(400, f"Row {i}: {heading} is needed to name the row.")
            rec[col] = int(v) if col.endswith("_id") else str(v).strip()
        # ── ABSENT IS NOT BLANK ─────────────────────────────────────────
        # A column the caller did not mention is left as it is stored. A
        # column sent as "" is cleared. The two are different intentions and
        # the first version of this conflated them: a row posted with two
        # figures wiped the other eleven, so pasting one corrected column into
        # a filled month erased the rest of that day. The test caught it on
        # 2 November -- suk_mg_qty 154.04 vanished to nothing.
        for col in editable:
            if col not in raw:
                continue
            v = raw.get(col)
            if v is None or str(v).strip() == "":
                rec[col] = None
                continue
            if col in p.text_columns:
                rec[col] = str(v).strip()[:200]
                continue
            try:
                num = float(str(v).replace(",", "").strip())
            except ValueError:
                raise HTTPException(
                    400, f"Row {i}: '{v}' is not a number for {col}. "
                         "A unit typed into a figure is how the old MySQL "
                         "column came to hold '292 cum'.")
            if num < 0:
                raise HTTPException(400, f"Row {i}: {col} cannot be negative.")
            rec[col] = num
        prepared.append(rec)

    # ── ONE TRANSACTION ─────────────────────────────────────────────────────
    key = p.key_columns
    saved = changed_fields = 0
    for rec in prepared:
        where = " AND ".join(f"{k} = :{k}" for k in key)
        was = db.execute(text(
            f"SELECT {', '.join(sorted(editable))}, revision "
            f"FROM minehub.{p.table} WHERE {where}"),
            {k: rec[k] for k in key}).mappings().first()

        # Only the columns this row carries. Anything absent keeps whatever
        # is stored, on insert as well as on update.
        sent = [c for c in sorted(editable) if c in rec]

        # A NEW EXCAVATION ROW TAKES ITS DESCRIPTION FROM THE MASTER.
        # face_desc is no longer typed, but the column is NOT NULL-able by
        # habit and every historic row carries one -- a new row with it empty
        # would read as a gap rather than as a row whose name lives in
        # mine_face. Written once, at insert, from the face the row is for.
        if p.table == "excavation_plan" and was is None:
            nm = db.execute(text(
                "SELECT name FROM minehub.mine_face WHERE face_no = :f"),
                {"f": rec["loc_id"]}).scalar()
            if nm is None:
                raise HTTPException(
                    400, f"Row {rec[p.date_col]}: face {rec['loc_id']} is not "
                         "on the list. Add it on the Faces screen first — a "
                         "plan filed against a face nobody has named is how "
                         "the old free-text column collected 109 spellings.")
            rec["face_desc"] = nm
            sent = sent + ["face_desc"]

        cols = key + sent
        db.execute(text(f"""
            INSERT INTO minehub.{p.table}
                   ({', '.join(cols)}, entry_id, entry_date,
                    updated_by, updated_at, revision)
            VALUES ({', '.join(':' + c for c in cols)}, :who, now(),
                    :who, now(), 1)
            ON CONFLICT ({', '.join(key)}) DO UPDATE SET
                   {', '.join(f'{c} = EXCLUDED.{c}' for c in sent) or 'updated_by = EXCLUDED.updated_by'},
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now(),
                   revision   = minehub.{p.table}.revision + 1
        """), {**rec, "who": who})

        # One history row per field that actually moved. A re-paste that
        # changes nothing records nothing; updated_at already carries the fact
        # that somebody pressed the button.
        rev = (int(was["revision"]) + 1) if was else 1
        for col in sent:
            before = None if was is None else was[col]
            after = rec[col]
            b = None if before is None else (
                str(before) if col in p.text_columns else f"{float(before):g}")
            a = None if after is None else (
                str(after) if col in p.text_columns else f"{float(after):g}")
            if b == a:
                continue
            db.execute(text("""
                INSERT INTO minehub.plan_entry_hist
                       (plan_kind, plan_date, action, field,
                        old_value, new_value, revision, entry_id)
                VALUES (:kind, :d, :act, :f, :old, :new, :rev, :who)
            """), {"kind": p.kind.upper() if p.kind != "cobp" else "COBP",
                   "d": rec[p.date_col],
                   "act": "ADDED" if was is None else "CHANGED",
                   "f": col, "old": b, "new": a, "rev": rev, "who": who})
            changed_fields += 1
        saved += 1

    db.commit()
    return {"kind": p.kind, "month": month, "saved": saved,
            "fields_changed": changed_fields, "filed_by": who}


@router.delete("/{kind}", summary="Remove one filed day")
def delete_day(kind: str, request: Request,
               on_date: date = Query(..., description="The day to remove"),
               db: Session = Depends(get_minehub_db)) -> dict:
    p = _plan(kind)
    _require(request, p.edit_perm, f"file the {p.label.lower()}")
    # Deleting is its own permission. Correcting a figure and erasing the day
    # are different intentions, and only one of them can be undone by typing
    # the number again.
    _require(request, DELETE, "remove a filed day")

    who = _actor(request)
    gone = db.execute(text(
        f"DELETE FROM minehub.{p.table} WHERE {p.date_col} = :d "
        f"RETURNING {', '.join(p.key_columns)}, revision"),
        {"d": on_date}).mappings().all()
    for g in gone:
        db.execute(text("""
            INSERT INTO minehub.plan_entry_hist
                   (plan_kind, plan_date, action, field,
                    old_value, new_value, revision, entry_id)
            VALUES (:kind, :d, 'REMOVED', 'row', 'filed', NULL, :rev, :who)
        """), {"kind": p.kind.upper() if p.kind != "cobp" else "COBP",
               "d": on_date, "rev": int(g["revision"]) + 1, "who": who})
    db.commit()
    return {"kind": p.kind, "date": on_date.isoformat(),
            "removed": len(gone), "removed_by": who}


@router.get("/{kind}/history", summary="What changed, and who changed it")
def history(kind: str, request: Request,
            month: str = Query(..., description="YYYY-MM"),
            db: Session = Depends(get_minehub_db)) -> dict:
    p = _plan(kind)
    _require(request, VIEW, f"read the {p.label.lower()}")
    first, last = _month_bounds(month)
    rows = db.execute(text("""
        SELECT plan_date, action, field, old_value, new_value,
               revision, entry_id, entry_date
          FROM minehub.plan_entry_hist
         WHERE plan_kind = :kind AND plan_date BETWEEN :f AND :t
         ORDER BY entry_date DESC, id DESC
         LIMIT 500
    """), {"kind": p.kind.upper() if p.kind != "cobp" else "COBP",
           "f": first, "t": last}).mappings().all()
    return {"kind": p.kind, "month": month, "count": len(rows),
            "entries": [dict(r) for r in rows]}


# ── THE FACES ───────────────────────────────────────────────────────────────
# A list somebody maintains, so the excavation plan can offer a dropdown
# instead of a number and a free-text box. See migration 130 for why it did
# not exist: loc_id pointed at a master that had never held a row, and
# seventeen faces had collected a hundred and nine spellings between them.
#
# It sits on this router rather than its own because it is read by the plan
# screen on every load, and a second router would be a second permission rule
# saying the same thing.

FACE_KINDS = ("ORE", "OB", "ORE_OB", "DUMP", "OTHER")


@router.get("/faces/list", summary="The mining faces")
def list_faces(request: Request,
               include_inactive: bool = Query(True),
               db: Session = Depends(get_minehub_db)) -> dict:
    _require(request, VIEW, "read the faces")
    rows = db.execute(text(f"""
        SELECT f.face_no, f.name, f.face_kind, f.bench_rl, f.status, f.note,
               f.entry_id, f.updated_by, f.updated_at, f.revision,
               (SELECT max(prod_date) FROM minehub.excavation_plan e
                 WHERE e.loc_id = f.face_no) AS last_planned,
               (SELECT count(*) FROM minehub.excavation_plan e
                 WHERE e.loc_id = f.face_no) AS rows_planned
          FROM minehub.mine_face f
         {"" if include_inactive else "WHERE f.status = 'ACTIVE'"}
         ORDER BY f.status, f.name
    """)).mappings().all()
    perms = getattr(request.state, "permissions", None) or set()
    return {"count": len(rows), "faces": [dict(r) for r in rows],
            "kinds": list(FACE_KINDS),
            "may_edit": "plan.excavation.edit" in perms}


@router.put("/faces/save", summary="Add or correct a face")
def save_face(request: Request, body: dict = Body(...),
              db: Session = Depends(get_minehub_db)) -> dict:
    # The excavation plan's own permission: the person who files the plan is
    # the person who knows what the faces are called.
    _require(request, "plan.excavation.edit", "maintain the faces")
    who = _actor(request)

    try:
        face_no = int(body.get("face_no"))
    except (TypeError, ValueError):
        raise HTTPException(400, "A face needs its number.")
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "A face needs a name.")
    kind = str(body.get("face_kind", "ORE_OB")).strip().upper()
    if kind not in FACE_KINDS:
        raise HTTPException(400, f"'{kind}' is not one of {', '.join(FACE_KINDS)}.")
    status = str(body.get("status", "ACTIVE")).strip().upper()
    if status not in ("ACTIVE", "INACTIVE"):
        raise HTTPException(400, "A face is ACTIVE or INACTIVE.")
    bench = (str(body.get("bench_rl", "")).strip() or None)
    note = (str(body.get("note", "")).strip() or None)

    # The name is unique, and the refusal should say which face holds it
    # rather than showing a constraint violation.
    clash = db.execute(text("""
        SELECT face_no FROM minehub.mine_face
         WHERE lower(name) = lower(:n) AND face_no <> :f
    """), {"n": name, "f": face_no}).scalar()
    if clash:
        raise HTTPException(
            409, f"Face {clash} is already called '{name}'. Two faces with "
                 "one name is what this list exists to stop.")

    was = db.execute(text("""
        SELECT name, face_kind, bench_rl, status, note, revision
          FROM minehub.mine_face WHERE face_no = :f
    """), {"f": face_no}).mappings().first()

    db.execute(text("""
        INSERT INTO minehub.mine_face
               (face_no, name, face_kind, bench_rl, status, note,
                entry_id, entry_date, updated_by, updated_at, revision)
        VALUES (:f, :n, :k, :b, :s, :note, :who, now(), :who, now(), 1)
        ON CONFLICT (face_no) DO UPDATE SET
               name       = EXCLUDED.name,
               face_kind  = EXCLUDED.face_kind,
               bench_rl   = EXCLUDED.bench_rl,
               status     = EXCLUDED.status,
               note       = EXCLUDED.note,
               updated_by = EXCLUDED.updated_by,
               updated_at = now(),
               revision   = minehub.mine_face.revision + 1
    """), {"f": face_no, "n": name, "k": kind, "b": bench, "s": status,
           "note": note, "who": who})

    rev = (int(was["revision"]) + 1) if was else 1
    for field, before, after in (("name", was and was["name"], name),
                                 ("face_kind", was and was["face_kind"], kind),
                                 ("bench_rl", was and was["bench_rl"], bench),
                                 ("status", was and was["status"], status),
                                 ("note", was and was["note"], note)):
        b = None if before in (None, "") else str(before)
        a = None if after in (None, "") else str(after)
        if b == a:
            continue
        db.execute(text("""
            INSERT INTO minehub.mine_face_hist
                   (face_no, action, field, old_value, new_value, revision, entry_id)
            VALUES (:f, :act, :fl, :old, :new, :rev, :who)
        """), {"f": face_no, "act": "ADDED" if was is None else "CHANGED",
               "fl": field, "old": b, "new": a, "rev": rev, "who": who})

    db.commit()
    return {"face_no": face_no, "name": name, "saved_by": who,
            "created": was is None}
