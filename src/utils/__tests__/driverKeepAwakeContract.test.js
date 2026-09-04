const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('driver keep-awake integration contract', () => {
  it('pins the Expo 56 module as a direct production dependency', () => {
    const pkg = JSON.parse(source('package.json'));
    expect(pkg.dependencies['expo-keep-awake']).toBe('~56.0.3');
  });

  it('mounts the guard only inside the driver route group', () => {
    const driverLayout = source('src/app/(driver)/_layout.jsx');
    const nonDriverLayouts = [
      source('src/app/_layout.jsx'),
      source('src/app/(auth)/_layout.jsx'),
      source('src/app/(passenger)/_layout.jsx'),
      source('src/app/(admin)/_layout.jsx'),
    ].join('\n');

    expect(driverLayout).toContain("import DriverKeepAwakeGuard");
    expect(driverLayout).toContain('<DriverKeepAwakeGuard');
    expect(driverLayout).toContain('availabilityStatus={availabilityStatus}');
    expect(driverLayout).toContain('activeRideId={activeRideId}');
    expect(driverLayout).toContain('const screenAvailabilityStatus');
    expect(driverLayout).toContain('setAvailabilityStatus(screenAvailabilityStatus)');
    expect(nonDriverLayouts).not.toContain('DriverKeepAwakeGuard');
  });

  it('uses one tagged native lock with explicit cleanup and safe logs', () => {
    const guard = source('src/components/DriverKeepAwakeGuard.jsx');

    expect(guard).toContain("DRIVER_KEEP_AWAKE_TAG = 'drivelocal-driver-operational'");
    expect(guard).toContain('activateKeepAwakeAsync(DRIVER_KEEP_AWAKE_TAG)');
    expect(guard).toContain('deactivateKeepAwake(DRIVER_KEEP_AWAKE_TAG)');
    expect(guard).toContain("AppState.addEventListener('change'");
    expect(guard).toContain("'[DRIVER_SCREEN_AWAKE]'");
    expect(guard).not.toMatch(/\b(uid|email|token)\b/i);
  });
});
