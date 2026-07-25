// @ts-check

const {
  safeAdminRideView,
  getAdminRideSummary,
} = require('../rides/adminReads');
const { makeFakeFirestore } = require('./helpers/fakeFirestore');
const C = require('../rides/constants');

const ADMIN = 'admin_safe_ride';

const sensitiveRide = {
  status: 'disputed',
  serviceAreaId: 'HORIZONTE_CE_BR',
  vehicleType: 'moto',
  passengerId: 'passenger-1',
  acceptedDriverId: 'driver-1',
  pickup: { lat: -4.1, lng: -38.5, label: 'Rua privada 123' },
  destination: { lat: -4.2, lng: -38.4, label: 'Casa do passageiro' },
  paymentPixPayload: '000201-secret-pix-key',
  driverPixKey: 'secret@example.com',
  passengerPhone: '+5585999999999',
  estimatedFareCentavos: 800,
  finalFareCentavos: 800,
  commissionHoldCentavos: 120,
  commissionPolicySnapshot: {
    policyVersion: 'commission-hold-v1',
    holdAmountCentavos: 120,
    commissionFreeAtAcceptance: false,
  },
  disputeResolution: {
    outcome: 'retain_for_manual_review',
    reasonCode: 'ADMIN_REVIEW',
    note: 'Nota criada pelo admin',
    resolvedByAdmin: 'admin-secret-id',
  },
};

describe('privacy-safe admin ride reads', () => {
  it('projects only support and financial fields', () => {
    const view = safeAdminRideView('ride-1', sensitiveRide);
    expect(view).toMatchObject({
      rideId: 'ride-1',
      status: 'disputed',
      passengerId: 'passenger-1',
      acceptedDriverId: 'driver-1',
      commissionHoldCentavos: 120,
      disputeResolution: {
        outcome: 'retain_for_manual_review',
        reasonCode: 'ADMIN_REVIEW',
        note: 'Nota criada pelo admin',
      },
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('secret-pix-key');
    expect(serialized).not.toContain('secret@example.com');
    expect(serialized).not.toContain('Rua privada');
    expect(serialized).not.toContain('Casa do passageiro');
    expect(serialized).not.toContain('-38.5');
    expect(serialized).not.toContain('+5585');
    expect(serialized).not.toContain('admin-secret-id');
    expect(view).not.toHaveProperty('pickup');
    expect(view).not.toHaveProperty('destination');
    expect(view).not.toHaveProperty('paymentPixPayload');
  });

  it('reads the raw document only on the server and returns the safe projection', async () => {
    const db = makeFakeFirestore();
    await db.collection('admins').doc(ADMIN).set({ active: true });
    await db.collection(C.RIDE_REQUESTS).doc('ride-1').set(sensitiveRide);

    const view = await getAdminRideSummary({
      db,
      request: { auth: { uid: ADMIN }, data: { rideId: 'ride-1' } },
      context: { traceId: 'trace_admin_safe_ride' },
    });
    expect(view.rideId).toBe('ride-1');
    expect(view.paymentPixPayload).toBeUndefined();
    expect(view.pickup).toBeUndefined();
    expect(view.destination).toBeUndefined();
  });
});
