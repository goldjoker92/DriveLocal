const {
  CLOCK_SKEW_TOLERANCE_MS,
  PASSENGER_SIGNAL_LOST_AFTER_MS,
  ageLabel,
  driverRideTrackingPresentation,
  passengerTrackingPresentation,
  trackingPointAgeMs,
} = require('../rideLiveLocationPresentation');

const NOW = 1_800_000_000_000;
const STALE = 30_000;
const passenger = (extra) => passengerTrackingPresentation({
  rideStatus: 'assigned', hasDriverPoint: true, ageMs: 2_000, staleAfterMs: STALE, ...extra,
});

describe('driver ride tracking card', () => {
  it('separates what the app repairs by itself from what needs the driver', () => {
    expect(driverRideTrackingPresentation('active')).toMatchObject({ tone: 'active', actionKind: null });
    expect(driverRideTrackingPresentation('checking')).toMatchObject({ tone: 'checking', actionKind: null });
    for (const status of ['waiting_gps', 'service_not_started', 'error', 'no_ride_session']) {
      expect(driverRideTrackingPresentation(status)).toMatchObject({
        tone: 'reconnecting', actionKind: 'retry', actionTitle: 'Tentar agora',
      });
    }
    for (const status of ['background_required', 'services_disabled', 'foreground_denied']) {
      expect(driverRideTrackingPresentation(status)).toMatchObject({
        tone: 'action', actionKind: 'enable', actionTitle: 'Ativar localização da corrida',
      });
    }
  });

  it('keeps the exact permission guidance drivers already know', () => {
    expect(driverRideTrackingPresentation('background_required').message)
      .toBe('Autorize “Permitir o tempo todo” para manter a posição durante a corrida.');
    expect(driverRideTrackingPresentation('unknown_status').message)
      .toBe('Não foi possível iniciar a localização ao vivo.');
  });
});

describe('passenger ride point age', () => {
  it('reads the server timestamp first, like the freshness check', () => {
    const point = { updatedAt: { toMillis: () => NOW - 7_000 }, updatedAtMs: NOW - 99_000 };
    expect(trackingPointAgeMs(point, NOW)).toBe(7_000);
  });

  it('treats a phone clock slightly behind the server as a fresh point, not an old one', () => {
    expect(trackingPointAgeMs({ updatedAtMs: NOW + 40_000 }, NOW)).toBe(0);
    expect(trackingPointAgeMs({ updatedAtMs: NOW + CLOCK_SKEW_TOLERANCE_MS + 1 }, NOW)).toBeNull();
    expect(trackingPointAgeMs(null, NOW)).toBeNull();
  });

  it('labels ages in plain words', () => {
    expect(ageLabel(2_000)).toBe('agora');
    expect(ageLabel(42_000)).toBe('há 42s');
    expect(ageLabel(9 * 60_000)).toBe('há 9 min');
    expect(ageLabel(null)).toBe('sem atualização');
  });
});

describe('passenger map caption', () => {
  it('shows a fresh point as fresh', () => {
    expect(passenger()).toMatchObject({ tone: 'fresh', text: 'Posição atualizada agora.', dimDriver: false });
  });

  it('calls a short gap an update in progress, never a lost driver', () => {
    expect(passenger({ ageMs: 45_000 })).toMatchObject({
      tone: 'stale', text: 'Última posição há 45s. Atualizando…', dimDriver: false, offerMessage: false,
    });
  });

  it('reassures and offers a message when the driver is silent during the approach', () => {
    expect(passenger({ ageMs: 9 * 60_000 })).toEqual({
      tone: 'lost',
      text: 'Sem sinal do motorista há 9 min. A corrida continua confirmada.',
      dimDriver: true,
      offerMessage: true,
    });
    expect(passenger({ ageMs: PASSENGER_SIGNAL_LOST_AFTER_MS }).tone).toBe('lost');
  });

  it('never presents a driver waiting at the pickup as a lost signal', () => {
    expect(passenger({ rideStatus: 'driver_arrived', ageMs: 5 * 60_000 })).toMatchObject({
      tone: 'arrived', text: 'Motorista no local de embarque.', dimDriver: false,
    });
  });

  it('points to the passenger own dot during the ride', () => {
    expect(passenger({ rideStatus: 'in_progress', ageMs: 3 * 60_000, ownPositionVisible: true })).toMatchObject({
      tone: 'lost',
      text: 'Sem sinal do celular do motorista há 3 min. O ponto azul mostra onde você está.',
      dimDriver: true,
      offerMessage: false,
    });
    expect(passenger({ rideStatus: 'in_progress', ageMs: 3 * 60_000 }).text)
      .toBe('Sem sinal do celular do motorista há 3 min.');
  });

  it('blames the passenger connection, not the driver, when the passenger is offline', () => {
    expect(passenger({ passengerOffline: true, ageMs: 5 * 60_000 })).toMatchObject({
      tone: 'offline', dimDriver: true, offerMessage: false,
    });
    expect(passenger({ passengerOffline: true }).dimDriver).toBe(false);
  });

  it('waits honestly for the very first point', () => {
    expect(passenger({ hasDriverPoint: false, ageMs: null })).toMatchObject({
      tone: 'waiting', text: 'Aguardando a primeira posição do motorista…',
    });
  });

  it('treats a point with no usable age as lost', () => {
    expect(passenger({ ageMs: null }).tone).toBe('lost');
  });
});
