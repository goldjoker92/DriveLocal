const {
  createGoogleRoutesAdapter,
  COMPUTE_ROUTES_URL,
} = require('../routing/googleRoutes');

function okResponse(payload) {
  return {
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

describe('Google Routes adapter contract', () => {
  it.each([
    ['car', 'DRIVE'],
    ['moto', 'TWO_WHEELER'],
  ])('sends a traffic-aware %s request with the minimal field mask', async (vehicleType, travelMode) => {
    let captured = null;
    const adapter = createGoogleRoutesAdapter({
      apiKey: 'test-key-not-secret',
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return okResponse({ routes: [{ distanceMeters: 4321, duration: '765s' }] });
      },
    });

    const result = await adapter.computeRoute({
      origin: { lat: -4.0995358, lng: -38.5006227 },
      destination: { lat: -4.10497, lng: -38.44969 },
      vehicleType,
    });

    expect(result).toEqual({ distanceMeters: 4321, durationSeconds: 765 });
    expect(captured.url).toBe(COMPUTE_ROUTES_URL);
    expect(captured.options.method).toBe('POST');
    expect(captured.options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': 'test-key-not-secret',
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
    });
    expect(JSON.parse(captured.options.body)).toEqual({
      origin: { location: { latLng: { latitude: -4.0995358, longitude: -38.5006227 } } },
      destination: { location: { latLng: { latitude: -4.10497, longitude: -38.44969 } } },
      travelMode,
      routingPreference: 'TRAFFIC_AWARE',
    });
  });

  it('fails closed on rejected credentials, empty routes and invalid vehicle types', async () => {
    const denied = createGoogleRoutesAdapter({
      apiKey: 'test',
      fetchImpl: async () => ({ status: 403, async text() { return ''; } }),
    });
    await expect(denied.computeRoute({ origin: { lat: 0, lng: 0 }, destination: { lat: 1, lng: 1 }, vehicleType: 'car' }))
      .rejects.toMatchObject({ code: 'CONFIGURATION_MISSING' });

    const empty = createGoogleRoutesAdapter({
      apiKey: 'test',
      fetchImpl: async () => okResponse({ routes: [] }),
    });
    await expect(empty.computeRoute({ origin: { lat: 0, lng: 0 }, destination: { lat: 1, lng: 1 }, vehicleType: 'moto' }))
      .rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    await expect(empty.computeRoute({ origin: { lat: 0, lng: 0 }, destination: { lat: 1, lng: 1 }, vehicleType: 'plane' }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
