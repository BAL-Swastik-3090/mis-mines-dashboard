"""Sample machines, so the register can be judged with something in it.

An empty register hides every question worth asking about the screen: how a long
list reads, whether a draft is distinguishable from an approved machine at a
glance, what the alerts look like when documents are about to lapse. These are
plausible Kaliapani machines — the makes, capacities and document cycles are the
ones the mine actually runs — but they are examples, not records: each carries
SAMPLE in its remarks, and the script removes them all with --clear.

Run:  python minehub/seed_demo_fleet.py          (add)
      python minehub/seed_demo_fleet.py --clear  (remove them again)
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text                                    # noqa: E402
from app.minehub_db import SessionLocal                        # noqa: E402

MARK = "SAMPLE — demonstration record"
today = date.today()


def d(days: int) -> str:
    return (today + timedelta(days=days)).isoformat()


# fleet, nick, type, make, model, capacity, uom, ownership, status, approval, docs
FLEET = [
    ("TP-01", "Bada Tipper",  "Tipper",    "Tata",       "Signa 2823.K", 25, "MT",  "OWN",   "ACTIVE",      "APPROVED"),
    ("TP-02", "Chhota Tipper","Tipper",    "Ashok Leyland", "3520",      21, "MT",  "OWN",   "ACTIVE",      "APPROVED"),
    ("EX-04", "Bada Poclain", "Excavator", "Hitachi",    "ZX470",        2.6, "m³", "OWN",   "ACTIVE",      "APPROVED"),
    ("EX-07", None,           "Excavator", "CAT",        "320D",         1.2, "m³", "HIRED", "ACTIVE",      "SUBMITTED"),
    ("DZ-02", "Dozer",        "Dozer",     "BEML",       "BD80",        None, None, "OWN",   "MAINTENANCE", "APPROVED"),
    ("DR-01", None,           "Drill",     "Atlas Copco", "ROC D7",     None, None, "HIRED", "ACTIVE",      "SUBMITTED"),
    ("LD-03", "Loader",       "Loader",    "Volvo",      "L120",         3.0, "m³", "OWN",   "ACTIVE",      "DRAFT"),
    ("WT-01", "Water Tanker", "Tanker",    "Tata",       "LPK 2518",   12000, "L",  "HIRED", "STANDBY",     "DRAFT"),
]

DOCS = [
    # type, provider, days until it lapses — one is deliberately overdue and one
    # close, so the alerts screen has something true to show.
    ("INSURANCE", "New India Assurance", 210),
    ("FITNESS",   "RTO Jajpur",           -6),
    ("ROAD_TAX",  "RTO Jajpur",           28),
]


def clear(db) -> int:
    n = db.execute(text("SELECT count(*) FROM asset WHERE remarks = :m"), {"m": MARK}).scalar()
    db.execute(text("DELETE FROM asset WHERE remarks = :m"), {"m": MARK})
    db.commit()
    return n


def seed(db) -> None:
    contractor = db.execute(text(
        "SELECT party_id FROM party WHERE party_type = 'ORGANISATION' AND display_name <> 'BAL' ORDER BY party_id LIMIT 1")).scalar()
    if contractor is None:
        contractor = db.execute(text(
            "INSERT INTO party (party_type, legal_name, display_name) "
            "VALUES ('ORGANISATION', 'Sample Contractor Pvt Ltd', 'Sample Contractor') "
            "RETURNING party_id")).scalar()
    site = db.execute(text("SELECT location_id FROM location ORDER BY location_id LIMIT 1")).scalar()

    for code, nick, type_name, make, model, cap, uom, own, status, approval in FLEET:
        if db.execute(text("SELECT 1 FROM asset WHERE fleet_code = :c"), {"c": code}).first():
            print(f"  {code} already exists — left alone")
            continue

        # Match on the code as well as the name: the registry already carries
        # seeded types whose display name differs from what is written here, and
        # inserting a second TIPPER would be exactly the duplication the type
        # master exists to prevent.
        type_id = db.execute(text(
            "SELECT asset_type_id FROM asset_type WHERE name = :n OR code = :c"
        ), {"n": type_name, "c": type_name.upper().replace(" ", "_")}).scalar()
        if type_id is None:
            type_id = db.execute(text(
                "INSERT INTO asset_type (code, name, category, created_by) "
                "VALUES (:c, :n, 'OTHER', 'seed') RETURNING asset_type_id"
            ), {"c": type_name.upper().replace(" ", "_"), "n": type_name}).scalar()

        aid = db.execute(text("""
            INSERT INTO asset (fleet_code, nickname, asset_type_id, make, model, capacity,
                               capacity_uom, ownership, owner_party_id, status, home_location_id,
                               reading_uom, current_reading, fuel_type, registration_no,
                               year_of_make, approval_status, submitted_by, approved_by,
                               approved_at, submitted_at, remarks, created_by, asset_ref)
            VALUES (:code, :nick, :type_id, :make, :model, :cap, :uom, :own, :owner, :status, :loc,
                    'HOURS', :reading, 'DIESEL', :reg, 2021, :approval,
                    CASE WHEN :approval IN ('SUBMITTED','APPROVED') THEN 'seed' END,
                    CASE WHEN :approval = 'APPROVED' THEN 'seed' END,
                    CASE WHEN :approval = 'APPROVED' THEN now() END,
                    CASE WHEN :approval IN ('SUBMITTED','APPROVED') THEN now() END,
                    :mark, 'seed', next_asset_ref())
            RETURNING asset_id"""), {
            "code": code, "nick": nick, "type_id": type_id, "make": make, "model": model,
            "cap": cap, "uom": uom, "own": own,
            "owner": contractor if own == "HIRED" else None,
            "status": status, "loc": site, "reading": 1000 + abs(hash(code)) % 9000,
            "reg": f"OD09{code.replace('-', '')}",
            "approval": approval, "mark": MARK}).scalar()

        for doc_type, provider, days in DOCS:
            db.execute(text("""
                INSERT INTO asset_compliance (asset_id, document_type, document_no, provider,
                                              valid_from, valid_upto, status, created_by)
                VALUES (:a, :t, :no, :p, :from, :upto, 'ACTIVE', 'seed')"""), {
                "a": aid, "t": doc_type, "no": f"{doc_type[:3]}/{code}/26",
                "p": provider, "from": d(days - 365), "upto": d(days)})

        db.execute(text("""
            INSERT INTO asset_revision (asset_id, version, action, changes, remarks, changed_by)
            VALUES (:a, 1, 'CREATED', '{}'::jsonb, :m, 'seed')"""), {"a": aid, "m": MARK})

        print(f"  {code:<6} {approval:<10} {type_name}")

    db.commit()


if __name__ == "__main__":
    with SessionLocal() as db:
        if "--clear" in sys.argv:
            print(f"removed {clear(db)} sample machines")
        else:
            seed(db)
            print("\nRegister now holds:")
            for r in db.execute(text(
                    "SELECT asset_ref, fleet_code, approval_status, remarks IS NOT DISTINCT FROM :m "
                    "FROM asset ORDER BY asset_id"), {"m": MARK}):
                print(f"  {r[0]}  {r[1]:<26} {r[2]:<10} {'sample' if r[3] else 'real'}")
