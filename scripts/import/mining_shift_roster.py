"""Put the mine's own staff on the roster, and load October's shifts.

WHAT THIS IS FOR
The October shift sheet lists 32 BAL employees -- Asst Managers, Mine Foremen,
Mining Mates, DETs, GETs -- who run the mine's three rotating crews plus a
general-shift group. They are company staff, not contract labour.

WHY THEY COULD NOT BE ROSTERED
Workforce Planning hangs every roster row off `operator`: roster_day,
roster_assignment and comp-off all join it. `operator` had 243 CONTRACT rows and
one OWN, and not one of the 199 permanent or trainee staff had a row at all. So
the roster screen physically could not see the people this sheet is about.

Rather than widen four tables to accept a party_id, each staff member gets an
`operator` row of their own with employment_type = 'OWN'. `operator` is not
"someone who drives a machine" -- it carries designation, supervisor, shift
pattern and plant -- it is the mine's register of people who can be deployed,
and a Mine Foreman belongs in it as much as a tipper driver. Everything already
built then works for them unchanged.

A NAME IS NOT AN IDENTITY
Where somebody is already in the registry, their existing party is reused. But a
name match is only accepted when the ROLE agrees. Three of the sheet's names
collide with contract workers -- 'Kirtan Mohanta' the Mine Foreman against a
CONTRACT DRIVER-TIPPER at CLL, and two more like it -- and binding the foreman
to the driver's record would quietly follow him through every shift, holiday and
comp-off from then on. Those get a fresh staff record built from SAP, and the
collision is reported rather than resolved by guessing.

SAFE TO RUN TWICE
Every write is keyed on something stable -- the SAP employee number for a
person, (operator, date) for a roster day -- so a second run changes nothing.
Run with --dry-run first; it reports exactly what it would do and writes
nothing.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy import text                                    # noqa: E402
from app.database import SessionLocal                          # noqa: E402
from app.minehub_db import SessionLocal as PgSession           # noqa: E402

PLANT_KALIAPANI = 1
# Every one of the 192 permanent staff already on file is employed by party 1,
# BAL itself. These people carry BAL employee numbers, so they belong to the
# same employer -- the CLL ones included, whose contract status is recorded in
# employment_type rather than by pointing them at the contractor.
EMPLOYER_BAL = 1
CREATED_BY = "IMPORT mining shift roster"

# The mine writes these interchangeably by hand; folded so one man is one man.
ABBREV = {"KU": "KUMAR", "KR": "KUMAR", "KUM": "KUMAR", "CH": "CHANDRA",
          "PD": "PRASAD", "PR": "PRASAD", "MD": "MOHAMMED"}
SOUND = [("MOHANTA", "MAHANTA"), ("SAHU", "SAHOO"), ("SATHPATHY", "SATAPATHY"),
         ("NAYAK", "NAIK"), ("MOHANTY", "MAHANTY")]

# Roster letter -> shift_calendar.code. The sheet writes the general shift 'G';
# the calendar calls it GENERAL. OFF is not a shift and is stored as a rest day.
SHIFT_CODE = {"A": "A", "B": "B", "C": "C", "G": "GENERAL"}


def canon(s) -> str:
    n = re.sub(r"[^A-Za-z ]", " ", str(s or "")).upper()
    n = " ".join(ABBREV.get(t, t) for t in n.split() if t)
    for a, b in SOUND:
        n = re.sub(rf"\b{b}\b", a, n)
    return n


# A roster line that says Mine Foreman has no business binding to a tipper
# driver, however well the name matches.
CONTRACT_ROLES = {"CONTRACT"}


def employment_of(sap_designation: str | None) -> str:
    """What SAP says the person is, rather than assuming staff.

    Three of the people this adds carry the designation 'CLL' -- contract
    labour, on the company's books but not permanent -- and two more are
    trainees. Writing PERMANENT against all of them would have put a fact into
    the registry that nobody checked and that the payroll contradicts.
    """
    d = (sap_designation or "").strip().upper()
    if d == "CLL":
        return "CONTRACT"
    if "TRAINEE" in d:
        return "TRAINEE"
    return "PERMANENT"


def read_sheet(path: str) -> list[dict]:
    import openpyxl
    ws = openpyxl.load_workbook(path, data_only=True)["MINING"]
    days = {c: int(ws.cell(row=3, column=c).value)
            for c in range(1, ws.max_column + 1)
            if isinstance(ws.cell(row=3, column=c).value, (int, float))
            and 1 <= ws.cell(row=3, column=c).value <= 31}
    groups = {range(4, 13): "Group 1", range(13, 22): "Group 2",
              range(22, 31): "Group 3", range(33, 38): "General"}
    out = []
    for r in range(4, ws.max_row + 1):
        name = ws.cell(row=r, column=2).value
        desig = ws.cell(row=r, column=3).value
        # rows 31-32 repeat the header block; a person has both a name and a role
        if not name or not str(name).strip() or not desig:
            continue
        if ws.cell(row=r, column=1).value is None:
            continue
        out.append({
            "name": str(name).strip(),
            "designation": str(desig).strip(),
            "group": next((g for rg, g in groups.items() if r in rg), "?"),
            "shifts": {days[c]: str(ws.cell(row=r, column=c).value or "").strip().upper()
                       for c in days},
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--month", type=int, default=10)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    people = read_sheet(a.file)
    db, pg = SessionLocal(), PgSession()

    sap = [dict(r) for r in db.execute(text("""
        SELECT EMPID, EMPNAME, EMPDEPT, EMPDESG FROM sap_employee_details_new
    """)).mappings()]
    for s in sap:
        s["_c"] = canon(s["EMPNAME"])

    parties = [dict(r) for r in pg.execute(text("""
        SELECT p.party_id, COALESCE(p.display_name, p.legal_name) AS nm,
               pe.employment_type, pe.designation,
               (SELECT external_code FROM party_identity i
                 WHERE i.party_id = p.party_id AND i.system = 'SAP'
                 ORDER BY i.is_primary DESC LIMIT 1) AS sap_code,
               (SELECT operator_id FROM operator o
                 WHERE o.party_id = p.party_id LIMIT 1) AS operator_id
          FROM party p
          LEFT JOIN party_employment pe ON pe.party_id = p.party_id
         WHERE p.party_type = 'PERSON'
    """)).mappings()]
    for q in parties:
        q["_c"] = canon(q["nm"])

    def sap_for(name):
        c = canon(name)
        hits = [s for s in sap if s["_c"] == c]
        if len(hits) == 1:
            return hits[0], 1.0
        mining = [h for h in hits if (h["EMPDEPT"] or "") == "MINING OPERATIONS"]
        if len(mining) == 1:
            return mining[0], 1.0
        if hits:
            return hits[0], 1.0           # ambiguous; reported by the caller
        best, sc = None, 0.0
        for s in sap:
            r = difflib.SequenceMatcher(None, c, s["_c"]).ratio()
            if r > sc:
                best, sc = s, r
        return (best, sc) if sc >= 0.80 else (None, sc)

    plan = []
    for p in people:
        c = canon(p["name"])
        s, sc = sap_for(p["name"])
        hits = [s2 for s2 in sap if s2["_c"] == c]

        # ── THE EMPLOYEE NUMBER DECIDES, NOT THE SPELLING ──────────────────
        # 242 of the registry's people already carry their SAP number. Where
        # one matches, that is the same human being and no amount of spelling
        # difference changes it. Matching on the name first was about to do
        # real damage: 'RANA BIKASH SINGH' is only 80% like the SAP record
        # 'RANA VIKASH KUMAR SINGH', below any sane threshold, yet party 668
        # already holds exactly that man under SAP 3018. A name-only run would
        # have created a second Rana and split his roster between the two.
        by_code = None
        if s:
            code = str(s["EMPID"]).lstrip("0")
            by_code = next((q for q in parties
                            if q["sap_code"] and str(q["sap_code"]).lstrip("0") == code),
                           None)

        # Then the name, but a staff line never binds to a contract worker
        # whose record carries no employee number to vouch for it.
        cand = [q for q in parties if q["_c"] == c]
        staff = [q for q in cand if (q["employment_type"] or "") not in CONTRACT_ROLES
                 or q["sap_code"]]
        clash = [q for q in cand if q not in staff]
        if not staff and not clash:
            near = sorted((q for q in parties
                           if difflib.SequenceMatcher(None, c, q["_c"]).ratio() >= 0.88),
                          key=lambda q: -difflib.SequenceMatcher(None, c, q["_c"]).ratio())
            staff = [q for q in near
                     if (q["employment_type"] or "") not in CONTRACT_ROLES or q["sap_code"]]

        party = by_code or (staff[0] if staff else None)

        # A party found by name that carries its OWN employee number is the
        # authority on which SAP record this is. ARUN KUMAR RAY has two records
        # in SAP and nothing on the sheet separates them -- but party 664 has
        # been carrying SAP 2900 all along, so the question is already answered
        # and does not need asking.
        if party and party["sap_code"]:
            own = str(party["sap_code"]).lstrip("0")
            if not s or str(s["EMPID"]).lstrip("0") != own:
                better = next((x for x in sap
                               if str(x["EMPID"]).lstrip("0") == own), None)
                if better:
                    s, sc = better, 1.0

        plan.append({
            "person": p, "sap": s, "sap_score": sc,
            "sap_ambiguous": len(hits) > 1,
            "party": party,
            "matched_by_code": by_code is not None,
            "contract_clash": clash[0] if clash and not party else None,
        })

    print(f"{'name':<24}{'group':<10}{'action':<22}{'party':<8}{'SAP':<9} note")
    print("-" * 104)
    for it in plan:
        p, s, q = it["person"], it["sap"], it["party"]
        note = []
        if it["contract_clash"]:
            note.append(f"name also a CONTRACT worker (party "
                        f"{it['contract_clash']['party_id']}) - NOT reused")
        if it["sap_ambiguous"]:
            note.append("2+ SAP records"
                        + (" - settled by the number already on file"
                           if q and q["sap_code"] else ""))
        if it.get("matched_by_code"):
            note.append("matched on employee number")
        if s and it["sap_score"] < 1.0:
            note.append(f"SAP spelling {it['sap_score']:.0%}")
        if not s:
            note.append("no SAP record")
        if q:
            act = "link operator" if not q["operator_id"] else "already rostered"
        else:
            act = "create person + operator"
        print(f"{p['name'][:22]:<24}{p['group']:<10}{act:<22}"
              f"{str(q['party_id']) if q else '-':<8}"
              f"{(s['EMPID'] if s else '-'):<9} {'; '.join(note)}")

    need_person = sum(1 for i in plan if not i["party"])
    need_op = sum(1 for i in plan if i["party"] and not i["party"]["operator_id"])
    blocked = [i for i in plan if not i["sap"] and not i["party"]]
    print(f"\n  create person + operator : {need_person}")
    print(f"  operator for existing    : {need_op}")
    print(f"  already have an operator : {sum(1 for i in plan if i['party'] and i['party']['operator_id'])}")
    print(f"  cannot place             : {len(blocked)}")

    days = sorted({d for i in plan for d in i["person"]["shifts"]})
    work = sum(1 for i in plan for v in i["person"]["shifts"].values()
               if v in SHIFT_CODE)
    rest = sum(1 for i in plan for v in i["person"]["shifts"].values() if v == "OFF")
    print(f"\n  roster days to write: {work} worked + {rest} rest "
          f"= {work + rest} rows over {len(days)} days")

    if a.dry_run:
        print("\nDRY RUN - nothing written.")
        db.close(); pg.close()
        return 0

    written = {"party": 0, "identity": 0, "employment": 0, "operator": 0, "day": 0}
    try:
        for it in plan:
            p, s, q = it["person"], it["sap"], it["party"]
            if not s and not q:
                continue

            if q:
                party_id = q["party_id"]
            else:
                party_id = pg.execute(text("""
                    INSERT INTO party (party_type, legal_name, display_name,
                                       status, created_by)
                    VALUES ('PERSON', :n, :n, 'ACTIVE', :by)
                    RETURNING party_id
                """), {"n": s["EMPNAME"].strip(), "by": CREATED_BY}).scalar()
                written["party"] += 1

            # SAP number, so this person is never matched by name again
            if s:
                code = str(s["EMPID"]).lstrip("0")
                ex = pg.execute(text("""
                    SELECT 1 FROM party_identity
                     WHERE party_id = :p AND system = 'SAP' AND external_code = :c
                """), {"p": party_id, "c": code}).first()
                if not ex:
                    pg.execute(text("""
                        INSERT INTO party_identity (party_id, system, external_code,
                                is_primary, valid_from, created_by)
                        VALUES (:p, 'SAP', :c, TRUE, CURRENT_DATE, :by)
                    """), {"p": party_id, "c": code, "by": CREATED_BY})
                    written["identity"] += 1

            if not q and s:
                pg.execute(text("""
                    INSERT INTO party_employment (party_id, employer_party_id,
                            designation, employment_type, valid_from, created_by)
                    VALUES (:p, :emp, :d, :et, CURRENT_DATE, :by)
                """), {"p": party_id, "emp": EMPLOYER_BAL,
                       "d": (s["EMPDESG"] or "").strip() or None,
                       "et": employment_of(s["EMPDESG"]), "by": CREATED_BY})
                written["employment"] += 1

            op = pg.execute(text(
                "SELECT operator_id FROM operator WHERE party_id = :p LIMIT 1"),
                {"p": party_id}).scalar()
            if not op:
                # OWN for company staff, CONTRACT for the CLL hands, taken
                # from whatever the registry or SAP already says rather than
                # stamped on. operator.employment_type drives who counts as the
                # mine's own people on every workforce screen.
                et = (q["employment_type"] if q and q["employment_type"]
                      else employment_of(s["EMPDESG"] if s else None))
                op = pg.execute(text("""
                    INSERT INTO operator (party_id, employment_type, plant_id,
                            designation, profile_status, approval_status, created_by)
                    VALUES (:p, :et, :pl, :d, 'ACTIVE', 'APPROVED', :by)
                    RETURNING operator_id
                """), {"p": party_id, "et": "OWN" if et == "PERMANENT" else et,
                       "pl": PLANT_KALIAPANI,
                       "d": p["designation"], "by": CREATED_BY}).scalar()
                written["operator"] += 1

            for dnum, letter in p["shifts"].items():
                if letter not in SHIFT_CODE and letter != "OFF":
                    continue
                on = date(a.year, a.month, dnum)
                pg.execute(text("""
                    INSERT INTO roster_day (operator_id, on_date, shift_code,
                            reason, created_by, updated_by)
                    VALUES (:o, :d, :s, :r, :by, :by)
                    ON CONFLICT (operator_id, on_date) DO UPDATE
                       SET shift_code = EXCLUDED.shift_code,
                           reason = EXCLUDED.reason,
                           updated_at = now(), updated_by = EXCLUDED.updated_by
                """), {"o": op, "d": on,
                       "s": SHIFT_CODE.get(letter),      # NULL for OFF = rest
                       "r": f"October sheet, {p['group']}", "by": CREATED_BY})
                written["day"] += 1

        pg.commit()
        print("\nwritten:", ", ".join(f"{k} {v}" for k, v in written.items()))
    except Exception:
        pg.rollback()
        print("\nFAILED - rolled back, nothing written.")
        raise
    finally:
        db.close(); pg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
