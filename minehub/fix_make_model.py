"""Separate the maker from the model, properly this time.

The import split "MAN CLA 25.280" on the first space and called the first piece
the make. That works until the sheet writes the same machine as "25.280 BSIII
2V 9S 6X4 TPR 14", and then thirty-two machines have a make of "25.280" — a
model number sitting in the manufacturer column, where it is useless for the
one thing a make is for, which is grouping.

It showed up the moment the register let people filter by make: a menu offering
"25.280 (22)" next to "MAN (13)" is a menu that says the data is wrong.

HOW IT IS DECIDED NOW. Against a list of the manufacturers this mine actually
buys from, matched anywhere in the text rather than only at the start. "25.280
BSIII…" carries no maker at all, so the make is taken from the fleet code —
MAN-11 is a MAN — and where nothing says, it is left blank. A blank make is a
question somebody can answer; "25.280" is an answer nobody will question.

    python minehub/fix_make_model.py            # what it would change
    python minehub/fix_make_model.py --apply    # change it
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text                                    # noqa: E402

from app.minehub_db import SessionLocal                        # noqa: E402

# The makers this mine runs, longest first so "Tata Hitachi" is not read as
# "Tata" and "Atlas Copco" is not read as "Atlas".
MAKERS = [
    ("Tata Hitachi", r"tata\s*hitachi"),
    ("Atlas Copco", r"atlas\s*copco"),
    ("Ashok Leyland", r"ashok\s*leyland|^al[-\s]?\d"),
    ("BharatBenz", r"bharat\s*benz|b\.?\s*benz"),
    ("Caterpillar", r"caterpill[ae]r|\bcat\b"),
    ("LiuGong", r"liugong"),
    ("Mahindra", r"mahindra"),
    ("Komatsu", r"komatsu"),
    ("Kobelco", r"kobelco"),
    ("Escorts", r"escorts"),
    ("Hitachi", r"hitachi"),
    ("Epiroc", r"epiroc"),
    ("Volvo", r"volvo"),
    ("BEML", r"\bbeml\b"),
    ("Sany", r"\bsany\b"),
    ("JCB", r"\bjcb\b"),
    ("Tata", r"\btata\b|prima|signa|winger|imperio"),
    ("MAN", r"\bman\b|\bcla\b|^man[-\s]?\d"),
]


def maker_in(*fields: str | None) -> str | None:
    blob = " ".join(str(f or "") for f in fields).lower()
    for name, pattern in MAKERS:
        if re.search(pattern, blob):
            return name
    return None


def looks_like_a_model(value: str | None) -> bool:
    """A make that starts with a digit, or is a machine kind, is not a make."""
    if not value:
        return False
    v = value.strip()
    return bool(re.match(r"^[\d.]", v)) or v.lower() in (
        "excavator", "tipper", "dozer", "loader", "drill", "grader", "crane")


def main(apply: bool) -> int:
    db = SessionLocal()
    try:
        rows = [dict(r) for r in db.execute(text("""
            SELECT asset_id, fleet_code, nickname, make, model, created_by
            FROM asset ORDER BY fleet_code
        """)).mappings()]

        changes = []
        for row in rows:
            maker = maker_in(row["make"], row["model"], row["nickname"], row["fleet_code"])
            current = (row["make"] or "").strip()

            # Leave alone what is already a recognised maker spelled properly.
            if maker and current == maker:
                continue
            # Only touch what is wrong or missing — a make nobody recognises but
            # that clearly is not a model number is somebody's entry, and not
            # ours to overwrite.
            if not maker and not looks_like_a_model(current):
                continue
            if not maker and looks_like_a_model(current):
                changes.append((row, None, "no maker named anywhere — left blank"))
                continue
            if current and not looks_like_a_model(current) and maker and \
                    current.lower() not in maker.lower():
                # "Ashok" -> "Ashok Leyland" is a completion, so it goes ahead.
                # Anything else is a disagreement, and whether to overrule it
                # depends on who wrote it. A person typing "Volvo Roller" meant
                # something by it; the import writing "VOLVO-ROLLER" only took
                # the first token of a model string, and protecting that is
                # protecting a mistake.
                by_a_person = (row.get("created_by") or "") != "IMPORT"
                if by_a_person and not maker.lower().startswith(current.lower()):
                    continue
            changes.append((row, maker, "recognised maker" if current != maker else ""))

        print(f"\n{len(changes)} of {len(rows)} machines would have their make corrected\n")

        summary: dict[str, int] = {}
        for _, maker, _why in changes:
            summary[maker or "(left blank)"] = summary.get(maker or "(left blank)", 0) + 1
        for name, n in sorted(summary.items(), key=lambda x: -x[1]):
            print(f"   {name:<18} {n}")

        print("\nA sample:")
        for row, maker, why in changes[:12]:
            print(f"   {row['fleet_code']:<20} {str(row['make']):<18} -> "
                  f"{str(maker):<15} {why}")

        if not apply:
            print("\nNothing changed. Add --apply to correct them.")
            return 0

        for row, maker, _ in changes:
            db.execute(text("""
                UPDATE asset SET make = :m, updated_at = now() WHERE asset_id = :a
            """), {"m": maker, "a": row["asset_id"]})
        db.commit()

        print(f"\n{len(changes)} corrected.")
        print("\nMakes on the register now:")
        for r in db.execute(text(
                "SELECT COALESCE(make, '(blank)') m, count(*) c FROM asset "
                "GROUP BY 1 ORDER BY c DESC")).mappings():
            print(f"   {r['m']:<18} {r['c']}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main("--apply" in sys.argv))
