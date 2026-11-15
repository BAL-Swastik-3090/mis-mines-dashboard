# HOTO screens — gap analysis

**13 November 2026.** Written against the six screens as they stand, with the
live Kaliapani data in them. Every claim below was checked in the code or the
database, not inferred from a screenshot.

The screens work. What follows is about whether they *answer the questions
people bring to them* — which is a different and harder test than whether they
display the data correctly.

---

## The one fault that runs through all six

**Everything that matters is hidden one click deep, and the lists are flat.**

Each screen is a table of rows plus a detail panel. The detail panels are
genuinely good — the register's panel carries shift, GPS, photos, device,
meter, every answer; the defects panel carries the whole rectify/verify
workflow. But the **list** is where somebody decides what to look at, and the
lists are the weakest part of every screen.

The result: to answer "is anything wrong this shift?" you open rows one at a
time. With 74 machines that is not a workflow, it is a search.

Three concrete consequences, all verified:

| Gap | Evidence |
|---|---|
| **No screen links to any other** | `setPage` appears in **zero** HOTO sections. A defect cannot jump to the handover that raised it; a board row cannot jump to that machine's register. |
| **Shift is recorded but never listed** | Migration 113 added `shift_code` and `production_day`. They appear only in the register's detail panel (line 445), never as a column — so you cannot see "A shift vs B shift" without opening rows. |
| **Two date controls that disagree** | The header says *1 Nov – 13 Nov*. The register says *06-11 – 13-11*. **No HOTO screen uses `useDateFilter`** — 13 other sections do. Two date ranges on one screen, each claiming to be the filter. |

---

## Screen by screen

### 1. Shift Board — the biggest gap, and the most important screen

Today it says: **0 handed over, 61 nobody filled it in, 1 off work, 12 no
checklist**, over 74 rows of `AVAILABLE / Nobody filled it in / — / —`.

That number is alarming and the screen gives no way to act on it or judge it.

- **No sense of time within the shift.** A handover missing at 06:10 is normal;
  the same one missing at 13:50 is a shift that was never signed for. The board
  reads identically at both. It should age each machine against the shift clock.
- **No history.** Is 61 bad? Was yesterday 61? Without a trend beside the tally,
  nobody can tell a broken rollout from a bad day, and the first instinct will
  be to disbelieve the screen.
- **No grouping.** 74 flat rows. Group by machine type or by department and the
  eye finds "every drill is missing" instantly; as a flat list that pattern is
  invisible.
- **No "who was expected".** The board says nobody filled it in, but not who
  should have. Without that it is an accusation with no address.
- **STATE and FLAGS say the same thing twice.** `RESTRICTED` is derived from the
  open defects already shown in OPEN and FLAGS — three columns, one fact.
- **Nothing is actionable.** No way to mark a machine as not expected, or to
  see why it was.

**Recommendation:** make the board a *shift-progress* screen rather than a
roster. Tally with a 7-day sparkline, machines grouped by type, each row aged
against the shift clock, and a one-click jump to that machine's register.

### 2. Register — a list that hides its own best column

- **Shift belongs in the table**, not the panel. It is the second thing anybody
  filters by after date.
- **Handover and takeover are never shown as a pair.** Every row reads "Taking
  over". `counterpart_session_id` exists on the table and is not used in the
  list — so the register cannot answer "did the outgoing operator and the
  incoming one say the same thing about this machine?", which is the entire
  point of a handover record.
- **Meter movement is not checked across rows.** The current data shows
  BD-80-15306 at 8335, 8339, 8334, 8328 on consecutive handovers. A meter that
  runs backwards between two handovers of one machine is either a typo or a
  swapped machine, and the register is the only place that can see it.
- **No export.** A register whose job is evidence should produce a file.
- **The crossed-out GPS pin is unexplained.** It appears on most rows and
  nothing on screen says it means "no position recorded".

### 3. Defects — good workflow, no ownership

The rectify/verify discipline is right, and better than most systems have.
What is missing is everything about *who and when*:

- **No assignee.** Ten open defects and no column saying who is fixing any of
  them.
- **No target date, and no ageing beyond a raw `3d`.** A critical brake defect
  at 3 days should not look like a horn at 3 days.
- **`SEEN 4×` does not link to the four sightings** — the most interesting
  thing on the row is the one thing you cannot click.
- **No filtering at all** except "include closed". No filter by machine,
  severity or stage.
- **Free text is unvalidated.** `Yuuu` and `Ty` are in the live table as defect
  descriptions. The tablet should refuse a description that carries no
  information.

### 4. Checklists — the data nobody is using

The coverage panel is the best thing on this screen: ten machine types that
cannot be handed over at all is exactly the right headline.

- **A draft cannot be read without clicking into it**, and cannot be printed —
  so "walk round the machine with it and correct it", which is how these get
  signed off, is not supported.
- **No version history or diff.** v1 → v2 with no way to see what changed.
- **No usage figures.** The system knows which checks are answered NOT_OK most
  often across the fleet. That is the single most valuable number in the whole
  module — it tells the mine which checks are earning their place and which are
  noise — and no screen shows it.

### 5. Devices — closest to finished

The "stopped reporting" alarm is the right design: it states the symptom and
the two possible causes without pretending to know which.

- Positions are listed but **never drawn on a map**, though every fix is stored.
- **No warning on app-version drift** — one tablet left on an old build is how
  a fixed bug comes back.

### 6. Cab stickers — working as intended, no changes proposed.

---

## What I would do, in order

1. **Link the screens together.** Board row → register; defect → its handover;
   handover → its defects. One day's work, and it turns six screens into one
   tool.
2. **Put shift in the register's table, and make the global date filter drive
   every HOTO screen.** Removes the contradiction and the hidden column.
3. **Rebuild the Shift Board as shift progress** — aged against the shift clock,
   grouped by type, with a trend beside the tally.
4. **Ownership and ageing on defects** — assignee, target, severity-weighted age.
5. **Check-failure statistics on the checklists screen.**
6. **Pair handover with takeover in the register.**

Items 1 and 2 are small and remove active contradictions; I would do them
before anything else. Item 3 is the one that changes how the mine runs a shift.
