const { buildServiceAreaConfig } = require('../serviceAreaConfig');
const C = require('../../rides/constants');

describe('Horizonte launch dispatch policy', () => {
  it('seeds a citywide bounded broadcast with a tolerant freshness window', () => {
    const identity = {
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
    const artifact = {
      geometry: {
        type: 'Polygon',
        coordinates: [[[-38.55, -4.15], [-38.45, -4.15], [-38.45, -4.05], [-38.55, -4.05], [-38.55, -4.15]]],
      },
    };
    const report = { checksum: 'abc123', bbox: [-38.55, -4.15, -38.45, -4.05] };

    const config = buildServiceAreaConfig(identity, artifact, report, {});

    expect(config.dispatchMode).toBe('citywide_launch');
    expect(config.searchRadiusMeters).toBe(50_000);
    expect(config.maxCandidates).toBe(100);
    expect(config.offerTtlSeconds).toBe(45);
    expect(C.LOCATION_MAX_AGE_MS).toBe(5 * 60 * 1000);
  });
});
