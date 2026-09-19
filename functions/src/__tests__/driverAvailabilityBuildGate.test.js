const { setDriverAvailability } = require('../drivers/availability');
const { fixedClock } = require('../time/clock');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');

const T0 = 1_800_000_000_000;
const ctx = { traceId: 't', environment: 'test' };

async function setup(driverOverrides = {}) {
  const db = makeFakeFirestore();
  await db.collection('cityPublicConfig').doc('HORIZONTE_CE_BR').set({
    minimumBuildNumber: 18, enforceMinimumDriverBuild: true,
  });
  db.collection('drivers').doc('d1').set({
    serviceAreaId: 'HORIZONTE_CE_BR', vehicleType: 'moto', verificationStatus: 'approved',
    isBlocked: false, activeRideId: null, availabilityStatus: 'offline', availabilitySessionId: null,
    founderEligible: true, commissionFreeUntil: T0 + 864e7, subscriptionFreeUntil: T0 + 864e7,
    walletAvailableCentavos: 0, pixKeyType: 'CPF', pixKey: '529.982.247-25', ...driverOverrides,
  });
  return db;
}
const call = (db, data) => setDriverAvailability({
  db, request: { auth: { uid: 'd1' }, data: { availabilityStatus: 'online', ...data } },
  context: ctx, clock: fixedClock(T0),
});

describe('build gate at go-online (min 18 enforced)', () => {
  it('build 17 client (sends no build number) is refused and stays offline', async () => {
    const db = await setup();
    await expect(call(db, {})).rejects.toMatchObject({ code: 'APP_UPDATE_REQUIRED' });
    expect(db._store.get('drivers/d1').availabilityStatus).toBe('offline');
  });
  it('explicit build 17 is refused', async () => {
    const db = await setup();
    await expect(call(db, { clientBuildNumber: 17 })).rejects.toMatchObject({ code: 'APP_UPDATE_REQUIRED' });
  });
  it('build 18 goes online and clears a stale update marker', async () => {
    const db = await setup({ availabilityClosedReason: 'mandatory_update_required', availabilityRequiredBuildNumber: 18 });
    const r = await call(db, { clientBuildNumber: 18 });
    expect(r.availabilityStatus).toBe('online');
    expect(db._store.get('drivers/d1').availabilityRequiredBuildNumber).toBeNull();
  });
});

describe('update-required message for old builds', () => {
  it('tells the driver to update via Play Store and not to uninstall', async () => {
    const db = await setup();
    const err = await call(db, {}).catch((e) => e);
    const msg = err.toClient().message;
    expect(msg).toMatch(/Play Store/);
    expect(msg).toMatch(/Atualizar/);
    expect(msg).toMatch(/NÃO desinstale/);
  });
});
