// @ts-check
// Pure, clock-free subscription extension math shared by the manual admin
// activation (activateSubscription.js) and the Mercado Pago payment application
// (payments/applyPayment.js). Keeping this in one place guarantees both paths
// price and extend a subscription identically.
//
// Extension rule:
//   - active subscription  -> extend from current expiration;
//   - expired / none        -> start from the supplied processing time.
// Never touches approvedAt, founderNumber, commissionFreeUntil, or
// freeRideCountUsed — callers only write the subscription fields.

const { validateEnum } = require('../validation/validators');
const C = require('./constants');

/**
 * @param {object} driverData driver document data
 * @param {number} nowMs authoritative processing time (server or provider-confirmed)
 * @returns {{vehicleType:string, priceCentavos:number, isActive:boolean, newExpiry:number}}
 */
function computeSubscriptionExtension(driverData, nowMs) {
  const d = driverData || {};
  const vehicleType = validateEnum(d.vehicleType, C.VEHICLE_TYPES, 'vehicleType');
  const priceCentavos =
    vehicleType === 'moto' ? C.MOTO_SUBSCRIPTION_CENTAVOS : C.CAR_SUBSCRIPTION_CENTAVOS;

  const currentExpiry = Number(d.subscriptionExpiresAt || 0);
  const isActive = d.subscriptionActive === true && currentExpiry > nowMs;
  const base = isActive ? currentExpiry : nowMs;
  const newExpiry = base + C.SUBSCRIPTION_DURATION_DAYS * C.DAY_MS;

  return { vehicleType, priceCentavos, isActive, newExpiry };
}

module.exports = { computeSubscriptionExtension };
