// @ts-check
// Safe projections returned by the callables. They deliberately exclude internal
// financial/provider fields and any counterparty PII.

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

// Winning-driver acceptance view (returned by acceptDriverOfferSecure). Includes
// the EXACT pickup so the driver can navigate; destination is connected in
// BLOCK 09+10.
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

module.exports = { safeRideView, safeAcceptanceView };
