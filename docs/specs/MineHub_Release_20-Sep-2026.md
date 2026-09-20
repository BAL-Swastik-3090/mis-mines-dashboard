# MineHub — release record, 20 September 2026

Sixteen commits, none of them yet on the server. Production is on
**`b4cc297`** (released 19 September); local `minehub-workforce-release` is on
**`0f31804`**.

This document is in two halves: what changed and how to check it, then the
production move.

---

# Part one — what changed

## 1. Access control

Two holes, both closed.

**A user with no dashboards was shown every dashboard** (`93ae869`). The
frontend read an empty `allowed_pages` as "no restriction" instead of "nothing
allowed". The API refused the data correctly the whole time, so tabs appeared
and then filled with errors — the platform looked broken rather than closed.

**Browsing the machine register was the same right as reading the machine
vocabulary** (`93c3aef`, migration 038). An operator registrar needs to read
asset types to assess somebody on "Excavator"; she does not need the
130-machine register. Collapsing the two meant every people-role had to be
given the register to do its own job, and a permission granted to everybody
protects nothing. Browsing has its own permission now. Nothing was revoked.

**A page nobody can land on is a page nobody has** (`b89738d`). Splitting
Manpower out meant adding it in two places; I added one. `canOpen` said yes so
the sidebar drew the tab, `openablePages` returned `[]` so the app told an
operator registrar she had access to nothing — beside a menu containing the one
screen she had permission for. Checked against her real row: before `[]`, after
`['manpower']`. The ordering is now a `Record` keyed by `AppPage`, so
TypeScript refuses to compile until a new page has a landing position.

## 2. Equipment register

**Every machine has a number** (`0175c1d`, migration 039). 129 of 130 had no
`asset_ref`: the endpoint generated one, the spreadsheet import inserted rows
directly. Fixed at the column with a default, not at the endpoint, because the
next importer would forget in the same way.

**Two machines were wrongly off road.** The import matched "off road" anywhere
in a status column. `"To be done Off Road"` is a plan; `"Off Road/ Running
B/D"` is the workshop. Both were filed as OFF_ROAD, and the default view hides
off-road machines — so MAN-12 and MAN-14 had vanished from the list the entry
operator was looking at. A wrong status that also hides the row is worse than a
wrong status, because nobody can go and correct it.

**The sheet stopped stating facts it had not read** (`133fbf0`). Opening MAN-14
rendered "Machine", "v1", "0 of 14 filled" for two seconds. I checked whether
the delay could be removed instead: four queries, all indexed, record and
revision trail already parallel. What is left is the VPN round trip.

**The screen spends its space on machines** (`3d67305`, `e0689d5`). Five tiles
in a four-column grid became one band of six. The 130-vs-123 gap is explained
by a RETIRED figure. **Sorting, which did not exist at all**, on every column,
in the same heading menu as that column's filter. Grouping by category, type,
stage, owner, make, propulsion or approval. A card view. Three filters that did
not exist — category, fuel, and approval, the last being how you find the 129
rows still in draft.

**Three bugs the mine found, and the class behind them** (`a97a470`):
duplicated "changed by" line; `owner ?? "Hired"` telling you nothing; and the
Owner filter listing 17 rows out of 123 because it was built from a column that
is null on every machine BAL owns. The third was a class — `optionsFrom`
dropped every blank, so machines with no make, type or fuel were unreachable
from their own column and each menu's counts failed to sum to the table.

**Selection and export.** Shift-click, select-all, export-selected. CSV with a
UTF-8 BOM (or Excel guesses Windows-1252), CRLF, and a tab before any value
starting with `= + - @` because Excel executes those — a machine nicknamed
`-350` is not a formula. 15 parser cases and a round trip tested.

**Import was built and then removed** at the mine's decision. Dialog, endpoint
and reader all deleted rather than left switched off. One revert away in
`a97a470`.

**"Changed" says how long ago** (`a22c2c1`): *just now → 12 min ago → 3 hours
ago → yesterday → 5 days ago → 3 weeks ago → 22-07-2026*, exact timestamp on
the tooltip. Extracted to `when.ts` and tested at the boundaries with `now`
injected — 19 cases. **Names, not payroll numbers**: 3101 reads AKASH ., 2917
reads BULBUL BEHERA, IMPORT keeps its id because it is not a person.

## 3. Manpower — CLL's 211 workmen

**The spreadsheet was a copy of something BAL already had** (`277b5af`). It is
a dump of `hr_med_contractor_master`, where CLL is contractor **1100223** at
plant **1200** and 209 of the 211 already sat, with date of birth, date of
joining, department and status.

| | Sheet vs contractor master |
|---|---|
| Names | agree **209 of 209** |
| Designations | agree **207 of 209** |
| DOB / DOJ / department | complete for all 209 |

I had first read `sap_employee_details` and reported 129 name conflicts and 13
missing people. None of it was real. The mine said to look again and was right.

CLL is also in the vendor master as `BISWAJIT MAHANTA ( CLL )`, SAP vendor
**0001105437**. Both codes are recorded against the party, so the register
reconciles to the contractor master *and* to the ledger without matching on a
name — which contract management will need.

**A job is a row, not a string** (migration 040). The roll spells about thirty
jobs thirty-eight ways: `MECH. HELPER  MAN` with two spaces, `GRARDENER`,
`WATCHMEN`, `A/ C MECHANIC`. Forty trades, each carrying its group, whether the
job is to operate a machine, **which** machine where it names one, and
skilled / semi-skilled / unskilled — how Odisha notifies minimum wage and how
labour contracts state rates. No rate is modelled; this is what a rate attaches
to. A trade claiming to operate a machine without naming one is refused by a
constraint.

**Five departments that exist on site but not on the platform** (041): HR,
Electrical, IT, COBP, ETP.

**What landed:** 211 people, 211 operators, 213 identities, 211 employments,
**every one a draft**. 143 machine operators (Tipper 101, Excavator 22, Dozer
6, Water Tanker 6, Backhoe 5, Grader 1, Crane 1, Drill 1), 28 workshop, 16
mining, 11 supervision, 5 electrical, 4 administration, 4 site services.

**Eight carry a remark for a person rather than an answer I invented:**

| Code | Why |
|---|---|
| 17036 Bijaya Kumar Dhir | on CLL's roll, not in BAL's master |
| 17220 Saroj Kumar Mohanta | on CLL's roll, not in BAL's master |
| 17144 Narasingh Soren | master says inactive, CLL still carries them |
| 17253 Sulabha Munda | same |
| 17296 Suresh Kumar Mohanta | same |
| 17325 Mangal Singh | same |
| 17214 Santosh Kumar Mohanty | roll says IT Helper, master says Electrician |
| 17321 Shyamalendu Mohanta | roll says Helper Mines, master says Supervisor |

**Still open:** the 12 the master lists as CLL and the roll does not. The mine
is checking with CLL.

## 4. Manpower as its own screen

`6f95065`, `1cd5484`, `e06cba9`. Four tabs: **Register · Capability ·
Assessment · Analytics**. The Operators tab is gone from MineHub rather than
left as a second door.

**Register.** Attendance ID first, on all 211 — the number the gate, the muster
and the face reader know a person by; searchable as well as shown. Trade,
department, mobile, years served, selection, export. Every column filters and
orders. Assessment columns removed: they read "not assessed / never / not
scheduled" on all 211 rows and belong on the tab that is about them.

**Assessment.** Four queues in the order the work happens — never assessed,
overdue, due soon, current. It covers only people employed to operate
something: a welder has no machine clearance to be overdue for, and putting 68
of them in a "never assessed" queue buries the finding, which is that **all 143
machine operators are in it**.

**Analytics.** Derived on read from one endpoint, filterable by employer,
department, trade group and operator-versus-support, narrowing the whole screen
at once. Against the machine register it already says:

- **101 tipper drivers for 66 tippers**
- **nobody at all** employed to run the 5 wheel loaders or the 2 compactors
- **180 of 211 have over ten years' service**; 93 are 45 or over, 17 are 55+
- **0 of 143** machine operators assessed

## 5. Assessment, rebuilt

`2eb13b8`, migration 042.

**It stages, then submits.** Every click used to go straight to the server:
fifteen requests and fifteen trail entries for one sitting, no review before
committing, and the remark had to be typed before the first click or not at
all. Levels are held until Submit, which sends them with one remark asked for
at that point. Only what moved is sent. A fixed bar says what is unsent, with
Undo; leaving with work in hand asks first.

**Set all** — five buttons that set every row, because somebody who has just
watched a driver work has one answer for most of the list and then corrects two
or three. **Two columns**, because fifteen rows in one is a screen and a half.

**The fields are data.** "What if tomorrow I want to add a field" had a bad
answer: they were an array in a React file. They are rows in `checklist_item`
now, with a screen that adds, rewords, reorders, marks required, scopes one to
a machine class, and chooses which one decides clearance. **Handover checks are
in the same table and the same screen** — ten are seeded so HOTO check-in
inherits all of this. Two refusals, both for one reason: a code is never
renamed (assessments point at it), and an item that has been answered is
retired rather than deleted.

## 6. Dates

`0f31804`. **23 native date inputs replaced; none remain.** `dd-mm-yyyy`
everywhere, including read-only places — file dates, compliance history,
last-seen, and the tooltip behind "3 weeks ago", which had been rendering
"20 Sept 2026". ISO stays on the wire.

Typing is forgiving — `5/3/26`, `05-03-2026`, `05032026` are one date; a
two-digit year reads against a sixty-year window so an expiry in 26 is 2026 and
a birth in 75 is 1975. `31-02` is refused rather than rolled to 3 March. The
header is the navigation: month opens twelve months, year opens twelve years
then a decade, so 1998 is three clicks. **24 parsing cases tested before a
single call site was touched.**

---

# Part two — the production move

## The single most important fact

**The database changes are already live.** Migrations 038–042 and the CLL load
were applied through the SSH tunnel to `192.168.10.27:5432`, database
`corpappdb`, schema `minehub` — *the same database production reads.*

So this is a **code-only deployment**. There is no migration step on the
server, and there is no window in which the schema and the code disagree in the
dangerous direction.

It also means production has been serving the 211 new operators through the
**old** UI since the load. Nothing is broken by that — every migration is
additive and old code ignores what it does not know about — but it explains
anything the mine has noticed on the live site today.

## What is being deployed

```
b4cc297 (live)  ..  0f31804 (local)
16 commits · 44 files · +6098 / -424
```

| | |
|---|---|
| Branch | `minehub-workforce-release` |
| New backend modules | `routers/checklists.py`, `routers/operators_analytics.py` |
| New frontend | `DateField`, `AssessmentSheet`, `AssessmentPanel`, `ChecklistsPanel`, `ManpowerAnalytics`, `ManpowerSection`, `when.ts`, `spreadsheet.ts` |
| **New dependencies** | **none** — `requirements.txt` and `package.json` are unchanged |

That last row matters: the 19 September release lost roughly four minutes of
API because `psycopg` had never been pinned. There is nothing of that shape
here.

## The one behavioural change at start-up

`minehub_db._reachable` now opens a real connection rather than only a socket,
because over the VPN the server accepts TCP and then refuses the login. On the
server there is no fallback list and the database is on the LAN, so the effect
is one extra round trip at boot — with a 5-second cap if the database is
unreachable.

## Procedure

Unchanged from 19 September, and the two standing rules still apply.

1. **Use the default `docker-compose.yml` + `docker-compose.override.yml`
   pair.** `docker-compose.prod.yml` does **not** auto-load the override, and
   the bundled nginx would take host 80/443 from every other application on the
   box.
2. **The compose subnet is pinned to `10.230.1.0/24`.** The default-assigned
   range cannot reach the shared MySQL host.

```bash
cd <app-root>/mines_dashboard
tar czf ~/mines_dashboard-backup-$(date +%Y%m%d-%H%M).tar.gz .
# extract the release over the tree, then:
docker compose build && docker compose up -d
```

## Checks after

- [ ] `mines.balasorealloys.in` returns 200
- [ ] Manpower opens: Register 211, Assessment, Analytics, Capability
- [ ] Equipment register: sorting, grouping, export
- [ ] A date field shows `dd-mm-yyyy` and the calendar is ours, not Chrome's
- [ ] `/api/checklists?kind=COMPETENCY` returns 15 rows
- [ ] Sign in as an operator registrar — lands on Manpower, no Equipment tab
- [ ] **All other containers hold the same ids and none restarted**
- [ ] **Nothing new is publishing host 80/443**

## Rollback

The backup tarball, or `git checkout b4cc297` and rebuild. No migration needs
reversing: every one is additive, so `b4cc297` runs against the current schema
exactly as it is doing now.

---

# After the deployment

1. **Resolve the eight flagged workmen**, and the 12 the roll is missing. Ten
   minutes with CLL closes the register.
2. **Assess somebody.** 143 operators, none assessed. Until the first few go
   through, the assessment screen is theory and the register cannot crew a
   shift.
3. **Attendance.** The FRS job has been failing — 72 of 74 log entries are
   duplicate-key or FK errors. The register now holds the 17xxx codes it keys
   on, so the join is finally possible. This unlocks the billing side.
4. **Contract management**: contract → service order → engagement → billing.
   CLL carries both its contractor code and its SAP vendor number, and every
   workman has a trade and a skill class for a rate to attach to. Nothing in
   MySQL holds a labour service contract, so MineHub would own it.
5. **HOTO check-in**, which now has its checklist, its table and its editor
   waiting.
6. **Rotate `baladmin` and the `ATT17030.env` credentials** (SAP TAPAS_3002,
   MSSQL `sa`, Office365). Raised before, still outstanding.

```bash
# what is on the server versus what is local
git log --oneline b4cc297..HEAD

# which migrations have run
python minehub/apply_migration.py --status
```
