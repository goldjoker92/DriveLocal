// @ts-check
// calculateServerRideQuote — authoritative server quote. The routing provider
// supplies distance/duration and the backend pricing module supplies all money.
// Client-provided distance, duration, fare or commission are never authoritative.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { priceRide } = require('../pricing/pricing');

/**
 * @param {{routingAdapter:object, serviceAreaId:string, vehicleType:string, pickup:object, destination:object}} args
 * @returns {Promise<{routeDistanceMeters:number, routeDurationSeconds:number, estimatedFareCentavos:number, estimatedCommissionCentavos:number, minimumPlatformCommissionCentavos:number, pricingConfigVersion:string}>}
 */
async function calculateServerRideQuote({
  routingAdapter,
  serviceAreaId,
  vehicleType,
  pickup,
  destination,
}) {
  const route = await routingAdapter.computeRoute({
    origin: pickup,
    destination,
    vehicleType,
  });

  const priced = priceRide({
    serviceAreaId,
    vehicleType,
    distanceKm: route.distanceMeters / 1000,
    durationMin: route.durationSeconds / 60,
  });
  if (!priced.ok) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `pricing failed: ${priced.reason}`,
      safeMetadata: { field: 'vehicleType', reason: priced.reason },
    });
  }

  return {
    routeDistanceMeters: route.distanceMeters,
    routeDurationSeconds: route.durationSeconds,
    estimatedFareCentavos: priced.passengerFareCentavos,
    // Standard post-promotion estimate. Acceptance changes it to R$0 only when
    // the authenticated driver still owns the 60-day commission benefit.
    estimatedCommissionCentavos: priced.commissionCentavos,
    minimumPlatformCommissionCentavos:
      priced.minimumPlatformCommissionCentavos,
    pricingConfigVersion: priced.pricingConfigVersion,
  };
}

module.exports = { calculateServerRideQuote };