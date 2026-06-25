// Service area identifiers.
// MVP 0.1 only activates HORIZONTE_CE_BR.
// To add another city, add a new constant here AND add a serviceAreas/{id}
// document in Firestore. Do NOT hardcode the city in business logic.

export const SERVICE_AREA_HORIZONTE_CE_BR = 'HORIZONTE_CE_BR';

// The serviceArea that MVP 0.1 considers active by default.
// In production this should come from the user's profile or location.
export const ACTIVE_SERVICE_AREA_ID = SERVICE_AREA_HORIZONTE_CE_BR;
