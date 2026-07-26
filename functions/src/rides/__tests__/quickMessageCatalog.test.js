const {
  QUICK_MESSAGES,
  QUICK_MESSAGE_HISTORY_LIMIT,
  QUICK_MESSAGE_RATE_LIMIT_MS,
  QUICK_MESSAGE_RETENTION_MS,
  isQuickMessageAllowed,
  quickMessagePresentation,
} = require('../quickMessageCatalog');

describe('secure ride quick message catalog', () => {
  it('keeps a closed actor-specific vocabulary', () => {
    expect(Object.keys(QUICK_MESSAGES)).toEqual([
      'driver_arriving',
      'driver_traffic_delay',
      'driver_at_pickup',
      'driver_cannot_stop_here',
      'passenger_waiting',
      'passenger_coming',
      'passenger_needs_minute',
      'passenger_cannot_find_vehicle',
    ]);
  });

  it('enforces sender role and ride phase', () => {
    expect(isQuickMessageAllowed('driver', 'assigned', 'driver_arriving')).toBe(true);
    expect(isQuickMessageAllowed('driver', 'driver_arrived', 'driver_arriving')).toBe(false);
    expect(isQuickMessageAllowed('passenger', 'assigned', 'passenger_waiting')).toBe(true);
    expect(isQuickMessageAllowed('passenger', 'driver_arrived', 'passenger_needs_minute')).toBe(true);
    expect(isQuickMessageAllowed('driver', 'driver_arrived', 'passenger_needs_minute')).toBe(false);
    expect(isQuickMessageAllowed('passenger', 'in_progress', 'passenger_waiting')).toBe(false);
    expect(isQuickMessageAllowed('passenger', 'assigned', 'free text')).toBe(false);
  });

  it('uses bounded history, rate and retention policies', () => {
    expect(QUICK_MESSAGE_HISTORY_LIMIT).toBe(6);
    expect(QUICK_MESSAGE_RATE_LIMIT_MS).toBe(5000);
    expect(QUICK_MESSAGE_RETENTION_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('resolves visible copy only from the server catalog', () => {
    expect(quickMessagePresentation('driver_at_pickup')).toEqual({
      title: 'Mensagem do motorista',
      body: 'Estou no local indicado.',
    });
    expect(quickMessagePresentation('passenger_needs_minute')).toEqual({
      title: 'Mensagem do passageiro',
      body: 'Preciso de mais um minuto.',
    });
    expect(quickMessagePresentation('unknown')).toEqual({
      title: 'Mensagem da corrida',
      body: 'Abra a DriveLocal para ver a atualização.',
    });
  });

  it('contains no contact channel or long numeric identifier', () => {
    for (const definition of Object.values(QUICK_MESSAGES)) {
      expect(definition.text).not.toMatch(/@|https?:\/\/|www\.|whatsapp|telefone|e-mail/i);
      expect(definition.text).not.toMatch(/\d{8,}/);
    }
  });
});
