# Working in this repository

## A new table ships with a migration. Always.

If a branch reads or writes a table, `minehub/migrations/` must contain the
`CREATE TABLE` for it, in the same branch. No exceptions, including for a
table you created by hand while building the feature.

**Why this keeps happening.** Development and production share one database.
A table created by hand against `corpappdb` is immediately visible to the dev
machine *and* to production, the feature works end to end, every test passes,
and nothing anywhere says the definition was never written down. There is no
symptom until somebody needs a second environment — and then the schema only
exists in the one place nobody can copy it from.

**What it has already cost.** Four tables are live in `minehub` with no
migration behind them:

| Table | Rows |
|---|---|
| `desilting_plan` | 61 |
| `technoton_gps` | 1,413,787 |
| `technoton_man_utilization` | 2,126,084 |
| `technoton_rest_equipment_utilization` | 1,074,648 |

Three more pairs nearly joined them and were caught at review in November
2026 — the equipment excavation plan (migration 096) and the four shifting
tables (098), each written after the fact by reading the live database back.

**Writing one after the fact is not the same thing.** A migration recovered
from a live database is a guess until it is proved. Both 096 and 098 were
verified by building the file into a throwaway schema inside a transaction
and comparing it to `minehub` column by column, then rolling back — and 096's
first draft was three CHECK constraints short. Those three constraints are
what make a history row readable on its own. Nobody would have noticed they
were missing until a row turned up that violated them.

**Check before you open the branch:**

```bash
python minehub/check_migrations.py
```

It names every table that is live but undeclared. Partitions of a declared
parent are not counted.

## Related

- Migrations are applied by hand by a DBA role, not by the application. The
  app connects as `mines_app`, which can read and write `minehub` and read
  `sap_odata_api`, `balcorpdb` and `public` — and nothing else. See migration
  095.
- An endpoint with `response_model=` drops any field its schema does not
  name, silently. Change a service's output shape and change the schema in
  the same commit, and verify through the response, not the service.
