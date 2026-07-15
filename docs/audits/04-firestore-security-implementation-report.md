# BLOCK 04 — Firestore Security Implementation Report

**Branch:** `feature/security-driver-backend`
**Scope:** Firestore Security Rules hardening + rules documentation + rules tests.
**Nature:** Client-SDK boundary enforcement only. No Cloud Function business logic,
no Mercado Pago, no deployment, no secrets.

## Objective

Make the backend (Admin SDK / secure callable Functions) authoritative for all
approval, blocking, founder, subscription, wallet, commission, ride assignment,
ride completion, settlement, and completed-ride-counter state. The Rules constrain
only the mobile/web client SDK; the Admin SDK bypasses them.

## Changes in this diff

### `backend/firebase/rules/firestore.rules`
- Added helpers: `isSignedIn()`, `isOwner(uid)`, and explicit safe-field allowlists
  (`driverCreateSafe`, `driverUpdateSafe`, `passengerCreateSafe`, `passengerUpdateSafe`).
- **drivers/{driverId}**: read = owner or admin; create limited to onboarding-safe
  keys via `hasOnly`; self-update limited to safe keys via
  `diff().affectedKeys().hasOnly(...)` (mixed safe+protected update fails as a whole);
  delete denied. `verificationStatus`/`duplicateCheckStatus` and all
  financial/approval/founder/subscription/wallet fields are server-owned.
- **passengers/{uid}**: same allowlisted create/update pattern; delete denied.
- **rideRequests/{rideId}**: create requires `passengerId == uid`, `status == 'pending'`,
  and neutral assignment/settlement fields (`driverId`/`acceptedDriverId`/
  `assignedDriverId` null, `commissionSettled == false`) so a passenger cannot
  pre-assign or pre-settle; read = own or admin; update/delete denied.
- **driverOffers/{offerId}**: driver may read only offers where `driverId == uid`;
  create/update/delete denied (reserved for BLOCK 08 dispatch).
- **counters/{counterId}**: read for signed-in; write gated by `isAdmin()`.
- **New server-only collections** (`allow read, write: if false`):
  `privateDriverData`, `cityPrivateConfig`, `idempotencyOperations`, `auditLogs`,
  `walletTransactions`, `paymentRequests`, `subscriptionPayments`.
- **cityPublicConfig**: read for signed-in, write denied.
- Deny-by-default tail (`match /{document=**}`) retained.

### `docs/security/firestore-field-ownership.md`
Field-by-field client-access classification (C-create / C-update / read / server /
private / forbidden) for drivers, passengers, ride requests, counters, and
server-only collections — the source of truth behind the allowlists.

### `functions/src/__tests__/firestore.rules.emulator.test.js`
- Always-run guard asserting the rules file declares `rules_version = '2'` and a
  deny-by-default tail (runs in the deterministic Node suite).
- Emulator suite (12 critical invariants) that self-skips unless
  `FIRESTORE_EMULATOR_HOST` is set; requires JDK 21+.

### `functions/package.json` / `functions/package-lock.json`
- Added dev dependencies only: `@firebase/rules-unit-testing`, `firebase`
  (authorized rules-testing tooling). No runtime/business dependency added.

## Known temporary limitations (until BLOCK 03)
- Driver document CREATE and admin approve/reject/block still run through the
  client SDK under the `isAdmin()` gate; these move to secure callable Functions
  in later blocks.

## Explicitly out of scope / not present
- No Cloud Function business logic. No Mercado Pago. No deployment / no
  `firebase deploy`. No secrets or credentials.

## Validation
See closing commit report: root tests, functions tests, `expo-doctor`, and
`git diff --check`. Firestore Rules emulator: **NOT RUN — JDK 21 REQUIRED**.
