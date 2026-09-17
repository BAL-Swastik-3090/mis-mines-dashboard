# MINEONE — Live Machine Availability, Operator Scheduling & HOTO Control
## Kaliapani Mines | Integrated Shift Readiness & Deployment Plan
**Prepared:** 18 Sep 2026

## 1. Executive Direction

Your thinking is correct, but the requirement should be broader than **machine availability + operator schedule + HOTO**.

The next MINEONE layer should be a **Live Deployment & Shift Readiness Engine**.

It must determine, in real time:

> Is the machine available? Is the operator available? Is the operator eligible? Is the machine serviceable? Is the required crew available? Is the machine assigned? Is the shift active? Can HOTO happen? Can the machine be deployed? If not, exactly why?

The operational chain should be:

**Plan → Attendance → Operator Availability → Machine Availability → Eligibility → Schedule → Assignment → HOTO → Deployment → Operation → Production → Shift Close**

The current build already has Equipment, Operator 360, machine assignment/eligibility, competency, and capability foundations. The work report identifies Handover, Deployment and Attendance as the next areas, followed by Production and Work Orders/Plan vs Actual. fileciteturn2file0L174-L188

---

# 2. Do Not Build Three Independent Modules

Do **not** build:

- Machine Availability screen
- Operator Schedule screen
- HOTO screen

as isolated features.

Build one operational chain:

**SHIFT READINESS → DEPLOYMENT → HOTO → LIVE OPERATION**

The screens should be different views of the same underlying state.

---

# 3. Core Concepts

## 3.1 Machine State

A machine can be:

- Available
- Running
- Idle
- Standby
- Breakdown
- Under Maintenance
- Planned Down
- Inspection Hold
- Compliance Hold
- Awaiting Operator
- Awaiting Assignment
- Awaiting HOTO
- Fuel/Charging Required
- Location Restricted
- Decommissioned

## 3.2 Operator State

An operator can be:

- Scheduled
- Present
- Absent
- On Leave
- Off Shift
- Available
- Assigned
- Operating
- In Training
- Medical Hold
- Suspended
- Not Eligible
- Waiting for Assignment
- Released

## 3.3 Deployment Readiness

A machine/operator combination is:

- **READY**
- **READY WITH WARNING**
- **BLOCKED**

Machine availability alone is not deployment readiness.

---

# 4. Shift as the Central Operational Unit

Every deployment decision should be anchored to:

- Date
- Shift
- Site/Plant
- Pit
- Bench/Face/Work Area
- Shift Supervisor
- Planned Start/End
- Actual Start/End

Shift definitions remain configurable.

---

# 5. Operator Scheduling

Create a dedicated **Operator Schedule**.

Fields:

- Operator
- Date
- Shift
- Role
- Planned Machine
- Planned Work Area
- Supervisor
- Scheduled Start
- Scheduled End
- Schedule Status
- Source
- Created By
- Approved By

Statuses:

- Draft
- Published
- Acknowledged
- Present
- Absent
- Reassigned
- Completed
- Cancelled

---

# 6. Machine Scheduling

Create a separate **Machine Schedule**.

Fields:

- Machine
- Date
- Shift
- Planned Activity
- Planned Location
- Work Order
- Planned Hours
- Required Operator Class
- Required Crew
- Supervisor
- Schedule Status

This allows MINEONE to compare:

**What machine was planned?** vs **What machine was actually available?**

---

# 7. Attendance Integration

Attendance should directly influence deployment readiness.

Flow:

**HRMS Attendance → MINEONE Presence → Shift Availability → Eligibility → Deployment**

### Scenarios

**Operator Present:** continue.

**Operator Absent:** block normal deployment and create replacement requirement.

**Operator Late:** machine becomes `AWAITING_OPERATOR`.

**Operator on Leave/Training:** unavailable for deployment.

**Attendance feed unavailable:** show `ATTENDANCE_PENDING`; never silently assume presence.

---

# 8. Replacement Operator Engine

When the scheduled operator is absent:

**Scheduled Operator → Absent → Replacement Required**

MINEONE should find eligible candidates based on:

- Present
- Correct shift
- Available
- Required machine competency
- Valid licence
- Valid medical
- Required training
- Required experience
- Machine understanding
- Not already assigned
- Recent machine operation

The system **suggests** candidates; the authorized supervisor selects the replacement.

---

# 9. Live Machine Availability Engine

Machine availability should combine:

### Equipment Register
- active/inactive
- class
- compliance

### Maintenance
- scheduled maintenance
- breakdown
- service due
- maintenance hold

### Telematics
- engine running
- idle
- moving
- location
- hour meter
- fuel/battery
- last communication

### Manual Events
- breakdown
- inspection hold
- fuel required
- operational hold
- site restriction

### HOTO
- current operator
- previous operator
- HOTO status

The Equipment register already stores telematics/HOTO/weighbridge/RFID identities, so these should feed the live state rather than create duplicate machine masters. fileciteturn2file0L43-L52

---

# 10. Live Fleet Dashboard

| Machine | Live State | Operator | Shift | HOTO | Readiness |
|---|---|---|---|---|---|
| Excavator 01 | Running | OP-001 | A | Complete | Ready |
| Dumper 04 | Idle | OP-014 | A | Complete | Ready |
| Loader 02 | Available | — | A | Pending | Awaiting Operator |
| Excavator 03 | Breakdown | — | A | Blocked | Not Available |
| Dumper 08 | Available | OP-022 | A | Blocked | Operator Not Eligible |

Important:

**Machine State ≠ Deployment Readiness.**

---

# 11. Readiness Engine

At any moment MINEONE should be able to answer:

> **Can Machine X start operation with Operator Y right now?**

Check:

1. Machine active
2. Machine physically available
3. No blocking breakdown/maintenance hold
4. Required pre-start checks complete
5. Fuel/charge adequate where applicable
6. Shift active
7. Operator present
8. Operator available
9. Operator not committed elsewhere
10. Licence valid
11. Medical valid
12. Training valid
13. Competency valid
14. Machine understanding sufficient
15. Internal authorization valid
16. Assignment valid
17. Required crew available
18. Work order/plan conditions satisfied where applicable

Only then:

**DEPLOYMENT_READY = TRUE**

Do not manually maintain this as a single editable field; derive it from facts and events.

---

# 12. HOTO as a Controlled Transaction

HOTO should not simply be a form.

It is the transaction that transfers operational responsibility for a machine.

## HOTO Preconditions

### Machine
- exists
- active
- expected location
- no blocking hold
- required inspection available

### Outgoing Operator
- identified
- current assignment/deployment exists
- associated with the machine

### Incoming Operator
- present
- scheduled or authorized replacement
- eligible
- licence valid
- medical valid
- training valid
- competency valid
- machine understanding sufficient

If a blocking condition fails:

**HOTO = BLOCKED**

and the system must show the exact reason.

---

# 13. HOTO Workflow

### Normal

`Machine Available → Outgoing Operator → Incoming Operator → Pre-HOTO Inspection → Checklist → Both Confirm → HOTO Complete → Responsibility Transferred → Deployable`

### Operator Absent

`Scheduled Operator Absent → HOTO Blocked → Replacement Search → Eligible Replacement → HOTO → Deploy`

### Machine Breakdown

`Available → Breakdown → Machine Hold → HOTO Blocked/Restricted → Maintenance → Release → Availability Recalculated`

### No Incoming Operator

`Outgoing Released → No Incoming → Machine Awaiting Operator`

### Incoming Not Eligible

`Candidate → Eligibility Check → Blocked → Training/Assessment/Authorization`

The existing HOTO data contains multiple sibling tables and inspection checkpoints; the target should consolidate this into one standard transaction with configurable checklist templates. fileciteturn2file0L179-L180

---

# 14. HOTO Inspection

Possible checks:

- Machine identity
- Hour meter
- Fuel
- Engine
- Hydraulic system
- Tyres/tracks
- Lights
- Horn
- Reverse alarm
- Brakes
- Steering
- Fire extinguisher
- Safety systems
- Leaks
- Attachments
- Cabin
- Telematics
- Visible damage
- Defects
- Remarks
- Photos

Checklist must be equipment-class configurable.

---

# 15. Defect During HOTO

### Non-blocking defect

Record observation and proceed if mine policy permits.

### Critical defect

`HOTO Blocked → Maintenance Work Item → Repair → Inspection → Release → HOTO/Deployment`

This prevents a shift change from becoming a way to bypass an unsafe-machine hold.

---

# 16. Operator Assignment vs Actual Operation

Keep three different concepts:

### Authorized
Can the operator legally/technically operate it?

### Assigned
Has the supervisor officially allocated the machine?

### Actually Operated
Did telematics/HOTO/deployment evidence show that the operator actually operated it?

Therefore:

**Authorized → Assigned → HOTO → Actually Operated**

---

# 17. Shift Readiness Dashboard

### Workforce
- Scheduled
- Present
- Absent
- Replacement Required
- Eligible

### Fleet
- Planned
- Available
- Running
- Idle
- Breakdown
- Maintenance
- Awaiting Operator

### HOTO
- Required
- Pending
- Blocked
- Completed

### Deployment
- Ready
- Blocked
- Running
- Released

### Shortages
- Machine Shortage
- Operator Shortage
- Competency Shortage
- Crew Shortage

---

# 18. Shift Readiness Board

Use a live board:

**PLANNED → ATTENDANCE CONFIRMED → ELIGIBLE → HOTO PENDING → DEPLOYED → OPERATING → RELEASED**

Additional exception lanes:

- Awaiting Operator
- Awaiting Machine
- Blocked
- Breakdown
- Maintenance
- Data Conflict

---

# 19. Every Block Must Have a Reason

Never show only **“Not Available.”**

Example:

> **Dumper EQP-0042 — BLOCKED**
>
> Machine: Available  
> Operator: Absent  
> Replacement: Required  
> Eligible operators present: 3  
> HOTO: Not Started

Or:

> **Excavator EQP-0007 — BLOCKED**
>
> Machine: Maintenance Hold  
> Operator: Available  
> HOTO: Blocked  
> Action: Maintenance release required

---

# 20. Work Order / Planning Integration

When the planning module is built:

Example:

**Work Order**
- Activity: Ore Excavation
- Pit: South
- Bench: X
- Material: HG Ore
- Excavators Required: 2
- Dumpers Required: 5
- Shift: A
- Planned Hours: 8

MINEONE checks:

`Required Fleet → Available Fleet → Required Operators → Present Operators → Eligible Operators → Deployment`

This is where operator profiling, machine availability and planning finally become one operational system.

---

# 21. Shortage Intelligence

Before the shift starts:

### Machine Shortage

`Required 5 Dumpers | Available 3 | Shortage 2`

### Operator Shortage

`Required 5 | Present & Eligible 4 | Shortage 1`

### Competency Shortage

`Present 6 | Eligible 4 | Capability Shortage 2`

### Maintenance Shortage

`Required 5 | 1 under maintenance`

This should appear before production starts so supervisors can act.

---

# 22. Operations Exception Queue

Centralize exceptions:

- Operator absent
- Machine unavailable
- HOTO overdue
- HOTO blocked
- Operator not eligible
- Licence expired
- Medical expired
- Machine compliance expired
- Telematics offline
- Attendance missing
- Machine running without deployment
- Operator operating without assignment
- Location mismatch
- Unclosed HOTO
- Unreleased deployment
- Duplicate assignment
- Attendance/telematics conflict

Each exception needs:

- severity
- owner
- created time
- SLA
- status
- resolution
- resolved by/time

---

# 23. Critical Real-World Scenarios to Cover

| Scenario | System Response |
|---|---|
| Machine + operator available | Deploy |
| Machine available, operator absent | Replacement |
| Operator present, machine unavailable | Awaiting Machine |
| Both available, HOTO pending | HOTO Pending |
| Operator not eligible | Block + reason |
| Licence expired | Block |
| Medical expired | Block |
| Machine breakdown before shift | Unavailable |
| Machine breakdown during shift | Stop/release/maintenance |
| Operator leaves during shift | Release + replacement HOTO |
| Operator already on another machine | Prevent double assignment |
| Multiple operators for one machine | Controlled selection |
| HOTO critical defect | Block + maintenance |
| Telematics says running, no deployment | Exception |
| Deployment exists, telematics idle | Idle/exception according to context |
| Attendance says absent, HOTO says present | Data Conflict |
| Attendance feed delayed | Attendance Pending |
| Telematics offline | Last-known state + stale indicator |
| Machine becomes available late | Recalculate matching candidates |
| Required crew incomplete | Block |
| Machine at wrong location | Location mismatch |
| Emergency deployment | Controlled authorized override + audit |
| Shift change | Close old responsibility + new HOTO |
| Planned machine unavailable | Show compatible alternatives |
| No eligible replacement | Escalate operator shortage |

---

# 24. Event-Driven Model

Use the existing MineHub append-only event approach.

Events:

- `ATTENDANCE_RECEIVED`
- `SHIFT_STARTED`
- `SHIFT_ENDED`
- `OPERATOR_PRESENT`
- `OPERATOR_ABSENT`
- `OPERATOR_ASSIGNED`
- `OPERATOR_RELEASED`
- `MACHINE_AVAILABLE`
- `MACHINE_UNAVAILABLE`
- `MACHINE_BREAKDOWN`
- `MACHINE_RELEASED`
- `HOTO_STARTED`
- `HOTO_COMPLETED`
- `HOTO_BLOCKED`
- `DEPLOYMENT_CREATED`
- `DEPLOYMENT_STARTED`
- `DEPLOYMENT_ENDED`
- `MACHINE_IDLE`
- `MACHINE_RUNNING`
- `OPERATOR_REASSIGNED`

Retain:

- occurred_at
- recorded_at
- source
- machine/person/location
- payload
- recorded_by
- correlation/reference ID

---

# 25. Recommended New Domain Objects

Add a Deployment/Shift domain:

### `shift_instance`
Actual occurrence of a configured shift.

### `operator_schedule`
Planned operator work allocation.

### `machine_schedule`
Planned machine utilization.

### `deployment`
Actual operator + machine + shift + location relationship.

### `hoto_transaction`
Standard HOTO transaction.

### `hoto_check`
Configurable inspection items.

### `machine_availability_event`
Breakdown/maintenance/hold/release.

### `operator_availability_event`
Present/absent/training/leave/release.

### `deployment_block`
Reason a deployment cannot proceed.

### `replacement_request`
Alternate operator/machine request.

### `shift_readiness_snapshot`
Optional analytical snapshot.

Do not create another machine or person master.

---

# 26. Derived State Model

## Machine Availability

`Active + No Blocking Hold + Maintenance State + Compliance + Operational State`

## Operator Availability

`Present + Shift Applicable + Not Already Committed + Not On Leave/Training/Hold`

## Operator Eligibility

`Licence + Medical + Training + Competency + Machine Understanding + Authorization`

## Deployment Readiness

`Machine Available + Operator Available + Operator Eligible + Assignment Valid + HOTO Complete`

---

# 27. Reconciliation Chain

At the end of every shift, compare:

**Plan**
→ what should have happened?

**Attendance**
→ who actually came?

**Assignment**
→ who was allocated?

**HOTO**
→ who took responsibility?

**Telematics**
→ what actually operated?

**Weighbridge/Production**
→ what was produced?

This creates a complete:

**Plan → Attendance → Assignment → HOTO → Operation → Production**

reconciliation.

---

# 28. Lost-Hour Attribution

Instead of anonymous downtime, classify lost hours:

- Machine breakdown
- Planned maintenance
- No operator
- Operator absent
- Operator not eligible
- HOTO delay
- Waiting for assignment
- Waiting for work order
- Waiting for material
- Fuel/charging
- Location/access
- Weather/operational hold
- Other

This should connect directly to production and utilization analytics.

---

# 29. Supervisor Workflow

## Before Shift

`Review Plan → Fleet Availability → Attendance → Eligibility → Shortages → Resolve Exceptions → Publish Deployment`

## During Shift

`Monitor Live State → Breakdown/Absence → Replacement → HOTO → Deployment → Operation → Exceptions`

## End Shift

`Stop Operation → Final Meter/Telematics → HOTO → Defects → Release Operator → Close Deployment → Reconcile`

---

# 30. Shift Start Readiness Control

Supervisor should see one screen:

### Workforce
Scheduled / Present / Absent / Replacement

### Fleet
Planned / Available / Breakdown / Maintenance

### Capability
Eligible / Training Gap / Assessment Gap

### HOTO
Required / Pending / Blocked / Complete

### Deployment
Ready / Blocked / Running

Every exception must have an actionable reason.

---

# 31. Shift End Control

At shift close:

1. Capture machine final state
2. Capture operator
3. Capture final operating hours
4. Reconcile telematics
5. Record fuel/energy where applicable
6. Complete HOTO
7. Record defects
8. Release operator
9. Close deployment
10. Recalculate next-shift readiness

No deployment should remain indefinitely open.

---

# 32. KPIs

## Machine

- Availability
- Utilization
- Running Hours
- Idle Hours
- Breakdown Hours
- Awaiting Operator Hours
- Awaiting Machine Hours

## Operator

- Attendance
- Scheduled Hours
- Deployment Hours
- Operating Hours
- Training Hours

## HOTO

- HOTO completion rate
- HOTO delay
- HOTO blocked count
- Critical defects during HOTO

## Deployment

- Planned vs actual
- Deployment delay
- Replacement frequency
- Blocked deployments

## Shift

- Readiness %
- Planned fleet deployed
- Operator shortage
- Machine shortage
- Lost hours by reason

---

# 33. AI / Intelligence Layer — Later

Once sufficient reliable history exists, MINEONE can recommend:

- likely operator shortage
- likely machine shortage
- replacement operators
- recurring HOTO delays
- training-driven deployment shortages
- machine/operator compatibility
- shift readiness risk
- recurring idle conditions
- maintenance-related availability risk

AI should recommend; authorized mine personnel should make the operational decision.

---

# 34. UI Modules

## A. Live Fleet
Real-time machine state and location.

## B. Operator Schedule
Calendar/timeline of operator shifts, attendance, machine and status.

## C. Shift Deployment Board
`Planned → Present → Eligible → HOTO → Deployed → Operating → Released`

## D. HOTO Center
Required, pending, blocked, completed and defect-driven HOTO.

## E. Shift Readiness Dashboard
Single control-room view for the supervisor.

## F. Exception Center
One queue for everything preventing planned work.

---

# 35. Implementation Sequence

## Phase 1 — Machine Availability
- operational states
- availability events
- maintenance/breakdown integration
- telematics ingestion
- live fleet dashboard

## Phase 2 — Attendance & Operator Availability
- HRMS integration
- shift instances
- presence
- absence
- availability state

## Phase 3 — Scheduling
- operator schedule
- machine schedule
- shift planning
- assignment
- replacement request

## Phase 4 — Deployment
- deployment entity
- readiness engine
- eligibility integration
- conflict prevention
- live deployment board

## Phase 5 — HOTO
- standard transaction
- configurable checklist
- preconditions
- defects
- sign-off
- history

## Phase 6 — Reconciliation
- plan vs attendance
- attendance vs assignment
- assignment vs HOTO
- HOTO vs telematics
- telematics vs production
- exception queue

## Phase 7 — Intelligence
- lost-hour attribution
- shortage analytics
- training impact
- shift readiness analytics
- recommendations

---

# 36. Target Architecture

```text
                         MINEONE
                            |
                    SHIFT READINESS
                            |
          +-----------------+-----------------+
          |                 |                 |
      WORK PLAN         ATTENDANCE        FLEET STATE
          |                 |                 |
     MACHINE PLAN     OPERATOR STATE     MACHINE STATE
          |                 |                 |
          +----------------+-----------------+
                           |
                    ELIGIBILITY ENGINE
                           |
                    SCHEDULING ENGINE
                           |
                    DEPLOYMENT ENGINE
                           |
                     HOTO ENGINE
                           |
                       DEPLOYMENT
                           |
                     LIVE OPERATION
                    /                               TELEMATICS          WEIGHBRIDGE
                    \                 /
                     RECONCILIATION
                           |
                     MIS / ANALYTICS
```

---

# 37. Final Target State

MINEONE should ultimately answer live:

> **What machines do we have?**
>
> **Which are actually available?**
>
> **Which operators are actually present?**
>
> **Who is eligible for each machine?**
>
> **Who is scheduled?**
>
> **Who is assigned?**
>
> **Which HOTO is pending or blocked?**
>
> **Why is anything blocked?**
>
> **Who can replace an absent operator?**
>
> **What is actually operating?**
>
> **Where are we losing hours?**
>
> **What should the supervisor act on now?**

The complete operating chain becomes:

**PLAN**
→ **ATTENDANCE**
→ **AVAILABILITY**
→ **ELIGIBILITY**
→ **SCHEDULE**
→ **ASSIGNMENT**
→ **HOTO**
→ **DEPLOYMENT**
→ **LIVE OPERATION**
→ **PRODUCTION**
→ **RECONCILIATION**
→ **SHIFT CLOSE**

This should be the next major MINEONE domain.
