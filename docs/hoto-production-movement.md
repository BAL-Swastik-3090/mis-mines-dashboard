# HOTO — moving from UAT to production

**16 November 2026.** How the HOTO module — the dashboard screens, the backend
and the tablet app — moves from UAT to production, what has to be true first,
and how to undo it. Read with `DEPLOY.md` (how production is deployed) and
`docs/hoto-field-trial.md` (the first shift on real machines).

Nothing here has been done to production yet. Pushing to the production
repository needs your go-ahead, every time.

---

## 1. Where things stand

| | UAT (today) | Production |
|---|---|---|
| Code | branch `hoto-foundation-09-11-2026` on the development repo (`BAL-Swastik-3090/mis-mines-dashboard`) | `main` of `balasorealloys/Mines-System` — **no HOTO code yet** |
| Relationship | the branch starts from production `main`'s latest commit (`b8fe005`) and adds 221 commits | a clean fast-forward: nothing to merge by hand |
| Database | `devappdb`, schema `minehub`, on the development server — HOTO migrations **105–116 applied** | `corpappdb`, schema `minehub`, on the corporate database server — HOTO migrations **not applied** (production `main` stops at 086) |
| Data | 37 handovers, 11 defects, 15 photos, 6 devices — **all test and demo data** | none. Production starts clean; nothing from UAT is copied |
| Tablets | DEV-004 and test phones, pointing at a development backend on the office network | to be installed from production's HOTO → App page |
| App | 0.2.0 (build 2), allows unencrypted HTTP (built for the office network) | must be built for `https://mines.balasorealloys.in` with unencrypted HTTP **off** |

> **A note that is out of date.** `CLAUDE.md` and `minehub/migrations/README.md`
> say development and production share one database. That was true in
> September. Since November the development machine works against `devappdb`
> on the development server and production against `corpappdb`. HOTO was built
> and tested entirely on `devappdb`. Correct those two notes as part of this
> move, so the next person does not apply a "dev" experiment to live data — or
> skip a production migration believing it is already there.

---

## 2. Go / no-go — what must be true before the move

You set the bar: production when at least 75% of what was planned is built.
Beyond that, these are the things that block a safe go-live, each with who
decides.

| # | Item | Why it blocks | Owner |
|---|---|---|---|
| 1 | UAT sign-off checklist (section 3) passed | proves each feature on the real tablet | HOTO lead + one supervisor |
| 2 | Terms of use reviewed by Legal/HR, and the two blanks filled: **Grievance Officer's name and contact**, **how long records are kept** | the app shows them to every user | Legal / HR |
| 3 | Hindi, Odia and Bengali read by a native speaker at the mine | 403 sentences were translated without a native read | Mine office |
| 4 | Decisions on open gaps: **G5** (ask for the operator's PIN), **G6** recent operators, **G7** view/remove a photo, **G8** open a finished handover, **G10** fleet-wide shift status, **P2** (block offline) | some change what a supervisor sees on day one | You |
| 5 | Production APK built with production address and unencrypted HTTP off (section 4.3) | the UAT build allows HTTP and points at a development server | Developer |
| 6 | A persistent volume for `/app/storage` in the backend container (section 4.2) | the app's APKs are kept on disk; without a volume a rebuild deletes them | IT |
| 7 | nginx upload limit raised for the app's APK (section 4.2) | production allows 20 MB; the APK is 43 MB | IT |
| 8 | Signing key backed up safely (`mobile/credentials.json` + `mobile/credentials/`) | without it, no update installs over the app on a tablet — every tablet would have to be wiped | Developer + IT |
| 9 | People who will use HOTO, and their roles, listed (section 4.4) | access is by permission; nobody has it on production yet | Mine office |
| 10 | Checklists to publish, and cab stickers printed, for the machines in the first pilot | a tablet cannot hand over a machine with no checklist | HOTO admin |

Background sending with the app fully closed was built but **not yet proven
on a tablet**; the pilot (section 5, step I) should watch for it.

---

## 3. UAT sign-off checklist

Run on the UAT dashboard and a UAT tablet. Mark each **Pass / Fail** with the
date and who ran it. Any Fail in bold rows stops the move.

| # | Area | Do this | Expect |
|---|---|---|---|
| **1** | Access | Sign in as a user with `hoto.view`, one with `hoto.capture`, one with `hoto.admin` | each sees only their HOTO tabs; Devices, Checklists and Cab Stickers only for admin |
| **2** | Terms | Install the app on a phone that never had it | Terms of use first; "I agree" off until the box is ticked; "I do not agree" explains |
| **3** | Joining | Fill name, choose own phone / company tablet, ask for access | waiting screen shows device code and a 6-digit pairing code |
| **4** | Approving | On Devices, type a wrong code, then the right one | wrong refused with tries left; right one allows; the phone starts by itself |
| 5 | Whose device | Open the device on Devices; set whose it is | list shows Registered to, own phone / company tablet, last used by |
| **6** | Handover — taking over | Scan a cab sticker, pick operator, photo, handed over by, walk-round, readings, confirm | saved on the tablet, reaches the office; appears in Register |
| 7 | Handing over / mid-shift | Do one of each | Register pairs the take-over with the hand-over |
| **8** | A fault | Answer a check with a fault, note and photo | defect raised in Defects with the photo |
| **9** | A machine-stopping fault | Fail a "Stops the machine" check | tablet says the machine does not change hands; defect raised; machine held |
| **10** | No signal | Capture a handover with Wi-Fi and data off, then turn them on | saved on the tablet; sent by itself once back in signal |
| 11 | Discard | Start a handover, discard it with a reason | gone from the tablet; nothing at the office |
| 12 | Supervisor remembered | Fill one in for an operator, start the next | the supervisor is already chosen; one tap to change |
| 13 | Languages | Switch to हिन्दी, ଓଡ଼ିଆ, বাংলা | every screen in that language |
| 14 | Guide and menu | Press ?, ☰ and the language chip on several screens | each opens, with a finger, every time |
| 15 | Defect owner | Set an owner and a due date on a defect | shown; overdue when late |
| 16 | Register export | Export the register to CSV | opens in Excel with the people columns |
| **17** | Block / unblock | Block a test device, try a handover, unblock | refused with the reason while blocked; sends once unblocked, nothing lost |
| 18 | Retire | Retire a test device (type its code) | refused for good |
| **19** | App page | Publish a test APK, download it, scan the QR on a phone | installs over the existing app; history shows the version and notes |
| 20 | Photos kept | Take photos, leave the tablet a day before signal | photos still arrive |

---

## 4. Getting ready (days before)

### 4.1 Code: merge, tag, and what the release removes

All in the development repository; the push to production waits for your
go-ahead.

```bash
# the release is the tip of the HOTO branch, tagged
git checkout hoto-foundation-09-11-2026 && git pull
git tag -a hoto-release-1 -m "HOTO to production"

# files this release DELETES relative to what production runs — the deploy
# method never removes them on the server (DEPLOY.md, 2026-09-25)
git diff --diff-filter=D --name-only b8fe005 hoto-release-1

# with your approval only: production main moves to the release
git push production hoto-release-1:main        # or a PR, as the team prefers
```

### 4.2 Server prerequisites (IT)

1. **Storage volume.** The backend writes the tablet app's APKs (and the
   machines' papers) under `/app/storage`. Mount it from the host so a rebuild
   keeps it — in the server's `docker-compose.override.yml`:
   ```yaml
   services:
     backend:
       volumes:
         - ./storage:/app/storage
   ```
   Check first whether the server's override already mounts it; if machine
   papers have survived past rebuilds, something does.
2. **nginx upload size.** `deploy/nginx/mines.balasorealloys.in` sets
   `client_max_body_size 20M`. Publishing the app needs about 45 MB:
   ```nginx
   location /api/hoto/admin/app/ {
       client_max_body_size 200M;
       proxy_pass http://127.0.0.1:8006;   # same as the /api/ block
       # ...same proxy headers as the /api/ block
   }
   ```
   then `sudo nginx -t && sudo systemctl reload nginx`.
3. **`.env`.** `JWT_SECRET` must be set (production refuses to start without
   it). The pairing code and the app's phone links are signed with it, so
   changing it later voids any waiting pairing codes and app links — nothing
   else. Optionally `HOTO_APP_ROOT` (defaults to `/app/storage/hoto-app`).
4. **Reachability.** Tablets at the mine must reach
   `https://mines.balasorealloys.in` over the site Wi-Fi or mobile data. Check
   from one tablet's browser before the day.

### 4.3 The production app

```bash
cd mobile
# app.json: version 0.2.0 / versionCode 2 is already set; raise both for any later build
```

The build must point at production and refuse unencrypted HTTP. The UAT
Android project was generated without a build profile, so it allows HTTP.
Either:

- **Cloud build** (Expo quota returns 1 December): `eas build -p android --profile trial`
  — the `trial` profile is HTTPS-only (see `mobile/app.config.js`), or
- **This laptop:** regenerate the Android project with the profile set, then build:
  ```bash
  set EAS_BUILD_PROFILE=trial
  npx expo prebuild --platform android --clean
  set HOTO_API=https://mines.balasorealloys.in
  python scripts/build_local_apk.py
  ```
  and confirm `android:usesCleartextTraffic="false"` in
  `android/app/src/main/AndroidManifest.xml`. `--clean` rewrites `android/`;
  it is not in git, so nothing is lost.

Check the result before publishing: `aapt dump badging` shows the version and
build; the signing certificate SHA-256 must be
`3f0ce09f860c66afc6ceee504470e74053f9f6aa4a4aaf2d331c0e5d86ac2886`
(otherwise it will not install over existing tablets).

### 4.4 People and access

On production, Access Control → give roles with the HOTO permissions:

| Permission | Who | Sees |
|---|---|---|
| `hoto.view` | management, safety | Shift Board, Register, Defects, App |
| `hoto.capture` | supervisors | the same, and acts on the board |
| `hoto.override` | senior supervisors only | releasing a machine a failed check has held |
| `hoto.admin` | HOTO admins (IT + mine office) | everything, including Devices, Checklists, Cab Stickers, publishing the app |

### 4.5 Masters for the pilot

- Operators: the production operator register is what tablets search — check
  the pilot crew are in it with employee numbers.
- Checklists: publish one per machine type in the pilot (HOTO → Checklists).
- Cab stickers: print and fix them on the pilot machines (HOTO → Cab Stickers).
- Shifts: the shift calendar decides which shift a handover belongs to.

---

## 5. The move (on the day)

| Step | What | Done by |
|---|---|---|
| **A** | **Backup.** Database: `pg_dump` of schema `minehub` on `corpappdb` (or a snapshot). Server: copy the project directory and its `storage/`. | IT |
| **B** | **Database.** On `corpappdb`, check which of migrations **087–116** are present and apply the missing ones **in order**, with the DBA role (the app's own role cannot create tables). `schema_migration` under-reports what has run (DEPLOY.md), so check the objects themselves — for HOTO, the query below. HOTO's own are 105–116; 087–104 belong to other features in the same release. Afterwards `python minehub/check_migrations.py` must still pass (it checks the other direction: no table without a migration). | IT / DBA |
| **C** | **Code.** On the server: extract the release over the project, **remove the files listed in 4.1**, then `docker compose build && docker compose up -d`. | IT |
| **D** | **nginx and volume** from 4.2, if not done before the day. | IT |
| **E** | **Smoke test.** `/api/health` answers; sign in; open each HOTO tab; signed out, `/api/hoto/app/releases` answers 401. | Developer |
| **F** | **Publish the app.** HOTO → App → publish the production APK with its notes (or ask Claude, as on UAT). | HOTO admin |
| **G** | **Tablets.** For each pilot tablet: install from the App page's QR code → accept terms → name and kind → read the pairing code to the admin → approve on Devices → set its site and whose it is. Lock it down (`docs/hoto-device-lockdown.md`). | HOTO admin + tablet holder |
| **H** | **Access.** Roles from 4.4 given to the pilot people. | HOTO admin |
| **I** | **Pilot shift.** One section, one shift, following `docs/hoto-field-trial.md`. Watch: Register filling, Defects raised, Devices "last seen" and "not reporting", nothing left unsent on tablets at shift end. | HOTO lead |
| **J** | **Record it.** A `DEPLOY.md` entry: the commit, migrations applied, files removed, anything that went wrong. | Developer |

**Step B — is HOTO's schema there?** On `corpappdb`, before and after applying:

```sql
-- the 11 tables migrations 105–116 create: all 11 rows when done
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'minehub' AND table_name IN (
   'hoto_checklist_template','hoto_checklist_section','hoto_checklist_item',
   'hoto_session','hoto_response','hoto_device','hoto_device_location',
   'hoto_defect','hoto_defect_event','hoto_defect_sighting','hoto_photo')
 ORDER BY 1;

-- columns added by 111, 113, 115 and 116: all 8 rows when done
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = 'minehub' AND (table_name, column_name) IN (
   ('hoto_session','recorded_by_operator_id'), ('hoto_session','shift_code'),
   ('hoto_session','production_day'), ('hoto_session','counterpart_operator_id'),
   ('hoto_session','counterpart_absent'), ('hoto_defect','assigned_to'),
   ('hoto_defect','target_date'), ('hoto_device','install_id'))
 ORDER BY 1, 2;

-- the HOTO permissions: four rows (hoto.admin, hoto.capture, hoto.override, hoto.view)
SELECT code FROM permission WHERE code LIKE 'hoto.%' ORDER BY 1;
```

The release deletes no files relative to production (checked 16 Nov:
`git diff --diff-filter=D --name-only b8fe005 HEAD` is empty), so step C has
nothing to remove this time — run the check again on the day.

---

## 6. The first week

Daily, on the dashboard:

- **Devices** — every pilot tablet seen within the shift; none "not reporting".
- **Home on each tablet** — "Everything on this tablet has reached the office"
  at shift end. A tablet with handovers waiting for more than a shift needs a look.
- **Register** — every take-over paired with a hand-over.
- **Defects** — machine-stopping faults raised the same shift, and someone owns each.
- Anything a supervisor works around on paper: write it down — that is the next release.

---

## 7. Undoing it

The HOTO migrations only add tables and columns; nothing existing depends on
them, so the database does not need rolling back.

1. **Hide it now:** remove the HOTO permissions from roles (Access Control).
   The screens disappear; tablets are refused and keep everything they hold.
2. **Roll the code back:** redeploy production's previous commit `b8fe005`
   the usual way. Because the deploy method does not delete files, remove the
   files the release added (`git diff --diff-filter=A --name-only b8fe005 hoto-release-1`)
   before building.
3. **Tablets** keep their handovers until a server takes them again — nothing
   on them is lost by a rollback.

---

## 8. Known limits to accept or fix later

- **Two backend workers count separately.** Production runs more than one
  worker, so the pairing code's "5 wrong tries" counts per worker, and the app
  history file is guarded per worker. Neither is a risk at the mine's scale;
  a table would remove both.
- **Photos are stored in the database** (`hoto_photo`). Plan for its growth in
  backups.
- **Checklist questions are in English** only; translating them needs a
  column per language on each checklist item.
- **Own phones reporting position.** Decide per device, and tell the person —
  the approval screen says so when a device is someone's own phone. A Play
  Store listing would also need Google's background-location declaration; an
  APK installed from the App page does not.
- **Test data stays in UAT.** The 37 handovers, 11 defects and test devices
  in `devappdb` are not part of the move. Remove them from UAT when you no
  longer need them (HOTO-0000087–090 demo, HOTO-0000166–172 test).
