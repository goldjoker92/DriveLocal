// @ts-check
// Full standard-commission moto ride at an arbitrary hour (00:07 Horizonte),
// including safe offer UI data, passenger/driver notification routing, exact map
// points, direct Pix and one-time wallet settlement.

const { createRideRequestSecure } = require('../rides/createRideRequest');
const { acceptDriverOfferSecure } = require('../rides/acceptOffer');
const lifecycle = require('../rides/lifecycle');
const { buildMulticastMessage } = require('../notifications/processEvent');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');

const AT_0007 = Date.parse('2026-08-02T03:07:00.000Z'); // 00:07 America/Fortaleza
const DRIVER = 'moto_anytime_driver';
const PASSENGER = 'moto_anytime_passenger';
const AVAILABILITY_SESSION = 'work_moto_anytime_session_123456789';
const PICKUP = {
  lat: -4.0995358,
  lng: -38.5006227,
  label: 'Rua José Sabino Filho, 665 - Zumbi, Horizonte - CE',
};
const DESTINATION = {
  lat: -4.10497,
  lng: -38.44969,
  label: 'Rua Maria Conrado de Lima, 135A - Centro, Horizonte - CE',
};
const CTX = { traceId: 'trace_anytime_moto_0007', environment: 'test' };

function req(uid, data) {
  return { auth: { uid }, data };
}

function events(db, rideId) {
  const prefix = `${C.NOTIFICATION_EVENTS}/${rideId}_`;
  const out = [];
  for (const [key, value] of db._store.entries()) {
    if (key.startsWith(prefix)) out.push({ id: key.slice(`${C.NOTIFICATION_EVENTS}/`.length), ...value });
  }
  return out;
}

describe('any-hour moto customer experience', () => {
  it('runs the whole 00:07 flow through visible notifications and percentage commission', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(AT_0007);

    db.collection(C.CITY_PUBLIC_CONFIG).doc(C.DEFAULT_SERVICE_AREA_ID).set({
      active: true,
      enabled: true,
      allowedVehicleTypes: ['moto', 'car'],
      boundaryVersion: '2024.1',
      operationalPolygonVersion: '2024.1',
      offerTtlSeconds: 15,
      searchRadiusMeters: 5000,
      maxCandidates: 25,
    });
    db.collection(C.PASSENGERS).doc(PASSENGER).set({ activeRideId: null, role: 'passenger' });
    db.collection(C.DRIVERS).doc(DRIVER).set({
      serviceAreaId: C.DEFAULT_SERVICE_AREA_ID,
      vehicleType: 'moto',
      verificationStatus: 'approved',
      isBlocked: false,
      availabilityStatus: 'online',
      availabilitySessionId: AVAILABILITY_SESSION,
      availabilityUpdatedAtMs: AT_0007,
      activeRideId: null,
      location: { lat: PICKUP.lat, lng: PICKUP.lng },
      locationUpdatedAtMs: AT_0007,
      locationAvailabilitySessionId: AVAILABILITY_SESSION,
      founderEligible: false,
      commissionFreeUntil: null,
      subscriptionActive: true,
      subscriptionExpiresAt: AT_0007 + 30 * 864e5,
      freeRideCountUsed: 5,
      walletBalanceCentavos: 1000,
      walletAvailableCentavos: 1000,
      walletHeldCentavos: 0,
      fullName: 'João Moto Teste',
      vehicleMake: 'Honda',
      vehicleModel: 'CG 160',
      vehicleColor: 'Vermelha',
      vehiclePlate: 'TST1B02',
    });
    db.collection(C.PRIVATE_DRIVER_DATA).doc(DRIVER).set({
      pixKey: 'moto-test@example.com',
      pixOwnerName: 'Joao Moto Teste',
    });

    const routeCalls = [];
    const routingAdapter = {
      async computeRoute(input) {
        routeCalls.push(input);
        return { distanceMeters: 4000, durationSeconds: 720 };
      },
    };

    const created = await createRideRequestSecure({
      db,
      request: req(PASSENGER, {
        vehicleType: 'moto',
        pickup: PICKUP,
        destination: DESTINATION,
        idempotencyKey: 'ride-anytime-moto-0007',
      }),
      context: CTX,
      clock,
      routingAdapter,
    });

    // Moto: 200 + 4*85 + 12*10 = 660; 12% = 79.2 -> 79.
    expect(created).toMatchObject({
      status: C.RIDE_STATUS.SEARCHING,
      vehicleType: 'moto',
      estimatedFareCentavos: 660,
      routeDistanceMeters: 4000,
      routeDurationSeconds: 720,
    });
    expect(routeCalls).toEqual([{ origin: PICKUP, destination: DESTINATION, vehicleType: 'moto' }]);

    const rideId = created.rideId;
    const persistedQuotedRide = db._store.get(`${C.RIDE_REQUESTS}/${rideId}`);
    expect(persistedQuotedRide.estimatedCommissionCentavos).toBe(79);
    expect(persistedQuotedRide.minimumPlatformCommissionCentavos).toBe(60);

    const offerId = `${rideId}_${DRIVER}`;
    const offered = db._store.get(`${C.DRIVER_OFFERS}/${offerId}`);
    expect(offered.pickupPreview.label).toBe('Região do embarque');
    expect(offered.availabilitySessionId).toBe(AVAILABILITY_SESSION);
    expect(JSON.stringify(offered.pickupPreview)).not.toContain('José Sabino');
    expect(offered.exactPickup).toBeUndefined();

    const offerEvent = db._store.get(`${C.NOTIFICATION_EVENTS}/${rideId}_offer_created_${DRIVER}`);
    const offerMessage = buildMulticastMessage(offerEvent, ['native-fcm-token']);
    expect(offerMessage.notification).toEqual({
      title: 'Nova corrida disponível',
      body: 'Abra a DriveLocal para ver e aceitar a oferta.',
    });
    expect(offerMessage.android.notification.channelId).toBe(C.NOTIFICATION_CHANNELS.RIDE_OFFERS);
    expect(offerMessage.data).toMatchObject({
      rideId,
      offerId,
      route: '/ride-request',
      recipientRole: 'driver',
    });

    const accepted = await acceptDriverOfferSecure({
      db,
      request: req(DRIVER, { offerId, idempotencyKey: 'accept-anytime-moto-01' }),
      context: CTX,
      clock,
    });
    expect(accepted.commissionHoldCentavos).toBe(79);
    expect(accepted.pickup).toEqual(PICKUP);

    const assignedRide = db._store.get(`${C.RIDE_REQUESTS}/${rideId}`);
    expect(assignedRide.acceptedAvailabilitySessionId).toBe(AVAILABILITY_SESSION);
    expect(assignedRide.acceptedDriverPublic).toMatchObject({
      name: 'João Moto Teste',
      vehicleType: 'moto',
      vehicleMake: 'Honda',
      vehicleModel: 'CG 160',
      vehicleColor: 'Vermelha',
      vehiclePlate: 'TST1B02',
      photoStoragePath: null,
      photoVerified: false,
    });
    const assignedEvent = db._store.get(`${C.NOTIFICATION_EVENTS}/${rideId}_ride_assigned_passenger`);
    const assignedMessage = buildMulticastMessage(assignedEvent, ['passenger-token']);
    expect(assignedMessage.android.notification.channelId).toBe(C.NOTIFICATION_CHANNELS.RIDE_STATUS);
    expect(assignedMessage.data).toMatchObject({ rideId, route: '/driver-accepted', recipientRole: 'passenger' });

    await lifecycle.markDriverArrived({
      db,
      request: req(DRIVER, { rideId, idempotencyKey: 'arrive-anytime-moto-01' }),
      context: CTX,
      clock,
    });
    expect(db._store.get(`${C.DRIVER_OFFERS}/${offerId}`).driverRideStatus).toBe('driver_arrived');

    await lifecycle.startRide({
      db,
      request: req(DRIVER, { rideId, idempotencyKey: 'start-anytime-moto-001' }),
      context: CTX,
      clock,
    });
    const startedOffer = db._store.get(`${C.DRIVER_OFFERS}/${offerId}`);
    expect(startedOffer.driverRideStatus).toBe('in_progress');
    expect(startedOffer.exactDestination).toEqual(DESTINATION);

    await lifecycle.finishRide({
      db,
      request: req(DRIVER, { rideId, idempotencyKey: 'finish-anytime-moto-01' }),
      context: CTX,
      clock,
    });
    let ride = db._store.get(`${C.RIDE_REQUESTS}/${rideId}`);
    expect(ride.status).toBe('awaiting_payment');
    expect(ride.paymentAmountCentavos).toBe(660);
    expect(ride.paymentPixPayload).toContain('54046.60');
    expect(db._store.get(`${C.DRIVER_OFFERS}/${offerId}`).driverRideStatus).toBe('awaiting_payment');

    await lifecycle.markPassengerPixSent({
      db,
      request: req(PASSENGER, { rideId, idempotencyKey: 'sent-anytime-moto-0001' }),
      context: CTX,
      clock,
    });
    expect(db._store.get(`${C.DRIVER_OFFERS}/${offerId}`).driverRideStatus).toBe('payment_marked_sent');
    const paidEvent = db._store.get(`${C.NOTIFICATION_EVENTS}/${rideId}_ride_payment_marked_sent_driver`);
    expect(buildMulticastMessage(paidEvent, ['driver-token']).data).toMatchObject({
      rideId,
      route: '/active-ride',
      eventType: 'ride_payment_marked_sent',
    });

    const completed = await lifecycle.confirmDriverPixReceived({
      db,
      request: req(DRIVER, { rideId, idempotencyKey: 'confirm-anytime-moto-01' }),
      context: CTX,
      clock,
    });
    expect(completed).toMatchObject({ status: 'completed', commissionCapturedCentavos: 79 });
    ride = db._store.get(`${C.RIDE_REQUESTS}/${rideId}`);
    const driver = db._store.get(`${C.DRIVERS}/${DRIVER}`);
    expect(ride.commissionCapturedCentavos).toBe(79);
    expect(driver.walletBalanceCentavos).toBe(921);
    expect(driver.walletAvailableCentavos).toBe(921);
    expect(driver.walletHeldCentavos).toBe(0);
    expect(db._store.get(`${C.DRIVER_OFFERS}/${offerId}`).driverRideStatus).toBe('completed');

    const allEvents = events(db, rideId);
    expect(allEvents).toHaveLength(8);
    expect(allEvents.map((e) => `${e.recipientRole}:${e.eventType}:${e.route}`).sort()).toEqual([
      'driver:offer_created:/ride-request',
      'driver:ride_completed:/active-ride',
      'driver:ride_payment_marked_sent:/active-ride',
      'passenger:ride_arrived:/driver-accepted',
      'passenger:ride_assigned:/driver-accepted',
      'passenger:ride_awaiting_payment:/pix-payment',
      'passenger:ride_completed:/pix-payment',
      'passenger:ride_started:/driver-accepted',
    ].sort());

    for (const event of allEvents) {
      const message = buildMulticastMessage(event, ['token']);
      expect(message.notification.title).toBeTruthy();
      expect(message.notification.body).toBeTruthy();
      expect(JSON.stringify(message)).not.toContain('José Sabino');
      expect(JSON.stringify(message)).not.toContain('Maria Conrado');
      expect(JSON.stringify(message)).not.toContain('moto-test@example.com');
    }
  });
});
