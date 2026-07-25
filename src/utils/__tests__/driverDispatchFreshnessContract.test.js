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
    expect(policy).toContain('maxAgeMs: 4 * 60_000');
    expect(policy).toContain('minDistanceMeters: 100');
    expect(policy).toContain('minDistanceMeters: 20');
    expect(policy).toContain('shouldPublishDriverLocation');

    expect(tracking).toContain('ONLINE_NATIVE_INTERVAL_MS = 30_000');
    expect(tracking).toContain('ACTIVE_RIDE_NATIVE_INTERVAL_MS = 5_000');
    expect(tracking).toContain('distanceInterval: activeRide ? 10 : 25');
    expect(tracking).toContain('stale_session_publish_dropped');
    expect(tracking).toContain('locationAvailabilitySessionId: session.availabilitySessionId');
    expect(tracking).toContain('availabilityUpdatedAtMs: nowMs');
    expect(tracking).toContain('let publishQueue = Promise.resolve()');
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
  });

  it('normalizes Firestore Timestamp dates in backend driver eligibility', () => {
    const eligibility = source('functions/src/drivers/eligibility.js');

    expect(eligibility).toContain('function toMillis(value)');
    expect(eligibility).toContain('toMillis(d.subscriptionFreeUntil || d.founderFreeUntil)');
    expect(eligibility).toContain('toMillis(d.subscriptionExpiresAt)');
    expect(eligibility).not.toContain('Number(d.subscriptionFreeUntil)');
  });
});
