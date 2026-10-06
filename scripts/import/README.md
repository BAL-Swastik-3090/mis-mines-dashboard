# Contractor manpower sheets

Three steps, in order, for a contractor's manpower workbook. BPMC's sits in
the same folder as Patra Carriers' did, so this will be wanted again.

1. `contractor_manpower_check.py` — reads the workbook and says what is wrong
   with it. Writes nothing. Personal data is counted, never printed.
2. `contractor_manpower_clean.py` — produces `manpower_clean.json` and lists
   every repair it had to make. Dates are read **day-first**: the sheets store
   some as real dates and some as text, and a library left to guess turns
   05-06-1984 into the 6th of May.
3. `contractor_manpower_backfill.py` — writes party, operator and licence
   records. Runs inside the backend container, in one transaction, and is
   re-runnable: people are matched on name **and** date of birth together,
   because the register already holds two men called TAPAN PATRA born eleven
   years apart.

The workbook path is the constant at the top of each file. Set the employer
name in the backfill to a party that already exists — it stops if it does not.

Nobody is suspended by this. A driver with an expired licence, or none at all,
is registered and raises an alert through `operator_alert` (migration 073).
