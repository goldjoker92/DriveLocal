# BLOCK 05 + 06 — Mercado Pago Pix Payments (consolidated)

**Branch:** `feature/mercado-pago-payments`
**Scope:** Real Mercado Pago Pix flow for `driver_subscription` and `wallet_topup`.
**Excluded:** ride payments (passengers pay drivers directly by Pix), deploy, push, merge.

## Secrets (names only — values live in Firebase Secret Manager)

Declared as Firebase Secret Manager parameters and bound only to the functions
that need them:

- `MERCADO_PAGO_ACCESS_TOKEN` — bound to `createDriverPixPayment`,
  `reprocessDriverPayment`, `mercadoPagoWebhook`.
- `MERCADO_PAGO_WEBHOOK_SECRET` — bound to `mercadoPagoWebhook`.

No secret value is ever hardcoded, printed, logged, committed, or documented.
`getDriverPaymentStatus` binds no secret (Firestore read only).

## Provider adapter (`functions/src/payments/mercadoPago.js`)

Single isolated boundary to Mercado Pago (Checkout Transparente — Orders API +
official Orders webhook signature). Responsibilities: create Pix order, fetch
order by id, validate webhook `x-signature` (manifest
`id:{data.id};request-id:{x-request-id};ts:{ts};`, HMAC-SHA256, constant-time),
normalize provider states into DriveLocal fields, 10 s request timeout, reuse
the same `X-Idempotency-Key` on retry. Money is integer centavos internally;
BRL decimal only at the boundary. Raw provider payloads are never returned to
callers (no leak to the app).

## Functions

1. `createDriverPixPayment` (callable) — authenticated driver only; driverId from
   auth; requires `purpose` + client `idempotencyKey`; immutable local
   `paymentRequests/{id}` used as `external_reference`; no PII in provider
   metadata.
   - Subscription: price derived from Firestore `vehicleType` (moto 990 / car
     1990); never accepted from client; founders covered by
     `subscriptionFreeUntil` and non-founders within their free rides get a
     stable PT-BR `PAYMENT_NOT_REQUIRED` error instead of an unnecessary charge.
   - Wallet: blocked during `commissionFreeUntil`; otherwise only pilot amounts
     1000/2000/3000/5000 centavos; arbitrary/negative rejected.
   - Returns safe info only: `localPaymentId, status, qrCode, qrCodeBase64,
     expiration, amountCentavos`.
2. `mercadoPagoWebhook` (HTTP) — traceId; validates `x-signature` (invalid →
   401); extracts only the order id; re-fetches the full order; never trusts the
   webhook body status/amount; verifies providerOrderId, external_reference,
   local payment existence, driver ownership, purpose, amount, currency BRL,
   environment; applies in one transaction; duplicate → success without
   re-applying; transient provider failure → 500 for retry; processed → 200.
3. `getDriverPaymentStatus` (callable) — driver reads only their own payment;
   safe normalized status only; no provider payload/token/signature/internal
   error exposed.
4. `reprocessDriverPayment` (callable) — admin only; accepts `localPaymentId`;
   re-fetches and runs the same verification/application pipeline; idempotent;
   never accepts a replacement amount or status from the admin client.

Status mapping: `pending, paid, expired, cancelled, failed, refunded,
manual_review`. Unknown/inconsistent → `manual_review` (never `paid`).

## Payment application (transactional, idempotent)

- Wallet paid: increments `walletBalanceCentavos` + `walletAvailableCentavos`;
  leaves `walletHeldCentavos`; appends a `walletTransactions` record; marks
  applied; writes an audit record.
- Subscription paid: reuses the shared extension math
  (`drivers/subscriptionDomain.js`, also used by the manual admin activation) —
  30 rolling days, active extends from expiry, expired starts from the
  provider-confirmed processing time or safe server time; `source =
  mercado_pago`; never changes `approvedAt`, `founderNumber`,
  `commissionFreeUntil`, `freeRideCountUsed`; appends a `subscriptionPayments`
  record; marks applied; writes an audit record.
- Refund after an applied payment: never silently subtracts money/dates → marks
  `manual_review` + audit record for later admin resolution.

## Reused BLOCK 02 / 03 infrastructure (not duplicated)

AppError (+ new stable `PAYMENT_NOT_REQUIRED` code), validators, traceId logger
(with redaction), environment resolver, idempotency
(acquire/complete/recordFailure), audit writer, `requireAdmin`, subscription
activation domain logic, Firebase Admin SDK Firestore.

## App integration (minimal, no redesign)

- `src/config/firebase.js` — exposes `functions` (southamerica-east1).
- `src/services/paymentsService.js` — callable client; no access token in the
  app; polls status and stops on a final status.
- `src/components/DriverPixPaymentSheet.jsx` — amount, QR image (when
  available), selectable Pix copia-e-cola + copy action, expiration, PT-BR
  status.
- `src/app/(driver)/wallet.jsx` — real Pix top-up (pilot amounts).
- `src/app/(driver)/subscription-plans.jsx` — real Pix subscription payment.

No mock payment result at runtime; the fake provider and fakeFirestore are
test-only (verified via `git grep`: no runtime import).

## Structured logs

Events: `payment.create.started`, `payment.create.provider_success`,
`payment.create.provider_failure`, `payment.webhook.received`,
`payment.webhook.signature_invalid`, `payment.webhook.provider_refetched`,
`payment.verification_failed`, `payment.duplicate_ignored`,
`payment.wallet_credited`, `payment.subscription_activated`,
`payment.manual_review`, `payment.reprocess.started`,
`payment.reprocess.completed`. Secrets, tokens, signatures, QR data, raw
payloads, and PII are never logged (logger redaction + field discipline).

## Firestore rules

No change required: `paymentRequests`, `walletTransactions`, and
`subscriptionPayments` are already server-only in BLOCK 04
(`allow read, write: if false`) under a deny-by-default rule; all access is via
Admin SDK inside the callables.

## Validation

- Functions tests: **69 PASS, 13 skipped** (10 new critical payment tests;
  skipped = emulator-gated).
- Root tests: **45/45 PASS**.
- Expo Doctor: **21/21 PASS**.
- `git diff --check`: **PASS**.
- Firestore Rules emulator: **NOT RUN — JDK 21 required**.

### Critical tests (`functions/src/__tests__/payments.test.js`)

1. Unauthenticated payment creation rejected.
2. Subscription amount derived from vehicle type.
3. Promotions prevent unnecessary subscription/wallet payment.
4. Wallet top-up rejects unsupported amount.
5. Invalid webhook signature rejected.
6. Refetched amount/reference mismatch never credits.
7. Duplicate webhook credits wallet exactly once.
8. Paid subscription activates once and preserves `commissionFreeUntil`.
9. Refund after application becomes `manual_review`.
10. Admin reprocessing is authorized and idempotent.

## Not done (by instruction)

Deploy, push, merge, ride payments, real-money testing. No production
credentials.
