const {
  AUTOCOMPLETE_URL,
  DETAILS_URL,
  autocompleteItems,
  createGooglePlacesAdapter,
  validBoundingBox,
} = require('./googlePlaces');

describe('Google Places server adapter', () => {
  test('validates the service-area bounding rectangle', () => {
    expect(validBoundingBox([-38.8, -4.2, -38.3, -3.8])).toEqual({
      minLng: -38.8,
      minLat: -4.2,
      maxLng: -38.3,
      maxLat: -3.8,
    });
    expect(validBoundingBox([-38.3, -3.8, -38.8, -4.2])).toBeNull();
  });

  test('sanitizes and caps autocomplete predictions', () => {
    const items = autocompleteItems({
      suggestions: Array.from({ length: 7 }, (_, index) => ({
        placePrediction: {
          placeId: `place_${index}`,
          text: { text: `Lugar ${index}, Horizonte` },
          structuredFormat: {
            mainText: { text: `Lugar ${index}` },
            secondaryText: { text: 'Horizonte, CE' },
          },
        },
      })),
    }, 5);
    expect(items).toHaveLength(5);
    expect(items[0]).toEqual({
      id: 'google_places:place_0',
      placeId: 'place_0',
      label: 'Lugar 0',
      secondaryLabel: 'Horizonte, CE',
    });
  });

  test('sends autocomplete with city restriction and a narrow field mask', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [] }),
    });
    const adapter = createGooglePlacesAdapter({ apiKey: 'server-key', fetchImpl });
    await adapter.autocomplete({
      query: 'hospital',
      boundingBox: [-38.8, -4.2, -38.3, -3.8],
      sessionToken: 'session_1',
      limit: 5,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(AUTOCOMPLETE_URL);
    expect(options.headers['X-Goog-Api-Key']).toBe('server-key');
    expect(options.headers['X-Goog-FieldMask']).not.toContain('location');
    expect(JSON.parse(options.body)).toMatchObject({
      input: 'hospital',
      includedRegionCodes: ['br'],
      locationRestriction: {
        rectangle: {
          low: { latitude: -4.2, longitude: -38.8 },
          high: { latitude: -3.8, longitude: -38.3 },
        },
      },
      sessionToken: 'session_1',
    });
  });

  test('requests coordinates only after a place is selected', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'place_1',
        formattedAddress: 'Centro, Horizonte - CE, Brasil',
        location: { latitude: -4.1, longitude: -38.5 },
      }),
    });
    const adapter = createGooglePlacesAdapter({ apiKey: 'server-key', fetchImpl });
    await expect(adapter.details({ placeId: 'place_1', sessionToken: 'session_1' }))
      .resolves.toEqual({
        label: 'Centro, Horizonte - CE, Brasil',
        lat: -4.1,
        lng: -38.5,
      });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain(`${DETAILS_URL}/place_1`);
    expect(url).toContain('sessionToken=session_1');
    expect(options.headers['X-Goog-FieldMask']).toBe('id,formattedAddress,location');
  });

  test('fails closed when the secret is missing', () => {
    expect(() => createGooglePlacesAdapter({ apiKey: '' })).toThrow('CONFIGURATION_MISSING');
  });
});
