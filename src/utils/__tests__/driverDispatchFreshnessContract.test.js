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

  it('publishes a heartbeat even when an online driver is stationary', () => {
    const tracking = source('src/services/driverLocationTracking.js');

    expect(tracking).toContain('const ONLINE_HEARTBEAT_INTERVAL_MS = 30_000');
    expect(tracking).toContain('const ACTIVE_RIDE_INTERVAL_MS = 5_000');
    expect(tracking).toContain('distanceInterval: 0');
    expect(tracking).toContain('deferredUpdatesDistance: 0');
    expect(tracking).not.toContain('distanceInterval: 10');
    expect(tracking).toContain('await ensureNativeTaskStarted(rideId)');
  });

  it('normalizes Firestore Timestamp dates in backend driver eligibility', () => {
    const eligibility = source('functions/src/drivers/eligibility.js');

    expect(eligibility).toContain('function toMillis(value)');
    expect(eligibility).toContain('toMillis(d.subscriptionFreeUntil || d.founderFreeUntil)');
    expect(eligibility).toContain('toMillis(d.subscriptionExpiresAt)');
    expect(eligibility).not.toContain('Number(d.subscriptionFreeUntil)');
  });
});
