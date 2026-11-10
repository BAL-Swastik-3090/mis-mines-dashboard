# Building and installing the HOTO app

## Short answer: you do not need Android Studio

The app is built in Expo's cloud. One command on this laptop produces an APK
you download on the phone and install. Android Studio installs ~8 GB of SDK and
is only worth it for the two things the cloud cannot do — see
[When Android Studio is worth it](#when-android-studio-is-worth-it).

---

## The normal way: a cloud build

From `mobile/`:

```bash
npx eas build --platform android --profile trial-dev
```

It prints a link while it works. Ten to twenty minutes later the same page has
a **Download** button and a QR code. Open that link on the phone, download, and
Android will ask whether to allow installing from this source — say yes.

### The three build profiles, and which to use

| Profile | Talks to | For |
|---|---|---|
| `trial-dev` | `http://192.168.16.157:8990` — this laptop | Testing against the development database |
| `trial` | `https://mines.balasorealloys.in` | The real server, when production is ready |
| `production` | `https://mines.balasorealloys.in` | A Play Store bundle, not an APK |

`trial-dev` is the one to use now. It allows plain `http://`, which Android
otherwise refuses outright — the app installs, looks fine, and every request
fails silently. `trial` and `production` do **not** allow it.

### When this laptop's wifi address changes

It will. The address is baked into the build, so a moved laptop means the app
points at nothing. Two ways out, and the second needs no rebuild:

1. Update `EXPO_PUBLIC_HOTO_API` under `trial-dev` in `mobile/eas.json` and
   build again, or
2. on the phone: **Still on this device → Server moved? Change the address**.
   This keeps the credential — the device stays approved.

Find the current address with `ipconfig` (the Wi-Fi adapter's IPv4 address).

---

## Setting a device up

There is nothing to type except a name.

1. Install the APK and open it.
2. It shows what hardware it is and asks **your name** and, optionally, where
   it will be used.
3. Tap **Ask for access**. It shows a device code — `DEV-001` — and starts
   waiting. It checks every ten seconds by itself.
4. On the dashboard: **HOTO Devices**. The device is at the top of the screen
   with its make, model, Android version and who asked. Give it a proper code
   if you want one, choose whether it reports its position, and press
   **Allow this device**.
5. The phone picks its own credential up within a minute and starts.

Nobody carries a token anywhere, and nothing is read out over a phone.

### Letting it report its position

Android asks twice and the second prompt is the one that matters. Grant
location, then when Android offers "While using the app" choose **Allow all the
time** — on most phones that means tapping through to Settings. Until it is
granted the home screen says, in as many words, that the device is not
reporting its position.

A permanent notification appears while it reports. That is Android's rule and
it is the right one: a device reporting its position around the clock should be
plainly doing so to whoever is carrying it.

The office can switch it off per device, at any time, from the device's page on
the dashboard. The phone picks that up on its next check.

---

## Checking it worked

On this laptop, with the backend running:

```bash
curl -s http://192.168.16.157:8990/api/health
```

On the phone's browser, before opening the app at all — same URL. If that does
not answer, the app will not either, and the problem is the network or the
firewall rule, not the app.

The firewall rule, in an Administrator terminal, if it is ever lost:

```bash
netsh advfirewall firewall add rule name="HOTO dev 8990" dir=in action=allow protocol=TCP localport=8990 profile=private,domain
```

---

## When Android Studio is worth it

Two things the cloud build cannot do:

- **A build in two minutes instead of twenty.** Worth it once you are changing
  the app often.
- **An emulator**, so you can test without a phone in your hand.

What it needs:

1. **JDK 17** (Android Gradle will refuse 21). `winget install Microsoft.OpenJDK.17`
2. **Android Studio** — <https://developer.android.com/studio>. During setup
   let it install the SDK, and in **SDK Manager** tick *Android SDK Platform 35*,
   *Android SDK Build-Tools* and *Android SDK Command-line Tools*.
3. Set `ANDROID_HOME` to `C:\Users\<you>\AppData\Local\Android\Sdk` and add
   `platform-tools` to `PATH`.

Then, from `mobile/`:

```bash
npx expo prebuild --platform android
```

```bash
npx expo run:android --variant release
```

`prebuild` generates the `android/` folder from `app.json` and `app.config.js`.
It is generated output — do not edit it by hand and do not commit it; anything
that must change belongs in the config files, or the next `prebuild` discards
it.

For a plain APK without the phone attached:

```bash
cd android && ./gradlew assembleRelease
```

The file lands in `android/app/build/outputs/apk/release/`.

### A phone plugged in by USB

Enable **Developer options** (tap *Build number* seven times in About phone),
then **USB debugging**. `adb devices` should list it. `npx expo run:android`
then installs straight onto it, and `adb logcat | findstr HOTO` shows what the
app is saying — the only way to see a crash that happens before the UI appears.

---

## Before this goes to production

- Build with the `trial` profile, not `trial-dev`, so cleartext HTTP is off.
- Apply migrations 105–110 to `corpappdb` (they are only on `devappdb` today).
- Google Play requires a written declaration for background location. It is not
  needed to install an APK directly, which is how the trial is being run.
- Decide per device, not globally, whether a worker's own phone reports its
  position — and tell them. The approval screen says so where the device is
  marked as someone's own phone.
