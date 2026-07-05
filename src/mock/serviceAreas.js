// Mock serviceAreas for Step 1 UI only.
// The AUTHORITATIVE seed lives in seed/serviceAreas/HORIZONTE_CE_BR.json
// (created in the backend pass) and, in production, in Firestore at
// serviceAreas/{id}. Cloud Functions must read Firestore, never this file.

import { SERVICE_AREA_HORIZONTE_CE_BR } from '../constants/serviceAreaIds';
import { VEHICLE_MOTO, VEHICLE_CAR } from '../constants/vehicleTypes';

export const mockServiceAreas = [
  {
    id: SERVICE_AREA_HORIZONTE_CE_BR,
    name: 'Horizonte / CE',
    active: true,
    // City/state used by the SIMPLE service-area check (utils/serviceArea.js).
    // stateNames covers both the abbreviation and the full name a reverse
    // geocode may return ("CE" or "Ceará"). Not a polygon (deferred).
    city: 'Horizonte',
    state: 'CE',
    stateNames: ['CE', 'Ceará'],
    country: 'BR',
    center: { lat: -4.0992, lng: -38.4958 },
    features: {
      vehicleTypes: [VEHICLE_MOTO, VEHICLE_CAR],
    },
    pricing: {
      lowWalletThresholdCents: 300,
      minTopupCents: 1000,
      commissionRate: 0.15,
      baseFareCents: 500,
      perKmCents: 150,
    },
  },
];
