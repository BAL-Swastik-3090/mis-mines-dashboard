"""Put Patra Carriers' 33 drivers on the operator register.

READ THE CHECK FIRST. check_manpower.py says what is wrong with the sheet and
clean_manpower.py says what had to be repaired to read it. This only writes.

WHAT IT WRITES, per person:

    party            the person -- name, father, date of birth, gender, blood
                     group, phone
    operator         the job -- employer PATRA CARRIER, designation, addresses,
                     emergency number
    operator_record  the licence, TWICE: a driving licence in India carries two
                     validities, non-transport and transport, and a tipper runs
                     on the transport one. Holding the earlier of the two would
                     lose the distinction exactly where it matters.

NOBODY IS SUSPENDED. Six of these drivers should not be at the wheel today --
four expired licences and two with none recorded -- and the instruction is to
register them and raise an alert, not to bar them. The alert comes out of
operator_alert on its own: an expired valid_upto is already reported, and
migration 073 adds the case that was silent, a driver with no licence row at
all.

RE-RUNNABLE. A person is matched on name and date of birth together. Run it
twice and the second pass writes nothing; fix a cell in the sheet and re-run
and only that person changes. The alternative -- trusting it to be run once --
is how a register ends up with everybody twice.

NOTHING IS DELETED, and one man is updated rather than inserted: Devashish
Pankaj Patra is already on the register, registered by hand on 29 September,
with no employer set.
"""
import json
import re
import sys

sys.path.insert(0, "/app")

from sqlalchemy import text                             # noqa: E402
from app.minehub_db import SessionLocal                 # noqa: E402

SOURCE = "IMPORT Patra manpower 01-10-2026"
EMPLOYER = "PATRA CARRIER"

# The sheet's words for a job, and the register's. The register already holds
# 101 DRIVER-TIPPER and 7 MECH. HELPER MAN; inventing a 102nd spelling would
# split the same job across two labels on every report that groups by it.
DESIGNATION = {
    "Tipper Driver": "DRIVER-TIPPER",
    "Helper(Maintenance Purpose)": "MECH. HELPER MAN",
}

pg = SessionLocal()
people = json.load(open("/tmp/manpower_clean.json", encoding="utf-8"))
sq = lambda t: re.sub(r"[^a-z0-9]", "", str(t or "").lower())     # noqa: E731

employer_id = pg.execute(text(
    "SELECT party_id FROM party WHERE display_name = :n AND party_type='ORGANISATION'"),
    {"n": EMPLOYER}).scalar()
if not employer_id:
    raise SystemExit(f"{EMPLOYER} is not on the party register — stopping.")
print(f"employer: {EMPLOYER} = party #{employer_id}\n")

# Who is already here, by name AND date of birth. Name alone is not an
# identity: the register already holds a second TAPAN PATRA, born eleven years
# apart from this one, from another import entirely.
existing = {}
for r in pg.execute(text("""
    SELECT party_id, COALESCE(display_name, legal_name) AS nm, date_of_birth
      FROM party WHERE party_type = 'PERSON'""")).mappings():
    existing[(sq(r["nm"]), str(r["date_of_birth"]))] = r["party_id"]

seq = pg.execute(text("""
    SELECT COALESCE(MAX(NULLIF(regexp_replace(operator_ref, '\\D', '', 'g'), '')::int), 0)
      FROM operator WHERE strpos(operator_ref, 'OPR-2026-') = 1""")).scalar() or 0

made = {"party": 0, "operator": 0, "licence": 0, "updated": 0, "skipped": 0}
log = []

try:
    for o in people:
        key = (sq(o["name_as_given"]), str(o["date_of_birth"]))
        party_id = existing.get(key)
        gender = "M" if str(o["gender"] or "").upper().startswith("M") else (
            "F" if str(o["gender"] or "").upper().startswith("F") else None)

        if party_id:
            # Already a person here. Fill what is blank; never overwrite what
            # somebody has already entered by hand.
            pg.execute(text("""
                UPDATE party SET
                    display_name  = COALESCE(display_name, :nm),
                    father_name   = COALESCE(father_name, :fn),
                    gender        = COALESCE(gender, :g),
                    blood_group   = COALESCE(blood_group, :bg),
                    phone         = COALESCE(phone, :ph),
                    updated_at    = now()
                 WHERE party_id = :id
            """), {"id": party_id, "nm": o["name"], "fn": o["father_name"],
                   "g": gender, "bg": o["blood_group"], "ph": o["phone"]})
            made["updated"] += 1
            log.append(f"Sl.{o['sl']:<4} {o['name'][:26]:<28} already here as party "
                       f"#{party_id} — filled blanks, kept what was entered")
        else:
            party_id = pg.execute(text("""
                INSERT INTO party (party_type, legal_name, display_name, gender,
                                   date_of_birth, blood_group, phone, father_name,
                                   status, created_by, created_at, updated_at)
                VALUES ('PERSON', :ln, :nm, :g, CAST(:dob AS date), :bg, :ph, :fn,
                        'ACTIVE', :src, now(), now())
                RETURNING party_id
            """), {"ln": o["name_as_given"], "nm": o["name"], "g": gender,
                   "dob": o["date_of_birth"], "bg": o["blood_group"],
                   "ph": o["phone"], "fn": o["father_name"], "src": SOURCE}).scalar()
            made["party"] += 1
            existing[key] = party_id

        op = pg.execute(text(
            "SELECT operator_id, operator_ref FROM operator WHERE party_id = :p"),
            {"p": party_id}).mappings().first()
        desig = DESIGNATION.get(o["designation"] or "", o["designation"])

        if op:
            operator_id = op["operator_id"]
            pg.execute(text("""
                UPDATE operator SET
                    employer_party_id = COALESCE(employer_party_id, :emp),
                    employment_type   = COALESCE(employment_type, 'CONTRACT'),
                    designation       = COALESCE(designation, :d),
                    joined_on         = COALESCE(joined_on, CAST(:doj AS date)),
                    current_address   = COALESCE(current_address, :ca),
                    permanent_address = COALESCE(permanent_address, :pa),
                    emergency_contact_phone = COALESCE(emergency_contact_phone, :ep),
                    updated_at = now()
                 WHERE operator_id = :id
            """), {"id": operator_id, "emp": employer_id, "d": desig,
                   "doj": o["joined_on"], "ca": o["current_address"],
                   "pa": o["permanent_address"], "ep": o["emergency_phone"]})
        else:
            seq += 1
            operator_id = pg.execute(text("""
                INSERT INTO operator (party_id, operator_ref, employment_type,
                    employer_party_id, designation, joined_on, current_address,
                    permanent_address, emergency_contact_phone, profile_status,
                    approval_status, version, remarks, created_at, updated_at)
                VALUES (:p, :ref, 'CONTRACT', :emp, :d, CAST(:doj AS date), :ca,
                        :pa, :ep, 'ACTIVE', 'DRAFT', 1, :rm, now(), now())
                RETURNING operator_id
            """), {"p": party_id, "ref": f"OPR-2026-{seq:04d}", "emp": employer_id,
                   "d": desig, "doj": o["joined_on"], "ca": o["current_address"],
                   "pa": o["permanent_address"], "ep": o["emergency_phone"],
                   "rm": f"{SOURCE}, Sl. {o['sl']}"}).scalar()
            made["operator"] += 1

        # The licence, both validities. Skipped entirely when there is no
        # licence number: a record with no document and no date is not a
        # licence, and migration 073 reports its absence instead.
        if o["licence_no"]:
            cls = " ".join(o["licence_class"] or []) or None
            for title, upto in (("Non-transport", o["licence_valid_nt"]),
                                ("Transport", o["licence_valid_tr"])):
                if not upto:
                    continue
                dup = pg.execute(text("""
                    SELECT 1 FROM operator_record
                     WHERE operator_id = :o AND record_type = 'LICENCE'
                       AND title = :t"""), {"o": operator_id, "t": title}).first()
                if dup:
                    continue
                pg.execute(text("""
                    INSERT INTO operator_record (operator_id, record_type, title,
                        category, document_no, valid_upto, verification_status,
                        status, details, created_by, created_at, updated_at)
                    VALUES (:o, 'LICENCE', :t, 'DRIVING', :no, CAST(:u AS date),
                            'PENDING', 'ACTIVE', CAST(:d AS jsonb), :src,
                            now(), now())
                """), {"o": operator_id, "t": title, "no": o["licence_no"],
                       "u": upto, "src": SOURCE,
                       "d": json.dumps({"classes": o["licence_class"] or [],
                                        "class_text": cls,
                                        "source_row": o["sl"]})})
                made["licence"] += 1

    pg.commit()
    print(f"committed: {made}\n")
except Exception as exc:                                # noqa: BLE001
    pg.rollback()
    print(f"ROLLED BACK, nothing written: {type(exc).__name__}: {exc}")
    raise

for line in log:
    print("  " + line)

print("\n" + "=" * 78)
print("WHAT THE REGISTER SAYS NOW ABOUT PATRA CARRIER")
print("=" * 78)
for r in pg.execute(text("""
    SELECT o.operator_ref, COALESCE(p.display_name, p.legal_name) AS nm,
           o.designation, p.date_of_birth,
           (SELECT COUNT(*) FROM operator_record r
             WHERE r.operator_id = o.operator_id AND r.record_type='LICENCE') AS lic
      FROM operator o JOIN party p ON p.party_id = o.party_id
     WHERE o.employer_party_id = :e ORDER BY o.operator_ref"""),
    {"e": employer_id}).mappings():
    print(f"   {r['operator_ref']:<16}{str(r['nm'])[:28]:<30}{str(r['designation'])[:18]:<20}"
          f"{r['date_of_birth']}   {r['lic']} licence record(s)")

print("\n" + "=" * 78)
print("ALERTS THIS RAISES — nobody suspended, everybody flagged")
print("=" * 78)
for r in pg.execute(text("""
    SELECT a.operator_ref, a.operator_name, a.alert_type, a.due_on,
           a.days_left, a.severity
      FROM operator_alert a JOIN operator o ON o.operator_id = a.operator_id
     WHERE o.employer_party_id = :e AND a.severity <> 'OK'
     ORDER BY a.severity, a.days_left NULLS FIRST"""),
    {"e": employer_id}).mappings():
    when = "no date" if r["due_on"] is None else f"{r['due_on']} ({r['days_left']}d)"
    print(f"   {r['severity']:<9}{str(r['operator_name'])[:26]:<28}"
          f"{str(r['alert_type'])[:26]:<28}{when}")
