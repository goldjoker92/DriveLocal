// @ts-check

const {
  sanitizeMetadata,
  eventId,
  caseId,
} = require('../risk/riskEngine');

describe('privacy-safe risk engine contracts', () => {
  it('keeps only explicitly approved aggregate metadata', () => {
    expect(sanitizeMetadata({
      rideStatus: 'disputed',
      holdCentavos: 150,
      count: 3,
      cpf: '12345678909',
      pixKey: 'secret@example.com',
      latitude: -4.1,
      privatePath: 'drivers/d1/document.jpg',
    })).toEqual({
      rideStatus: 'disputed',
      holdCentavos: 150,
      count: 3,
    });
  });

  it('generates deterministic event ids for retries', () => {
    const args = {
      actorType: 'driver',
      actorId: 'd1',
      reasonCode: 'PAYMENT_DISPUTE_OPENED',
      sourceType: 'ride',
      sourceId: 'r1',
      eventKey: 'payment_dispute_non_receipt',
    };
    expect(eventId(args)).toBe(eventId(args));
    expect(eventId(args)).toHaveLength(32);
    expect(eventId({ ...args, sourceId: 'r2' })).not.toBe(eventId(args));
  });

  it('separates cases by actor, reason and source', () => {
    const base = {
      actorType: 'passenger',
      actorId: 'p1',
      reasonCode: 'REPEATED_CANCELLATIONS',
      sourceType: 'risk_window',
      sourceId: 'cancellations_100',
    };
    expect(caseId(base)).toMatch(/^case_[a-f0-9]{32}$/);
    expect(caseId({ ...base, actorId: 'p2' })).not.toBe(caseId(base));
    expect(caseId({ ...base, reasonCode: 'PASSENGER_NO_SHOW' })).not.toBe(caseId(base));
  });
});
