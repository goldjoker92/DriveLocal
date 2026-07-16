// @ts-check
// Canonical DriveLocal service-area identity. ONE source of truth for the
// Horizonte pilot, reused by the seed, environment validation and tests — never
// hardcoded inside UI screens or duplicated per-city with `if (city === ...)`.
//
// The architecture stays multi-city: future cities are added as new entries here
// plus their own seeded config document and founder counter. Horizonte V1 uses
// the official IBGE municipality boundary as its operational polygon.

// municipalityCode 2305233 is the official IBGE code for Horizonte/CE
// (verified against the IBGE malhas municipais API, which returned codarea
// "2305233"). boundaryVersion must match the committed GeoJSON artifact.
const HORIZONTE_CE_BR = Object.freeze({
  serviceAreaId: 'HORIZONTE_CE_BR',
  municipalityCode: '2305233',
  cityName: 'Horizonte',
  stateCode: 'CE',
  countryCode: 'BR',
  timezone: 'America/Fortaleza',
  currency: 'BRL',
  locale: 'pt-BR',
  boundaryVersion: '2024.1',
  operationalPolygonVersion: '2024.1', // V1: operational polygon === municipality boundary
  coverageMode: 'full_municipality',
  pricingConfigId: 'HORIZONTE_CE_BR',
  founderCounterId: 'HORIZONTE_CE_BR',
});

const SERVICE_AREAS = Object.freeze({ HORIZONTE_CE_BR });
const DEFAULT_SERVICE_AREA_ID = HORIZONTE_CE_BR.serviceAreaId;

/** Returns the canonical identity for a serviceAreaId, or null (fail closed). */
function getServiceAreaIdentity(serviceAreaId) {
  return SERVICE_AREAS[serviceAreaId] || null;
}

module.exports = { SERVICE_AREAS, HORIZONTE_CE_BR, DEFAULT_SERVICE_AREA_ID, getServiceAreaIdentity };
