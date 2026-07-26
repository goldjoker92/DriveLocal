# Block 18 — Real driver wallet

## Objective

The driver wallet must display only real financial state. The production screen no
longer imports a mock driver, a fake balance or a hard-coded transaction history.

The wallet now covers:

```text
available balance
held balance
total balance
Pix top-up requests
Pix payment statuses
confirmed top-up credits
commission holds
commission captures
hold releases
admin adjustments
```

All money remains integer centavos. The mobile app never writes a wallet balance and
never applies a payment.

## Sources of truth

### Live balances

The current balances are read from the authenticated driver's document:

```text
drivers/{uid}.walletAvailableCentavos
drivers/{uid}.walletHeldCentavos
drivers/{uid}.walletBalanceCentavos
```

The mobile listener uses Firestore metadata changes, so the screen can represent cache
and server updates without inventing values. A missing field displays `Carregando…`, not
`R$ 0,00`.

The summary card displays:

```text
Saldo disponível
Saldo reservado
Saldo total
```

### Financial history

Raw financial collections remain server-only:

```text
walletTransactions
paymentRequests
```

Firestore Rules still deny direct client reads and writes. The mobile app calls the
authenticated `getDriverWalletSnapshot` callable instead. The server derives the driver
ID exclusively from `request.auth.uid`, filters both collections by that ID, and returns
a bounded safe projection.

The projection intentionally excludes:

- Mercado Pago provider order IDs;
- idempotency keys and fingerprints;
- Pix QR codes from old requests;
- admin IDs and private notes;
- trace IDs;
- internal provider payloads.

## History presentation

The wallet view maps real ledger types to driver-readable rows:

```text
topup                    -> Recarga Pix
commission_hold           -> Reserva de comissão
commission_hold_release   -> Liberação de reserva
commission_capture        -> Comissão capturada
admin_credit              -> Crédito administrativo
admin_debit               -> Débito administrativo
admin_correction          -> Correção de saldo
admin_reversal            -> Estorno de ajuste
```

A capture entry may contain a released remainder. The view presents the captured amount
and released amount as separate rows so the driver can understand the settlement.

Payment requests are shown with normalized statuses:

```text
pending        -> Aguardando pagamento
paid           -> Pagamento confirmado
expired        -> Pix expirado
cancelled      -> Pagamento cancelado
failed         -> Falha no pagamento
refunded       -> Pagamento estornado
manual_review  -> Pagamento em análise
```

When a paid payment already has its confirmed `topup` ledger entry, the two sources are
deduplicated. The driver sees one real credit, not two apparent deposits.

## Zero-percent commission window

During the 60-day commission-free window, all top-up choices remain visible but disabled:

```text
🔒 R$ 10
🔒 R$ 20
🔒 R$ 30
🔒 R$ 50
🔒 Outro valor
```

The screen displays:

```text
Nenhuma recarga é necessária durante sua comissão de 0%.
As recargas serão liberadas em DD/MM/AAAA.
```

There are three independent guards:

1. controls stay disabled until the driver policy is loaded;
2. the mobile action returns before calling the payment service while locked;
3. the backend returns `PAYMENT_NOT_REQUIRED` before creating a Mercado Pago order.

The mobile screen schedules a refresh at the authoritative unlock timestamp. A wallet
left open across the date boundary becomes usable without a process restart. The backend
still re-evaluates the policy with server time on every request.

## Fixed top-up values

The existing fast values remain:

```text
R$ 10
R$ 20
R$ 30
R$ 50
```

They are validated against the server allowlist:

```text
1000, 2000, 3000, 5000 centavos
```

## Outro valor

The custom amount is parsed into exact integer centavos on the mobile device. Accepted
formats include:

```text
10
10,50
12.34
R$ 200,00
```

The input rules are:

```text
minimum       R$ 10,00 / 1000 centavos
maximum       R$ 200,00 / 20000 centavos
decimals      maximum two
storage       integer centavos only
```

The mobile request sends `customAmount: true`. The backend independently validates:

- the flag is a boolean;
- the amount is a finite positive integer;
- the amount is between 1000 and 20000 centavos.

A non-preset amount without the explicit custom flag remains invalid. This prevents an
altered client from bypassing the fixed-value contract accidentally.

## Per-button progress

The wallet uses a `generatingKey`, not one global label:

```text
preset-1000
preset-2000
preset-3000
preset-5000
custom
```

Only the selected button changes to `Gerando…`. Other actions remain disabled while the
request is in flight, but they keep their own labels.

## Mercado Pago application path

The real top-up path remains:

```text
mobile request
  -> createDriverPixPayment
  -> Mercado Pago Pix order
  -> signed webhook
  -> provider order re-fetch
  -> currency / amount / reference verification
  -> applyWalletTopup transaction
  -> drivers/{uid} balances updated
  -> append-only walletTransactions topup entry
```

The webhook body is never trusted for status or amount. The server re-fetches the order
from Mercado Pago before applying money.

`applyWalletTopup` is idempotent. A payment already marked paid and applied is not
credited again, even if Mercado Pago sends duplicate webhooks.

## Existing commission ledger preserved

Block 18 does not change the commission lifecycle:

```text
offer accepted   -> commission_hold
ride completed   -> commission_capture + optional release
ride cancelled   -> commission_hold_release
```

The accepted-ride hold and final capture remain server-owned and transactional.

## Logs

Client traces contain only safe operational metadata:

```text
[DRIVER_WALLET] balance.snapshot
[DRIVER_WALLET] balance.listener_failed
[DRIVER_WALLET] history.loaded
[DRIVER_WALLET] history.load_failed
```

They include shortened IDs, source, availability booleans, counts and durations. They do
not log balances, QR codes, addresses, Pix keys or provider identifiers.

The server logs the snapshot version, item counts and lock state without returning raw
financial documents.

## Automated validation

Mobile targeted tests:

```powershell
npm test -- driverWallet.test.js
npm test -- driverWalletContract.test.js
```

Functions targeted tests:

```powershell
npm --prefix functions test -- walletTopupRange.test.js
npm --prefix functions test -- driverWalletSnapshot.test.js
npm --prefix functions test -- payments.test.js
```

Full regression:

```powershell
npm test
npm --prefix functions test
```

## Manual Android validation

1. Open the wallet with an initialized account and compare available, held and total
   balances with Firestore/admin data.
2. Open it with slow connectivity and verify no fake `R$ 0,00` appears while loading.
3. During the 0% window, verify all five top-up choices remain visible and disabled.
4. Verify the two lock messages and the real unlock date.
5. Confirm tapping a locked button creates no payment request and no Mercado Pago order.
6. After the free window, generate each preset and verify only the tapped button displays
   `Gerando…`.
7. Enter `9,99`, `10,00`, `10,50`, `200,00`, `200,01` and a value with three decimals.
8. Pay a Pix top-up and verify the payment status changes, the available/total balances
   update and one confirmed top-up row appears.
9. Repeat the same provider webhook and verify the balance is credited exactly once.
10. Accept a commission-bearing ride and verify a real reserve row and held balance.
11. Complete it and verify capture/release rows and updated balances.
12. Cancel a ride with a hold and verify the release row and available balance recovery.
13. Test pending, expired, failed and manual-review payment states.
14. Test small Android screens and enlarged system font.

## Deployment boundary

This block adds a callable export and a Firestore composite index. They require a future
explicitly authorized Firebase Functions/index deployment before a production app can use
them.

No merge, Firebase deployment or production build is part of this implementation step.
