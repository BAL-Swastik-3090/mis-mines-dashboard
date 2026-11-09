# HOTO — Hand Over / Take Over

**Scope for a mobile application at Kaliapani, and its admin panel in the Mines Dashboard**

Prepared 9 November 2026; reviewed the same day against repository migrations. The original live inventory below was not re-queried during this review; confirm counts and current consumers before implementation. Reuse the existing core model, with additive migrations for missing workflow, evidence and sync controls.

---

## 1. What this is for

At every shift change a machine passes from one operator to the next. Today that handover happens verbally, or on paper that reaches nobody, and three things fall through it:

- **A defect nobody owns.** The outgoing operator knows the reverse alarm is dead. The incoming operator finds out when he reverses. Nothing written down means nothing anybody can be asked about.
- **A machine that should not have moved.** A critical check fails and the machine runs anyway, because refusing it is a conversation with a supervisor and taking it is not.
- **Hours and fuel that do not reconcile.** The meter reading at handover is the only honest boundary between two operators' work. Without it, a shift's output, a machine's utilisation and a fuel issue all rest on figures nobody recorded at the moment they were true.

HOTO closes those by making the handover an event with two named parties, a timestamp, a meter reading, a checklist, and — where something is wrong — a defect that outlives the shift.

**It is not a maintenance system.** It records what the operator found. What happens next is the workshop's, and the handover's only duty to it is to hand over a defect that can be read months later by somebody who was not there.

---

## 2. What already exists — do not rebuild this

Migration `026_shift_deployment_hoto.sql` created the entire model. It has been in production since September 2026 and **nothing reads it**.

| Table | Rows today | What it holds |
|---|---|---|
| `shift_calendar` | 4 | The shifts the mine runs |
| `shift_instance` | 9 | One shift on one production day, at one location |
| `shift_plan` | **0** | Who and what is planned onto a shift |
| `deployment` | **0** | An operator actually on a machine, with start/end meter readings |
| `hoto` | **0** | The handover itself |
| `hoto_template` | 1 | The checklist a handover presents, per asset type |
| `availability_event` | **0** | A machine or operator unavailable, with reason and window |
| `ops_exception` | **0** | Something that needs a human, routed to a role |
| `checklist_item` | 33 | The master list of checks, across three kinds |

### The shifts

| Code | Name | Window | Crosses midnight |
|---|---|---|---|
| `A` | A shift | 06:00 – 14:00 | no |
| `B` | B shift | 14:00 – 22:00 | no |
| `C` | C shift | 22:00 – 06:00 | **yes** |
| `GENERAL` | General shift | 09:00 – 17:30 | no |

C shift crossing midnight is not a detail. A handover at 06:00 belongs to the production day that is ending, not the one starting, and `shift_calendar.production_day_rule` already carries that decision. The mobile app must take the production day from the server, never compute it from the device clock.

### The checklist

`checklist_item` holds 33 items in three kinds — `HOTO` (10), `COMPETENCY` (15), `ATTENDANCE_REASON` (8). Each carries `is_decisive` and `is_required`.

Migration `026` seeds *Standard HEMM handover* with **28 items**, each with a `critical` flag. Verify the active database version before publishing templates. Nine seeded items are critical:

> engine · tyres/tracks · brakes · steering · seat belt · reverse alarm · safety guards · fire extinguisher · leakage

The rest: visual, engine oil, coolant, hydraulic, transmission oil, fuel level, battery, tyre pressure, lights, horn, air conditioning, cabin and door, indicators, wipers, mirrors, windshield, first aid kit, trial test run, unusual noise.

**A failed critical item must block the handover.** `hoto.status` and `hoto.blocked_reason` already exist for this. What the mine has not yet decided is who may override a block and on what authority — see §9.

### The fleet it applies to

97 assets: 60 Tippers, 15 Excavators, 5 Drills, 4 Dozers, 2 Wheel Loaders, 2 Backhoe Loaders, 2 Graders, and one each of Telehandler, Compactor, Water Tanker, Ambulance and Maintenance Van. 276 operators, 27 locations.

One template for all of them is a placeholder. A tipper and a drill do not share a meaningful check list, and `hoto_template.asset_type_id` already allows one per type.

### What does **not** exist

No API. No screens. No mobile client. `hoto`, `deployment` and `shift_plan` have never held a row. **This project is to finish and expose what is there, not to design it.**

---

## 3. Scope

### In

- A mobile application for Android phones and tablets, used at the face and at the workshop gate
- Operator-facing handover capture, working **offline**
- Supervisor-facing deployment and exception handling on the same app
- An admin panel inside the Mines Dashboard for masters, planning, the register and reports
- The API layer between them

### Out

- iOS. No iPhones or iPads are in use at the mine; adding them later costs a build target, not a rewrite, if the app is built cross-platform.
- Work-order creation and maintenance scheduling. HOTO raises a defect; the workshop system owns it.
- Replacing the attendance/biometric system. HOTO reads who is on shift; it does not mark attendance.
- Fuel issue. `073_fuel_is_a_process_not_a_spreadsheet` already owns that. HOTO records the **fuel level observed at handover**, which is a different fact.

---

## 4. The mobile application

### 4.1 Who uses it, and on what

| User | Device | What they do |
|---|---|---|
| Operator | Shared tablet at the face, or own phone | Take over, hand over, raise a defect |
| Shift supervisor | Tablet | Deploy, resolve blocks, close the shift |
| Workshop / safety | Phone | Read defects raised against a machine |

Tablets are **shared**, which drives the single most important design decision below.

### 4.2 A shared device means the session is per handover, not per day

A tablet left signed in as whoever used it last will produce handovers attributed to the wrong operator, and nobody will notice until a dispute. So:

- Signing in identifies the **device**, not the person. The device holds a long-lived credential issued by the admin panel and revocable from it.
- Every handover identifies **both operators at the moment of the handover** — outgoing and incoming — and the identification is part of the record, not the session.
- The app returns to a neutral screen after each handover. There is no "logged in user" to inherit.

`hoto.outgoing_confirmed_by` / `outgoing_confirmed_at` and `incoming_confirmed_by` / `incoming_confirmed_at` already model this as two separate confirmations. Use them as four distinct facts, not as one submit button.

### 4.3 How an operator is identified

In order of preference, and the mine should pick one as primary:

1. **Employee number typed, confirmed against a photo.** The app shows the name and face from `sap_employee_details`; the operator confirms it is him. Cheap, works offline, and the photo makes a wrong number obvious.
2. **QR or NFC on the operator's existing ID card.** Faster, fewer mistakes, needs cards that carry it.
3. **Face match** against the existing SmartFace system, subject to integration and field accuracy validation. Requires network unless an approved offline capability is available.

(1) is the floor and must work regardless, because the other two will fail at some point and a handover cannot wait.

An employee number and displayed photo identify a person but do not authenticate a confirmation. Each operator must separately confirm using an approved method, such as a personal PIN with offline attempt limits and a time-limited cached verifier. Never store plain-text PINs. A card scan alone has the same limitation. A witnessed fallback must record the witness, reason and operator acknowledgement under the agreed site policy. Supervisor decisions require individual authentication; a device credential grants no override authority.

**Competency is checked here.** `checklist_item` kind `COMPETENCY` holds 15 items and the operator register already records machine-level competency (`022_machine_level_competency`). An operator taking over a machine he is not signed off on is an `ops_exception`, not a silent pass.

### 4.4 Offline is the default, not a fallback

There is no reliable network at the working face. The app must assume there is none.

- Every screen works from local storage. A handover is captured, confirmed by both parties and **stored complete** with no server contact.
- A local queue holds unsent handovers. The operator sees the count and can keep working.
- Sync happens when a network appears — at the gate, at the workshop, on site Wi-Fi — without anyone asking it to.
- **Reference data is cached:** the assets, operators, locations, shift calendar, template and checklist items. Refreshed on sync, usable for at least 7 days stale.
- The server assigns `hoto_ref` and `deployment_ref`. The device assigns a **client-generated id** that travels with the record so a retry cannot create the same handover twice.

**What the device must never decide:** the production day, the shift instance, or whether a competency is valid. All three come from cached server data, and when the cache is too old to trust, the app says so rather than guessing.

### 4.5 Screens

**Home.** The device's location and current shift. Two actions: *Hand over a machine*, *Take over a machine*. A badge showing unsent handovers.

**Pick the machine.** Search and scan. Shows what the register knows — asset number, type, last recorded meter reading, any open defect, whether it is marked unavailable in `availability_event`. A machine with an open critical defect is shown as such **before** anyone starts.

**Identify the outgoing operator.** Per §4.3. Pre-filled from the open `deployment` if there is one, because the machine already knows who was on it.

**The checklist.** Items from the published template for that asset type. Each: OK / Not OK / Not applicable. Required items cannot be skipped. Critical items cannot be Not applicable unless the published template explicitly permits it, with a reason. **Not OK requires a note and photo evidence, or a recorded reason why capture was impossible.** Missing evidence remains visible for review and never clears a block.

**Readings.** Meter reading and fuel level, into `hoto.meter_reading` and `hoto.fuel_level`. The meter must be checked against the last recorded value — a reading that went backwards, or jumped implausibly, is queried on the spot, not accepted and reconciled later.

**Defects.** Anything marked Not OK becomes a defect carried in `hoto.defects`. Photo, note, and whether the machine can still run.

**Outgoing confirms.** The outgoing operator reviews and confirms. Timestamped into `outgoing_confirmed_*`.

**Identify the incoming operator, who confirms.** Separately, on the same device, after seeing what he is accepting. Timestamped into `incoming_confirmed_*`. **This is the point of the whole exercise** — the incoming operator has seen the defects and accepted the machine anyway, or has not.

**Blocked.** If a critical item failed, the handover is `BLOCKED` with `blocked_reason`. The machine is not taken over. An `ops_exception` is raised to the supervisor. The incoming operator cannot clear this himself.

**Supervisor screens.** Today's deployments, open blocks, exceptions awaiting a decision, and close-the-shift.

### 4.6 Photos

Photo evidence is required for failed checks and the meter reading, with a reasoned exception when capture is impossible. Templates may also require overview or fuel-gauge photos. Each photo links to its HOTO, asset, checklist item or defect, capturing operator and device.

- **Capture inside the app** for fresh inspection evidence. Gallery imports, if permitted for supporting documents, are labelled imported and cannot satisfy a fresh-photo requirement.
- **Geotag every photo at capture:** latitude/longitude in WGS84, horizontal accuracy in metres, fix time, photo capture time, location source and permission/availability status. Store structured metadata alongside the file; do not rely on EXIF surviving compression. A selected master location is separate from measured coordinates.
- Request a fresh foreground location fix. Initial pilot targets: fix age at most 60 seconds and accuracy within 50 metres, configurable and subject to field validation. Record actual values; never silently reuse a stale fix or invent coordinates.
- Capture works offline. GPS disabled, permission denied, timeout, poor accuracy and reported mock location have explicit evidence-quality states. Save the evidence with a reason and show **location unverified** for supervisor review. Geotags support review but do not by themselves prove presence or authenticity.
- Where configured, compare usable coordinates against a versioned site boundary or approved handover zone. Flag outside-zone captures; preserve the chosen location and record the boundary version and result.
- Show coordinates, accuracy, capture time and verification state beside photos in the register, with an optional map when connected. A visible timestamp/location watermark is optional; structured metadata remains the record.
- Compress before queueing while keeping meter digits and defects readable. Starting pilot limits: 1600-pixel longest edge, 1 MB target, 2 MB maximum per image. Default to 12 photos per handover, configurable by template; verify capacity on actual tablets and allow enough evidence for every failed check.
- Upload independently with retries. Show **record synced / evidence pending / evidence complete / upload failed** separately from HOTO business status. Keep local files until server acknowledgement and checksum verification; pending evidence remains visible in reports.
- Store files outside the database. Metadata includes client attachment UUID, storage reference, MIME type, byte size, checksum of stored evidence, capture/receipt times, geotags and upload state. A checksum detects byte changes, not a fabricated scene. Never overwrite submitted evidence.
- Use authorised downloads, encrypted transport and encrypted local storage. Capture location for handover evidence only; continuous tracking is outside scope. Agree retention, deletion, backup and restoration for records and photos before rollout.

### 4.7 Offline reconciliation and deployment transitions

- Preload server-issued shift instances, production days, template versions and competency validity windows. Cache age alone is insufficient: validity must cover capture time. If assignments or authority are unavailable or expired, retain a draft and raise an exception; do not present it as an authorised takeover.
- Separate local draft/queued/sync-error states from server states (`PENDING`, `BLOCKED`, `COMPLETED`, `CANCELLED`). Show locally captured versus server-accepted confirmation. Cached readiness is provisional; revalidate on sync and preserve discrepancies for review.
- Save drafts, confirmations, metadata and queue changes transactionally. App restart, power loss and interrupted uploads must not lose work. Retry with backoff and manual retry; never silently discard rejected records.
- Enforce idempotency per handover and attachment. Identical replay returns the original result; reuse of a key with different content is a conflict. Replace or protect the existing `MAX + 1` reference helpers with concurrency-safe allocation before concurrent use.
- Two offline devices handing over the same asset produce a retained conflict for supervisor resolution. Never silently overwrite a submission or create overlapping active deployments. Revalidate operator availability and meter continuity on sync.
- Accepted takeover closes the outgoing deployment and creates the incoming deployment in one server transaction, using the same boundary reading and event time. Blocked or declined takeover never starts an incoming deployment. Define idle/release handling so a refused machine is not falsely left running.
- Support first deployment without an outgoing operator, parking without an incoming operator, mid-shift relief, breakdown and incoming refusal. Record event type and missing-party reason; never fabricate a second confirmation. Shift closure shows unresolved and missing records, last device sync and any authorised closure exception. Central reporting must acknowledge that disconnected devices may still hold records.

### 4.8 Readings, defects and record integrity

- Define each asset's meter type/unit (hours or kilometres), precision and plausible change against elapsed time. Fuel initially uses percent, 0–100; do not mix litres and percentages. Meter replacement/reset requires an authorised history event, reason and evidence.
- Published templates are versioned and effective-dated. Preserve exact labels, answers, required/critical flags and the version used at capture. Server validation uses that published version; a client cannot downgrade a critical item.
- Link repeat observations to the existing open defect. Minimum lifecycle: raised, acknowledged, rectified, independently verified, with owner, action times, repair evidence and release authority. Acceptance or acknowledgement does not clear a critical defect. Closing an exception alone does not release the machine.
- Confirmations bind to the reviewed answers, readings, defects and attachment manifest. Material changes require renewed confirmation or an attributed amendment preserving the original. Audit corrections, cancellations, overrides and releases with actor, device, event/receipt times, reason and before/after values.

---

## 5. The admin panel in the Mines Dashboard

A new section, built the way the existing ones are: Next.js page, FastAPI router, `response_model` declared **in the same commit** as any service field it carries (see `CLAUDE.md` — this has cost us a day already).

### 5.1 Masters

- **Shift calendar.** Exists, 4 rows, needs a screen. Editing a shift is dated — `valid_from` / `valid_to` are already there.
- **Checklist items.** 33 rows, needs a screen. Add, retire, reorder, set `is_decisive`.
- **HOTO templates.** One per asset type. Clone from an existing one, because a grader's list is a dozer's list with three changes.
- **Devices.** Register a tablet, issue its credential, revoke it, see when it last synced. **This does not exist in the schema and must be added** — see §6.

### 5.2 Shift planning

`shift_plan` is the planned deployment — which operator on which machine, at which location, for which activity. The supervisor builds it in the dashboard before the shift; the app reads it as the expected state so an operator taking over a machine he was not planned onto is visible rather than invisible.

Planning must tolerate reality: the plan is a plan, and `deployment.override_by` / `override_reason` already exist because the mine will deviate from it and the system's job is to record that, not forbid it.

### 5.3 The HOTO register

Every handover, searchable by machine, operator, shift, date and status. For each: both confirmations with their timestamps, the full checklist as answered, readings, defects and photos.

This is the screen that gets opened when there is an argument. It must read as a record, not a dashboard — what was found, who confirmed it, when, and what was done.

### 5.4 Exceptions

`ops_exception` has `kind`, `severity`, `owner_role`, `status`, `resolution` and a `dedupe_key`. The queue needs: what happened, which machine and operator, who owns it, how long it has been open, and what was decided.

`dedupe_key` exists so the same unresolved condition does not raise fifty exceptions across fifty handovers. Use it.

### 5.5 Reports

- Handover compliance — how many shift changes produced a HOTO, against how many should have
- Defects by machine, by type, open and closed, with age
- Critical failures and blocks, with what was decided
- Meter reading continuity — gaps and reversals, which is where under-reporting shows
- Competency exceptions — who took what they were not signed off on

**Compliance is the one to build first.** A HOTO system that is used on half the handovers produces a register that is worse than no register, because its silences look like clean shifts.

---

## 6. What the data model still needs

Reuse the core tables and extend them through new migrations where needed; do not edit historical migration `026`. Its current schema does not enforce all requirements in this scope.

| Need | Why |
|---|---|
| **Device register** | A shared tablet needs an identity, a credential, a revocation and a last-seen. Nothing models this today. |
| **Defect lifecycle** | `hoto.defects` records what was found. A defect that outlives the handover — raised, acknowledged, rectified, verified — needs its own table, or it is only ever a note inside one shift's record. |
| **Photo / attachment store** | `033_document_renewals_and_files` already handles files; confirm it fits rather than adding a second mechanism. |
| **Sync audit** | When a handover reached the server, from which device, and whether it was captured offline. Needed to explain a record that arrived six hours after its own timestamp. |
| **Per-type templates** | The table supports it; the data has one row. |
| **Evidence and integrity controls** | Per-photo geotags, attachment manifests, template versions, idempotency keys, confirmation payloads and append-only action history need explicit persistence and constraints. |

Every one of these is a migration in `minehub/migrations/`, written **in the same branch as the code that reads it**. Two features shipped this month without theirs and were caught at review; `minehub/check_migrations.py` exists because of it.

---

## 7. Permissions

Roles live in `role` / `permission` / `role_permission` / `user_access`. New permissions, following the `module.thing.verb` convention already in use:

Migration `026` already seeds `ops.shift.view`, `ops.shift.manage`, `ops.hoto.record` and `ops.override`. Map existing grants to the proposed capabilities below before adding permissions; avoid duplicate authority paths. Enforce role and site access on the server for both records and attachment downloads.

| Permission | Who |
|---|---|
| `hoto.capture` | Operators — the mobile app's own permission |
| `hoto.view` | Supervisors, workshop, safety, management |
| `hoto.override` | **Narrow.** Who may release a blocked machine |
| `hoto.admin` | Masters, templates, devices |
| `hoto.plan` | Build and publish a shift plan |

`hoto.override` is the one that matters. A block exists to stop a machine with failed brakes going to work, and a permission held by everybody is not a control. It should sit with a named role and appear in the register beside every override it authorised.

**One caution from experience.** The sidebar gates PR to Payment on a permission created for an unrelated shortcut, which 13 of 15 roles hold — so that module is effectively open to anyone who can sign in. Do not repeat it here: give HOTO its own permissions and gate on those.

---

## 8. Non-functional

| | |
|---|---|
| **Devices** | Android 11+. Assume a cheap tablet with a poor camera and a cracked screen. |
| **Network** | None at the face. Design for sync at the gate. |
| **Battery** | A shared tablet is on charge between shifts, not during. No background polling. |
| **Storage** | 7 days of queued handovers with photos, worst case, without filling the device. |
| **Time** | Store capture time, timezone/offset, last server time anchor and receipt time; flag clock drift. Receipt time establishes ingestion, not when an offline inspection occurred. Preserve uncertainty and the server-issued production-day assignment. |
| **Language** | Odia and Hindi labels for the operator-facing screens. The checklist is read by people who do not read English comfortably, and an unread checklist is ticked through. |
| **Accessibility** | Gloves, sunlight, dust. Large targets, high contrast, minimal typing. |

---

## 9. What the mine has to decide

These are process questions, not technical ones. The build should not start on the blocked-handover path until the first three are answered.

1. **Who may override a blocked machine, and what do they put their name to?** A supervisor? Only the mines manager? Written reason mandatory?
2. **What happens when no handover is done at all** — machine idle, operator absent, shift not manned? Is a missing HOTO an exception, or silence?
3. **May an operator take over a machine he is not competency-signed for,** with an override, or never?
4. **Is a per-asset-type template wanted now, or is one list acceptable to start?**
5. **Which identification method is primary** — employee number plus photo, card scan, or face?
6. **Does the handover need a drawn signature,** or is a confirmed tap with an identified operator sufficient? (A tap is more defensible than a scrawl on a 7-inch screen, but the mine may want the signature for its own reasons.)
7. **Who receives a critical defect** — workshop directly, or the supervisor who then routes it?
8. **Which failures are never overridable?** Approve the release matrix, repair verification and authority before enabling overrides. Until agreed, critical blocks stay blocked.
9. **What is the location/evidence exception policy?** Approve zones, accuracy/freshness targets, missing-photo/GPS reasons and responsible reviewers.
10. **What are retention and escalation rules?** Assign record/photo retention, export, deletion and backup ownership, plus defect acknowledgement deadlines and escalation when notifications fail.
11. **How are absent parties and offline authority handled?** Agree witnessed confirmation, credential/cache expiry, missing-HOTO deadlines and shift closure rules.

---

## 10. Suggested phasing

**Phase 1 — make it real.** API over the existing tables, the HOTO register in the dashboard, and masters for shifts, checklist items and templates. No mobile app yet. **Supervisors capture handovers in the dashboard** for one section, on tablets, to prove the model against actual shift changes before a mobile build is committed to. This is the phase that finds out whether the data model matches the mine.

**Phase 2 — the mobile app.** Offline capture, both authenticated confirmations, readings, defects with geotagged photos and sync. One section, one shift, alongside the paper it replaces. Applicable per-type templates, basic defect ownership/release, exception handling and compliance visibility are prerequisites for the operational pilot.

**Phase 3 — expand.** All sections, richer defect workflows and reporting, building on the controls proven in the pilot.

**Phase 4 — what the data is worth.** Meter continuity against the weighbridge and the shift log, defect trends by machine, competency exceptions, handover compliance as a management figure.

Phase 1 exists to be wrong cheaply. The tables were designed in September without a working handover to check them against; the first real shift will have something to say about them, and it is far better to hear it from a web form than from a deployed Android build.

---

## 11. Decisions this document is taking

Stated plainly so they can be argued with:

- **Offline-first, not offline-tolerant.** It changes the architecture and cannot be retrofitted.
- **Identification per handover, not per session**, because the tablet is shared.
- **Two separate confirmations**, because the incoming operator accepting a known defect is the record's whole point.
- **Critical failure blocks**, with override as a named, narrow, recorded permission.
- **The server owns the production day, the shift, and competency.** The device owns nothing it could get wrong.
- **Dashboard first, mobile second.** Prove the model before building a client against it.

---

## 12. Pilot acceptance criteria

Demonstrate these on the intended devices with operators, supervisors, workshop and safety before replacing paper:

1. Complete offline capture with separate authenticated confirmations, readable photos and per-photo geotags. Restart the device and sync without loss or duplication.
2. Capture with GPS denied, stale, inaccurate, unavailable and outside an approved zone. Preserve actual metadata, reason and review status in every case.
3. Interrupt and retry uploads; show pending evidence until all files are acknowledged. A nearly full device warns before capture and never deletes unsynced evidence.
4. Submit conflicting handovers from two devices and replay identical requests. Retain conflicts, prevent overlapping deployments and return one record per idempotent submission.
5. Fail a critical check; attempt unauthorised override, Not applicable and exception closure. The machine stays blocked until the agreed release conditions are satisfied and audited.
6. Test midnight and 06:00 C-shift boundaries, incorrect device clocks, expired competency/cache and meter reset. Use server-issued assignments and flag uncertainty.
7. Change a template after capture and attempt to alter a confirmed record. Original evidence remains readable and material changes require renewed confirmation.
8. Test first deployment, relief, parking, absence and declined takeover; deployment history and missing-HOTO reporting match the agreed process.
9. Verify role/site access, shared-device reset, revoked-device handling and attachment access. Recover queued evidence through an authorised path and restore both records and photos from backup.
10. Reconcile expected handovers against deployments, plans and explicit idle/absence reasons, including late records and pending evidence. Export an individual HOTO with audit history and attachment manifest.

Size the pilot for handovers per device/day, photo volume and seven-day offline storage. Agree measurable capture/sync time targets using site connectivity, and record operational acceptance before wider rollout.

---

## 13. The earlier attempt — read it before designing anything

`D:\Projects\Mines\mine_system` holds a previous run at this: **20 commits, seven design documents, and working scaffolds** for a .NET 8 backend, a Flutter mobile app and a React admin. It stopped, but it is not wasted — its process thinking is **more complete than sections 1-12 of this document**, and several decisions in it were taken with the stakeholder and should not be reopened.

Its database lived on DigitalOcean, not here. Verified on 9 November: `corpappdb` has no `mineone` schema and no `mo_`-prefixed table anywhere, so there is nothing stale to clean up and no data to migrate.

### 13.1 Decisions already locked with the stakeholder

| # | Decision |
|---|---|
| 1 | **One app for any phone or tablet (BYOD) *and* company tablets** — two device profiles, PERSONAL (single-user, app-level security) and COMPANY (shared, MDM-locked, kiosk) |
| 2 | **All five roles ship in Release 1** — Admin, Operator, Supervisor, Maintenance, Manager |
| 3 | **Both vehicle types** — in-pit tippers in HOTO allotment; external despatch trucks referenced, not managed |
| 4 | **English, Hindi and Odia** — English first, Hindi and Odia in R2 |

Decision 2 is the one that changes planning here: section 10 phases by depth, which is compatible, but it cannot phase by role.

### 13.2 What that design has that this document lacked

- **Two distinct levels.** L1 is the operator's form — one machine, one shift. L2 is the **Shift HOTO Board**, a supervisor view rolling up every machine in a shift with *Approve / Restrict / Lock* per machine. It is a projection, not a new table. This document described supervisor screens but not the board as the supervisor's primary surface.
- **Three HOTO types per shift, not one handover.** `START_HANDOVER`, `MID_SHIFT` (about T+4h), `END_HANDOVER` — one row per (equipment x shift x type). See 14.1; this conflicts with the schema.
- **Three-state answers: OK / CAUTION / NOT OK.** Not the binary this document assumed. CAUTION is how a mine actually talks about a machine that runs but needs watching, and it maps onto the state machine below.
- **An equipment state machine**: AVAILABLE, RUNNING, CAUTION, RESTRICTED, BREAKDOWN, UNDER_MAINTENANCE, LOCKED — each with "allotable?" and "operable?", and every transition written to history.
- **A severity engine driven by a rule table, not code.** LOW notifies; MEDIUM raises a work order; HIGH restricts the machine; CRITICAL locks it and stops shift allocation. Severity comes from the checklist item with per-equipment-type overrides, and the rules are **mirrored on the device** so an offline capture reaches the same verdict the server would.
- **Checklist composition as configuration**: base template per equipment type, plus department-scoped extras matched on (plant, department, equipment type). Adding a check is a config change.
- **A shared-device login model worked through properly**: device enrolment issues a long-lived site-bound token; operator quick-auth per action by PIN or NFC badge, validated against a **locally cached hashed credential store synced per site**, so identification works with no network at all. Every record carries `device_id`, `device_profile` and `operator_id`.
- **Plant as well as mine.** Templates for ETP, Dewatering and the Sukinda furnace sections, sized for 2 sites, ~150 equipment and ~500 operators. This document was written for the mine alone and is narrower than the committed scope.

### 13.3 What it assumed that is no longer true

It was designed as a **standalone platform** — its own database, its own equipment and operator registers, its own role and permission model, its own identity via Entra ID, a .NET 8 service and a separate React admin.

None of that is free any more. The Mines Dashboard already holds the equipment register (97 assets), the operator register (276), parties (499), locations (27), the shift calendar, competency, a working role and permission system, and the access control to administer it. Rebuilding alongside it produces **two equipment registers that will disagree within a month**, and two answers to "who may see this".

---

## 14. Reconciling the two

### 14.1 The one real conflict: session model vs handover model

| | Earlier design | `minehub.hoto` as built |
|---|---|---|
| Unit of record | One row per (equipment x shift x **type**) | One row per **handover** |
| Parties | One operator attests per row | Outgoing **and** incoming confirm the same row |
| Mid-shift check | A first-class type | No place for it |

**The session model is the better one and the schema should move to it.** Three reasons:

1. A mid-shift check has nowhere to live in the handover model, and the mine does one.
2. The outgoing operator finishing at 13:55 and the incoming operator accepting at 14:05 are two attestations minutes apart, each about what *that person* saw. Forcing them onto one row makes the record depend on both being present at one device — exactly the case that fails when a shift runs over.
3. A first deployment with no outgoing operator, and parking with no incoming operator, are normal. The handover model has to fake a party or leave half a row; the session model just has fewer sessions.

`hoto` has never held a row, so this costs a migration and nothing else. Keep `outgoing_*` / `incoming_*` as the **link between two sessions** rather than two halves of one record, or drop them for a `session_type` plus a single confirming operator. **Sections 4.5 and 11 assume the handover model and need revising once this is settled.**

### 14.2 The existing schema covers more of that design than it assumed

Checked against `minehub` (154 tables) on 9 November:

| Earlier design wanted | Already here |
|---|---|
| Machine timeline | **`event`**, partitioned by month, `event_2026_06` through `event_2027_02`, with the partition generator already running |
| Equipment state | `asset_lifecycle`, `availability_event` |
| State history | `asset_revision` |
| Custom fields | `field_definition` |
| Alerts and acknowledgement | `platform_alert`, `platform_alert_ack` |
| Competency | `competency`, `operator_competency`, machine-level since migration `022` |
| Exceptions routed to a role | `ops_exception`, with `dedupe_key` |

**Genuinely missing, and the whole of section 6's list:** a device register, and a defect/issue lifecycle with work orders. `ops_exception` carries an exception; it is not a defect that survives a shift, gets acknowledged, repaired and verified.

### 14.3 Recommendation

Build it **inside the Mines Dashboard** — FastAPI router, Next.js admin, `minehub` schema, the existing role model — and take the earlier design's **process** wholesale: the two levels, three session types, three-state answers, the state machine, the severity rule table, device profiles, the offline credential store.

Keep from `mine_system`:

- `docs/HOTO_PROCESS.md` — the two levels and the daily session sequence
- `docs/HOTO_Mobile_App_Technical_Design.md` — the 15 phases, the state machine, the severity engine, the login model
- The Flutter scaffold, if the mobile stack stays Flutter

Discard: the .NET backend, the separate React admin, the standalone schema and the second identity system.

**The mobile stack is the one open technical choice.** Flutter is already scaffolded and the earlier design committed to it; the dashboard is React/Next. Flutter means two frontend stacks in the estate and a second skill set; React Native means reusing one. A PWA will not do here — offline capture with encrypted local storage, NFC badge reads and camera control on a kiosk-locked tablet is not PWA territory. **Recommend Flutter**, because it is already started and it is the stronger offline client, and accept the second stack knowingly rather than by drift.

### 14.4 Questions section 9 can now stop asking

Four of the seven are answered by 13.1 and the earlier design:

- **Identification method** — PIN as the offline baseline, NFC badge for speed, face in V2. Section 4.3's ordering should change to match.
- **Signature** — an authenticated confirmation carrying `device_id` and `operator_id`, not a drawn signature.
- **Per-type templates** — yes, and department-scoped extras on top.
- **Who receives a critical defect** — the severity engine routes it; CRITICAL locks the machine and notifies everyone.

Still genuinely open, and still blocking the blocked-handover path: **who may override a lock and on what authority**, **what a missing handover counts as**, and **whether an operator may ever take a machine outside his competency**.

---

## 15. The earlier database still exists — what is in it

Found on 9 November. It is not on a dedicated droplet: it lives **inside the `enterprise-ai` pgvector instance** on the DigitalOcean host, as `corpappdb` → schema **`mineone`**, 53 tables with the `mo_` prefix. It has been running untouched for seven weeks.

```
ssh digitalocean
docker exec -it 4df310c51905_enterprise-pgvector psql -U enterprise -d corpappdb
\dt mineone.*
```

### 15.1 There is nothing operational to migrate

| Table | Rows |
|---|---|
| `mo_equipment` | 4 |
| `mo_hoto_sessions` | 7 |
| `mo_hoto_responses` | 12 |
| `mo_users` | 9 |
| `mo_issues` | 1 |
| `mo_equipment_state_histories` | 3 |
| `mo_machine_timeline_events` | 3 |
| `mo_devices`, `mo_attachments`, `mo_maintenance_workorders`, `mo_outbox_messages`, `mo_sync_logs`, `mo_sync_receipts`, `mo_shift_events`, `mo_shift_closure_reports`, `mo_operator_competencies` | **0** |

Four machines and seven handovers is a demo, not a pilot. **No production data, nothing to carry across.** The value in that database is its *configuration*, not its contents.

### 15.2 The checklist library is the asset worth taking

Three complete, sectioned templates — far beyond the single flat template in `minehub`:

| Template | Sections | Items | Critical |
|---|---|---|---|
| Tipper / Dumper | 6 — Engine · Air & Brakes · Tyres · Body & Tipping · Safety · Fluids | 24 | 4 |
| Dozer | 5 — Engine · Hydraulics · Undercarriage · Safety · Fluids | 17 | 3 |
| Excavator | 4 — Engine · Hydraulics · Safety · Fluids | 13 | 2 |

54 items in 15 sections. Somebody who knows these machines wrote it, and writing it again from nothing would be the most wasteful thing available here.

### 15.3 Its item model is richer than ours, and this is the real finding

`mo_checklist_items` carries:

```
label, response_type, unit, min_value, max_value, category,
is_critical, requires_photo_if_not_ok, default_severity, display_order
```

**Four response types, not one:**

| Type | Items | Example |
|---|---|---|
| `OkCautionNotOk` | 31 | the tri-state this document already assumed |
| `Numeric` | 11 | a gauge reading with a unit and a plausible range |
| `YesNo` | 7 | present / absent |
| `Level` | 5 | a level, not a pass/fail |

Numeric items carry real engineering limits:

| Item | Unit | Range | Severity |
|---|---|---|---|
| Air pressure | psi | 80 – 120 | **Critical** |
| Engine oil pressure | bar | 2 – 6 | High |
| Coolant / water temperature | °C | 60 – 95 | High |
| Fuel level (start) | % | 0 – 100 | Low |
| Boom pressure | bar | — | High |

And every item carries its own `default_severity`, which is what drives the escalation engine in §13.2 — Medium on 23 items, High on 16, Low on 8, Critical on 7.

**`minehub.checklist_item` cannot express any of this.** It has `kind, code, label, help, asset_type_id, is_decisive, is_required, sort_order` — no response type, no unit, no range, no severity, no sections, no photo rule. So the schema work in §6 is larger than "a device register and a defect lifecycle": **the checklist model itself needs replacing**, and §2's description of the existing checklist as usable groundwork is too generous.

An out-of-range gauge reading is a different fact from a failed tick-box, and a mine runs on gauges. This is not a nicety.

### 15.4 Other things built there that this document never considered

Present in `mineone`, absent from both this document and `minehub`:

- **A process engine** — `mo_process_definitions`, `_versions`, `_steps`, `_triggers`, `_subject_types` (8), `_instances`, `_responses`, `_checkpoints`. HOTO was being built as one instance of a general "process on a subject" engine rather than a bespoke form. Ambitious, and worth a deliberate yes or no rather than inheriting by accident.
- **Change requests with approvals** — `mo_change_requests`, `mo_change_request_approvals`. A master-data edit going through approval.
- **Module-level access** — `mo_modules` (12), `mo_module_grants` (20), `mo_user_module_access`, alongside a full RBAC of 45 permissions, 8 roles and 74 role-permission rows.
- **Geology and QC** — `mo_geo_surveys`, `mo_geo_samples`, `mo_qc_inspections`, `mo_qc_assays`. Outside HOTO entirely.
- **Sync as first-class** — `mo_outbox_messages`, `mo_sync_logs`, `mo_sync_receipts`. Defined, never used, but the shape agrees with §4.7.

### 15.5 What to do with it

1. **Export the checklist library now**, before the droplet is repurposed — the three templates, fifteen sections and fifty-four items, with response types, units, ranges, severities and photo rules. This is the one irreplaceable thing on that host.
2. **Extend `minehub`'s checklist model** to hold it: sections, `response_type`, `unit`, `min_value`/`max_value`, `default_severity`, `requires_photo_if_not_ok`. Migration, not a rewrite.
3. **Decide on the process engine deliberately.** Building HOTO as a configured process is a bigger and more general thing than building a HOTO module. It may be right; it should not be inherited silently.
4. **Leave the rest.** The .NET service, the separate RBAC, module grants, geology and QC all duplicate things the dashboard already has or does not need.
5. **Do not decommission the droplet** until the export is verified. It also hosts a live AI platform, so this is not a decision to take casually in either direction.
