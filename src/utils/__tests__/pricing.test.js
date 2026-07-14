// BLOCK 01 — business-pricing-domain unit tests (governance D3/D6).
// Pure, deterministic. Time is injected everywhere (fixed numeric timestamps).
// No network, Firebase, Firestore, Mercado Pago, GPS, or real timers.
// All amounts are integer centavos.

import {
  roundCentavos,
  calculateBaseRideFare,
  applyFareMinimum,
  calculateCommissionBps,
  calculatePlatformFeeCentavos,
  calculateCommissionCap,
  calculateDriverNet,
  applyDynamicPricing,
  applyPromotion,
  isCommissionFree,
  priceRide,
  getRidePricing,
} from '../ridePricing';
import { getSubscriptionEligibility, computeRenewedExpirationMs } from '../driverSubscription';
import { passesSubscriptionOrTrial } from '../driverEligibility';
import { isWithinOperatingHours, minuteOfDay } from '../operatingHours';
import { getVehiclePricing } from '../../constants/pricingConfig';

const DAY = 24 * 60 * 60 * 1000;
const MOTO = getVehiclePricing('HORIZONTE_CE_BR', 'moto');
const CAR = getVehiclePricing('HORIZONTE_CE_BR', 'car');
const NOW = 1_000_000_000; // fixed injected clock

describe('deterministic rounding (half-up)', () => {
  it('rounds .5 up on non-negative amounts', () => {
    expect(roundCentavos(702.5)).toBe(703);
    expect(roundCentavos(392.5)).toBe(393);
    expect(roundCentavos(0.5)).toBe(1);
  });
  it('is safe on invalid input', () => {
    expect(roundCentavos(NaN)).toBe(0);
    expect(roundCentavos(undefined)).toBe(0);
  });
});

describe('pricing — base fare (moto and car)', () => {
  it('moto 5 km / 15 min = 250 + 475 + 180 = 905', () => {
    expect(calculateBaseRideFare(MOTO, 5, 15)).toBe(905);
  });
  it('car 5 km / 15 min = 350 + 675 + 300 = 1325', () => {
    expect(calculateBaseRideFare(CAR, 5, 15)).toBe(1325);
  });
  it('zero distance and zero duration = base fare only', () => {
    expect(calculateBaseRideFare(MOTO, 0, 0)).toBe(250);
    expect(calculateBaseRideFare(CAR, 0, 0)).toBe(350);
  });
  it('negative inputs are treated as zero', () => {
    expect(calculateBaseRideFare(MOTO, -5, -5)).toBe(250);
  });
  it('integer-centavo rounding: moto 1.5 km / 0 min = 392.5 -> 393', () => {
    expect(calculateBaseRideFare(MOTO, 1.5, 0)).toBe(393);
  });
});

describe('pricing — minimum fare', () => {
  it('lifts a below-minimum fare to the minimum', () => {
    expect(applyFareMinimum(393, MOTO.minimumPassengerFareCentavos)).toBe(500);
    expect(applyFareMinimum(350, CAR.minimumPassengerFareCentavos)).toBe(800);
  });
  it('keeps a fare above the minimum unchanged', () => {
    expect(applyFareMinimum(905, MOTO.minimumPassengerFareCentavos)).toBe(905);
  });
});

describe('pricing — full priceRide breakdown', () => {
  it('moto 5 km / 15 min (non-founder, commissionable)', () => {
    const r = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 15, driver: {}, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.passengerFareCentavos).toBe(905);
    expect(r.commissionBps).toBe(1200);
    expect(r.commissionCentavos).toBe(109); // round(905 * .12) = round(108.6)
    expect(r.driverNetCentavos).toBe(796);
  });
  it('car 5 km / 15 min (non-founder, commissionable)', () => {
    const r = priceRide({ vehicleType: 'car', distanceKm: 5, durationMin: 15, driver: {}, now: NOW });
    expect(r.passengerFareCentavos).toBe(1325);
    expect(r.commissionCentavos).toBe(199); // round(198.75)
    expect(r.driverNetCentavos).toBe(1126);
  });
  it('rejects unknown vehicle and invalid distance/duration', () => {
    expect(priceRide({ vehicleType: 'boat', distanceKm: 1 }).ok).toBe(false);
    expect(priceRide({ vehicleType: 'moto', distanceKm: -1 }).ok).toBe(false);
    expect(priceRide({ vehicleType: 'moto', distanceKm: 1, durationMin: -1 }).ok).toBe(false);
  });
});

describe('pricing — immutable, versioned snapshot', () => {
  it('carries the pricing config version and is a fresh object each call', () => {
    const a = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 15, driver: {}, now: NOW });
    const b = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 15, driver: {}, now: NOW });
    expect(a.pricingConfigVersion).toBe('horizonte-1.1.0');
    expect(a).toEqual(b); // deterministic
    expect(a).not.toBe(b); // distinct object (safe to persist/mutate independently)
    // Mutating the returned snapshot must not affect a subsequent computation.
    a.passengerFareCentavos = 1;
    const c = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 15, driver: {}, now: NOW });
    expect(c.passengerFareCentavos).toBe(905);
  });
});

describe('commission — rate, cap, and no-negative', () => {
  it('moto pays 12% and car pays 15% (non-founder, outside free window)', () => {
    expect(calculateCommissionBps('moto', 5, {}, NOW)).toBe(1200);
    expect(calculateCommissionBps('car', 5, {}, NOW)).toBe(1500);
  });
  it('D3: moto commission no longer depends on distance (>5 km is NOT 0%)', () => {
    expect(calculateCommissionBps('moto', 12, {}, NOW)).toBe(1200);
  });
  it('normal commission amount on a fare (car 15%)', () => {
    expect(calculatePlatformFeeCentavos(1000, 1500)).toBe(150);
  });
  it('commission cap = max(0, fare - minimumDriverNet)', () => {
    expect(calculateCommissionCap(516, 500)).toBe(16); // moto
    expect(calculateCommissionCap(890, 800)).toBe(90); // car
    expect(calculateCommissionCap(400, 500)).toBe(0); // never negative
  });
  it('cap preserves MOTO minimum driver net (fare 516 -> commission capped to 16)', () => {
    const r = priceRide({ vehicleType: 'moto', distanceKm: 2.8, durationMin: 0, driver: {}, now: NOW });
    expect(r.passengerFareCentavos).toBe(516);
    expect(r.commissionCapCentavos).toBe(16);
    expect(r.commissionCentavos).toBe(16); // uncapped would be round(61.92)=62
    expect(r.driverNetCentavos).toBe(500);
  });
  it('cap preserves CAR minimum driver net (fare 890 -> commission capped to 90)', () => {
    const r = priceRide({ vehicleType: 'car', distanceKm: 4, durationMin: 0, driver: {}, now: NOW });
    expect(r.passengerFareCentavos).toBe(890);
    expect(r.commissionCapCentavos).toBe(90);
    expect(r.commissionCentavos).toBe(90); // uncapped would be round(133.5)=134
    expect(r.driverNetCentavos).toBe(800);
  });
  it('minimum-fare ride: cap forces 0 commission (moto and car)', () => {
    const moto = priceRide({ vehicleType: 'moto', distanceKm: 0, durationMin: 0, driver: {}, now: NOW });
    expect(moto.passengerFareCentavos).toBe(500);
    expect(moto.commissionCentavos).toBe(0);
    expect(moto.driverNetCentavos).toBe(500);
    const car = priceRide({ vehicleType: 'car', distanceKm: 0, durationMin: 0, driver: {}, now: NOW });
    expect(car.passengerFareCentavos).toBe(800);
    expect(car.commissionCentavos).toBe(0);
    expect(car.driverNetCentavos).toBe(800);
  });
  it('platform fee and driver net are never negative', () => {
    expect(calculatePlatformFeeCentavos(1000, -500)).toBe(0);
    expect(calculateDriverNet(500, 999)).toBe(0);
  });
});

describe('commission-free window (founder + launch)', () => {
  const T = 2_000_000_000;
  it('is 0% during the window and normal after (exclusive boundary)', () => {
    const driver = { commissionFreeUntil: T };
    expect(isCommissionFree(driver, T - 1)).toBe(true);
    expect(isCommissionFree(driver, T)).toBe(false); // exact expiry = commissionable
    expect(calculateCommissionBps('car', 3, driver, T - 1)).toBe(0);
    expect(calculateCommissionBps('car', 3, driver, T)).toBe(1500);
  });
  it('founder (founderExpiresAt) keeps the whole fare during the window', () => {
    const founder = { founderEligible: true, founderExpiresAt: NOW + DAY };
    const r = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 15, driver: founder, now: NOW });
    expect(r.commissionBps).toBe(0);
    expect(r.commissionCentavos).toBe(0);
    expect(r.driverNetCentavos).toBe(905);
  });
});

describe('founder & subscription eligibility (D6)', () => {
  it('founder covered during the founder free period (does not use the 5-ride grace)', () => {
    const founder = { founderEligible: true, subscriptionFreeUntil: NOW + 60 * DAY, freeRideCountUsed: 99 };
    const e = getSubscriptionEligibility(founder, NOW);
    expect(e.required).toBe(false);
    expect(e.freeRidesRemaining).toBe(0);
  });
  it('founder requires a subscription after the free period', () => {
    const founder = { founderEligible: true, subscriptionFreeUntil: NOW - 1 };
    expect(getSubscriptionEligibility(founder, NOW).required).toBe(true);
  });
  it('founder can use an active paid subscription after the free period', () => {
    const founder = {
      founderEligible: true,
      subscriptionFreeUntil: NOW - 1,
      subscriptionStatus: 'active',
      subscriptionActive: true,
      subscriptionExpiresAt: NOW + 30 * DAY,
    };
    expect(getSubscriptionEligibility(founder, NOW).required).toBe(false);
  });
  it('non-founder rides 0..4 are allowed without a subscription', () => {
    for (let used = 0; used <= 4; used += 1) {
      expect(getSubscriptionEligibility({ freeRideCountUsed: used }, NOW).required).toBe(false);
      expect(passesSubscriptionOrTrial({ freeRideCountUsed: used }, NOW)).toBe(true);
    }
    expect(getSubscriptionEligibility({ freeRideCountUsed: 4 }, NOW).freeRidesRemaining).toBe(1);
  });
  it('after 5 completed rides, a subscription is required for the next ride', () => {
    const e = getSubscriptionEligibility({ freeRideCountUsed: 5 }, NOW);
    expect(e.required).toBe(true);
    expect(e.reason).toBe('SUBSCRIPTION_REQUIRED');
    expect(passesSubscriptionOrTrial({ freeRideCountUsed: 5 }, NOW)).toBe(false);
  });
  it('an active subscription covers a driver past the free rides', () => {
    const driver = {
      freeRideCountUsed: 20,
      subscriptionStatus: 'active',
      subscriptionActive: true,
      subscriptionExpiresAt: NOW + 30 * DAY,
    };
    expect(getSubscriptionEligibility(driver, NOW).required).toBe(false);
  });
  it('subscription renewal does NOT modify commissionFreeUntil (independent benefits)', () => {
    const commissionFreeUntil = NOW + 60 * DAY;
    const driver = { commissionFreeUntil, subscriptionExpiresAt: NOW + 5 * DAY };
    const newExpiry = computeRenewedExpirationMs(driver, NOW);
    // Renewal extends the subscription window only; commissionFreeUntil is untouched.
    expect(newExpiry).toBe(NOW + 5 * DAY + 30 * DAY); // max(now, current) + 30d
    expect(driver.commissionFreeUntil).toBe(commissionFreeUntil);
    expect(isCommissionFree(driver, NOW)).toBe(true);
  });
});

describe('promotions — margin first, driver earning protected, never negative', () => {
  const breakdown = { passengerFareCentavos: 1000, commissionCentavos: 150, driverNetCentavos: 850 };
  it('funds a discount from commission (platform margin) first; driver net unchanged', () => {
    const r = applyPromotion(breakdown, { discountCentavos: 100 });
    expect(r.fundedByCommissionCentavos).toBe(100);
    expect(r.commissionCentavos).toBe(50);
    expect(r.passengerFareCentavos).toBe(900);
    expect(r.driverNetCentavos).toBe(850);
  });
  it('never reduces guaranteed driver earning and never makes commission negative', () => {
    const r = applyPromotion(breakdown, { discountCentavos: 200 }); // exceeds commission, no budget
    expect(r.commissionCentavos).toBe(0);
    expect(r.driverNetCentavos).toBe(850);
    expect(r.fundedByMarketingCentavos).toBe(0);
    expect(r.passengerFareCentavos).toBe(850); // only the 150 margin was spent
  });
  it('a marketing budget funds the remainder beyond commission', () => {
    const r = applyPromotion(breakdown, { discountCentavos: 200, marketingBudgetCentavos: 100 });
    expect(r.fundedByCommissionCentavos).toBe(150);
    expect(r.fundedByMarketingCentavos).toBe(50);
    expect(r.commissionCentavos).toBe(0);
    expect(r.passengerFareCentavos).toBe(800);
    expect(r.driverNetCentavos).toBe(850);
  });
  it('automatic promotion is blocked during 0% commission without a marketing budget', () => {
    const free = { passengerFareCentavos: 700, commissionCentavos: 0, driverNetCentavos: 700 };
    const r = applyPromotion(free, { discountCentavos: 100 }, { isCommissionFreePeriod: true });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('BLOCKED_COMMISSION_FREE_NO_BUDGET');
    expect(r.passengerFareCentavos).toBe(700);
  });
  it('a marketing budget can fund a promotion during 0% commission', () => {
    const free = { passengerFareCentavos: 700, commissionCentavos: 0, driverNetCentavos: 700 };
    const r = applyPromotion(free, { discountCentavos: 100, marketingBudgetCentavos: 100 }, { isCommissionFreePeriod: true });
    expect(r.applied).toBe(true);
    expect(r.fundedByMarketingCentavos).toBe(100);
    expect(r.passengerFareCentavos).toBe(600);
    expect(r.driverNetCentavos).toBe(700);
  });
});

describe('dynamic pricing — disabled by default, clamp 1.20, surcharge to driver', () => {
  it('disabled -> no change even if a multiplier is passed', () => {
    expect(applyDynamicPricing(1000, { enabled: false, multiplier: 5 })).toEqual({
      fareCentavos: 1000,
      surchargeCentavos: 0,
      multiplier: 1,
      enabled: false,
    });
  });
  it('clamps a multiplier above the maximum to 1.20', () => {
    const d = applyDynamicPricing(1000, { enabled: true, multiplier: 5 });
    expect(d.multiplier).toBe(1.2);
    expect(d.fareCentavos).toBe(1200);
    expect(d.surchargeCentavos).toBe(200);
  });
  it('clamps a below-1.0 multiplier up to 1.0 (no negative surcharge)', () => {
    const d = applyDynamicPricing(1000, { enabled: true, multiplier: 0.5 });
    expect(d.multiplier).toBe(1);
    expect(d.surchargeCentavos).toBe(0);
  });
  it('priceRide: the surcharge belongs to the driver; commission is charged on base only', () => {
    const r = priceRide({
      vehicleType: 'moto', distanceKm: 5, durationMin: 15, driver: {}, now: NOW,
      dynamic: { enabled: true, multiplier: 1.5 },
    });
    expect(r.dynamicMultiplier).toBe(1.2); // clamped
    expect(r.passengerFareCentavos).toBe(1086); // round(905 * 1.2)
    expect(r.dynamicSurchargeCentavos).toBe(181);
    expect(r.commissionCentavos).toBe(109); // charged on base 905, not on 1086
    expect(r.driverNetCentavos).toBe(977); // 1086 - 109 (includes the 181 surcharge)
  });
});

describe('operating hours — 24/7, scheduled, crossing midnight, invalid config', () => {
  it('24_7 mode is always open', () => {
    expect(isWithinOperatingHours({ mode: '24_7' }, 0)).toBe(true);
    expect(isWithinOperatingHours({ mode: '24_7' }, 1439)).toBe(true);
    expect(isWithinOperatingHours({}, 720)).toBe(true); // default mode
  });
  it('scheduled same-day window [06:00, 22:00): open during, closed before/after', () => {
    const cfg = { mode: 'scheduled', openMinuteOfDay: minuteOfDay(6), closeMinuteOfDay: minuteOfDay(22) };
    expect(isWithinOperatingHours(cfg, minuteOfDay(12))).toBe(true);
    expect(isWithinOperatingHours(cfg, minuteOfDay(5))).toBe(false); // before opening
    expect(isWithinOperatingHours(cfg, minuteOfDay(22))).toBe(false); // exclusive close (after)
    expect(isWithinOperatingHours(cfg, minuteOfDay(6))).toBe(true); // inclusive open
  });
  it('scheduled window crossing midnight [22:00, 06:00)', () => {
    const cfg = { mode: 'scheduled', openMinuteOfDay: minuteOfDay(22), closeMinuteOfDay: minuteOfDay(6) };
    expect(isWithinOperatingHours(cfg, minuteOfDay(23))).toBe(true);
    expect(isWithinOperatingHours(cfg, minuteOfDay(1))).toBe(true);
    expect(isWithinOperatingHours(cfg, minuteOfDay(0))).toBe(true);
    expect(isWithinOperatingHours(cfg, minuteOfDay(12))).toBe(false);
    expect(isWithinOperatingHours(cfg, minuteOfDay(6))).toBe(false); // exclusive close
  });
  it('invalid/missing config is handled explicitly (documented open-all-day fallback)', () => {
    // Unknown mode falls through to scheduled logic; missing open/close clamp to
    // 0 -> open === close -> "open all day". Defined behavior, never throws.
    expect(isWithinOperatingHours({ mode: 'bogus' }, 720)).toBe(true);
    expect(isWithinOperatingHours({ mode: 'scheduled' }, 720)).toBe(true);
  });
});

describe('backward-compat shim getRidePricing (confirm-price.jsx)', () => {
  it('prices an in-area moto ride (durationMin defaults to 0)', () => {
    // moto 3.5 km / 0 min -> 250 + 332.5 = 582.5 -> 583 fare.
    const r = getRidePricing('moto', 3.5, { status: 'ALLOWED' }, null, NOW);
    expect(r.ok).toBe(true);
    expect(r.ridePriceCentavos).toBe(583);
    expect(r.driverAmountCentavos).toBe(583); // Pix-direct: driver receives full fare
    expect(r.platformFeeCentavos).toBe(70); // round(583 * .12) = round(69.96)
  });
  it('refuses an out-of-area ride', () => {
    const r = getRidePricing('moto', 3.5, { status: 'OUT_OF_AREA' }, null, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('OUT_OF_AREA');
  });
});
