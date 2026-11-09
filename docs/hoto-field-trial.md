# HOTO — field trial protocol

One tablet, one section, one shift, alongside the paper. The point is not to
collect handovers; it is to find out what breaks on real hardware before the
other tablets are bought.

**Nothing in this document has been run.** Everything up to it has been tested
against the dev backend, and four things in the app have never executed at all
because they need hardware — the camera, the QR scanner, the streaming photo
upload, and the Android background task. The trial is where they first run.

---

## Before the morning

### 1. Build and install

```bash
cd mobile && npx expo-doctor
```

18/18 should pass. Then, from a machine signed in to EAS:

```bash
npx eas build --profile trial --platform android
```

`trial` builds an APK against `https://mines.balasorealloys.in`. Use
`trial-dev` to point at the development server instead — change its
`EXPO_PUBLIC_HOTO_API` in `eas.json` to whichever host the tablet can actually
reach, because `127.0.0.1` is the tablet, not the server.

> The `extra.eas.projectId` in `app.json` is a placeholder. The first
> `eas build` fills it in; commit the change it makes.

### 2. Decide what the tablet is called

Something written on the tablet in marker, because somebody will have to say it
on the radio. `TAB-01` and a label naming where it lives.

### 3. Enrol it

Dashboard → HOTO → the devices API, or directly:

```bash
curl -X POST https://mines.balasorealloys.in/api/hoto/admin/devices \
  -H 'Content-Type: application/json' -b "mines_session=$COOKIE" \
  -d '{"device_code":"TAB-01","label":"Crusher section","profile":"COMPANY"}'
```

**The token comes back once.** Type it into the tablet's setup screen there and
then. If it is lost, re-issue rather than hunting for it:
`POST /api/hoto/admin/devices/TAB-01/reissue`.

The setup screen checks the token against the server before keeping it, so a
wrong character is found in the office rather than at the end of a shift.

### 4. Make sure there is something to hand over

- The section's machines must be `ACTIVE` and have a **published** checklist for
  their asset type. A machine whose type has no ACTIVE template cannot be handed
  over at all, and the app says so rather than showing an empty list.
- **`operator_competency` has one row for 269 operators.** Every capture will
  therefore warn that the operator is not signed off on the machine. That is the
  app telling the truth about the data, but it will be constant noise for a week
  and somebody will learn to tap past it. Either load the competency register
  first, or agree in advance that the warning is expected and is not what the
  trial is testing.

---

## The shift

Paper as normal, in parallel, for every handover. The tablet is the thing on
trial, not the handover.

### What to do, in this order

| # | Do this | What should happen |
|---|---|---|
| 1 | Open the app with the tablet in flight mode | Machine list is there. It was cached, so the absence of signal changes nothing. |
| 2 | Scan the sticker on the cab | The machine opens. **First time the scanner has ever run.** |
| 3 | Identify the operator by employee number | His name appears. If he has no number on record, find him by name — 32 operators are in that position. |
| 4 | Work through the checklist with the machine in front of you | Every question answerable while looking at the machine, in sunlight, with gloves on. |
| 5 | Answer one critical item **Not OK** | Red banner says the machine does not change hands, immediately, not at the end. Remark box and camera appear at once. |
| 6 | Take the photo | **First time the camera has ever run.** |
| 7 | Read the meter, enter it | Enter a number *lower* than the last reading first: it must query that before accepting. Then the right one. |
| 8 | Confirm | Says *recorded*, and says plainly it is on the tablet and not yet filed. |
| 9 | Kill the app mid-walk-round on the next machine | Reopen: it offers to resume, and the answers already given are there. |
| 10 | Leave flight mode on for the whole shift | Home screen keeps saying how many are waiting, and does not pretend otherwise. |
| 11 | At the gate, turn the radio on and leave the app open | Handovers go, then the photos. **First time the streaming upload has run.** |
| 12 | Press Sync now while the signal is bad | Partial progress, retried. Nothing lost. |
| 13 | Close the app with items still queued, wait an hour | Expect **nothing** to be sent. The background task is best-effort and Android mostly will not run it. If it does, note it; do not depend on it. |

### What to write down after each machine

Not a form — a sentence. The useful observations are the ones nobody predicted.

- Did the operator need help, and with which question?
- How long did the walk-round take against the paper?
- Anything he said that the app made harder than paper.
- Anything on screen he read wrongly.

---

## What counts as a pass

The trial passes if all of these hold. It does not pass on "it mostly worked".

1. A handover captured entirely offline reaches the server, complete, with its
   photo, once the tablet sees a signal.
2. An interrupted upload recovers without losing anything and without filing
   anything twice.
3. A failed critical check blocks the machine on screen **at the machine**, and
   the resulting defect is on the Shift Board before the next shift starts.
4. The operator can complete a walk-round without being talked through it twice.
5. The tablet's own clock, GPS and photo all land on the record and are legible
   in the register afterwards.

## What counts as a stop

Any of these and the other tablets wait:

- A handover is lost — captured and confirmed, never arrives, no row on the
  tablet explaining why.
- The same handover is filed twice.
- The app refuses a handover for a machine that was genuinely handed over.
- A photo arrives corrupt and is accepted. (The server hashes it, so this should
  be impossible; if it happens the hashing is wrong, which is worse than the
  photo.)

---

## Afterwards

Compare the tablet's register against the paper, handover by handover, for the
whole shift. Every difference is either a bug or a thing the paper was wrong
about, and both are worth knowing.

Then answer the three questions the scope has been carrying since the start
(`hoto-scope.md` §9), because the trial is the first time anybody has evidence
rather than opinions:

1. **Who may release a locked machine.** The mechanism exists and needs
   `hoto.override`; today only the superadmins hold it, by inheritance rather
   than by anyone's decision.
2. **What a missing handover counts as.** The board reports four cases
   separately rather than guessing a denominator; after a shift of real data,
   the mine can see which of them actually occur.
3. **Whether an operator may take a machine outside his competency.** Currently
   recorded and warned, never refused.

## Known gaps going in

| Gap | Why it is not fixed yet |
|---|---|
| Camera, scanner, streaming upload, background task unproven | Need hardware; this trial is the first run |
| `operator_competency` effectively empty | Data, not code. Will warn on every capture |
| No photo viewing in the dashboard register | The bytes are stored and `/api/hoto/photos/{id}` serves them; no screen shows them yet |
| Background sync with the app closed | Android will not reliably honour it. The app says so rather than implying otherwise |
| An asset typed wrongly gets the wrong checklist | One asset with `fleet_code` WATER-TANKER is typed as a Tipper and resolves the 24-item tipper list |
