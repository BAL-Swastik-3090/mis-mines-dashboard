"""Backfill the CLL manpower sheet into the platform.

    python minehub/import_cll_manpower_detail.py            # say what it would do
    python minehub/import_cll_manpower_detail.py --apply    # do it

WHAT THIS IS

The 204 people in this sheet are already on the platform — every employee code
matches an existing operator. What was missing was almost everything about
them: qualification, blood group, gender, PAN, Aadhaar, bank, nominee, father's
name, pay grade. Three of those columns were entirely empty for all 211
operators before this ran.

So nothing here creates a person. It fills in the ones already there, and is
safe to run twice.

QUALIFICATION IS ONE LADDER

The first attempt at this treated school level and technical training as two
separate facts, and so recorded nothing at all for fifteen ITI and Diploma
holders — their school level was not written down, so they came out blank.

That is backwards. A fitter who completed ITI has ITI as his highest
qualification. The class 10 he sat before it is implied by the admission rule,
not a separate fact worth a column. The ladder, lowest to highest:

    CLASS_2 .. CLASS_9 < CLASS_10_FAIL < CLASS_10_PASS < ITI
      < HIGHER_SECONDARY < DIPLOMA < GRADUATE < POST_GRADUATE

ITI sits above class 10 because it is taken after it, and below +2 because +2
is the academic route of the same years. A Diploma sits above +2: three years
of polytechnic after class 10, or lateral entry after ITI.

Where a row names two things — "10th Pass, Diploma in Maining Eng." — the
higher one wins, which is what "highest qualification" means.

WHAT IT REFUSES TO DO

It does not invent. A blank blood group stays blank; a phone number that is
not ten digits is reported and skipped rather than padded. A person whose
employee code is not already on the platform is reported, not created — this
sheet is an update, and a new joiner arriving through a spreadsheet backfill
would bypass every check the operator register has.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover
    sys.exit("openpyxl is not installed in this interpreter.")

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "backend"))
from sqlalchemy import text                                    # noqa: E402
from app.minehub_db import SessionLocal                        # noqa: E402

SHEET = r"D:\Projects\Mines\files\CLL Data\Copy of MA (CLL) Manpower master data.xlsx"
ACTOR = "IMPORT cll-detail"
BLANKISH = {"", "NA", "N/A", "NIL", "NILL", "NONE", "-", "--", "0"}


def S(v) -> str:
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""


def blank(v) -> bool:
    return S(v).upper() in BLANKISH


def digits(v) -> str:
    return re.sub(r"\D", "", S(v))


# ── the qualification ladder ───────────────────────────────────────────────
LADDER = ["CLASS_2", "CLASS_3", "CLASS_4", "CLASS_5", "CLASS_6", "CLASS_7",
          "CLASS_8", "CLASS_9", "CLASS_10_FAIL", "CLASS_10_PASS", "ITI",
          "HIGHER_SECONDARY", "DIPLOMA", "GRADUATE", "POST_GRADUATE"]
RANK = {v: i for i, v in enumerate(LADDER)}

# Each pattern contributes a level and, where it says so, a stream. The highest
# level any pattern finds is the answer.
RULES: list[tuple[str, str, str | None]] = [
    (r"M\.?B\.?A",                      "POST_GRADUATE",    "MBA (HR)"),
    (r"\bMSW\b",                        "POST_GRADUATE",    "MSW"),
    (r"PGDCA",                          "POST_GRADUATE",    "PGDCA"),
    (r"\+ ?3 ?ARTS",                    "GRADUATE",         "Arts"),
    (r"\+ ?3 ?COMMERCE",                "GRADUATE",         "Commerce"),
    (r"\+ ?3 ?SCIENCE",                 "GRADUATE",         "Science"),
    (r"\+ ?3",                          "GRADUATE",         None),
    (r"DIPLOMA.*MIN|MIN.*DIPLOMA",      "DIPLOMA",          "Mining Engineering"),
    (r"DIPLOMA.*ELECT",                 "DIPLOMA",          "Electrical"),
    (r"DIPLOMA.*MECH",                  "DIPLOMA",          "Mechanical"),
    (r"DIPLOMA",                        "DIPLOMA",          None),
    (r"\+ ?2 ?ARTS|\(\+2\) ?ARTS",      "HIGHER_SECONDARY", "Arts"),
    (r"\+ ?2 ?COMMERCE",                "HIGHER_SECONDARY", "Commerce"),
    (r"\+ ?2 ?SC|\(\+2\) ?SC",          "HIGHER_SECONDARY", "Science"),
    (r"\+ ?2|\(\+2\)",                  "HIGHER_SECONDARY", None),
    (r"ITI.*FITTER|FITTER.*ITI",        "ITI",              "Fitter"),
    (r"ITI.*ELECT",                     "ITI",              "Electrician"),
    (r"ITI.*MECH",                      "ITI",              "Mechanical"),
    (r"ITI.*WELD",                      "ITI",              "Welder"),
    (r"\bITI\b",                        "ITI",              None),
    (r"10TH\s*(FAIL|FIAL)",             "CLASS_10_FAIL",    None),
    # The bare rule must refuse a fail. Without the lookahead "10th Fail"
    # matched both rules, and because the loop keeps the HIGHEST level, pass
    # beat fail: twenty-four people who did not get through class 10 came out
    # recorded as having passed it.
    (r"10TH(?!\s*(FAIL|FIAL))",         "CLASS_10_PASS",    None),
    (r"^0?9TH",                         "CLASS_9",          None),
    (r"^0?8TH",                         "CLASS_8",          None),
    (r"^0?7TH",                         "CLASS_7",          None),
    (r"^0?6TH",                         "CLASS_6",          None),
    (r"^0?5TH",                         "CLASS_5",          None),
    (r"^0?4TH",                         "CLASS_4",          None),
    (r"^0?3RD",                         "CLASS_3",          None),
    (r"^0?2(ND|TH)",                    "CLASS_2",          None),
]


def qualification(raw: str) -> tuple[str | None, str | None]:
    """The highest level named, and the stream that goes with it."""
    t = S(raw).upper().rstrip(".")
    if not t or t in BLANKISH:
        return None, None
    # A fail must not be read as a pass: check it before the bare 10TH rule.
    best_level = best_stream = None
    for pattern, level, stream in RULES:
        if re.search(pattern, t):
            if best_level is None or RANK[level] > RANK[best_level]:
                best_level, best_stream = level, stream
            elif RANK[level] == RANK[best_level] and stream and not best_stream:
                best_stream = stream
    return best_level, best_stream


GENDER = {"MALE": "M", "FE-MALE": "F", "FEMALE": "F"}
MARITAL = {"MARRIED": "MARRIED", "SINGLE": "UNMARRIED", "UNMARRIED": "UNMARRIED",
           "WIDOW": "WIDOWED", "WIDOWED": "WIDOWED", "DIVORCED": "DIVORCED"}
SKILL = {"SKILLED": "SKILLED", "SEMISKILLED": "SEMI_SKILLED",
         "SEMI-SKILLED": "SEMI_SKILLED", "UNSKILLED": "UNSKILLED",
         "HIGHLY SKILLED": "HIGHLY_SKILLED"}
BLOOD = {"O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"}

# Which sheet column carries which identifier, and how to recognise a good one.
IDENTIFIERS = [
    ("PAN",             25, lambda v: re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", v.upper().replace(" ", ""))),
    ("AADHAAR",         26, lambda v: len(digits(v)) == 12),
    ("UAN",             28, lambda v: len(digits(v)) == 12),
    ("DRIVING_LICENCE", 27, lambda v: len(S(v)) >= 8),
    ("EPF",             29, lambda v: bool(S(v))),
    ("ESIC",            30, lambda v: bool(S(v))),
]


def run(apply: bool) -> int:
    wb = openpyxl.load_workbook(SHEET, data_only=True)
    ws = wb["Mahalaxmi Employees (CLL) "]
    rows = []
    for r in range(4, ws.max_row + 1):
        v = {c: ws.cell(r, c).value for c in range(1, 37)}
        if v.get(2) is None and v.get(3) is None:
            continue
        v["_row"] = r
        rows.append(v)
    print(f"{len(rows)} people in the sheet\n")

    pg = SessionLocal()
    by_code = {}
    for r in pg.execute(text("""
        SELECT i.external_code AS code, o.operator_id, p.party_id, p.legal_name
          FROM operator o
          JOIN party p ON p.party_id = o.party_id
          JOIN party_identity i ON i.party_id = p.party_id AND i.system = 'CONTRACTOR'
    """)).mappings():
        by_code[S(r["code"])] = r

    stat = Counter()
    unknown, oddities = [], []
    quals = Counter()

    for v in rows:
        code = S(v.get(2))
        who = by_code.get(code)
        if not who:
            unknown.append((code, S(v.get(3))))
            continue
        pid, oid = who["party_id"], who["operator_id"]

        # ── the person ────────────────────────────────────────────────────
        gender = GENDER.get(S(v.get(18)).upper())
        marital = MARITAL.get(S(v.get(21)).upper())
        blood = S(v.get(24)).upper().replace(" ", "")
        blood = blood if blood in BLOOD else None
        phone = digits(v.get(22))
        if phone and len(phone) != 10:
            oddities.append((code, S(v.get(3)), "phone", S(v.get(22))))
            phone = None
        dob = v.get(12) if isinstance(v.get(12), datetime) else None
        father = S(v.get(6)) or None

        pg.execute(text("""
            UPDATE party SET
                gender         = COALESCE(:g, gender),
                marital_status = COALESCE(:m, marital_status),
                blood_group    = COALESCE(:b, blood_group),
                phone          = COALESCE(NULLIF(:ph, ''), phone),
                date_of_birth  = COALESCE(CAST(:dob AS date), date_of_birth),
                father_name    = COALESCE(NULLIF(:f, ''), father_name)
             WHERE party_id = :id
        """), {"id": pid, "g": gender, "m": marital, "b": blood, "ph": phone,
               "dob": dob.date() if dob else None, "f": father})
        stat["people updated"] += 1
        for k, got in (("gender", gender), ("blood group", blood),
                       ("marital status", marital), ("phone", phone)):
            if got:
                stat[f"  {k}"] += 1

        # ── the operator ──────────────────────────────────────────────────
        level, stream = qualification(v.get(14))
        quals[(level, stream)] += 1
        skill = SKILL.get(S(v.get(9)).upper())
        pay = S(v.get(10)) or None
        retire = v.get(35) if isinstance(v.get(35), datetime) else None
        em_name, em_rel = S(v.get(7)) or None, S(v.get(8)) or None
        em_phone = digits(v.get(23))
        if em_phone and len(em_phone) != 10:
            oddities.append((code, S(v.get(3)), "emergency phone", S(v.get(23))))
            em_phone = None

        pg.execute(text("""
            UPDATE operator SET
                highest_qualification = COALESCE(:q, highest_qualification),
                qualification_type    = COALESCE(:qt, qualification_type),
                skill_grade           = COALESCE(:sk, skill_grade),
                pay_grade             = COALESCE(NULLIF(:pay, ''), pay_grade),
                retirement_on         = COALESCE(CAST(:ret AS date), retirement_on),
                current_address       = COALESCE(NULLIF(:ca, ''), current_address),
                permanent_address     = COALESCE(NULLIF(:pa, ''), permanent_address),
                emergency_contact_name  = COALESCE(NULLIF(:en, ''), emergency_contact_name),
                emergency_contact_phone = COALESCE(NULLIF(:ep, ''), emergency_contact_phone),
                emergency_contact_relation = COALESCE(NULLIF(:er, ''), emergency_contact_relation)
             WHERE operator_id = :id
        """), {"id": oid, "q": level, "qt": stream, "sk": skill, "pay": pay,
               "ret": retire.date() if retire else None,
               "ca": S(v.get(19)), "pa": S(v.get(20)),
               "en": em_name or "", "ep": em_phone or "", "er": em_rel or ""})
        if level:
            stat["  qualification"] += 1
        if skill:
            stat["  skill grade"] += 1

        # ── the identifiers ───────────────────────────────────────────────
        for system, col, ok in IDENTIFIERS:
            raw = S(v.get(col))
            if blank(raw):
                continue
            if not ok(raw):
                oddities.append((code, S(v.get(3)), system.lower(), raw))
                continue
            value = digits(raw) if system in ("AADHAAR", "UAN") else raw.upper()
            # Only if nobody else already claims it — party_identity enforces
            # one code per system, and a clash is a fact to report, not to
            # overwrite.
            taken = pg.execute(text("""
                SELECT party_id FROM party_identity
                 WHERE system = :s AND external_code = :c
            """), {"s": system, "c": value}).scalar()
            if taken and taken != pid:
                oddities.append((code, S(v.get(3)), f"{system.lower()} clash",
                                 f"{value} already on party {taken}"))
                continue
            if taken:
                continue
            pg.execute(text("""
                INSERT INTO party_identity (party_id, system, external_code,
                                            is_primary, created_by)
                VALUES (:p, :s, :c, FALSE, :by)
                ON CONFLICT (system, external_code) DO NOTHING
            """), {"p": pid, "s": system, "c": value, "by": ACTOR})
            stat[f"  {system.lower()}"] += 1

            # The last four digits stay as their own identity: every screen
            # that only needs to confirm a document reads that one and never
            # touches the full number.
            if system == "AADHAAR":
                pg.execute(text("""
                    INSERT INTO party_identity (party_id, system, external_code,
                                                is_primary, created_by)
                    VALUES (:p, 'AADHAAR_LAST4', :c, FALSE, :by)
                    ON CONFLICT (system, external_code) DO NOTHING
                """), {"p": pid, "c": value[-4:], "by": ACTOR})

        # ── the bank ──────────────────────────────────────────────────────
        acct, bank = S(v.get(34)), S(v.get(31))
        if acct and bank and not blank(acct):
            exists = pg.execute(text("""
                SELECT 1 FROM party_bank_account
                 WHERE party_id = :p AND account_no = :a AND valid_to IS NULL
            """), {"p": pid, "a": acct}).first()
            if not exists:
                pg.execute(text("""
                    UPDATE party_bank_account SET is_primary = FALSE
                     WHERE party_id = :p AND valid_to IS NULL
                """), {"p": pid})
                pg.execute(text("""
                    INSERT INTO party_bank_account (party_id, bank_name, branch,
                                                    ifsc, account_no, created_by)
                    VALUES (:p, :b, NULLIF(:br, ''), NULLIF(:i, ''), :a, :by)
                """), {"p": pid, "b": bank, "br": S(v.get(32)),
                       "i": S(v.get(33)).upper(), "a": acct, "by": ACTOR})
                stat["  bank account"] += 1

        # ── the nominee ───────────────────────────────────────────────────
        nom = S(v.get(7))
        if nom and not blank(nom):
            exists = pg.execute(text("""
                SELECT 1 FROM party_nominee
                 WHERE party_id = :p AND nominee_name = :n AND valid_to IS NULL
            """), {"p": pid, "n": nom}).first()
            if not exists:
                pg.execute(text("""
                    INSERT INTO party_nominee (party_id, nominee_name, relation, created_by)
                    VALUES (:p, :n, NULLIF(:r, ''), :by)
                """), {"p": pid, "n": nom, "r": S(v.get(8)), "by": ACTOR})
                stat["  nominee"] += 1

    # ── what happened ─────────────────────────────────────────────────────
    print("QUALIFICATION, as the ladder resolved it")
    for (lvl, stream), n in sorted(quals.items(),
                                   key=lambda x: (-RANK.get(x[0][0], -1), -x[1])):
        label = lvl or "(nothing written)"
        print(f"  {n:>4}  {label}" + (f"  /  {stream}" if stream else ""))

    print("\nFILLED IN")
    for k, n in stat.most_common():
        print(f"  {n:>4}  {k}")

    if unknown:
        print(f"\nNOT ON THE PLATFORM — {len(unknown)}, not created:")
        for code, name in unknown[:10]:
            print(f"     {code}  {name}")

    if oddities:
        print(f"\nREPORTED, NOT GUESSED AT — {len(oddities)}:")
        for code, name, what, raw in oddities[:15]:
            print(f"     {code}  {name[:24]:<26} {what:<18} {raw!r}")

    # Who is on the platform and no longer in the sheet.
    sheet_codes = {S(v.get(2)) for v in rows}
    gone = [(c, r["legal_name"]) for c, r in by_code.items() if c not in sheet_codes]
    if gone:
        print(f"\nON THE PLATFORM, ABSENT FROM THIS SHEET — {len(gone)}:")
        for c, n in gone:
            print(f"     {c}  {n}")
        print("     Left alone. Closing an operator is a decision, not an import's.")

    if apply:
        pg.commit()
        print("\nCommitted.")
    else:
        pg.rollback()
        print("\nRolled back — nothing written. Re-run with --apply.")
    pg.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write it")
    raise SystemExit(run(ap.parse_args().apply))
