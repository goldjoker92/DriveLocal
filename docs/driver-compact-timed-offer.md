# Block 17 — Compact timed driver offer

## Objective

A targeted driver should be able to decide from one compact card without reading a long
commercial explanation. The server remains authoritative for expiry, acceptance,
refusal, eligibility and settlement.

The offer hierarchy is:

```text
vehicle + countdown
coarse pickup region
distance + estimated pickup time
VOCÊ RECEBE
ride fare
commission percentage
Pix direto
fixed accept CTA
fixed decline action
```

## Compact card

Example with real projected data:

```text
🏍 MOTO                                  36s

REGIÃO DO EMBARQUE
Centro
0,8 km • 2 min

VOCÊ RECEBE
R$ 8,26

Valor da corrida                     R$ 8,26
Comissão                                    0%
Pagamento                           Pix direto
```

The card uses:

- `pickupPreview.label`, never the exact pickup before acceptance;
- `distanceToPickupMeters`;
- the vehicle-specific pickup-time estimate;
- `estimatedFareCentavos`;
- the safe commercial percentage projection;
- direct Pix as the payment method.

The passenger pays the full ride fare directly to the driver by Pix. `VOCÊ RECEBE` is
therefore the real ride fare, not a client-side subtraction of a hidden commission
amount. Wallet settlement remains a separate server-side concern.

## Countdown

`expiresAtMs` remains the source of truth. The client refreshes the visible countdown
every 500 ms and rounds up to whole seconds.

```text
6s and above -> normal countdown
5s to 0s     -> urgent countdown
0s           -> accept disabled and server-authoritative expiry refusal requested
```

The existing expiry call is preserved:

```text
declineOffer(offerId, 'expired')
```

## Actions

The action dock is outside the `ScrollView`, above the Android bottom safe area:

```text
[ ACEITAR — R$ 8,26 ]

Recusar
```

The accept button keeps its animation and haptic feedback. Its text now accepts a real
fare label. A missing fare displays `ACEITAR`; it never displays an invented `R$ 0,00`.

Existing secure actions remain unchanged:

```text
acceptOffer(offerId)
declineOffer(offerId, 'driver_declined')
```

## Commercial context

The driver profile is still loaded to present the safe percentage projection, but the
offer remains actionable while that context loads.

```text
context ready  -> projected percentage, for example 0%, 12% or 15%
context loading -> Carregando…
context failed  -> Validada ao aceitar
```

An unknown vehicle does not fall back to the car policy. Final eligibility and policy
are always checked again by the server when the driver accepts.

## Removed long content

The offer screen no longer presents separate cards for:

- founder promotion explanations;
- historical payment status and dates;
- wallet balance and top-up warnings;
- acceptance rate;
- destination explanations;
- long commission descriptions.

Those concepts remain available in their dedicated cockpit and wallet
screens. They no longer compete with the timed decision.

## Missing-data policy

The compact model never converts absent values into plausible-looking data:

```text
missing fare       -> Carregando valor…
missing distance   -> Distância carregando
missing ETA        -> Tempo carregando
missing vehicle    -> VEÍCULO
missing commission -> Carregando… / Validada ao aceitar
```

JavaScript's `Number(null) === 0` behavior is explicitly guarded against.

## Privacy and logs

Before acceptance, only the coarse pickup region and pickup distance are shown. Exact
pickup and destination remain absent from the compact card.

The existing offer-opening trace records only lifecycle identifiers and availability
booleans. It does not add an address, coordinates, passenger identity or destination.

## Existing behavior preserved

Block 17 does not change:

- dispatch or offer targeting;
- offer duration or server expiry task;
- secure accept/refuse callables;
- fare calculation;
- commercial policy;
- wallet mutation;
- historical payment mutation;
- Pix settlement;
- Firestore or Storage rules;
- block 15/16 active-ride restoration.

## Automated validation

Targeted tests:

```powershell
npm test -- driverTimedOffer.test.js
npm test -- driverTimedOfferContract.test.js
npm test -- rideOfferPresentation.test.js
```

Full regression:

```powershell
npm test
npm --prefix functions test
```

## Manual Android validation

1. Receive a moto offer and verify vehicle, countdown, region, distance and ETA.
2. Verify `VOCÊ RECEBE` and the accept CTA use the real ride fare.
3. Verify the safe commission percentage and `Pix direto` line.
4. Verify the card and action dock fit on a small Android screen.
5. Increase system font size and confirm the card remains readable and scrollable.
6. Let the timer reach five seconds and verify the urgent state.
7. Let it reach zero and verify acceptance is disabled and the screen exits safely.
8. Accept and verify the exact pickup is only revealed after acceptance.
9. Refuse and verify the driver returns to the cockpit.
10. Test missing/slow driver context and confirm no provisional percentage appears.
11. Test temporary network loss during accept/refuse and verify the existing error remains.

No merge, Firebase deployment or production build is part of this block.
