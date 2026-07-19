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
  it('seeds a citywide bounded broadcast with a tolerant freshness window', () => {
    const config = buildServiceAreaConfig(identity(), artifact, report, {});

    expect(config.dispatchMode).toBe('citywide_launch');
    expect(config.searchRadiusMeters).toBe(50_000);
    expect(config.maxCandidates).toBe(100);
    expect(config.offerTtlSeconds).toBe(45);
    expect(C.LOCATION_MAX_AGE_MS).toBe(5 * 60 * 1000);
  });

  it('ignores a legacy narrow Firestore config until density mode is explicit', () => {
    const policy = resolveDispatchPolicy('HORIZONTE_CE_BR', {
      searchRadiusMeters: 5_000,
      maxCandidates: 25,
      offerTtlSeconds: 15,
    });

    expect(policy).toMatchObject({
      dispatchMode: 'citywide_launch',
      source: 'backend_launch_fallback',
      searchRadiusMeters: 50_000,
      maxCandidates: 100,
      offerTtlSeconds: 45,
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
