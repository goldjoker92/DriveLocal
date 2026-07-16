# BLOCK 09 + 10 — Ride Lifecycle, Real FCM and Wallet Settlement

**Branch:** `feature/notifications-ride-lifecycle`
**Excluded:** automatic dispute resolution, Mercado Pago for ride payment (ride
payment is direct passenger→driver Pix), deploy/push/merge.

## Secure functions (7 callables + 1 token callable + 1 trigger)

`markDriverArrivedSecure`, `startRideSecure`, `finishRideSecure`,
`markPassengerPixSentSecure`, `confirmDriverPixReceivedSecure`, `cancelRideSecure`,
`reportRidePaymentIssueSecure`, `syncNotificationTokenSecure`, and the Firestore
trigger `processRideNotificationEvent`. Every mutation is authenticated,
ownership-checked, status-guarded, idempotency-keyed, transactional, and reuses
existing infra (AppError, validators, logger/traceId, audit writer, idempotency,
wallet hold, Admin SDK init). Clients never write ride status, destination
exposure, fare, commission, wallet, payment state, or completion timestamps.

## Ride lifecycle

`assigned → driver_arrived → in_progress → awaiting_payment →
payment_marked_sent → completed`, plus `cancelled` (before start) and `disputed`
(payment issue). Each transition writes its notificationEvent in the same
transaction. Idempotent replays return the current state without duplicate
side-effects.

## Destination privacy

Before start the exact destination is not exposed. `startRideSecure` copies
`exactDestination` onto the WINNING accepted offer only, in the same transaction;
losing offers never receive it. (`exactPickup` was already winner-only from
BLOCK 07+08.)

## Direct Pix

Ride payment stays passenger→Pix→driver (no Mercado Pago). At finish, the backend
reads the verified driver Pix from `privateDriverData` (Admin SDK) and builds a
standards-compliant Pix BR Code (EMV-MPM, CRC16-CCITT) in
`functions/src/pix/pixBrCode.js` — amount, verified key, sanitized recipient name,
Horizonte, deterministic `DL<rideId>` reference, valid CRC. The payload is stored
on the ride for the passenger; the Pix key/payload is never logged. Passenger UI
shows amount + copia-e-cola + copy + "Já paguei" + payment-issue.

## Wallet settlement (transactional, idempotent)

At driver-confirmed completion (`confirmDriverPixReceivedSecure`):
`walletBalanceCentavos -= captured`, `walletHeldCentavos -= originalHold`,
`walletAvailableCentavos += originalHold - captured`, floored at 0, capture never
above hold, never duplicated. During `commissionFreeUntil` capture = 0 and the
wallet is unchanged. Completion clears driver `activeRideId`, increments the
completed/free-ride counter once, sets `completedAt`, writes deterministic
`walletTransactions/{rideId}_capture` + audit. Cancellation releases the hold
exactly once (`{rideId}_release`); dispute retains the hold for manual resolution.

## Real notifications (three-state) — client package REQUIRED

Backend is complete and real: `notificationEvents` (deterministic ids
`rideId_eventType_recipient`) created atomically with ride changes; the
`processRideNotificationEvent` trigger loads active Android tokens, sends via
**Firebase Admin Messaging**, records sent/partially_failed/failed, disables
invalid tokens (`registration-token-not-registered` / `invalid-registration-token`
/ `invalid-argument`), and is idempotent. Payloads are strings only
(notificationId, eventType, rideId, offerId, recipientRole, route, traceId) — no
coordinates/address/Pix/wallet/PII. Targeted BLOCK 07+08 offers now emit real
`offer_created` events.

**Client three-state handling (foreground / background / killed) is
implemented** (packages approved and installed: `expo-notifications`,
`react-native-svg`, `react-native-qrcode-svg`). `src/services/notificationsService.js`
gets the real native Android FCM token via `getDevicePushTokenAsync` (never an
Expo push token — sending is via Admin Messaging), creates the two channels
before token retrieval, and registers/disables via `syncNotificationTokenSecure`
(disabled on logout). `src/hooks/useRideNotifications.js` (mounted in
`src/app/_layout.jsx`) configures the foreground handler once (present, no
auto-navigation, no duplicate fallback), routes background taps and the
cold-start initial response once via the `route` payload, holds a route pending
until auth + router are ready, and dedupes by `notificationId`.

The passenger **Pix QR image** is rendered with `react-native-qrcode-svg` from
the backend BR Code payload, alongside the copia-e-cola string + copy.

## App integration (no-package parts, real)

- `ridesService.js`: lifecycle callable wrappers + existing listeners (no polling).
- Driver `active-ride.jsx`: status-driven buttons (Cheguei ao local → Passageiro
  embarcou → destination nav + Finalizar corrida → Pagamento recebido / Problema),
  navigation from the driver's own offer (`exactPickup`/`exactDestination`).
- Passenger `pix-payment.jsx`: real amount + Pix copia-e-cola via the ride listener
  + copy + "Já paguei" + payment-issue; navigates to completed on the real status.
- No fake success screens; secured Firestore listeners only.

## Logging

Structured events: `ride.arrived`, `ride.started`, `ride.destination_revealed`,
`ride.awaiting_payment`, `ride.payment_marked_sent`, `ride.completed`,
`ride.cancelled`, `ride.disputed`, `wallet.hold_released`,
`wallet.commission_captured`, `notification.token_synced`, `notification.sent`,
`notification.failed`, `notification.duplicate_ignored`. Never logs tokens (only a
hash), notification bodies, coordinates, addresses, Pix data, raw documents, or
raw FCM responses.

## Firestore rules

`notificationEvents` and `notificationTokens` added as server-only
(`allow read, write: if false`) under the existing deny-by-default.

## Validation

- Functions tests: 88 pass / 13 skipped (6 new critical lifecycle tests).
- Root tests: 45/45. Expo Doctor: 21/21. `git diff --check` clean.
- Firestore Rules emulator: NOT RUN — JDK 21 required.
- Runtime scan: no mock/fake/simulate in the ride-lifecycle/notification runtime
  path; test doubles are test-only; no secrets in mobile code; no direct client
  financial writes; notification payloads carry no sensitive data.

### Critical tests (`functions/src/__tests__/rideLifecycle.test.js`)
1. Invalid/unauthorized transitions rejected.
2. Destination hidden before start, revealed only to the winner.
3. Duplicate transitions create exactly one notification event.
4. Cancellation releases the hold exactly once.
5. Completion captures commission once; promotion captures zero.
6. Notification token ownership/payload privacy + invalid-token disabling.

Physical Android foreground/background/killed smoke test: **NOT RUN —
DEVELOPMENT BUILD, DEPLOYMENT AND REAL DEVICE REQUIRED** — see
`docs/testing/09-10-android-notification-smoke.md`.

## Configuration required before end-to-end
- Dependencies installed: `expo-notifications`, `react-native-svg`,
  `react-native-qrcode-svg` (no `--force` / `--legacy-peer-deps`).
- `ROUTING_PROVIDER_API_KEY` in Secret Manager (from BLOCK 07+08) for ride creation.
- Development build + deployment to `drivelocal-dev` for the real device smoke test.
- No deployment performed; no production credentials.
