'use strict';

const C = require('../constants');
const {
  PASSENGER_RIDE_HISTORY_VERSION,
  historyPageSize,
  safePassengerRideHistoryItem,
  pixHistoryStatus,
} = require('../passengerHistory');

describe('secure passenger ride history projection', () => {
  it('returns only the closed fields needed by the passenger UI', () => {
    const item = safePassengerRideHistoryItem('ride_passenger_history_001', {
      passengerId: 'private-passenger-id',
      acceptedDriverId: 'private-driver-id',
      acceptedDriverPublic: {
        name: 'João Motorista',
        vehicleType: 'moto',
        vehicleMake: 'Honda',
        vehicleModel: 'CG 160',
        vehicleColor: 'Preta',
        vehiclePlate: 'ABC1D23',
        photoStoragePath: 'driverPublicPhotos/private.jpg',
      },
      pickup: { lat: -4.1, lng: -38.5, label: 'Rua A, 10' },
      destination: { lat: -4.2, lng: -38.6, label: 'Centro de Horizonte' },
      createdAtMs: 1000,
      completedAtMs: 2000,
      status: C.RIDE_STATUS.COMPLETED,
      finalFareCentavos: 1250,
      paymentPixPayload: 'private-pix-payload',
      commissionCapturedCentavos: 150,
      driverPixKey: 'private-pix-key',
    });

    expect(item).toEqual({
      rideId: 'ride_passenger_history_001',
      createdAtMs: 1000,
      historyAtMs: 2000,
      driverFirstName: 'João',
      vehicleType: 'moto',
      vehicleLabel: 'Moto • Honda • CG 160 • Preta • ABC1D23',
      pickupLabel: 'Rua A, 10',
      destinationLabel: 'Centro de Horizonte',
      amountCentavos: 1250,
      amountKind: 'final',
      rideStatus: 'completed',
      pixStatus: 'received',
    });
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('private-passenger-id');
    expect(serialized).not.toContain('private-driver-id');
    expect(serialized).not.toContain('private-pix-payload');
    expect(serialized).not.toContain('private-pix-key');
    expect(serialized).not.toContain('-4.1');
    expect(serialized).not.toContain('driverPublicPhotos');
  });

  it('uses honest fallbacks before a driver is assigned', () => {
    expect(safePassengerRideHistoryItem('ride_passenger_history_002', {
      passengerId: 'passenger-1',
      pickup: { label: 'Bairro Centro' },
      destination: { label: 'Hospital' },
      createdAtMs: 1000,
      status: C.RIDE_STATUS.NO_DRIVER_AVAILABLE,
      estimatedFareCentavos: 900,
      vehicleType: 'car',
    })).toMatchObject({
      driverFirstName: 'Motorista não atribuído',
      vehicleType: 'car',
      vehicleLabel: 'Carro',
      amountCentavos: 900,
      amountKind: 'estimated',
      rideStatus: 'no_driver_available',
      pixStatus: 'not_started',
    });
  });

  it('maps every payment phase without exposing payment internals', () => {
    expect(pixHistoryStatus({ status: C.RIDE_STATUS.AWAITING_PAYMENT })).toBe('awaiting_payment');
    expect(pixHistoryStatus({ status: C.RIDE_STATUS.PAYMENT_MARKED_SENT })).toBe('sent_by_passenger');
    expect(pixHistoryStatus({ status: C.RIDE_STATUS.DISPUTED })).toBe('disputed');
    expect(pixHistoryStatus({ status: C.RIDE_STATUS.CANCELLED })).toBe('not_applicable');
  });

  it('bounds pages for predictable Firestore cost', () => {
    expect(historyPageSize(undefined)).toBe(20);
    expect(historyPageSize(3)).toBe(3);
    expect(historyPageSize(500)).toBe(20);
  });

  it('keeps the version explicit for mobile compatibility', () => {
    expect(PASSENGER_RIDE_HISTORY_VERSION).toBe('passenger-ride-history-v1');
  });
});