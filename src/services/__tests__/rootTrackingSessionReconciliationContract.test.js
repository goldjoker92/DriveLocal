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
    expect(layout).toContain('authenticatedUid === trackingSession.driverId');
    expect(layout).toContain('stale_native_session_detected');
    expect(layout).toContain('await stopDriverOnlineTracking()');
    expect(layout).toContain('stale_native_session_stopped');
  });

  test('does not expose full identifiers in cleanup logs', () => {
    const layout = source('src/app/_layout.jsx');

    expect(layout).toContain('shortId(authenticatedUid)');
    expect(layout).toContain('shortId(trackingSession.driverId)');
    expect(layout).toContain('shortId(trackingSession.rideId)');
    expect(layout).not.toContain('authenticatedUid: authenticatedUid');
    expect(layout).not.toContain('trackingDriverId: trackingSession.driverId');
  });
});
