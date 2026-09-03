import {
  driverSessionRoute,
  isAuthEntryRoute,
  restoredSessionRoute,
} from '../authSessionRouting';

describe('restored auth session routing', () => {
  test.each(['', '/', '/index', '/login', '/email-login', '/driver-auth'])(
    'recognizes public entry route %s',
    (route) => expect(isAuthEntryRoute(route)).toBe(true)
  );

  test.each(['/driver-home', '/passenger-home', '/active-ride', '/request-ride']) (
    'preserves operational route %s',
    (route) => expect(isAuthEntryRoute(route)).toBe(false)
  );

  test('routes admin and passenger sessions to their home screens', () => {
    expect(restoredSessionRoute({ role: 'admin' })).toBe('/(admin)/admin-home');
    expect(restoredSessionRoute({ role: 'passenger' })).toBe('/(passenger)/passenger-home');
    expect(restoredSessionRoute({ role: 'unknown' })).toBeNull();
  });

  test.each([
    [{ profileStatus: 'incomplete' }, '/(driver)/profile'],
    [{ vehicleStatus: 'incomplete' }, '/(driver)/vehicle'],
    [{ documentsStatus: 'missing' }, '/(driver)/documents'],
    [{ documentsStatus: 'incomplete' }, '/(driver)/documents'],
    [{ verificationStatus: 'pending_review' }, '/(driver)/verification-status'],
    [{ verificationStatus: 'rejected' }, '/(driver)/verification-status'],
    [{ verificationStatus: 'correction_requested' }, '/(driver)/verification-status'],
    [{ verificationStatus: 'suspended' }, '/(driver)/verification-status'],
    [{ verificationStatus: 'approved' }, '/(driver)/driver-home'],
    [{ verificationStatus: 'draft' }, '/(driver)/onboarding'],
  ])('preserves driver onboarding decision %#', (driver, expected) => {
    expect(driverSessionRoute(driver)).toBe(expected);
    expect(restoredSessionRoute({ role: 'driver', driver })).toBe(expected);
  });
});
