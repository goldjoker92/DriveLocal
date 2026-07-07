// Ride REQUEST lifecycle (Iteration 3A).
// A rideRequest is created by a passenger BEFORE any dispatch/matching exists,
// so it starts at "pending". Later iterations (dispatch) will move a request
// into the ride lifecycle defined in constants/rideStatuses.js.
// Use these constants everywhere — never raw strings.

export const RIDE_REQUEST_PENDING = 'pending';

// PricingV1 bridge: a minimal accepted -> completed lifecycle on the SAME
// rideRequests document (no separate rides collection). This is NOT full
// dispatch/matching — just enough to persist driverId and settle commission.
export const RIDE_REQUEST_ACCEPTED = 'accepted';
export const RIDE_REQUEST_COMPLETED = 'completed';

// Reserved for later iterations (documented, NOT used in 3A):
export const RIDE_REQUEST_CANCELLED = 'cancelled_by_passenger';
export const RIDE_REQUEST_EXPIRED = 'expired';

export const RIDE_REQUEST_STATUSES = [
  RIDE_REQUEST_PENDING,
  RIDE_REQUEST_ACCEPTED,
  RIDE_REQUEST_COMPLETED,
  RIDE_REQUEST_CANCELLED,
  RIDE_REQUEST_EXPIRED,
];
