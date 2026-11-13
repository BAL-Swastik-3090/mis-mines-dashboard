# HOTO — one gap register

**13 November 2026.** Everything open across the three reviews, in one place,
with a verified status against the code as it stands today.

Sources merged here:

- `D:\Projects\Mines\hoto-architecture-fix-plan.md` — architecture review, 12 Nov
- `docs/hoto-ui-gap-analysis.md` — dashboard screens, 13 Nov
- `docs/hoto-app-issues.md` — tablet app, 13 Nov

Status is **checked in the source today**, not carried over from the documents.

---

## Part 1 · Architecture fix plan — none of the four are done

I checked each one. One is half-addressed; three are untouched.

### P1 · Preserve the checklist actually answered — ⚠️ HALF DONE

**What is there.** `submit()` compares the device's `template_id` /
`template_version` against the one in force and raises an `ops_exception` when
they differ (`hoto_capture.py:314-317`, `:405-414`). That is better than the
silent substitution the review found: the divergence is no longer invisible.

**What is still wrong.** The capture is still *evaluated and stored* against
the current template, not the one answered:

```python
items = _items_for(db, head["template_id"])     # head, not what was answered
... "tpl": head["template_id"], "ver": head["version"]
```

`claimed_tpl` and `claimed_ver` are used only to write the exception text —
they are never stored on the session. So acceptance checks 1 and 2 from the
plan both still fail: a v1 capture synced after v2 publishes is recorded as
v2, and severities come from v2.

### P2 · Define what an immediate machine block means — ❌ NOT DONE

`hoto-architecture.md:166` still reads:

> "A critical answer that is adverse blocks the machine **the moment it is
> given**"

with no distinction between a local warning on one tablet, a server-side
restriction, and physical immobilisation. On a site with no signal those are
three very different things, and the document promises the strongest reading
of all three. No offline hold procedure is written down.

### P3 · Device token reads every operator — ❌ NOT DONE

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

### P4 · Changed content under one UUID is accepted as a replay — ❌ NOT DONE

```python
same = (prior["asset_id"] == payload.get("asset_id")
        and prior["session_type"] == payload.get("session_type"))
```

Two fields. Different answers, a different operator, a different meter
reading, a different template — all return `{"created": False}` and the device
marks the handover as successfully synced. The server keeps the original; the
tablet believes its version was filed. Nobody is told. There is no payload
fingerprint anywhere in the service.

**My reading of the priority:** P4 and P3 are the two that can be wrong
*silently* in production. P4 loses a signed safety record while reporting
success; P3 leaks the whole operator register to one stolen tablet. Both would
be far harder to retrofit after go-live than now.

---

## Part 2 · Dashboard gaps — mostly closed

| # | Gap | Status |
|---|---|---|
| D1 | No screen linked to any other | ✅ board → register/defects, register → defects, defect → handover |
| D2 | Two date controls disagreeing | ✅ register follows the header; control hidden where it drives nothing |
| D3 | Shift Board unjudgeable and unactionable | ✅ shift clock, 7-day trend, grouped by machine type |
| D4 | Defects: no filters, flat ageing | ◐ filters + severity-weighted ageing done; **no assignee or target date** (needs a migration) |
| D5 | No check-failure statistics | ✅ per-question counts, deliberately unranked |
| D6 | Register: shift hidden, no meter check | ◐ shift column + meter-backwards flag done; **pairing and export not done** |

**Found while doing D5, now fixed:** `_items_for` never selected
`adverse_answer`, so **no yes/no check could report a fault, ever** — 34
stored answers are findings that were filed as clean, 17 of them YES to "ROPS
/ FOPS visible damage". Fixed and tested. **The 34 stored records are still
untouched and await your decision.**

**Also found and fixed:** cloning a checklist inserted its columns in the wrong
order and failed outright, so no published checklist could be edited at all.

---

## Part 3 · Tablet app — 21 open items

Full detail in `docs/hoto-app-issues.md`. Summary:

| Group | Count | Headline |
|---|---|---|
| **A · Who is who** | 4 | One name is written as the outgoing operator, the incoming operator *and* the confirmer. Needs a migration. |
| **B · Mandatory fields** | 5 | Nothing is marked required; "All OK" fills everything at once instead of stepping through |
| **C · Untrue messages** | 3 | "Everything has reached the office" shown in green above "6 photos waiting" |
| **D · Hide before production** | 3 | Server address editable on screen; internal sync state shown |
| **E · Not enterprise-grade** | 7 | No animation anywhere, no flow progress, Done button clips its own label |

---

## What I would do, in order

1. **P4** — content-aware replay. A changed safety record acknowledged as
   synced is the worst failure in this list: it is silent, it loses evidence,
   and the tablet reports success.
2. **P3** — scope the operator query. Nearly free; the scope is already in
   hand and simply not passed.
3. **A1–A4** — the person model on the tablet. Needs a migration, so it gets
   harder every day, and until it lands every handover records one name where
   there should be three.
4. **P1** — store and evaluate the version actually answered.
5. **B1–B3** — mandatory fields and sequential "All OK".
6. **P2** — write down what a block means offline, and the mine's hold
   procedure. This is a decision to take with the mine, not code.
7. **E1–E7** — the design pass, after the screens stop changing shape.
8. **D4, D6, C, D** — the remainder.

**Awaiting your decision, blocking nothing:** whether to re-evaluate the 34
yes/no answers that were filed as clean and raise their defects. The answers
are intact so it is reversible in principle, but rewriting stored safety
records is your call.
