# Are we doing the architecture fix plan? — verification

**13 November 2026.** Checked against `D:\Projects\Mines\hoto-architecture-fix-plan.md`
(dated 12 November). Every line below was read in the source today, not inferred
from the plan or from earlier notes.

## Score

| # | Finding | Priority | Status |
|---|---|---|---|
| 1 | Preserve the checklist actually answered | high | **Substantially done**, three residual gaps |
| 2 | Define what an immediate machine block means | high | **Not started** |
| 3 | Device-token exposure and operator scoping | medium | **Not started** |
| 4 | Detect changed content under the same UUID | medium | **Not started** |

One of four. The plan has not been worked through — the work since it was
written went to different problems (listed at the end), two of which were more
severe than anything on it.

---

## 1 · Preserve the checklist actually answered — substantially done

The plan's central worry was that a capture made offline against v1 would be
re-evaluated against v2 after it synced. **That specific fault is handled**, and
deliberately so:

- `hoto_masters.resolve_template(..., on_date=)` resolves the checklist in force
  **on the production day the handover belongs to**, not today.
- `hoto_admin.publish()` **deliberately does not retire the previous version**,
  with a comment saying why: the date-based resolver needs earlier versions to
  stay `ACTIVE` so a late capture still resolves what was genuinely in force.
- `hoto_capture.submit()` compares the device's claimed `template_id` /
  `template_version` against the resolved one and raises a
  `HOTO_VERDICT_DRIFT` ops exception when they differ, rather than swallowing it.

So the acceptance checks 1 and 2 in the plan would now pass.

**Residual gap 1a — the answered version is still not what gets stored.**
`submit()` evaluates `_items_for(head["template_id"])` and stores
`"tpl": head["template_id"], "ver": head["version"]` — the *resolved* version,
not the *claimed* one. When they diverge (a device with a stale master cache),
the server evaluates against the version it thinks was in force and files the
record under that version, while raising an exception. The plan asked for the
answered version to be persisted as immutable evidence. Today the exception is
the only trace that the operator saw different questions.

**Residual gap 1b — `production_day` from the device is a UTC date slice.**
`mobile/src/core/capture/session.ts:460` sends
`production_day: s.captured_at.slice(0, 10)`, and `captured_at` is written as
`now.toISOString()` — UTC. For IST (+05:30) every capture between **00:00 and
05:29 local reports the previous day**, which is precisely the night shift.
Narrow in effect: the *stored* `production_day` is computed server-side by
`_shift_for()`, which converts correctly, so only **template resolution** uses
the device's value — and it only bites on a day a template changed. Still wrong.

**Residual gap 1c — no quarantine path.** The plan asked for an unknown,
invalid or inapplicable template to land in a controlled exception record. Today
an unresolvable template is a 409 and the capture is refused outright; an
*inapplicable* one (right id, wrong machine type) is not checked at all.

## 2 · What an immediate machine block means — not started

The documentation still makes the claim the plan flagged, word for word:

> `docs/hoto-architecture.md:166` — "A critical answer that is adverse blocks the
> machine **the moment it is given**, not at the end"

Three ways that is not what happens:

- **The block is recorded at confirm, not at the answer.**
  `mobile/src/core/capture/session.ts:389` sets `status = 'BLOCKED'` inside
  `confirm()`. Entering the adverse answer writes a response row and nothing else.
- **An abandoned draft reports nothing at all.** A draft never syncs, so a
  critical finding entered and walked away from reaches nobody. This is not
  hypothetical: **the tablet currently holds six unfinished handovers**
  (MAN-51, DOZCO-DOZER, AMBULANCE, CAT-424B, BD-80-15306, MAN-11) and six
  photographs belonging to them.
- **Nothing says what "block" means physically.** No immobilisation integration
  exists, and the document does not say so.

Also undone from the plan: when the server restriction takes effect, how other
devices learn of it, the offline hold procedure, and how a release reaches an
offline device.

## 3 · Operator scoping — not started

`hoto_masters.operators()` takes **no scope parameter at all**:

```python
def operators(db: Session) -> list[dict[str, Any]]:
    ...
    WHERE o.profile_status = 'ACTIVE'
    ORDER BY 3
```

Every enrolled device receives **every active operator in the company** — name,
employee reference, plant, department, competency list and competency expiry.
`o.plant_id` is selected but never filtered on. The device's own plant is never
passed in.

The architecture document's section 5 claim that a stolen token cannot read the
operator register is therefore still wrong, and still published.

## 4 · Content-aware replay — not started

`hoto_capture.submit()`:

```python
same = (prior["asset_id"] == payload.get("asset_id")
        and prior["session_type"] == payload.get("session_type"))
```

Two fields. A retry under the same `client_uuid` carrying **different answers, a
different operator, a different meter reading, a different template or different
GPS** is accepted as an identical replay, and the original is returned as though
nothing differed. No canonical fingerprint is computed or stored. The plan's
acceptance check 3 fails today.

Concurrency is handled by the `client_uuid` unique constraint, so acceptance
check 4 is probably fine, but nothing tests it.

---

## What was done instead, since the plan was written

Not a defence of the above — these were found while doing other work, and two
were worse than anything on the plan:

- **Every yes/no check was unable to report a fault.** `_items_for()` never
  selected `adverse_answer`, so the branch that classifies a yes/no finding
  never fired. 34 stored answers are findings filed as clean, 17 of them YES to
  *"ROPS / FOPS visible damage"* — the rollover protection. Fixed, with a test
  that asserts the column arrives.
- **No published checklist could be edited at all.** The clone statement's
  column list and SELECT were misaligned, so every "Clone to draft" failed with
  a database error. Fixed and verified item-by-item against the source.
- Photo geotagging fell back to a recent fix instead of recording nothing;
  dashboard screens were linked to each other; the shift board gained a shift
  clock and a week of history; the register gained shift and a
  meter-runs-backwards flag.

## Suggested order from here

1. **3 — operator scoping.** Smallest change on the list, and it is a data
   exposure that is live on five enrolled devices.
2. **2 — the block claim.** Mostly writing, but it has to be settled before the
   app's capture flow is redesigned, because it decides whether an unconfirmed
   draft may hold a finding.
3. **1a/1b/1c — the residual template gaps.** 1b is a one-line fix.
4. **4 — fingerprinting.** Largest, and the least likely to bite while every
   device is on the same version.
