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
| 7b | HOTO register — the screen | ✅ | typechecks | `pending` |
| -- | HOTO permissions (migration 107) | ✅ | dev | `9e732ec` |
| 8 | Defect lifecycle and equipment state machine (migration 108) | ⬜ | | |
| 9 | Admin: Shift HOTO Board — approve / restrict / lock | ⬜ | | |
| 10 | Mobile: the capture flow | ⬜ | | |
| 11 | Mobile: sync engine and photo queue | ⬜ | | |
| 12 | **Field trial on one real tablet** | ⬜ | | |
| 13 | Production migration of 105–107 | ⬜ | | |

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
hardware before committing to the rest.

**13 · Production.** Migrations 105–107 to `corpappdb`, once the dev shape has
survived use.

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

## Still open

1. **Who may override a lock, and on what authority** — blocks phase 9
2. **What a missing handover counts as** — blocks reporting in phase 9
3. **Whether an operator may ever take a machine outside his competency** — blocks phase 5's validation
4. Dumper: its own template, or share the Tipper one (phase 6)
