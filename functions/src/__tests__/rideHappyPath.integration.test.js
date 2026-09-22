// @ts-check
// End-to-end business-flow test (in-memory Firestore, no cloud): passenger ride
// request at 18:00 in Horizonte -> dispatch -> acceptance -> direct Pix payment ->
// DriveLocal commission capture from the driver's prepaid wallet.

const { createRideRequestSecure } = require('../rides/createRideRequest');
const { acceptDriverOfferSecure } = require('../rides/acceptOffer');
const lifecycle = require('../rides/lifecycle');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');

// 2026-07-16 18:00:00 America/Fortaleza (UTC-03:00).
const AT_18H = Date.parse('2026-07-16T21:00:00.000Z');
const PASSENGER_ID = 'passenger_horizonte_18h';
const DRIVER_ID = 'driver_car_standard';
const WORK_SESSION_ID = 'work_happy_path_0001';
const CTX = { traceId: 'trace_e2e_horizonte_18h', environment: 'test' };

// Fictional endpoints inside the deterministic Horizonte test polygon.
const PICKUP = { lat: -4.1000, lng: -38.4900, label: 'Praça Fictícia do Centro' };
const DESTINATION = { lat: -4.1150, lng: -38.5050, label: 'Rua Fictícia do Horizonte' };
const BOUNDARY = {
  type: 'Polygon',
  coordinates: [[[-38.55, -4.15], [-38.45, -4.15], [-38.45, -4.05], [-38.55, -4.05], [-38.55, -4.15]]],
};

function request(uid, data) {
  return { auth: { uid }, data };
}

function seedBase(db) {
  db.collection(C.CITY_PUBLIC_CONFIG).doc(C.DEFAULT_SERVICE_AREA_ID).set({
    active: true,
    allowedVehicleTypes: ['moto', 'car'],
    boundary: BOUNDARY,
    boundaryVersion: '2024.1',
    operationalPolygonVersion: '2024.1',
    offerTtlSeconds: 15,
    searchRadiusMeters: 5000,
    maxCandidates: 25,
  });

  db.collection(C.PASSENGERS).doc(PASSENGER_ID).set({ activeRideId: null });

  // A real candidate is not just marked online: the work-session lease and the
  // latest GPS point must carry the same session id. This keeps the end-to-end
  // happy path aligned with the production anti-ghost-driver contract.
  db.collection(C.DRIVERS).doc(DRIVER_ID).set({
    serviceAreaId: C.DEFAULT_SERVICE_AREA_ID,
    vehicleType: 'car',
    verificationStatus: 'approved',
    isBlocked: false,
    availabilityStatus: 'online',
    availabilitySessionId: WORK_SESSION_ID,
    availabilityUpdatedAtMs: AT_18H,
    activeRideId: null,
    location: { lat: PICKUP.lat, lng: PICKUP.lng },
    locationAvailabilitySessionId: WORK_SESSION_ID,
    locationUpdatedAtMs: AT_18H,
    founderEligible: false,
    commissionFreeUntil: null,
    subscriptionFreeUntil: null,
    subscriptionActive: true,
    subscriptionExpiresAt: AT_18H + 10 * 24 * 60 * 60 * 1000,
    freeRideCountUsed: 5,
    completedRideCount: 5,
    walletBalanceCentavos: 5000,
    walletAvailableCentavos: 5000,
    walletHeldCentavos: 0,
  });

  db.collection(C.PRIVATE_DRIVER_DATA).doc(DRIVER_ID).set({
    pixKey: 'driver-test@example.com',
    pixOwnerName: 'Motorista Teste',
  });
}

function routingAt18h() {
  return {
    async computeRoute() {
      // Fictional 5 km / 15 min route at 18:00. Dynamic pricing is disabled.
      return { distanceMeters: 5000, durationSeconds: 900 };
    },
  };
}

function countDocs(db, prefix) {
  let count = 0;
  for (const key of db._store.keys()) if (key.startsWith(prefix)) count += 1;
  return count;
}

describe('full passenger ride -> driver Pix -> platform commission', () => {
  it('completes one car ride at 18h and captures exactly R$2.36 once', async () => {
    const db = makeFakeFirestore();
    const clock = fixedClock(AT_18H);
    seedBase(db);

    const created = await createRideRequestSecure({
      db,
      request: request(PASSENGER_ID, {
        vehicleType: 'car',
        pickup: PICKUP,
        destination: DESTINATION,
        idempotencyKey: 'ride-horizonte-18h-0001',
      }),
      context: CTX,
      clock,
      routingAdapter: routingAt18h(),
    });

    // Car: R$3.00 base + R$1.20/km * 5 + R$0.15/min * 15 = R$11.25.
    // Commission: 15% of R$11.25 = R$1.6875 -> R$2.36.
    expect(created.estimatedFareCentavos).toBe(1570);
    expect(created.routeDistanceMeters).toBe(5000);
    expect(created.routeDurationSeconds).toBe(900);

    const rideId = created.rideId;
    const storedCreatedRide = db._store.get(`${C.RIDE_REQUESTS}/${rideId}`);
    expect(storedCreatedRide.estimatedCommissionCentavos).toBe(236);
    expect(storedCreatedRide.createdAtMs).toBe(AT_18H);

    const accepted = await acceptDriverOfferSecure({
      db,
      request: request(DRIVER_ID, {
        offerId: `${rideId}_${DRIVER_ID}`,
        idempotencyKey: 'accept-horizonte-18h-01',
      }),
      context: CTX,
      clock,
    });

    expect(accepted.commissionHoldCentavos).toBe(236);
    let driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    expect(driver.walletBalanceCentavos).toBe(5000); // not charged yet
    expect(driver.walletAvailableCentavos).toBe(4764);
    expect(driver.walletHeldCentavos).toBe(236);

    await lifecycle.markDriverArrived({
      db,
      request: request(DRIVER_ID, { rideId, idempotencyKey: 'arrive-horizonte-18h-1' }),
      context: CTX,
      clock,
    });
    await lifecycle.startRide({
      db,
      request: request(DRIVER_ID, { rideId, idempotencyKey: 'start-horizonte-18h-01' }),
      context: CTX,
      clock,
    });
    await lifecycle.finishRide({
      db,
      request: request(DRIVER_ID, { rideId, idempotencyKey: 'finish-horizonte-18h-1' }),
      context: CTX,
      clock,
    });

    let ride = db._store.get(`${C.RIDE_REQUESTS}/${rideId}`);
    expect(ride.status).toBe(C.RIDE_STATUS.AWAITING_PAYMENT);
    expect(ride.finalFareCentavos).toBe(1570);
    expect(ride.paymentAmountCentavos).toBe(1570);
    expect(ride.finalCommissionCentavos).toBe(236);
    // EMV TLV: field 54 (amount), length 05, value 15.70.
    expect(ride.paymentPixPayload).toContain('540515.70');

    await lifecycle.markPassengerPixSent({
      db,
      request: request(PASSENGER_ID, { rideId, idempotencyKey: 'pix-sent-horizonte-01' }),
      context: CTX,
      clock,
    });

    const completed = await lifecycle.confirmDriverPixReceived({
      db,
      request: request(DRIVER_ID, { rideId, idempotencyKey: 'pix-confirm-horizonte1' }),
      context: CTX,
      clock,
    });

    expect(completed.status).toBe(C.RIDE_STATUS.COMPLETED);
    expect(completed.commissionCapturedCentavos).toBe(236);

    ride = db._store.get(`${C.RIDE_REQUESTS}/${rideId}`);
    driver = db._store.get(`${C.DRIVERS}/${DRIVER_ID}`);
    const capture = db._store.get(`${C.WALLET_TRANSACTIONS}/${rideId}_capture`);

    // Financial result:
    // passenger -> driver Pix: R$11.25
    // driver wallet -> DriveLocal commission ledger: R$2.36
    // driver's ride revenue after commission: R$9.56
    // wallet: R$50.00 -> R$48.31; no duplicate capture.
    expect(ride.commissionCapturedCentavos).toBe(236);
    expect(driver.walletBalanceCentavos).toBe(4764);
    expect(driver.walletAvailableCentavos).toBe(4764);
    expect(driver.walletHeldCentavos).toBe(0);
    expect(capture).toMatchObject({
      driverId: DRIVER_ID,
      rideId,
      type: 'commission_capture',
      amountCentavos: 236,
      releasedCentavos: 0,
      status: 'captured',
    });
    expect(1570 - 236).toBe(1334);

    // Replay is idempotent: no second debit and one capture document.
    await lifecycle.confirmDriverPixReceived({
      db,
      request: request(DRIVER_ID, { rideId, idempotencyKey: 'pix-confirm-horizonte1' }),
      context: CTX,
      clock,
    });
    expect(db._store.get(`${C.DRIVERS}/${DRIVER_ID}`).walletBalanceCentavos).toBe(4764);
    expect(countDocs(db, `${C.WALLET_TRANSACTIONS}/${rideId}_capture`)).toBe(1);
  });
});
