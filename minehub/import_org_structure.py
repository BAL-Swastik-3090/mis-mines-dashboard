"""Read the organisation out of SAP and write down what it implies.

    python minehub/import_org_structure.py            # say what it would do
    python minehub/import_org_structure.py --apply    # do it

WHAT THIS IMPORTS AND WHAT IT REFUSES TO

It imports three things it can see: the departments people at Sukinda Mines are
posted to, the people themselves, and a head-of-department post for each
department.

It does not import a head of department. It *proposes* one and says why, and
the proposal sits unconfirmed until somebody with org.manage agrees. The reason
is in the data: SAP records two Presidents under MINING OPERATIONS. They run
the mine. A rule that says "the senior-most person in the department is its
head" makes one of them head of Mining Operations, leaves the site headless,
and puts a name against an escalation that nobody chose. The rule is a decent
first guess and a bad fact, so it is stored as a guess.

Three refusals follow from the same principle:

  * A T-band grade (President, Vice President, Sr General Manager) is never
    proposed as a department head. That band leads the site or the company.
  * A tie at the top grade produces no proposal, and records the tie.
  * A department whose senior-most person is a workman or a casual produces no
    proposal either — a department with nobody above Plant Assistant does not
    have a head in it, it reports to one somewhere else.

WHAT IT NEVER CHANGES

Nothing that already exists is renamed, re-parented or re-coded. The seven
units the platform already had are matched to their SAP label and kept as they
are, including their ids, because deployments, operators and rosters point at
them. A department that SAP knows and the platform does not is created; the
reverse is left alone.

GRADE ORDER
SAP grades sort by band then number, and the number runs the other way to
seniority: T3 President is senior to T7 Sr General Manager, M1 General Manager
to M8 Executive. The order below is read off the designations the grades
actually carry at this plant, not assumed.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    import psycopg
except ImportError:  # pragma: no cover
    sys.exit("psycopg is not installed in this interpreter.")

try:
    import mysql.connector
except ImportError:  # pragma: no cover
    sys.exit("mysql-connector-python is not installed in this interpreter.")

ROOT = Path(__file__).resolve().parent
PLANT_CODE = "1200"          # Sukinda Mines (Kaliapani)
ACTOR = "IMPORT org 053"

# Bands, most senior first. Within a band the lower number is the senior one.
BAND_ORDER = ["T", "M", "O", "E", "DT", "CL"]
# Nobody in this band is ever proposed as the head of a department.
SITE_BAND = "T"
# Below this, a person is not a candidate to head anything.
LOWEST_HEAD_BAND = "O"


def grade_rank(grade: str | None) -> tuple[int, int]:
    """Smaller is more senior. Unknown grades sort last, not first."""
    if not grade:
        return (99, 99)
    m = re.match(r"^([A-Z]+)(\d*)$", grade.strip().upper())
    if not m:
        return (99, 99)
    band, num = m.group(1), m.group(2)
    try:
        band_ix = BAND_ORDER.index(band)
    except ValueError:
        return (98, 99)
    return (band_ix, int(num) if num else 0)


def band_of(grade: str | None) -> str:
    m = re.match(r"^([A-Z]+)", (grade or "").strip().upper())
    return m.group(1) if m else ""


# ---------------------------------------------------------------------------
# What SAP's truncated department names mean
# ---------------------------------------------------------------------------
# EMPDEPT is a 24-character column, so the long names arrive cut off mid-word.
# Everything here is a label seen in the live data at plant 1200, paired with
# the name to show and the code to file it under. A label that is not here gets
# a unit built from the label itself and a note asking somebody to tidy it.
#
# The seven codes already on the platform appear here so their SAP label points
# at the existing row rather than creating a second one beside it.
KNOWN: dict[str, tuple[str, str]] = {
    # SAP label                     -> (code, display name)
    "MINING OPERATIONS":            ("MINING_OPERATION", "Mining Operation"),
    "AUTOMOBILE":                   ("AUTOMOBILE", "Automobile"),
    "HUMAN RESOURCES":              ("HR", "Human Resources"),
    "ELECTRICAL":                   ("ELECTRICAL", "Electrical"),
    "INFORMATION & TECHNOLOGY":     ("IT", "Information Technology"),
    "IT":                           ("IT", "Information Technology"),
    "COB PLANT":                    ("COBP", "Chrome Ore Beneficiation Plant"),
    # New, with the truncations spelled back out.
    "QC & DESPATCH":                ("QC_DESPATCH", "QC & Despatch"),
    "GEOLOGY":                      ("GEOLOGY", "Geology"),
    "ADMINISTRATION":               ("ADMINISTRATION", "Administration"),
    "EMPLOYEE RELATION":            ("EMPLOYEE_RELATION", "Employee Relations"),
    "CIVIL":                        ("CIVIL", "Civil"),
    "SUPPLY CHAIN MANAGEMENT (":    ("SCM", "Supply Chain Management"),
    "SAFETY & ENVIRONMENT":         ("SAFETY", "Safety & Environment"),
    "MECHANICAL":                   ("MECHANICAL", "Mechanical"),
    "MEDICAL":                      ("MEDICAL", "Medical"),
    "ENVIRONMENT MONITERING":       ("ENV_MONITORING", "Environment Monitoring"),
    "BOUNDRY PILLAR MINING":        ("BOUNDARY_PILLAR", "Boundary Pillar Mining"),
    "WEIGH BRIDGE":                 ("WEIGH_BRIDGE", "Weigh Bridge"),
    "EQUIPMENT MAINTENANCE":        ("EQUIP_MAINT", "Equipment Maintenance"),
    "SECURITY":                     ("SECURITY", "Security"),
    "PROJECT":                      ("PROJECT", "Project"),
    "PPIC":                         ("PPIC", "Production Planning & Inventory Control"),
    "TOTAL PRODUCTIVE MAINTENA":    ("TPM", "Total Productive Maintenance"),
    "STORE":                        ("STORE", "Store"),
    "PROCESS IMPROVEMENT":          ("PROCESS_IMPROVEMENT", "Process Improvement"),
    "QUALITY INSPECTION TESTIN":    ("QIT", "Quality Inspection & Testing"),
    "HR& TRAINING":                 ("HR", "Human Resources"),
    "LEGAL":                        ("LEGAL", "Legal"),
    "ACCOUNTS":                     ("ACCOUNTS", "Accounts"),
    "FINANCE":                      ("FINANCE", "Finance"),
}

SITE_CODE = "SUKINDA_MINES"
SITE_NAME = "Sukinda Mines (Kaliapani)"

# Departments that materially hold engineering stores, in the mine's terms.
# Used only to pre-write a MATERIAL accountability row so the inventory work
# has somewhere to land; every one of them is editable afterwards.
HOLDS_MATERIAL = {
    "MINING_OPERATION", "AUTOMOBILE", "ELECTRICAL", "MECHANICAL", "COBP",
    "CIVIL", "EQUIP_MAINT", "TPM", "PROJECT", "STORE", "SCM", "QC_DESPATCH",
    "IT", "SAFETY", "MEDICAL",
}


def slug(label: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", label.strip().upper()).strip("_")
    return s[:40] or "UNNAMED"


# ---------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------
def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for candidate in (ROOT.parent / "backend" / ".env", ROOT.parent / ".env"):
        if candidate.exists():
            for line in candidate.read_text(encoding="utf-8", errors="ignore").splitlines():
                m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
                if m and not line.lstrip().startswith("#"):
                    env.setdefault(m.group(1), m.group(2).strip())
    import os
    env.update({k: v for k, v in os.environ.items()
                if k.startswith(("PG_", "DB_"))})
    return env


def pg_connect(env):
    """The office LAN and the tunnel, in that order of trying."""
    routes = [(env["PG_HOST"], env.get("PG_PORT", "5432"))]
    if env.get("PG_FALLBACK_HOST"):
        routes.append((env["PG_FALLBACK_HOST"], env.get("PG_FALLBACK_PORT", "5432")))
    last = None
    for host, port in routes:
        try:
            return psycopg.connect(
                host=host, port=port, dbname=env["PG_DATABASE"],
                user=env["PG_USER"], password=env["PG_PASSWORD"],
                connect_timeout=6, autocommit=False,
                options=f"-c search_path={env.get('PG_SCHEMA', 'minehub')},public",
            )
        except Exception as exc:  # noqa: BLE001 — try the next route
            last = exc
            print(f"  {host}:{port} did not answer", file=sys.stderr)
    raise SystemExit(f"No route to PostgreSQL. Last error: {last}")


def sap_rows(env) -> list[dict]:
    conn = mysql.connector.connect(
        host=env["DB_HOST"], port=int(env.get("DB_PORT", 3306)),
        user=env["DB_USER"], password=env["DB_PASSWORD"],
        database=env["DB_NAME"], connection_timeout=20)
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT EMPID, EMPNAME, EMPDESG, EMPGRADE, EMPDEPT, EMPCATEGORY,
                   EMAILID, MOBNO, EMPDOJ, EMPDOB
              FROM sap_employee_details
             WHERE PLANT_CD = %s AND STATUS = 'Active'
               AND EMPDEPT IS NOT NULL AND EMPDEPT <> ''
        """, (PLANT_CODE,))
        return cur.fetchall()
    finally:
        conn.close()


def clean_date(v) -> str | None:
    """SAP writes 1900-01-01 where it means 'not recorded'."""
    s = str(v or "").strip()
    if not s or s.startswith("1900-01-01") or s.startswith("0000"):
        return None
    return s[:10]


EMP_TYPE = {"P": "PERMANENT", "W": "PERMANENT", "T": "TRAINEE", "C": "CONTRACT"}


# ---------------------------------------------------------------------------
# The work
# ---------------------------------------------------------------------------
def run(apply: bool) -> int:
    env = load_env()
    print(f"Reading SAP employee master, plant {PLANT_CODE}, active only.")
    rows = sap_rows(env)
    print(f"  {len(rows)} people in {len({r['EMPDEPT'].strip() for r in rows})} departments.\n")

    by_dept: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_dept[r["EMPDEPT"].strip()].append(r)

    conn = pg_connect(env)
    cur = conn.cursor()
    created_units = updated_people = new_people = proposals = no_proposal = 0

    # --- the site every department hangs under --------------------------------
    cur.execute("SELECT plant_id FROM plant WHERE code = %s", (PLANT_CODE,))
    got = cur.fetchone()
    plant_id = got[0] if got else None

    cur.execute("SELECT org_unit_id FROM org_unit WHERE code = %s", (SITE_CODE,))
    got = cur.fetchone()
    if got:
        site_id = got[0]
    else:
        cur.execute("""
            INSERT INTO org_unit (code, name, unit_type, plant_id, sort_order,
                                  purpose, created_by)
            VALUES (%s, %s, 'SITE', %s, 1,
                    'The mine. Every department at Kaliapani reports into it.', %s)
            RETURNING org_unit_id
        """, (SITE_CODE, SITE_NAME, plant_id, ACTOR))
        site_id = cur.fetchone()[0]
        created_units += 1
        print(f"  + site {SITE_NAME}")

    cur.execute("SELECT party_id FROM party WHERE party_type = 'ORGANISATION' "
                "AND org_category = 'INTERNAL' ORDER BY party_id LIMIT 1")
    got = cur.fetchone()
    if not got:
        raise SystemExit("No internal organisation in party — expected Balasore Alloys Limited.")
    employer_id = got[0]

    # --- departments ----------------------------------------------------------
    unit_of: dict[str, int] = {}          # SAP label -> org_unit_id
    for label in sorted(by_dept):
        code, name = KNOWN.get(label, (slug(label), label.title()))
        note = None if label in KNOWN else "Label not recognised at import; name is SAP's, please check."

        cur.execute("SELECT org_unit_id FROM org_unit_source "
                    "WHERE system = 'SAP_DEPT' AND external_label = %s", (label,))
        got = cur.fetchone()
        if got:
            unit_of[label] = got[0]
            continue

        cur.execute("SELECT org_unit_id FROM org_unit WHERE code = %s", (code,))
        got = cur.fetchone()
        if got:
            unit_id = got[0]
            # An existing unit keeps its name and its id. It only gains a home
            # and a plant if it had none.
            cur.execute("""UPDATE org_unit SET parent_id = COALESCE(parent_id, %s),
                                               plant_id  = COALESCE(plant_id, %s),
                                               unit_type = 'DEPARTMENT'
                            WHERE org_unit_id = %s AND unit_type <> 'SITE'""",
                        (site_id, plant_id, unit_id))
        else:
            cur.execute("""
                INSERT INTO org_unit (code, name, parent_id, unit_type, plant_id,
                                      sort_order, created_by)
                VALUES (%s, %s, %s, 'DEPARTMENT', %s, 100, %s)
                RETURNING org_unit_id
            """, (code, name, site_id, plant_id, ACTOR))
            unit_id = cur.fetchone()[0]
            created_units += 1
            print(f"  + department {name}  ({len(by_dept[label])} people)")

        cur.execute("""INSERT INTO org_unit_source (org_unit_id, system, external_label,
                                                    note, created_by)
                       VALUES (%s, 'SAP_DEPT', %s, %s, %s)
                       ON CONFLICT (system, external_label) DO NOTHING""",
                    (unit_id, label, note, ACTOR))
        unit_of[label] = unit_id

    # --- people ---------------------------------------------------------------
    party_of: dict[str, int] = {}         # EMPID -> party_id
    for label, people in by_dept.items():
        unit_id = unit_of[label]
        for r in people:
            emp = str(r["EMPID"]).strip()
            name = (r["EMPNAME"] or "").strip() or f"EMPID {emp}"
            cur.execute("SELECT party_id FROM party_identity "
                        "WHERE system = 'SAP' AND external_code = %s", (emp,))
            got = cur.fetchone()
            if got:
                party_id = got[0]
                cur.execute("""UPDATE party SET legal_name = %s,
                                      email = COALESCE(NULLIF(%s, ''), email),
                                      phone = COALESCE(NULLIF(%s, ''), phone)
                                WHERE party_id = %s""",
                            (name, (r["EMAILID"] or "").strip(),
                             (r["MOBNO"] or "").strip(), party_id))
                updated_people += 1
            else:
                cur.execute("""
                    INSERT INTO party (party_type, legal_name, date_of_birth,
                                       email, phone, created_by)
                    VALUES ('PERSON', %s, %s, NULLIF(%s, ''), NULLIF(%s, ''), %s)
                    RETURNING party_id
                """, (name, clean_date(r["EMPDOB"]), (r["EMAILID"] or "").strip(),
                      (r["MOBNO"] or "").strip(), ACTOR))
                party_id = cur.fetchone()[0]
                cur.execute("""INSERT INTO party_identity (party_id, system, external_code,
                                                           is_primary, created_by)
                               VALUES (%s, 'SAP', %s, TRUE, %s)
                               ON CONFLICT (system, external_code) DO NOTHING""",
                            (party_id, emp, ACTOR))
                new_people += 1
            party_of[emp] = party_id

            # Employment: one open row per person. A changed department closes
            # the old row rather than overwriting it, so a transfer is visible.
            cur.execute("""SELECT party_employment_id, org_unit_id, designation
                             FROM party_employment
                            WHERE party_id = %s AND valid_to IS NULL
                            ORDER BY valid_from DESC LIMIT 1""", (party_id,))
            open_row = cur.fetchone()
            desg = (r["EMPDESG"] or "").strip() or None
            etype = EMP_TYPE.get((r["EMPCATEGORY"] or "").strip().upper())
            if open_row and open_row[1] == unit_id:
                if open_row[2] != desg:
                    cur.execute("UPDATE party_employment SET designation = %s "
                                "WHERE party_employment_id = %s", (desg, open_row[0]))
            else:
                if open_row:
                    cur.execute("UPDATE party_employment SET valid_to = CURRENT_DATE "
                                "WHERE party_employment_id = %s", (open_row[0],))
                cur.execute("""
                    INSERT INTO party_employment (party_id, employer_party_id, org_unit_id,
                                                  designation, employment_type,
                                                  valid_from, created_by)
                    VALUES (%s, %s, %s, %s, %s, COALESCE(%s::date, CURRENT_DATE), %s)
                """, (party_id, employer_id, unit_id, desg, etype,
                      clean_date(r["EMPDOJ"]), ACTOR))

    # --- head-of-department posts, and a proposal where there is one ----------
    #
    # Grouped by unit, not by SAP label. Two labels can mean one department —
    # 'HUMAN RESOURCES' and 'HR& TRAINING' are both HR — and proposing per
    # label would run the rule twice over half the department each. Whichever
    # label came first alphabetically would win, which in HR's case would have
    # proposed an M8 Executive over the M4 Sr Manager standing beside her.
    print()
    by_unit: dict[int, list[dict]] = defaultdict(list)
    label_of_unit: dict[int, list[str]] = defaultdict(list)
    for label, people in by_dept.items():
        by_unit[unit_of[label]].extend(people)
        label_of_unit[unit_of[label]].append(label)

    for unit_id, people in sorted(by_unit.items(), key=lambda kv: -len(kv[1])):
        label = " / ".join(sorted(label_of_unit[unit_id]))
        cur.execute("SELECT name FROM org_unit WHERE org_unit_id = %s", (unit_id,))
        unit_name = cur.fetchone()[0]

        cur.execute("""SELECT post_id FROM org_post
                        WHERE org_unit_id = %s AND post_type = 'DEPARTMENT_HEAD'
                          AND status = 'ACTIVE'""", (unit_id,))
        got = cur.fetchone()
        if got:
            post_id = got[0]
        else:
            cur.execute("""
                INSERT INTO org_post (org_unit_id, title, post_type, created_by)
                VALUES (%s, %s, 'DEPARTMENT_HEAD', %s) RETURNING post_id
            """, (unit_id, f"Head of {unit_name}", ACTOR))
            post_id = cur.fetchone()[0]

        # Somebody already holds it — an import does not overrule a person.
        cur.execute("SELECT 1 FROM org_post_holding WHERE post_id = %s AND valid_to IS NULL "
                    "AND basis = 'SUBSTANTIVE'", (post_id,))
        if cur.fetchone():
            continue

        ranked = sorted(people, key=lambda r: grade_rank(r["EMPGRADE"]))
        eligible = [r for r in ranked
                    if band_of(r["EMPGRADE"]) != SITE_BAND
                    and grade_rank(r["EMPGRADE"])[0] <= BAND_ORDER.index(LOWEST_HEAD_BAND)]
        if not eligible:
            top = ranked[0] if ranked else None
            why = (f"Nobody in {unit_name} holds a grade that heads a department"
                   + (f" — the senior-most is {top['EMPGRADE']} {top['EMPDESG']}." if top else "."))
            print(f"  ? {unit_name}: no proposal. {why}")
            no_proposal += 1
            continue

        best = grade_rank(eligible[0]["EMPGRADE"])
        tied = [r for r in eligible if grade_rank(r["EMPGRADE"]) == best]
        if len(tied) > 1:
            names = ", ".join(r["EMPNAME"].title() for r in tied)
            print(f"  ? {unit_name}: no proposal — {len(tied)} people share grade "
                  f"{tied[0]['EMPGRADE']} ({names}).")
            no_proposal += 1
            continue

        pick = tied[0]
        emp = str(pick["EMPID"]).strip()
        note = (f"Proposed by the import: senior-most eligible grade in SAP department "
                f"'{label}' — {pick['EMPGRADE']} {pick['EMPDESG']}, "
                f"{len(people)} people in the department. Nobody has confirmed this.")
        cur.execute("""
            INSERT INTO org_post_holding (post_id, party_id, emp_id, basis, source,
                                          derived_note, created_by)
            VALUES (%s, %s, %s, 'SUBSTANTIVE', 'SAP_DERIVED', %s, %s)
        """, (post_id, party_of[emp], emp, note, ACTOR))
        proposals += 1
        print(f"  ~ {unit_name}: proposes {pick['EMPNAME'].title()} "
              f"({pick['EMPGRADE']} {pick['EMPDESG']}) — unconfirmed")

    # --- the site head, which is a different question -------------------------
    cur.execute("""SELECT post_id FROM org_post WHERE org_unit_id = %s
                    AND post_type = 'SITE_HEAD' AND status = 'ACTIVE'""", (site_id,))
    got = cur.fetchone()
    if not got:
        cur.execute("""INSERT INTO org_post (org_unit_id, title, post_type, remarks, created_by)
                       VALUES (%s, 'Head of Sukinda Mines', 'SITE_HEAD',
                               'Left empty on purpose. SAP shows two Presidents at this '
                               'plant and does not say which of them the site reports to.',
                               %s)""", (site_id, ACTOR))

    # Every department reports to the site head unless told otherwise.
    cur.execute("""UPDATE org_post d SET reports_to_post_id = s.post_id
                     FROM org_post s
                    WHERE s.org_unit_id = %s AND s.post_type = 'SITE_HEAD'
                      AND d.post_type = 'DEPARTMENT_HEAD'
                      AND d.reports_to_post_id IS NULL""", (site_id,))

    # --- somewhere for the inventory work to land -----------------------------
    cur.execute("""
        INSERT INTO org_accountability (org_unit_id, domain, description, created_by)
        SELECT u.org_unit_id, 'MATERIAL',
               'Holds engineering and general stores against this department. '
               'Scope still to be tied to a cost centre or storage location.', %s
          FROM org_unit u
         WHERE u.code = ANY(%s)
           AND NOT EXISTS (SELECT 1 FROM org_accountability a
                            WHERE a.org_unit_id = u.org_unit_id AND a.domain = 'MATERIAL')
    """, (ACTOR, list(HOLDS_MATERIAL)))
    material_rows = cur.rowcount

    print(f"\n  units created ............ {created_units}")
    print(f"  people added ............. {new_people}")
    print(f"  people refreshed ......... {updated_people}")
    print(f"  head proposals ........... {proposals}")
    print(f"  departments left open .... {no_proposal}")
    print(f"  material accountabilities  {material_rows}")

    if apply:
        conn.commit()
        print("\nCommitted.")
    else:
        conn.rollback()
        print("\nRolled back — nothing was written. Re-run with --apply.")
    conn.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true",
                    help="write it. Without this the whole run is rolled back.")
    raise SystemExit(run(ap.parse_args().apply))
