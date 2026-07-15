// @ts-check
// calculateServerRideQuote — the authoritative server quote. It measures the
// route with the real routing provider (fail-closed) and prices it with the
// backend BLOCK 01 pricing model. Client distance/duration/fare are never used.

const { AppError, ERROR_CODES } = require('../errors/appError');
const { priceRide } = require('../pricing/pricing');

/**
 * @param {{routingAdapter:object, serviceAreaId:string, vehicleType:string, pickup:object, destination:object}} args
 * @returns {Promise<{routeDistanceMeters:number, routeDurationSeconds:number, estimatedFareCentavos:number, estimatedCommissionCentavos:number, pricingConfigVersion:string}>}
 */
async function calculateServerRideQuote({ routingAdapter, serviceAreaId, vehicleType, pickup, destination }) {
  // Routing failure propagates (retryable provider error) so the caller aborts
  // ride creation WITHOUT writing an incomplete ride.
  const route = await routingAdapter.computeRoute({ origin: pickup, destination, vehicleType });

  const priced = priceRide({
    serviceAreaId,
    vehicleType,
    distanceKm: route.distanceMeters / 1000,
    durationMin: route.durationSeconds / 60,
  });
  if (!priced.ok) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: `pricing failed: ${priced.reason}`,
      safeMetadata: { field: 'vehicleType' },
    });
  }

  return {
    routeDistanceMeters: route.distanceMeters,
    routeDurationSeconds: route.durationSeconds,
    estimatedFareCentavos: priced.passengerFareCentavos,
    // Standard commission estimate (passenger-facing). The per-driver 0%
    // commission-free adjustment is applied at acceptance, not here.
    estimatedCommissionCentavos: priced.commissionCentavos,
    pricingConfigVersion: priced.pricingConfigVersion,
  };
}

module.exports = { calculateServerRideQuote };
