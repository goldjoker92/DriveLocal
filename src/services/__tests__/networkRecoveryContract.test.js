const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('network recovery integration contracts', () => {
  it('mounts one global guard without adding a native connectivity dependency', () => {
    const layout = source('src/app/_layout.jsx');
    const packageJson = source('package.json');
    expect(layout).toContain("import NetworkRecoveryGuard from '../components/NetworkRecoveryGuard'");
    expect(layout).toContain('<NetworkRecoveryGuard route={pathname} />');
    expect(packageJson).not.toMatch(/expo-network|react-native-community\/netinfo/i);
  });

  it('probes Firebase on foreground and never defines an automatic replay loop', () => {
    const service = source('src/services/networkRecoveryService.js');
    const guard = source('src/components/NetworkRecoveryGuard.jsx');
    expect(service).toContain('user.getIdToken(true)');
    expect(service).toContain('There is deliberately no automatic action replay');
    expect(service).not.toContain('setInterval(');
    expect(guard).toContain("AppState.addEventListener('change'");
    expect(guard).toContain('probeConnectivity({ force });');
    expect(guard).not.toContain('startDriverWorkSession');
    expect(guard).not.toContain('startDriverOnlineTracking');
  });

  it('keeps ride callables manual/idempotent and distinguishes cache from server snapshots', () => {
    const rides = source('src/services/ridesService.js');
    expect(rides).toContain('runRecoverableAction({');
    expect(rides).toContain("actionName: 'acceptDriverOfferSecure'");
    expect(rides).toContain('{ includeMetadataChanges: true }');
    expect(rides).toContain("source: snap.metadata?.fromCache ? 'cache' : 'server'");
    expect(rides).toContain('saveRideRecoveryHint({');
    expect(rides).toContain('clearRideRecoveryHint({ uid, rideId: ride.rideId })');
  });

  it('uses role-specific recovery and keeps payment disputes recoverable', () => {
    const policy = source('src/services/networkRecoveryPolicy.js');
    const searching = source('src/app/(passenger)/searching.jsx');
    expect(policy).toContain("pathname: '/searching'");
    expect(policy).toContain("pathname: '/active-ride'");
    expect(policy).toContain('A dispute stops live GPS but remains recoverable');
    expect(searching).toContain("['awaiting_payment', 'payment_marked_sent', 'disputed']");
    expect(searching).toContain("pathname: '/pix-payment'");
  });

  it('uses Firestore cache only as presentation fallback and preserves driver lease safety', () => {
    const passengerService = source('src/services/passengerService.js');
    const firestoreRecovery = source('src/services/firestoreRecovery.js');
    const driverHome = source('src/app/(driver)/driver-home.jsx');
    const driverLayout = source('src/app/(driver)/_layout.jsx');
    expect(passengerService).toContain('getDocumentWithCacheFallback');
    expect(firestoreRecovery).toContain('getDocFromCache');
    expect(firestoreRecovery).toContain('Cached documents may restore presentation');
    expect(driverHome).toContain('if (data?.activeRideId)');
    expect(driverHome).toContain("pathname: '/active-ride'");
    expect(driverLayout).toContain('A temporary network error alone does not immediately end work');
    expect(driverLayout).toContain('dispatch independently rejects stale GPS fixes');
  });
});
