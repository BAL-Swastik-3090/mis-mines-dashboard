# Stopping somebody uninstalling the app or turning GPS off

## The short answer

**An app cannot protect itself.** Android deliberately gives no app the power to
block its own uninstall or to hold a permission the user has revoked. That is
not a gap in this app — it is the rule that stops malware doing the same thing,
and no amount of code in HOTO changes it.

What *can* be done is to make the device **company-managed**. A managed device
is controlled by the organisation rather than by whoever is holding it, and
then all of this becomes possible:

| | Ordinary device | Company-managed |
|---|---|---|
| Uninstall the app | anyone can | blocked |
| Revoke location permission | anyone can | blocked, and granted automatically |
| Turn location services off | anyone can | blocked |
| Factory reset to escape it | anyone can | blocked, and it re-enrols |
| Use the tablet for anything else | yes | optional — kiosk to HOTO alone |

## What is in place today

Until the tablets are managed, the honest position is: somebody *can* turn it
off, so the system is built to make that **visible within one shift** rather
than preventable.

- The dashboard's **Devices** screen raises a red banner naming any device that
  was told to report its position and has missed three reports in a row.
- The device's own home screen says, in as many words, that it is not reporting
  and offers to fix it.
- The track is kept, so "it went quiet at 14:10 and came back at 16:40" is a
  question somebody can answer afterwards.

Three missed reports, not one: a tablet in a pit misses a report routinely, and
an alarm that cries wolf is an alarm nobody reads.

## Making the tablets company-managed

All three routes need the device **factory reset first**. Android only allows a
device to become company-owned during initial setup — this is deliberate, so
that nobody can take over a phone that is already somebody's.

### 1. An MDM product (what a fleet should use)

Scalefusion, Esper, Hexnode, SOTI, Microsoft Intune — all do Android Enterprise
and all of them cover this. Roughly ₹100–300 per device per month.

What it gives you beyond the lockdown: push a new APK to every tablet without
anyone walking round with a cable, see which tablets are on which version, wipe
a lost one.

Steps: create the enterprise, upload the APK as a private app, build a policy
that installs HOTO, marks it non-removable, pre-grants location and camera, and
pins the device to it. Then factory reset each tablet and scan the enrolment QR
at the welcome screen.

### 2. Google's own Android Enterprise, no third party

Free, and enough for a small fleet. Needs a Google Workspace account. Same
shape: enterprise, private app, policy, QR, reset, scan.

### 3. Device Owner over USB (free, fiddly, good for a trial)

Works without any subscription and is the right way to prove the idea on two or
three tablets before paying for anything.

It needs HOTO to carry a `DeviceAdminReceiver`, which it does **not** today —
that is a small addition to the app, not a configuration change. Say the word
and it goes in.

Then, on a factory-reset tablet with **no Google account signed in**:

```bash
adb shell dpm set-device-owner in.balasorealloys.kaliapani.hoto/.DeviceAdminReceiver
```

Once that succeeds the app can block its own uninstall, grant itself location
and camera permanently, and pin the tablet to itself.

The "no account" part is not optional: the command fails the moment any account
exists on the device, which is why the reset comes first.

## What to do about it

For the trial, leave it. The dashboard warning covers the real risk — a tablet
quietly stopping — and nobody is going to uninstall it in the first week.

Before it goes out to a whole section, pick route 1 or 2. The per-device cost is
noise against a tipper's shift, and remote APK updates alone pay for it the
first time a build needs to reach twenty cabs.

If you want to see it working on the Lenovo first, route 3 and the
`DeviceAdminReceiver` is an afternoon.
