# MineHub — what has been built

**Kaliapani Mines · Balasore Alloys Limited**
As at 18 September 2026 · 43 commits, local, not yet pushed

---

## 1. In one paragraph

The dashboard reads from MySQL and always has. MineHub is the part that *writes*
— the mine's own register of machines and people, in its own PostgreSQL schema,
with drafts, two-person approval, a revision trail on every change, and lists
that standardise themselves as people use them. Two registers are live:
**Equipment** and **Operator 360**. Everything below is working against the real
database and has been tested there.

---

## 2. Access and identity

| Built | What it does |
|---|---|
| Real intranet sign-in | Replaced the fake login. Sessions in the shared `digital_apps_user_sessions` table, so the mine's other applications see them |
| Invite-only | Checked on every request, not only at login, so revoking access takes effect at once |
| Roles as data | 8 roles, 16 permissions, editable from the screen — no code change to add a role |
| Access audit | Every grant, revoke and role change, with who and when |
| Escalation guards | Nobody can grant themselves more than they hold |
| Owner keeps pace | A trigger grants each new permission to `PLATFORM_OWNER` as it is created, so the superadmin cannot drift behind the platform |

**Roles now:** Platform Owner · Access Manager · Dashboard Viewer · Equipment
Registrar · Equipment Register Approver · Operator Registrar · Competency
Assessor · Operator Register Approver.

---

## 3. Equipment register

**11 machines on file.** Each carries `EQP-2026-0001` — a reference the platform
issues, because every other identifier a machine has belongs to somebody else:
the fleet code is the mine's, the registration is the RTO's, the SAP equipment
number is SAP's.

- Full registration sheet — identity, ownership, capability, fuel or battery,
  deployment, meter, tyres, seats
- **Owned vs hired split properly**: an owned machine carries its SAP equipment
  number; a hired one carries the contract and the service PO it is billed
  against, with PO expiry on the alert list
- Insurance, fitness, road tax and permits with expiry dates
- Maintenance schedules by hours or date
- **What other systems call it** — telematics, HOTO, weighbridge, RFID, SAP
- **42 telematics names transmitting with no machine behind them**, as a queue
  to work through rather than an import to trust
- Draft → submitted → approved, with a revision trail showing every old and new
  value against a name
- Undo a change, discard a draft; the activity log keeps the fact either way

---

## 4. Operator 360

The specification named seventeen tables. It is built in **five**, because eight
of them were the same record wearing different words — a titled thing, from an
issuer, between two dates, possibly verified. Nothing in the specification was
dropped.

| Section | Holds |
|---|---|
| Personal | Name, DOB, blood group, emergency contact, addresses, six literacy levels |
| Employment | Type, employer, plant, department, designation, shift, 7 kinds of experience in months |
| Background | Previous employers, education |
| Languages | Hindi, Odia, English as speak / read / write, plus any other typed in |
| Documents | Licence, medical, certificates, internal authorisation, training, specialised training |
| Skills | **60 SCMS qualification packs** with codes and NSQF levels, six tied to the mine's equipment classes |
| Competency | Overall level plus fourteen understanding dimensions, 0–4, per class **and per machine**, with a rating out of 5 |
| Machines | Assignment by shift and role, with eligibility reported |
| Identity | SAP, HRMS, driver master, contractor, gate pass, biometric, RFID |
| Files | PDFs and photographs up to 10 MB, stored outside the database |

**The queue:** 133 people named in `mines_driver_master` with no profile here,
each one register-able with their name and code carried into the form.

---

## 5. The assessment cycle

- **Due dates the register works out itself**, from an interval the mine sets —
  6 months by default, overridable per equipment class
- **Two more settings**: how much warning to give, how far back an assessment
  may be dated. Both behind the approval permission, because how often a mine
  checks its operators is an assurance decision
- **Every assessment is numbered** — `ASM-2026-0001` — and the number belongs to
  the sitting, not to each of the fifteen scores it produced
- **Nothing is overwritten.** The current level is one cheap read; every
  assessment that produced it is kept, so improvement and decline are visible
- **Enforced, not advised:** the assessor comes from the session and cannot be
  typed; nobody assesses themselves; no future dates; no stale catch-ups; an
  overall level must say how it was reached

**Derived training plan** — no licence on file, no medical, assigned to a machine
never assessed on, a level that fell, stuck at assisted operation, reassessment
overdue, no qualifications recorded. Each line says *why*, and opens the profile
at the section that would close it.

---

## 6. Reference data the mine owns

| List | State |
|---|---|
| Plants | 5, SAP codes — 1200 Kaliapani (default), 1100 Balasore, 1110 Sukinda, 1210 COB, 1300 Kolkata |
| Contractors | BAL, DASHMESH, SANY, SIDHIVINAYAK, from the agency master |
| Equipment types | Grows as people register machines |
| Departments | **Deliberately unseeded** — typed as the mine meets them |
| Skills | 60, from the Skill Council for Mining Sector |
| Blood groups, relationships, shift patterns, insurers, capacity units | Seeded where the list is closed, open where it is not |

**86 lookup values**, every one of them addable from the field that uses it.

---

## 7. Deployment and platform

- Live on `bal-gpu` at **mines.balasorealloys.in**, behind the shared nginx,
  without disturbing the other applications on that box
- Docker Compose, with the subnet pinned after probing what could reach MySQL
- **Dual database**: MySQL `balcorpdb` stays a read-only source; PostgreSQL
  `corpappdb`, schema `minehub`, is what the platform owns — **44 tables**
- Local development reaches Postgres through an SSH tunnel; the start script
  checks it, since without it only the MineHub screens fail
- Auth answered from cache: a page that made fifteen calls paid for the session
  check fifteen times. `/access/users` went 945 ms → 218 ms

---

## 8. Faults found and fixed along the way

Worth recording because most were invisible until something ran against real
data:

- **`overflow-x: hidden` on the body** disabled `position: sticky` for the whole
  application
- **Employee search returned nothing** — `STATUS` is `'Active'`, not `'A'`
- **Typeless drafts were invisible**, then un-openable — an inner join in two
  places dropped exactly the rows someone still had to finish
- **References were reused after a deletion** — both counters counted survivors
  instead of going past the highest ever issued
- **Assessments overwrote their own history**, in a process whose whole point is
  repetition
- **Discarding a draft failed** for any profile with an identity attached
- **Sessions were being closed after ~14 minutes** by something outside this
  application; the heartbeat now beats on a timer rather than on luck
- **`party.gender` accepts M/F/O**; the form was sending `MALE`, and the failure
  surfaced as "MineHub database error"
- A **hook after an early return**, a **Decimal that jsonb refused**, a
  **parameter with no inferable type**, and a **privilege escalation** on the
  roles endpoint

---

## 9. Documents

| File | What it is |
|---|---|
| `MineHub_Resource_Optimization_Plan.md` | The clean-sheet platform blueprint |
| `MineHub_Gap_Analysis_and_Target_Architecture.md` | A–L gap analysis; four structural omissions named |
| `MineHub_Operator_Registry_Plan.md` | The operator plan, written against the driver master rather than from imagination |
| `MINEONE_Operator_360_...md` | Your specification, built from |
| `DEPLOY.md` | Deployment manifest, scrubbed of server credentials |

---

## 10. Where this leaves us

**Done and working:** identity, access, the equipment register, the operator
register, competency and its cycle, the training plan, the capability matrix.

**Not built yet**, in the order I would take them:

1. **Handover** — nine tables recording the same event nine ways; one form,
   joined to the register by identity
2. **Deployment** — who is on which machine this shift, which the register can
   now answer but nothing yet asks
3. **Production** — from the weighbridge rather than typed, with the tonnage
   reconciled against what was weighed
4. **Work orders and plan versus actual** — the planning hierarchy the gap
   analysis named as missing
5. **Attendance** — the HRMS link, so `absence_operator` stops being an
   anonymous number of lost hours

**Outstanding decisions:** which statutory certificates Kaliapani actually
tracks for HEMM operators; whether competency sign-off should sit with training
rather than the registrar; and the `baladmin` password, which was exposed in a
screenshot and should be rotated.

**43 commits are local and unpushed**, awaiting your go-ahead.
