# MineHub — Gap Analysis & Target Architecture

**Kaliapani Chromite Mines · Balasore Alloys Limited**
17 September 2026 · Response to `MineHub_Complete_Gap_Analysis_Request.md`

This reviews the MineHub blueprint against the full scope of a digital mine
operating system and states what must change. The blueprint under review is my
own; where it is wrong, this document says so plainly, because a design review
that flatters the design is worthless.

All current-state figures were measured against the live databases.

---

## A. Current architecture assessment

### A1. What is genuinely strong

**The six constitutional rules hold.** Nothing in the expanded scope breaks
them, and several of the new modules only work because of them. *One fact, one
capture point* is exactly what makes blast → truck → weighbridge traceability
possible; a design that let each module keep its own tonnage could never
reconcile. Keep Part A unchanged.

**The event log is the right spine.** The expanded scope adds perhaps forty new
fact types — drill hole completed, blast fired, sample assayed, tyre fitted,
pump started. In a CRUD design each is a schema change and a migration. In an
append-only log each is a new `event_type` and a projection. The architecture
absorbs the expansion rather than fighting it.

**Identity-before-everything was the right starting point.** Nothing in
sections 1–36 can be built until a person, a machine and a place each have one
key. That judgement survives the wider scope intact.

**Machines capture, humans judge** becomes *more* valuable at this scale, not
less. Thirty-six modules of manual forms would collapse under its own weight.

### A2. What the existing estate already gives us

| Capability | Source | Volume | Assessment |
|---|---|---|---|
| Trip weights with vehicle identity | `zpp_win_gate_entry` | 110,711 rows, 2026 | **Strong.** Already carries `RFIDNO`, shift, source/destination location, material, gross/tare/net |
| Telematics | `minehub.technoton_*` | 226k + 112k rows | **Strong** for 42 machines: engine, idle, motion hours, distance, fuel, fill/drain |
| Attendance & roster | `hr_hrms_emp_attendance`, `_shift_plan` | 243,890 / 287,595 | **Strong.** 1,001 employees, shift-coded, with in/out location |
| Employee master | `sap_employee_details` | 1,300 | Adequate as an identity source |
| Lab assay | despatch grade tables | in use | Proven — already banded to Cr₂O₃ on despatch |
| Dispatch & despatch | SAP `zsd_outbound_despatch` | live | Authoritative downstream |

**The RFID finding is the most consequential thing in this assessment.** If the
weighbridge is already reading vehicle tags, then vehicle identity at the gate
is solved, and the single most expensive capture point in any mining system —
"which truck, carrying what, from where" — is already automatic. Everything in
sections 7, 8, 9, 12 and 22 becomes materially cheaper.

### A3. What is weak

| Area | Reality |
|---|---|
| Master data | No authoritative fleet list exists anywhere. Four partial lists, none complete |
| Identity | Telematics `MAN18` vs handover `MAN-18` — no join. SAP 4-digit EMPID vs 5-digit contractor codes — no bridge |
| Competency | `DL_No` and `Valid_Upto` empty on all 133 driver rows |
| Handover | Nine department tables, ~3,085 rows; the mining one covers 42 days in 14 months |
| Validation | Production date `0026-02-25`; challan date `5202-08-30`; HOTO rows dated in the future |
| Duplicate capture | Tonnage weighed automatically **and** typed into a shift log |
| Geology, drilling, blasting, survey | Effectively absent as structured data |
| Cost | No cost object, no allocation, no ₹/tonne anywhere |

---

## B. Critical gaps — must be fixed before implementation

These are gaps in **my blueprint**, not in the request. Each would have forced
an expensive rework later.

### B1. There is no Work Order — the single largest omission

The blueprint went from *plan* directly to *deployment*. That cannot support the
expanded scope, because the work order is what links plan to execution to
measurement to money:

```
Plan → Work Order → Deployment → Execution → Measurement → Verification → Closure → Billing
```

Without it there is no unit of work to cost, to certify, to bill a contractor
against, or to reconcile. Contractor billing (§22), cost allocation (§23) and
planned-vs-actual (§1) all depend on it, and all three were unbuildable as the
blueprint stood.

**The work order is the fundamental transaction object of the platform.**
Everything operational either produces one, executes one, or measures one.

### B2. There is no material lot — so a tonne cannot actually be traced

The request asks to trace a tonne from geological block to plant. The blueprint
cannot do it, and neither can a design that only records trips: a truckload
weighed at the bridge has no link back to the blast that broke the rock or the
block that was modelled.

**Introduce `lot` — a material parcel with identity.** A lot is created when
rock is broken and carries forward through every movement:

```
block → blast → muckpile (lot created) → truck load (lot moves)
      → weighbridge (lot weighed) → ROM (lot received)
      → stockpile (lots merge, new blended lot) → plant (lot consumed)
```

Every movement event references a `lot_id`. Grade travels with the lot, not with
the truck. This is what makes §3, §9, §10, §11 and §12 possible, and it is the
one structural addition that must be designed now, because retrofitting lot
identity onto historical movements is impossible.

### B3. No planning hierarchy

The blueprint treated "target" as a monthly excavation figure. The request is
right: planning is a chain, each level constraining the next.

```
Life-of-Mine → Annual → Monthly → Weekly → Daily → Shift → Work Order
```

Each level needs version, revision reason, approval state and an audit trail.
A plan that can be silently edited cannot be used for variance analysis — the
plan moves to meet the actual and the variance always reads zero.

**Crucially, Mine Planning ≠ deployment planning.** Mine planning decides *what
to extract, from where, at what grade.* Deployment planning decides *which
machine and which operator.* The blueprint conflated them. They are different
objects with different owners, different horizons and different approvals.

### B4. No survey, geometry or spatial model

Locations were a flat hierarchy of codes. Without geometry there is no bench
polygon, no blast polygon, no stockpile volume, no geofence — and therefore no
survey reconciliation, which is the only independent check on weighbridge
tonnage. Reconciliation (§12) is unbuildable without it.

**Use PostGIS from the start.** Retrofitting spatial types after the location
table is in production is disruptive; enabling the extension now costs nothing.

### B5. No data quality engine

The blueprint said "validate at entry". That is necessary and nowhere near
sufficient: it cannot detect a sensor that stopped reporting, an RFID read that
never arrived, a weighbridge disagreeing with telematics, or a late-arriving
event that silently changes a closed shift.

The request's §26 is correct and must be a **first-class module**, not a
by-product. On an event-sourced platform this is natural: the log already
records `occurred_at` versus `recorded_at`, so lateness is measurable.

### B6. No approval or workflow engine

Blast design, plan revision, work order closure, contractor bill certification,
master data creation — all need *submit → review → approve → effective*, with
delegation and audit. Building approvals separately into each module produces
six inconsistent implementations. **One workflow service, used by all.**

### B7. Authorization is not designed for an ERP

The dashboard's role model — viewer / manager / admin with page access — is
adequate for a dashboard and inadequate here. An ERP needs:

- Scoping by **site, pit and department**, not just by page
- **Segregation of duties** — the person who raises a work order must not certify it
- Delegation with expiry
- Field-level control on commercial data (contract rates)

### B8. Offline capture was asserted, not designed

"Offline-tolerant" was stated without a conflict model. Two operators recording
a handover for the same machine on the same shift, both offline, will collide.
Needs: client-generated UUIDs, an idempotency key per event, last-writer-wins
only where safe, and explicit conflict surfacing where not.

### B9. Master data governance is absent

Who may create an asset? What prevents the same excavator being registered
twice? What is the dedup rule for a contractor worker who returns after a year?
Without stewardship, a golden-record design degrades into the four partial lists
we have today — which is exactly how those four lists came about.

### B10. Time is under-modelled

The platform will have at least four clocks: telematics timestamps, weighbridge
timestamps, hour meters and shift boundaries. They disagree. Hour meters drift
and get reset on engine replacement. A shift spanning midnight belongs to one
production day, and the rule must be explicit and single.

---

## C. High-priority enhancements

Important, not blocking.

| # | Enhancement | Why |
|---|---|---|
| C1 | **Merge ROM + stockpile into one stock ledger** | They are the same object — a pile of material with a location, grade and balance. Two modules would duplicate logic and disagree |
| C2 | **Merge fleet management into EAM** | §13 and §14 are one domain. An asset's utilisation and its maintenance are the same record viewed twice |
| C3 | **Cycle-level haulage capture** | Trip weights give tonnes but not cycle time, queueing or excavator–truck matching. Derive cycles from telematics geofence crossings rather than asking anyone to type them |
| C4 | **Cost model as a ledger, not a report** | ₹/tonne must be a posted, auditable allocation, not a spreadsheet computed monthly |
| C5 | **Contract as a first-class master** | Rates, penalties, incentives, minimum guarantees. Contractor billing is arithmetic over this plus work orders |
| C6 | **Component and tyre life tracking** | Tyres (§16) are a special case of component lifecycle; build one component model, not two |
| C7 | **Laboratory integration** | Assays currently arrive as despatch-level data. Sample-level capture with sample ID and location is required for grade control |
| C8 | **Fuel reconciliation** | Issued (pump) vs consumed (telematics) vs tank dip. Three sources, one ledger — a direct leakage control |
| C9 | **Notification and escalation service** | Expiring licences, overdue PM, `UNMANNED` shifts, DQ breaches. One service, not per-module emails |
| C10 | **Shift-close process** | An explicit close makes a shift's numbers final, with late events flagged as post-close adjustments |

---

## D. Future enhancements

Deliberately sequenced late. Each depends on data the platform does not yet
produce, and building them early produces confident nonsense.

| Capability | Prerequisite | Realistic timing |
|---|---|---|
| Breakdown prediction | 12+ months of failure history with consistent asset identity | Year 2+ |
| Fuel anomaly detection | Clean issued-vs-consumed ledger | Year 2 |
| Production forecasting | 12 months of reconciled production | Year 2 |
| Excavator–truck dispatch optimisation | Reliable cycle times | Year 2 |
| Blend optimisation | Trustworthy stock ledger with grades | Year 2 |
| Grade estimation / block model | Sample-level assay history | Year 2–3 |
| Digital twin | Everything above | Year 3+ |

**On AI: rule-based detection first.** "Fuel consumed exceeds expected by 20%"
and "engine hours with no movement for 3 hours" deliver most of the value of
§28's Detect list, need no training data, and are explainable to an operator.
Introduce ML only where rules demonstrably fail.

---

## E. Target architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ EXPERIENCE                                                            │
│  Mobile capture (offline)  ·  Control room  ·  Management MIS         │
│  Planning workbench  ·  Admin & master data  ·  DQ dashboard          │
├──────────────────────────────────────────────────────────────────────┤
│ INTELLIGENCE            rules first, models later                     │
│  Detection · Prediction · Optimisation · Reconciliation analytics     │
├──────────────────────────────────────────────────────────────────────┤
│ DOMAIN SERVICES                                                       │
│  Planning │ Work Order │ Geology & Grade │ Drill & Blast │            │
│  Deployment │ Production │ Stock & Blending │ EAM │ Fuel │            │
│  Safety │ Compliance │ Environment │ Contract & Cost                  │
├──────────────────────────────────────────────────────────────────────┤
│ PLATFORM SERVICES                                                     │
│  Workflow & approval · Notification · Document · Audit ·              │
│  Authorization (site/dept scoped) · Data Quality engine               │
├──────────────────────────────────────────────────────────────────────┤
│ SPINE                                                                 │
│  Master registry  ·  Event log (append-only)  ·  Derived ledgers      │
│  Lot & traceability graph  ·  Spatial model (PostGIS)                 │
├──────────────────────────────────────────────────────────────────────┤
│ EDGE — adapters, idempotent, replayable                               │
│  RFID · Weighbridge · Telematics · Biometric · Lab/XRF ·              │
│  Survey/GNSS · Sensors · SAP · HRMS · IMOS (transitional)             │
└──────────────────────────────────────────────────────────────────────┘
```

Rules: a layer calls only downward; domain services own their transactions and
read everything else; **no service writes another's tables**; every KPI is a
projection of the event log.

---

## F. Target module map

```
MineHub
├── 1 Master Data
│   ├── Party (person · organisation · contractor · vendor)
│   ├── Asset (equipment · component · tyre)
│   ├── Location (site → pit → bench → face · stockyard · plant · gate)
│   ├── Material & grade specification
│   ├── Calendar & shift
│   ├── Contract
│   └── Competency & compliance
│
├── 2 Planning
│   ├── Life-of-mine / annual / monthly / weekly / daily / shift
│   ├── Plan versioning & approval
│   └── Deployment plan (machine + operator)
│
├── 3 Work Order            ← the transaction backbone
│
├── 4 Geology & Grade Control
│   ├── Block model · drill hole · sample · assay (lab + XRF)
│   └── Ore/waste classification · dilution · ore loss
│
├── 5 Drill & Blast
│   ├── Drill plan · pattern · hole · penetration · meterage
│   └── Blast design → approval → charge → fire → fragmentation
│
├── 6 Production
│   ├── Excavation & loading (cycles, payload)
│   ├── Haulage & dispatch
│   └── Weighbridge & RFID          ← authoritative tonnage
│
├── 7 Stock & Quality
│   ├── ROM · stockpile (one ledger)
│   ├── Blending & grade optimisation
│   └── Reconciliation
│
├── 8 Asset Management (EAM)
│   ├── PM · breakdown · condition-based
│   ├── Component & tyre lifecycle
│   └── Fuel
│
├── 9 HSE & Compliance
│   ├── Safety (incident · PTW · JSA · CAPA)
│   ├── Statutory compliance & licences
│   └── Environment
│
├── 10 Commercial
│   ├── Contractor management & billing
│   └── Cost management
│
├── 11 Survey & Spatial
│
├── 12 Intelligence
│
└── 13 Platform (workflow · notification · DQ · audit · authorization)
```

---

## G. End-to-end mine process

The spine of the platform, with capture mode marked — **[M]** machine,
**[H]** human judgement:

```
GEOLOGY          block model → sample [H] → assay [M lab] → grade
   ↓
PLANNING         annual → monthly → weekly → daily → shift plan [H, approved]
   ↓
WORK ORDER       what · where · how much · by whom [H, approved]
   ↓
DRILLING         pattern → hole [M drill monitor / H] → meterage
   ↓
BLASTING         design [H] → approval [H] → charge [H] → fire [H]
                 → fragmentation [M image]
   ↓             ══ LOT CREATED ══
EXCAVATION       excavator + operator [M deployment] → bucket cycles [M telematics]
   ↓
HAULAGE          truck load [M] → cycle [M geofence] → queue/wait [M]
   ↓
WEIGHBRIDGE      RFID [M] → gross/tare/net [M] → material + destination [M]
   ↓             ══ AUTHORITATIVE TONNAGE ══
ROM / STOCKPILE  receipt [M] → balance [derived] → survey check [M GNSS]
   ↓
BLENDING         blend plan [optimiser] → reclaim [M] → new lot
   ↓
PLANT            feed [M] → recovery → concentrate
   ↓
RECONCILIATION   geological vs mined vs weighed vs surveyed vs fed [derived]
   ↓
COST             ₹/tonne by pit, bench, material, contractor [derived]
```

Human input appears at eight points; every one is a decision, an approval or an
observation no instrument can make. Tonnage, hours, fuel, distance and cycles
are never typed.

---

## H. Target data model

### H1. Masters

| Table | Purpose |
|---|---|
| `party`, `party_identity`, `party_employment` | People and organisations; external codes as identities |
| `org_unit` | Department and reporting hierarchy |
| `asset`, `asset_identity`, `asset_type` | Machines; `asset_identity` resolves `MAN18` ↔ `MAN-18` |
| `asset_component`, `tyre` | Component and tyre lifecycle |
| `location`, `location_geom` | Hierarchy + PostGIS geometry |
| `material`, `grade_spec` | Materials, grade bands, Cr/Fe constraints |
| `shift_calendar` | Shift definitions, versioned |
| `competency`, `asset_compliance` | Licences and statutory documents with expiry |
| `contract`, `contract_rate` | Contractor commercial terms |
| `cost_centre`, `cost_element` | Cost structure |

### H2. Planning & work

| Table | Purpose |
|---|---|
| `plan`, `plan_line`, `plan_version` | All horizons, one structure, versioned |
| `work_order`, `work_order_line` | The transaction backbone |
| `deployment_plan` | Machine + operator per shift |
| `approval`, `approval_step` | Generic workflow |

### H3. Geology & blasting

| Table | Purpose |
|---|---|
| `block`, `block_grade` | Geological model |
| `drill_hole`, `drill_hole_actual` | Planned and actual |
| `sample`, `assay` | Sample-level, with location and depth |
| `blast`, `blast_hole`, `blast_result` | Design through fragmentation |

### H4. The event log

One table, partitioned by month:

```
event(event_id uuid, event_type, occurred_at, recorded_at, source,
      party_id, asset_id, location_id, work_order_id, lot_id,
      payload jsonb, idempotency_key, recorded_by, correction_of)
```

`correction_of` makes corrections explicit and auditable — nothing is ever
updated in place.

### H5. Lot & traceability

| Table | Purpose |
|---|---|
| `lot` | A material parcel with identity, origin and grade |
| `lot_movement` | Every movement of a lot, referencing an event |
| `lot_lineage` | Parent/child when lots merge in a blend or split |

**This is what makes "trace a tonne" real** rather than aspirational.

### H6. Derived ledgers

Rebuildable from the event log at any time:

`equipment_shift_ledger` · `production_ledger` · `stock_ledger` ·
`fuel_ledger` · `maintenance_ledger` · `cost_ledger` ·
`reconciliation_ledger` · `compliance_ledger`

---

## I. Integration architecture

Per §27: system of record → owner → direction → frequency → protocol →
identifier → failure handling.

| System | Owns | Dir | Frequency | Identifier | On failure |
|---|---|---|---|---|---|
| **SAP S/4HANA** | Financial asset, material, sales, despatch | Read; write goods movement later | Near-real-time | `sap_asset_no`, `MATERIAL_NO` | Queue and retry; never block operations |
| **HRMS** | Employee, roster, attendance | Read | Daily + intraday | `EMPID` | Last known roster; flag staleness |
| **Technoton** | Telematics | Read | 5–15 min | `vehicle_desc` → `asset_identity` | Gap detection; mark affected shifts |
| **Weighbridge** | Trip weights — **authoritative tonnage** | Read | Real-time | Ticket no + `RFIDNO` | Store-and-forward; manual ticket fallback with reason |
| **RFID** | Vehicle and person identity at gate | Read | Real-time | Tag EPC | Fall back to manual selection, flagged |
| **Biometric** | Person presence | Read | Real-time | Biometric ID → `party_identity` | Fall back to supervisor attestation |
| **Laboratory / XRF** | Assay results | Read | Per batch | Sample ID | Sample marked pending; grade unresolved |
| **Survey / GNSS / drone** | Volumes, polygons, DTM | Read | Weekly/monthly | Survey ID | Prior survey retained |
| **Sensors** (pumps, level) | Condition | Read | Continuous | Sensor ID | Offline alarm |
| **IMOS** | — | Read during transition | — | — | Retired at end of transition |

**Non-negotiables:** every adapter is idempotent on the source's natural key, so
replay never double-counts; every adapter reports health; no adapter writes
directly to a ledger — only to the event log.

---

## J. Implementation roadmap

Sequenced so each phase is usable on its own. Durations assume a small team and
are deliberately conservative.

| Phase | Months | Delivers | Depends on |
|---|---|---|---|
| **0 · Foundation** | 0–3 | Spine: `party`, `asset`, identity mapping, `location` + PostGIS, `material`, `calendar`; event log; telematics + weighbridge adapters; authorization; audit | — |
| **1 · Identity & compliance** | 2–4 | Competency and compliance registers; licence/document expiry with hard stops; master-data governance | 0 |
| **2 · Deployment** | 4–6 | Single handover replacing nine forms; deployment plan; attendance integration; mobile offline capture | 1 |
| **3 · Production truth** | 5–8 | Work order; production ledger derived from weighbridge; **manual tonnage entry stops**; DQ engine v1 | 0, 2 |
| **4 · Stock & reconciliation** | 8–12 | Lot model; ROM + stockpile ledger; survey integration; first real reconciliation | 3 |
| **5 · EAM & fuel** | 10–14 | PM, breakdown, components, tyres; fuel three-way reconciliation | 2 |
| **6 · Planning** | 12–16 | Full planning hierarchy with versioning and approval; planned-vs-actual | 3 |
| **7 · Drill, blast & geology** | 14–20 | Drill and blast lifecycle; sample and assay; grade control; lot origin from blast | 4, 6 |
| **8 · Commercial** | 16–22 | Contract master, contractor billing, cost ledger, ₹/tonne | 3, 5 |
| **9 · HSE** | 18–24 | Safety, PTW, CAPA, environment | 1 |
| **10 · Intelligence** | 20–30 | Rule-based detection → selective ML; dispatch and blend optimisation | 4, 5, 7 |
| **11 · IMOS retirement** | throughout | Function inventory, parallel run, decommission | per module |

**Phase 3 is the commercial turning point** — the point at which the platform
becomes the source of production truth rather than another place to type numbers.

---

## K. Top 20 risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | No authoritative fleet list exists | Blocks Phase 0 entirely | Assign an owner in week 1; physical fleet audit |
| 2 | RFID coverage lower than assumed | Capture model reverts to manual | Survey coverage before Phase 0 completes |
| 3 | Rated capacities never agreed | Every gap figure disputed | Force sign-off before Phase 6 |
| 4 | Operators reject mobile capture | No deployment data; platform stalls | Design for <30 s per handover; pilot one department |
| 5 | Contractor codes reassigned between people | Identity corruption, silent | Verify in Phase 1; else issue MineHub IDs |
| 6 | Telematics gaps treated as zero utilisation | Machines look idle when unmonitored | DQ engine marks gaps; KPIs exclude rather than zero |
| 7 | Hour meter resets on engine replacement | Utilisation discontinuity | Model meter changes explicitly |
| 8 | Shift-boundary disagreement | Every per-shift number disputed | Decide authority in Phase 0 |
| 9 | Weighbridge vs survey variance unexplained | Reconciliation loses credibility | Publish variance with tolerance bands from day one |
| 10 | Late events change closed shifts | Restated numbers erode trust | Explicit shift close; post-close adjustments visible |
| 11 | Offline sync conflicts | Duplicate or lost handovers | Client UUIDs + idempotency keys; surface conflicts |
| 12 | Shared MySQL refuses connections | Adapter outages | Adapters buffer; never block capture |
| 13 | Scope grows faster than delivery | Nothing reaches production | Phase gates; each phase independently usable |
| 14 | SAP integration underestimated | Phase 8 slips badly | Read-only first; write-back only when proven |
| 15 | Lab turnaround slower than production | Grade unknown at movement time | Provisional grade from block model; revise on assay |
| 16 | Master data degrades post-launch | Back to four partial lists | Named stewards; dedup rules; creation is an approval |
| 17 | Segregation of duties absent | Contractor billing exposure | Build into authorization in Phase 0 |
| 18 | ML built before data supports it | Confident nonsense; credibility lost | Rules first; ML only where rules demonstrably fail |
| 19 | IMOS switched off before inventory | Silent loss of a needed function | Inventory before retirement; month of parallel running |
| 20 | Key-person dependency | Programme stalls on one leaver | Documented decisions in repo; no undocumented logic |

---

## L. Final recommendations

### Add — not currently in the blueprint

1. **Work order** as the transaction backbone (B1)
2. **Lot model** for genuine traceability (B2)
3. **Planning hierarchy** with versioning and approval (B3)
4. **PostGIS spatial model** from day one (B4)
5. **Data Quality engine** as a first-class module (B5)
6. **Workflow and approval service** used by every module (B6)
7. **ERP-grade authorization** with scoping and segregation of duties (B7)
8. **Contract master** — commercial terms as data
9. **Cost ledger** — posted allocations, not monthly spreadsheets
10. **Notification and escalation service**

### Change

11. **Separate mine planning from deployment planning** — different objects, owners and horizons
12. **Design offline conflict resolution explicitly** rather than asserting offline support
13. **Model time properly** — four clocks, one production-day rule, explicit hour-meter changes
14. **Add an explicit shift close** so numbers become final

### Merge

15. **ROM + stockpile → one stock ledger** — the same object twice
16. **Fleet management + EAM → one asset domain**
17. **Tyres + components → one lifecycle model**
18. **All nine HOTO forms → one handover**, department as a column

### Remove

19. **Manual production tonnage entry** — the weighbridge is authoritative
20. **Manual running/idle hours** — telematics measures them
21. **Duplicate gate registers** — one gate event
22. **The IMOS portal** — after a function inventory and parallel running

### Postpone

23. **Digital twin** — year 3+. It needs every other module producing trustworthy data; built earlier it is a visualisation of guesses
24. **Most ML** — rules first
25. **Blend optimisation** — worthless until the stock ledger is trustworthy
26. **Drone and GNSS automation** — manual survey import is sufficient through Phase 4
27. **SAP write-back** — read-only until the platform has proven itself

### The one thing to decide this week

**Who owns the fleet list, and when will it exist?** Phase 0 cannot start
without it, and nothing else in this document can start without Phase 0. It is a
few days of work for someone who knows the mine — and every week it is missing
is a week the entire programme has not begun.

---

## Closing judgement

The expanded scope is coherent and appropriate. Nothing in it should be cut for
being unnecessary — only sequenced for being premature.

The blueprint's foundations survive review: the constitution, the event log and
identity-first were right. Its omissions were the work order, the lot model, the
planning hierarchy and the spatial model, and each of those is structural — they
must be designed now even though they will be built later, because retrofitting
any of them is far more expensive than accommodating them from the start.

The risk to manage is not technical. It is that thirty-six modules of ambition
produce nothing in production for two years. The roadmap is therefore ordered so
that **Phase 3 ends manual production entry** — a visible, defensible win inside
eight months — and every later phase is independently useful on the day it ships.
