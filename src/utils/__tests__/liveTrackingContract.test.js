const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Android live driver tracking contracts', () => {
  it('defines the background task globally before Expo Router mounts', () => {
    const service = source('src/services/driverLocationTracking.js');
    const entry = source('index.js');
    const layout = source('src/app/_layout.jsx');
    const pkg = source('package.json');

    expect(service).toContain('TaskManager.defineTask');
    expect(service).toContain('Location.startLocationUpdatesAsync');
    expect(service).toContain('timeInterval: 5_000');
    expect(service).toContain('distanceInterval: 10');
    expect(service).toContain('auth.authStateReady');
    expect(entry).toContain("import './src/services/driverLocationTracking'");
    expect(entry).toContain("import 'expo-router/entry'");
    expect(layout).toContain("import '../services/driverLocationTracking'");
    expect(pkg).toContain('"main": "./index.js"');
  });

  it('requires explicit background-location disclosure before permission request', () => {
    const home = source('src/app/(driver)/driver-home.jsx');
    const activeRide = source('src/app/(driver)/active-ride.jsx');

    expect(home).toContain('Localização durante o trabalho');
    expect(home).toContain('requestPermissions: permission.status !== \'granted\'');
    expect(activeRide).toContain('Localização da corrida');
    expect(activeRide).toContain('attachActiveRideTracking');
    expect(activeRide).toContain('detachActiveRideTracking');
  });

  it('uses the exact backend online availability value and fails closed for old builds', () => {
    const cockpit = source('src/utils/driverCockpit.js');
    const home = source('src/app/(driver)/driver-home.jsx');

    expect(cockpit).toContain("ONLINE: 'online'");
    expect(cockpit).toContain("AVAILABLE: 'online'");
    expect(home).toContain('setDriverAvailability(uid, AVAILABILITY.ONLINE)');
    expect(home).toContain("data?.availabilityStatus === 'available'");
    expect(home).not.toContain("setDriverAvailability(uid, 'available')");
  });

  it('renders the real passenger map from the secured ride location listener', () => {
    const passenger = source('src/app/(passenger)/driver-accepted.jsx');
    const map = source('src/components/RideTrackingMap.jsx');
    const rides = source('src/services/ridesService.js');

    expect(passenger).toContain('RideTrackingMap');
    expect(passenger).toContain('listenToRideLocation');
    expect(passenger).toContain("ride?.status === 'in_progress' ? ride?.destination : ride?.pickup");
    expect(map).toContain('PROVIDER_GOOGLE');
    expect(map).toContain("vehicleType === 'moto' ? '🏍️' : '🚗'");
    expect(rides).toContain("doc(db, 'activeRideLocations', rideId)");
  });

  it('configures Android Maps and the foreground-service icon without committing a key', () => {
    const config = source('app.config.js');
    const pkg = source('package.json');
    const eas = source('eas.json');

    expect(config).toContain('GOOGLE_MAPS_ANDROID_API_KEY');
    expect(config).toContain('androidGoogleMapsApiKey');
    expect(config).toContain('androidForegroundServiceIcon');
    expect(config).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(pkg).toContain('"react-native-maps": "1.27.2"');
    expect(eas).toContain('"image": "sdk-56"');
    expect(eas).toContain('"node": "22.22.2"');
    expect(eas).toContain('"environment": "development"');
  });

  it('restricts live location reads and writes to the active ride parties', () => {
    const rules = source('backend/firebase/rules/firestore.rules');
    const lifecycle = source('functions/src/rides/lifecycle.js');

    expect(rules).toContain('match /activeRideLocations/{rideId}');
    expect(rules).toContain('isAcceptedRideDriver(rideId)');
    expect(rules).toContain('isRidePassenger(rideId)');
    expect(rules).toContain("ride.status in ['assigned', 'driver_arrived', 'in_progress']");
    expect(lifecycle).toContain('clearActiveRideLocationTx');
    expect(lifecycle).toContain('tx.delete');
  });
});
