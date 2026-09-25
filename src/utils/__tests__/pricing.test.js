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
  it('moto 5 km / 15 min = 200 + 425 + 150 = 775', () => {
    expect(calculateBaseRideFare(MOTO, 5, 15)).toBe(775);
  });
  it('car 5 km / 15 min = 300 + 600 + 225 = 1125', () => {
    expect(calculateBaseRideFare(CAR, 5, 15)).toBe(1125);
  });
  it('zero distance and zero duration = base fare only', () => {
    expect(calculateBaseRideFare(MOTO, 0, 0)).toBe(200);
    expect(calculateBaseRideFare(CAR, 0, 0)).toBe(300);
  });
  it('negative inputs are treated as zero', () => {
    expect(calculateBaseRideFare(MOTO, -5, -5)).toBe(200);
  });
  it('integer-centavo rounding: moto 1.5 km / 0 min = 327.5 -> 328', () => {
    expect(calculateBaseRideFare(MOTO, 1.5, 0)).toBe(328);
  });
});

describe('pricing — minimum fare', () => {
  it('lifts a below-minimum fare to the profitable passenger minimum', () => {
    expect(applyFareMinimum(393, MOTO.minimumPassengerFareCentavos)).toBe(500);
    expect(applyFareMinimum(350, CAR.minimumPassengerFareCentavos)).toBe(750);
  });
  it('keeps a fare above the minimum unchanged', () => {
    expect(applyFareMinimum(775, MOTO.minimumPassengerFareCentavos)).toBe(775);
  });
});

describe('pricing — full priceRide breakdown', () => {
  it('moto 5 km / 15 min (non-founder, commissionable)', () => {
    const r = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 15, driver: {}, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.passengerFareCentavos).toBe(775);
    expect(r.commissionBps).toBe(1200);
    expect(r.commissionCentavos).toBe(93); // 775 * 12% = 93
    expect(r.driverNetCentavos).toBe(682);
  });
  it('car 5 km / 15 min (non-founder, commissionable)', () => {
    const r = priceRide({ vehicleType: 'car', distanceKm: 5, durationMin: 15, driver: {}, now: NOW });
    expect(r.passengerFareCentavos).toBe(1125);
    expect(r.commissionCentavos).toBe(169); // round(168.75)
    expect(r.driverNetCentavos).toBe(956);
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
    expect(a.pricingConfigVersion).toBe('horizonte-1.6.0');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.passengerFareCentavos = 1;
    const c = priceRide({ vehicleType: 'moto', distanceKm: 5, durationMin: 15, driver: {}, now: NOW });
    expect(c.passengerFareCentavos).toBe(775);
  });
});

describe('commission — rate, minimum, driver net, and no-negative', () => {
  it('moto pays 12% and car pays 15% outside the free window', () => {
    expect(calculateCommissionBps('moto', 5, {}, NOW)).toBe(1200);
    expect(calculateCommissionBps('car', 5, {}, NOW)).toBe(1500);
  });
  it('moto commission no longer depends on distance (>5 km is NOT 0%)', () => {
    expect(calculateCommissionBps('moto', 12, {}, NOW)).toBe(1200);
  });
  it('normal percentage commission still applies above the minimum', () => {
    expect(calculatePlatformFeeCentavos(1000, 1500)).toBe(150);
  });
  it('commission cap = max(0, fare - minimumDriverNet)', () => {
    expect(calculateCommissionCap(500, 440)).toBe(60);
    expect(calculateCommissionCap(750, 637)).toBe(113);
    expect(calculateCommissionCap(400, 500)).toBe(0);
  });
  it('minimum moto ride charges the advertised 12%', () => {
    const r = priceRide({ vehicleType: 'moto', distanceKm: 0, durationMin: 0, driver: {}, now: NOW });
    expect(r.passengerFareCentavos).toBe(500);
    expect(r.percentageCommissionCentavos).toBe(60);
    expect(r.minimumPlatformCommissionCentavos).toBe(60);
    expect(r.commissionCapCentavos).toBe(60);
    expect(r.commissionCentavos).toBe(60);
    expect(r.driverNetCentavos).toBe(440);
  });
  it('minimum car ride charges the advertised 15%', () => {
    const r = priceRide({ vehicleType: 'car', distanceKm: 0, durationMin: 0, driver: {}, now: NOW });
    expect(r.passengerFareCentavos).toBe(750);
    expect(r.percentageCommissionCentavos).toBe(113);
    expect(r.minimumPlatformCommissionCentavos).toBe(113);
    expect(r.commissionCapCentavos).toBe(113);
    expect(r.commissionCentavos).toBe(113);
    expect(r.driverNetCentavos).toBe(637);
  });
  it('every sampled standard ride charges commission and preserves driver net', () => {
    for (const distanceKm of [0, 1, 3, 5, 10, 15]) {
      const moto = priceRide({ vehicleType: 'moto', distanceKm, durationMin: distanceKm * 2, driver: {}, now: NOW });
      const car = priceRide({ vehicleType: 'car', distanceKm, durationMin: distanceKm * 2, driver: {}, now: NOW });
      expect(moto.commissionCentavos).toBeGreaterThanOrEqual(60);
      expect(car.commissionCentavos).toBeGreaterThanOrEqual(113);
      expect(moto.driverNetCentavos).toBeGreaterThanOrEqual(440);
      expect(car.driverNetCentavos).toBeGreaterThanOrEqual(637);
    }
  });
  it('platform fee and driver net are never negative', () => {
    expect(calculatePlatformFeeCentavos(1000, -500)).toBe(0);
    expect(calculateDriverNet(500, 999)).toBe(0);
  });
});

describe('commission-free window for every approved driver', () => {
  const T = Date.UTC(2026, 7, 10);
  it('is 0% during the window and normal after (exclusive boundary)', () => {
    const driver = { verificationStatus: 'approved', approvedAtMs: T - 60 * DAY };
    expect(isCommissionFree(driver, T - 1)).toBe(true);
    expect(isCommissionFree(driver, T)).toBe(false);
    expect(calculateCommissionBps('car', 3, driver, T - 1)).toBe(0);
    expect(calculateCommissionBps('car', 3, driver, T)).toBe(1500);
  });
  it('the launch benefit keeps the whole fare and bypasses the minimum commission', () => {
    const founder = { verificationStatus: 'approved', founderEligible: true, approvedAtMs: NOW - DAY };
    const r = priceRide({ vehicleType: 'moto', distanceKm: 0, durationMin: 0, driver: founder, now: NOW });
    expect(r.passengerFareCentavos).toBe(500);
    expect(r.commissionBps).toBe(0);
    expect(r.minimumPlatformCommissionCentavos).toBe(0);
    expect(r.commissionCentavos).toBe(0);
    expect(r.driverNetCentavos).toBe(500);
  });
});

describe('approval-based commission', () => {
  it('applies the same 60-day rate to #100 and #101 regardless of old counters', () => {
    for (const approvalNumber of [100, 101]) {
      const approvedAtMs = Date.UTC(2026, 7, 10);
      const driver = {
        verificationStatus: 'approved', approvalNumber,
        approvedAtMs, freeRideCountUsed: 999,
        subscriptionActive: false,
      };
      expect(calculateCommissionBps('moto', 3, driver, approvedAtMs + 59 * DAY)).toBe(0);
      expect(calculateCommissionBps('car', 3, driver, approvedAtMs + 60 * DAY)).toBe(1500);
    }
  });
});

describe('promotions — minimum commission and driver earning protected', () => {
  const breakdown = { passengerFareCentavos: 1000, commissionCentavos: 150, driverNetCentavos: 850 };
  it('funds a discount from unprotected commission first', () => {
    const r = applyPromotion(breakdown, { discountCentavos: 100 });
    expect(r.fundedByCommissionCentavos).toBe(100);
    expect(r.commissionCentavos).toBe(50);
    expect(r.passengerFareCentavos).toBe(900);
    expect(r.driverNetCentavos).toBe(850);
  });
  it('never reduces guaranteed driver earning and never makes commission negative', () => {
    const r = applyPromotion(breakdown, { discountCentavos: 200 });
    expect(r.commissionCentavos).toBe(0);
    expect(r.driverNetCentavos).toBe(850);
    expect(r.fundedByMarketingCentavos).toBe(0);
    expect(r.passengerFareCentavos).toBe(850);
  });
  it('a marketing budget funds the remainder beyond commission', () => {
    const r = applyPromotion(breakdown, { discountCentavos: 200, marketingBudgetCentavos: 100 });
    expect(r.fundedByCommissionCentavos).toBe(150);
    expect(r.fundedByMarketingCentavos).toBe(50);
    expect(r.commissionCentavos).toBe(0);
    expect(r.passengerFareCentavos).toBe(800);
    expect(r.driverNetCentavos).toBe(850);
  });
  it('a minimum-fare ride keeps its percentage commission protected', () => {
    const r = priceRide({
      vehicleType: 'moto',
      distanceKm: 0,
      durationMin: 0,
      driver: {},
      now: NOW,
      promotion: { discountCentavos: 500 },
    });
    expect(r.passengerFareCentavos).toBe(500);
    expect(r.commissionCentavos).toBe(60);
    expect(r.promotion.fundedByCommissionCentavos).toBe(0);
    expect(r.promotion.discountAppliedCentavos).toBe(0);
    expect(r.driverNetCentavos).toBe(440);
  });
  it('a marketing budget may discount the passenger while preserving driver net', () => {
    const r = priceRide({
      vehicleType: 'moto',
      distanceKm: 0,
      durationMin: 0,
      driver: {},
      now: NOW,
      promotion: { discountCentavos: 50, marketingBudgetCentavos: 50 },
    });
    expect(r.passengerFareCentavos).toBe(450);
    expect(r.commissionCentavos).toBe(60);
    expect(r.driverNetCentavos).toBe(440);
    expect(r.promotion.fundedByMarketingCentavos).toBe(50);
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
  it('clamps a below-1.0 multiplier up to 1.0', () => {
    const d = applyDynamicPricing(1000, { enabled: true, multiplier: 0.5 });
    expect(d.multiplier).toBe(1);
    expect(d.surchargeCentavos).toBe(0);
  });
  it('priceRide: surcharge belongs to driver; commission is charged on base only', () => {
    const r = priceRide({
      vehicleType: 'moto', distanceKm: 5, durationMin: 15, driver: {}, now: NOW,
      dynamic: { enabled: true, multiplier: 1.5 },
    });
    expect(r.dynamicMultiplier).toBe(1.2);
    expect(r.passengerFareCentavos).toBe(930);
    expect(r.dynamicSurchargeCentavos).toBe(155);
    expect(r.commissionCentavos).toBe(93);
    expect(r.driverNetCentavos).toBe(837);
  });
});

describe('operating hours — 24/7, scheduled, crossing midnight, invalid config', () => {
  it('24_7 mode is always open', () => {
    expect(isWithinOperatingHours({ mode: '24_7' }, 0)).toBe(true);
    expect(isWithinOperatingHours({ mode: '24_7' }, 1439)).toBe(true);
    expect(isWithinOperatingHours({}, 720)).toBe(true);
  });
  it('scheduled same-day window [06:00, 22:00)', () => {
    const cfg = { mode: 'scheduled', openMinuteOfDay: minuteOfDay(6), closeMinuteOfDay: minuteOfDay(22) };
    expect(isWithinOperatingHours(cfg, minuteOfDay(12))).toBe(true);
    expect(isWithinOperatingHours(cfg, minuteOfDay(5))).toBe(false);
    expect(isWithinOperatingHours(cfg, minuteOfDay(22))).toBe(false);
    expect(isWithinOperatingHours(cfg, minuteOfDay(6))).toBe(true);
  });
  it('scheduled window crossing midnight [22:00, 06:00)', () => {
    const cfg = { mode: 'scheduled', openMinuteOfDay: minuteOfDay(22), closeMinuteOfDay: minuteOfDay(6) };
    expect(isWithinOperatingHours(cfg, minuteOfDay(23))).toBe(true);
    expect(isWithinOperatingHours(cfg, minuteOfDay(1))).toBe(true);
    expect(isWithinOperatingHours(cfg, minuteOfDay(0))).toBe(true);
    expect(isWithinOperatingHours(cfg, minuteOfDay(12))).toBe(false);
    expect(isWithinOperatingHours(cfg, minuteOfDay(6))).toBe(false);
  });
  it('invalid/missing config uses the documented open-all-day fallback', () => {
    expect(isWithinOperatingHours({ mode: 'bogus' }, 720)).toBe(true);
    expect(isWithinOperatingHours({ mode: 'scheduled' }, 720)).toBe(true);
  });
});

describe('backward-compat shim getRidePricing (confirm-price.jsx)', () => {
  it('prices an in-area moto ride with the new minimum', () => {
    const r = getRidePricing('moto', 3.5, { status: 'ALLOWED' }, null, NOW);
    expect(r.ok).toBe(true);
    expect(r.ridePriceCentavos).toBe(500);
    expect(r.driverAmountCentavos).toBe(500);
    expect(r.platformFeeCentavos).toBe(60);
  });
  it('refuses an out-of-area ride', () => {
    const r = getRidePricing('moto', 3.5, { status: 'OUT_OF_AREA' }, null, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('OUT_OF_AREA');
  });
});
