# BLOCK 01 — business-pricing-domain — Implementation Report

- **Block id:** 01-business-pricing-domain
- **Date:** 2026-07-14
- **Branch:** `feature/v1-pricing-foundation-3a5`
- **Status:** COMPLETE
- **Deploy status:** NOT DEPLOYED

## 1. Objective

Replace the old distance-tier pricing/commission model with the final
configurable fare + flat-commission model (governance D3), as small pure
deterministic JavaScript domain functions, with independent founder /
subscription / commission-free benefits (D6), promotions, dynamic pricing
(disabled by default), and 24/7 + scheduled operating hours — all covered by a
deterministic Jest test suite. No backend, Firestore, screen, notification, map,
or Mercado Pago changes.

## 2. Implemented

- **New fare model** (integer centavos, per city, versioned):
  - Moto: base 250, /km 95, /min 12, min passenger 500, commission 1200 bps, min driver net 500.
  - Car: base 350, /km 135, /min 20, min passenger 800, commission 1500 bps, min driver net 800.
- **Removed** the old distance tiers and the "moto rides > 5 km = 0% commission" rule.
- **Deterministic rounding rule:** half-up on non-negative amounts (`Math.round`), documented in `pricingConfig.js` and implemented once in `ridePricing.roundCentavos()`.
- **Commission:** 0% inside the commission-free window (exclusive at expiry), else the vehicle's flat rate; capped so the driver keeps at least `minimumDriverNetCentavos`; never negative.
- **Founder/subscription (independent benefits):** `getSubscriptionEligibility()` is the single source of truth; founder covered in the free window / with a paid sub; non-founder gets 5 finalized free rides, then a subscription is required; subscription renewal never touches `commissionFreeUntil`.
- **Promotions:** reduce platform margin (commission) first, then an explicit marketing budget; never reduce the guaranteed driver earning; never produce negative commission; no automatic promotion during 0% commission without a marketing budget.
- **Dynamic pricing:** disabled by default; multiplier clamped to `[1.0, 1.20]`; surcharge belongs entirely to the driver (commission charged on the base fare only).
- **Operating hours:** `isWithinOperatingHours()` — 24_7 always open; scheduled window with exclusive close; supports crossing midnight; invalid/missing config handled explicitly (open-all-day fallback, never throws).
- **Immutable snapshot:** `priceRide()` returns a fresh, versioned breakdown (`pricingConfigVersion: 'horizonte-1.1.0'`) suitable to persist on a ride.

## 3. Architecture — pure functions (no Firestore, injected time)

- `src/constants/pricingConfig.js` — config + `getVehiclePricing()`.
- `src/utils/ridePricing.js` — `roundCentavos`, `calculateBaseRideFare`, `applyFareMinimum`, `calculateCommissionBps`, `calculatePlatformFeeCentavos`, `calculateCommissionCap`, `calculateDriverNet`, `applyDynamicPricing`, `applyPromotion`, `isCommissionFree`, `priceRide`, and the backward-compat `getRidePricing` shim.
- `src/utils/driverSubscription.js` — `getSubscriptionEligibility` (single source of truth) + existing helpers.
- `src/utils/driverEligibility.js` — `passesSubscriptionOrTrial` delegates to `getSubscriptionEligibility` (removed the duplicated founder helper).
- `src/utils/operatingHours.js` — `isWithinOperatingHours`, `minuteOfDay`.

Backward compatibility preserved for out-of-scope callers: `calculateCommissionBps(vehicleType, distanceKm, driver, now)` keeps its 4-arg signature (distance now ignored, documented) so `services/walletCommission.js` and `utils/driverEligibility.js` import it unchanged; `getRidePricing` keeps `{ ok, ridePriceCentavos, driverAmountCentavos, platformFeeCentavos }` for `confirm-price.jsx`.

## 4. Files created / modified / deleted

**Created**
- `src/utils/operatingHours.js`
- `src/utils/__tests__/pricing.test.js`
- `docs/audits/01-business-pricing-domain-implementation-report.md`

**Modified**
- `src/constants/pricingConfig.js`
- `src/utils/ridePricing.js`
- `src/utils/driverSubscription.js`
- `src/utils/driverEligibility.js`
- `package.json` (dev test runner + `test` script + `jest-expo` preset)
- `package-lock.json` (jest-expo dev tree)

**Deleted**
- none (a temporary smoke test was created and removed during verification).

## 5. Test dependency

- **Runner:** Jest via the Expo-official preset. `jest ~29.7.0`, `jest-expo ~56.0.5` — **devDependencies only**, installed with `npx expo install jest-expo jest -- --dev`.
- **Reason:** the source is uniformly ESM `.js` in a CommonJS-default Expo project; Node's built-in `node:test` cannot run it without either `"type":"module"` (breaks the CJS `app.config.js`) or rewriting the financial core in CommonJS. `jest-expo` transpiles the existing ESM via the already-present `babel-preset-expo`, needs no source changes, and is one runner. No TypeScript, no ESLint added.
- **Config:** `package.json` `"jest": { "preset": "jest-expo" }`, script `"test": "jest --ci --runInBand"`.

## 6. Commands executed

| Command | Exit |
|---|---|
| `npx expo install jest-expo jest -- --dev` | 0 |
| `npm install --package-lock-only` (reclassify jest to devDependencies) | 0 |
| `npm test -- --runInBand` | 0 (45/45 passed) |
| `npx expo-doctor` | 0 (21/21 passed) |
| `npx jest _smoke_pricing.test.js` (temporary smoke, then removed) | 0 |
| `git diff --check` | 0 (no whitespace/conflict errors) |

Lint: NOT RUN (no intentional ESLint configuration exists; out of scope for this block).

## 7. Test results — 45 passing

Groups: rounding (2), base fare (5), minimum fare (2), full `priceRide` (3),
immutable/versioned snapshot (1), commission rate/cap/no-negative (7),
commission-free window (2), founder & subscription (7), promotions (5),
dynamic pricing (4), operating hours (4), backward-compat shim (2).

## 8. Pricing smoke test — expected vs actual (real exported functions)

| Case | Expected | Actual |
|---|---|---|
| Moto 5 km / 15 min {fare, bps, commission, net} | 905, 1200, 109, 796 | 905, 1200, 109, 796 |
| Car 5 km / 15 min {fare, bps, commission, net} | 1325, 1500, 199, 1126 | 1325, 1500, 199, 1126 |
| Commission cap on moto minimum-fare ride {fare, cap, commission, net} | 500, 0, 0, 500 | 500, 0, 0, 500 |
| Sixth-ride subscription requirement {5th.required, 6th.required} | false, true | false, true |
| Scheduled crossing midnight [22:00,06:00) {23h, 01h, 12h} | true, true, false | true, true, false |

## 9. Known risks / limitations

- `getRidePricing` shim uses `durationMin = 0` until BLOCK 07 wires real route
  duration; the tiered prices are gone, so Step-1 prices now come from the base
  model at 0 minutes. Screens still use mock origin/destination (unchanged).
- `calculateCommissionBps` keeps `distanceKm` as an accepted-but-ignored arg for
  backward compatibility; to be cleaned when BLOCK 03/10 update the wallet flow.
- Commission math still runs client-side here; it becomes authoritative
  server-side in the backend blocks (02/03/10). No Firestore rule protects these
  fields yet (BLOCK 04).
- `pricingConfigVersion` is `horizonte-1.1.0`; historical rides created under the
  old tier model (if any exist in dev) carry the old snapshot and are unaffected.

## 10. Deploy status

**NOT DEPLOYED.** No push, no merge, no Firebase deploy.

## 11. Recommendation for PR review

Ready for PR review as part of the full pricing foundation. Reviewers should
focus on: the commission-cap interaction at minimum fare (cap can legitimately
force 0% commission when fare == minimum driver net), the dynamic-surcharge
"belongs to driver" accounting (commission on base only), and the
promotion funding order. After approval, merge the pricing foundation into
`main`, then cut backend branches (BLOCK 02 onward) from the updated `main`.
