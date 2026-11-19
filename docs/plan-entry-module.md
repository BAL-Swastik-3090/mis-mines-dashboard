# The Plans entry module

**Branch:** `plan-entry-module-19-11-2026`, cut from `LCM-merge-19-11-2026`
**Status:** complete and running locally; never deployed, never run against
production.

---

## 1. What this is for

Three plans the mine files every month — the **despatch plan**, the **COB
plant plan** and the **shift-wise excavation plan** — were typed into
`balcorpdb` on the shared MySQL server and read from there by the dashboard.
Migrations 126, 127 and 128 (already merged, see section 3) copied those
tables into `minehub` on Postgres and pointed every reader at the copy.

That left a gap: **nothing wrote them any more.** The dashboard reads the
Postgres copy, PPIC and Geology were still typing into MySQL, and the two
drift apart from the day the switch happened. This branch closes it. These
screens are now where the three plans are filed.

There is no fallback to MySQL in this code. That is deliberate — a silent
fallback is how a half-migrated table goes unnoticed for a month.

---

## 2. Who files what

Not a convention — it is what the stored rows say. Every despatch and COB row
carries one entry id, every excavation row another:

| Plan | Department | Permission to write |
|---|---|---|
| Despatch | PPIC | `plan.despatch.edit` |
| COB Plant | PPIC | `plan.despatch.edit` |
| Excavation (shift-wise) | Geology | `plan.excavation.edit` |
| Mining faces (the list the excavation plan picks from) | Geology | `plan.excavation.edit` |

Reading any of them needs `plan.view`. Removing a filed day needs
`plan.delete`, which is marked sensitive.

---

## 3. What is already merged vs. what is in this branch

**Already on `LCM-merge-19-11-2026`** — the tables and the readers:

| Migration | Brings across |
|---|---|
| 126 | `prev_day_actual` + `prev_day_actual_hist` |
| 127 | `despatch_plan`, `cobp_plan`, `plan_entry_hist` |
| 128 | `excavation_plan`, `day_wise_excavation`, `agency_master` |

**New in this branch:**

| Migration | Creates |
|---|---|
| 129 | The four permissions above. **Creates them only — grants nothing.** |
| 130 | `mine_face` + `mine_face_hist`, seeded from the plan's own rows, plus a validated FK `excavation_plan.loc_id` to `mine_face.face_no` |

> **Before anybody can open these screens**, the permissions from 129 have to
> be granted to a role in Access Control. 129 deliberately does not do it:
> who gets `plan.delete` is the mine's decision, not a migration's.

### Applying 130 to production needs care

No migration in this repo sets `lock_timeout` — it is set in the session by
whoever runs them, and it must be:

```sql
SET lock_timeout = '5s';
```

130 ends with `ALTER TABLE excavation_plan ADD CONSTRAINT ... NOT VALID`
followed by `VALIDATE CONSTRAINT`. `excavation_plan` is read by the LCM, the
MIS dashboard and the Executive Summary. The two-step form is used precisely
so the exclusive lock is held for an instant rather than for a full table
scan — but without `lock_timeout` a queued exclusive lock still blocks every
reader behind it. Check `pg_stat_activity` for a long transaction (a running
`pg_dump` holds ACCESS SHARE on every table for its whole run) before
starting, and retry on a timer rather than in a loop.

Neither 129 nor 130 carries its own `BEGIN; ... COMMIT;`, so both can be
rehearsed inside a transaction and rolled back.

---

## 4. Why migration 130 exists

`excavation_plan` carries `loc_id`, a face number, and `face_desc`, whatever
the person filing typed that day. `loc_id` pointed at
`balcorpdb.mines_location_master` — **a table that exists and has never held
a row.** `minehub.location` cannot stand in either: its ids are a different
series (its 4 is PIT-EAST, the plan's 4 is Pit Bottom West), so joining the
two would silently mislabel every face.

So the only description of a face was the free text beside it, and across
4,151 rows **seventeen faces had collected a hundred and nine spellings**:

```
face 3   West ob - West ore&ob - West orer&ob - Wesdt ore&ob
         West olre&ob - West ore& ob - West(120-144Mrl) - 18 in all
face 8   North ob - North OB - Noth ob - Nort ob - Northside OB
```

Any report grouping by that name counted one face several times.

130 builds the list from the plan's own rows — name from the spelling the
mine used most, kind from whether the face ever yielded ore, overburden or
both, status from whether it was planned in the last 60 days — then adds the
foreign key. From here a plan **cannot** be filed against a face number that
is not on the list.

The historic `face_desc` text is left alone on every row. It is the record of
what was actually filed, and rewriting it would be editing the past to match
a list that did not exist when those rows were made. **1,521 of the 4,151
rows carry a name that differs from the master's**; the grid shows an amber
dot on those so the difference is visible rather than hidden.

---

## 5. The API

All under `/api/plan-entry`, in `backend/app/routers/plan_entry.py`.
`{kind}` is one of `despatch`, `cobp`, `excavation`.

| Endpoint | What it does |
|---|---|
| `GET /{kind}?month=YYYY-MM` | A month as filed: columns, headings, band groups, rows, `may_edit` |
| `PUT /{kind}` | File a month. Returns what was written and what changed |
| `DELETE /{kind}?day=YYYY-MM-DD` | Remove one filed day |
| `GET /{kind}/history?month=YYYY-MM` | Who changed what, from `plan_entry_hist` |
| `GET /faces/list` | The mining faces, with rows planned and last planned |
| `PUT /faces/save` | Add or correct one face |

### The one semantic worth knowing before you touch the save path

A PUT carries only the cells the screen sent. Inside `save_month`:

```python
for col in editable:
    if col not in raw:
        continue          # absent  -> keeps whatever is stored
    v = raw.get(col)
    if v is None or str(v).strip() == "":
        rec[col] = None   # explicit blank -> clears it
```

**Absent is not blank.** An earlier draft treated them the same and a partial
save wiped every column the screen had not sent — a stored `154.04` went to
NULL because the row was saved from a view that did not show that column.
Keep the distinction if you refactor this.

### Generated columns

`despatch_plan` has 9 totals and `cobp_plan` 5 that are `GENERATED ALWAYS AS
... STORED`. They are never written and never accepted from the client. Note
that a NULL input gives a NULL output — `chrome_recovery` is kept in its
unsimplified form on purpose so that a plant-shutdown day comes out NULL
rather than a meaningless 68.8%.

---

## 6. The frontend

| File | What it is |
|---|---|
| `components/sections/PlanEntrySection.tsx` | The grid — one component, three plans, driven by what the API returns |
| `components/sections/MineFacesSection.tsx` | The faces master |
| `components/layout/planNav.ts` | The four tabs, in one place |
| `components/layout/PlanTabBar.tsx` | The strip across the top |
| `hooks/usePlanEntry.ts` | Queries and mutations |

Wiring touches `MainLayout.tsx`, `AppSidebar.tsx`, `useAppPage.ts`,
`pageAccess.ts` and `backend/app/main.py` (router + permission rule).

**Excel paste** is the point of the grid. Click a cell, paste a block from
the sheet, and it fills down and across from there. It splits on tab and
newline only, and strips thousands separators from numeric columns only — so
a face name containing a comma survives.

Two layout things that are easy to undo by accident:

- The sticky header offset is **measured** with a `ResizeObserver`, not
  hard-coded. A fixed `top-[30px]` left a visible gap between the band row
  and the column row at some zoom levels.
- `position: sticky` has to be on the `<th>`, not the `<thead>`, and a
  sticky cell needs its own opaque background or the rows show through it.

---

## 7. Running it locally

```
backend   uvicorn app.main:app --port 8989        (no --reload, see CLAUDE.md)
frontend  npm run dev -- --port 3334
```

Point the backend at a development Postgres, not production. Credentials are
not in this repo and must not be put in it.

`--reload` does not reliably complete on Windows here: it logs the reload,
the new worker never finishes starting, and the old one keeps answering with
200s. Restart the process by hand after a backend edit and check that
`Application startup complete` appears after the restart.

---

## 8. What is not done — work forward from here

1. **Column order on the despatch plan has not been checked against the
   sheet PPIC actually uses.** The order came from the MySQL table. If it is
   wrong, somebody pastes a month into the wrong columns and the figures are
   silently wrong rather than visibly wrong. **Check this first, with PPIC,
   before anyone files a real month.**
2. **The permissions from 129 are not granted to any role.** Nobody can open
   the screens until that is done in Access Control.
3. **The excavation plan has no "add a row" flow.** You can correct and
   remove days; a brand-new day on a face has to come in by paste.
4. **The seeded face names need correcting by the mine.** They are the
   mine's own most-used spelling, which is the best a migration can do and is
   not the same as being right — "East ore&ob" describes what a face yielded
   rather than naming it.
5. **Two pairs of faces share a name** and were seeded with the number
   appended, because the filed rows gave them the same name:
   - **5** and **10** are both "South ob" — 5 yielded only overburden and
     stopped in March, 10 yielded ore as well and ran to May.
   - **11** and **13** are both "West ore".

   They are different places. The Faces screen carries a warning banner
   saying so. The mine has to say what each is actually called.
6. **MySQL is still being typed into.** Until PPIC and Geology move onto
   these screens, the Postgres copy and the MySQL original both exist and
   only one of them is read. Agree a cut-over date; after it, the MySQL
   tables should be made read-only rather than left to rot.

---

## 9. Rules this branch was written under

From `CLAUDE.md`, and worth re-reading before changing anything here:

- A new table ships with its migration, in the same branch.
- `SET lock_timeout = '5s'` before any migration. A queued ACCESS EXCLUSIVE
  lock blocks every reader behind it.
- A migration carrying its own `BEGIN; ... COMMIT;` cannot be rehearsed
  inside an outer transaction. 130 does not carry one; it is safe to
  rehearse.
- An endpoint with `response_model=` drops any field its schema does not
  name, silently. Verify through the response, not the service.
