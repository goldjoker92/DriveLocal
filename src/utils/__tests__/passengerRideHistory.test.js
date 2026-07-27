import {
  PASSENGER_RIDE_HISTORY_VERSION,
  appendPassengerHistoryPages,
  formatPassengerHistoryDateTime,
  normalizePassengerHistoryItem,
  normalizePassengerHistoryPage,
} from '../passengerRideHistory';

describe('passenger ride history presentation', () => {
  it('normalizes a completed ride with real driver and payment copy', () => {
    const item = normalizePassengerHistoryItem({
      rideId: 'ride_001',
      createdAtMs: new Date('2026-07-27T12:00:00.000Z').getTime(),
      historyAtMs: new Date('2026-07-27T12:30:00.000Z').getTime(),
      driverFirstName: 'João',
      pickupLabel: 'Rua A, 10',
      destinationLabel: 'Centro',
      vehicleType: 'moto',
      vehicleLabel: 'Moto • Honda • CG 160 • Preta • ABC1D23',
      amountCentavos: 1250,
      amountKind: 'final',
      rideStatus: 'completed',
      pixStatus: 'received',
    });

    expect(item).toMatchObject({
      rideId: 'ride_001',
      driverFirstName: 'João',
      vehicleLabel: 'Moto • Honda • CG 160 • Preta • ABC1D23',
      amountLabel: 'R$ 12,50',
      amountDetail: 'valor final',
      rideStatusLabel: 'Concluída',
      pixStatusLabel: 'Pix confirmado',
    });
  });

  it('uses honest fallbacks when no driver or final amount exists', () => {
    expect(normalizePassengerHistoryItem({
      rideId: 'ride_002',
      createdAtMs: 1000,
      vehicleType: 'car',
      amountCentavos: null,
      amountKind: 'unavailable',
      rideStatus: 'no_driver_available',
      pixStatus: 'not_started',
    })).toMatchObject({
      driverFirstName: 'Motorista não atribuído',
      pickupLabel: 'Local de partida',
      destinationLabel: 'Destino',
      vehicleLabel: 'Carro',
      amountLabel: 'Valor indisponível',
      amountDetail: null,
      rideStatusLabel: 'Nenhum motorista disponível',
      pixStatusLabel: 'Pix ainda não iniciado',
    });
  });

  it('rejects items without a stable ride id and deduplicates pages', () => {
    const page = normalizePassengerHistoryPage({
      version: PASSENGER_RIDE_HISTORY_VERSION,
      hasMore: true,
      nextCursor: { beforeCreatedAtMs: 1000, beforeRideId: 'ride_001' },
      items: [
        { rideId: 'ride_001', createdAtMs: 2000 },
        { rideId: 'ride_001', createdAtMs: 2000 },
        { rideId: '', createdAtMs: 1000 },
      ],
    });
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);

    const appended = appendPassengerHistoryPages(
      [normalizePassengerHistoryItem({ rideId: 'ride_001', createdAtMs: 2000 })],
      [
        normalizePassengerHistoryItem({ rideId: 'ride_002', createdAtMs: 3000 }),
        normalizePassengerHistoryItem({ rideId: 'ride_001', createdAtMs: 2000 }),
      ]
    );
    expect(appended.map((item) => item.rideId)).toEqual(['ride_002', 'ride_001']);
  });

  it('uses Fortaleza time and never formats an invalid date', () => {
    expect(formatPassengerHistoryDateTime(new Date('2026-07-27T03:00:00.000Z').getTime()))
      .toContain('27/07/2026');
    expect(formatPassengerHistoryDateTime(null)).toBe('Data indisponível');
  });
});