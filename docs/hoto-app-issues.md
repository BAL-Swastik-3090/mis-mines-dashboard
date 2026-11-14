# HOTO tablet app — issue list

**13 November 2026.** Open list, numbered so we can pick items off. Nothing
here is fixed yet. Each item says what is wrong and where, so we are not
working from screenshots when we come to fix it.

Add to it freely — the numbering is stable, new items go on the end.

---

## A · Who is who

The biggest one, and the reason it is first: the form has **one** person field
and the record has **three** people in it.

| # | Issue | Where |
|---|---|---|
| **A1** | **One name is recorded as everybody.** `confirm()` is called with the operator's employee id, and that one value is written to `confirmed_by`. So the person going off shift, the person coming on, and the person holding the tablet are all the same name on the record. | `app/capture/confirm.tsx` → `confirm(operator?.emp_id …)`; `session.ts:391` writes `confirmed_by` |
| **A2** | **The form never asks for the counterpart.** "Taking over" is the *session type*, not a person — there is no field for who handed the machine over. | `app/capture/operator.tsx` |
| **A3** | **The two sides are never linked.** `counterpart_session_id` exists on the table and is never set, so nothing can ask "did the outgoing and incoming operator say the same thing about this machine?" — which is the point of a handover. | `hoto_session.counterpart_session_id` |
| **A4** | **No record of who filled it in.** If a supervisor fills in a handover for an operator who cannot read, nothing says so. | — |

**✅ A1–A4 FIXED, 14 Nov** (commit `e3e4f77`, migration 115). Three people:
the operator; the other side — named, or "nobody, it was parked", kept
distinct from *not recorded* on older handovers; and *filled in by*,
defaulting to the operator. The server pairs a takeover with the handover it
follows and raises an exception when the two halves name different people.
The dashboard shows all three names and the other half. The identify screen's
"Not him — change" link, which did nothing, now works, and changing the
operator removes the previous operator's photo.

Still open from this group: the dashboard does not yet compare the two
halves' *answers* (did both say the brakes were fine?). That is D6, pairing,
in the dashboard gap list.

## B · Mandatory fields and the "All OK" flow

| # | Issue | Where |
|---|---|---|
| **B1** | **Nothing on the form is marked required.** Required-ness only appears at the very end, as a dim button. An operator cannot see what is compulsory while filling it in. ◐ *The identify screen now marks each step Required until answered; readings and checklist still do not.* | all capture screens |
| **B2** | **"N things left" does not say which, and does not take you there.** The confirm screen lists them in a box below the fold; the button itself just counts. | `confirm.tsx` → `stopping` |
| **B3** | **"All OK" fills everything at once.** You asked for this to step through instead — ask, answer, next — so the operator passes each check deliberately rather than approving a screen they have not read. | `src/core/routine.ts` → `ROUTINE_PASS` |
| **B4** | **Yes/no checks are left out of "All OK" and nobody is told why.** Correctly so — the pass answer depends on the wording — but the operator just finds them still unanswered with no explanation. | `routine.ts` (no `YES_NO` entry) |
| **B5** | **Required-if rules are invisible.** "Photo required if not OK" is enforced but never shown until it blocks you. | `evaluation.ts` |

## C · Messages that are not quite true

| # | Issue | Where |
|---|---|---|
| **C1** | **"Everything on this tablet has reached the office" shows green while "6 photo(s) waiting to upload" sits directly under it.** The banner's test counts handovers only and ignores photos. | `app/index.tsx:68` — `waiting === 0` |
| **C2** | **Bracket plurals everywhere** — "photo(s)", "handover(s)". Reads as unfinished software. | `index.tsx`, `sync.tsx` |
| **C3** | **The Done screen's amber paragraph is a wall of text** for what is one fact: it is saved here, not filed yet. | `confirm.tsx` → `doneWaiting` |

## D · Things to hide before production

| # | Issue | Where |
|---|---|---|
| **D1** | **Server address is visible and editable** on enrolment and sync, placeholder and all (`http://192.168.1.10:8990`). | `enrol.tsx:335`, `sync.tsx:232` |
| **D2** | **The sync screen shows internal state** — queue counts, rejected counts, sync states. Useful to us, meaningless to an operator. | `sync.tsx` |
| **D3** | **Device/debug details on screen.** To be reviewed as a set once we agree what an operator should ever see. | — |

Agreed approach: leave these working as they are for now, put them behind
something, and change them when we go to production.

## E · It does not look like an enterprise app

| # | Issue | Where |
|---|---|---|
| **E1** | **The Done screen is mostly empty.** Content sits dead-centre in a full screen of white with nothing anchoring it. | `confirm.tsx` → `styles.centre` |
| **E2** | **The Done button is tiny and its label is clipped.** `styles.primary` sets `minHeight: 72` but no width, and inside a centred container it shrinks to the text — so "Done" overflows its own button. A real bug, not just taste. | `confirm.tsx` → `styles.primary` + `styles.centre` |
| **E3** | **No animation anywhere.** No press feedback, no screen transition, no progress on save, nothing on success. Every state change is instant and silent, which is what makes it feel unfinished. | whole app |
| **E4** | **No progress through the capture flow.** Machine → operator → readings → checklist → confirm, with nothing saying where you are or how much is left. | `app/capture/*` |
| **E5** | **The unfinished list is undifferentiated.** Six near-identical cards, most saying "nobody identified yet", in no order of urgency. | `app/index.tsx` |
| **E6** | **Large empty gaps between elements** across the capture screens; spacing is uniform rather than grouped, so nothing reads as belonging together. | `app/capture/*` |
| **E7** | **No visual hierarchy on the checklist itself** — the same fault just fixed on the dashboard: a pass and a fault look alike. | `app/capture/checklist.tsx` |

---

## Suggested order

1. **A1–A4** — the person model. It is the only item that changes what the
   record *means*, and every day we wait is more handovers filed with one name
   where there should be three. It needs a migration, so it is also the one
   that is most awkward to retrofit later.
2. **B1–B3** — mandatory fields and the sequential "All OK". Changes how the
   form is filled in, so it should settle before the visual work.
3. **E1–E7** — the design pass, once the screens have stopped changing shape.
4. **C, D** — tidy-ups, and the production hiding, last.

Doing E before B would mean designing screens we are about to restructure.
