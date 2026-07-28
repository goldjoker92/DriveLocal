# Block 19 — Real driver Pix subscription

## Objective

Replace the old MVP/free placeholder with the real subscription policy and the
existing secure Mercado Pago Pix payment flow.

The mobile app explains the driver's current state. The backend remains the sole
authority for:

- founder position;
- free-window dates;
- five-ride grace consumption;
- vehicle type;
- subscription price;
- payment eligibility;
- payment verification;
- subscription activation and renewal.

## Driver-facing states

### Founder #1–#100 inside the 60-day window

```text
Assinatura grátis
Assinatura grátis até DD/MM/AAAA

[ 🔒 Pagar assinatura ]
```

The control remains visible but disabled. Both mobile and backend prevent an
unnecessary Mercado Pago order.

### Driver #101+ before five completed grace rides

```text
Corridas sem assinatura
3 de 5 corridas sem assinatura utilizadas

[ 🔒 Pagar assinatura ]
```

Payment remains blocked while at least one grace ride is available and the same
60-day launch window is active.

### Driver #101+ after ride five but before day 60

```text
Assinatura necessária
Comissão 0% até DD/MM/AAAA

[ PAGAR COM PIX ]
```

Subscription is required to receive another offer, while the approval-based
commission benefit remains independent and continues until its own expiration.

### Subscription required after day 60

```text
🏍 Moto
R$ 9,90 / 30 dias
Comissão padrão: 12%

🚗 Carro
R$ 19,90 / 30 dias
Comissão padrão: 15%
```

The vehicle stored in the approved driver profile selects the payable plan. The
UI shows both plans for transparency but never lets the client submit a chosen
price or vehicle.

### Active paid subscription

```text
Assinatura ativa
Ativa até DD/MM/AAAA

[ RENOVAR COM PIX ]
```

Early renewal preserves all remaining days:

```text
new expiration = current expiration + 30 days
```

When the plan is expired or absent:

```text
new expiration = provider-confirmed processing time + 30 days
```

## Real Pix flow

```text
PAGAR COM PIX
→ createDriverPixPayment
→ Mercado Pago order
→ QR Code / Pix copia-e-cola
→ Aguardando pagamento…
→ signed Mercado Pago webhook
→ provider order re-fetch and verification
→ transactional payment application
→ Pagamento confirmado — assinatura ativada!
→ drivers/{uid}.subscriptionExpiresAt updated
```

The mobile request contains only:

```text
purpose = driver_subscription
idempotencyKey
```

It never sends an amount. The backend derives:

```text
moto = 990 centavos
car  = 1990 centavos
```

## Payment restoration

`paymentRequests` remains inaccessible from Firestore clients.

The authenticated callable:

```text
getDriverSubscriptionSnapshot
```

queries only the authenticated driver's latest `driver_subscription` payment and
returns it only when its normalized status is actionable:

```text
pending
manual_review
```

Terminal payments are not reopened after restart:

```text
paid
expired
cancelled
failed
refunded
```

Safe returned fields are limited to:

```text
localPaymentId
purpose
status
amountCentavos
currency
qrCode
qrCodeBase64
expiration
```

Provider identifiers, idempotency material, internal errors and admin metadata
remain server-only.

## Duplicate-payment protections

A new Pix order requires all of the following on mobile:

1. a server-confirmed `drivers/{uid}` snapshot;
2. successful verification that no actionable subscription Pix must be restored;
3. a policy state that allows payment;
4. no request already in progress;
5. no paid payment still propagating its activation to the driver document.

The backend then repeats all commercial checks before contacting Mercado Pago.
It also uses its existing idempotency operation and ignores a webhook replay after
the payment has already been applied.

## Boundary refresh

An open screen schedules a refresh at the nearest future policy boundary:

- founder subscription-free expiration;
- commission-free expiration;
- paid subscription expiration.

This prevents a screen opened before midnight or before day 60 from showing a
stale state indefinitely.

## Cockpit access

The driver cockpit now exposes both financial destinations:

```text
Ver carteira
Ver assinatura
```

The subscription route is:

```text
/subscription-plans
```

## Existing backend invariants preserved

A confirmed payment updates only subscription fields and never changes:

- `approvedAt` / `approvedAtMs`;
- `founderNumber` / founder eligibility;
- `commissionFreeUntil`;
- `freeRideCountUsed`;
- wallet balances;
- ride pricing or commission holds.

Payment application remains transactional and writes one append-only
`subscriptionPayments` record.

## Structured logs

Mobile events use the `DRIVER_SUBSCRIPTION` scope:

```text
state.snapshot
state.listener_failed
payment_snapshot.loaded
payment_snapshot.failed
payment.create_started
payment.create_succeeded
payment.create_failed
payment.status_changed
```

Logs contain only operational states, booleans, vehicle type, short driver IDs and
durations. They do not contain QR data, Pix codes, tokens, signatures or personal
identity values.

Backend restoration event:

```text
subscription.snapshot.loaded
```

## Targeted automated validation

Mobile:

```powershell
npm test -- driverSubscription.test.js driverSubscriptionContract.test.js
```

Functions:

```powershell
npm --prefix functions test -- subscriptionSnapshot.test.js subscriptionRenewal.test.js payments.test.js
```

Full regression:

```powershell
npm test
npm --prefix functions test
```

## Manual Android validation

1. Open `Ver assinatura` from the driver cockpit.
2. Founder inside 60 days: verify the free-until date and locked payment button.
3. Driver #101+ at 3/5: verify exact progress and locked payment button.
4. Driver #101+ at 5/5 before day 60: verify subscription required and commission 0% date.
5. After day 60: verify moto R$ 9,90 / 12% and car R$ 19,90 / 15%.
6. Verify the approved vehicle is highlighted as `SEU PLANO`.
7. Generate a real sandbox Pix and verify only one request enters `GERANDO PIX…`.
8. Verify QR, copia-e-cola, expiration and `Aguardando pagamento…`.
9. Close and reopen the app while pending; verify `RETOMAR PIX PENDENTE`.
10. Confirm payment through the sandbox webhook and verify the activation message.
11. Close the sheet immediately after confirmation; verify a second Pix cannot be created while activation propagates.
12. Verify the driver document changes to active with the correct expiration.
13. Renew an active plan and verify 30 days are added to the previous expiration.
14. Replay the webhook and verify expiration is not extended twice.
15. Test temporary network loss during snapshot, creation and polling.
16. Increase Android font size and verify cards/buttons remain readable and scrollable.

## Deployment note

Block 19 adds one new callable export:

```text
getDriverSubscriptionSnapshot
```

The required Firestore composite index already exists:

```text
paymentRequests:
driverId ASC + purpose ASC + createdAtMs DESC
```

No merge, Firebase deployment, production build or real-money payment is part of
this block.
