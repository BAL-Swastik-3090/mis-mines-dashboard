# MineHub — Progress Report

**Kaliapani Chromite Mines · Balasore Alloys Limited**
Report as on **19 September 2026** · Live at **mines.balasorealloys.in**

---

## 1. Where we stand, in one line

Of the seven phases in the Resource Optimization Plan, **two are complete and
in production, two are built and waiting on data, and three have not started**
because they depend on inputs the mine has not yet supplied.

| Phase (per the plan) | Status | What is true today |
|---|---|---|
| **1 · Spine** | ✅ **Complete** | 61 tables, one identity per machine and person, event log running, telematics landing |
| **2 · Deployment** | ✅ **Complete** | Handover, competency register, licence expiry enforced before deployment |
| **3 · Production** | ⚪ Not started | Blocked — see §6 |
| **4 · Planning** | ✅ **Built** | Allocation engine, shift board, roster; needs an open shift to run against |
| **5 · Maintenance** | 🟡 **Partial** | Machine status and lifecycle done; breakdown capture done; service scheduling not started |
| **6 · MIS** | 🟡 **Partial** | Compliance and utilisation views live; loss attribution not started |
| **7 · Retire IMOS** | ⚪ Not started | Requires an inventory of what IMOS does — see §6 |

**Beyond the plan**, three things were built that the plan did not ask for and
the mine did: a workforce roster with leave and holidays, a notes system across
every record, and a statutory document vault with renewal history.

---

## 2. The platform as it stands

| | Count |
|---|---|
| Database tables / views | **61 / 3** |
| Schema migrations applied | **37** |
| API endpoints | **194** |
| Screens (modules) | **9** |
| Permissions / roles / users | **28 / 10 / 32** |
| Machines on the register | **131** |
| Equipment types (standard) | **24** across 9 categories |
| Statutory documents held | **331** |
| Lifecycle stages recorded | **67** |
| Skills vocabulary (SCMS) | **60** |
| Telematics records ingested | **465,972** |

Deployment: Docker on the shared application server, behind the host nginx,
alongside ~20 other BAL applications — none of which it disturbs. Two databases:
MySQL `balcorpdb` read-only as a source, PostgreSQL `corpappdb` schema `minehub`
owned by the platform, alongside `pems` and `cimcon` under the same convention.

---

## 3. Timeline — what was built, when

### Phase 1 · The spine — *1–12 September* ✅

| # | Task | Outcome |
|---|---|---|
| 1.1 | Core registry — `party`, `asset`, `location`, `material`, `calendar` | One place a machine or person is defined |
| 1.2 | Identity mapping (`asset_identity`, `party_identity`) | Telematics "MAN18" and the register's "MAN-11" are one machine — never fuzzy-matched |
| 1.3 | Append-only event log, partitioned by month | Every action recorded with who and when |
| 1.4 | Roles and permissions as data | A new role is created in the UI, not in code |
| 1.5 | Access control screen + audit trail | 32 users, 10 roles, every grant recorded |
| 1.6 | Telematics ingestion | 465,972 records landed and attributable |
| 1.7 | Machine reference numbers (`EQP-2026-0001`) | Never reused, even after deletion |
| 1.8 | Equipment registration form with draft/submit/approve | Incomplete work is saved, not lost |

**Deliverable met:** *"Every machine and person has one identity."*

### Phase 2 · Deployment and competency — *12–17 September* ✅

| # | Task | Outcome |
|---|---|---|
| 2.1 | Operator register (Operator 360) | Who they are, what they hold, what they can run |
| 2.2 | Competency register, per class **and per machine** | A level-3 excavator operator is not automatically level-3 on *this* excavator |
| 2.3 | Assessment cycle with configurable intervals | `ASM-2026-0001` per sitting, version history per assessment |
| 2.4 | 5-star expertise rating + training-gap analysis | Separates two level-3 operators |
| 2.5 | Skills vocabulary — 60 SCMS qualification packs | National standard, not invented here |
| 2.6 | Licence and medical expiry enforcement | Cannot deploy against an expired licence |
| 2.7 | HOTO (handover/takeover) with templates | One handover replacing nine forms |
| 2.8 | Readiness engine — blockers vs warnings | Derived on read, never stored stale |
| 2.9 | Live fleet board | Every machine, what it is doing, what is stopping the rest |

**Deliverable met:** *"One handover for the whole mine; licence expiry enforced."*

### Phase 4 · Planning — *18 September* ✅ *(built ahead of Phase 3)*

| # | Task | Outcome |
|---|---|---|
| 4.1 | Shift instance, shift plan, availability events | The shift is a record, not a whiteboard |
| 4.2 | Roster — cycle patterns, not weekly grids | Six-on-one-off and 21-day three-crew rotations |
| 4.3 | Leave management with approval and overlap prevention | `LV-2026-0001`, enforced in the database |
| 4.4 | Holiday calendar — closure vs restricted | A festival people work through cannot empty the roster |
| 4.5 | **Allocation engine** | Machines matched to operators by skill, availability and fairness |
| 4.6 | Attendance from the SmartFace gate readers | Presence taken from the readers, absence still a supervisor's call |
| 4.7 | Excel import/export of the roster | The mine's spreadsheet and the platform stay in step |
| 4.8 | Reconciliation — plan vs deployment vs telematics | Where the three disagree |

**Deliverable met:** *"`UNMANNED` and `AT_RISK` visible before the shift."*
**Waiting on:** an open shift with rostered operators to run against.

### Phase 5 · Maintenance — *17–19 September* 🟡

| # | Task | Status |
|---|---|---|
| 5.1 | Breakdown / maintenance hold capture | ✅ Done — `availability_event` |
| 5.2 | Machine status feeds planning | ✅ Done — a machine in the workshop is not offered |
| 5.3 | **Asset lifecycle** — off road, cannibalised, scrapped | ✅ Done — `asset_lifecycle`, append-only with reasons |
| 5.4 | Service schedule and next-due | 🟡 Table exists, screen not built |
| 5.5 | Work orders | ⚪ Not started |

### Phase 6 · MIS — *partial* 🟡

| # | Task | Status |
|---|---|---|
| 6.1 | Compliance position across the fleet | ✅ Done — `asset_alert`, live |
| 6.2 | Utilisation from telematics | ✅ Done — feeds OEE/LCM |
| 6.3 | Shift analysis — where the hours went | ✅ Done |
| 6.4 | Loss attribution by owner | ⚪ Not started — needs Phase 3 |
| 6.5 | Contractor performance and cost | ⚪ Not started |

### Beyond the plan — *18–19 September*

| # | Task | Why it was built |
|---|---|---|
| X.1 | Workforce roster, leave, holidays | The mine asked; the plan had no roster |
| X.2 | Notes on every record, with @mentions | The sentence that does not fit in a field was living in WhatsApp |
| X.3 | Statutory document vault + renewal history | A date says insurance runs to August; the certificate proves it |
| X.4 | **Fleet backfill from the mine's spreadsheets** | 131 machines imported as drafts, saving a week of typing |
| X.5 | Standard equipment taxonomy | 24 types replacing a list that held makes as types |

---

## 4. Machine-wise — what the register now holds

**131 machines**, every one typed, none approved yet (all drafts awaiting
check).

| Category | Types | Machines |
|---|---|---|
| Haulage | Tipper, Dumper, Trailer | **73** |
| Excavation | Excavator, Backhoe Loader, Wheel Loader | **31** |
| Dozing | Dozer | **8** |
| Drilling | Drill | **7** |
| Grading | Grader, Compactor | **4** |
| Lifting | Crane, Telehandler | **3** |
| Support | Diesel Bowser, Maintenance Van, Pickup, Forklift | **3** |
| Water | Water Tanker, Mist Cannon | **1** |
| LMV | Ambulance, SUV, MUV, Car, Bus, Motorcycle | **1** |

**By lifecycle stage** — the first time the mine's own vocabulary has been held
in a system:

| Stage | Machines |
|---|---|
| Working | **107** (34 hired) |
| Off road | **17** |
| Scrapped | **4** |
| Cannibalised | **3** |
| In workshop | **1** |

**Electric:** 4 LiuGong machines identified and categorised — the EV/non-EV
split is now a column the fleet is counted by, not a guess from fuel type.

**SAP linkage:** 46 machines carry their SAP equipment number.

---

## 5. Resource optimization — what is now possible that was not

| Question the mine could not answer | Can it now? | How |
|---|---|---|
| What machines do we actually own? | ✅ Yes | 131 on one register, previously four partial lists |
| Which are legal to run today? | ✅ Yes | **225 expired statutory documents** now visible — always true, never visible |
| Who can operate this machine? | ✅ Yes | Competency per class and per machine, with expiry |
| Who is on duty next Tuesday? | ✅ Yes | Roster derived from pattern, leave and calendar |
| Who should run what this shift? | ✅ Yes | Allocation engine, scored and explained |
| Which machines nobody on duty can run? | ✅ Yes | Named explicitly — the most actionable output |
| Is an operator qualified but unused? | ✅ Yes | Surfaced on the operator dashboard |
| What was the insurance on the day of the incident? | ✅ Yes | Renewal history keeps every superseded certificate |
| How far along is the EV transition? | ✅ Yes | Propulsion is a counted column |
| How much ore did we move? | ❌ No | Phase 3 — needs the weighbridge decision |
| Why did we lose those hours? | ❌ No | Phase 6 — needs Phase 3 |
| What does each contractor cost per tonne? | ❌ No | Needs production |

---

## 6. What is blocking the remaining phases

These are decisions, not development. Each maps to Part I of the plan.

| # | Blocker | Who decides | Blocks |
|---|---|---|---|
| 1 | **Weighbridge scope.** The feed holds transporter trucks, not mine machines. Production cannot be derived until mine-side weighing is settled. | Mine management | Phase 3, 6 |
| 2 | **Rated output per hour and standard crew**, per equipment type. Every gap figure depends on them. | Mine management | Phase 4 accuracy, 6 |
| 3 | **Which statutory certificates Kaliapani tracks** for HEMM operators | Safety / HR | Compliance completeness |
| 4 | **Contractor operator identity** — are codes stable per person? | Contracts | Operator register completeness |
| 5 | **RFID coverage** — which vehicles and people are tagged today | IT / Mines | Automated capture |
| 6 | **IMOS inventory** — what does it do that nobody has listed? | IT | Phase 7 |
| 7 | **131 drafts need checking and approving** by someone who knows the machines | Automobile section | Register going live |
| 8 | **225 expired documents** need renewing or writing off | Automobile / Compliance | Legal exposure |

---

## 7. Security matters raised

| Item | Status |
|---|---|
| `baladmin` password exposed in a screenshot | ⚠️ **Rotation still pending** |
| Credentials found in `ATT17030.env` (SAP, MSSQL `sa`, Office365) | ⚠️ **Reported, rotation pending** |
| SmartFace attendance job failing (72 of 74 log entries are duplicate-key / FK failures) | ⚠️ **Reported, not ours to fix** |

---

## 8. How the work was done

198 commits, 37 migrations, across three weeks — with the heaviest work on
17–19 September (75 commits).

Every module was built against real data before the screen was written:
telematics `engine_hours` is a TIME column, so summing it gives 1.6 million
hours and the latest-reading-per-day is the only correct rule; the driver
master's codes turned out to overlap SmartFace, which is what made the
attendance join possible at all; the weighbridge holds transporter trucks, not
mine machines, which is why production was deliberately deferred rather than
built on a wrong assumption.

**Principles held throughout**, per Part A of the plan:

- Readiness and roster are **derived on read, never stored** — a stored answer
  goes stale the moment a leave is approved
- **Nothing seeded that the mine should own** — departments, leave types and
  equipment classes are created by users, not invented in a migration
- **Machines capture, humans judge** — attendance comes from the gate readers,
  but absence stays a supervisor's decision
- **The allocation engine proposes and shows its working** — it never decides
  silently

---

## 9. Next, in order

1. **Automobile section checks and approves the 131 drafts** — the register goes
   live the moment they do
2. **Renew or write off the 225 expired documents** — the backlog is now visible
3. **Open a shift and run the allocation engine** against real rostered crew
4. **Supply rated output and standard crew** per equipment type (blocker 2)
5. **Settle the weighbridge question** (blocker 1) — this unlocks Phases 3 and 6
6. **Rotate the exposed credentials** (§7)

---

*Prepared from the platform's own records — commit history, migration log and
live database — rather than from recollection. Every figure in this document
can be reproduced from the system.*
