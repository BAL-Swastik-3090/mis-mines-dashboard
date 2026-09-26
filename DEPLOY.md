# Deployment Manifest — Kaliapani Mines Dashboard

Track all modified/new files here before each server deployment.
Copy the files listed under the **Pending** section to the server, then move them to **Deployed**.

---

## How to deploy

```bash
# From your local machine, SCP each file to the server:
scp <local_path> <user>@<server>:<server_path>

# Then restart the backend:
sudo systemctl restart mines-backend
# or if using docker:
docker compose -f docker-compose.prod.yml restart backend
```

---

## Production — mines.balasorealloys.in

Since 2026-09-12 the dashboard runs as a docker compose project on the shared
application server. Host, user and credentials are held by IT and deliberately
kept out of this repo.

| Item | Value |
|---|---|
| Project dir | `<app-root>/mines_dashboard` on the application server |
| Frontend | `mines_frontend` — Next.js standalone, `127.0.0.1:4012` |
| Backend | `mines_backend` — FastAPI/gunicorn, `127.0.0.1:8006` |
| Cache | `mines_redis` (internal only) |
| Compose network | `mines_network`, subnet pinned to `10.230.1.0/24` |
| Domain | `mines.balasorealloys.in` → host nginx → 4012 (`/api/` → 8006) |
| TLS | shared wildcard `*.balasorealloys.in` (`/etc/ssl/certs/fullchain.crt`) |

**Two rules for this box — it hosts ~20 other BAL apps behind one host nginx:**

1. The repo's bundled `nginx` service publishes host **80/443** and would collide
   with the host nginx. `docker-compose.override.yml` puts it in the `disabled`
   profile — never run the stack without that override.
2. The compose network subnet is pinned. The default-assigned `192.168.16.0/20`
   could **not** reach the shared MySQL host on port 3306 (errno 110) even though the
   host itself could. `10.230.1.0/24` works.

```bash
# deploy an update
cd <app-root>/mines_dashboard
git archive --remote=... | tar -x      # or scp the changed files
docker compose build && docker compose up -d

# nginx vhost (needs sudo; file is staged in deploy/)
sudo install -m 644 -o root -g root deploy/mines.balasorealloys.in   /etc/nginx/sites-available/mines.balasorealloys.in
sudo ln -sfn /etc/nginx/sites-available/mines.balasorealloys.in   /etc/nginx/sites-enabled/mines.balasorealloys.in
sudo nginx -t && sudo systemctl reload nginx
```

`.env` lives in the project directory on the server (mode 600) and is never in git.

---

## Deployed — 2026-09-26 (second): end-to-end quality

Released commit `5550990` (branch `release-26-09-2026-b`) to
mines.balasorealloys.in. Backup: `~/mines_dashboard-backup-20260926-1600.tar.gz`.

**What changed**

- Swastik's end-to-end quality screen merged: one row per consignment, the
  mine's lab against Balasore's on moisture, Cr2O3, FeO and Cr/Fe. Replaces a
  workbook kept by hand since April 2025.
- It now leads with the consignments worth arguing about, ordered by how much
  ore is under the disagreement rather than by how far apart the labs are —
  single-truck tails were sitting above 800 MT consignments.
- Colour marks disagreement, not direction. Green-for-positive was wrong for
  moisture: a positive there means the mine was paid for water.
- The warning icon opens a reading of the period's own figures — which
  consignment matters most, how much contained chrome is in dispute, and
  whether the variances lean one way.
- The "What went out" card added to the previous-day panel was removed on
  request; that detail lives on the quality screen.

**Tolerances**, measured from 106 consignments July–September 2026, set near
the ninetieth percentile: moisture 0.60, Cr2O3 0.60, FeO 0.55, Cr/Fe 0.05. A
starting point from this mine's history, not a standard — on screen and
editable so the lab can confirm them.

**No database change.** The quality screen is read-only against SAP tables in
balcorpdb.

Verified inside the container, against the workbook the feature replaces:

```
quality   37 consignments, 1305 trips, 15,384.64 MT
workbook  1-22 Sept: 30 rows, 1167 trips, 13,737.30 MT  -> matches
capacity  25 Sept: 8 faces, effective 3935.04 Cum/day
```

The deletion check ran and came back empty.

### WHAT THE SCREEN FOUND ON ITS FIRST DAY

Of 33 consignments the plant has assayed this month, it read LOWER on Cr2O3 on
25 and higher on 8. Three quarters one way is not sampling noise; it is a
calibration question for the two labs. Nobody could see that from a table of
variances, which is the argument for the summary existing at all.

---

## Deployed — 2026-09-26: capacity, and the mines stock entry screen

Released commit `f7928b3` (branch `release-26-09-2026`) to mines.balasorealloys.in.
Backup: `~/mines_dashboard-backup-20260926-1030.tar.gz`.

**What changed**

- **Capacity**, a new screen between Equipment 360 and Manpower. It replaces
  the planning office's productivity workbook — reproducing its arithmetic
  exactly, row for row — and answers the question the workbook's own totals
  hide: not "is there a tipper shortage" but "which faces are short and which
  have trucks standing spare".
- Eight of the plan's nine excavators are mapped to the register under
  `asset_identity` system `BUSINESS_PLAN`. 370-5 is deliberately unmapped.
- A face is now a real place, a named job and a known material, from the
  location and material masters the gate and the weighbridge already use.
- Every change to the plan is recorded with what it said before.
- Swastik's mines stock entry screen, merged.

**No database change on this box.** Migrations 065 and 066 are Postgres, and
that Postgres is shared between dev and production, so they were already
applied when the work was done. `mines_stock_entry` in balcorpdb was created by
Swastik on 25-09 and already held 541 rows.

**The deletion check caught one.** `frontend/src/contexts/usePrevDayEntry.ts`
was replaced by `useEntryDialog.ts` in the merge, and the old file was still on
the server. Removed before building, per the standing step.

Verified inside the container rather than at the door — a 401 says an endpoint
is wired and nothing about whether the model behind it still computes after a
merge:

```
choices    27 places, 8 jobs, 16 materials
plan       2026-09-25: 8 faces, effective 3935.04 Cum/day
           2026-09-26: 0 faces  (no plan built for today yet — per-day by design)
unmapped   ['370-5']  — suggested as EX-5, not taken
stock      2026-09-25: 25 cells   2026-09-24: 25 cells
```

### THE STOCK TABLE HAS NO DDL IN THIS REPOSITORY

`scripts/sql/` stops at `004_mines_prev_day_actual.sql`. `mines_stock_entry`
exists in balcorpdb, is written to by `backend/app/routers/stock_entry.py`, and
nothing in git describes it — so a fresh environment cannot be built from the
repository. Ask for the `005_` file, or write it from the live schema. The same
would have been true of `mines_prev_day_actual` if its file had not been
committed with the branch.

---

## Deployed — 2026-09-25 (third): off the rolls, said out loud

Released commit `70052cd` (branch `release-25-09-2026`) to mines.balasorealloys.in.
Backup: `~/mines_dashboard-backup-20260925-1300.tar.gz`.

**What changed**

- The Manpower bar says "7 off the rolls", and saying it is the button. A
  filter is somewhere you look when you already know what you want; nobody
  opens one to find out whether anything is behind it.
- `/operators/summary` takes the same `standing` and every count in it follows
  the population being shown. The tiles counted the whole table, so with the
  register at 204 they still described 211 — and "Awaiting approval" could be
  answered by approving the paperwork of somebody who retired in February.
- The crew of a machine, on "Who runs what" and in its export, now excludes
  anybody off the rolls. No assignment is held by one of the seven today, so
  nothing changed on screen, but an assignment left open when a man retires
  would have kept him named on the tipper.

**Audited all 39 queries that list people.** The pickers were already sound —
the roster, the shift board's deploy list, the assessment panel and the "who
can run what" candidates all filter on ACTIVE. The queries that do not filter
read a record back (a shift plan, a HOTO, a completed trip) and are right to
name whoever was on it; history does not change when somebody retires.

Verified inside the production container:
`ON_ROLL 204 · OFF_ROLL 7 · ALL 211`, and the new bundle is the one served.

### A STALE BUNDLE LOOKS LIKE A MISSING FEATURE

After the previous release the standing control appeared to be absent from the
bar, while the count beside it had correctly changed from 211 to 204. Both
facts were true at once because the filter is in the BACKEND: a browser still
running yesterday's JavaScript sends no `standing`, gets the default, and
displays the new number through the old UI.

So when a change is half-visible after a deploy, check whether the visible half
comes from the API before looking for a bug. A hard reload settles it.

---

## Deployed — 2026-09-25 (second): the register is who works here

Released commit `539895c` (branch `release-25-09-2026`) to mines.balasorealloys.in.
Backup: `~/mines_dashboard-backup-20260925-1140.tar.gz`.

**What changed**

- Seven people who came off the rolls between January and June are recorded
  with the date they left and why — four RETIRED, three DECEASED. They had all
  been marked INACTIVE with employment_end 2026-09-23, the day somebody marked
  them rather than the day they left.
- `/api/operators` takes a `standing`, defaulting to `ON_ROLL`. The register
  reads 204 on strength instead of 211. "Off the rolls" and "Everybody ever"
  are in the Manpower bar; nobody is deleted.
- DECEASED exists in the profile-status picker, so those three profiles do not
  render the field blank and lose their status on the next save.

**No duplicates were removed, because there are none.** Khageswar Mohanta is on
three rows and Narayan Mohanta on two, and all five are different men —
different fathers, dates of birth, phones, PANs, Aadhaars and employee codes.
Swept by shared identifier instead of by name: every identifier in the register
belongs to exactly one person.

**The data change was already live before the deploy.** That Postgres is shared
between dev and production, so writing the statuses locally wrote them in
production. Only the two UI changes needed shipping.

Verified inside the production container after the deploy:
`ON_ROLL 204 · OFF_ROLL 7 · ALL 211`.

The deletion check from the previous entry was run and came back empty — this
release deletes nothing, so no files needed removing on the server.

---

## Deployed — 2026-09-25: Weather page, previous-day actuals, and a searchable dropdown

Released commit `df85d26` (branch `release-25-09-2026`) to mines.balasorealloys.in.
Backup: `~/mines_dashboard-backup-20260925-0951.tar.gz`.

**What changed**

- Swastik's `Weather-and-Est-Actual-25-09-2026` merged in: Windy on its own
  page open to anyone signed in, previous-day plan against a hand-entered
  actual, the AI insights panel streamed so no timeout can fail it, and a tab
  bar on Intelligence.
- `SearchSelect` — a dropdown you type into, replacing the native select in
  26 places where the list is long (operators, machines, bridges, plants,
  grades, machine classes). Not the fixed lists.
- The previous-day panel follows the header's date, shows that date where it
  can be read, and gained a "Both Days" view that sets an estimate against
  what SAP eventually posted.

**No database change.** `scripts/sql/004_mines_prev_day_actual.sql` creates
`mines_prev_day_actual` in balcorpdb — it already existed, created
2026-09-24 15:51. Nothing was run against the shared database.

### THE DEPLOY METHOD DOES NOT DELETE FILES — READ THIS BEFORE THE NEXT RELEASE

The first build failed:

```
./src/hooks/useWeather.ts:3:26
Type error: Module '"@/lib/weatherConfig"' has no exported member 'WEATHER_API_URL'.
```

The same tree built cleanly twice locally. The cause is the deploy method
itself: `git archive | tar -x` over the existing project directory **adds and
overwrites, and never removes**. This release DELETED three files, and all
three were still sitting on the server from the previous release, being
compiled against a `weatherConfig` that no longer exports what they import:

```
frontend/src/components/sections/HourlyForecastStrip.tsx
frontend/src/components/sections/WeatherSection.tsx
frontend/src/hooks/useWeather.ts
```

Removed by hand, then the build passed. **Before every deployment, list what
the release deletes and remove those files on the server:**

```bash
# locally — <deployed> is the commit named in the previous DEPLOY.md entry
git diff --diff-filter=D --name-only <deployed> <releasing>

# on the server, after extracting
cd ~/mines_dashboard && rm -f <each path above>
```

A rename is a delete plus an add, so a renamed file leaves its old name behind
too — and the old name usually still compiles, which is worse than this case:
it builds, ships, and nothing tells you the dead copy is there.

---

## Deployed — 2026-09-24: Search that matches how people type, and a gate that can undo

Released commit `67e5457` to mines.balasorealloys.in, by the usual method.
Three releases went out today; this note covers all of them.

Backups: `~/mines_dashboard-backup-20260924-0913.tar.gz`, `-0935`, `-0957`.

**What changed**

1. `4908951` — the server registers match on a normalised form: separators and
   case come off both sides, words are matched independently, and results are
   ranked rather than alphabetical. "man19" finds MAN-19; it found nothing
   before. Done in the query, not the schema — a few hundred vehicles need no
   index, and the shared production schema stays untouched.
2. `82b3558` — the same for the sixteen lists filtered in the browser, through
   one matcher in `frontend/src/lib/search.ts`. Named `matchesSearch`, because
   `ColumnFilter` already exports a `matches()` and shadowing it silently
   changed which function six panels were calling.
3. `788cafd` — sixteen search boxes had sixteen widths, from 150px to 340px.
   All now use one responsive width.
4. `3ab8683` — the gate can remove an admission that recorded nothing. A pass
   with trips against it is the record and is signed out instead.
5. `67e5457` — the operator register searches mobile, department, group, plant,
   biometric id and blood group, not just name and reference. 203 of the 211
   have a mobile.

**No new dependencies, no configuration change, no migration.** Nothing was
added to requirements, `.env` was not touched, and no SQL shipped with any of
these: the normalisation is done in the query and the one new backend column
(`trips_total`) is computed, not stored.

Verified after release: `/api/health` ok, `DELETE /api/weighbridge/gate/{pass_id}`
present in the OpenAPI schema, frontend 200, no errors in the backend log, and
only `mines_backend` and `mines_frontend` recreated — the other 74 containers on
the box kept their uptime and the host nginx was not reloaded.

**Two data changes made directly, both on records that had recorded nothing.**
Two weighbridge agent registrations ("Mine WB3", "Weight Bridge3" — 0 readings,
never seen) and one gate pass (`GP-20260922-0001` — 0 trips) were removed. Each
deletion was guarded in its `WHERE` clause rather than by a prior check, so a
row that had started recording in the meantime would have been kept.

---

## Deployed — 2026-09-23: Weighbridge, gate, organisation, custom fields

Released commit `0bb405e` to mines.balasorealloys.in by the usual method:
`git archive` of HEAD extracted over `~/mines_dashboard` with `.env` set aside
and restored at 600, then `docker compose build && docker compose up -d` on the
default `docker-compose.yml` + `docker-compose.override.yml` pair.

Backup taken first: `~/mines_dashboard-backup-20260923-1650.tar.gz`.

**No new dependencies and no configuration change.** The new routers import only
the standard library and what the image already had, so nothing was added to
requirements and `.env` was not touched.

**No migration step.** 053-063 were already applied: dev and production share
one PostgreSQL schema (`minehub` on the platform database), so the schema was in
place before the code that uses it. Every migration in this release is additive —
new tables and new nullable columns — so the previously running code was never
looking at a schema it did not understand.

Verified after release: `/api/health` ok, 41 new routes present in the OpenAPI
schema, frontend 200, and only `mines_backend` and `mines_frontend` restarted —
the other ~75 containers on the box kept their uptime and the host nginx was not
reloaded.

**The weighbridge agent now reports here.** During development the agent on the
weighbridge PC (WB3, 192.168.16.217) posted to a laptop. It now posts to
`https://mines.balasorealloys.in`, confirmed by reading posts arriving 200 in the
backend log. Its token did not change and did not need to: the token is hashed
into `weighbridge_agent` on the shared database, which production reads.

The agent's default `-Server` in `weighbridge-agent/install.ps1` was an IP and
port. That would not have worked from anywhere: the backend listens on
`127.0.0.1:8006` and is only reachable through the host nginx. It is now the
domain, which is also where DEPLOY.md says server addresses should not be — in
the repo.

**WeighStar starts with the machine.** Separately from this release, the
weighbridge PC no longer needs anyone to double-click a desktop shortcut for the
indicator to be read at all. See
`files/Weighbridge_Tamper_Resistance_Design_23-09-2026.md`.

---

## Deployed — 2026-09-20 (2): Workforce activity from the gate readers

Released commit `63a950e` (6 commits on `3c559f0`) to
mines.balasorealloys.in. Same method as earlier today: `git archive` of HEAD
extracted over `~/mines_dashboard` with `.env` set aside and restored at 600,
then `docker compose build && docker compose up -d` on the default
`docker-compose.yml` + `docker-compose.override.yml` pair.

No new dependencies, nothing deleted between the two releases.

**One configuration change, which this release needed.** The server `.env`
carried no `FRS_*` block, so the Activity tab would have loaded and then said
the platform had not been told where the readers write — the feature would
have looked broken on arrival. Checked first that the server could reach the
reader database on 80.9.2.75:1433, which it can, then appended the block
(mode 600, previous file kept as `~/.env.bak-<timestamp>`). `pymssql` 2.4.1
was already in the image, so nothing else was needed.

Verified after:

| Check | Result |
|---|---|
| Site | 200 in 1.4s |
| Route table inside the container | `/api/attendance/register`, `/api/attendance/punches`, `/api/checklists`, `/api/operators/analytics` all present; 165 routes |
| Readers, through the live code | configured, 211 of 211 workers matchable, 19 Sep reads 164 complete / 4 in-only / 4 out-only / 39 not clocked |
| A real row | 17004 Akshaya Kumar Dehury 05:15 → 12:51 at `SUKINDA MINES_CON_CLL_IN_1` |
| Containers on the box | 77 before, 77 after; only `mines_backend` and `mines_frontend` changed id |
| Host 80/443 | still nobody |
| Our ports | `127.0.0.1:4012`, `127.0.0.1:8006` |

Previous tree at `~/mines_dashboard-backup-20260920-1955.tar.gz`.

The Activity screen stores nothing: every row is read from SmartFace as the
table is drawn and joined to the manpower register in memory. There is no
migration in this release and nothing to reverse.

---

## Deployed — 2026-09-20: Manpower, assessment, and one date format

Released `minehub-workforce-release` (commit `3c559f0`, 17 commits on
`b4cc297`) to mines.balasorealloys.in. Full record in
`docs/specs/MineHub_Release_20-Sep-2026.md`.

**Code only.** Migrations 038–042 and the CLL manpower load had already been
applied through the tunnel to the corporate Postgres, which is the same
database production reads — so there was no migration step on the server and no
window in which schema and code disagreed. It also meant production had been
serving the 211 new operators through the old UI since the load.

Method: `git archive` of HEAD, extracted over `~/mines_dashboard` with `.env`
copied aside and restored at mode 600, then `docker compose build && docker
compose up -d`. The default `docker-compose.yml` + `docker-compose.override.yml`
pair — confirmed from the running containers' own labels before touching
anything, because the `prod` file does not auto-load the override.

Nothing was deleted between `b4cc297` and this release, so extracting over the
tree left no stale files. (Two files were created and removed inside the range;
relative to what was live they never existed.)

**No new dependencies**, which is the failure mode of the previous release.

Verified after:

| Check | Result |
|---|---|
| Site | 200 |
| Route table inside the container | `/api/checklists` and `/api/operators/analytics` present, `/api/minehub/assets/import` gone, analytics ordered before `/{operator_id}` |
| Data through the live code | 211 on strength, 143 operators, 143 unassessed, 37 trades, 15 competency dimensions, 10 handover checks |
| Containers on the box | 77 before, 77 after; only `mines_backend` and `mines_frontend` changed id |
| Host 80/443 | still nobody — host nginx owns them |
| Our ports | `127.0.0.1:4012` and `127.0.0.1:8006` |
| Running images | both match the images built in this deploy |

Previous tree backed up to `~/mines_dashboard-backup-20260920-1752.tar.gz`.

Four containers belonging to other applications report unhealthy —
`pems-frontend`, `scm_quotation_agent-celery-worker-1`,
`scm_quotation_agent-frontend-1`, `scm-chatbotv3-api`. Their uptimes run from
15 hours to 7 weeks and their container ids did not change, so this predates
the deployment and was not caused by it. Raised here for whoever owns them.

Checking HTTP status alone would not have proved the new routes exist: the
auth rule answers 401 before routing, so a missing route and a gated one look
identical from outside. The route table was read from inside the container
instead.

---

## Deployed — 2026-09-19: MineHub workforce, notes, Superadmin rename

Released `minehub-workforce-release` (commit `776dd6d`) to mines.balasorealloys.in.

Method: `git archive` of the release tag, extracted over `~/mines_dashboard`,
then `docker compose build && docker compose up -d` from that directory. The
default `docker-compose.yml` + `docker-compose.override.yml` pair, which is what
the running stack was already using — confirmed from the container labels before
touching anything, because the `prod` file does **not** auto-load the override
and the bundled nginx would have taken host 80/443 from every other app.

Verified after: site 200; the workforce, notes and ops routes answering; all 70
other containers on the box holding the same ids, none restarted; nothing
publishing 80/443. Previous state backed up to
`~/mines_dashboard-backup-<timestamp>.tar.gz` on the server.

New in the image: `openpyxl` 3.1.5, for the roster import and export.

### Resolved same day — MineHub is now live on production

The Postgres block was added to the server `.env` (mode 600, previous file kept
as `.env.bak-<timestamp>`). Production points at the shared corporate database,
`corpappdb`, schema `minehub` — the same database that holds `pems` and
`cimcon`, one schema per application, which is the standing convention.

Pointing it there exposed a latent bug: **`psycopg` was never pinned in
`requirements.txt`**. Nothing had failed for a fortnight because SQLAlchemy only
imports the driver when an engine is actually created, and the platform database
was unconfigured on the server, so no engine ever was. The moment production was
pointed at Postgres the backend stopped booting. Pinned now, along with the
binary wheel so the image needs no build toolchain. Roughly four minutes of API
downtime between the two restarts.

Confirmed from inside the production container: connected to `corpappdb` at
192.168.10.27:5432, schema `minehub`, 60 tables, 10 roles, 30 users. The
workforce, notes, registry and operator routes all answer.

**Dev and production share one schema.** A migration applied while building is
applied to live data, and a purge run locally empties the live register. That is
the convention working as intended, but it is worth knowing before the next
local experiment.

### ⚠ Known gap, not urgent

`schema_migration` records only 8 entries although 31 migrations exist and all
60 tables are present. Migrations applied through `apply_migration.py` are not
all being recorded there, so the table under-reports what has run. Harmless
today — the schema is correct — but it means the migration log cannot be trusted
to answer "what has been applied", and that should be reconciled before anybody
relies on it.

For reference, the block that was added:

```
PG_HOST=192.168.10.27
PG_PORT=5432
PG_DATABASE=corpappdb
PG_USER=postgres
PG_PASSWORD=<held by IT, not in this repo>
PG_SCHEMA=minehub
PG_SSLMODE=prefer
```

Then `docker compose up -d backend` to pick it up.

**A decision goes with it:** those settings point at the same database the
development machine uses. One schema shared between dev and production means a
migration applied while building is a migration applied to live data, and a
purge run locally empties the production register. If the two should be
separate, production needs its own database or its own schema, and migrations
001–031 run against it once.

---

## 🟡 Pending Deployment

### Session: 2026-09-12 — Access Control screen (super admin)

| # | Local File | Type |
|---|-----------|------|
| 1 | `scripts/sql/002_mines_role_page_access.sql` | **New** — run once |
| 2 | `backend/app/services/auth.py` | Modified — page-access map + cache |
| 3 | `backend/app/routers/roles.py` | Modified — `/roles/pages` GET+PUT |
| 4 | `backend/app/main.py` | Modified — page gate in middleware |
| 5 | `frontend/src/components/sections/AccessControlSection.tsx` | **New** |
| 6 | `frontend/src/components/layout/AppSidebar.tsx` | Modified — admin entry, filtered nav |
| 7 | `frontend/src/components/layout/MainLayout.tsx` | Modified |
| 8 | `frontend/src/components/layout/AuthWrapper.tsx` | Modified — revoked-page guard |
| 9 | `frontend/src/contexts/useAppPage.ts`, `useAuth.ts` | Modified |

**What it does:** an in-app screen, visible only to `admin`, managing (a) who has
which role and (b) a role x page matrix. Enforced on the API prefixes behind each
page — `PREFIX_PAGE` in `services/auth.py` — so unticking a box blocks the data,
not just the sidebar entry.

**Lockout guards:** Access Control is not in the matrix (gated on the admin role
itself); a save that leaves admin with no pages is rejected; you cannot strip
your own role; and a missing/empty table falls back to allow-everything.

**Caching:** the matrix is held in-process for 60s (a page load fires ~15 API
calls and the MySQL server refuses connections daily). Saving invalidates it, so
changes apply immediately.

**Gotcha for anyone extending this:** `sap_employee_details.STATUS` is
`'Active'`/`'Withdrawn'`. It is NOT the `'A'` flag used by `intranet_user_login`.
Filtering it on `'A'` matches zero of 1300 rows.

Deploy: run `002_mines_role_page_access.sql`, then rebuild both images.

---

### Session: 2026-09-12 — Intranet SSO login + access control

| # | Local File | Type |
|---|-----------|------|
| 1 | `backend/app/services/auth.py` | **New** |
| 2 | `backend/app/routers/auth.py` | Rewritten |
| 3 | `backend/app/routers/roles.py` | **New** |
| 4 | `backend/app/main.py` | Modified — auth middleware |
| 5 | `frontend/src/contexts/useAuth.ts` | **New** |
| 6 | `frontend/src/components/layout/AuthWrapper.tsx` | Modified |
| 7 | `frontend/src/components/layout/LoginScreen.tsx` | Modified |
| 8 | `frontend/src/components/layout/AppSidebar.tsx` | Modified |
| 9 | `scripts/sql/001_mines_user_role.sql` | **New** — run once before deploying |

**Why:** the previous login was cosmetic. `/auth/login` returned
`mock-session-token-<EMPID>` and the UI gated on that string being present in
localStorage, so anyone could grant themselves access from the browser console —
and every `/api/*` route was unauthenticated regardless, serving production and
despatch data to any unauthenticated caller.

**What changed:**
- Real server-side sessions in `digital_apps_user_sessions` (`app_source='MINES'`),
  keyed by a 64-hex `secrets.token_hex` id in an **httpOnly** cookie. Nothing is
  stored client-side; the UI asks `/api/auth/me` who it is talking to.
- Middleware in `main.py` gates every `/api/*` route except `/api/auth/*`,
  `/api/health` and the docs. New routers are protected by default.
- Page views recorded to `digital_apps_page_views` on every page switch.
- Access roles (`viewer`/`manager`/`admin`) in the new `mines_user_role` table.
  Everyone signing in is a viewer; only `/api/roles` requires admin today. Page
  restrictions are a one-line addition to `_ROLE_RULES` in `main.py`.
- Session-touch throttled to 30s — one page load fires ~15 API calls and the
  MySQL server is already refusing connections daily.

**Deploy order matters:**
1. Run `scripts/sql/001_mines_user_role.sql` (edit the seed EMPID first).
2. Backend restart + frontend rebuild — both required.

No new pip or npm packages.

---

### Session: 2026-09-12 — Intelligence Page (Reality Check + AI Insights)

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `frontend/src/contexts/useAppPage.ts` | `/opt/mines_dashboard/frontend/src/contexts/useAppPage.ts` | Modified |
| 2 | `frontend/src/components/layout/AppSidebar.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/AppSidebar.tsx` | Modified |
| 3 | `frontend/src/components/layout/MainLayout.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/MainLayout.tsx` | Modified |
| 4 | `frontend/src/components/layout/SectionTabBar.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/SectionTabBar.tsx` | Modified |
| 5 | `frontend/src/app/page.tsx` | `/opt/mines_dashboard/frontend/src/app/page.tsx` | Modified |
| 6 | `frontend/src/components/sections/IntelligenceSection.tsx` | `/opt/mines_dashboard/frontend/src/components/sections/IntelligenceSection.tsx` | **New** |

**What changed:**
- New **"Intelligence"** sidebar page (Sparkles icon, placed after OEE / LCM) that hosts **Reality Check** + **AI Insights**
- Reality Check & AI Insights **removed from the MIS dashboard** (page.tsx scroll sections + SectionTabBar top-tabs) — MIS now ends at Dewatering
- New `IntelligenceSection` page: navy+gold banner + `RealityCheckSection` + `InsightsSection` (both keep their own titled cards)
- **Frontend-only** change — **frontend rebuild required** (`npm run build`)
- No backend changes; no new npm packages; no DB migrations
- Verified: local `next build` passes; `tsc --noEmit` clean

---

### Session: 2026-06-29 — Fuel Management System

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `backend/app/services/fuel_management.py` | `/opt/mines_dashboard/backend/app/services/fuel_management.py` | **New** |
| 2 | `backend/app/routers/fuel_management.py` | `/opt/mines_dashboard/backend/app/routers/fuel_management.py` | **New** |
| 3 | `backend/app/main.py` | `/opt/mines_dashboard/backend/app/main.py` | Modified |
| 4 | `frontend/src/types/index.ts` | `/opt/mines_dashboard/frontend/src/types/index.ts` | Modified |
| 5 | `frontend/src/hooks/useFuelManagement.ts` | `/opt/mines_dashboard/frontend/src/hooks/useFuelManagement.ts` | **New** |
| 6 | `frontend/src/components/sections/FuelManagementSection.tsx` | `/opt/mines_dashboard/frontend/src/components/sections/FuelManagementSection.tsx` | Modified |

**What changed:**
- New `/api/fuel-management` endpoint returning today's + yesterday's fleet fuel data + 7-day trend
- Queries both Technoton tables (`mines_technoton_man_utilization` + `mines_technoton_rest_equipment_utilization`) using same `MAX(row_id)` pattern as live tracking
- Full dark-themed Fuel Management dashboard replacing the placeholder
- KPI strip: Total Fleet, Avg Fuel Level, Total Fuel in Tanks, Consumed Today (vs yesterday), Refills Today
- Fuel level distribution donut chart (5 bands: >75%, 50–75%, 20–50%, <20%, No Data)
- Fleet aggregate tank animation using `drawTank()` (same canvas renderer as Live Tracking)
- Alert panel: low fuel vehicles (<20%) + refill event summary
- Vehicle status table with search, inline fuel bars, status badges, est. hours remaining
- 7-day daily consumption trend (area chart via ECharts)
- Top 5 fuel consuming vehicles today (ranked with horizontal bars)
- Backend restart required; frontend rebuild required
- No new pip packages; no DB migrations

---

### Session: 2026-06-29 — Sidebar Restructure + Export HTML

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `frontend/src/contexts/useAppPage.ts` | `/opt/mines_dashboard/frontend/src/contexts/useAppPage.ts` | **New** |
| 2 | `frontend/src/components/layout/AppSidebar.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/AppSidebar.tsx` | **New** |
| 3 | `frontend/src/components/layout/SectionTabBar.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/SectionTabBar.tsx` | **New** |
| 4 | `frontend/src/components/sections/FuelManagementSection.tsx` | `/opt/mines_dashboard/frontend/src/components/sections/FuelManagementSection.tsx` | **New** |
| 5 | `frontend/src/utils/downloadDashboard.ts` | `/opt/mines_dashboard/frontend/src/utils/downloadDashboard.ts` | **New** |
| 6 | `frontend/src/components/layout/MainLayout.tsx` | `/opt/mines_dashboard/frontend/src/components/layout/MainLayout.tsx` | Modified |
| 7 | `frontend/src/app/page.tsx` | `/opt/mines_dashboard/frontend/src/app/page.tsx` | Modified |
| 8 | `frontend/src/hooks/useSectionObserver.ts` | `/opt/mines_dashboard/frontend/src/hooks/useSectionObserver.ts` | Modified |

**What changed:**
- New vertical AppSidebar (MIS Dashboard / Live Tracking / Fuel Management page switcher)
- Old vertical sidebar replaced by horizontal SectionTabBar with scroll-spy + Export HTML button
- LiveTrackingSection moved out of page.tsx — now rendered directly by MainLayout on page switch
- FuelManagementSection added as a placeholder page
- Export HTML button downloads the full MIS Dashboard as a self-contained .html file (inline CSS, canvas snapshots, date range in header)
- No backend changes; frontend rebuild required (`npm run build`)
- No DB migrations; no new packages

---

### Session: 2026-06-29 — Tank PNG Overlay Revert

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `frontend/src/utils/tankRenderer.ts` | `/opt/mines_dashboard/frontend/src/utils/tankRenderer.ts` | Modified |
| 2 | `frontend/src/components/live/VehicleKpiCard.tsx` | `/opt/mines_dashboard/frontend/src/components/live/VehicleKpiCard.tsx` | Modified |
| 3 | `frontend/src/components/live/VehicleModal.tsx` | `/opt/mines_dashboard/frontend/src/components/live/VehicleModal.tsx` | Modified |
| 4 | `frontend/src/app/globals.css` | `/opt/mines_dashboard/frontend/src/app/globals.css` | Modified |
| 5 | ~~`frontend/public/tank-frame.png`~~ | ~~`/opt/mines_dashboard/frontend/public/tank-frame.png`~~ | **Deleted** |

**What changed:**
- Reverted all PNG overlay code — back to pure-canvas `drawTank()` renderer
- Removed `drawLiquid()` function and `_frame` PNG singleton from tankRenderer.ts
- VehicleKpiCard and VehicleModal both restored to single `<canvas>` with `drawTank()`
- `.tank-canvas` CSS class removed; `.vc-tank` and `.modal-tank-canvas` reverted
- `tank-frame.png` deleted from public/ — also delete from server's public folder
- No backend changes; frontend rebuild required

---

### Session: 2026-06-26 — AI Insights (6 Enhancements)

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `backend/app/services/insights.py` | `/opt/mines_dashboard/backend/app/services/insights.py` | Modified |
| 2 | `backend/app/schemas/insights.py` | `/opt/mines_dashboard/backend/app/schemas/insights.py` | Modified |
| 3 | `backend/app/routers/insights.py` | `/opt/mines_dashboard/backend/app/routers/insights.py` | Modified |
| 4 | `backend/app/main.py` | `/opt/mines_dashboard/backend/app/main.py` | Modified |
| 5 | `frontend/src/types/index.ts` | `/opt/mines_dashboard/frontend/src/types/index.ts` | Modified |
| 6 | `frontend/src/components/sections/InsightsSection.tsx` | `/opt/mines_dashboard/frontend/src/components/sections/InsightsSection.tsx` | Modified |

**What changed:**
- Backend restart required (new asyncio 7AM digest scheduler in main.py)
- Frontend rebuild required (`npx next build` or `npm run build`)
- No DB migrations needed
- No new pip packages needed (all deps already in requirements.txt)

---

### Session: 2026-06-26 — Despatch Logic (CUSTOMERNO-based BAL/SUK split)

| # | Local File | Server Path | Type |
|---|-----------|-------------|------|
| 1 | `backend/app/services/despatch.py` | `/opt/mines_dashboard/backend/app/services/despatch.py` | Modified |
| 2 | `backend/app/services/insights.py` | `/opt/mines_dashboard/backend/app/services/insights.py` | Modified |
| 3 | `frontend/src/components/kpi/ProductionKpiStrip.tsx` | `/opt/mines_dashboard/frontend/src/components/kpi/ProductionKpiStrip.tsx` | Modified |

**What changed:**
- Despatch actuals now read from `zsd_outbound_despatch.CUSTOMERNO` (BAL / JABAMOYEE)
- Removed all unsynced logic (table refreshes every 15 min)
- Backend restart required; frontend rebuild required

> ⚠️ Note: `insights.py` from the 2026-06-26 AI Insights session supersedes this version — deploy the AI Insights version of `insights.py` only.

---

## ✅ Deployed

_(Move entries here after successful server deployment, with the deployment date.)_

---

## Notes

- Server root is assumed to be `/opt/mines_dashboard/` — adjust if different
- Always restart backend after any `.py` file change
- Always rebuild frontend after any `.tsx` / `.ts` file change
- `.env` file is NEVER deployed via this manifest — manage credentials separately on the server
