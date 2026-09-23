const { buildServiceAreaConfig } = require('../serviceAreaConfig');
const { resolveDispatchPolicy } = require('../../rides/serviceArea');
const C = require('../../rides/constants');

function identity() {
  return {
    serviceAreaId: 'HORIZONTE_CE_BR',
    municipalityCode: '2305233',
    cityName: 'Horizonte',
    stateCode: 'CE',
    countryCode: 'BR',
    timezone: 'America/Fortaleza',
    currency: 'BRL',
    locale: 'pt-BR',
    boundaryVersion: '2024.1',
    operationalPolygonVersion: '2024.1',
    coverageMode: 'municipality_boundary',
    pricingConfigId: 'horizonte-1.1.0',
    founderCounterId: 'HORIZONTE_CE_BR',
  };
}

const artifact = {
  geometry: {
    type: 'Polygon',
    coordinates: [[[-38.55, -4.15], [-38.45, -4.15], [-38.45, -4.05], [-38.55, -4.05], [-38.55, -4.15]]],
  },
};
const report = { checksum: 'abc123', bbox: [-38.55, -4.15, -38.45, -4.05] };

describe('Horizonte launch dispatch policy', () => {
  it('seeds a progressive bounded search with a tolerant freshness window', () => {
    const config = buildServiceAreaConfig(identity(), artifact, report, {});

    expect(config.dispatchMode).toBe('progressive_launch');
    expect(config.searchRadiusMeters).toBe(8_000);
    expect(config.maxCandidates).toBe(100);
    expect(config.offerTtlSeconds).toBe(C.OFFER_TTL_SECONDS);
    expect(config.offerTtlSeconds).toBe(60);
    expect(C.SEARCH_TTL_SECONDS).toBe(90);
    expect(C.LOCATION_MAX_AGE_MS).toBe(15 * 60 * 1000);
  });

  it('ignores a legacy narrow Firestore config until density mode is explicit', () => {
    const policy = resolveDispatchPolicy('HORIZONTE_CE_BR', {
      searchRadiusMeters: 5_000,
      maxCandidates: 25,
      offerTtlSeconds: 15,
    });

    expect(policy).toMatchObject({
      dispatchMode: 'progressive_launch',
      source: 'backend_progressive_fallback',
      searchRadiusMeters: 8_000,
      maxCandidates: 100,
      offerTtlSeconds: C.OFFER_TTL_SECONDS,
    });
  });

  it('allows a future explicit density-optimized policy without exceeding the safety cap', () => {
    const policy = resolveDispatchPolicy('HORIZONTE_CE_BR', {
      dispatchMode: 'density_optimized',
      searchRadiusMeters: 8_000,
      maxCandidates: 500,
      offerTtlSeconds: 20,
    });

    expect(policy).toMatchObject({
      dispatchMode: 'density_optimized',
      source: 'firestore_config',
      searchRadiusMeters: 8_000,
      maxCandidates: 100,
      offerTtlSeconds: 20,
    });
  });
});
