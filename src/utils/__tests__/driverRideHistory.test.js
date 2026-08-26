import {
  appendDriverHistoryPages,
  formatDriverCommissionBps,
  formatDriverRateBps,
  normalizeDriverHistoryItem,
  normalizeDriverHistoryPage,
} from '../driverRideHistory';

describe('driver ride history presentation', () => {
  it('normalizes one completed ride with exact PT-BR labels', () => {
    const item = normalizeDriverHistoryItem({
      rideId: 'ride_mobile_history_001',
      historyAtMs: new Date('2026-07-27T15:30:00.000Z').getTime(),
      passengerFirstName: 'Maria',
      pickupLabel: 'Centro',
      destinationLabel: 'Catolé',
      vehicleType: 'moto',
      fareCentavos: 1250,
      fareKind: 'final',
      commissionBps: 1200,
      rideStatus: 'completed',
      pixStatus: 'received',
    });

    expect(item).toMatchObject({
      rideId: 'ride_mobile_history_001',
      passengerFirstName: 'Maria',
      pickupLabel: 'Centro',
      destinationLabel: 'Catolé',
      vehicleLabel: '🏍 Moto',
      fareLabel: 'R$ 12,50',
      fareDetail: 'valor final',
      commissionLabel: 'Taxa da plataforma: 12%',
      rideStatusLabel: 'Concluída',
      pixStatusLabel: 'Pix recebido',
    });
    expect(item.dateLabel).toContain('27/07/2026');
  });

  it('never converts missing money, rate or commission into a false zero', () => {
    const item = normalizeDriverHistoryItem({
      rideId: 'ride_mobile_history_002',
      rideStatus: 'cancelled',
      pixStatus: 'not_applicable',
    });

    expect(item.fareLabel).toBe('Valor indisponível');
    expect(item.commissionLabel).toBe('Taxa da plataforma indisponível');
    expect(formatDriverCommissionBps(null)).toBe('Taxa da plataforma indisponível');
    expect(formatDriverRateBps(null)).toBe('—');
    expect(formatDriverRateBps(0)).toBe('0%');
  });

  it('deduplicates malformed pages and requires a real cursor for hasMore', () => {
    const page = normalizeDriverHistoryPage({
      version: 'driver-ride-history-v1',
      hasMore: true,
      nextCursor: { beforeAcceptedAtMs: 1000, beforeRideId: 'ride_1' },
      items: [
        { rideId: 'ride_1', historyAtMs: 1000 },
        { rideId: 'ride_1', historyAtMs: 1000 },
        { rideId: '', historyAtMs: 900 },
      ],
    });

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(normalizeDriverHistoryPage({ hasMore: true, items: [] }).hasMore).toBe(false);
  });

  it('appends pages without duplicates and keeps newest rides first', () => {
    const first = [
      normalizeDriverHistoryItem({ rideId: 'ride_2', historyAtMs: 2000 }),
      normalizeDriverHistoryItem({ rideId: 'ride_1', historyAtMs: 1000 }),
    ];
    const second = [
      normalizeDriverHistoryItem({ rideId: 'ride_3', historyAtMs: 3000 }),
      normalizeDriverHistoryItem({ rideId: 'ride_1', historyAtMs: 1000 }),
    ];

    expect(appendDriverHistoryPages(first, second).map((item) => item.rideId)).toEqual([
      'ride_3', 'ride_2', 'ride_1',
    ]);
  });
});
