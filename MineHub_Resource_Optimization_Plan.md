# MineHub — Master Data & Resource Optimization Plan

**Kaliapani Chromite Mines · Balasore Alloys Limited**
Prepared 17 September 2026. Every figure below was measured against the live
databases, not estimated.

Tracks ClickUp list **MINES — Manpower and Equipment Capacity**.

---

## 1. The problem in one sentence

We have the data. We do not have the **identities**.

A person, a machine, a shift and a tonne are all recorded somewhere — but no two
systems agree on what to call the person or the machine, so they can never be
joined. Every analysis on the ClickUp board fails at the same step, and it is
not an analysis step. It is a master-data step.

**Therefore we start with two registers — one for people, one for equipment —
and nothing else gets built until those exist.**

---

## 2. What is actually there today (measured)

### 2.1 The HOTO problem — nine forms, not one

| Table | Rows | Date range | Days covered |
|---|---:|---|---:|
| `mines_hand_over_take_over` (MINING) | 409 | 2025-05-25 → 2026-07-10 | 42 |
| `mines_hand_over_take_over_cobp` | 353 | 2026-04-12 → 2026-08-27 | 122 |
| `mines_hand_over_take_over_dewatering` | 455 | 2026-04-16 → 2026-09-17 | 152 |
| `mines_hand_over_take_over_electrical` | 317 | 2025-05-21 → 2026-09-28 | 160 |
| `mines_hand_over_take_over_etp` | 434 | 2026-04-16 → 2026-09-19 | 146 |
| `mines_hand_over_take_over_sukinda_electrical` | 447 | 2026-04-14 → 2026-09-16 | 152 |
| `mines_hand_over_take_over_sukinda_mechanical` | 454 | 2026-04-15 → 2026-09-16 | 152 |
| `mines_hand_over_take_over_sukinda_operation` | 172 | 2026-04-19 → 2026-08-28 | 89 |
| `mines_hand_over_take_over_chain` | 44 | 2026-04-11 → 2026-06-22 | 12 |

Nine tables, nine forms, ~3,085 rows total. Each department got its own form
because each needed one more field than the last. The consequences:

- **The mining HOTO — the one that matters most for production — is the
  thinnest**: 42 distinct days in 14 months, 25 vehicles, 57 people.
- **Two tables hold future-dated rows** (`_electrical` to 2026-09-28,
  `_etp` to 2026-09-19) — nobody is validating input.
- No cross-department view is possible without a nine-way UNION.

### 2.2 Gate entry — two more systems, not joined to HOTO

| Table | Rows | What it is |
|---|---:|---|
| `zpp_win_gate_entry` | 110,711 | Production gate entries |
| `weighbrigde_gate_entry` | 66,419 | Weighbridge gate entries |
| `security_vehicle_inout` | 8 | Security in/out log (barely used) |
| `security_vehicles` | 12 | Security's own vehicle list |
| `mines_daywise_rom_entry` | 685 | ROM entries |

Three separate places record "a vehicle came in", none of which reference the
HOTO register or each other.

### 2.3 People — two numbering systems that do not meet

| Source | Rows | Identifier | Example |
|---|---:|---|---|
| `sap_employee_details` | 1,300 | `EMPID`, 4 digits | `3101`, `2627` |
| `mines_driver_master` | 133 | `Emp_Code`, 5 digits | `17267`, `17135` |
| `hr_hrms_emp_attendance` | 243,890 | `Empid` | 1,001 distinct employees |
| `hr_hrms_emp_shift_plan` | 287,595 | `Empid` | the roster |

`mines_driver_master` **already exists** — this is the operator register we
thought we had to create. But it is incomplete in ways that matter:

- `DL_No` — **empty on every row**. No licence number held.
- `Valid_Upto` — **empty**. No licence expiry, so no expiry checking.
- `Vehicle_No` — **empty**. The driver↔vehicle column exists but was never filled.
- `Equipment_Type` — free text (`"Excavator Long Boom 470-"`) which does not
  match the 13 values in `mines_vehicle_type_master`.
- `Driver_Status` — `P` / `S`, undocumented.

Its `Emp_Code` values are 5-digit and do not appear in SAP. These are
**contractor operators**. That is the "some from SAP, some outside SAP" split,
and it already exists in the data.

### 2.4 Equipment — four partial lists, one of them empty of the fleet

| Source | Rows | Covers |
|---|---:|---|
| `mines_vehicle_type_master` | 13 | Types only (Man (Tipper), Excavator, Dozer, Drill, JCB, CAT, Grader, Water Sprinkler, Hydra, Loader, Soil compactor, Mist Cannon, Chain) |
| `mines_ev_equipment_master` | 4 | Electric vehicles only |
| `security_vehicles` | 12 | Security's list |
| Technoton feed | 42 | 28 MAN + 14 other machines actually transmitting |

**There is no register of the mine's own fleet.** There are four lists, none
of which is authoritative and none of which covers everything.

### 2.5 The identifier collision, concretely

The same machine, in three systems:

| System | Value |
|---|---|
| Technoton telematics | `MAN11`, `MAN12`, `MAN18` |
| HOTO register | `MAN-18`, `MAN-55`, `MAN-57` |
| Other equipment (Technoton) | `BAL_ATLAS Capco Drill 1`, `BAL_JCB_3DX/OD04L0327`, `BAL_DOZER CAT D6R` |

`MAN18` and `MAN-18` are the same truck. No query joins them today.
Contractor fleets appear only as a party name on production: `BAL`,
`DASHMESH`, `SANY`, `SIDHIVINAYAK`.

### 2.6 What is in good shape

- **Attendance**: `hr_hrms_emp_attendance`, 243,890 rows, 1 Jan → 17 Sep 2026,
  1,001 employees, with `Shift`, `Absence`, `Attendance`, `Inlocation`,
  `Outlocation`, late/early flags. Shifts: `GEN`, `ASHF`, `BSHF`, `CSHF`,
  `WOFF`, `HSAT`.
- **Roster**: `hr_hrms_emp_shift_plan`, 287,595 rows.
- **Shift master**: `hr_hrms_shift_time_master`, 14 rows with start/end times.
- **Telematics**: `minehub.technoton_*` in Postgres — engine hours, idling
  hours, distance, fuel, fill/drain events, per trip.
- **Production**: `mines_tipper_details`, shift-wise ore / LG / OB / silt.

---

## 3. Where we start

**Phase 0 — the two registers. Nothing else until these are done.**

Everything downstream is a join on `person_id` and `equipment_id`. Build those
two identities once, properly, and the HOTO form, the planning engine and the
MIS all become straightforward. Build them late and every one of them carries
the ambiguity forward.

All new tables live in **`minehub`** (PostgreSQL). The shared MySQL instance is
at its connection ceiling and refuses connections daily — that is why the
dashboard holds a resting pool of two connections. New write-heavy master data
does not belong there.

---

## 4. Phase 0 — the registers

### 4.1 `minehub.person` — register an operator once

One row per human who can be deployed, whether SAP employee or contractor.

| Column | Notes |
|---|---|
| `person_id` | **Our** surrogate key. Never a SAP or contractor number. |
| `source` | `SAP` \| `CONTRACTOR` |
| `source_code` | `EMPID` for SAP, `Emp_Code` for contractor |
| `full_name` | |
| `contractor_party` | e.g. `DASHMESH`, `SANY` — null for own employees |
| `department`, `designation` | from SAP where available |
| `date_joined`, `status` | active / inactive |
| `photo`, `contact` | for the gate pass |

Populated by: importing 1,300 SAP employees and 133 existing driver-master rows,
de-duplicating on name where a contractor was later put on rolls.

### 4.2 `minehub.person_competency` — what each person may operate

This is the table that does not exist anywhere today, and it is the one with
legal weight.

| Column | Notes |
|---|---|
| `person_id` | |
| `equipment_type_id` | FK to the 13 types |
| `licence_no`, `licence_class` | currently empty in `mines_driver_master` |
| `valid_from`, `valid_upto` | **expiry is the point** |
| `certified_by`, `certified_on` | |
| `status` | active / suspended / expired |

**Why it matters beyond tidiness:** with `valid_upto` populated, the planning
engine can refuse to assign an operator whose licence has lapsed, and the MIS
can show licences expiring in the next 30 days. Neither is possible now.

### 4.3 `minehub.equipment` — register a machine once

One row per machine, own or hired.

| Column | Notes |
|---|---|
| `equipment_id` | our surrogate key |
| `fleet_code` | the human name — `MAN-18` |
| `registration_no` | road registration, e.g. `OD04L0327` |
| `equipment_type_id` | FK to `mines_vehicle_type_master` |
| `make`, `model`, `capacity` | |
| `ownership` | `OWN` \| `HIRED` |
| `owner_party` | `BAL`, `DASHMESH`, `SANY`, `SIDHIVINAYAK` |
| `sap_asset_no` | null for hired machines — **this is the SAP / non-SAP split** |
| `commissioned_on`, `status` | active / under maintenance / disposed |

### 4.4 `minehub.equipment_alias` — the join that unblocks everything

| Column | Notes |
|---|---|
| `equipment_id` | |
| `system` | `TECHNOTON` \| `HOTO` \| `SAP` \| `WEIGHBRIDGE` \| `SECURITY` |
| `external_code` | `MAN18` / `MAN-18` / … |

Two rows resolve `MAN18` ↔ `MAN-18` forever. Roughly 42 telematics machines
need aliasing; it is an afternoon's work once and never again.

### 4.5 `minehub.equipment_compliance` — statutory validity

Vehicles have expiries exactly as operators do, and none are tracked today:
fitness certificate, insurance, PUC, permit, and for mining equipment the
statutory inspection. Same shape as `person_competency`: document type, number,
`valid_upto`, status.

---

## 5. Phase 1 — one HOTO to replace nine

**Principle: one form, one table, department as a column — not as a table.**

`minehub.hoto` replaces all nine:

| Column | Notes |
|---|---|
| `hoto_id`, `prod_date`, `shift_code` | |
| `department_id` | what used to be the table name |
| `equipment_id` | FK — not free text |
| `location_id` | |
| `handover_person_id`, `takeover_person_id` | FK — not names |
| `hmr_start`, `hmr_end` | hour meter |
| `status` | draft / submitted / accepted / disputed |

Checklist answers move to a child table `hoto_check` (`hoto_id`, `check_code`,
`status`, `remarks`) driven by a `hoto_check_master` keyed by department. **That
is what stops a tenth table being created** the next time a department needs one
more field — they add a check row, not a table.

**What makes it user-friendly** (the current forms are why people avoid them):

1. Operator scans or picks their own name → **their assigned machine is
   pre-filled** from the deployment plan. No typing a vehicle number.
2. `hmr_start` defaults to the previous shift's `hmr_end` for that machine.
   The commonest error becomes impossible.
3. Only checklist items for that department appear.
4. Works on a phone at the gate, offline-tolerant, submit when signal returns.
5. Validation: no future dates, `hmr_end ≥ hmr_start`, licence valid for that
   equipment type — **refuse at entry rather than clean up later.**

**Migration:** all nine legacy tables import into `minehub.hoto` with
`department_id` set from the source table name. Nothing is lost; the old forms
are retired once the new one is live.

---

## 6. Phase 2 — the planning engine

Runs per shift, per location. It answers: *who should be on what, and is that
possible?*

**Inputs**
- Roster — `hr_hrms_emp_shift_plan` (who is scheduled)
- Attendance — `hr_hrms_emp_attendance` (who actually came)
- Competency — `person_competency` (who is allowed on what)
- Equipment status — `equipment` + maintenance state
- Target — `mines_monthly_excavation_plan` broken to the shift

**Output: `minehub.deployment_plan`** — one row per machine per shift with the
person assigned, and a status:

| Status | Meaning |
|---|---|
| `PLANNED` | machine available, certified operator rostered |
| `AT_RISK` | operator rostered but absent, or licence expiring within 7 days |
| `UNMANNED` | machine available, no certified operator available |
| `IDLE_ASSET` | machine down, or no work planned |

**The rules it enforces**, in order:

1. Operator must hold a valid, unexpired competency for that equipment type.
2. Operator must be present today (attendance), not merely rostered.
3. One operator, one machine, per shift.
4. Machine must not be under maintenance.
5. Prefer the operator who ran that machine last — continuity reduces damage.

`AT_RISK` and `UNMANNED` are the point. They are visible **before** the shift,
which is the difference between planning and reporting.

---

## 7. Phase 3 — the MIS

Every screen reads the ledger; none recomputes it.

| Screen | Question it answers |
|---|---|
| **Deployment board** | Who is on what, right now, by location and shift |
| **Availability** | Machines available vs manned vs actually running (Technoton) |
| **Manpower** | Rostered vs present vs deployed; absenteeism by department |
| **Gap & loss** | Target vs capacity, shortfall attributed to a cause |
| **Compliance** | Licences and vehicle documents expiring in 30 days |
| **Utilisation** | Engine vs idle hours, fuel per hour, per machine and fleet |

**Loss attribution** is the output that drives action, because each cause has a
different owner:

| Cause | Owner |
|---|---|
| Machine down | Maintenance |
| Operator absent | HR / contractor |
| Manned but idle | Shift in-charge |
| Running but underloaded | Planning |
| No certified operator | Training |

---

## 8. Things worth adding that were not in the original scope

These came out of the survey. Each is cheap now and expensive later.

1. **Licence expiry tracking.** `DL_No` and `Valid_Upto` are empty on all 133
   driver rows. In a DGMS-regulated mine an expired licence on a running machine
   is a statutory exposure, not an admin detail.
2. **Vehicle document expiry** — fitness, insurance, PUC, permit. Tracked
   nowhere today.
3. **Gate entry as attendance corroboration.** `zpp_win_gate_entry` (110,711
   rows) and `weighbrigde_gate_entry` (66,419) already record vehicle movement.
   Linking them to `equipment_id` gives an independent check on whether a
   machine recorded as deployed actually moved.
4. **Maintenance state.** OEE already consumes SAP M2 breakdown notifications.
   The planning engine must read the same source, or it will plan machines that
   are in the workshop.
5. **Fuel issue reconciliation.** `mines_hsd_fuel_issued` has **1 row** — the
   form exists but is unused. Issued fuel against Technoton-measured consumption
   is a direct theft and leakage control.
6. **Training records.** `kpi_hr_unique_employee_training` holds 596 rows and
   should feed `person_competency` rather than being re-keyed.
7. **Contractor performance.** Once equipment carries `owner_party`, output and
   availability per contractor (`DASHMESH`, `SANY`, `SIDHIVINAYAK`) becomes a
   by-product — useful at contract renewal.
8. **Input validation as a first-class feature.** Two HOTO tables already hold
   future dates. Every new form validates at entry.
9. **Shift-boundary definition.** Production logs a `Shift` and HRMS has its own
   shift master. If they disagree at boundaries, one must be authoritative
   before any per-shift number is trustworthy.

---

## 9. Sequence

| Phase | Deliverable | Blocked by |
|---|---|---|
| **0a** | `person`, `person_competency` + import SAP and driver master | — |
| **0b** | `equipment`, `equipment_alias`, `equipment_compliance` | — |
| **0c** | Admin screens to maintain both registers | 0a, 0b |
| **1a** | `minehub.hoto` + check master; migrate nine tables | 0c |
| **1b** | New HOTO form (mobile-first, pre-filled, validated) | 1a |
| **2a** | Attendance + roster sync into `minehub` | 0a |
| **2b** | Planning engine and `deployment_plan` | 1b, 2a |
| **3a** | Deployment board and availability screens | 2b |
| **3b** | Gap, loss attribution and compliance screens | 3a |

Phase 0a and 0b are independent and can run in parallel.

---

## 10. Decisions needed before Phase 0 starts

1. **Who owns the competency list?** Which department certifies that an operator
   may run an excavator, and who maintains it thereafter?
2. **Contractor operator identity.** Are the 5-digit codes in
   `mines_driver_master` stable and unique per person, or reassigned when
   someone leaves? This determines whether we can key on them at all.
3. **Fleet list source of truth.** Someone must supply the definitive list of
   mine equipment — own and hired — with fleet codes. No system holds it today.
4. **Shift authority** — production `Shift` or HRMS shift master.
5. **Scope of "manpower"** — operators only, or full crew including support
   trades. This materially changes the requirement model.
6. **Hired equipment in Technoton.** Do contractor machines transmit telematics?
   If not, their utilisation can only ever come from HOTO hour meters.

---

## 11. Non-negotiables

- New master and transactional tables live in `minehub` (PostgreSQL), not in the
  shared MySQL.
- No screen recomputes a KPI. Screens read the ledger.
- Every form validates at entry. No future dates, no free-text equipment names,
  no unlicensed assignment.
- Legacy tables are read and migrated, never deleted, until the replacement has
  run in parallel for a full month.
