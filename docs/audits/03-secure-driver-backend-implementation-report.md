# BLOCK 03 — Secure Driver Backend Implementation Report

**Branch:** `feature/security-driver-backend`
**Scope:** Server-authoritative callable Functions for driver approval, founder
assignment, moderation (reject/block/unblock), and manual subscription
activation. JavaScript only. No Mercado Pago, no wallet movements, no ride
acceptance, no deployment.

## Reused BLOCK 02 infrastructure (not duplicated)
`AppError` / stable codes, boundary (`withCallableBoundary`), validators,
`traceId`/structured logger, append-only audit writer, injected clock, and the
idempotency helpers (`acquireOperation` / `completeOperation`).

## Files added
- `src/auth/adminAuth.js` — `requireAdmin(db, request)`: the single admin gate.
  Trust is backed **only** by membership in `admins/{uid}`; never a client role
  field. Missing auth → `UNAUTHENTICATED`; non-admin → `ADMIN_REQUIRED`.
- `src/drivers/constants.js` — fixed founder limit (100), free period (60d),
  free-ride grace (5), subscription plans (moto 990 / car 1990 centavos, 30d).
- `src/drivers/eligibility.js` — `safeDriverView` (safe response projection) +
  `evaluateRideEligibility` (authoritative, computed on demand — no stored
  `canReceiveRides` flag).
- `src/drivers/approveDriver.js` — one Firestore transaction owning the atomic
  per-`serviceAreaId` counter and founder assignment.
- `src/drivers/moderateDriver.js` — reject / block / unblock (admin + reason).
- `src/drivers/activateSubscription.js` — idempotency-keyed manual activation.
- `src/drivers/callables.js` — 5 thin `onCall` bindings.
- `src/__tests__/driverSecure.test.js` — 8 deterministic unit tests.

## Files modified
- `src/index.js` — exports the 5 secure callables.
- `src/__tests__/helpers/fakeFirestore.js` — additive `doc.get()` (mirrors the
  Admin SDK; existing tests unaffected).

## Functions
`approveDriverSecure`, `rejectDriverSecure`, `blockDriverSecure`,
`unblockDriverSecure`, `activateSubscriptionSecure`.

## Founder behavior
Per-city counter; moto and car share one `serviceAreaId` counter; different
cities are independent. First approval increments once atomically inside the
transaction. #1–100 → `founderEligible=true`, `founderNumber`, `founderExpiresAt`,
`commissionFreeUntil`, `subscriptionFreeUntil` = approvedAt + 60d. #101+ →
non-founder, no commission/subscription-free dates (§7: standard commission from
the first ride). Repeat approval is idempotent: no increment, `approvedAt` /
`approvalNumber` / `founderNumber` / benefit dates preserved; `freeRideCountUsed`
and wallet totals initialized to 0 only when absent.

## Subscription behavior
Manual admin path (temporary, until Mercado Pago). Requires an idempotency key.
Plan price derived from Firestore `vehicleType` (never from the client; unknown
fields rejected). Active subscription extends from current expiry; expired/none
starts from server time; +30 rolling days. Recorded as `manual_admin`. Never
touches `approvedAt`, `founderNumber`, `commissionFreeUntil`, or
`freeRideCountUsed`. Replays of the same key return the stored result (no
double-extend, single audit).

## Eligibility (authoritative evaluator)
Founders subscription-covered until `subscriptionFreeUntil`, then require an
active subscription; non-founders covered for their first 5 rides, then require
an active subscription. Commission-free eligibility is evaluated independently.

## Tests
`npm test --prefix functions`: 11 suites pass, 59 passed / 13 skipped (emulator).
The 8 new tests cover: founder 1/100/101; shared-city vs independent-city
counter; repeat approval no double-increment; reapproval preservation;
unauthorized rejection; moderation admin+reason & history preservation;
subscription renewal/expired dates & fixed price; subscription idempotency.
`npm test -- --runInBand` (root): 45 passed. `npx expo-doctor`: 21/21.
`git diff --check`: clean.

## Rules emulator
NOT RUN — JDK 21 required (unavailable). Deterministic Node suite used instead.

## Known limitations / out of scope
- No Mercado Pago, no wallet ledger movement, no ride acceptance/dispatch.
- Manual subscription is a temporary admin path pending Mercado Pago.
- Firestore Rules still allow the current admin-client approve/reject/block path
  (BLOCK 04 note); moving those writes fully behind callables is a later step.
- Concurrency proven logically via transaction design + repeated-approval test;
  true parallel contention is emulator-only (JDK 21).

## Deploy
NOT DEPLOYED. No push, no merge.
