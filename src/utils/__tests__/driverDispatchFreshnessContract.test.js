const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver dispatch freshness contract', () => {
  it('enables Android foreground and background location in the native config', () => {
    const appConfig = JSON.parse(source('app.json'));
    const plugin = appConfig.expo.plugins.find(
      (entry) => Array.isArray(entry) && entry[0] === 'expo-location'
    );

    expect(plugin).toBeDefined();
    expect(plugin[1].isAndroidBackgroundLocationEnabled).toBe(true);
    expect(plugin[1].isAndroidForegroundServiceEnabled).toBe(true);
  });

  it('uses adaptive idle, moving and active-ride publication policies', () => {
    const tracking = source('src/services/driverLocationTracking.js');
    const policy = source('src/utils/driverLocationPolicy.js');

    expect(policy).toContain('online_idle');
    expect(policy).toContain('online_moving');
    expect(policy).toContain('driver_arrived');
    expect(policy).toContain('in_progress');
    // Idle heartbeat must stay well below the 7 min server work-session lease so
    // one missed native cycle cannot make an available driver undispatchable.
    expect(policy).toContain('maxAgeMs: 150_000');
    expect(policy).toContain('minDistanceMeters: 100');
    expect(policy).toContain('minDistanceMeters: 20');
    expect(policy).toContain('shouldPublishDriverLocation');

    expect(tracking).toContain('ONLINE_NATIVE_INTERVAL_MS = 60_000');
    expect(tracking).toContain('ACTIVE_RIDE_NATIVE_INTERVAL_MS = 5_000');
    expect(tracking).toContain('distanceInterval: activeRide ? 10 : 0');
    expect(tracking).toContain('deferredUpdatesDistance: activeRide ? 10 : 0');
    expect(tracking).toContain('stale_session_publish_dropped');
    expect(tracking).toContain('locationAvailabilitySessionId: session.availabilitySessionId');
    expect(tracking).toContain('availabilityUpdatedAtMs: nowMs');
    expect(tracking).toContain('let publishQueue = Promise.resolve()');
    expect(tracking).toContain('DRIVER_INITIAL_LOCATION_NOT_PUBLISHED');
    expect(tracking).toContain('restorePreviousSessionAfterStartFailure');
  });

  it('keeps a foreground pulse that repairs a stopped native task', () => {
    const tracking = source('src/services/driverLocationTracking.js');
    const layout = source('src/app/(driver)/_layout.jsx');

    expect(tracking).toContain('export async function refreshDriverOnlineHeartbeat()');
    expect(tracking).toContain('if (!started)');
    expect(tracking).toContain("await writeSafeStatus('foreground_native_task_restarted')");
    expect(layout).toContain('const FOREGROUND_HEARTBEAT_INTERVAL_MS = 60_000');
    expect(layout).toContain('refreshDriverOnlineHeartbeat');
    expect(layout).toContain("state === 'active'");
    expect(layout).toContain('foreground_heartbeat_error');
    expect(layout).toContain('layout.remote_session_revoked');
  });

  it('normalizes Firestore Timestamp dates inside the authoritative commercial policy', () => {
    const eligibility = source('functions/src/drivers/eligibility.js');
    const commercialPolicy = source('functions/src/drivers/commercialPolicy.js');

    expect(eligibility).toContain("require('./commercialPolicy')");
    expect(eligibility).toContain('resolveCommercialPolicy(d, now)');
    expect(commercialPolicy).toContain('function toMillis(value)');
    expect(commercialPolicy).toContain('approvedAtMs');
    expect(commercialPolicy).toContain('toMillis(driver.approvedAt)');
    expect(commercialPolicy).not.toContain('driver.subscriptionFreeUntil');
  });
});
