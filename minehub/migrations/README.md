# Migrations

Numbered, applied in order, by a DBA role — not by the application. The app
connects as `mines_app`, which cannot create or alter a table. See `095`.

## The rule

**A branch that reads or writes a table carries the `CREATE TABLE` for it.**
Development and production share one database here, so a table created by
hand works end to end and nothing says the definition was never recorded.
There is no symptom until somebody needs a second environment.

```bash
python minehub/check_migrations.py
```

Names every table live in `minehub` with no `CREATE TABLE` behind it.
Partitions of a declared parent are not counted. Exits non-zero if anything
is undeclared.

## Standing this schema up somewhere new

Verified on the development server (192.168.10.30) on 2026-11-04: **98 of 100
files apply to an empty database, building 146 tables and 9 views — the same
count production has, and a column-for-column match apart from the `event_*`
partitions, which roll with the calendar.**

Order matters in one place:

1. `sap_odata_api` must exist and carry the SAP OData feed's tables **first**.
   `089` and `093` create views over `sap_odata_api.quality_inspect` and
   `quality_insp_data` and are the two files that will not apply without them.
   Both belong to the SAP pipeline, not to this repository.
2. `balcorpdb` must exist for `095`'s read-only grants to attach to it. It is
   skipped rather than failing if absent, so this is not fatal — the grant
   simply will not be there, and `095` can be re-run once the schema arrives.
3. Everything else applies in numeric order against an empty `minehub`.

`095` and `097` adapt to the server they are run on: the estate roles
(`bal_dba`, the `rp_*` reporting roles, `pems_sync`, `bal_balcorpdb`) and the
read-only schemas are each checked for before anything is granted to them.
Both were literal until the set was first replayed from nothing, which is
what found it.

## Recovering a migration for a table that is already live

It happens — four tables reached production this way and were written up in
`099`, two more pairs in `096` and `098`. A definition read back off a live
database is a guess until it is proved, so prove it:

1. Dump the live columns, constraints and indexes from the catalog.
2. Write the file.
3. Build it into a throwaway schema inside **one transaction**, compare it to
   the live schema object by object, then `ROLLBACK`.

`096`'s first draft passed inspection and was still three `CHECK` constraints
short — the three that make a history row readable on its own. Only the
comparison found them.
