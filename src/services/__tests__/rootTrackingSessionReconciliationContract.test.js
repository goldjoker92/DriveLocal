const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('root tracking session reconciliation contract', () => {
  test('stops a stale native driver task when Firebase restores another account', () => {
    const layout = source('src/app/_layout.jsx');

    expect(layout).toContain("import { auth } from '../config/firebase'");
    expect(layout).toContain('getDriverTrackingSession');
    expect(layout).toContain('stopDriverOnlineTracking');
    expect(layout).toContain('auth.onAuthStateChanged');
    expect(layout).toContain('authenticatedUid !== trackingSession.driverId');
    expect(layout).toContain("staleReason = 'account_mismatch'");
    expect(layout).toContain('stale_native_session_detected');
    expect(layout).toContain('await stopDriverOnlineTracking()');
    expect(layout).toContain('stale_native_session_stopped');
  });

  test('also stops an expired, offline or mismatched server work session for the same account', () => {
    const layout = source('src/app/_layout.jsx');

    expect(layout).toContain("import { getDriver } from '../services/driverService'");
    expect(layout).toContain('remoteWorkSessionFresh(remoteDriver)');
    expect(layout).toContain("remoteDriver?.availabilityStatus === 'online'");
    expect(layout).toContain('remoteDriver.availabilitySessionId === trackingSession.availabilitySessionId');
    expect(layout).toContain("? 'remote_offline'");
    expect(layout).toContain("? 'session_mismatch'");
    expect(layout).toContain(": 'lease_expired'");
    expect(layout).toContain('if (!trackingSession.rideId)');
  });

  test('preserves active ride recovery and does not expose full identifiers in logs', () => {
    const layout = source('src/app/_layout.jsx');

    expect(layout).toContain('Active rides have their own recovery path');
    expect(layout).toContain('shortId(authenticatedUid)');
    expect(layout).toContain('shortId(trackingSession.driverId)');
    expect(layout).toContain('shortId(trackingSession.rideId)');
    expect(layout).toContain('shortId(trackingSession.availabilitySessionId)');
    expect(layout).not.toContain('authenticatedUid: authenticatedUid');
    expect(layout).not.toContain('trackingDriverId: trackingSession.driverId');
  });
});
