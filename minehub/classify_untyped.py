"""Give every machine a type, using what the register already knows about it.

The import left thirty-three machines with no type, because nothing in their
fleet code said what they were. But the register holds more than the code: the
make, the model, the registration number and the nickname. Read together those
are usually decisive — "Tata Prima" against an OD-18 plate is a contractor
tipper, "WINGER[AMBULANCE]" is an ambulance, "LIUGONG 838TE" is a wheel loader.

WHY THIS IS SEPARATE FROM THE IMPORT. The import's job was to get the
spreadsheets in without inventing anything. This is a second pass that reasons
over what landed, and keeping it apart means it can be re-run, argued with and
corrected without touching the data that came from the sheets.

IT STILL REFUSES TO GUESS BLINDLY. Each rule below is a statement somebody
could check: a Prima and a B.Benz on an Odisha commercial plate haul ore, a
Winger is a van body, a Bolero is an MUV. Where no rule fits, the machine keeps
no type and appears in the report, because thirty-two right and one wrong is
worse than thirty-two right and one asked about — the wrong one is never
looked at again.

    python minehub/classify_untyped.py            # what it would set
    python minehub/classify_untyped.py --apply    # set it
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text                                    # noqa: E402

from app.minehub_db import SessionLocal                        # noqa: E402

# Read in order; the first that fits wins. Each carries the reason it fits, so
# the report argues its case rather than asserting it.
RULES: list[tuple[str, str, str]] = [
    (r"ambulance|winger",              "Ambulance",
     "an ambulance body"),
    (r"telehandler",                   "Telehandler",
     "a telehandler"),
    (r"\bpick[\s-]?up\b|imperio|bolero\s*pik",  "Pickup",
     "a pickup"),
    (r"maintenance\s*van|\bvan\b",     "Maintenance Van",
     "a van"),
    (r"liugong|\bwheel\s*loader|\b\d{3}TE\b|\b\d{3}\s*FE\b", "Wheel Loader",
     "a LiuGong wheel loader"),
    (r"\bbus\b|starbus|cityride",      "Bus",
     "a bus"),
    (r"bolero|scorpio|innova|xylo|ertiga|marshal", "MUV",
     "a multi-utility vehicle"),
    (r"fortuner|endeavour|safari|\bsuv\b", "SUV",
     "an SUV"),
    (r"\bswift|dzire|\balto|\bcar\b",  "Car",
     "a car"),
    (r"motorcycle|\bbike\b|splendor|pulsar", "Motorcycle",
     "a motorcycle"),
    (r"forklift",                      "Forklift",
     "a forklift"),
    (r"grader",                        "Grader", "a grader"),
    (r"dozer",                         "Dozer", "a dozer"),
    (r"drill",                         "Drill", "a drill"),
    (r"excavat|zaxis|poclain",         "Excavator", "an excavator"),
    (r"backhoe|back\s*hoe",            "Backhoe Loader", "a backhoe loader"),
    (r"hydra|crane",                   "Crane", "a crane"),
    (r"compact|roller|vibro",          "Compactor", "a compactor"),
    (r"mist\s*cannon",                 "Mist Cannon", "a mist cannon"),
    (r"water\s*tank|sprinkl",          "Water Tanker", "a water tanker"),
    (r"diesel\s*tank|bowser",          "Diesel Bowser", "a diesel bowser"),
    # Last, and deliberately so: the heavy-truck makers only mean "tipper" once
    # nothing more specific has matched. A Tata Prima is a tipper at this mine;
    # a Tata Winger is an ambulance, and it was caught six rules ago.
    (r"prima|b\.?\s*benz|bharat\s*benz|ashok\s*leyland|\bal[-\s]?\d|\bman\b|signa|tipper",
     "Tipper", "a haulage truck on a commercial plate"),
]


def classify(*fields: str | None) -> tuple[str, str] | None:
    blob = " ".join(str(f or "") for f in fields).lower()
    for pattern, name, why in RULES:
        if re.search(pattern, blob):
            return name, why
    return None


def main(apply: bool) -> int:
    db = SessionLocal()
    try:
        types = {r[1].lower(): r[0] for r in db.execute(text(
            "SELECT asset_type_id, name FROM asset_type"))}

        rows = [dict(r) for r in db.execute(text("""
            SELECT asset_id, fleet_code, nickname, make, model, registration_no
            FROM asset WHERE asset_type_id IS NULL ORDER BY fleet_code
        """)).mappings()]

        if not rows:
            print("Every machine already has a type.")
            return 0

        decided, unknown = [], []
        for row in rows:
            hit = classify(row["fleet_code"], row["nickname"], row["make"],
                           row["model"], row["registration_no"])
            (decided if hit else unknown).append((row, hit))

        print(f"\n{len(rows)} machines have no type")
        print(f"  {len(decided)} can be settled from what the register holds")
        print(f"  {len(unknown)} cannot, and stay blank for somebody to set\n")

        by_type: dict[str, int] = {}
        for row, hit in decided:
            by_type[hit[0]] = by_type.get(hit[0], 0) + 1
        for name, n in sorted(by_type.items(), key=lambda x: -x[1]):
            print(f"   {name:<18} {n}")

        print("\nEach one, and why:")
        for row, hit in decided:
            evidence = row["make"] or row["nickname"] or row["fleet_code"]
            print(f"   {row['fleet_code']:<22} -> {hit[0]:<16} {hit[1]} ({evidence})")

        if unknown:
            print("\nLeft blank:")
            for row, _ in unknown:
                print(f"   {row['fleet_code']:<22} {row['nickname'] or ''} "
                      f"{row['make'] or ''}")

        if not apply:
            print("\nNothing was changed. Add --apply to set them.")
            return 0

        set_count = 0
        for row, hit in decided:
            type_id = types.get(hit[0].lower())
            if not type_id:
                continue
            db.execute(text("""
                UPDATE asset SET asset_type_id = :t, updated_at = now()
                WHERE asset_id = :a AND asset_type_id IS NULL
            """), {"t": type_id, "a": row["asset_id"]})
            set_count += 1
        db.commit()
        print(f"\n{set_count} machines typed. They remain drafts — a type set by a "
              f"rule is still something the person doing the entry should agree with.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
