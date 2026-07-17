// @ts-check
// Deep deterministic platform flow using real Horizonte street addresses/coordinates:
// driver application -> secure admin approval (#101) -> online -> passenger request ->
// dispatch -> direct Pix -> launch 0% ride -> exact-expiry wallet gate -> commission capture.
//
// External systems are not called here: production code is exercised with in-memory
// Firestore and an injected deterministic route result. The Android/DEV live smoke
// remains separate because it requires real accounts, devices and provider calls.

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
const AT_18H = Date.parse('2026-08-01T21:00:00.000Z'); // 18:00 America/Fortaleza
const CTX = { traceId: 'trace_platform_real_horizonte', environment: 'test' };

// Real Horizonte addresses. Coordinates are fixed test fixtures so the suite is
// deterministic; labels are kept to prove the end-to-end address projection.
const EEEP_LUCIA_HELENA = {
  lat: -4.0995358,
  lng: -38.5006227,
  label: 'Rua José Sabino Filho, 665 - Zumbi, Horizonte - CE',
};
const CEMES_HORIZONTE = {
  lat: -4.10497,
  lng: -38.44969,
  label: 'Rua Maria Conrado de Lima, 135A - Centro, Horizonte - CE',
};

const ROUTE_DISTANCE_METERS = 6200;
const ROUTE_DURATION_SECONDS = 16 * 60;
const EXPECTED_CAR_FARE_CENTAVOS = 1507;
const EXPECTED_CAR_COMMISSION_CENTAVOS = 226;

function req(uid, data) {
  return { auth: { uid }, data };
}

function seedPlatform(db) {
  db.collection('admins').doc(ADMIN_ID).set({ role: 'admin', active: true });
  // Force the next approval to be #101: non-founder, but inside the global
  // 60-day launch commission-free window and first-five-rides subscription grace.
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
}

function seedSubmittedDriverApplication(db) {
  // Represents the final document produced by the real mobile onboarding screens
  // after profile, vehicle and document upload, immediately before admin review.
  db.collection(DRIVER_C.DRIVERS).doc(DRIVER_ID).set({
    role: 'driver',
    serviceAreaId: RIDE_C.DEFAULT_SERVICE_AREA_ID,
    vehicleType: 'car',
    verificationStatus: 'pending_review',
    duplicateCheckStatus: 'pending_admin_review',
    profileStatus: 'complete',
    vehicleStatus: 'complete',
    documentsStatus: 'complete',
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
    activeRideId: null,
    submittedAtMs: AT_18H - 60_000,
  });
  db.collection(RIDE_C.PRIVATE_DRIVER_DATA).doc(DRIVER_ID).set({
    pixKey: 'driver-platform-test@example.com',
    pixOwnerName: 'Motorista Teste Horizonte',
  });
}

function deterministicRealAddressRoute() {
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
      pickup: EEEP_LUCIA_HELENA,
      destination: CEMES_HORIZONTE,
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

  const winningOfferKey = `${RIDE_C.DRIVER_OFFERS}/${rideId}_${DRIVER_ID}`;
  expect(db._store.get(winningOfferKey).exactDestination).toBeUndefined();

  await lifecycle.startRide({
    db,
    request: req(DRIVER_ID, { rideId, idempotencyKey: `start-real-${suffix}` }),
    context: CTX,
    clock,
  });
  expect(db._store.get(winningOfferKey).exactDestination).toMatchObject({
    lat: CEMES_HORIZONTE.lat,
    lng: CEMES_HORIZONTE.lng,
    label: CEMES_HORIZONTE.label,
  });

  await lifecycle.finishRide({
    db,
    request: req(DRIVER_ID, { rideId, idempotencyKey: `finish-real-${suffix}` }),
    context: CTX,
    clock,
  });

  const awaiting = db._store.get(`${RIDE_C.RIDE_REQUESTS}/${rideId}`);
  expect(awaiting.status).toBe(RIDE_C.RIDE_STATUS.AWAITING_PAYMENT);
  expect(awaiting.paymentAmountCentavos).toBe(EXPECTED_CAR_FARE_CENTAVOS);
  expect(awaiting.paymentPixPayload).toContain('540515.07');

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

function allDocs(db, collectionName) {
  const prefix = `${collectionName}/`;
  const docs = [];
  for (const [key, value] of db._store.entries()) {
    if (key.startsWith(prefix)) docs.push({ id: key.slice(prefix.length), ...value });
  }
  return docs;
}

describe('platform onboarding -> real-address car rides -> commission lifecycle', () => {
  it('covers driver #101 from submitted application through launch ride and first paid-commission ride', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(AT_18H);
    const routing = deterministicRealAddressRoute();
    seedPlatform(db);
    seedSubmittedDriverApplication(db);

    // 1) Secure admin approval consumes counter #101 exactly once.
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
      subscriptionFreeUntil: null,
    });
    expect(approved.commissionFreeUntil).toBe(AT_18H + 60 * DRIVER_C.DAY_MS);
    expect(db._store.get(`${DRIVER_C.COUNTERS}/${RIDE_C.DEFAULT_SERVICE_AREA_ID}`).approvedCount).toBe(101);

    // Reapproval is idempotent: counter and benefit dates do not restart.
    const replayApproval = await approveDriver({
      db,
      request: req(ADMIN_ID, { driverId: DRIVER_ID }),
      context: CTX,
      clock,
    });
    expect(replayApproval.approvalNumber).toBe(101);
    expect(replayApproval.commissionFreeUntil).toBe(approved.commissionFreeUntil);
    expect(db._store.get(`${DRIVER_C.COUNTERS}/${RIDE_C.DEFAULT_SERVICE_AREA_ID}`).approvedCount).toBe(101);

    let driver = db._store.get(`${DRIVER_C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.profileStatus).toBe('complete');
    expect(driver.vehicleStatus).toBe('complete');
    expect(driver.documentsStatus).toBe('complete');
    expect(driver.walletBalanceCentavos).toBe(0);
    expect(driver.freeRideCountUsed).toBe(0);

    // 2) Approved driver goes online near the real pickup address.
    await db.collection(DRIVER_C.DRIVERS).doc(DRIVER_ID).set({
      availabilityStatus: 'online',
      location: { lat: EEEP_LUCIA_HELENA.lat, lng: EEEP_LUCIA_HELENA.lng },
      locationUpdatedAtMs: clock.now(),
    }, { merge: true });

    // 3) First passenger request during launch window: no subscription and no
    // wallet required; route/fare remain server-authoritative.
    const first = await requestRide(db, clock, routing, 'launch-0001');
    expect(first.status).toBe(RIDE_C.RIDE_STATUS.SEARCHING);
    expect(first.estimatedFareCentavos).toBe(EXPECTED_CAR_FARE_CENTAVOS);
    expect(first.routeDistanceMeters).toBe(ROUTE_DISTANCE_METERS);
    expect(first.routeDurationSeconds).toBe(ROUTE_DURATION_SECONDS);
    expect(routing.calls[0]).toMatchObject({
      origin: EEEP_LUCIA_HELENA,
      destination: CEMES_HORIZONTE,
      vehicleType: 'car',
    });

    const firstStored = db._store.get(`${RIDE_C.RIDE_REQUESTS}/${first.rideId}`);
    expect(firstStored.estimatedCommissionCentavos).toBe(EXPECTED_CAR_COMMISSION_CENTAVOS);
    expect(firstStored.pickup.label).toBe(EEEP_LUCIA_HELENA.label);
    expect(firstStored.destination.label).toBe(CEMES_HORIZONTE.label);

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
    driver = db._store.get(`${DRIVER_C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.walletBalanceCentavos).toBe(0);
    expect(driver.walletHeldCentavos).toBe(0);

    const firstCompleted = await completeRide(db, clock, first.rideId, 'launch-0001');
    expect(firstCompleted.status).toBe(RIDE_C.RIDE_STATUS.COMPLETED);
    expect(firstCompleted.commissionCapturedCentavos).toBe(0);
    driver = db._store.get(`${DRIVER_C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.freeRideCountUsed).toBe(1);
    expect(driver.walletBalanceCentavos).toBe(0);
    expect(db._store.get(`${RIDE_C.PASSENGERS}/${PASSENGER_ID}`).activeRideId).toBeNull();

    // 4) At the exact expiry instant, 0% ends (exclusive boundary). The driver is
    // still inside the first-five-rides subscription grace, but wallet R$0 blocks
    // acceptance because the normal 15% commission now applies.
    clock.advance(60 * DRIVER_C.DAY_MS);
    await db.collection(DRIVER_C.DRIVERS).doc(DRIVER_ID).set({
      locationUpdatedAtMs: clock.now(),
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

    expect(db._store.get(`${RIDE_C.RIDE_REQUESTS}/${second.rideId}`).status).toBe(RIDE_C.RIDE_STATUS.SEARCHING);
    expect(db._store.get(`${RIDE_C.DRIVER_OFFERS}/${secondOfferId}`).exactPickup).toBeUndefined();

    // Simulates a previously verified wallet top-up result. Mercado Pago's signed
    // webhook/application logic is covered separately in payments.test.js.
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
    expect(secondAccept.commissionHoldCentavos).toBe(EXPECTED_CAR_COMMISSION_CENTAVOS);
    driver = db._store.get(`${DRIVER_C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.walletBalanceCentavos).toBe(2000);
    expect(driver.walletAvailableCentavos).toBe(1774);
    expect(driver.walletHeldCentavos).toBe(226);

    const secondCompleted = await completeRide(db, clock, second.rideId, 'post-promo-0002');
    expect(secondCompleted.commissionCapturedCentavos).toBe(EXPECTED_CAR_COMMISSION_CENTAVOS);
    driver = db._store.get(`${DRIVER_C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.walletBalanceCentavos).toBe(1774);
    expect(driver.walletAvailableCentavos).toBe(1774);
    expect(driver.walletHeldCentavos).toBe(0);
    expect(driver.freeRideCountUsed).toBe(2);
    expect(driver.subscriptionActive).not.toBe(true); // first five rides remain subscription-free

    const capture = db._store.get(`${RIDE_C.WALLET_TRANSACTIONS}/${second.rideId}_capture`);
    expect(capture).toMatchObject({
      driverId: DRIVER_ID,
      rideId: second.rideId,
      type: 'commission_capture',
      amountCentavos: EXPECTED_CAR_COMMISSION_CENTAVOS,
      releasedCentavos: 0,
      status: 'captured',
    });

    // Replaying completion cannot debit a second time.
    const replayCompletion = await lifecycle.confirmDriverPixReceived({
      db,
      request: req(DRIVER_ID, { rideId: second.rideId, idempotencyKey: 'confirm-real-post-promo-0002' }),
      context: CTX,
      clock,
    });
    expect(replayCompletion.commissionCapturedCentavos).toBe(EXPECTED_CAR_COMMISSION_CENTAVOS);
    expect(db._store.get(`${DRIVER_C.DRIVERS}/${DRIVER_ID}`).walletBalanceCentavos).toBe(1774);

    // Notification outbox is privacy-safe: no street, coordinates, Pix key, CPF,
    // phone or full profile data can leak into FCM payload documents.
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

    // One approval, two accepted rides and two completions are auditable.
    expect(allDocs(db, 'auditLogs').length).toBeGreaterThanOrEqual(5);
  });
});
