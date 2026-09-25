// @ts-check
// Deterministic launch platform flow using fixed Horizonte coordinates:
// application -> approved public photo -> admin approval #101 -> explicit work
// session -> 0% launch ride -> exact promotion expiry -> wallet gate
// -> normal commission hold and capture.

const { approveDriver } = require('../drivers/approveDriver');
const { createRideRequestSecure } = require('../rides/createRideRequest');
const { acceptDriverOfferSecure } = require('../rides/acceptOffer');
const lifecycle = require('../rides/lifecycle');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const DRIVER_C = require('../drivers/constants');
const RIDE_C = require('../rides/constants');

const ADMIN_ID = 'admin_horizonte_platform_test';
const DRIVER_ID = 'driver_101_car_horizonte';
const PASSENGER_ID = 'passenger_real_addresses_horizonte';
const AVAILABILITY_SESSION = 'work_platform_driver_session_123456789';
const AT_18H = Date.parse('2026-08-01T21:00:00.000Z');
const CTX = { traceId: 'trace_platform_real_horizonte', environment: 'test' };

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
const ROUTE_DISTANCE_METERS = 6200;
const ROUTE_DURATION_SECONDS = 16 * 60;
const EXPECTED_FARE_CENTAVOS = 1364;
const EXPECTED_COMMISSION_CENTAVOS = 205;

function req(uid, data) {
  return { auth: { uid }, data };
}

function allDocs(db, collectionName) {
  const prefix = `${collectionName}/`;
  const docs = [];
  for (const [key, value] of db._store.entries()) {
    if (key.startsWith(prefix)) docs.push({ id: key.slice(prefix.length), ...value });
  }
  return docs;
}

function seedPlatform(db) {
  db.collection('admins').doc(ADMIN_ID).set({ role: 'admin', active: true });
  db.collection(DRIVER_C.COUNTERS).doc(RIDE_C.DEFAULT_SERVICE_AREA_ID).set({
    serviceAreaId: RIDE_C.DEFAULT_SERVICE_AREA_ID,
    approvedCount: 100,
  });
  db.collection(RIDE_C.CITY_PUBLIC_CONFIG).doc(RIDE_C.DEFAULT_SERVICE_AREA_ID).set({
    active: true,
    enabled: true,
    allowedVehicleTypes: ['moto', 'car'],
    boundaryVersion: '2024.1',
    operationalPolygonVersion: '2024.1',
    offerTtlSeconds: 15,
    searchRadiusMeters: 5000,
    maxCandidates: 25,
  });
  db.collection(RIDE_C.PASSENGERS).doc(PASSENGER_ID).set({
    role: 'passenger',
    activeRideId: null,
    registrationStatus: 'complete',
  });

  // This fixture represents the real state immediately after the dedicated photo
  // review flow approved the passenger-facing image. Approval must never bypass it.
  db.collection(DRIVER_C.DRIVERS).doc(DRIVER_ID).set({
    role: 'driver',
    serviceAreaId: RIDE_C.DEFAULT_SERVICE_AREA_ID,
    vehicleType: 'car',
    verificationStatus: 'pending_review',
    profileStatus: 'complete',
    vehicleStatus: 'complete',
    documentsStatus: 'complete',
    driverPhotoReviewStatus: 'approved',
    driverPhotoPublicPath: `publicDriverPhotos/${DRIVER_ID}/v1.jpg`,
    driverPhotoPublicVersion: 'v1',
    fullName: 'Motorista Teste Horizonte',
    whatsApp: '85000000000',
    cpf: '00000000000',
    pixKeyType: 'email',
    pixKey: 'driver-platform-test@example.com',
    vehicleMake: 'Fiat',
    vehicleModel: 'Argo',
    vehicleYear: 2022,
    vehicleColor: 'Branco',
    vehiclePlate: 'TST0A01',
    documentRefs: {
      cnh: 'drivers/test/cnh.jpg',
      vehicle: 'drivers/test/crlv.jpg',
      selfie: 'drivers/test/selfie.jpg',
    },
    availabilityStatus: 'offline',
    availabilitySessionId: null,
    activeRideId: null,
    submittedAtMs: AT_18H - 60_000,
  });
  db.collection(RIDE_C.PRIVATE_DRIVER_DATA).doc(DRIVER_ID).set({
    pixKey: 'driver-platform-test@example.com',
    pixOwnerName: 'Motorista Teste Horizonte',
  });
}

function routingAdapter() {
  const calls = [];
  return {
    calls,
    async computeRoute(input) {
      calls.push(input);
      return {
        distanceMeters: ROUTE_DISTANCE_METERS,
        durationSeconds: ROUTE_DURATION_SECONDS,
      };
    },
  };
}

async function requestRide(db, clock, routing, suffix) {
  return createRideRequestSecure({
    db,
    request: req(PASSENGER_ID, {
      vehicleType: 'car',
      pickup: PICKUP,
      destination: DESTINATION,
      idempotencyKey: `ride-real-horizonte-${suffix}`,
    }),
    context: CTX,
    clock,
    routingAdapter: routing,
  });
}

async function completeRide(db, clock, rideId, suffix) {
  await lifecycle.markDriverArrived({
    db,
    request: req(DRIVER_ID, { rideId, idempotencyKey: `arrive-real-${suffix}` }),
    context: CTX,
    clock,
  });
  await lifecycle.startRide({
    db,
    request: req(DRIVER_ID, { rideId, idempotencyKey: `start-real-${suffix}` }),
    context: CTX,
    clock,
  });
  await lifecycle.finishRide({
    db,
    request: req(DRIVER_ID, { rideId, idempotencyKey: `finish-real-${suffix}` }),
    context: CTX,
    clock,
  });
  const awaiting = db._store.get(`${RIDE_C.RIDE_REQUESTS}/${rideId}`);
  expect(awaiting.status).toBe(RIDE_C.RIDE_STATUS.AWAITING_PAYMENT);
  expect(awaiting.paymentAmountCentavos).toBe(EXPECTED_FARE_CENTAVOS);
  expect(awaiting.paymentPixPayload).toContain('540513.64');

  await lifecycle.markPassengerPixSent({
    db,
    request: req(PASSENGER_ID, { rideId, idempotencyKey: `sent-real-${suffix}` }),
    context: CTX,
    clock,
  });
  return lifecycle.confirmDriverPixReceived({
    db,
    request: req(DRIVER_ID, { rideId, idempotencyKey: `confirm-real-${suffix}` }),
    context: CTX,
    clock,
  });
}

describe('platform onboarding -> real-address car rides -> commission lifecycle', () => {
  it('covers driver #101 through free launch ride and first paid-commission ride', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(AT_18H);
    const routing = routingAdapter();
    seedPlatform(db);

    const approved = await approveDriver({
      db,
      request: req(ADMIN_ID, { driverId: DRIVER_ID }),
      context: CTX,
      clock,
    });
    expect(approved).toMatchObject({
      driverId: DRIVER_ID,
      verificationStatus: 'approved',
      approvalNumber: 101,
      founderEligible: false,
      founderNumber: null,
    });
    expect(approved.commissionFreeUntil).toBe(AT_18H + 60 * DRIVER_C.DAY_MS);
    expect(db._store.get(`${DRIVER_C.DRIVERS}/${DRIVER_ID}`)).toMatchObject({
      availabilityStatus: 'offline',
      availabilitySessionId: null,
    });

    // Reapproval is idempotent and cannot restart launch benefits.
    const replayApproval = await approveDriver({
      db,
      request: req(ADMIN_ID, { driverId: DRIVER_ID }),
      context: CTX,
      clock,
    });
    expect(replayApproval.approvalNumber).toBe(101);
    expect(replayApproval.commissionFreeUntil).toBe(approved.commissionFreeUntil);

    await db.collection(DRIVER_C.DRIVERS).doc(DRIVER_ID).set({
      availabilityStatus: 'online',
      availabilitySessionId: AVAILABILITY_SESSION,
      availabilityUpdatedAtMs: clock.now(),
      location: { lat: PICKUP.lat, lng: PICKUP.lng },
      locationUpdatedAtMs: clock.now(),
      locationAvailabilitySessionId: AVAILABILITY_SESSION,
    }, { merge: true });

    // Launch window: no hold and no wallet needed.
    const first = await requestRide(db, clock, routing, 'launch-0001');
    expect(first.estimatedFareCentavos).toBe(EXPECTED_FARE_CENTAVOS);
    expect(routing.calls[0]).toMatchObject({
      origin: PICKUP,
      destination: DESTINATION,
      vehicleType: 'car',
    });
    const firstAccept = await acceptDriverOfferSecure({
      db,
      request: req(DRIVER_ID, {
        offerId: `${first.rideId}_${DRIVER_ID}`,
        idempotencyKey: 'accept-real-launch-0001',
      }),
      context: CTX,
      clock,
    });
    expect(firstAccept.commissionHoldCentavos).toBe(0);
    const firstCompleted = await completeRide(db, clock, first.rideId, 'launch-0001');
    expect(firstCompleted.commissionCapturedCentavos).toBe(0);

    // At day 60 the normal 15% commission applies. An old plan field has no
    // effect; the wallet remains the separate, legitimate acceptance gate.
    clock.advance(60 * DRIVER_C.DAY_MS);
    await db.collection(DRIVER_C.DRIVERS).doc(DRIVER_ID).set({
      availabilityUpdatedAtMs: clock.now(),
      locationUpdatedAtMs: clock.now(),
      subscriptionActive: false,
      subscriptionStatus: 'required',
      walletBalanceCentavos: 0,
      walletAvailableCentavos: 0,
      walletHeldCentavos: 0,
    }, { merge: true });

    const second = await requestRide(db, clock, routing, 'post-promo-0002');
    const secondOfferId = `${second.rideId}_${DRIVER_ID}`;
    await expect(acceptDriverOfferSecure({
      db,
      request: req(DRIVER_ID, {
        offerId: secondOfferId,
        idempotencyKey: 'accept-real-poor-0002',
      }),
      context: CTX,
      clock,
    })).rejects.toMatchObject({ code: 'WALLET_INSUFFICIENT' });

    await db.collection(DRIVER_C.DRIVERS).doc(DRIVER_ID).set({
      walletBalanceCentavos: 2000,
      walletAvailableCentavos: 2000,
      walletHeldCentavos: 0,
    }, { merge: true });
    const secondAccept = await acceptDriverOfferSecure({
      db,
      request: req(DRIVER_ID, {
        offerId: secondOfferId,
        idempotencyKey: 'accept-real-funded-0002',
      }),
      context: CTX,
      clock,
    });
    expect(secondAccept.commissionHoldCentavos).toBe(EXPECTED_COMMISSION_CENTAVOS);

    const secondCompleted = await completeRide(db, clock, second.rideId, 'post-promo-0002');
    expect(secondCompleted.commissionCapturedCentavos).toBe(EXPECTED_COMMISSION_CENTAVOS);
    const driver = db._store.get(`${DRIVER_C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.walletBalanceCentavos).toBe(1795);
    expect(driver.walletAvailableCentavos).toBe(1795);
    expect(driver.walletHeldCentavos).toBe(0);

    const capture = db._store.get(`${RIDE_C.WALLET_TRANSACTIONS}/${second.rideId}_capture`);
    expect(capture).toMatchObject({
      driverId: DRIVER_ID,
      rideId: second.rideId,
      type: 'commission_capture',
      amountCentavos: EXPECTED_COMMISSION_CENTAVOS,
      releasedCentavos: 0,
      status: 'captured',
    });

    // Replay cannot debit twice.
    const replayCompletion = await lifecycle.confirmDriverPixReceived({
      db,
      request: req(DRIVER_ID, {
        rideId: second.rideId,
        idempotencyKey: 'confirm-real-post-promo-0002',
      }),
      context: CTX,
      clock,
    });
    expect(replayCompletion.commissionCapturedCentavos).toBe(EXPECTED_COMMISSION_CENTAVOS);
    expect(db._store.get(`${DRIVER_C.DRIVERS}/${DRIVER_ID}`).walletBalanceCentavos).toBe(1795);

    // Notification documents stay free of exact addresses, Pix key, CPF and coords.
    const notifications = allDocs(db, RIDE_C.NOTIFICATION_EVENTS);
    expect(notifications.length).toBeGreaterThanOrEqual(10);
    for (const event of notifications) {
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain('José Sabino');
      expect(serialized).not.toContain('Maria Conrado');
      expect(serialized).not.toContain('driver-platform-test@example.com');
      expect(serialized).not.toContain('00000000000');
      expect(serialized).not.toContain('-4.');
    }
    expect(allDocs(db, 'auditLogs').length).toBeGreaterThanOrEqual(5);
  });
});
