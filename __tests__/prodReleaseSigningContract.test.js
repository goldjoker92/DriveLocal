'use strict';

const {
  normalizeSha1,
  parseSha1Fingerprints,
  assertSafeConfiguration,
} = require('../scripts/release/prod-auth-smoke');
const {
  expectedAllowedApplications,
  assertNoConflictingClientRestriction,
  restrictionsWithAndroidApplications,
  assertExactApplications,
} = require('../scripts/release/ensure-prod-android-api-key');

const SHA1_A = 'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA';
const SHA1_B = 'BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB:BB';
const SHA1_C = 'CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC';

function validEnvironment(overrides = {}) {
  return {
    CONFIRM_PRODUCTION_AUTH_SMOKE: 'DRIVELOCAL_PRODUCTION',
    PROD_AUTH_SMOKE_EMAIL_TEMPLATE: 'qa+{{RUN_ID}}@example.com',
    PROD_AUTH_SMOKE_PASSWORD: 'closed-test-password-123',
    PROD_AUTH_SMOKE_ROLES: 'passenger,driver',
    PROD_EXPECTED_SIGNING_CERT_COUNT: '3',
    ANDROID_APP_SIGNING_SHA1S: `${SHA1_A}\n${SHA1_B}\n${SHA1_C}`,
    ...overrides,
  };
}

describe('production Play signing release contract', () => {
  test('normalizes colon-separated SHA-1 values', () => {
    expect(normalizeSha1(SHA1_A)).toBe('A'.repeat(40));
  });

  test('parses and deduplicates comma/newline separated certificates', () => {
    expect(parseSha1Fingerprints(`${SHA1_A}, ${SHA1_B}\n${SHA1_A};${SHA1_C}`)).toEqual([
      'A'.repeat(40),
      'B'.repeat(40),
      'C'.repeat(40),
    ]);
  });

  test('requires all three quantum-ready Play signing certificates', () => {
    expect(assertSafeConfiguration(validEnvironment()).androidSigningSha1s).toHaveLength(3);

    expect(() => assertSafeConfiguration(validEnvironment({
      ANDROID_APP_SIGNING_SHA1S: `${SHA1_A},${SHA1_B}`,
    }))).toThrow('expected 3 unique Play signing SHA-1 fingerprints; received 2');
  });

  test('builds exact Android restrictions for the production package', () => {
    const fingerprints = parseSha1Fingerprints(`${SHA1_A},${SHA1_B},${SHA1_C}`);
    const applications = expectedAllowedApplications(fingerprints);

    expect(applications).toHaveLength(3);
    expect(applications.every((entry) => entry.packageName === 'com.drivelocal.app')).toBe(true);
    expect(() => assertExactApplications(applications, applications)).not.toThrow();
  });

  test('preserves API targets while replacing Android certificate restrictions', () => {
    const fingerprints = parseSha1Fingerprints(`${SHA1_A},${SHA1_B},${SHA1_C}`);
    const applications = expectedAllowedApplications(fingerprints);
    const current = {
      apiTargets: [{ service: 'identitytoolkit.googleapis.com' }],
      androidKeyRestrictions: {
        allowedApplications: [{
          packageName: 'com.drivelocal.app',
          sha1Fingerprint: 'D'.repeat(40),
        }],
      },
    };

    const updated = restrictionsWithAndroidApplications(current, applications);
    expect(updated.apiTargets).toEqual(current.apiTargets);
    expect(updated.androidKeyRestrictions.allowedApplications).toEqual(applications);
  });

  test('fails closed on a conflicting client restriction', () => {
    expect(() => assertNoConflictingClientRestriction({
      browserKeyRestrictions: { allowedReferrers: ['https://example.com/*'] },
    })).toThrow('refusing to replace conflicting API key restriction');
  });
});
