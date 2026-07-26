// @ts-check
// Projections used at the ride callable boundary. Core handlers may retain exact
// financial values for server-side tests, ledger and audit; public driver views
// strip them before the response leaves Cloud Functions.

const DRIVER_COMMISSION_DISPLAY_BPS = new Set([0, 1200, 1500]);

// Passenger-facing ride view (returned by createRideRequestSecure). The passenger
// also listens to their own rideRequests/{rideId} for live status.
function safeRideView(rideId, ride) {
  return {
    rideId,
    status: ride.status != null ? ride.status : null,
    serviceAreaId: ride.serviceAreaId != null ? ride.serviceAreaId : null,
    vehicleType: ride.vehicleType != null ? ride.vehicleType : null,
    estimatedFareCentavos: ride.estimatedFareCentavos != null ? ride.estimatedFareCentavos : null,
    routeDistanceMeters: ride.routeDistanceMeters != null ? ride.routeDistanceMeters : null,
    routeDurationSeconds: ride.routeDurationSeconds != null ? ride.routeDurationSeconds : null,
    acceptedDriverId: ride.acceptedDriverId != null ? ride.acceptedDriverId : null,
    reasonCode: ride.reasonCode != null ? ride.reasonCode : null,
  };
}

// Convert an internal exact hold/capture into the only driver-facing commission
// values allowed by product policy. The centavo amount is intentionally consumed
// here and never returned to the driver application.
function safeCommissionDisplayBps(ride, exactCommissionCentavos) {
  if (!(Number(exactCommissionCentavos) > 0)) return 0;

  const frozenBps = Number(ride?.commercialPolicySnapshot?.commissionBpsAtAcceptance);
  if (DRIVER_COMMISSION_DISPLAY_BPS.has(frozenBps) && frozenBps > 0) return frozenBps;

  return ride?.vehicleType === 'moto' ? 1200 : 1500;
}

// Internal acceptance result used by backend integration tests and audit flows.
// It intentionally keeps the exact hold inside the Functions process. The callable
// binding must pass this result through safeDriverAcceptanceView before returning.
function safeAcceptanceView(rideId, ride, holdCentavos) {
  return {
    rideId,
    status: ride.status,
    vehicleType: ride.vehicleType,
    estimatedFareCentavos: ride.estimatedFareCentavos,
    commissionHoldCentavos: holdCentavos,
    pickup: {
      lat: ride.pickup.lat,
      lng: ride.pickup.lng,
      label: ride.pickup.label || null,
    },
  };
}

function safeDriverAcceptanceView(result = {}) {
  return {
    rideId: result.rideId != null ? result.rideId : null,
    status: result.status != null ? result.status : null,
    vehicleType: result.vehicleType != null ? result.vehicleType : null,
    estimatedFareCentavos: result.estimatedFareCentavos != null
      ? result.estimatedFareCentavos
      : null,
    commissionDisplayBps: safeCommissionDisplayBps(result, result.commissionHoldCentavos),
    pickup: result.pickup || null,
  };
}

// Driver lifecycle callables return only fields needed to update navigation and
// feedback. Exact captured/released commission values stay in the ride, ledger,
// audit logs and admin tools.
function safeDriverLifecycleView(result = {}) {
  return {
    rideId: result.rideId != null ? result.rideId : null,
    status: result.status != null ? result.status : null,
  };
}

module.exports = {
  safeRideView,
  safeAcceptanceView,
  safeDriverAcceptanceView,
  safeCommissionDisplayBps,
  safeDriverLifecycleView,
};