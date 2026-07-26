jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      delete: () => 'DELETE_FIELD',
    },
  },
}));

jest.mock('../../logging/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  shortHash: (value) => `hash_${String(value).slice(0, 6)}`,
}));

jest.mock('../../audit/auditLog', () => ({
  writeAuditLog: jest.fn(),
}));

const {
  safeRideSnapshot,
  issueFingerprint,
  ticketDocumentId,
  myTicketProjection,
  adminTicketProjection,
} = require('../tickets');

describe('support ticket privacy projections', () => {
  it('keeps operational ride fields without identity, route or Pix data', () => {
    const snapshot = safeRideSnapshot({
      status: 'assigned',
      passengerId: 'passenger-1',
      acceptedDriverId: 'driver-1',
      pickup: { lat: 1, lng: 2, label: 'pickup-label' },
      destination: { lat: 3, lng: 4, label: 'destination-label' },
      acceptedDriverPublic: { name: 'Driver Name', vehiclePlate: 'ABC1234' },
      paymentPixPayload: 'pix-payload',
      paymentAmountCentavos: 800,
      vehicleType: 'moto',
      serviceAreaId: 'HORIZONTE_CE_BR',
    });

    expect(snapshot).toMatchObject({
      status: 'assigned',
      vehicleType: 'moto',
      serviceAreaId: 'HORIZONTE_CE_BR',
      paymentAmountCentavos: 800,
    });
    expect(snapshot).not.toHaveProperty('passengerId');
    expect(snapshot).not.toHaveProperty('acceptedDriverId');
    expect(snapshot).not.toHaveProperty('pickup');
    expect(snapshot).not.toHaveProperty('destination');
    expect(snapshot).not.toHaveProperty('acceptedDriverPublic');
    expect(snapshot).not.toHaveProperty('paymentPixPayload');
  });

  it('builds deterministic non-reversible references', () => {
    const first = issueFingerprint({
      uid: 'user-1',
      categoryCode: 'technical_error',
      rideId: null,
      paymentRequestId: null,
    });
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(issueFingerprint({
      uid: 'user-1',
      categoryCode: 'technical_error',
      rideId: null,
      paymentRequestId: null,
    })).toBe(first);
    expect(ticketDocumentId('user-1', 'support-key-0001')).toMatch(/^st_[a-f0-9]{28}$/);
  });

  it('returns a minimal user projection and a richer admin projection', () => {
    const ticket = {
      ticketId: 'ticket-1',
      actorUid: 'user-1',
      actorHash: 'actor-hash',
      actorRole: 'driver',
      categoryCode: 'wallet_topup_issue',
      status: 'open',
      rideId: null,
      paymentRequestId: 'payment-1',
      providerOrderId: 'provider-1',
      contextSnapshot: { payment: { status: 'pending', amountCentavos: 3000 } },
      createdAtMs: 100,
      updatedAtMs: 200,
    };

    const mine = myTicketProjection(ticket);
    expect(mine).toMatchObject({
      ticketId: 'ticket-1',
      actorRole: 'driver',
      categoryCode: 'wallet_topup_issue',
      paymentRequestId: 'payment-1',
    });
    expect(mine).not.toHaveProperty('actorUid');
    expect(mine).not.toHaveProperty('actorHash');
    expect(mine).not.toHaveProperty('providerOrderId');
    expect(mine).not.toHaveProperty('contextSnapshot');

    const admin = adminTicketProjection(ticket);
    expect(admin).toMatchObject({
      actorHash: 'actor-hash',
      providerOrderId: 'provider-1',
      contextSnapshot: { payment: { status: 'pending', amountCentavos: 3000 } },
    });
    expect(admin).not.toHaveProperty('actorUid');
  });
});