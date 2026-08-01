// Multi-city local autocomplete packs. Entries are deliberately text-first: the
// existing real geocoder resolves coordinates and the secure ride backend keeps
// the municipality polygon authoritative. Never add guessed coordinates here.

import { ACTIVE_SERVICE_AREA_ID, SERVICE_AREA_HORIZONTE_CE_BR } from './serviceAreaIds';

export const CITY_PLACE_PACK_VERSION = 'city-place-pack-v1';

const HORIZONTE_PLACES = Object.freeze([
  {
    id: 'prefeitura-horizonte',
    category: 'administracao',
    label: 'Prefeitura Municipal de Horizonte',
    secondaryLabel: 'Av. Presidente Castelo Branco, 5100 · Centro',
    queryText: 'Prefeitura Municipal de Horizonte, Avenida Presidente Castelo Branco, 5100, Centro, Horizonte, Ceará, Brasil',
    aliases: ['prefeitura', 'prefeitura horizonte', 'paço municipal', 'castelo branco 5100'],
    priority: 100,
  },
  {
    id: 'secretaria-saude-horizonte',
    category: 'saude',
    label: 'Secretaria Municipal de Saúde',
    secondaryLabel: 'Av. Presidente Castelo Branco, 3600 · Centro',
    queryText: 'Secretaria Municipal de Saúde de Horizonte, Avenida Presidente Castelo Branco, 3600, Centro, Horizonte, Ceará, Brasil',
    aliases: ['secretaria de saude', 'saude horizonte', 'sms horizonte', 'castelo branco 3600'],
    priority: 94,
  },
  {
    id: 'hospital-venancio',
    category: 'saude',
    label: 'Hospital e Maternidade Venâncio Raimundo de Sousa',
    secondaryLabel: 'Rua Luiza Noronha · Zumbi',
    queryText: 'Hospital e Maternidade Venâncio Raimundo de Sousa, Rua Luiza Noronha, Zumbi, Horizonte, Ceará, Brasil',
    aliases: ['hospital municipal', 'hospital venancio', 'maternidade', 'venancio raimundo'],
    priority: 98,
  },
  {
    id: 'ifce-campus-horizonte',
    category: 'educacao',
    label: 'IFCE Campus Horizonte',
    secondaryLabel: 'Rua Francisca Cecília, s/n · Planalto Horizonte',
    queryText: 'IFCE Campus Horizonte, Rua Francisca Cecília, sem número, Planalto Horizonte, Horizonte, Ceará, Brasil',
    aliases: ['ifce', 'instituto federal', 'campus horizonte', 'faculdade federal'],
    priority: 96,
  },
  {
    id: 'br-116-horizonte',
    category: 'transporte',
    label: 'BR-116 — acesso a Horizonte',
    secondaryLabel: 'Rodovia BR-116 · Horizonte / CE',
    queryText: 'BR-116, Horizonte, Ceará, Brasil',
    aliases: ['br 116', 'rodovia', 'entrada de horizonte', 'acesso horizonte'],
    priority: 74,
  },
  {
    id: 'comercio-centro-horizonte',
    category: 'comercio',
    label: 'Comércio do Centro de Horizonte',
    secondaryLabel: 'Av. Presidente Castelo Branco · Centro',
    queryText: 'Avenida Presidente Castelo Branco, Centro, Horizonte, Ceará, Brasil',
    aliases: ['comercio', 'lojas', 'bancos', 'centro comercial', 'compras no centro'],
    priority: 82,
  },
  {
    id: 'bairro-centro',
    category: 'bairro',
    label: 'Centro de Horizonte',
    secondaryLabel: 'Bairro · Horizonte / CE',
    queryText: 'Centro, Horizonte, Ceará, Brasil',
    aliases: ['centro', 'centro horizonte'],
    priority: 90,
  },
  {
    id: 'bairro-planalto-horizonte',
    category: 'bairro',
    label: 'Planalto Horizonte',
    secondaryLabel: 'Bairro · Horizonte / CE',
    queryText: 'Planalto Horizonte, Horizonte, Ceará, Brasil',
    aliases: ['planalto', 'planalto horizonte'],
    priority: 84,
  },
  {
    id: 'bairro-zumbi',
    category: 'bairro',
    label: 'Zumbi',
    secondaryLabel: 'Bairro · Horizonte / CE',
    queryText: 'Zumbi, Horizonte, Ceará, Brasil',
    aliases: ['zumbi', 'bairro zumbi'],
    priority: 78,
  },
  {
    id: 'bairro-buenos-aires-i',
    category: 'bairro',
    label: 'Buenos Aires I',
    secondaryLabel: 'Bairro · Horizonte / CE',
    queryText: 'Buenos Aires I, Horizonte, Ceará, Brasil',
    aliases: ['buenos aires', 'buenos aires 1', 'buenos'],
    priority: 76,
  },
  {
    id: 'bairro-diadema',
    category: 'bairro',
    label: 'Diadema',
    secondaryLabel: 'Bairro · Horizonte / CE',
    queryText: 'Diadema, Horizonte, Ceará, Brasil',
    aliases: ['diadema', 'bairro diadema'],
    priority: 76,
  },
  {
    id: 'distrito-aningas',
    category: 'bairro',
    label: 'Distrito de Aningas',
    secondaryLabel: 'Horizonte / CE',
    queryText: 'Aningas, Horizonte, Ceará, Brasil',
    aliases: ['aningas', 'distrito aningas'],
    priority: 72,
  },
  {
    id: 'distrito-dourado',
    category: 'bairro',
    label: 'Distrito de Dourado',
    secondaryLabel: 'Horizonte / CE',
    queryText: 'Dourado, Horizonte, Ceará, Brasil',
    aliases: ['dourado', 'distrito dourado'],
    priority: 72,
  },
  {
    id: 'distrito-queimadas',
    category: 'bairro',
    label: 'Distrito de Queimadas',
    secondaryLabel: 'Horizonte / CE',
    queryText: 'Queimadas, Horizonte, Ceará, Brasil',
    aliases: ['queimadas', 'distrito queimadas'],
    priority: 72,
  },
]);

export const CITY_PLACE_PACKS = Object.freeze({
  [SERVICE_AREA_HORIZONTE_CE_BR]: Object.freeze({
    serviceAreaId: SERVICE_AREA_HORIZONTE_CE_BR,
    cityLabel: 'Horizonte / CE',
    countryCode: 'br',
    languageCode: 'pt-BR',
    entries: HORIZONTE_PLACES,
  }),
});

export function getCityPlacePack(serviceAreaId = ACTIVE_SERVICE_AREA_ID) {
  return CITY_PLACE_PACKS[serviceAreaId] || null;
}
