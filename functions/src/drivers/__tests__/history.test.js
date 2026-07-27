'use strict';

const C = require('../../rides/constants');
const {
  DRIVER_RIDE_HISTORY_VERSION,
  historyPageSize,
  safeDriverRideHistoryItem,
  pixHistoryStatus,
} = require('../history');

describe('secure driver ride history projection', () => {
  it('returns only the closed fields needed by the driver UI', () => {
    const item = safeDriverRideHistoryItem('ride_history_001', {
      passengerId: 'private-passenger-id',
      acceptedPassengerPublic: {
        firstName: 'Maria Silva',
        photoStoragePath: 'publicPassengerPhotos/private.jpg',
        photoVerified: true,
      },
      pickup: { lat: -4.1, lng: -38.5, label: 'Rua Muito Longa 123' },
      destination: { lat: -4.2, lng: -38.6, label: 'Centro de Horizonte' },
      vehicleType: 'moto',
      acceptedAtMs: 1000,
      completedAtMs: 2000,
      status: C.RIDE_STATUS.COMPLETED,
      finalFareCentavos: 1250,
      commercialPolicySnapshot: { commissionBpsAtAcceptance: 1200 },
      paymentPixPayload: 'private-pix-payload',
      commissionCapturedCentavos: 150,
    });

    expect(item).toEqual({
      rideId: 'ride_history_001',
      acceptedAtMs: 1000,
      historyAtMs: 2000,
      passengerFirstName: 'Maria',
      pickupLabel: 'Rua Muito Longa 123',
      destinationLabel: 'Centro de Horizonte',
      vehicleType: 'moto',
      fareCentavos: 1250,
      fareKind: 'final',
      commissionBps: 1200,
      rideStatus: 'completed',
      pixStatus: 'received',
      completedAtMs: 2000,
      cancelledAtMs: null,
    });
    expect(JSON.stringify(item)).not.toContain('private-passenger-id');
    expect(JSON.stringify(item)).not.toContain('private-pix-payload');
    expect(JSON.stringify(item)).not.toContain('-4.1');
  });

  it('uses safe fallbacks for deleted or malformed passenger data', () => {
    expect(safeDriverRideHistoryItem('ride_history_002', {
      acceptedPassengerPublic: { firstName: 'driver@example.com' },
      status: C.RIDE_STATUS.CANCELLED,
      acceptedAtMs: 1000,
      cancelledAtMs: 1500,
      estimatedFareCentavos: 900,
      vehicleType: 'car',
    })).toMatchObject({
      passengerFirstName: 'Passageiro',
      pickupLabel: 'Local de partida',
      destinationLabel: 'Destino',
      fareCentavos: 900,
      fareKind: 'estimated',
      rideStatus: 'cancelled',
      pixStatus: 'not_applicable',
    });
  });

  it('maps every payment phase without exposing payment internals', () => {
    expect(pixHistoryStatus({ status: C.RIDE_STATUS.AWAITING_PAYMENT })).toBe('awaiting_payment');
    expect(pixHistoryStatus({ status: C.RIDE_STATUS.PAYMENT_MARKED_SENT })).toBe('sent_by_passenger');
    expect(pixHistoryStatus({ status: C.RIDE_STATUS.DISPUTED })).toBe('disputed');
    expect(pixHistoryStatus({ status: C.RIDE_STATUS.IN_PROGRESS })).toBe('not_started');
  });

  it('bounds pages for predictable Firestore cost', () => {
    expect(historyPageSize(undefined)).toBe(20);
    expect(historyPageSize(3)).toBe(3);
    expect(historyPageSize(500)).toBe(20);
  });

  it('keeps the version explicit for mobile compatibility', () => {
    expect(DRIVER_RIDE_HISTORY_VERSION).toBe('driver-ride-history-v1');
  });
});
