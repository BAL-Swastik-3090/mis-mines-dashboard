# MineHub — what changed, 20 September 2026

For validation. Every item says what it was, what it is now, and how to check
it. Nothing here is a plan; it is all in the code and, where it touches data,
already in the database.

**Nine commits, none of them deployed yet.** The server is still on `b4cc297`.

---

## 1. Access control — a real hole, closed

**`93ae869` · An empty page list meant "no pages", not "every page"**

A user with no dashboards granted was shown every dashboard. The frontend read
an empty `allowed_pages` array as "no restriction" instead of "nothing
allowed". The API was refusing the data correctly the whole time, so the tabs
appeared and then filled with errors — which reads as a broken platform rather
than as a permission boundary.

*Check:* sign in as a user with no dashboard permissions. Tabs they cannot open
are absent, not present-and-erroring.

**`93c3aef` · Browsing the register is not the same right as reading it**
(migration 038)

`platform.registry.view` was doing two jobs: reading the machine vocabulary
(which an operator registrar needs, to assess somebody on "Excavator") and
opening the 130-machine equipment register (which is the automobile section's
work). Collapsing them meant every people-role had to be given the machine
register to do its own job — and a permission granted to everybody protects
nothing. Browsing now has its own permission. Nothing was revoked.

*Check:* Access Control → an operator-registrar role no longer shows the
Equipment tab, but can still assess somebody against a machine class.

---

## 2. Equipment register

**`0175c1d` · Every machine has a number** (migration 039)

129 of 130 machines had no `asset_ref`. The registration endpoint generated
one; the spreadsheet import inserted rows directly and never called it. Fixed
at the column with a default, so no insert path can produce an unnumbered
machine — rather than fixing the endpoint, which the next importer would
forget in the same way. All 130 backfilled in registration order.

**Two machines were wrongly off road.** The import matched "off road" anywhere
in a status column. `"To be done Off Road"` is a plan, not a state;
`"Off Road/ Running B/D"` is running with a breakdown, which is the workshop.
Both were filed as OFF_ROAD, and the default view hides off-road machines — so
MAN-12 and MAN-14 had vanished from the list the entry operator was looking at.
A wrong status that also hides the row is worse than a wrong status, because
nobody can go and correct it. Both corrected, and the lifecycle stage can now
be changed from the form, with a reason that is kept.

**`133fbf0` · A machine sheet says nothing about a machine it has not read**

Opening MAN-14 rendered the whole sheet from an empty form for two seconds:
"Machine", "v1", "0 of 14 filled", every field blank. Eleven false statements,
none of them marked provisional. It now shows a skeleton with the same bands,
columns and row heights, so nothing jumps when the data lands.

I checked whether the two seconds could simply be removed: the endpoint runs
four queries, all indexed on `asset_id`, and the record and revision trail
already load in parallel. What is left is the VPN round trip to the mine, which
code cannot shorten. The fix was to stop the pause being filled with wrong
facts.

**`3d67305` · The register spends its space on machines**

- Five stat tiles in a four-column grid (one stranded on a second row, ~400px
  before a single machine was visible) became one band of six, about a fifth
  the height.
- **The 130-vs-123 gap is explained.** A RETIRED figure was added; the screen
  used to say both numbers and never account for the seven between them.
- **Sorting, which did not exist.** Every column orders the list. The control
  lives in the same heading menu as that column's filter, because both belong
  to the column. Directions are named in the column's own words — "Changed most
  recently", "Working first" — since "A to Z" on a date is why people click
  sort twice. Blanks sort last in either direction.
- **A card view** beside the table, which is also what survives a phone.
- **Fixed in passing:** the table had eight body cells and seven headings — the
  Changed column had none — so every heading from Owner rightwards was
  labelling the wrong column.

**`e0689d5` · Grouping, legibility, and every figure a toggle**

- The band is set in the tabs' typeface, sentence case. Barlow Condensed at
  9.5px with .13em tracking is right for a table heading; in the band it was the
  only name a figure had, and "IDENTITIES LINKED" was the hardest thing on the
  screen to read.
- **Every figure toggles**, including the one on by default. Clicking "In
  service" used to do nothing, which reads as a broken control, and the way
  back to all 130 machines was buried in a column menu.
- **Three filters that did not exist:** category, fuel, and approval. Approval
  was the one most obviously missing — every imported row sits in draft and
  there was no way to list them.
- **Group by** category, type, stage, owner, make, electric-or-not, approval,
  in both the table and the cards. Each heading carries the colour that value
  already means. Stages run in life order; everything else leads with the
  biggest group. The menu says how many headings each choice would make before
  you pick it.

**`a97a470` · Three bugs found by the mine, and one class behind them**

1. `changed today by IMPORT` printed twice — under the machine name and in the
   Changed column. The column was added and the line it replaced was not
   removed. Mine.
2. `owner ?? "Hired"` — a hired machine with no contractor recorded showed a
   confident "Hired", repeating the column beside it and answering nothing.
3. **The Owner filter could not see most of the fleet.** Built from the raw
   owner column, which is null on every machine BAL owns: three contractors,
   17 rows of 123, and no way to ask for our own machines at all.

The third was a class, not a column. `optionsFrom` dropped every blank, so
machines with no make, type or fuel were unreachable from their own column —
and each menu's counts quietly failed to sum to the rows in the table. Blanks
now get their own entry, last, named for what they are.

**Selection and export.** Checkboxes on rows and cards, shift-click for a
range, select-all. The selection is ids, so it survives re-sorting and
reloading, and it drops anything that falls out of the filter. Export is CSV
with a UTF-8 BOM (or Excel guesses Windows-1252 and mangles names), CRLF
endings, and a tab before any value starting with `= + - @`, because Excel
executes those and a machine nicknamed `-350` is not a formula. 15 parser cases
and a full round trip tested.

**Import was built and then removed** at the mine's decision — the register is
filled in through the form, where every entry is a decision rather than a row
in a file. Dialog, endpoint and CSV reader all removed rather than left
switched off. One revert away in `a97a470`.

**`a22c2c1` · Changed says how long ago, names the person, sits last**

- `changed today` covered a minute ago to twenty-three hours ago. The scale now
  runs *just now → 12 min ago → 3 hours ago → yesterday → 5 days ago → 3 weeks
  ago → 22 Jul 2026*, with the exact timestamp on the tooltip throughout.
  Extracted to `when.ts` and tested at the boundaries — 45 s, 59 min, 23 h,
  13 d — with `now` passed in so the function is pure. **19 cases**, including a
  clock running fast, which must not produce "in 4 seconds".
- **Names, not payroll numbers.** 3101 reads AKASH ., 2917 reads BULBUL BEHERA,
  IMPORT keeps its id because it is not a person. Batched and cached, reusing
  the service the revision trail already had. The id stays on the tooltip.

---

## 3. Manpower — CLL's 211 workmen

**`277b5af`** (migrations 040, 041)

### The spreadsheet was a copy of something BAL already had

The roll arrived as code, name and designation. It is a dump of
`hr_med_contractor_master`, where **CLL is contractor 1100223 at plant 1200**
and 209 of the 211 already sit — with date of birth, date of joining,
department and status.

| | Sheet vs contractor master |
|---|---|
| Names | agree **209 of 209** (case ignored) |
| Designations | agree **207 of 209** |
| DOB / DOJ / department | complete for all 209 |

**I got this wrong first.** I read `sap_employee_details`, which holds shortened
payroll names and puts the contractor's name in the designation column, and
reported 129 name conflicts and 13 missing people. None of it was real. The
mine said to look again and was right.

CLL is also in the vendor master as **`BISWAJIT MAHANTA ( CLL )`, SAP vendor
0001105437**. Both codes are recorded against the party, so the register
reconciles to the contractor master *and* to the ledger without matching on a
name — which contract management will need.

### A job is a row, not a string (migration 040)

Only two-thirds of these people operate a machine. The roll spells about thirty
jobs thirty-eight ways: `MECH. HELPER  MAN` with two spaces, `GRARDENER`,
`WATCHMEN`, `A/ C MECHANIC`, `ASST. AUTO ELE.`. Free text is fine until a rate
or a competency or a headcount depends on it; then every variant spelling is a
row that falls out of the total.

**40 trades**, each carrying:

- its **group** (for headcount and reporting)
- whether the job is to **operate a machine**
- **which machine**, where it names one — so a tipper driver's competency
  requirement and deployment eligibility are derived, not typed 101 times
- **skilled / semi-skilled / unskilled**, which is how Odisha notifies minimum
  wage and how nearly every labour contract states its rates

No rate is modelled, because the basis is not decided. This is the
classification a rate attaches to, whatever it turns out to be. A trade
claiming to operate a machine without naming one is refused by a constraint.
What the employer wrote is kept beside it — evidence about their paperwork, not
something to compute from.

### Five departments that exist on site but not on the platform (041)

HR, Electrical, IT, COBP, ETP. Without them sixteen people would be registered
with no unit and a note explaining why, turning "somebody look at this" into
sixteen rows of nothing.

### What landed

```
211 people · 211 operators · 213 identities · 211 employments · all DRAFT
143 machine operators — Tipper 101, Excavator 22, Dozer 6, Water Tanker 6,
                        Backhoe 5, Grader 1, Crane 1, Drill 1
 28 workshop · 16 mining · 11 supervision · 5 electrical
  4 administration · 4 site services
```

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

---

## 4. Manpower as its own screen

**`6f95065`**

It was a tab inside MineHub Platform, between the equipment register and the
machine alerts. Right when it held eleven people and existed so a machine could
be handed to somebody; wrong now. A section you enter through somebody else's
screen is one people stop visiting. The Operators tab is **gone** from MineHub
rather than left as a second door.

### Register

- **Attendance ID is the first column**, on all 211. It is the number the gate,
  the muster and the face reader know a person by; without it on the row,
  reconciling against attendance means opening people one at a time. Searchable
  as well as shown.
- Classified trade, with the employer's own words beneath where they differ;
  department, years served, age.
- Every column filters and orders. Export carries 19 columns.

### Assessment — its own screen, and its own sheet

Four queues in the order the work happens: **never assessed → overdue → due
soon → current**, each filterable, sortable, exportable.

It covers only people employed to operate something. A welder has no machine
clearance to be overdue for, and putting 68 of them in a "never assessed" queue
buries the real finding — **all 143 machine operators are in it.**

Clicking Assess used to open the full ten-tab profile with a Save and a Submit
in the corner. That is right for keeping somebody's record and wrong when you
are stood at a machine deciding whether a driver may run it. It now opens a
**focused sheet**: who (shown, not editable), what machine, how judged, when —
then the fifteen dimensions, five buttons each, written on click. No Save
button, because an assessment is a decision about whether somebody may work and
holding one in a form is how it gets lost.

### Analytics

Derived on read from one endpoint. Nothing stored, because a stored headcount
is wrong by the time anybody reads it. One endpoint rather than twelve, because
over the tunnel that is the difference between a page that appears and one that
assembles itself while you watch.

It leads with what is wrong. Against the machine register it already says:

- **101 tipper drivers for 66 tippers**
- **nobody at all** employed to run the 5 wheel loaders or the 2 compactors
- **180 of 211 have over ten years' service**; 93 are 45 or over, 17 are 55+
- **0 of 143** machine operators assessed

No chart library — counts across a handful of categories, where a bar whose
width is a percentage says it as well, reads at any size and prints.

---

## What I would do next, in order

### Immediately worth doing

1. **Deploy.** Nine commits, none on the server. Migrations 038–041 need to run
   there; 040 and 041 have only been applied to the mine's database via the
   local tunnel.
2. **Resolve the eight flagged workmen**, and the 12 the roll is missing. Ten
   minutes with CLL closes the register.
3. **Assess somebody.** 143 operators, none assessed. Until the first few go
   through, the assessment screen is theory and the register cannot be used to
   crew a shift.

### The obvious next build

4. **Attendance.** The FRS face-recognition system is on MSSQL and its job has
   been failing — 72 of 74 log entries are duplicate-key or FK errors. The
   register now holds the 17xxx codes it keys on, so the join is finally
   possible. This unlocks everything on the billing side.
5. **Contract management**, as discussed: contract → service order → engagement
   → billing. The pieces it needs are in place — CLL carries both its
   contractor code and its SAP vendor number, and every workman has a trade and
   a skill class for a rate to attach to. Nothing in MySQL holds a labour
   service contract, so MineHub would own it.
6. **Deployment.** The trade already names the machine class, so "who can crew
   this tipper tomorrow" is answerable from the register plus roster plus
   competency, once step 3 has happened.

### Housekeeping

7. **Rotate `baladmin` and the `ATT17030.env` credentials** (SAP TAPAS_3002,
   MSSQL `sa`, Office365). Raised before, still outstanding.
8. **Unit tests** for the renewal-vs-correction logic in the document sheet.
   `trimNumber`, `expiryOf`, `ago` and the CSV parser now have them; that one
   does not.

---

## How to check any of this

```bash
# What is on the server versus what is local
git log --oneline b4cc297..HEAD

# Which migrations have run
python minehub/apply_migration.py --status

# The workforce as the platform sees it
#   Manpower → Analytics
```
