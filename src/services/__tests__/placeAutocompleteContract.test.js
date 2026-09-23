const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('local-first passenger place autocomplete contract', () => {
  it('uses inline autocomplete for both ride endpoints without changing secure ride creation', () => {
    const request = source('src/app/(passenger)/request-ride.jsx');
    const component = source('src/components/AddressAutocompleteInput.jsx');

    expect((request.match(/<AddressAutocompleteInput/g) || [])).toHaveLength(2);
    expect(request).toContain('destinationLat');
    expect(request).toContain('destinationLng');
    expect(request).toContain('knownLat: destinationLat');
    expect(request).toContain('knownLng: destinationLng');
    expect(request).toContain('resolveAddressToCoords(geocoderQuery(text))');
    expect(request).toContain("pathname: '/confirm-price'");
    expect(request).toContain('resolveAddressToCoords');
    expect(component).toContain('SEARCH_DEBOUNCE_MS = 350');
    expect(component).toContain('Resultados externos fornecidos pelo Google Maps');
  });

  it('keeps a five-result City Pack first and uses Google only as fallback', () => {
    const pack = source('src/constants/cityPlacePacks.js');
    const search = source('src/utils/placeSearch.js');
    const service = source('src/services/placeAutocompleteService.js');

    expect(pack).toContain('HORIZONTE_CE_BR');
    expect(pack).toContain('Prefeitura Municipal de Horizonte');
    expect(pack).toContain('Hospital e Maternidade Venâncio Raimundo de Sousa');
    expect(pack).toContain('IFCE Campus Horizonte');
    expect(pack).not.toContain('lat:');
    expect(pack).not.toContain('lng:');
    expect(search).toContain('MAX_PLACE_SUGGESTIONS = 5');
    expect(search).toContain("normalize('NFKD')");
    expect(search).toContain('boundedLevenshtein');
    expect(search).toContain('Math.log2');
    expect(service).toContain('hasStrongLocalPlaceMatch(localItems)');
    expect(service).toContain('AsyncStorage');
    expect(service).toContain("httpsCallable(functions, 'searchPlaceSuggestionsSecure')");
    expect(service).toContain("httpsCallable(functions, 'resolvePlaceSuggestionSecure')");
  });

  it('keeps the provider key server-only and rechecks the municipality polygon', () => {
    const clientService = source('src/services/placeAutocompleteService.js');
    const adapter = source('functions/src/places/googlePlaces.js');
    const callables = source('functions/src/places/callables.js');
    const index = source('functions/src/index.js');

    expect(clientService).not.toContain('PLACES_PROVIDER_API_KEY');
    expect(clientService).not.toContain('places.googleapis.com');
    expect(adapter).toContain('X-Goog-Api-Key');
    expect(adapter).toContain('locationRestriction');
    expect(callables).toContain("defineSecret('PLACES_PROVIDER_API_KEY')");
    expect(callables).toContain('loadOperationalPolygon');
    expect(callables).toContain('pointInServiceArea');
    expect(callables).toContain('placeProviderMetrics');
    expect(callables).toContain('placePromotionCandidates');
    expect(index).toContain('exports.searchPlaceSuggestionsSecure');
    expect(index).toContain('exports.resolvePlaceSuggestionSecure');
    expect(callables).not.toContain('EXPO_PUBLIC_');
  });
});
