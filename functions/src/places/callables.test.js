const crypto = require('crypto');
const { ERROR_CODES } = require('../errors/appError');
const {
  loadAuthorizedCityConfig,
  resolvePlace,
  searchPlaces,
} = require('./callables');

function cityConfig() {
  const coordinates = [[
    [-38.8, -4.3],
    [-38.2, -4.3],
    [-38.2, -3.7],
    [-38.8, -3.7],
    [-38.8, -4.3],
  ]];
  return {
    active: true,
    serviceAreaId: 'HORIZONTE_CE_BR',
    municipalityCode: '2305233',
    boundaryVersion: 'test-v1',
    boundaryFormat: 'geojson-geometry-json-v1',
    boundaryGeoJson: JSON.stringify({ type: 'Polygon', coordinates }),
    boundaryChecksum: crypto.createHash('sha256').update(JSON.stringify(coordinates)).digest('hex'),
    boundaryBoundingBox: [-38.8, -4.3, -38.2, -3.7],
  };
}

function fakeDb({ passenger = { serviceAreaId: 'HORIZONTE_CE_BR' }, config = cityConfig() } = {}) {
  const writes = [];
  return {
    writes,
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              if (name === 'passengers') return { exists: Boolean(passenger), data: () => passenger };
              if (name === 'cityPublicConfig') return { exists: Boolean(config), data: () => config };
              return { exists: false, data: () => ({}) };
            },
            async set(data, options) {
              writes.push({ collection: name, id, data, options });
            },
          };
        },
      };
    },
  };
}

const context = { traceId: 'trace_places_test', environment: 'test' };

describe('secure place autocomplete callables', () => {
  test('rejects an anonymous search before the provider is called', async () => {
    const db = fakeDb();
    const adapter = { autocomplete: jest.fn() };
    await expect(searchPlaces({
      db,
      request: { auth: null, data: { query: 'hospital', serviceAreaId: 'HORIZONTE_CE_BR' } },
      context,
      adapter,
    })).rejects.toMatchObject({ code: ERROR_CODES.UNAUTHENTICATED });
    expect(adapter.autocomplete).not.toHaveBeenCalled();
  });

  test('prevents a passenger from searching another service area', async () => {
    const db = fakeDb({ passenger: { serviceAreaId: 'OTHER_CITY' } });
    await expect(loadAuthorizedCityConfig(
      db,
      { auth: { uid: 'passenger_1' } },
      'HORIZONTE_CE_BR'
    )).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  test('uses the configured city box and stores only aggregate search metrics', async () => {
    const db = fakeDb();
    const adapter = {
      autocomplete: jest.fn().mockResolvedValue([
        { id: 'google_places:p1', placeId: 'p1', label: 'Hospital', secondaryLabel: 'Horizonte' },
      ]),
    };
    const result = await searchPlaces({
      db,
      request: {
        auth: { uid: 'passenger_1' },
        data: {
          query: 'hospital',
          serviceAreaId: 'HORIZONTE_CE_BR',
          sessionToken: 'session_1',
          limit: 5,
        },
      },
      context,
      adapter,
    });

    expect(result.items).toHaveLength(1);
    expect(adapter.autocomplete).toHaveBeenCalledWith(expect.objectContaining({
      query: 'hospital',
      boundingBox: [-38.8, -4.3, -38.2, -3.7],
      limit: 5,
    }));
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].collection).toBe('placeProviderMetrics');
    expect(JSON.stringify(db.writes[0].data)).not.toContain('hospital');
    expect(JSON.stringify(db.writes[0].data)).not.toContain('passenger_1');
  });

  test('rejects a selected provider place outside the municipality polygon', async () => {
    const db = fakeDb();
    const adapter = {
      details: jest.fn().mockResolvedValue({
        label: 'Fora de Horizonte',
        lat: -5.0,
        lng: -39.0,
      }),
    };
    await expect(resolvePlace({
      db,
      request: {
        auth: { uid: 'passenger_1' },
        data: { placeId: 'place_outside', serviceAreaId: 'HORIZONTE_CE_BR' },
      },
      context,
      adapter,
    })).rejects.toMatchObject({ code: ERROR_CODES.OUT_OF_SERVICE_AREA });
    expect(db.writes).toHaveLength(0);
  });

  test('returns an inside coordinate and stores no provider label or coordinate', async () => {
    const db = fakeDb();
    const adapter = {
      details: jest.fn().mockResolvedValue({
        label: 'Centro, Horizonte - CE, Brasil',
        lat: -4.0,
        lng: -38.5,
      }),
    };
    await expect(resolvePlace({
      db,
      request: {
        auth: { uid: 'passenger_1' },
        data: { placeId: 'place_inside', serviceAreaId: 'HORIZONTE_CE_BR' },
      },
      context,
      adapter,
    })).resolves.toMatchObject({
      status: 'ok',
      label: 'Centro, Horizonte - CE, Brasil',
      lat: -4.0,
      lng: -38.5,
    });

    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].collection).toBe('placePromotionCandidates');
    expect(db.writes[0].data.placeId).toBe('place_inside');
    expect(db.writes[0].data).not.toHaveProperty('label');
    expect(db.writes[0].data).not.toHaveProperty('lat');
    expect(db.writes[0].data).not.toHaveProperty('lng');
  });
});
