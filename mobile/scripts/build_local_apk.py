"""Build the tablet APK on this machine, without an Expo cloud build.

  python scripts/build_local_apk.py      (from the mobile/ folder)

A release APK for arm64 tablets, signed with the Expo key when
mobile/credentials.json is present -- download it once with
`npx eas credentials -p android` -> trial-dev -> credentials.json -> Download --
so it installs over the app already on a tablet:  adb install -r <apk>.
Without that file it is signed with the debug key, and will NOT install over
the app on a tablet. The key and its passwords stay on this machine: git
ignores credentials.json and credentials/, and the passwords reach Gradle
through environment variables, never a command line or the log.

Needs JDK 17, the Android SDK (platform 35, build-tools 35.0.0, NDK
26.1.10909125, CMake 3.22.1), and `npx expo prebuild --platform android`
run once. The defaults are the IT laptop's paths; override with ANDROID_HOME,
JAVA_HOME, GRADLE_ZIP and HOTO_API. First build about 12 minutes, after that
about 2.

Written 16 Nov 2026, when the Expo account had used its free Android builds
for the month.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import time

MOBILE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID = os.path.join(MOBILE, "android")
SDK = os.environ.get("ANDROID_HOME", r"D:\Android\Sdk")
JDK = os.environ.get("JAVA_HOME", r"C:\Program Files\Eclipse Adoptium\jdk-17.0.7.7-hotspot")
GRADLE_ZIP = os.environ.get("GRADLE_ZIP", "file\\:///D\\:/Android/gradle-8.10.2-all.zip")
OUT_DIR = os.path.join(MOBILE, "dist-apk")
OUT = os.path.join(OUT_DIR, "hoto-local.apk")
LOG = os.path.join(OUT_DIR, "gradle-build.log")
os.makedirs(OUT_DIR, exist_ok=True)

if not os.path.isdir(ANDROID):
    sys.exit("No android/ folder. Run `npx expo prebuild --platform android` first.")

env = dict(os.environ)
env.update({
    "ANDROID_HOME": SDK, "ANDROID_SDK_ROOT": SDK, "JAVA_HOME": JDK,
    "PATH": os.path.join(JDK, "bin") + os.pathsep + env.get("PATH", ""),
    # The address the trial-dev cloud builds carry (eas.json). A tablet keeps
    # any address override it already has.
    "EXPO_PUBLIC_HOTO_API": os.environ.get("HOTO_API", "http://192.168.16.157:8990"),
    "NODE_ENV": "production",
})

with open(os.path.join(ANDROID, "local.properties"), "w") as f:
    f.write("sdk.dir=" + SDK.replace("\\", "\\\\") + "\n")

# ── over a VPN the defaults time out ────────────────────────────────────────
# The Gradle wrapper allows a 10 s connect and failed on its first download,
# so Gradle comes from a copy fetched and checksum-checked separately, and the
# library downloads get two minutes rather than the default.
wrapper = os.path.join(ANDROID, "gradle", "wrapper", "gradle-wrapper.properties")
lines = [l for l in io.open(wrapper, encoding="utf-8").read().splitlines()
         if not l.startswith(("distributionUrl=", "networkTimeout="))]
lines += ["distributionUrl=" + GRADLE_ZIP, "networkTimeout=120000"]
io.open(wrapper, "w", encoding="utf-8").write("\n".join(lines) + "\n")

props = os.path.join(ANDROID, "gradle.properties")
want = {
    "systemProp.org.gradle.internal.http.connectionTimeout": "120000",
    "systemProp.org.gradle.internal.http.socketTimeout": "120000",
    "systemProp.java.net.preferIPv4Stack": "true",
    # The tablets are arm64. Compiling for four CPU types (two of them only
    # for PC emulators) quadruples the native build for nothing.
    "reactNativeArchitectures": "arm64-v8a",
}
have = [l for l in io.open(props, encoding="utf-8").read().splitlines()
        if l.split("=", 1)[0] not in want]
io.open(props, "w", encoding="utf-8").write(
    "\n".join(have + [f"{k}={v}" for k, v in want.items()]) + "\n")

# ── signing ─────────────────────────────────────────────────────────────────
cred_path = os.path.join(MOBILE, "credentials.json")
signed_with = "the DEBUG key -- it will NOT install over the Expo-signed app"
if os.path.exists(cred_path):
    ks = json.load(open(cred_path))["android"]["keystore"]
    env.update({
        "ORG_GRADLE_PROJECT_android.injected.signing.store.file":
            os.path.join(MOBILE, ks["keystorePath"]),
        "ORG_GRADLE_PROJECT_android.injected.signing.store.password": ks["keystorePassword"],
        "ORG_GRADLE_PROJECT_android.injected.signing.key.alias": ks["keyAlias"],
        "ORG_GRADLE_PROJECT_android.injected.signing.key.password": ks["keyPassword"],
    })
    signed_with = "the Expo key (installs over the existing app)"

print(f"signing with {signed_with}", flush=True)
t0 = time.time()
with open(LOG, "w", encoding="utf-8") as log:
    r = subprocess.run([os.path.join(ANDROID, "gradlew.bat"), "assembleRelease",
                        "--no-daemon", "--console=plain", "--no-parallel"],
                       cwd=ANDROID, env=env, stdout=log, stderr=subprocess.STDOUT)
print(f"gradle exit {r.returncode} after {round((time.time() - t0) / 60, 1)} min", flush=True)
apk = os.path.join(ANDROID, "app", "build", "outputs", "apk", "release", "app-release.apk")
if r.returncode == 0 and os.path.exists(apk):
    shutil.copy(apk, OUT)
    print(f"APK: {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB), signed with {signed_with}")
else:
    print(f"build failed -- see {LOG}")
    sys.exit(1)
