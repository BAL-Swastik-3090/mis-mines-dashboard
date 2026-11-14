# HOTO — one gap register

**13 November 2026.** Everything open across the three reviews, in one place,
with a verified status against the code as it stands today.

Sources merged here:

- `D:\Projects\Mines\hoto-architecture-fix-plan.md` — architecture review, 12 Nov
- `docs/hoto-ui-gap-analysis.md` — dashboard screens, 13 Nov
- `docs/hoto-app-issues.md` — tablet app, 13 Nov

Status is **checked in the source today**, not carried over from the documents.

---

## Part 1 · Architecture fix plan — three of four done

**Updated 13 Nov, evening.** P3 and P4 are now fixed, and residual gap 1b with them. P2 is a decision for the mine, not code.

I checked each one. **One is substantially done; three are untouched.**

### P1 · Preserve the checklist actually answered — ✅ SUBSTANTIALLY DONE

**Corrected 13 Nov, later the same day.** An earlier version of this register
said acceptance checks 1 and 2 still failed. That was wrong, and the error was
mine: I read `submit()` resolving a template and concluded it resolved today's.
It does not.

`resolve_template(..., on_date=)` resolves the checklist in force **on the
production day the handover belongs to**:

```sql
WHERE status = 'ACTIVE' AND effective_from <= :on
ORDER BY ... effective_from DESC, version DESC
```

and `publish()` **deliberately leaves the previous version ACTIVE**, with a
comment saying exactly why — the date resolver needs earlier versions present
so a late capture still finds what was genuinely in force. So a v1 capture that
syncs after v2 is published resolves to v1 and keeps v1's severities.
Acceptance checks 1 and 2 pass.

Three residual gaps remain, all narrower than the original finding:

- **1a** — when the device's *claimed* version differs from the resolved one,
  the server stores the resolved one and records the divergence only in the
  exception text. The answered version is not persisted as evidence.
- **1b** — `session.ts:460` sends `production_day: captured_at.slice(0, 10)`
  from a UTC timestamp. In IST every capture between 00:00 and 05:29 local
  reports the **previous day** — precisely the night shift. The *stored*
  production day is recomputed server-side and is correct; only template
  resolution uses the device's value, so this bites only on a day a template
  changed. A one-line fix.
- **1c** — no quarantine path for an unknown or inapplicable template. Lower
  severity than it reads: the server never *uses* the claimed template, so a
  wrong-machine-type claim cannot mis-evaluate a capture; it raises drift. The
  gap is about preserving evidence, not about safety.

### P2 · Define what an immediate machine block means — ❌ NOT DONE

`hoto-architecture.md:166` still reads:

> "A critical answer that is adverse blocks the machine **the moment it is
> given**"

with no distinction between a local warning on one tablet, a server-side
restriction, and physical immobilisation. On a site with no signal those are
three very different things, and the document promises the strongest reading
of all three. No offline hold procedure is written down.

### P3 · Device token reads every operator — ✅ FIXED

The sharpest one, because the fix is nearly free and the exposure is real.

```python
"assets":    assets(db, plant_id=plant_id),   # scoped
"operators": operators(db),                   # NOT scoped
```

`sync_bundle()` already *receives* the authenticated device's plant
(`hoto_device.py:81` passes `device["plant_id"]`), and passes it to `assets()`.
`operators()` takes no scope parameter at all and selects every ACTIVE
operator in the company, with names, employee references and competencies.

So a stolen or cloned device token reads the entire operator register of every
site — and Section 5 of the architecture document says it cannot.

### P4 · Changed content under one UUID accepted as a replay — ✅ FIXED

```python
same = (prior["asset_id"] == payload.get("asset_id")
        and prior["session_type"] == payload.get("session_type"))
```

Two fields. Different answers, a different operator, a different meter
reading, a different template — all return `{"created": False}` and the device
marks the handover as successfully synced. The server keeps the original; the
tablet believes its version was filed. Nobody is told. There is no payload
fingerprint anywhere in the service.

**Both are now fixed.** P3 scopes the operator query to the device's site and
declares the breadth when a device has none, with the site settable in the
Devices table. P4 fingerprints the immutable payload on first acceptance
(migration 114) and refuses a retry whose content differs, leaving the
original untouched. 24 tests on the equivalence rules, and the whole rule
driven end to end through the real service.

Residual gap **1b** is fixed too: `production_day` was a UTC date slice, so in
IST every capture before 05:30 local reported the previous day — the night
shift, every night.

**P2 remains**, and it is mostly a decision rather than code: what a block
means on a site with no signal, and the mine's hold procedure.

---

## Part 2 · Dashboard gaps — all six closed

| # | Gap | Status |
|---|---|---|
| D1 | No screen linked to any other | ✅ board → register/defects, register → defects, defect → handover |
| D2 | Two date controls disagreeing | ✅ register follows the header; control hidden where it drives nothing |
| D3 | Shift Board unjudgeable and unactionable | ✅ shift clock, 7-day trend, grouped by machine type |
| D4 | Defects: no filters, flat ageing | ✅ filters, an owner and a target date (migration 116); overdue judged against the date, or the severity norm when none is set, and marked as such |
| D5 | No check-failure statistics | ✅ per-question counts, deliberately unranked |
| D6 | Register: shift hidden, no meter check | ✅ shift (see below), meter-backwards flag, each handover paired with its takeover and compared check by check, CSV export |

**Found while doing D5, now fixed:** `_items_for` never selected
`adverse_answer`, so **no yes/no check could report a fault, ever** — 34
stored answers are findings that were filed as clean, 17 of them YES to "ROPS
/ FOPS visible damage". Fixed and tested. **The 34 stored records are still
untouched and await your decision.**

**Also found and fixed:** cloning a checklist inserted its columns in the wrong
order and failed outright, so no published checklist could be edited at all.

**Found on 14 Nov, both mine, both fixed:**

- **The 13 Nov yes/no fix reached the verdict and nothing else.** Defect
  raising, the register's fault count and its detail each kept their own copy
  of the old rule, so a "ROPS damage: YES" handover was marked BLOCKED but
  raised no defect, locked no machine and showed no fault. Its test had
  asserted on the evaluator. A fault is now one rule everywhere -- an answer
  with a severity -- and a new test files a real ROPS handover and checks the
  defect, the lock, the list, the filter and the detail (commit `9a92979`).
- **The register's Shift column showed a dash on every row.** It read fields
  the list query never selected, though all 30 handovers have a shift stored.
  I marked it done from the screen code without checking what the screen
  received (commit `6b26a71`).

**The stored yes/no faults awaiting your decision number 50, not 34.** All
were filed 9-12 Nov, before the fix. The 34 quoted earlier was 17 "ROPS / FOPS
visible damage" and 17 "Abnormal sound / vibration"; that count missed 16
more from other checklists on 9 Nov -- tyre cuts / bulges (5), exhaust smoke
(5), tread depth below limit (5), abnormal sound (1). Same question: whether
to re-evaluate them and raise their defects.

---

## Part 3 · Tablet app — 19 of 22 done

Full detail in `docs/hoto-app-issues.md`. Summary:

| Group | Count | Headline |
|---|---|---|
| **A · Who is who** | 4 | ✅ **Fixed 14 Nov** — three people on every handover, and the two halves paired (migration 115) |
| **B · Mandatory fields** | 5 | ✅ **Fixed 14 Nov** — one check at a time, Required shown where asked, every thing left takes you to it |
| **C · Untrue messages** | 3 | "Everything has reached the office" shown in green above "6 photos waiting" |
| **D · Hide before production** | 3 | Server address editable on screen; internal sync state shown |
| **E · Not enterprise-grade** | 7 | ✅ **Fixed 14 Nov** — motion, flow progress, urgent drafts first, grouped spacing, checklist hierarchy |

---

## Found on 14 November, while fixing A

- **A test handover locked a real machine and the cleanup left it locked.**
  The live contract test files a BLOCKED handover; that raises a critical
  defect, which locks the machine and closes whatever window was open on it.
  Removing the test handover did not undo the lock, so the drill
  ATLAS-COPCO-DRILL-ICM-260-3 sat LOCKED over its genuine RESTRICTED window
  from 12 Nov. Put back as it was, and the cleanup script now undoes machine
  state too. Worth knowing for production: deleting a handover never releases
  what it locked.
- **The live contract fixtures answered every yes/no check YES** — since the
  `adverse_answer` fix that is correctly a fault ("Abnormal sound"), so all
  eight live tests had been failing. Fixed; 12 of 12 pass against the running
  server.

## What I would do, in order

1. **P4** — content-aware replay. A changed safety record acknowledged as
   synced is the worst failure in this list: it is silent, it loses evidence,
   and the tablet reports success.
2. **P3** — scope the operator query. Nearly free; the scope is already in
   hand and simply not passed.
3. ✅ **A1–A4** — done 14 Nov. Was: the person model on the tablet. Needs a migration, so it gets
   harder every day, and until it lands every handover records one name where
   there should be three.
4. **P1** — store and evaluate the version actually answered.
5. ✅ **B1–B5** — done 14 Nov. Was: mandatory fields and sequential "All OK".
6. **P2** — write down what a block means offline, and the mine's hold
   procedure. This is a decision to take with the mine, not code.
7. ✅ **E1–E7** — done 14 Nov. Was: the design pass, after the screens stop changing shape.
8. **D4, D6, C, D** — the remainder.

**Awaiting your decision, blocking nothing:** whether to re-evaluate the 34
yes/no answers that were filed as clean and raise their defects. The answers
are intact so it is reversible in principle, but rewriting stored safety
records is your call.
