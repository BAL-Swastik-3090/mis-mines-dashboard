# Kaliapani HOTO — what changed in each version

The dashboard's **HOTO → App** page keeps the same history with each uploaded
APK. Paste a version's section below into "What changed in this version" when
publishing it.

Each new version needs a higher build: raise `version` and `android.versionCode`
in `app.json` before building (`python scripts/build_local_apk.py` copies them
into the Android build).

## 0.3.0 (build 3) — 16 November 2026

- Updates from the office: when the office adds or removes an operator or a machine, or changes a checklist, the tablet says so
- A bell at the top of every screen with the number of new updates, an entry in the menu, and a line on the home screen
- An Android notification for each batch of updates (the tablet asks once whether it may show notifications)
- The Updates screen lists them by day, says what each one means for a handover, and has Check now
- The tablet checks the office's lists every 10 minutes while open (was 30), and every 30 minutes in the background
- All of it in Hindi, Odia and Bengali

## 0.2.0 (build 2) — 16 November 2026

- Terms of use shown before first use, with a summary in Hindi, Odia and Bengali
- The app in Hindi, Odia and Bengali; language chip in the header
- A menu (☰) on every screen: home, start a handover, history, sending, guide, language, settings
- Settings: language, the remembered supervisor and Forget, this tablet's details
- Guide (?) on every screen: what the screen is for and the five steps of a handover
- Discard an unfinished handover, with a reason
- The supervisor filling in handovers is remembered for the next one (12 hours)
- Header buttons now answer a finger press (they missed most presses before)
- Photographs kept where Android cannot clear them before they are sent
- Setting up a phone asks whose it is (own phone or company tablet); name required, employee number optional
- A new device shows a pairing code the office types to allow it
- Balasore Alloys logo in the header, menu, terms and settings

## 0.1.0 (build 1) — November 2026

- First trial version: machine, people, walk-round checks, readings and confirm; sending to the office in the background; history of handovers done on the tablet
