"""What the equipment register says that cannot be true.

Three things were noticed while the Capacity screen was built and never
followed up. All of them feed arithmetic that somebody reads as a plan.

  1. HORSEPOWER IN THE BUCKET FIELD. `capacity` with `capacity_uom` of HP is an
     engine rating, not a bucket. Read as cubic metres it made EX-1 shift 9,216
     Cum an hour. The Capacity screen now refuses any unit that is not a
     volume, so those machines contribute nothing at all — which is safe and
     still wrong: they have buckets and the plan does not know their size.

  2. A NICKNAME THAT LOOKS LIKE A SECOND NAME. "370-5" appears in the
     productivity plan; EX-5's nickname reads "EX-370-5 (EXCAVATOR)". Probably
     the same machine, never confirmed, so a day's output has been landing
     nowhere.

  3. DUPLICATE ROWS. The same machine on the register twice is two machines to
     every roll-up that counts them.

Reported, not corrected. A bucket size is a measurement somebody takes with a
tape, not a number to infer from a spreadsheet, and merging two rows that turn
out to be two real machines is not undoable.
"""
import sys

sys.path.insert(0, "/app")

from sqlalchemy import text                             # noqa: E402
from app.minehub_db import SessionLocal                 # noqa: E402

pg = SessionLocal()

print("=" * 76)
print("1. CAPACITY THAT IS NOT A BUCKET")
print("=" * 76)
rows = pg.execute(text("""
    SELECT a.fleet_code, a.nickname, t.name AS kind,
           a.capacity, a.capacity_uom, a.make, a.model
      FROM asset a
      LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
     WHERE a.capacity IS NOT NULL
       AND (a.capacity_uom IS NULL
            OR UPPER(TRIM(a.capacity_uom)) NOT IN
               ('CUM','M3','M^3','CU.M','CUM.','CBM'))
     ORDER BY t.name, a.fleet_code
""")).mappings().all()
print(f"  {len(rows)} machines carry a capacity in something that is not a volume\n")
print(f"  {'fleet':<12}{'type':<16}{'capacity':>10}  {'unit':<8}{'make / model'}")
for r in rows:
    print(f"  {str(r['fleet_code'] or '—'):<12}{str(r['kind'] or '—')[:15]:<16}"
          f"{float(r['capacity']):>10.2f}  {str(r['capacity_uom'] or '—'):<8}"
          f"{str(r['make'] or '')} {str(r['model'] or '')}")

print()
print("=" * 76)
print("2. MACHINES WHOSE NICKNAME CARRIES ANOTHER CODE")
print("=" * 76)
for r in pg.execute(text("""
    SELECT fleet_code, nickname, asset_ref
      FROM asset
     WHERE nickname IS NOT NULL AND nickname <> ''
       AND nickname !~ ('^' || fleet_code || '$')
     ORDER BY fleet_code
""")).mappings().all():
    print(f"  {str(r['fleet_code']):<12}nickname: {r['nickname']}")

print()
print("=" * 76)
print("3. THE SAME MACHINE TWICE")
print("=" * 76)
dupes = pg.execute(text("""
    SELECT LOWER(TRIM(fleet_code)) AS code, COUNT(*) AS n,
           STRING_AGG(asset_id::text, ', ' ORDER BY asset_id) AS ids
      FROM asset
     WHERE fleet_code IS NOT NULL AND TRIM(fleet_code) <> ''
     GROUP BY LOWER(TRIM(fleet_code))
    HAVING COUNT(*) > 1
     ORDER BY code
""")).mappings().all()
if not dupes:
    print("  no repeated fleet codes")
for d in dupes:
    print(f"  {d['code']:<14}x{d['n']}   asset_ids {d['ids']}")
    for r in pg.execute(text("""
        SELECT a.asset_id, a.asset_ref, a.nickname, a.capacity, a.capacity_uom,
               a.make, a.model, a.lifecycle_stage, a.created_at::date AS made
          FROM asset a WHERE LOWER(TRIM(a.fleet_code)) = :c ORDER BY a.asset_id
    """), {"c": d["code"]}).mappings().all():
        print(f"      #{r['asset_id']:<5}{str(r['asset_ref'] or '—'):<14}"
              f"{str(r['nickname'] or '—')[:22]:<24}"
              f"{str(r['capacity'] or '—'):>8} {str(r['capacity_uom'] or ''):<6}"
              f"{str(r['lifecycle_stage'] or '—'):<12}added {r['made']}")

print()
print("=" * 76)
print("4. EXCAVATORS WITH NO USABLE BUCKET — what Capacity cannot plan")
print("=" * 76)
for r in pg.execute(text("""
    SELECT a.fleet_code, a.nickname, a.capacity, a.capacity_uom
      FROM asset a
      LEFT JOIN asset_type t ON t.asset_type_id = a.asset_type_id
     WHERE UPPER(COALESCE(t.name, '')) LIKE '%EXCAVATOR%'
       AND (a.capacity IS NULL
            OR UPPER(TRIM(COALESCE(a.capacity_uom, ''))) NOT IN
               ('CUM','M3','M^3','CU.M','CUM.','CBM'))
     ORDER BY a.fleet_code
""")).mappings().all():
    print(f"  {str(r['fleet_code']):<12}{str(r['nickname'] or '—')[:26]:<28}"
          f"capacity {str(r['capacity'] or '—')} {r['capacity_uom'] or ''}")
