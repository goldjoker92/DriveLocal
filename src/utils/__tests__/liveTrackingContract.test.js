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
    expect(service).toContain('ONLINE_NATIVE_INTERVAL_MS = 60_000');
    expect(service).toContain('ACTIVE_RIDE_NATIVE_INTERVAL_MS = 5_000');
    expect(service).toContain('timeInterval: intervalMs');
    expect(service).toContain('distanceInterval: activeRide ? 10 : 0');
    expect(service).toContain('deferredUpdatesDistance: activeRide ? 10 : 0');
    expect(service).toContain('lastQueuedAtByMode');
    expect(service).toContain('auth.authStateReady');
    expect(service).toContain('stale_session_publish_dropped');
    expect(service).toContain('DRIVER_INITIAL_LOCATION_NOT_PUBLISHED');
    expect(service).toContain('restorePreviousSessionAfterStartFailure');
    expect(entry).toContain("import './src/services/driverLocationTracking'");
    expect(entry).toContain("import 'expo-router/entry'");
    expect(layout).toContain("import '../services/driverLocationTracking'");
    expect(pkg).toContain('"main": "./index.js"');
  });

  it('requires explicit background-location disclosure before permission request', () => {
    const home = source('src/app/(driver)/driver-home.jsx');
    const activeRide = source('src/app/(driver)/active-ride.jsx');

    expect(home).toContain('Localização durante o trabalho');
    expect(home).toContain("requestPermissions: permission.status !== 'granted'");
    expect(activeRide).toContain('Localização da corrida');
    expect(activeRide).toContain('attachActiveRideTracking');
    expect(activeRide).toContain('detachActiveRideTracking');
  });

  it('starts unavailable and uses one explicit work action', () => {
    const cockpit = source('src/utils/driverCockpit.js');
    const home = source('src/app/(driver)/driver-home.jsx');
    const availability = source('src/services/driverAvailabilityService.js');
    const auth = source('src/services/authService.js');

    expect(cockpit).toContain("ONLINE: 'online'");
    expect(cockpit).toContain("OFFLINE: 'offline'");
    expect(auth).toContain("availabilityStatus: 'offline'");
    expect(auth).toContain('availabilitySessionId: null');
    expect(availability).toContain("'setDriverAvailabilitySecure'");
    expect(home).toContain('🔴 Você está indisponível');
    expect(home).toContain('Comece quando estiver pronto para receber ofertas.');
    expect(home).toContain('Sua localização fica desligada enquanto você não trabalha.');
    expect(home).toContain('Começar a trabalhar');
    expect(home).toContain('🟢 Você está disponível');
    expect(home).toContain('Buscando corridas próximas.');
    expect(home).toContain('GPS de trabalho ativo.');
    expect(home).toContain('Parar de trabalhar');
    expect(home).toContain('cockpit.remote_session_revoked');
    expect(home).toContain('timestampMs(driver.availabilityUpdatedAt)');
    expect(home).toContain('|| Number(driver.availabilityUpdatedAtMs || 0)');
    expect(home).not.toContain('setDriverAvailability(uid, AVAILABILITY.ONLINE)');
  });

  it('does not cancel a fresh work session from cached Firestore state', () => {
    const home = source('src/app/(driver)/driver-home.jsx');
    const layout = source('src/app/(driver)/_layout.jsx');

    expect(home).toContain('REMOTE_RECONCILIATION_GRACE_MS = 12_000');
    expect(home).toContain('snapshotNeedsServerConfirmation');
    expect(home).toContain('{ includeMetadataChanges: true }');
    expect(home).toContain('activationInProgress.current');
    expect(home).toContain('cockpit.reconciliation_deferred');
    expect(home).toContain('cockpit.online_restore_recovering');
    expect(home).toContain('getDriverTrackingSession');

    expect(layout).toContain('REMOTE_RECONCILIATION_GRACE_MS = 12_000');
    expect(layout).toContain('snapshotNeedsServerConfirmation');
    expect(layout).toContain('{ includeMetadataChanges: true }');
    expect(layout).toContain('layout.reconciliation_deferred');
    // Both metadata states must defer reconciliation. The production logger uses
    // one ternary expression, so assert the complete decision rather than a
    // formatting-specific standalone `reason` property.
    expect(layout).toContain("metadata.hasPendingWrites ? 'pending_writes' : 'snapshot_from_cache'");
    expect(layout).toContain("reason: 'local_transition_grace'");
  });

  it('recovers accepted rides but filters offers from an old work session', () => {
    const tracking = source('src/services/driverLocationTracking.js');
    const rides = source('src/services/ridesService.js');
    const layout = source('src/app/(driver)/_layout.jsx');
    const auth = source('src/services/authService.js');

    expect(tracking).toContain("doc(db, 'rideRequests', rideId)");
    expect(tracking).toContain('acceptedAvailabilitySessionId');
    expect(tracking).toContain('active_ride.session_recovered');
    expect(rides).toContain('ride.driver_offer.stale_session_ignored');
    expect(rides).toContain('selected.availabilitySessionId === trackingSession.availabilitySessionId');
    expect(layout).toContain('layout.remote_session_revoked');
    expect(layout).toContain('foreground_heartbeat_error');
    expect(auth).toContain('readAuthenticatedDriverState');
    expect(auth).toContain("source: remoteDriver?.activeRideId ? 'firestore_driver' : 'none'");
    expect(auth).toContain('account_change_blocked');
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

  it('restricts live location to current ride parties and the active work session', () => {
    const rules = source('backend/firebase/rules/firestore.rules');
    const lifecycle = source('functions/src/rides/lifecycle.js');

    expect(rules).toContain('match /activeRideLocations/{rideId}');
    expect(rules).toContain('isAcceptedRideDriver(rideId)');
    expect(rules).toContain('isRidePassenger(rideId)');
    expect(rules).toContain("ride.status in ['assigned', 'driver_arrived', 'in_progress']");
    expect(rules).toContain('driverOperationalUpdateValid');
    expect(rules).toContain("resource.data.availabilityStatus == 'online'");
    expect(rules).toContain("resource.data.availabilityUpdatedAt > request.time - duration.value(7, 'm')");
    expect(rules).toContain('request.resource.data.locationAvailabilitySessionId == resource.data.availabilitySessionId');
    expect(rules).toContain('request.resource.data.locationUpdatedAt == request.time');
    expect(rules).toContain('request.resource.data.availabilityUpdatedAt == request.time');
    expect(lifecycle).toContain('clearActiveRideLocationTx');
    expect(lifecycle).toContain('tx.delete');
  });
});
