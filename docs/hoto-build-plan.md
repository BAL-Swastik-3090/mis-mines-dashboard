# HOTO — build plan and progress

One row per phase. Updated as each lands. Scope and reasoning live in
[`hoto-scope.md`](hoto-scope.md); this file is only *where we are*.

**Legend** — ✅ done · 🔨 in progress · ⬜ not started · ⛔ blocked

| # | Phase | Status | Lands in | Commit |
|---|---|---|---|---|
| 1 | Checklist model, admin-controlled, seeded with the rescued library | ✅ | dev | `57f3ecb` |
| 2 | Session model — sessions, responses, devices | ✅ | dev | `7f9abd7` |
| 3 | Mobile foundation — enums, rules engine, local schema, tests | ✅ | repo | `4610662` |
| 4 | API: what the device syncs down | ✅ | dev-tested | `e161582` |
| 5 | API: capture — submit a session, idempotently | ✅ | dev-tested | `d6909f2` |
| 6a | Admin templates — **the API** | ✅ | dev-tested | `pending` |
| 6b | Admin templates — **the screen** | ⬜ | | |
| 7a | HOTO register — the API | ✅ | dev-tested | `9e732ec` |
| 7b | HOTO register — the screen | ✅ | typechecks | `794c053` |
| -- | HOTO permissions (migration 107) | ✅ | dev | `9e732ec` |
| 8a | Defects + state machine — the schema (migration 108) | ✅ | dev-tested | `0b9d6da` |
| 8b | Defects — the API and escalation | ✅ | dev-tested | `a0f7458` |
| 8c | Defects — the workshop screen | ✅ | driven in a browser against seeded dev data | `17508d3` |
| 9a | Shift Board — the API and the override rule | ✅ | dev-tested | `65db41c` |
| 9b | Shift Board — the screen | ✅ | driven in a browser, override exercised end to end | `0807191` |
| 10a | Mobile capture — the rules, the cache, the state machine | ✅ | 57 tests, incl. a live contract test against the dev backend | `ac7987d` |
| 10b | Mobile capture — the screens | ✅ | typechecks; 20 render tests on the rules component; camera screens unproven until phase 12 | `f206c67` |
| 11a | Photo storage on the server (migration 109) + upload endpoint | ✅ | applied to dev; 7 live contract tests | `c4c9f64` |
| 11b | The sync engine, backoff and conflict retention | ✅ | 32 tests against a transport that fails on purpose | `c4c9f64` |
| 11c | Triggers and the "still on this tablet" screen | ✅ | typechecks; background task unproven until phase 12 | `c4c9f64` |
| 12a | Device enrolment and device authentication | ✅ | 30 checks end to end, incl. the exemption boundary | `194c4bd` |
| 12b | Buildable: app.json, eas.json, permissions | ✅ | expo-doctor 18/18 | `194c4bd` |
| 12c | The trial protocol | ✅ | written, not yet run | `194c4bd` |
| 12d | **Running the trial on a real tablet** | ⬜ | needs a tablet and a shift | |
| 13 | Production migration of 105–109 | ⬜ | **held until ~75% built** | |

---

## What each phase means

**4 · API: what the device syncs down.** `GET` endpoints for the masters a
device caches: assets with their last meter reading and open-defect count,
operators with competency, locations, and the resolved checklist template for
an asset type. Includes the resolver — asset type, then plant, then department,
most specific ACTIVE template winning. Read-only, so it can ship before any
write path is settled.

**5 · API: capture.** `POST` a session with its responses. Idempotent on
`client_uuid`: the same capture replayed returns the original record rather
than creating a second handover. Re-evaluates the rules server-side and records
any disagreement with the device's verdict instead of trusting either blindly.

**6 · Admin: templates.** The reason the schema is shaped the way it is.
Sections, items, response types, ranges, severities, photo rules — all edited
here. Clone-to-draft and publish, never edit an ACTIVE row, because editing a
published template rewrites what signed records claim to have answered.

**7 · Admin: HOTO register.** Every session, searchable by machine, operator,
shift, date and status, with the full checklist as answered, readings, defects
and photos. This is the screen that gets opened when there is an argument, so
it reads as a record rather than a dashboard.

**8 · Defect lifecycle and state machine.** A defect that outlives the shift:
raised, acknowledged, rectified, verified, closed — with owner, times, evidence
and release authority. Plus the equipment states (AVAILABLE, RUNNING, CAUTION,
RESTRICTED, BREAKDOWN, UNDER_MAINTENANCE, LOCKED) and their history.

**9 · Shift HOTO Board.** The supervisor's primary surface: every machine in a
shift, approve / restrict / lock each one, open issues routed.

**10 · Mobile capture flow.** Pick machine → identify operator → checklist →
readings → defects with photos → confirm. Offline throughout.

**11 · Sync engine.** The outbox, photo queue, retry with backoff, conflict
retention. Sync on open, on reconnect while open, scheduled background work,
and a visible Sync now — Android will not honour anything stronger.

**12 · Field trial.** One tablet, one section, one shift, alongside the paper.
Prove offline capture, geotagging and interrupted-upload recovery on real
hardware before committing to the rest. The protocol, what counts as a pass and
what counts as a stop are in [`hoto-field-trial.md`](hoto-field-trial.md).

Getting there needed two things that were missing and would have stopped the
trial on its first morning: the app had no Expo config at all, so there was
nothing to build; and a tablet had no way to authenticate, because the app read
a dashboard session cookie that nobody ever wrote and that would have been the
wrong credential anyway — it idles out in twenty minutes, the platform permits
one per employee, and it would mean typing a dashboard password into a shared
tablet in a pit. Devices now carry their own token.

**13 · Production.** Migrations 105–110 to `corpappdb`, once the dev shape has
survived use.

**14 · A device joins by itself.** ✅ 10 Nov. Enrolment inverted: the app
registers with what hardware it is and who is asking, the office approves it
from the dashboard, and the app collects its own credential. Nobody types a
token or a server address. Devices also report their position, batched through
the ordinary sync, switchable per device from the dashboard.

Phase 12's enrolment — an administrator running a command and carrying a
43-character token to the device — is kept for a bench test and is no longer
how a device joins. It did not survive contact with the question "how does the
fifth device get set up".

---

## Decisions already taken

| | |
|---|---|
| Mobile stack | React Native + Expo + TypeScript (9 Nov — changed from Flutter, see scope §14.3) |
| Backend | Existing FastAPI, `minehub` schema, existing role model |
| Admin | Existing Next.js dashboard, new section |
| Handover model | Sessions, not one row per handover (scope §14.1) |
| Checklist | Four response types, gauge ranges, per-item severity; all admin-editable |
| Device identity | Per capture on a shared tablet, never inherited |
| Offline | Local SQLite under SQLCipher is the on-device source of truth |
| Joining | The device asks, the office approves, the device collects (10 Nov) |
| Position | Per device, off unless the office turns it on; a foreground service, so visibly on |

## Still open

1. **Who may override a lock** — no longer blocks phase 9. The mechanism
   landed in 9a: releasing a machine its own defects say should be held needs
   `hoto.override` and a written reason, and raises an exception. What is still
   open is purely WHO holds that permission — today only the superadmins, and
   only because the platform grants every new permission to them. A decision
   for the mine, not a default to inherit.
2. **What a missing handover counts as** — still open. Phase 9 reports the four
   cases separately (captured / nobody filled it in / already off work / no
   checklist) rather than guessing a denominator.
3. **Whether an operator may ever take a machine outside his competency** — blocks phase 5's validation
4. Dumper: its own template, or share the Tipper one (phase 6)
5. **Whether a worker's own phone may be tracked** — the mechanism is per
   device and defaults to off, and the approval screen warns when a device is
   marked as somebody's own phone. Whether the mine does it at all, and what
   it tells people, is not a technical decision.
