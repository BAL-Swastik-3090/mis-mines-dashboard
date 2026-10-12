"""Put the mine's vehicle alert list onto the machines: who drives what, per shift.

THE LIST. Twenty-one MAN tippers, each with a named driver for A, B and C
shift, plus twenty-six spare drivers held per shift against no particular
vehicle.

WHAT WAS THERE BEFORE. Nineteen assignment rows seeded during testing, drivers
picked alphabetically -- Adaitya, Aiban, Akshaya, Akshya, Amar, Ambuja, Anam
all on MAN-11. They are removed, not merged: a real list and a test list mixed
together is worse than either.

── MATCHED ONLY AGAINST TIPPER DRIVERS ─────────────────────────────────────
Every name here drives a tipper, so the candidates are the 129 operators whose
trade says so, not all 269. Matching against everybody put 'ATHAYA NAYAK' onto
AKSHAYA NAYAK at 88% similarity -- a Mining Mate added to the roster last week,
who has never driven a tipper. The trade filter is what makes a near-miss on
the spelling safe.

── WHAT IS DELIBERATELY NOT WRITTEN ────────────────────────────────────────
A slot is skipped, and reported, whenever the register cannot say which man is
meant:

  HARIHAR MOHANTA (A) and (B) -- the list marks two men apart with a letter the
  register has never held. Two Harihars are on file, with different fathers.
  Nothing connects the letter to the man.

  KHAGESWAR MOHANTA (B) -- three men of that exact name are on file.

  PITAMBER MOHANTA -- named on two vehicles in two different shifts, and two
  Pitambars are on file. One man on both, or one each, is not visible from here.

Guessing any of these would bind a named person to a machine for every shift,
handover and alert that follows. The mine can say in a sentence; the data
cannot say at all.
"""
from __future__ import annotations

import argparse
import difflib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlalchemy import text                                   # noqa: E402
from app.minehub_db import SessionLocal                       # noqa: E402

CREATED_BY = "IMPORT vehicle alert list"

VEHICLES = [
    ("MAN-11", "NETRANANDA MOHANTA", "MAHESWAR MOHANTA", "ARUNA KUMAR MOHANTA"),
    ("MAN-14", "RAMA MUNDA", "RANJAN PRADHAN", "PATITAPABANA SAHOO"),
    ("MAN-18", "LAXMIKANTA MOHANTA", "CHATURBHUJA NAYAK", "BASANTA PARIDA"),
    ("MAN-20", "BALARAM NAYAK", "KUNA MOHANTA", "SUBASH CHANDRA BARIK"),
    ("MAN-43", "CHANDRAKANTA MOHANTA", "PRATAP MOHANTA", "AMBUJA MAHAPATRA"),
    ("MAN-48", "BIRENDRA PARIDA", "KALAKAR MAHARANA", "BISWA CHINTAMANI KHUNTIA"),
    ("MAN-49", "NIHAR RANJAN NAYAK", "DURYAODHAN MOHANTA", "SARANA BARIK"),
    ("MAN-50", "NARAYAN MOHANTA", "PITAMBER MOHANTA", "CHAITANYA CHARAN BARIK"),
    ("MAN-53", "GANESWAR MOHANTA", "AKSHAYA DAS", "DHARMEDHAR MOHANTA"),
    ("MAN-55", "AMAR BEHERA", "ROHITA KUMAR MOHANTA", "KHAGESWAR MOHANTA (B)"),
    ("MAN-56", "PARAMANANDA MOHANTA", "SANTOSH JENA", "ANTARYAMI NAYAK"),
    ("MAN-57", "MANORANJAN MOHANTA", "AKSHAYA MOHANTA", "SUDAN MOHANTA"),
    ("MAN-58", "BHAKTA BANDHU MOHANTA", "KESHABA CHANDRA MOHANTA", "HARIHAR MOHANTA (A)"),
    ("MAN-65", "SIBA MOHANTA", "TRILOCHAN MOHANTA", "ANAMA MAHAKUD"),
    ("MAN-66", "HIRANYA OJHA", "PRAFULLA MOHANTA", "RANJIT MOHANTA"),
    ("MAN-67", "AKSHAYA DEHURI", "ADITYA ARUK", "PITABASH MOHANTA"),
    ("MAN-69", "RAMA CHANDRA SAMAD", "BHABANI SANKAR MOHANTA", "RAJKISHOR NAYAK"),
    ("MAN-71", "BIJAY KUMAR NAYAK", "KHIROD NAYAK", "RASHMI RANJAN MOHANTA"),
    ("MAN-75", "PITAMBER MOHANTA", "PADMANAV MOHANTA", "ATHAYA NAYAK"),
    ("MAN-77", "RASANANDA MOHANTA", "GAGNADHAR MOHANTA", "BRAMHANANDA ROUT"),
    ("MAN-80", "PRATAP LOHAR", "PRADIP CHARAN MOHANTA", "HARIHAR MOHANTA (B)"),
]

# Spare drivers, held per shift against no vehicle. They cannot be written as
# assignments -- operator_assignment.asset_id is NOT NULL, and rightly: an
# assignment IS the link between a man and a machine. Reported, not invented.
EXTRA = {
    "A": ["SANJAY KUMAR SAHOO", "KUNAL MAHAPATRA", "DUKHABANDHU NAYAK", "GHASIRAM TUDU",
          "KUSADEV HEMBRAM", "MADHABANANDA MOHANTA", "RATHA HANSDA", "SUSANTA HESSA",
          "CHITTARANJAN NAYAK", "PRADEEP KISHOR MOHANTA"],
    "B": ["GOURANGA MOHANTA", "PABITRA ROUT", "AIBAN HEMBRAM", "NIKUNJA PRADHAN",
          "PADMANAV MOHANTA", "RANJAN SAMAL", "KIRTAN MOHANTA"],
    "C": ["SANATAN PINGUA", "BALARAM MOHANTA", "DAYANIDHI MOHANTA", "LAMBODHAR MOHANTA",
          "KUSUNU BANSINGH", "MAHENDRA MOHANTA", "AJAY KUMAR MOHANTA", "PRAVAKAR MOHANTA",
          "GURUCHARAN LAGURI"],
}

# Spellings the mine and the register use interchangeably.
SOUND = [("MOHANTA", "MAHANTA"), ("MOHANTA", "MOHANTY"), ("MOHANTA", "MAHANTY"),
         ("SAHOO", "SAHU"), ("NAYAK", "NAIK"), ("MOHAPATRA", "MAHAPATRA"),
         ("DEHURY", "DEHURI"), ("AKSHAYA", "AKSHYA"), ("PITAMBAR", "PITAMBER"),
         ("KISHORE", "KISHOR"), ("SANJAYA", "SANJAY")]
DROPPABLE = {"KUMAR", "CHANDRA", "CHARAN", "KU", "KR"}


def canon(s: str) -> str:
    s = re.sub(r"\([A-Z]\)", " ", str(s or ""))       # the (A)/(B) tag is not a name
    s = re.sub(r"[^A-Za-z ]", " ", s).upper()
    out = " ".join(t for t in s.split() if t)
    for keep, alt in SOUND:
        out = re.sub(rf"\b{alt}\b", keep, out)
    return out


def core(s: str) -> frozenset:
    """The name without the middle words the list routinely drops.

    'RANJAN PRADHAN' on the sheet is 'Ranjan Kumar Pradhan' on the register.
    Dropping KUMAR/CHANDRA/CHARAN from both sides makes them the same man
    without loosening the match for anybody else.
    """
    return frozenset(t for t in canon(s).split() if t not in DROPPABLE)


def tagged(name: str) -> bool:
    """A name the list itself marks as one of two men: 'HARIHAR MOHANTA (B)'."""
    return bool(re.search(r"\([A-Z]\)", name or ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    pg = SessionLocal()
    assets = {(r["fleet_code"] or "").replace(" ", "").upper(): r["asset_id"]
              for r in pg.execute(text("SELECT asset_id, fleet_code FROM asset")).mappings()}

    # THE POOL IS THE CONTRACTOR WORKFORCE, NOT THE TIPPER TRADE.
    #
    # Restricting to trade = Tipper Driver was tried and threw away real people:
    # ANAMA MAHAKUD and PATITAPABANA SAHOO are on the register as Water Tanker
    # Drivers, and the mine has put them on MAN tippers for this period, which
    # is ordinary. A trade is what somebody usually drives, not what they may
    # be assigned to this week.
    #
    # What IS excluded is the thirty-two BAL mining staff added to the roster
    # last week -- Asst Managers, Mine Foremen, Mining Mates. They are not
    # tipper drivers and never will be, and leaving them in the pool is what
    # matched 'ATHAYA NAYAK' onto AKSHAYA NAYAK, a Mining Mate, at 88%.
    drivers = [dict(r) for r in pg.execute(text("""
        SELECT o.operator_id, COALESCE(p.display_name, p.legal_name) AS nm,
               p.father_name, t.name AS trade
          FROM operator o
          JOIN party p ON p.party_id = o.party_id
          LEFT JOIN trade t ON t.trade_id = o.trade_id
         WHERE o.profile_status = 'ACTIVE'
           AND COALESCE(o.created_by, '') <> 'IMPORT mining shift roster'
    """)).mappings()]
    for d in drivers:
        d["_c"], d["_k"] = canon(d["nm"]), core(d["nm"])
        d["_s"] = " ".join(sorted(d["_k"]))
    print(f"candidate pool: {len(drivers)} contractor operators")

    # Names the list uses more than once: one man on two vehicles, or two men
    # sharing a name. Either way it is not decidable here.
    seen: dict = {}
    for veh, *shifts in VEHICLES:
        for sh, nm in zip("ABC", shifts):
            seen.setdefault(core(nm), []).append(f"{veh} shift {sh}")
    repeated = {k for k, v in seen.items() if len(v) > 1}

    def resolve(name: str):
        """(operator_id, why) or (None, reason it was not safe to decide)."""
        if tagged(name):
            return None, "list marks two men apart with a letter the register does not hold"
        k, c = core(name), canon(name)
        hits = [d for d in drivers if d["_k"] == k]
        if len(hits) == 1:
            return hits[0], "exact" if hits[0]["_c"] == c else "middle name dropped"
        if len(hits) > 1:
            return None, f"{len(hits)} drivers of this name on the register"
        # Compared both ways: the full name, and the name with the middle words
        # the list drops. 'SARANA BARIK' against 'Saran Kumar Barik' is only 83%
        # as written and 93% once KUMAR is set aside, and it is plainly the same
        # man.
        mine = " ".join(sorted(k))

        def score(d):
            return max(difflib.SequenceMatcher(None, c, d["_c"]).ratio(),
                       difflib.SequenceMatcher(None, mine, d["_s"]).ratio())

        best, sc = None, 0.0
        for d in drivers:
            r = score(d)
            if r > sc:
                best, sc = d, r
        if sc >= 0.90:
            # a near spelling is only safe when it is the ONLY near one
            rivals = [d for d in drivers if score(d) >= 0.90]
            if len(rivals) == 1:
                return best, f"spelling {sc:.0%}"
            return None, (f"{len(rivals)} people match this spelling equally well: "
                          + ", ".join(sorted(d["nm"] for d in rivals)))
        return None, f"not on the register (nearest {best['nm']} {sc:.0%})"

    plan, skipped = [], []
    for veh, *shifts in VEHICLES:
        asset_id = assets.get(veh.replace("-", "-").upper()) or assets.get(veh.upper())
        for sh, nm in zip("ABC", shifts):
            if core(nm) in repeated:
                skipped.append((veh, sh, nm,
                                "named on two vehicles; cannot tell one man from two"))
                continue
            who, why = resolve(nm)
            if not who or not asset_id:
                skipped.append((veh, sh, nm, why if who is None else "vehicle not registered"))
                continue
            plan.append((veh, asset_id, sh, nm, who, why))

    print(f"\n{'vehicle':<9}{'shift':<7}{'name on the list':<26}{'matched to':<26}how")
    print("-" * 92)
    for veh, _aid, sh, nm, who, why in plan:
        print(f"{veh:<9}{sh:<7}{nm[:24]:<26}{str(who['nm'])[:24]:<26}{why}")

    print(f"\n  to write : {len(plan)} of {len(VEHICLES)*3} vehicle slots")
    print(f"  skipped  : {len(skipped)}")
    for veh, sh, nm, why in skipped:
        print(f"     {veh:<8} shift {sh}  {nm:<26} {why}")

    ex_found = ex_miss = 0
    for sh, lst in EXTRA.items():
        for nm in lst:
            who, _ = resolve(nm)
            ex_found += 1 if who else 0
            ex_miss += 0 if who else 1
    print(f"\n  spare drivers: {ex_found + ex_miss} listed "
          f"({ex_found} on the register, {ex_miss} not). None can be stored as an "
          f"assignment — they are held against a shift, not a machine.")

    if a.dry_run:
        print("\nDRY RUN — nothing written.")
        pg.close()
        return 0

    try:
        old = pg.execute(text("SELECT COUNT(*) FROM operator_assignment")).scalar()
        pg.execute(text("DELETE FROM operator_assignment"))
        for veh, asset_id, sh, nm, who, _why in plan:
            pg.execute(text("""
                INSERT INTO operator_assignment
                       (operator_id, asset_id, shift, role, valid_from,
                        status, assigned_by, created_by, remarks)
                VALUES (:o, :a, :s, 'PRIMARY', CURRENT_DATE, 'ACTIVE',
                        :by, :by, :rm)
            """), {"o": who["operator_id"], "a": asset_id, "s": sh,
                   "by": CREATED_BY, "rm": f"Vehicle alert list — {veh} shift {sh}"})
        pg.commit()
        print(f"\n  removed {old} old rows, wrote {len(plan)} assignments.")
    except Exception:
        pg.rollback()
        print("\nFAILED — rolled back, nothing changed.")
        raise
    finally:
        pg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
