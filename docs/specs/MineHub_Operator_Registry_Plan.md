# Operator Registry — Plan

**Kaliapani Mines · MineHub Platform**
Prepared 17 September 2026 · for review before any code is written

---

## 1. What this is

The equipment register answers *what machine is this*. This answers *who is allowed to run it, and who actually ran it*.

The same shape as the equipment work: one identity per person, drafts that can be saved incomplete, submission and approval by two different people, a revision trail on every change, and lists that build themselves as the mine meets them. Nothing here is a new pattern — it is the same pattern applied to people, which is the point. Someone who has learnt the equipment form should need no training for this one.

---

## 2. What exists today

### 2.1 `mines_driver_master` — 133 rows

The mine already keeps a driver list. Profiling it says more about the problem than any description could:

| Column | What is actually in it |
|---|---|
| `Driver_Name` | 133 rows, 133 distinct names — no duplicates, so far |
| `Emp_Code` | 115 five-digit codes; **18 rows have none at all** |
| `Equipment_Type` | **Machine identities, not types**: `MAN-14`, `TATA-470(7)`, `CAT DOZER`, `JCB 3DX` |
| `DL_No` | **Empty in all 133 rows** |
| `Valid_Upto` | **Empty in all 133 rows** |
| `Age` | Empty |
| `Driver_Status` | `P` / `S` — primary or secondary, undocumented |

Three things follow from this.

**The licence fields exist and have never been filled.** Every row is blank. So the list cannot today answer "is this person licensed", which is the first question anyone asks after an incident. A field that is optional and unasked is the same as a field that is absent — the operator form must treat statutory documents the way the equipment form treats insurance and fitness: a named row with an expiry date that surfaces on the Alerts screen before it lapses.

**`Equipment_Type` is really "the machine this person is on".** `MAN-14` is a tipper, not a type of tipper. The column conflates two different facts — what a person is *qualified* to operate, and what they were *assigned to* — and can express neither properly. An operator qualified on excavators reads as qualified on `Excavator Long Boom 470-2`, and when that machine leaves the fleet the qualification goes with it.

**108 of the 133 codes match the SAP employee master; 25 do not.** Those 25 are either contractor staff who were never in SAP, or codes typed wrong. Both are real situations needing different answers, and today nothing distinguishes them.

### 2.2 Handover — a second, livelier population

`mines_hand_over_take_over` (311 rows, plus eight sibling tables for COB, dewatering, electrical, ETP and the Sukinda variants) records `handoverEmpId` / `takeoverEmpId` against a machine, a shift and around **thirty inspection checkpoints** — brakes, tyres, fire extinguisher, reverse alarm, seat belt.

This is where operators actually appear, every shift, already. It is a better record of who ran what than the driver master is, and the two are not connected. Two lists of the same people, neither aware of the other.

### 2.3 Where operator absence already costs money

`mines_tipper_details` carries `absence_operator` as a named downtime reason, alongside `tipper_shortage` and `lmv_availability`. The mine already loses measurable hours to operators not being there — but because no shift record names the person, the loss cannot be traced to a roster, a shortage of qualified people on a machine class, or anything else that could be acted on.

### 2.4 Agencies

`mines_agency_master`: **BAL, DASHMESH, SANY, SIDHIVINAYAK**. Contract operators belong to these, own operators to BAL. The equipment register already models contractors as `party` rows, and operators will use the same table — an agency is a party, a person is a party, and one employs the other.

### 2.5 What the platform already has ready

Four tables built during the registry work, all empty, all waiting for exactly this:

- `party` — people and organisations
- `party_identity` — the codes other systems know a person by
- `party_employment` — who employs them, in which department, since when
- `competency` — what a person is certified to operate, with expiry

No new core tables are needed. This plan is mostly about filling these correctly and putting a form in front of them.

---

## 3. The four problems worth solving

1. **Identity.** One person, one record, with every code that refers to them hanging off it — SAP employee id, contractor code, gate pass, biometric id. The equipment register solved this for machines; the same disease is here.
2. **Competency.** What is this person allowed to operate, *by class*, and until when. Separate from what they were driving last Tuesday.
3. **Statutory currency.** Licence, medical, vocational training, first aid — each with an expiry visible before it passes, not after.
4. **Assignment.** Who is on which machine, on which shift — the question handover answers daily and the driver master answers vaguely.

---

## 4. Data model

Built on what exists. New tables are marked **new**.

### 4.1 The person

`party` (exists) — one row per operator, `party_type = 'PERSON'`. Name, gender, date of birth, blood group, phone, photo.

Blood group and date of birth are not decoration: blood group is asked for at the first aid post, and age governs who may be deployed on certain work.

### 4.2 Their codes

`party_identity` (exists) — SAP `EMPID`, contractor code, gate pass number, biometric id, the driver master's own `Emp_Code`. One row each, so a person found by any of them is the same person.

This is what lets the 25 unmatched driver codes be resolved one at a time instead of all at once, and what will eventually let handover records join to the register without rewriting handover.

### 4.3 Who they work for

`party_employment` (exists) — employer (BAL or an agency), department, designation, employment type (own / contract / trainee), valid from and to.

Employment is dated on purpose. A contractor's operator who moves to another agency is the same person, not a new one, and the register should be able to say which agency they were with in March.

### 4.4 What they may operate

`competency` (exists) — **per asset type, not per machine**:

| Field | Meaning |
|---|---|
| `asset_type_id` | Excavator, Tipper, Dozer, Drill — the class |
| `competency_type` | `LICENCE`, `VOCATIONAL_TRAINING`, `MEDICAL`, `FIRST_AID`, `INTERNAL_AUTHORISATION` |
| `document_no`, `issuing_authority` | The licence or certificate itself |
| `valid_from`, `valid_upto` | Drives the alert |
| `certified_by`, `certified_on` | Who inside the mine signed it off |

A person holds several rows: a heavy vehicle licence covering tippers, an internal authorisation on excavators, a medical covering everything.

### 4.5 Where they are assigned — **new**

`operator_assignment`

| Field | Meaning |
|---|---|
| `party_id`, `asset_id` | Person and machine |
| `shift` | A, B, C, or general |
| `role` | `PRIMARY`, `SECONDARY`, `RELIEVER` — the driver master's P/S, written down |
| `valid_from`, `valid_to` | Open-ended until reassigned |

This is what the driver master was trying to be. Keeping it separate from competency means a reassignment never touches a qualification, and a lapsed licence never silently rewrites who is on the machine.

### 4.6 Statutory alerts

The existing `asset_alert` view gains a sibling, `operator_alert`, with the same shape — kind, type, due date, days left, severity — so the Alerts screen shows machines and people together, ordered by what expires first. A lapsed medical and a lapsed fitness certificate are the same category of problem to whoever is running the shift.

---

## 5. The screens

### 5.1 Operator Registry

The equipment register with people in it. Photo, name, reference (`OPR-2026-0001`, issued the same way `EQP-` is), employer, department, competency chips, and the machine they are on.

A row expands to show their codes in other systems, exactly as equipment rows expand to show telematics and HOTO names.

### 5.2 Operator form

The same cost-sheet sheet, in bands:

1. **Identity** — name, photo, gender, date of birth, blood group, phone
2. **Employment** — employer, department, designation, type, joined on
3. **Competency** — repeating rows: class, document, authority, valid from/to
4. **Statutory** — licence, medical, vocational training, first aid
5. **Assignment** — machine, shift, role
6. **What other systems call them** — SAP, contractor, gate pass, biometric

Same rules as equipment: save a draft with nothing but a name; required fields checked at submission and marked in rose; plant defaults to Kaliapani; department and designation are comboboxes that learn.

### 5.3 The unregistered queue

The equipment screen lists telematics names transmitting with no machine behind them. The operator screen does the same with **the 133 driver-master rows and the handover employee ids** — everyone appearing in mine records with no operator record yet, with a Register button that carries their name and code into the form.

That queue is the migration. Nobody imports 133 rows blind; people work through a list, and each one arrives correct.

### 5.4 Competency matrix

Operators down the side, equipment classes across the top, cells showing qualified / expiring / lapsed / not qualified. One screen that answers "can we run three excavators on B shift tomorrow".

---

## 6. Permissions

Following the equipment pattern exactly:

| Permission | Who |
|---|---|
| `platform.operators.view` | Anyone who can see the registry |
| `platform.operators.manage` | Registers and edits operators |
| `platform.operators.approve` | Accepts them onto the register |

And two roles to match — **Operator Registrar** and **Operator Register Approver** — with approval held by someone who cannot edit, for the same reason as equipment.

Worth deciding before we build: whether competency sign-off should be a third permission. Certifying that someone may operate an excavator is a different act from typing their phone number, and the person who does it is usually the training officer rather than the registrar.

---

## 7. Phases

| # | Scope | Ends when |
|---|---|---|
| 1 | Tables, permissions, roles, reference (`OPR-`) | An operator can be created and approved through the API |
| 2 | Operator form and registry screen | A person can be registered end to end in the UI |
| 3 | Competency and statutory documents, `operator_alert` | Expiries appear on the Alerts screen |
| 4 | Unregistered queue from driver master and handover ids | The 133 can be worked through |
| 5 | Assignment, competency matrix | "Who is on MAN-14 this shift" is answerable |
| 6 | Handover joins to the register by identity | Handover names resolve to operator records without changing handover |

Phases 1–3 are the same work as the equipment register and should move quickly. Phase 4 is where the mine's real data arrives and will raise questions this document cannot predict. Phase 6 touches a production screen and should not start until the register is trusted.

---

## 8. Risks

**The 25 unmatched codes.** Some are contractor staff, some are typos. Resolving them is judgement, not code — the queue surfaces them one at a time rather than guessing.

**Blank licence data is not neutral.** Filling 133 statutory records is real work for someone. The register will be honestly empty at first, and that emptiness will be visible on the Alerts screen. That is the point, but it should be expected rather than discovered.

**Personal data.** This holds dates of birth, medical expiry, photographs and phone numbers. `platform.operators.view` should not sit inside a general dashboard role, and the audit trail already records who read what.

**Handover is live.** Eight production tables, used every shift. Phase 6 adds a join and changes nothing in those screens.

---

## 9. Open questions

1. **Statutory list.** Which certificates does Kaliapani actually track for HEMM operators — vocational training, periodical medical, first aid, gate pass medical? The platform should carry the mine's list, not a generic one.
2. **Who certifies?** Should competency sign-off be its own permission, held by training rather than the registrar?
3. **P and S.** The driver master's primary/secondary — per machine, per shift, or a seniority grade?
4. **Contractor operators.** Does the mine want their full personal details, or only licence, medical and agency? This changes what the form asks for.
5. **Photographs.** Are gate-pass photographs available to reuse, or is this a capture exercise?

---

## 10. What I recommend

Start at Phases 1 and 2, on the same pattern and components as the equipment register — the design work is done and reusing it costs nothing. Answer question 1 before Phase 3, since the statutory list decides what the form asks for. Leave Phase 6 until the register holds real people.

Nothing here touches the equipment register or any production screen.
