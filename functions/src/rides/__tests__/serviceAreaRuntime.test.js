const crypto = require('crypto');
const { validateServiceArea } = require('../serviceArea');

const SERVICE_AREA_ID = 'HORIZONTE_CE_BR';
const geometry = {
  type: 'Polygon',
  coordinates: [[
    [-38.60, -4.20],
    [-38.40, -4.20],
    [-38.40, -4.00],
    [-38.60, -4.00],
    [-38.60, -4.20],
  ]],
};

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value.coordinates)).digest('hex');
}

function config(overrides = {}) {
  return {
    active: true,
    serviceAreaId: SERVICE_AREA_ID,
    municipalityCode: '2305233',
    boundaryVersion: 'test-boundary-v1',
    operationalPolygonVersion: 'test-boundary-v1',
    boundaryFormat: 'geojson-geometry-json-v1',
    boundaryGeoJson: JSON.stringify(geometry),
    boundaryChecksum: checksum(geometry),
    boundaryBoundingBox: [-38.60, -4.20, -38.40, -4.00],
    allowedVehicleTypes: ['moto', 'car'],
    offerTtlSeconds: 15,
    searchRadiusMeters: 5000,
    ...overrides,
  };
}

function dbWithConfig(value) {
  return {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({
          exists: true,
          data: () => value,
        })),
      })),
    })),
  };
}

describe('runtime service-area geofence', () => {
  it('loads the serialized seeded geometry inside the deployed callable', async () => {
    const result = await validateServiceArea({
      db: dbWithConfig(config()),
      serviceAreaId: SERVICE_AREA_ID,
      vehicleType: 'moto',
      pickup: { lat: -4.10, lng: -38.50 },
      destination: { lat: -4.08, lng: -38.48 },
    });

    expect(result.offerTtlSeconds).toBe(15);
    expect(result.searchRadiusMeters).toBe(5000);
    expect(result.config.boundaryChecksum).toBe(checksum(geometry));
  });

  it('rejects an endpoint outside the seeded polygon with the stable code', async () => {
    await expect(validateServiceArea({
      db: dbWithConfig(config()),
      serviceAreaId: SERVICE_AREA_ID,
      vehicleType: 'car',
      pickup: { lat: -4.10, lng: -38.50 },
      destination: { lat: -3.90, lng: -38.30 },
    })).rejects.toMatchObject({ code: 'OUT_OF_SERVICE_AREA' });
  });

  it('fails closed with CONFIGURATION_MISSING when the deployed config has no geometry', async () => {
    await expect(validateServiceArea({
      db: dbWithConfig(config({ boundaryGeoJson: null })),
      serviceAreaId: SERVICE_AREA_ID,
      vehicleType: 'moto',
      pickup: { lat: -4.10, lng: -38.50 },
      destination: { lat: -4.08, lng: -38.48 },
    })).rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' });
  });
});
