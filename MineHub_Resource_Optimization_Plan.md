# MineHub — Mine Operations Platform

**Kaliapani Chromite Mines · Balasore Alloys Limited**
Blueprint, 17 September 2026. Supersedes the incremental plan of the same date.

This is a clean-sheet design. It replaces the IMOS portal, the nine HOTO forms
and the manual shift logs with one platform. Existing tables are referenced only
as *sources to migrate from* or *systems to retire* — not as constraints on the
design.

---

## Part A — The constitution

Six rules. Every later decision in this document follows from them, and any
future module that breaks one is wrong.

### A1. One fact, one capture point

A fact is recorded **once**, at the place it happens, by the party who knows it
first. Everything else *reads* it. If two screens can record the same number,
one of them is a defect.

> Today the same tonne is captured twice: the weighbridge weighs it
> automatically (110,711 rows this year, with RFID) and a shift in-charge then
> types it into a tipper log (3,745 rows). Two numbers, two owners, no way to
> reconcile, and an argument every month about which is right.

### A2. Machines capture; humans judge

If a sensor, a weighbridge, an RFID reader or a telematics unit can record it,
a human never types it. Humans record only what no instrument can: **condition,
cause, decision, approval**.

This single rule removes most of the data-entry burden that makes people avoid
the current forms.

### A3. Master data is registered once, centrally, and referenced by key

A person, a machine, a location, a material and a shift each exist once in the
platform with a surrogate key. No module stores a name, a vehicle number or an
employee code as free text. Ever.

### A4. Capture at the point of work, on the device at hand

A form that must be filled at a desk after the shift will be filled from memory,
late, or not at all. Capture happens at the gate, at the face, at the pump — on
a phone, offline-tolerant.

### A5. Validate at entry, never clean up later

> `mines_tipper_details` holds a production date of `0026-02-25`. The weighbridge
> holds a challan date of `5202-08-30`. Two HOTO tables hold dates in the future.
> Nothing rejects any of it.

Impossible values are refused at the point of entry, with a reason the operator
understands.

### A6. Derived numbers are computed, never stored by hand

Production, availability, utilisation, OEE and loss are **calculated** from the
transaction spine. Nobody types a total. If a number can be derived, deriving it
is the only permitted way to obtain it.

---

## Part B — Architecture

Four layers. Each layer may only call the layer below it.

```
┌─────────────────────────────────────────────────────────────┐
│  EXPERIENCE   Mobile capture · Control room · Management MIS │
├─────────────────────────────────────────────────────────────┤
│  DOMAIN       Deployment · Production · Maintenance ·         │
│               Compliance · Planning engine                   │
├─────────────────────────────────────────────────────────────┤
│  SPINE        Master registry · Event log · Derived ledgers   │
├─────────────────────────────────────────────────────────────┤
│  EDGE         RFID · Weighbridge · Telematics · Biometric ·   │
│               SAP · HRMS                                      │
└─────────────────────────────────────────────────────────────┘
```

**Everything lives in `minehub` (PostgreSQL).** The shared MySQL instance is at
its connection ceiling and refuses connections daily; it stays as a *source*
behind the edge layer and never as a home for new data.

### The event log is the heart

The spine is not a set of CRUD tables. It is an **append-only event log** plus
ledgers derived from it.

```
minehub.event
  event_id        uuid
  event_type      TRIP_WEIGHED | SHIFT_STARTED | HANDOVER_ACCEPTED
                  FUEL_ISSUED  | BREAKDOWN_RAISED | GATE_IN | GATE_OUT …
  occurred_at     timestamptz   -- when it happened
  recorded_at     timestamptz   -- when we heard about it
  source          RFID | WEIGHBRIDGE | TELEMATICS | MOBILE | SAP | HRMS
  equipment_id    fk, nullable
  person_id       fk, nullable
  location_id     fk, nullable
  payload         jsonb
  recorded_by     fk person
```

Why this shape, and not tables per screen:

- **Nothing is ever overwritten.** A correction is a new event; the original
  stands. That is what makes the platform auditable.
- `occurred_at` and `recorded_at` are separate, so late entry is visible as
  data rather than hidden as a silent edit.
- A new fact type needs **no migration** — a new `event_type`.
- Every ledger and KPI is a projection of this log, so two screens can never
  disagree.

---

## Part C — The master registry

Six registers. Registered once, referenced everywhere by key.

### C1. `party` — every person and organisation

One table for employees, contractor workers, contractors, vendors and
transporters. **Not three tables.** A contractor's operator who later joins the
rolls is the same `party_id` with a changed employment record — his history
follows him.

| Column | Notes |
|---|---|
| `party_id` | surrogate key, ours, permanent |
| `party_type` | PERSON \| ORGANISATION |
| `legal_name`, `display_name` | |
| `photo`, `contact` | |
| `status` | active \| inactive |

`party_identity` — external codes, many per party:

| Column | Notes |
|---|---|
| `party_id`, `system`, `external_code` | SAP `EMPID` · HRMS · contractor code · Aadhaar-last-4 · RFID card |

> This is what reconciles the two numbering systems that exist today: SAP
> 4-digit `EMPID` (1,300 people) and 5-digit contractor codes in the driver
> master (133 people). Neither becomes the key; both become identities.

`party_employment` — who they work for, when:

| Column | Notes |
|---|---|
| `party_id`, `employer_party_id` | employer is itself a party — `DASHMESH`, `SANY`, `BAL` |
| `designation`, `department_id` | |
| `valid_from`, `valid_to` | history preserved |

### C2. `asset` — every machine, own or hired

| Column | Notes |
|---|---|
| `asset_id` | surrogate key |
| `fleet_code` | the name people use — `MAN-18` |
| `registration_no` | statutory registration |
| `asset_type_id` | excavator, tipper, dozer, drill … |
| `make`, `model`, `year` | |
| `owner_party_id` | BAL or the contractor — **this is the own/hired split** |
| `sap_asset_no` | null for hired; SAP is an *identity*, not the key |
| `rated_capacity`, `rated_output_per_hr`, `rated_fuel_lph` | the ideal operating model |
| `status` | active \| maintenance \| standby \| disposed |

`asset_identity` — the table that unblocks everything:

| `asset_id` | `system` | `external_code` |
|---|---|---|
| 17 | TELEMATICS | `MAN18` |
| 17 | HOTO | `MAN-18` |
| 17 | WEIGHBRIDGE | `MAN 18` |
| 17 | RFID | `E280‑…` |

> Today telematics says `MAN18`, the handover register says `MAN-18`, and no
> query joins them. Around 42 machines currently transmit telematics. Aliasing
> them is an afternoon's work, once.

### C3. `location` — a real hierarchy, not a flat code list

`site → pit → bench → face`, plus stockyards, plants, gates and workshops.
Self-referencing parent, with geofence polygon where one exists — so a telematics
position can resolve to a face automatically instead of being typed.

### C4. `material` — ore, grades, OB, LG, silt, concentrate

With grade bands and the Cr₂O₃ / FeO ranges the lab assays against, so every
tonne is classified consistently rather than per screen.

### C5. `calendar` — shift definitions with history

Shift codes, start/end, and **which authority owns the boundary**. One
definition, versioned. Today production logs a shift and HRMS keeps a separate
shift master; the platform resolves that once, in one place.

### C6. `competency` — who may operate what

The register with legal weight, and the one that exists nowhere today.

| Column | Notes |
|---|---|
| `party_id`, `asset_type_id` | |
| `licence_no`, `licence_class` | |
| `valid_from`, `valid_upto` | **expiry is the point** |
| `certified_by`, `certified_on` | |
| `status` | active \| suspended \| expired |

> All 133 rows in the existing driver master have `DL_No` and `Valid_Upto`
> **empty**. In a DGMS-regulated mine an expired licence on a running machine is
> a statutory exposure. Once this register exists, the platform can *refuse* the
> deployment rather than report it afterwards.

`asset_compliance` mirrors it for machines: fitness, insurance, PUC, permit,
statutory inspection — none tracked anywhere today.

---

## Part D — The capture model

This is the heart of the design. **Every fact, exactly one capture point.**

| # | Fact | Captured by | How | Human effort |
|---|---|---|---|---|
| 1 | Person present on site | RFID / biometric at gate | automatic | none |
| 2 | Person assigned to machine | Shift in-charge, mobile | 1 tap, pre-filled from plan | seconds |
| 3 | Machine condition at handover | Outgoing operator, mobile | checklist, defaults from last shift | ~30 s |
| 4 | Hour meter start / end | Operator, mobile | 1 number, pre-filled from last reading | seconds |
| 5 | Machine running / idle / moving | Telematics | automatic | none |
| 6 | Fuel consumed | Telematics | automatic | none |
| 7 | Fuel issued | Pump, mobile or meter | quantity + asset scan | seconds |
| 8 | Trip weighed | Weighbridge + RFID | automatic | none |
| 9 | Material & destination | Weighbridge terminal | pre-filled from the order | none |
| 10 | Breakdown raised | Operator, mobile | 1 tap + reason | seconds |
| 11 | Breakdown closed | Maintenance, mobile | cause + parts | ~1 min |
| 12 | Loss reason for idle time | Shift in-charge | **only for idle the system cannot explain** | ~1 min |
| 13 | Blast / survey / geology | Respective department | their own form | as today |
| 14 | Production tonnage | — | **derived from #8** | **none** |
| 15 | Availability / utilisation / OEE | — | **derived from #5, #10, #2** | **none** |

Rows 14 and 15 are the point of the whole exercise. Nobody types a production
figure again. **The shift log becomes an exception report, not a data-entry
form**: the system already knows the machine ran 5.2 hours and idled 2.8, and
asks only *why* for the 2.8 it cannot explain.

### What this removes

| Retired | Replaced by | Effort saved |
|---|---|---|
| Manual tipper production entry | Weighbridge + RFID (#8) | every shift, every day |
| 9 department HOTO forms | One handover flow (#2, #3, #4) | 9 forms → 1 |
| Manual running/idle hours | Telematics (#5) | every shift |
| Separate gate registers | One gate event (#1, #8) | duplicate entry |
| IMOS portal | This platform | whole system |

---

## Part E — Domain modules

Each module **owns** its transactions and **reads** everything else. No module
writes to another's tables.

### E1. Deployment

The single handover flow replacing all nine forms. Department is a *column*;
checklist items come from a per-department master. The next department that needs
one more field adds a check row, not a table.

**Why people will actually use it:** operator identifies himself once (RFID card
or face), his machine is pre-filled from the shift plan, the hour meter defaults
to the last recorded reading, only his department's checks appear, and it works
with no signal and syncs later.

### E2. Planning engine

Runs before each shift. Reads roster, gate presence, competency, asset status and
target; writes `deployment_plan` with a status per machine:

| Status | Meaning |
|---|---|
| `PLANNED` | machine available, certified operator present |
| `AT_RISK` | operator absent, or licence expiring within 7 days |
| `UNMANNED` | machine available, no certified operator |
| `IDLE_ASSET` | machine down or no work planned |

Rules, enforced in order: valid unexpired competency → actually present today,
not merely rostered → one operator one machine → machine not under maintenance →
prefer the operator who ran it last.

`AT_RISK` and `UNMANNED` appear **before** the shift. That is the difference
between planning and reporting.

### E3. Production

Derives tonnage per shift, location, material and machine from weighbridge
events. Reconciles against survey volumes periodically. **No manual tonnage
entry exists in this module.**

### E4. Maintenance

Breakdown raised from the operator's phone, jobs, spares, downtime. Feeds asset
status back to the planning engine so a machine in the workshop is never planned.

### E5. Compliance

Licences, fitness, insurance, permits, statutory inspections, training. Drives
hard stops in deployment and a 30-day expiry dashboard.

### E6. Cost & contractor performance

Once assets carry `owner_party_id`, output, availability and fuel per contractor
are a by-product — directly useful at contract renewal.

---

## Part F — Integration

### F1. Systems of record, and what each owns

| System | Owns | Direction |
|---|---|---|
| **SAP** | Financial asset master, materials, sales | read |
| **HRMS** | Employee master, roster, attendance | read |
| **Technoton** | Telematics | read |
| **Weighbridge / RFID** | Trip weights, gate movement | read |
| **MineHub** | Deployment, handover, competency, planning, loss, derived production | **write** |

MineHub never writes into SAP or HRMS. Those systems keep their authority; the
platform holds identity mappings rather than copies.

### F2. How data arrives

Edge adapters — one per source — normalise to events and append to the log.
Each adapter is idempotent and keyed on the source's natural key, so a replay
never double-counts. Failures are visible as adapter health, not as silently
missing rows.

### F3. How other systems consume

A read API and views over the derived ledgers. **Nobody queries the tables
directly** — including the existing dashboard, which becomes a consumer.

---

## Part G — Roadmap

Each phase ends with something in production doing real work. No phase exists
only to enable the next.

| Phase | Delivers | Visible outcome |
|---|---|---|
| **1. Spine** | `party`, `asset`, identity mappings, `location`, `material`, `calendar`; event log; edge adapters for telematics and weighbridge | Every machine and person has one identity; telematics and weighbridge land as events |
| **2. Deployment** | Handover flow + competency register; retires 9 forms | One handover for the whole mine; licence expiry enforced |
| **3. Production** | Derived production ledger from weighbridge | Manual tipper entry stops |
| **4. Planning** | Planning engine + deployment board | `UNMANNED` and `AT_RISK` visible before the shift |
| **5. Maintenance** | Breakdown capture, asset status feedback | No machine planned while in the workshop |
| **6. MIS** | Gap, loss attribution, utilisation, compliance, contractor performance | The management view, entirely derived |
| **7. Retire IMOS** | Migrate remaining functions, decommission | One system |

Phase 1 is the only phase that is pure foundation, and even it delivers the
identity resolution that makes existing dashboards correct.

---

## Part H — Loss attribution

The output that drives action. Each cause has one owner, which is why they are
separated:

| Cause | Detected from | Owner |
|---|---|---|
| Machine down | Maintenance events | Maintenance |
| No certified operator | Planning engine | Training / HR |
| Operator absent | Gate presence vs roster | HR / contractor |
| Manned but idle | Telematics idle + deployment | Shift in-charge |
| Running but underloaded | Weighbridge vs rated capacity | Planning |
| Waiting (dump jam, LMV, illumination) | Shift in-charge, exception entry | Mine management |

Only the last is typed, and only for time the system cannot already explain.

---

## Part I — Decisions needed

1. **Fleet list.** Someone must supply the definitive list of equipment — own
   and hired — with fleet codes and rated capacities. No system holds it today.
2. **Rated output per hour and standard crew**, per equipment type. These set
   every gap figure the platform will ever report. Who signs them off?
3. **Contractor operator identity.** Are contractor codes stable per person, or
   reassigned when someone leaves? Determines whether they can be an identity.
4. **RFID coverage.** The weighbridge feed already carries `RFIDNO`. Which
   vehicles and people are tagged today, and what would full coverage cost?
   Rules 1, 2 and 8 of the capture model get much cheaper with it.
5. **Shift authority** — production shift or HRMS shift master.
6. **Scope of manpower** — operators only, or full crew including support trades.
7. **IMOS retirement.** What does IMOS do today that nobody has listed? It must
   be inventoried before it is switched off.

---

## Part J — What we will not do

- No module gets its own copy of a person or a machine.
- No screen accepts a number a machine already measured.
- No department gets its own table because it needs one more field.
- No KPI is stored where it can be derived.
- No new master data in the shared MySQL instance.
- No system is switched off before its replacement has run in parallel for a
  full month.
