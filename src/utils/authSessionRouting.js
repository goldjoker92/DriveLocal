// Pure routing policy for a Firebase session restored at application startup.
// Keeping this decision outside React makes every role/status directly testable.

const AUTH_ENTRY_ROUTES = new Set([
  '',
  '/',
  '/index',
  '/login',
  '/email-login',
  '/driver-auth',
]);

export function isAuthEntryRoute(pathname) {
  return AUTH_ENTRY_ROUTES.has(String(pathname || '').trim().toLowerCase());
}
export function driverSessionRoute(driver) {
  const profile = driver || {};

  if (profile.profileStatus === 'incomplete') return '/(driver)/profile';
  if (profile.vehicleStatus === 'incomplete') return '/(driver)/vehicle';
  if (profile.documentsStatus === 'missing' || profile.documentsStatus === 'incomplete') {
    return '/(driver)/documents';
  }

  if (
    profile.verificationStatus === 'pending_review'
    || profile.verificationStatus === 'rejected'
    || profile.verificationStatus === 'correction_requested'
    || profile.verificationStatus === 'suspended'
  ) {
    return '/(driver)/verification-status';
  }

  if (profile.verificationStatus === 'approved') return '/(driver)/driver-home';
  return '/(driver)/onboarding';
}

export function restoredSessionRoute(session) {
  if (session?.role === 'admin') return '/(admin)/admin-home';
  if (session?.role === 'passenger') return '/(passenger)/passenger-home';
  if (session?.role === 'driver') return driverSessionRoute(session.driver);
  return null;
}
