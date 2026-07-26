import {
  QUICK_MESSAGE_HISTORY_LIMIT,
  RIDE_QUICK_MESSAGES,
  quickMessageOptions,
  quickMessageSenderLabel,
  quickMessageText,
} from '../rideQuickMessages';

describe('mobile ride quick messages', () => {
  it('mirrors the eight server-catalogued codes', () => {
    expect(Object.keys(RIDE_QUICK_MESSAGES)).toEqual([
      'driver_arriving',
      'driver_traffic_delay',
      'driver_at_pickup',
      'driver_cannot_stop_here',
      'passenger_waiting',
      'passenger_coming',
      'passenger_needs_minute',
      'passenger_cannot_find_vehicle',
    ]);
    expect(QUICK_MESSAGE_HISTORY_LIMIT).toBe(6);
  });

  it('returns only options valid for the actor and phase', () => {
    expect(quickMessageOptions('driver', 'assigned').map((item) => item.code)).toEqual([
      'driver_arriving',
      'driver_traffic_delay',
    ]);
    expect(quickMessageOptions('driver', 'driver_arrived').map((item) => item.code)).toEqual([
      'driver_at_pickup',
      'driver_cannot_stop_here',
    ]);
    expect(quickMessageOptions('passenger', 'assigned').map((item) => item.code)).toEqual([
      'passenger_waiting',
    ]);
    expect(quickMessageOptions('passenger', 'in_progress')).toEqual([]);
  });

  it('uses generic copy for an unknown historical code', () => {
    expect(quickMessageText('driver_at_pickup')).toBe('Estou no local indicado.');
    expect(quickMessageText('unknown')).toBe('Atualização da corrida.');
    expect(quickMessageSenderLabel('driver')).toBe('Motorista');
    expect(quickMessageSenderLabel('passenger')).toBe('Passageiro');
  });
});
