"""CLL's 211 workmen into the register, as drafts.

WHERE THE DATA COMES FROM, AND WHY NOT THE SPREADSHEET.

The roll arrived as an Excel file with code, name and designation. That file
turned out to be a dump of BAL's own contractor workman master,
hr_med_contractor_master, which holds the same 209 people and also their date
of birth, date of joining, department and current status. Names agree 209 out
of 209 once case is ignored; designations agree 207 out of 209.

So the master is read as the source and the spreadsheet as the roll: the
spreadsheet decides WHO is on strength today, the master supplies what is
KNOWN about them. Two people are on the spreadsheet and not in the master, and
they are registered from the spreadsheet with a note saying so.

(The first place I looked, sap_employee_details, was the wrong table: it holds
shortened payroll names and puts the contractor's name in the designation
column. It disagreed with the spreadsheet on 129 of 198 names. None of those
were real disagreements.)

NOTHING HERE IS APPROVED. Every row lands as a draft, as the automobile
backfill did, because a spreadsheet is not a decision. Everything the two
sources disagree about is written into the remarks rather than resolved
quietly, so the person reviewing the draft sees the disagreement and not a
confident answer somebody made up.

Usage:
    python minehub/import_cll_manpower.py --dry-run
    python minehub/import_cll_manpower.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import openpyxl                                          # noqa: E402
from sqlalchemy import bindparam, text                   # noqa: E402

import app.minehub_db as mh                              # noqa: E402
from app.database import SessionLocal as CorpSession     # noqa: E402

ROLL = Path(r"D:\Projects\Mines\files\FRS Attendance\CLL Manpower Details. (1).xlsx")

# CLL as BAL already knows it. Both codes are recorded against the party so the
# register can be reconciled against the contractor master and against the
# ledger without anybody matching on a name.
CLL_CONTRACTOR_CODE = "1100223"          # hr_med_contractor_master.cont_code
CLL_VENDOR_CODE = "0001105437"           # scm_vendor_master.Vendor
CLL_LEGAL_NAME = "BISWAJIT MAHANTA (CLL)"
CLL_DISPLAY = "CLL"

ACTOR = "IMPORT"

# Every spelling on the roll, against the trade it means. Written out rather
# than matched cleverly: a fuzzy match that puts a welder in with a welder's
# helper is worse than a list somebody has to extend, and this list is the one
# place the mapping can be reviewed.
TRADE_OF = {
    "DRIVER-TIPPER": "TIPPER_DRIVER",
    "EXCAVATOR OPERATOR": "EXCAVATOR_OP",
    "DOZER OPERATOR": "DOZER_OP",
    "DRIVER-WATER TANKER": "WATER_TANKER_DRV",
    "JCB OPERATOR": "BACKHOE_OP",
    "DRILL OPERATOR": "DRILL_OP",
    "GRADER OPERATOR": "GRADER_OP",
    "HYDRA OPERATOR": "HYDRA_OP",

    "HELPER MINES": "MINES_HELPER",
    "SPOTTER": "SPOTTER",
    "HELPER-DRILL OPERATION": "DRILL_HELPER",
    "MINING MATE": "MINING_MATE",

    # "MAN" is the truck marque, not an abbreviation of manual: CLL keeps the
    # MAN tipper fleet and the heavy earth-moving plant on separate postings.
    "MECH. HELPER MAN": "MECH_HELPER_MAN",
    "SR.MECH. MAN": "MECHANIC_MAN",
    "MECH. HELPER HEMM": "MECH_HELPER_HEMM",
    "MECH. FITTER HEMM": "MECH_FITTER_HEMM",
    "MECH. HEMM": "MECHANIC_HEMM",
    "TYRE FITTER": "TYRE_FITTER",
    "TYRE HELPER": "TYRE_HELPER",
    "WELDER": "WELDER",
    "WELDER (COBP)": "WELDER",
    "WELDER/DENTER": "WELDER_DENTER",
    "WELDER HELPER": "WELDER_HELPER",
    "A/ C MECHANIC": "AC_MECHANIC",

    "AUTO ELECTRICIAN": "AUTO_ELECTRICIAN",
    "ASST. AUTO ELE.": "ASST_AUTO_ELEC",
    "ELECTRICIAN": "ELECTRICIAN",

    "SUPERVISOR": "SUPERVISOR",
    "AUTOMOBILE-CORDINATOR": "AUTO_COORDINATOR",
    "TIME KEEPER": "TIME_KEEPER",

    "EXECUTIVE (HR/IR)": "HR_EXECUTIVE",
    "ASST- EXECUTIVE (HR).": "HR_ASST_EXEC",
    "MIS (AUTOMOBILE)": "MIS_ASSISTANT",
    "IT HELPER": "IT_HELPER",

    "WATCHMEN": "SECURITY_GUARD",
    "HOUSE KEEP": "HOUSEKEEPING",
    "SWEEPER": "SWEEPER",
    "GRARDENER": "GARDENER",           # as spelled on the roll
}

# The contractor master's department against the platform's org unit. Migration
# 041 added the five that were missing; HR/IR maps to HR, because industrial
# relations is part of HR on this site and one person's designation is not a
# department of its own.
ORG_OF = {
    "MINING": "MINING_OPERATION", "AUTOMOBILE": "AUTOMOBILE",
    "HR": "HR", "HR/IR": "HR", "ELECTRICAL": "ELECTRICAL",
    "IT": "IT", "COBP": "COBP", "ETP": "ETP",
}


def tidy(s) -> str:
    """One space between words, nothing at the ends. The roll has 'MECH.
    HELPER  MAN' with two spaces, which is a different string and the same
    job."""
    return re.sub(r"\s+", " ", str(s or "")).strip()


def title(name: str) -> str:
    """The roll shouts; the contractor master does not. Stored the way the
    master writes it, because that is how it reads on a gate pass."""
    return " ".join(w.capitalize() if w.isalpha() else w for w in tidy(name).split())


def read_roll() -> dict[str, tuple[str, str]]:
    wb = openpyxl.load_workbook(ROLL, data_only=True)
    out: dict[str, tuple[str, str]] = {}
    for row in wb["Sheet1"].iter_rows(min_row=2, values_only=True):
        if not row or not row[1]:
            continue
        out[tidy(row[1])] = (tidy(row[2]), tidy(row[3]))
    return out


def read_master(codes: list[str]) -> dict[str, dict]:
    db = CorpSession()
    stmt = text("SELECT * FROM hr_med_contractor_master WHERE workman_code IN :ids "
                "AND cont_code = :cont").bindparams(bindparam("ids", expanding=True))
    return {r["workman_code"]: dict(r)
            for r in db.execute(stmt, {"ids": codes,
                                       "cont": CLL_CONTRACTOR_CODE}).mappings()}


def main(dry_run: bool) -> None:
    roll = read_roll()
    master = read_master(list(roll))
    print(f"roll {len(roll)} · contractor master {len(master)}")

    pg = mh.SessionLocal()

    plant_id = pg.execute(text("SELECT plant_id FROM plant WHERE is_default")).scalar()
    trades = {r[0]: r[1] for r in pg.execute(text("SELECT code, trade_id FROM trade"))}
    orgs = {r[0]: r[1] for r in pg.execute(text("SELECT code, org_unit_id FROM org_unit"))}

    unmapped = {d for _, d in roll.values() if tidy(d).upper() not in TRADE_OF}
    if unmapped:
        # Better to stop than to register a hundred people against no trade and
        # discover it when somebody asks for a headcount by trade.
        print("STOPPING. No trade is mapped for:")
        for d in sorted(unmapped):
            print(f"   {d!r}")
        return

    # ── CLL itself ──────────────────────────────────────────────────────────
    cll = pg.execute(text(
        "SELECT party_id FROM party WHERE party_type='ORGANISATION' "
        "AND display_name = :n"), {"n": CLL_DISPLAY}).scalar()
    if cll:
        print(f"CLL is already on file as party {cll}")
    elif dry_run:
        print(f"would register CLL as a contractor "
              f"({CLL_LEGAL_NAME}, contractor {CLL_CONTRACTOR_CODE}, "
              f"vendor {CLL_VENDOR_CODE})")
        cll = -1
    else:
        cll = pg.execute(text(
            "INSERT INTO party (party_type, legal_name, display_name, org_category, "
            "                   status, created_by, remarks) "
            "VALUES ('ORGANISATION', :legal, :disp, 'CONTRACTOR', 'ACTIVE', :by, :rem) "
            "RETURNING party_id"),
            {"legal": CLL_LEGAL_NAME, "disp": CLL_DISPLAY, "by": ACTOR,
             "rem": "Mining and automobile manpower contractor at Kaliapani."}).scalar()
        for system, code in (("CONTRACTOR", CLL_CONTRACTOR_CODE),
                             ("SAP", CLL_VENDOR_CODE)):
            pg.execute(text(
                "INSERT INTO party_identity (party_id, system, external_code, created_by) "
                "VALUES (:p, :s, :c, :by) ON CONFLICT DO NOTHING"),
                {"p": cll, "s": system, "c": code, "by": ACTOR})
        print(f"registered CLL as party {cll}")

    # ── the people ──────────────────────────────────────────────────────────
    made = skipped = 0
    flagged: list[str] = []

    for code in sorted(roll):
        roll_name, roll_desig = roll[code]
        m = master.get(code)

        notes: list[str] = []
        if not m:
            notes.append("Not in BAL's contractor workman master — registered "
                         "from CLL's roll alone; the code is unverified.")
        elif str(m.get("status") or "").upper() != "A":
            notes.append("BAL's contractor master marks this person inactive, "
                         "but CLL's roll still carries them. Needs checking.")

        name = title(m["workman_name"]) if m else title(roll_name)
        desig = roll_desig
        if m and m.get("designation") and \
                tidy(m["designation"]).upper() != tidy(roll_desig).upper():
            notes.append(f"CLL's roll says \u201c{roll_desig}\u201d; BAL's contractor "
                         f"master says \u201c{m['designation']}\u201d. Roll used.")

        trade_id = trades[TRADE_OF[tidy(roll_desig).upper()]]
        dept = tidy(m.get("department")).upper() if m else ""
        org_unit_id = orgs.get(ORG_OF.get(dept, ""))
        if m and dept and not org_unit_id:
            notes.append(f"Department \u201c{m['department']}\u201d has no matching "
                         "unit on the platform.")

        already = pg.execute(text(
            "SELECT p.party_id FROM party_identity i JOIN party p ON p.party_id=i.party_id "
            "WHERE i.system='CONTRACTOR' AND i.external_code = :c"), {"c": code}).scalar()
        if already:
            skipped += 1
            continue

        if notes:
            flagged.append(f"  {code}  {name:30} {notes[0][:66]}")

        if dry_run:
            made += 1
            continue

        party_id = pg.execute(text(
            "INSERT INTO party (party_type, legal_name, display_name, date_of_birth, "
            "                   status, created_by) "
            "VALUES ('PERSON', :n, :n, :dob, 'ACTIVE', :by) RETURNING party_id"),
            {"n": name, "dob": m["date_of_birth"] if m else None, "by": ACTOR}).scalar()

        pg.execute(text(
            "INSERT INTO party_identity (party_id, system, external_code, created_by) "
            "VALUES (:p, 'CONTRACTOR', :c, :by)"),
            {"p": party_id, "c": code, "by": ACTOR})

        joined = m["date_of_joining"] if m else None
        pg.execute(text(
            "INSERT INTO party_employment (party_id, employer_party_id, org_unit_id, "
            "   designation, employment_type, valid_from, created_by) "
            "VALUES (:p, :e, :ou, :d, 'CONTRACT', COALESCE(:from, CURRENT_DATE), :by)"),
            {"p": party_id, "e": cll, "ou": org_unit_id, "d": desig,
             "from": joined, "by": ACTOR})

        pg.execute(text(
            "INSERT INTO operator (party_id, operator_ref, employment_type, "
            "   employer_party_id, org_unit_id, plant_id, designation, trade_id, "
            "   joined_on, profile_status, approval_status, remarks, created_at, "
            "   updated_at) "
            "VALUES (:p, next_operator_ref(), 'CONTRACT', :e, :ou, :plant, :d, :t, "
            "        :joined, 'ACTIVE', 'DRAFT', :rem, now(), now())"),
            {"p": party_id, "e": cll, "ou": org_unit_id, "plant": plant_id,
             "d": desig, "t": trade_id, "joined": joined,
             "rem": " ".join(notes) or None})
        made += 1

    if flagged:
        print(f"\n{len(flagged)} need a second look:")
        for line in flagged:
            print(line)

    print(f"\n{'would register' if dry_run else 'registered'} {made}"
          f"{f', skipped {skipped} already present' if skipped else ''}")

    if dry_run:
        pg.rollback()
        print("dry run — nothing written")
    else:
        pg.commit()
        print("committed, all as drafts")


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
