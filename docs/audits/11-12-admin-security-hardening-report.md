# BLOCK 11 + 12 — Minimal Admin Operations & Security Hardening

**Branch:** `feature/admin-ops-security-hardening`
**Scope:** minimal secure admin operations for the Horizonte pilot (driver
moderation, ride-dispute resolution, wallet adjustment) + Firestore hardening.
**Excluded / unchanged:** BLOCK 09+10 (ride lifecycle, notifications, Pix, wallet
settlement), Mercado Pago (never used for ride payment), native notification
config. No deploy / push / merge.

## Admin Functions (new/updated)

New secure callables (region `southamerica-east1`, admin-gated via
`requireAdmin` = membership in `admins/{uid}`, server-derived identity, request
validation, safe structured errors, server timestamps, immutable audit record):

- `suspendDriverSecure` / `reactivateDriverSecure` — `functions/src/drivers/moderateDriver.js`
- `resolveRideDisputeSecure` — `functions/src/rides/disputeResolution.js`
- `adjustDriverWalletSecure` — `functions/src/wallet/adminWallet.js` (+ `wallet/callables.js`)

Reused unchanged: `approveDriverSecure`, `rejectDriverSecure` (founder allocation
already transactional/idempotent/per-city in `approveDriver.js`). Admin identity
is never client-supplied. Audit records go to the append-only `auditLogs`
collection (`writeAuditLog`, deterministic redaction; no CPF/Pix/token/coords).

## Driver administration

Approve / reject / **suspend** / **reactivate** now run through callables. The
admin UI (`driver-detail.jsx`) calls them via `src/services/adminService.js` and
sends **no adminUid** (server derives it). Founder logic preserved (first 100
approved per city, moto+car combined, benefits from `approvedAt`, 60d free).

**Suspension safety (invariant):** `suspendDriverSecure` runs in one transaction.
If the driver holds an `activeRideId` it rejects with a safe conflict
(`RIDE_IN_PROGRESS`) and changes nothing — ride status, wallet hold, availability
and audit history are all preserved; the admin retries after the ride reaches a
terminal state. On success: `verificationStatus → suspended` (removes ride
eligibility server-side via `evaluateRideEligibility`), `availabilityStatus →
offline`; approval/founder/financial history untouched. Idempotent replay.
`reactivateDriverSecure` restores `approved`, never sets the driver online, never
alters wallet balances; idempotent; suspension history preserved.

## Dispute resolution (one callable, three explicit outcomes)

`resolveRideDisputeSecure` — never a generic `setRideStatus`. Ride payment stays
direct passenger→Pix→driver (no Mercado Pago). One transaction; deterministic
ledger ids prevent double effects.

- `confirm_driver_payment` — capture commission once (`0` during
  `commissionFreeUntil`), never above the original hold, release the unused hold,
  complete the ride, clear `activeRideId`, increment counters once. Deterministic
  `walletTransactions/{rideId}_capture` (existence ⇒ replay). Already-completed ⇒
  replay.
- `release_driver_hold` — release the full hold once
  (`{rideId}_release`), cancel the ride (no capture). Second call ⇒ replay.
- `retain_for_manual_review` — hold untouched, ride stays `disputed`,
  `requiresManualReview = true`; idempotent.

A different outcome on an already-terminally-resolved ride ⇒
`INVALID_STATE_TRANSITION` (conflicting resolution rejected). Every success writes
a `dispute_resolution` audit record.

## Wallet adjustment (credit / debit / correction / reversal)

`adjustDriverWalletSecure` — integer centavos, `amount > 0`, mandatory
`reasonCode` + human `note`, `idempotencyKey`, one transaction, append-only
ledger, server timestamps. **`walletHeldCentavos` is never touched** (active-ride
holds move only via lifecycle/dispute).

- credit: `available += amount`, `balance += amount`.
- debit: rejected when `available < amount` (`WALLET_INSUFFICIENT`, never clamped).
- correction: explicit `correctionSign` (increase/decrease); a NEW compensating
  ledger entry; original preserved.
- reversal: negates the original entry's recorded `availableDeltaCentavos`;
  original entry is immutable; only admin-adjustment entries (carrying a delta +
  `reversible:true`) are reversible; ledger id `rev_<originalId>` makes a second
  reversal a no-op replay. Non-reversible target ⇒ `INVALID_STATE_TRANSITION`.

Invariants enforced: available/balance never negative; every adjustment
idempotent (deterministic ledger id); `wallet_manual_adjustment` audit record with
before/after balances.

## Minimal admin UI (reused design system, PT-BR)

- `dashboard.jsx` — real bounded counts (pending drivers, active drivers, open
  disputes) via capped admin reads; navigation links.
- `driver-detail.jsx` — approve/reject via callables + suspend (approved) /
  reactivate (suspended); PT-BR conflict message on active-ride suspension.
- `ride-disputes.jsx` — search by rideId, disputed list, masked identities, safe
  payment/hold summary, three explicit outcomes with mandatory reason + optional
  note + confirmation.
- `wallet-adjust.jsx` — driver id, operation, BRL→centavos, reasonCode, mandatory
  note, correctionSign/originalLedgerEntryId, confirmation + safe result.
- All screens show loading/empty/success/error states and confirm before
  financial/destructive actions; masked ids; no raw backend errors.

## Firestore Rules (hardening, BLOCK 04 protections preserved)

`backend/firebase/rules/firestore.rules`:
- `drivers` update: admin client SDK may do document-review housekeeping but may
  **never** touch `driverServerOnlyKeys()` (approval number, founder fields,
  wallet balances, held, hold, completed/free-ride counters, activeRideId). Self
  update stays limited to onboarding-safe keys.
- `counters` write → `if false` (founder allocation is callable-only via Admin SDK).
- Unchanged server-only: `walletTransactions`, `auditLogs`, `notificationEvents`,
  `notificationTokens`, `privateDriverData`, `driverOffers`, `rideRequests`
  (client update already `false`). Admin reads on drivers/rides/passengers kept.

**Firestore Rules emulator: NOT RUN — JDK 21 required.** Changes validated by
design + code review; the skipped emulator test suite is unchanged.

## Firestore indexes (only for real, implemented queries)

`backend/firebase/indexes/firestore.indexes.json`:
- `drivers` (`verificationStatus ASC`, `createdAt DESC`) — `adminService.listDriversByStatus` (dashboard counts, pending list).
- `rideRequests` (`status ASC`, `updatedAt DESC`) — `adminService.listDisputedRides` (dashboard + disputes list).

No speculative indexes added.

## Environment & secrets

No secrets committed; no production credentials; no key copied to source/docs.
Secret Manager remains the backend secret source; region unchanged
(`southamerica-east1`). No native notification config changed. No deploy.

## Logging

Reused the structured logger only (backend). Added a non-reversible `shortHash`
helper (`logging/logger.js`) for masked `adminIdHash`/`targetUserIdHash`. New
events: `driver.suspended`, `driver.reactivated`, `admin.dispute_resolved`,
`wallet.admin_adjustment`. Never logs CPF/email/phone/Pix/token/coords/addresses/
raw documents. Client screens log only on error paths (existing convention).

## Runtime mock scan

No mock/fake/simulate in runtime paths; test doubles live only in
`__tests__`; no runtime module imports a test file.

## Validation

- Functions tests: **103 passed / 13 skipped** (+15 new in
  `functions/src/__tests__/adminOps.test.js`).
- Root tests: 45/45. `expo install --check`: up to date. `expo-doctor`: 21/21.
  `git diff --check`: clean.
- Firestore Rules emulator: NOT RUN (JDK 21 unavailable).

### New tests (adminOps.test.js — 15)
Admin auth rejection (unauth + non-admin, all callables); suspend clears
availability + idempotent; suspend rejected during active ride without touching
state; reactivate not-online + idempotent; wallet credit; debit +
insufficient-balance rejection; duplicate-idempotency once; correction new entry
preserves original; reversal negates + preserves + no double; non-reversible
rejected; dispute confirm (capture once + commission-free zero); release; retain;
conflicting-resolution rejection + audit creation.

## Manual admin smoke

See `docs/testing/11-12-admin-operations-smoke.md` — **NOT RUN** (dev build /
Firebase dev project / real admin account required).

## Deploy

**NOT DEPLOYED.** No push, no merge.
