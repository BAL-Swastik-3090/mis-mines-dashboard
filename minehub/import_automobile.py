"""Backfill the fleet from the mine's own spreadsheets, as drafts.

WHAT THIS IS FOR. The register is empty and somebody has to type ninety
machines into it. Three spreadsheets already hold most of what those rows need,
maintained by the people who look after the machines. Typing them again by hand
would take a week and introduce a week's worth of typos.

SO EVERY MACHINE LANDS AS A DRAFT. Nothing is approved and nothing pretends to
be checked. A draft is a starting point for the person doing the entry: they
open it, see what came across, fix what is wrong and fill what is blank, and
then submit it. That is the difference between helping the operator and
deciding on their behalf — the spreadsheets disagree with each other in places,
and only somebody who knows the machines can settle it.

WHERE THE DATA COMES FROM

    Equipment & Statutory Report Details.xlsx
        Tipper / Tippers    the tipper fleet, twice, at different dates
        Machine / Equipment excavators, dozers, loaders, the rest
        Hiring              contractor machines, by vendor
    Machine Document Details_RTO Status.xlsx
        SUMMARY SHEET       registration, status of each tipper, RTO position
    Asset No & Code.xlsx
        ASSET CODE          the SAP equipment number for 48 machines

The same machine appears in several of them. They are merged on the
identification number, and where two sheets disagree about a date the later
one wins — the sheets are dated and the newer file is the one being maintained.

WHAT IT REFUSES TO GUESS. A blank stays blank. An unparseable date is skipped
and counted, not coerced. A machine with no identification number is skipped
entirely, because a fleet code invented here is a fleet code nobody recognises.
"NA" in a registration column means the machine has no registration, which is
true of every excavator, and is stored as nothing rather than as the word.

RUNNING IT

    python minehub/import_automobile.py            # what it would do
    python minehub/import_automobile.py --apply    # do it

Safe to run twice: a machine already on the register is matched by fleet code
and left alone, and the report says how many were skipped for that reason.
"""
from __future__ import annotations

import re
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text                                    # noqa: E402

from app.minehub_db import SessionLocal                        # noqa: E402

SOURCE = Path(r"D:\Projects\Mines\files\automobile")

# The mine's own words for where a machine is in its life, as they appear in
# the status columns, mapped to the stages the register now holds. Anything
# unrecognised is left for a person rather than forced into the nearest box.
LIFECYCLE = [
    # Read in order, and the first two exist to catch what the later rules
    # would otherwise misread.
    #
    # "To be done Off Road" is a plan. The machine is still working until
    # somebody takes it off, and filing it as OFF_ROAD hid two tippers from
    # the register's default view — where nobody could find them to correct.
    #
    # Narrow to off road on purpose. "Scrap to be done" is a decision already
    # taken with the scrapping pending, and suppressing that would lose a
    # write-off.
    (r"to be (done|made)\s*/?\s*off\s*road", None),
    # "Off Road/ Running B/D" says running with a breakdown, which is the
    # workshop rather than the end of the road.
    (r"running\s*b/?d", "MAINTENANCE"),
    (r"cannibali", "CANNIBALISED"),
    (r"scrap", "SCRAPPED"),
    (r"off\s*road", "OFF_ROAD"),
    (r"major\s*b/?d|breakdown", "MAINTENANCE"),
    (r"working|running|in mine|at mine", "ACTIVE"),
]

# What a machine is, read from how the mine names it. The identification number
# carries the class more reliably than the model does — "EX-1 (EXCAVATOR)" and
# "MAN-11" both say what they are.
TYPE_HINTS = [
    # Drill first, and no loose "d followed by digits" rule. That rule read the
    # 260 in "ATLAS COPCO DRILL ICM 260" as a dozer model number, and a drill
    # confidently filed as a dozer is worse than one with no type at all —
    # nobody goes back to check a field that looks answered.
    (r"drill", "Drill"),
    (r"\bex[-\s]?\d|excavat|zaxis|poclain", "Excavator"),
    (r"\bman[-\s]?\d|tipper|tata\s*signa|cla\s*25", "Man (Tipper)"),
    (r"dozer|\bbd[-\s]?\d{2}\b", "Dozer"),
    (r"backhoe|back hoe|\bbhl\b|\bjcb|424b", "JCB"),
    (r"loader|\bwl\b|\bld[-\s]?\d", "Loader"),
    (r"grader", "Grader"),
    (r"hydra|crane", "Hydra"),
    (r"tanker|bowser", "Tanker"),
    (r"sprinkl|water", "Water Sprinkler"),
    (r"compact|roller|vibro", "Soil Compactor (Roller)"),
    (r"mist\s*cannon", "Mist Cannon (Sprinkler)"),
]

# Statutory columns, as each sheet spells them, mapped to document types.
DOC_COLUMNS = {
    "insurance valid up to": "INSURANCE",
    "insurance valid up": "INSURANCE",
    "insurance": "INSURANCE",
    "fitness valid up to": "FITNESS",
    "fitness": "FITNESS",
    "tax valid up to": "ROAD_TAX",
    "tax valid up": "ROAD_TAX",
    "r. tax": "ROAD_TAX",
    "pucc valid up to": "PUC",
    "pucc": "PUC",
}


def clean(value) -> str:
    """A cell as a person would read it, or empty."""
    if value is None:
        return ""
    s = str(value).replace("\n", " ").strip()
    s = re.sub(r"\s+", " ", s)
    # "NA" against a registration means the machine has none — an excavator
    # never had one. Storing the word would make it look like a number.
    return "" if s.lower() in ("na", "n/a", "-", "nil", "none", "") else s


def as_date(value):
    """A date, or None. Never a guess."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = clean(value)
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def as_number(value):
    """A number, or None. Text like '2.5CUM' gives up its figure."""
    s = clean(value)
    if not s:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", s.replace(",", ""))
    return float(m.group()) if m else None


SPELLED_OUT = {
    "excavator": "Excavator", "tipper": "Man (Tipper)", "dozer": "Dozer",
    "back hoe loader": "JCB", "backhoe loader": "JCB", "loader": "Loader",
    "grader": "Grader", "hydra": "Hydra", "drill": "Drill",
    "tanker": "Tanker", "compactor": "Soil Compactor (Roller)",
}


def guess_type(*hints: str) -> str | None:
    """What a machine is, preferring what the mine actually wrote.

    The code sheet spells the class out in brackets — "MAN-11 (TIPPER)",
    "BHL-2 (BACK HOE LOADER)". That is not a guess and is read first. Only when
    nothing says so outright does this fall back to matching the name, and when
    that fails too it returns nothing: the draft arrives without a type and the
    person doing the entry picks one.
    """
    blob = " ".join(h.lower() for h in hints if h)
    for spelled in re.findall(r"\(([^)]*)\)", blob):
        for word, name in SPELLED_OUT.items():
            if word in spelled:
                return name
    for pattern, name in TYPE_HINTS:
        if re.search(pattern, blob):
            return name
    return None


def electric(m: dict) -> str:
    """EV or not, read from the name the fleet already uses.

    The mine prefixes its battery machines — "EV LIUGONG 838TE" — which is the
    fleet saying which side of the electric split it is on. Importing the name
    and dropping the fact would mean somebody re-entering it by hand.
    """
    blob = " ".join(str(m.get(k) or "") for k in
                    ("fleet_code", "nickname", "make_model", "make", "model")).upper()
    return "EV" if re.search(r"EV|EV[\s-]|ELECTRIC|BEV", blob) else "NON_EV"


def guess_stage(*hints: str) -> str | None:
    blob = " ".join(h.lower() for h in hints if h)
    if not blob.strip():
        return None
    for pattern, stage in LIFECYCLE:
        if re.search(pattern, blob):
            return stage
    return None


def fleet_code(raw: str) -> str:
    """MAN 11, MAN-11 and 'MAN-13 (21)' are all the same machine to a person."""
    s = clean(raw).upper()
    s = re.sub(r"\(.*?\)", " ", s)          # drop the parenthetical note
    s = re.sub(r"[^A-Z0-9]+", "-", s).strip("-")
    return s


def header_row(rows: list[tuple]) -> int:
    best, at = 0, 0
    for i, row in enumerate(rows[:10]):
        n = sum(1 for c in row if isinstance(c, str) and 1 < len(c.strip()) < 45)
        if n > best:
            best, at = n, i
    return at


def read_sheet(path: Path, sheet: str) -> list[dict]:
    """A sheet as a list of dicts keyed by its own lower-cased headers."""
    from openpyxl import load_workbook
    wb = load_workbook(path, data_only=True, read_only=True)
    if sheet not in wb.sheetnames:
        wb.close()
        return []
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not rows:
        return []

    at = header_row(rows)
    headers = [re.sub(r"\s+", " ", str(c or "").strip().lower().replace("\n", " "))
               for c in rows[at]]
    out = []
    for row in rows[at + 1:]:
        if not any(c is not None and str(c).strip() for c in row):
            continue
        out.append({h: v for h, v in zip(headers, row) if h})
    return out


def pick(row: dict, *names: str):
    """The first column whose header contains any of these words."""
    for name in names:
        for key, value in row.items():
            if name in key:
                return value
    return None


def gather() -> tuple[dict, dict]:
    """Everything the spreadsheets know, merged per machine."""
    equip = SOURCE / "Equipment & Statutory Report Details.xlsx"
    rto = SOURCE / "Machine Document Details_RTO Status.xlsx"
    codes = SOURCE / "Asset No & Code.xlsx"

    machines: dict[str, dict] = {}
    unparsed_dates = 0

    def absorb(rows: list[dict], source: str, hired: bool = False):
        nonlocal unparsed_dates
        for row in rows:
            ident = clean(pick(row, "identification", "tippers code", "regd no",
                               "registration no"))
            if not ident:
                continue
            code = fleet_code(ident)
            if not code or code.isdigit():
                continue

            m = machines.setdefault(code, {"fleet_code": code, "sources": [],
                                           "documents": {}, "nickname": ident})
            m["sources"].append(source)

            def take(field, value):
                if value not in (None, "") and not m.get(field):
                    m[field] = value

            take("make_model", clean(pick(row, "make & model", "make and model")))
            take("registration_no", clean(pick(row, "registration n", "regd no")))
            take("chassis_no", clean(pick(row, "chassis")))
            take("engine_no", clean(pick(row, "engine no")))
            take("engine_make", clean(pick(row, "engine make")))
            take("rated_output_per_hr", as_number(pick(row, "engine power")))
            take("capacity", as_number(pick(row, "bucket capacity")))
            take("capacity_uom", "CUM" if clean(pick(row, "bucket capacity")) else None)
            take("tank_capacity_l", as_number(pick(row, "fuel tank")))
            take("rated_fuel_lph", as_number(pick(row, "standard fuel")))
            take("commissioned_on", as_date(pick(row, "commissioning")))
            take("vendor", clean(pick(row, "vendor name")))
            take("remarks", clean(pick(row, "remark")))
            if hired:
                m["hired"] = True

            stage = guess_stage(clean(pick(row, "status of tippers")),
                                clean(pick(row, "present status")),
                                clean(pick(row, "off road")))
            if stage and not m.get("stage"):
                m["stage"] = stage
                m["stage_said"] = clean(pick(row, "status of tippers")) \
                    or clean(pick(row, "present status")) \
                    or clean(pick(row, "off road"))

            # The statutory dates. The latest date across sheets wins: the
            # files are snapshots taken at different times and the newer one is
            # the one still being maintained.
            for header, kind in DOC_COLUMNS.items():
                for key, value in row.items():
                    if not key.startswith(header):
                        continue
                    when = as_date(value)
                    if when is None:
                        if clean(value):
                            unparsed_dates += 1
                        continue
                    if kind not in m["documents"] or when > m["documents"][kind]:
                        m["documents"][kind] = when

    absorb(read_sheet(equip, "Tipper"), "Tipper")
    absorb(read_sheet(equip, "Tippers"), "Tippers")
    absorb(read_sheet(equip, "Machine"), "Machine")
    absorb(read_sheet(equip, "Equipment"), "Equipment")
    absorb(read_sheet(equip, "Hiring"), "Hiring", hired=True)
    absorb(read_sheet(rto, "SUMMARY SHEET"), "RTO summary")

    # SAP equipment numbers, matched on the name the code sheet uses.
    for row in read_sheet(codes, "ASSET CODE"):
        name = clean(pick(row, "equpment name", "equipment name"))
        sap = clean(pick(row, "asset code"))
        if not name or not sap:
            continue
        code = fleet_code(name)
        if code in machines:
            machines[code]["sap_equipment_no"] = sap
        else:
            # The code sheet names machines the statutory sheets do not list.
            # Keeping them means the register starts with the SAP link already
            # made, which is the join everything else depends on.
            machines[code] = {"fleet_code": code, "nickname": name,
                              "sap_equipment_no": sap, "sources": ["ASSET CODE"],
                              "documents": {}}

    # One machine, one row. "AL-1" and "ASHOK LEYLAND AL-1" are the same lorry
    # written two ways in two sheets, and only the registration says so — a
    # number plate belongs to exactly one vehicle. Where two entries share one,
    # they merge, and the shorter code wins because that is what the fleet
    # calls it day to day.
    by_plate: dict[str, str] = {}
    merged = 0
    for code in sorted(machines, key=lambda c: (len(c), c)):
        plate = re.sub(r"[^A-Z0-9]", "", (machines[code].get("registration_no") or "").upper())
        if not plate or len(plate) < 8:
            continue
        if plate in by_plate:
            keep, drop = machines[by_plate[plate]], machines.pop(code)
            for field, value in drop.items():
                if field in ("fleet_code", "sources", "documents"):
                    continue
                if value not in (None, "") and not keep.get(field):
                    keep[field] = value
            keep["sources"].extend(drop.get("sources", []))
            keep.setdefault("also_known_as", []).append(drop["fleet_code"])
            for kind, when in drop.get("documents", {}).items():
                if kind not in keep["documents"] or when > keep["documents"][kind]:
                    keep["documents"][kind] = when
            merged += 1
        else:
            by_plate[plate] = code

    for m in machines.values():
        # The mine already prefixes its battery machines: EV LIUGONG 838TE.
        # That is the fleet saying which side of the electric split it is on,
        # and it would be perverse to import the name and drop the fact.
        blob = f"{m['fleet_code']} {m.get('nickname', '')} {m.get('make_model', '')}".upper()
        if re.search(r"EV[\s-]|ELECTRIC|BEV", blob):
            m["propulsion"] = "EV"

        model = m.get("make_model", "")
        m["asset_type"] = guess_type(m["fleet_code"], m.get("nickname", ""), model)
        if model:
            parts = re.split(r"[\s&]+", model, maxsplit=1)
            m.setdefault("make", parts[0])
            if len(parts) > 1:
                m.setdefault("model", parts[1])

    return machines, {"unparsed_dates": unparsed_dates, "merged": merged}


def main(apply: bool) -> int:
    machines, stats = gather()
    db = SessionLocal()
    try:
        existing = {r[0] for r in db.execute(text(
            "SELECT upper(fleet_code) FROM asset WHERE fleet_code IS NOT NULL"))}
        types = {r[1].lower(): r[0] for r in db.execute(text(
            "SELECT asset_type_id, name FROM asset_type"))}
        plant = db.execute(text(
            "SELECT plant_id FROM plant WHERE is_default LIMIT 1")).scalar() \
            or db.execute(text("SELECT plant_id FROM plant ORDER BY plant_id LIMIT 1")).scalar()
        vendors = {r[1].lower(): r[0] for r in db.execute(text(
            "SELECT party_id, display_name FROM party WHERE party_type = 'ORGANISATION'"))}

        new = [m for m in machines.values() if m["fleet_code"] not in existing]
        skip = len(machines) - len(new)

        print(f"\n{len(machines)} machines found across the sheets")
        print(f"  {len(new)} would be created as drafts")
        print(f"  {skip} already on the register, left alone")
        print(f"  {stats['unparsed_dates']} date cells could not be read and were left blank\n")

        no_type = [m["fleet_code"] for m in new if not m.get("asset_type")]
        if no_type:
            print(f"{len(no_type)} could not be classed from their name — they come in "
                  f"without a type for somebody to set:")
            print("   " + ", ".join(sorted(no_type)[:14])
                  + (" …" if len(no_type) > 14 else "") + "\n")

        by_stage: dict[str, int] = {}
        for m in new:
            by_stage[m.get("stage") or "not said"] = by_stage.get(m.get("stage") or "not said", 0) + 1
        print("Lifecycle stage, as the sheets describe it:")
        for stage, n in sorted(by_stage.items(), key=lambda x: -x[1]):
            print(f"   {stage:<14} {n}")

        evs = [m["fleet_code"] for m in new if electric(m) == "EV"]
        if evs:
            print(f"\n{len(evs)} read as electric from their own names: "
                  + ", ".join(sorted(evs)[:6]) + (" …" if len(evs) > 6 else ""))

        docs = sum(len(m["documents"]) for m in new)
        print(f"\n{docs} statutory dates would come across "
              f"(insurance, fitness, road tax, PUC)\n")

        print("First fifteen, as they would land:")
        for m in sorted(new, key=lambda x: x["fleet_code"])[:15]:
            bits = [m["fleet_code"].ljust(12), (m.get("asset_type") or "no type").ljust(16)]
            bits.append((m.get("registration_no") or "—").ljust(15))
            bits.append(f"{len(m['documents'])} docs")
            if m.get("sap_equipment_no"):
                bits.append(f"SAP {m['sap_equipment_no']}")
            print("   " + " ".join(bits))

        if not apply:
            print("\nNothing was written. Add --apply to create the drafts.")
            return 0

        created = 0
        for m in sorted(new, key=lambda x: x["fleet_code"]):
            type_id = types.get((m.get("asset_type") or "").lower())
            owner = vendors.get((m.get("vendor") or "").lower())
            row = db.execute(text("""
                INSERT INTO asset (fleet_code, nickname, asset_type_id, registration_no,
                                   make, model, chassis_no, engine_no, capacity,
                                   capacity_uom, tank_capacity_l, rated_fuel_lph,
                                   rated_output_per_hr, commissioned_on, plant_id,
                                   ownership, owner_party_id, sap_equipment_no,
                                   status, approval_status, propulsion, remarks,
                                   created_by)
                VALUES (:code, :nick, :type, :reg, :make, :model, :chassis, :engine,
                        :cap, :capu, :tank, :fuel, :power, :comm, :plant,
                        :own, :owner, :sap, :status, 'DRAFT', :prop, :remarks, 'IMPORT')
                RETURNING asset_id
            """), {
                "code": m["fleet_code"], "nick": m.get("nickname"),
                "type": type_id, "reg": m.get("registration_no") or None,
                "make": m.get("make"), "model": m.get("model"),
                "chassis": m.get("chassis_no"), "engine": m.get("engine_no"),
                "cap": m.get("capacity"), "capu": m.get("capacity_uom"),
                "tank": m.get("tank_capacity_l"), "fuel": m.get("rated_fuel_lph"),
                "power": m.get("rated_output_per_hr"),
                "comm": m.get("commissioned_on"), "plant": plant,
                "own": "HIRED" if m.get("hired") else "OWN",
                "owner": owner, "sap": m.get("sap_equipment_no"),
                "status": m.get("stage") or "ACTIVE",
                "prop": electric(m),
                "remarks": ("Imported from the automobile spreadsheets. "
                            + (m.get("remarks") or "")).strip(),
            }).mappings().first()
            asset_id = row["asset_id"]
            created += 1

            for kind, when in m["documents"].items():
                db.execute(text("""
                    INSERT INTO asset_compliance (asset_id, document_type, valid_upto,
                                                  created_by)
                    VALUES (:a, :t, :d, 'IMPORT')
                """), {"a": asset_id, "t": kind, "d": when})

            if m.get("stage"):
                db.execute(text("""
                    INSERT INTO asset_lifecycle (asset_id, stage, started_on, reason,
                                                 recorded_by)
                    VALUES (:a, :s, COALESCE(:on, CURRENT_DATE), :why, 'IMPORT')
                """), {"a": asset_id, "s": m["stage"],
                       "on": m.get("commissioned_on"),
                       "why": f"From the mine's register: “{m.get('stage_said', '')}”"})

        db.commit()
        print(f"\n{created} drafts created. None approved — each one is waiting for "
              f"somebody to check it and submit it.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
