/**
 * Takes app.json and adds the one thing that must differ between a test build
 * and a real one.
 *
 * ── CLEARTEXT HTTP, FOR TESTING ONLY ─────────────────────────────────────────
 * Android 9 and later refuse plain http:// unless the app opts in. A tablet
 * being tested talks to a laptop on the office wifi over http, so a test build
 * has to allow it — and without this the app installs, looks fine, and every
 * single request fails with no explanation anybody can act on.
 *
 * A PRODUCTION BUILD MUST NOT ALLOW IT. These handovers carry operator names,
 * machine states and a device token that files records in the mine's name;
 * sending that over cleartext on a site wifi is not a thing to leave switched
 * on because it was convenient once during a trial. So it is keyed on the EAS
 * profile, defaults to allowed only when the profile is not production, and
 * the `trial` profile — the one that points at the real server over https —
 * does not get it either.
 */

const CLEARTEXT_PROFILES = ['trial-dev', 'development'];

module.exports = ({ config }) => {
  // EAS sets this during a cloud build. Locally it is undefined, which is a
  // developer on a laptop, so cleartext is allowed there too.
  const profile = process.env.EAS_BUILD_PROFILE;
  const allowCleartext = profile === undefined || CLEARTEXT_PROFILES.includes(profile);

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ['expo-build-properties', {
        android: {
          usesCleartextTraffic: allowCleartext,
          // The tablets in the fleet are Android 10 and 11, so this is the
          // floor the mine actually has rather than the newest one Expo
          // defaults to.
          minSdkVersion: 24,
        },
      }],
    ],
    extra: {
      ...(config.extra ?? {}),
      // Readable at runtime, so the app can say which build somebody is
      // holding when a handover will not send — the first question anybody
      // asks, and otherwise unanswerable from the screen.
      buildProfile: profile ?? 'local',
      allowsCleartext: allowCleartext,
    },
  };
};
