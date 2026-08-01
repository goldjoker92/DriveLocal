import { getCityPlacePack } from '../../constants/cityPlacePacks';
import { SERVICE_AREA_HORIZONTE_CE_BR } from '../../constants/serviceAreaIds';
import {
  MAX_PLACE_SUGGESTIONS,
  hasStrongLocalPlaceMatch,
  normalizePlaceSearchText,
  scoreCityPlace,
  searchCityPlacePack,
} from '../placeSearch';

describe('local city place search', () => {
  const pack = getCityPlacePack(SERVICE_AREA_HORIZONTE_CE_BR);

  it('normalizes accents, punctuation and spacing', () => {
    expect(normalizePlaceSearchText('  Cecília — Saúde / CE ')).toBe('cecilia saude ce');
  });

  it('finds important Horizonte places without an external provider', () => {
    expect(searchCityPlacePack(pack, 'prefeitura')[0]).toMatchObject({
      source: 'city_pack',
      localId: 'prefeitura-horizonte',
      hasCoordinates: false,
    });
    expect(searchCityPlacePack(pack, 'IFCE')[0].localId).toBe('ifce-campus-horizonte');
    expect(searchCityPlacePack(pack, 'hospital municipal')[0].localId).toBe('hospital-venancio');
  });

  it('tolerates accents and a small typing mistake', () => {
    expect(searchCityPlacePack(pack, 'secretaria saude')[0].localId)
      .toBe('secretaria-saude-horizonte');
    expect(searchCityPlacePack(pack, 'prefetura')[0].localId)
      .toBe('prefeitura-horizonte');
  });

  it('never returns more than five suggestions', () => {
    expect(searchCityPlacePack(pack, 'horizonte', {}, 99).length)
      .toBeLessThanOrEqual(MAX_PLACE_SUGGESTIONS);
  });

  it('uses personal frequency only as a bounded ranking boost', () => {
    const entry = pack.entries.find((item) => item.id === 'bairro-diadema');
    expect(scoreCityPlace(entry, 'diadema', 25)).toBeGreaterThan(scoreCityPlace(entry, 'diadema', 0));
  });

  it('detects a strong local answer before Google fallback', () => {
    expect(hasStrongLocalPlaceMatch(searchCityPlacePack(pack, 'centro'))).toBe(true);
    expect(hasStrongLocalPlaceMatch(searchCityPlacePack(pack, 'rua inexistente 987'))).toBe(false);
  });
});
