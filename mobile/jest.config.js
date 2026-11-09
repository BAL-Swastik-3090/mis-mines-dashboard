/**
 * Two projects, because the rules and the screens need different environments.
 *
 * `core` is the part that decides whether a machine changes hands: the
 * evaluation rules, the template resolver, the capture state machine. None of
 * it imports React Native, so it runs in plain node — fast, and provable
 * without an emulator, which matters because the emulator is exactly what is
 * not available when somebody wants to know whether the brake rule is right.
 *
 * `app` is for anything that renders, under jest-expo.
 */
module.exports = {
  projects: [
    {
      displayName: 'core',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/core/**/*.test.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          // The app's own tsconfig turns on noUncheckedIndexedAccess, which
          // tests trip over constantly for no benefit. Diagnostics stay on for
          // everything that matters.
          diagnostics: { ignoreCodes: [2532, 18048] },
          tsconfig: { module: 'commonjs', target: 'es2020', esModuleInterop: true },
        }],
      },
    },
    {
      displayName: 'app',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/app/**/*.test.tsx', '<rootDir>/src/ui/**/*.test.tsx'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
  ],
};
