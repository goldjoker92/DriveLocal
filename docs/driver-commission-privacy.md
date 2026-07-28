# Driver commission privacy boundary

## Purpose

The driver application may show only the applicable commission percentage:

- `Comissão 0%`
- `Comissão 12%`
- `Comissão 15%`

It must never show or receive the exact DriveLocal commission amount for an
individual ride.

## Driver-visible information

The driver may see:

- the full ride fare paid directly by the passenger through Pix;
- `0%`, `12%` or `15%` commission;
- wallet available and held balances;
- Pix payment status;
- subscription status and price.

The direct Pix fare and the wallet settlement are separate concepts. `Você
recebe` means the full Pix amount received from the passenger, not fare minus a
locally calculated platform fee.

## Forbidden driver fields and copy

The mobile application and driver-facing callable responses must not contain:

- `commissionHoldCentavos`;
- `commissionCapturedCentavos`;
- `holdReleasedCentavos`;
- an exact platform fee calculated from fare;
- `DriveLocal recebeu R$ X`;
- `Taxa da plataforma R$ X`;
- `Comissão cobrada R$ X`.

## Allowed internal locations

Exact commission centavos remain available only in server-controlled locations:

- `rideRequests` financial snapshots;
- `walletTransactions` hold, capture and release ledger entries;
- append-only audit logs;
- admin dispute and reconciliation tools;
- backend structured logs.

Drivers cannot read `rideRequests` or `walletTransactions` directly through
Firestore rules. They read their own `driverOffers` projection.

## Driver offer projection

`driverOffers` receives only:

```text
commissionDisplayBps = 0 | 1200 | 1500
```

The value is resolved on the server:

- active 60-day commission-free window -> `0`;
- backend minimum-net cap removes the hold -> `0`;
- standard moto commission -> `1200`;
- standard car commission -> `1500`.

`estimatedCommissionCentavos`, `commissionHoldCentavos` and capture/release
amounts are never copied to `driverOffers`.

## Callable boundary

The core Functions handlers retain exact values for deterministic financial tests,
ledger operations and audit.

Before returning to the phone:

```text
acceptDriverOfferSecure
→ acceptDriverOfferPublic
→ safeDriverAcceptanceView

confirmDriverPixReceivedSecure
→ confirmDriverPixReceivedPublic
→ safeDriverLifecycleView
```

The public acceptance response contains:

- ride id;
- status;
- vehicle type;
- full fare;
- pickup;
- `commissionDisplayBps`.

The public completion response contains only ride id and status.

## Structured traces

Safe boundary events:

```text
ride.accept.public_view_sanitized
ride.complete.public_view_sanitized
```

Both include `exactCommissionExcluded: true`. Acceptance may include only the
safe percentage in basis points.

Metro's ride logger accepts only `commissionDisplayBps` values `0`, `1200` or
`1500`. It has no output property for exact hold, capture or release amounts.

## Compatibility

Offers created before this block may not contain `commissionDisplayBps`. Because
offers expire within seconds, the mobile fallback uses only the configured vehicle
policy percentage (`12%` moto or `15%` car), or `0%` during the free window. It
still does not calculate a centavo amount.

## Manual verification

1. Driver inside the 60-day window receives a moto offer:
   - fare visible;
   - `Comissão 0%`;
   - `Você recebe` equals the full fare.
2. Post-window moto driver with active subscription receives a normal offer:
   - `Comissão 12%`;
   - no exact commission amount anywhere on screen.
3. Post-window car driver receives a normal offer:
   - `Comissão 15%`.
4. Minimum-fare ride with a zero backend hold:
   - `Comissão 0%`;
   - no exact platform amount.
5. Accept and complete a ride while watching callable responses and Metro logs:
   - no hold/capture/release centavos in the phone response;
   - server ledger still records the exact values.
6. Confirm admin reconciliation still sees hold, capture and release values.

## Deployment rule

No production deploy, merge or Android production build is performed by this
block. Run both Jest suites before considering it validated.
