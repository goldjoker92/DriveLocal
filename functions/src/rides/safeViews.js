// @ts-check
// Safe projections returned by the callables. They deliberately exclude internal
// financial/provider fields and any counterparty PII.

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

// Winning-driver acceptance view (returned by acceptDriverOfferSecure). Includes
// the exact pickup so the driver can navigate, the full fare paid directly by Pix,
// and only the safe 0/12/15 commission percentage. The exact wallet hold remains
// server/ledger/admin-only.
function safeAcceptanceView(rideId, ride, holdCentavos) {
  return {
    rideId,
    status: ride.status,
    vehicleType: ride.vehicleType,
    estimatedFareCentavos: ride.estimatedFareCentavos,
    commissionDisplayBps: safeCommissionDisplayBps(ride, holdCentavos),
    pickup: {
      lat: ride.pickup.lat,
      lng: ride.pickup.lng,
      label: ride.pickup.label || null,
    },
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
  safeCommissionDisplayBps,
  safeDriverLifecycleView,
};