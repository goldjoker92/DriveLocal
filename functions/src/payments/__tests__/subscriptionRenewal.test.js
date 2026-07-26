const { applySubscription } = require('../applyPayment');
const { fixedClock } = require('../../time/clock');
const { makeFakeFirestore } = require('../../__tests__/helpers/fakeFirestore');

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function countCollection(db, collectionName) {
  const prefix = `${collectionName}/`;
  return [...db._store.keys()].filter((key) => key.startsWith(prefix)).length;
}

async function seedPayment(db, id, driverId, amountCentavos) {
  const ref = db.collection('paymentRequests').doc(id);
  await ref.set({
    driverId,
    purpose: 'driver_subscription',
    status: 'pending',
    amountCentavos,
    appliedAtMs: null,
  });
  return ref;
}

describe('paid subscription renewal application', () => {
  it('extends an active plan from its current expiration and applies only once', async () => {
    const db = makeFakeFirestore();
    const currentExpiry = NOW + 12 * DAY_MS;
    await db.collection('drivers').doc('d1').set({
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'moto',
      subscriptionActive: true,
      subscriptionStatus: 'active',
      subscriptionExpiresAt: currentExpiry,
      approvedAtMs: NOW - 40 * DAY_MS,
      founderEligible: false,
      founderNumber: null,
      commissionFreeUntil: NOW + 20 * DAY_MS,
      freeRideCountUsed: 5,
    });
    const paymentRef = await seedPayment(db, 'pay-renew', 'd1', 990);

    const first = await applySubscription({
      db,
      paymentRef,
      driverId: 'd1',
      amountCentavos: 990,
      processingMs: NOW,
      traceId: 'trace-renew',
      clock: fixedClock(NOW),
    });
    const second = await applySubscription({
      db,
      paymentRef,
      driverId: 'd1',
      amountCentavos: 990,
      processingMs: NOW,
      traceId: 'trace-renew-replay',
      clock: fixedClock(NOW + 1000),
    });

    const driver = db._store.get('drivers/d1');
    expect(first).toMatchObject({ applied: true, duplicate: false });
    expect(second).toMatchObject({ applied: false, duplicate: true });
    expect(driver.subscriptionExpiresAt).toBe(currentExpiry + 30 * DAY_MS);
    expect(driver.subscriptionLastAmountCentavos).toBe(990);
    expect(driver.approvedAtMs).toBe(NOW - 40 * DAY_MS);
    expect(driver.founderEligible).toBe(false);
    expect(driver.founderNumber).toBeNull();
    expect(driver.commissionFreeUntil).toBe(NOW + 20 * DAY_MS);
    expect(driver.freeRideCountUsed).toBe(5);
    expect(countCollection(db, 'subscriptionPayments')).toBe(1);
  });

  it('starts an expired plan from the provider-confirmed processing time', async () => {
    const db = makeFakeFirestore();
    const processingMs = NOW + 2 * DAY_MS;
    await db.collection('drivers').doc('d1').set({
      serviceAreaId: 'HORIZONTE_CE_BR',
      vehicleType: 'car',
      subscriptionActive: false,
      subscriptionStatus: 'required',
      subscriptionExpiresAt: NOW - DAY_MS,
      commissionFreeUntil: NOW - DAY_MS,
      freeRideCountUsed: 5,
    });
    const paymentRef = await seedPayment(db, 'pay-start', 'd1', 1990);

    await applySubscription({
      db,
      paymentRef,
      driverId: 'd1',
      amountCentavos: 1990,
      processingMs,
      traceId: 'trace-start',
      clock: fixedClock(processingMs + 1000),
    });

    const driver = db._store.get('drivers/d1');
    expect(driver.subscriptionExpiresAt).toBe(processingMs + 30 * DAY_MS);
    expect(driver.subscriptionActive).toBe(true);
    expect(driver.subscriptionStatus).toBe('active');
  });
});
