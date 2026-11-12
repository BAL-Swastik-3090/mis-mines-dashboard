# HOTO — how it is built, and why

**For validation.** Every flow below is written so that somebody who runs the
mine can say "no, that is not how we do it". Where a decision was taken that
the mine has not confirmed, it is marked **ASSUMPTION** and listed again at the
end. Where something is built but has never been proven on real hardware, it
says so.

Current as of 12 November 2026, branch `hoto-foundation-09-11-2026`.

---

## 1. What this replaces

A handover is the moment one operator gives a machine to another. Today that is
a paper sheet, or nothing. The questions this system exists to answer:

| Question | Who asks it | Answerable before? |
|---|---|---|
| Was this machine checked before the shift took it? | Shift in-charge | No |
| Who signed for it? | Safety, after an incident | Rarely |
| What was wrong with it, and did anyone fix it? | Workshop | No |
| Which machines are not fit to work right now? | Production | No |
| Did the fault reported last Tuesday ever get closed? | Maintenance head | No |

The design follows from one rule: **a record of something that happened is
worth more than a record of something that should have happened.** A handover
nobody filed tells you nothing. So the system never refuses to record what an
operator found — it records it and raises the consequence separately.

---

## 2. The four pieces

```
   ┌──────────────┐  the operator, at the machine, usually with no signal
   │  Android app │  Expo / React Native · SQLite under SQLCipher
   └──────┬───────┘
          │  device token in a header · batched, idempotent, offline-first
          ▼
   ┌──────────────┐  FastAPI · the only thing that decides anything
   │   backend    │
   └──────┬───────┘
          │
    ┌─────┴──────┐
    ▼            ▼
┌────────┐  ┌──────────┐   the office: approve devices, read the board,
│postgres│  │ Next.js  │   chase defects, edit checklists
│minehub │  │dashboard │
└────────┘  └──────────┘
```

| Piece | Where | What it is responsible for |
|---|---|---|
| Android app | `mobile/` | Capturing a handover where there is no network, and keeping it safe until there is |
| Backend | `backend/app/` | Every decision: what blocks a machine, what is a new defect, which shift a record belongs to |
| Dashboard | `frontend/src/components/sections/Hoto*.tsx` | What the office does: approve a device, read the board, work a defect, change a checklist |
| Database | `minehub` schema in `corpappdb` / `devappdb` | The record |

**The device decides nothing that matters.** It evaluates the checklist so it
can tell the operator at the machine — it has to, there is no network — but the
server evaluates it again on receipt and records any disagreement
(`verdict_drift`). The server's answer is the one that counts.

---

## 3. The data model

Nine migrations, `105` to `113`. Each is named for the decision it encodes.

| Table | Rows (dev) | Exists because |
|---|---|---|
| `hoto_checklist_template` | 15 | A checklist is data the mine edits, not code we deploy |
| `hoto_checklist_section` | 98 | ENGINE, BRAKES, SAFETY — how an operator walks round |
| `hoto_checklist_item` | 310 | One question. Carries its own severity, whether it stops a machine, and which answer is a finding |
| `hoto_session` | 25 | One handover. The record somebody signed |
| `hoto_response` | 470 | One answer, as given, with the severity resolved at the time |
| `hoto_defect` | 9 | A fault that outlives the shift that found it |
| `hoto_defect_sighting` | 19 | The fourth time the same fault is reported is not a fourth fault |
| `hoto_photo` | 9 | Evidence, and the operator's own photo, with where it was taken |
| `hoto_device` | 5 | Which phones and tablets are allowed, and where they are |
| `hoto_device_location` | 18 | Where a device has been |

### Decisions worth checking

**A published checklist is never edited.** A handover records the template *and
version* it answered. Editing a published version would make a record signed
last Tuesday claim it answered a question nobody asked. To change one you clone
it to a draft, edit that, and publish — the old version stays readable for ever.

**A defect is separate from the answer that raised it.** The answer belongs to
one handover at one moment. The defect belongs to the machine and lives until
somebody closes it. The same fault reported on three shifts is one defect with
three sightings, decided by the server, which is the only thing that can see
across every device.

**Severity is resolved at capture, not read.** `hoto_response.severity` is
written when the answer is given. If the mine later decides a cracked mirror is
HIGH rather than MEDIUM, last month's records still say what they said.

---

## 4. The flows

### 4.1 A device joins

The part most likely to be wrong for your site, because it decides who can
file a record in the mine's name.

```
app (first run)          backend                    office
     │                      │                          │
     │ register ───────────▶│  row created as PENDING   │
     │  install_id          │  NO credential exists     │
     │  claim_secret        │                           │
     │  make, model, OS     │                      ┌────┴────┐
     │  who is asking       │                      │ sees the│
     │                      │                      │ hardware│
     │ "waiting to be       │                      │ and who │
     │  allowed, DEV-003"   │                      │ asked   │
     │                      │◀── approve ──────────┘         
     │                      │  credential generated NOW      
     │ claim (every 10s) ──▶│                                
     │◀─ token, once ───────│  erased from the row           
     │                      │                                
     │ working              │                                
```

**Nobody types a token or a server address.** The address is built into the
app; the credential is collected by the app itself.

- A PENDING row **cannot** hold a credential — enforced by a database
  constraint, not by code that could be changed.
- The credential exists in the clear only between approval and the device's
  next check (seconds, usually), expires in 48 hours regardless, and collecting
  it needs a secret only that installation holds.
- An approval carries **who** and **when**. The old flow — an administrator
  running a command — could not produce that.

**ASSUMPTION:** anybody holding `hoto.admin` may approve a device. The mine may
want that restricted to one or two named people.

### 4.2 A handover is captured

```
Which machine  →  Who is taking it  →  Walk-round  →  Readings  →  Confirm
     │                   │                  │             │           │
   scan QR            search by          31 checks      meter     "I confirm
   or search          number/name        with ranges    + fuel    this is what
                      + their photo                               I found"
```

At each step, what the design insists on:

1. **The machine.** Scanning the cab sticker is offered first. A fleet with
   MAN-50 through MAN-55 is one where typing picks the wrong machine
   eventually, and a handover filed against the wrong machine is worse than
   none — the right machine *looks* checked.

2. **The operator.** Identified per capture, never inherited. A shared tablet
   does not keep somebody signed in. Two operators with the same name are
   called out explicitly, with the employee number made the thing to read.
   A photo of them is taken **before** the walk-round, because the point of it
   is that the person was standing there.

3. **The walk-round.** A critical answer that is adverse blocks the machine
   **the moment it is given**, not at the end — while the operator is still
   next to it. An adverse answer needs a remark, and a photo where the item
   demands one.

   *One tap* marks the routine checks clean. It never touches a critical check
   or a gauge, so it cannot pass a brake test nobody made, and the record says
   `bulk_answered` so the office can tell a one-tap record from a walk-round.

4. **Confirm.** Even a blocked machine is confirmed: *"Confirm it anyway. The
   record of what you found is what gets it repaired, and a handover nobody
   filed leaves the fault invisible."*

### 4.3 It reaches the office

Everything is captured to local SQLite first. Nothing waits on a network.

```
 confirmed ──▶ queued ──▶ sending ──▶ synced
                  ▲          │
                  └──────────┴──▶ rejected (the server refused it — needs a person)
                             └──▶ conflict (a different record exists under the same key)
```

- **Idempotent on `client_uuid`**, which the *device* allocates. A retry after
  a dropped connection returns the original record rather than filing a second
  handover.
- Sync fires on open, on reconnect, after a capture, and on a **Send now**
  button on the first screen — because a tablet that has quietly failed for two
  days needs the person holding it to be able to act where they are standing.
- A refusal is shown **in the server's own words**. "Sync failed" is not
  something anybody can act on; "unanswered: Parking brake" is.
- Photos go **after** the handover they belong to, and positions go **last** —
  if the window of signal fits only one thing it must be the handover.

### 4.4 A defect's life

```
RAISED ──▶ ACKNOWLEDGED ──▶ RECTIFIED ──▶ VERIFIED ──▶ CLOSED
   │                                                      
   └──▶ CANCELLED (it was not a fault)                     
```

Raised by the **server**, from the adverse answers in a handover, inside the
same transaction that files it — so a handover and the defects it raised cannot
come apart. An open defect for the same machine and item gets a **sighting**,
not a duplicate.

A machine's state is recomputed from its worst still-open defect. Releasing a
machine its own defects say should be held needs `hoto.override` and a written
reason, and raises an exception record.

### 4.5 A checklist changes

```
ACTIVE ──clone──▶ DRAFT ──edit──▶ publish ──▶ ACTIVE (v2)
                                                 │
                        the old version ◀────────┘ stays readable for ever
```

A machine type with no checklist at all starts one from empty — a dozer's
walk-round is not a crane's, so nothing is copied in.

---

## 5. Permissions

| Permission | Lets you |
|---|---|
| `hoto.view` | Read the register and the board |
| `hoto.capture` | File a handover |
| `hoto.override` | Release a machine its defects say should be held |
| `hoto.admin` | Edit checklists, approve devices |

A **device token** is not a login. It names a tablet, not a person, and grants
exactly three things: pull masters, file handovers, upload photos. A stolen
device token cannot read the operator register, see the fleet's defects, or
edit a checklist.

---

## 6. What is proven, and what is not

### Proven on real hardware (Lenovo TB336ZU, Android 16)

| | |
|---|---|
| Device registration, approval, credential collection | ✅ |
| Masters sync — 74 machines, 269 operators, 4 checklists | ✅ |
| Full capture → confirm → sync, filed as `HOTO-0000059` | ✅ |
| Camera, photo upload, GPS tag on photos | ✅ |
| Operator photo | ✅ |
| Background GPS, 24/7 | ✅ |
| Defect raised and de-duplicated into a sighting | ✅ |
| One-tap routine answers, per-item yes/no classification | ✅ |

**167 automated tests** (155 unit, 12 contract against a live server), plus
25 for template creation and 45 for the device join flow.

### Built but NOT proven on hardware

| | Why it matters |
|---|---|
| QR scanning of a cab sticker | The intended way to pick a machine |
| Mid-shift and end-of-shift handover types | Only *taking over* has been run |
| A device going offline for hours and syncing a backlog | The whole offline design rests on it |
| Conflict handling (two devices, same machine and shift) | Rare, and the recovery is manual |
| Background sync waking the app with the screen off | Best-effort by design |

### Known gaps

- **No operator has a recorded competency**, so every handover warns that the
  operator is not signed off. Data, not code.
- **10 of 14 machine types** have a draft checklist awaiting the mine's review;
  Drill, Tipper, Excavator and Dozer are published.
- **An app cannot stop itself being uninstalled**, or its GPS permission
  revoked. That needs company-managed devices — see
  `docs/hoto-device-lockdown.md`. The dashboard raises an alarm when a device
  stops reporting instead.

---

## 7. Open questions for the mine

These are decisions the system is deliberately **not** making for you.

1. **Who may override a lock?** `hoto.override` exists and today only the
   superadmins hold it, because the platform grants every new permission to
   them. That is an inherited default, not a decision.

2. **What does a missing handover count as?** The board reports four cases
   separately — captured, nobody filled it in, already off work, no checklist —
   rather than dividing them into a compliance percentage whose denominator
   nobody has agreed.

3. **May an operator take a machine outside his competency?** Today it is
   recorded and raised for a supervisor, never blocked. **ASSUMPTION.**

4. **Should a worker's own phone report its position?** The mechanism is per
   device and defaults to off, and the approval screen warns when a device is
   somebody's own phone. Whether the mine does it, and what it tells people,
   is not a technical decision.

5. **Who approves devices?** Currently anybody with `hoto.admin`.

---

## 8. Running it

| | |
|---|---|
| Backend | `uvicorn app.main:app --host 0.0.0.0 --port 8990` from `backend/` |
| Dashboard | `npm run dev` from `frontend/` — `localhost:3333` |
| App | `npx eas build --platform android --profile trial-dev` from `mobile/` |
| Tests | `npx jest` in `mobile/` |

Building and installing the app, including the Android Studio question:
`docs/hoto-mobile-builds.md`.

---

## 9. A pattern worth knowing about

Five separate faults in this codebase had the same shape: **something was
built, tested, and never connected.**

| What | How long it was dead |
|---|---|
| `cacheBundle` — the machine list was downloaded and discarded | Phases 10–14 |
| `setPosition` — handovers recorded no position | Since phase 4 |
| Clock drift — computed, never called | Since phase 4 |
| The shift calendar — sent in every sync, thrown away | Since phase 4 |
| `adverse_answer` — stored, mapped, never SELECTed | One build |

Each had passing tests. Each test asserted on the *request* or on the *unit*,
and none asserted on what a screen finally received. Tests added since assert
at the far end — reading the cache, reading the template, reading the record —
because that is the only place these were wrong.

Worth knowing when validating: **"there is a test for it" was true of every one
of these.**
