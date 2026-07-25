// @ts-check

const {
  haversineMeters,
  analyzeLocationChange,
  MAX_PLAUSIBLE_SPEED_KPH,
} = require('../risk/locationRisk');

describe('driver location risk detection', () => {
  it('computes a realistic distance without retaining coordinates', () => {
    const meters = haversineMeters(
      { lat: -4.0995, lng: -38.5006 },
      { lat: -4.1049, lng: -38.4496 }
    );
    expect(meters).toBeGreaterThan(5000);
    expect(meters).toBeLessThan(6000);
  });

  it('flags an impossible multi-kilometre jump in seconds', () => {
    const result = analyzeLocationChange({
      location: { lat: -4.0995, lng: -38.5006 },
      locationUpdatedAtMs: 1000,
    }, {
      location: { lat: -4.1049, lng: -38.4496 },
      locationUpdatedAtMs: 11000,
      locationSpeedMps: 0,
    });
    expect(result.impossible).toBe(true);
    expect(result.calculatedSpeedKph).toBeGreaterThan(MAX_PLAUSIBLE_SPEED_KPH);
    expect(result).not.toHaveProperty('from');
    expect(result).not.toHaveProperty('to');
  });

  it('accepts an ordinary short movement', () => {
    const result = analyzeLocationChange({
      location: { lat: -4.1000, lng: -38.5000 },
      locationUpdatedAtMs: 1000,
    }, {
      location: { lat: -4.1005, lng: -38.5000 },
      locationUpdatedAtMs: 11000,
      locationSpeedMps: 5.5,
    });
    expect(result.impossible).toBe(false);
  });

  it('ignores invalid or out-of-order timestamps', () => {
    expect(analyzeLocationChange({
      location: { lat: -4.1, lng: -38.5 },
      locationUpdatedAtMs: 2000,
    }, {
      location: { lat: -4.2, lng: -38.4 },
      locationUpdatedAtMs: 1000,
    })).toBeNull();
  });
});
