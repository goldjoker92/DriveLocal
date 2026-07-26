# Block 15 — Permanent driver active-ride card

## Objective

As soon as a driver accepts an offer, the accepted ride becomes the first operational
information shown across the driver route group. The card uses the existing secured
`driverOffers/{rideId}_{driverId}` projection and never creates a second source of
truth.

## Visible data

```text
CORRIDA ATIVA
passenger first name
approved public passenger photo or initial
Moto / Carro
exact pickup after acceptance
destination hidden before boarding
real estimated ride fare
```

The destination copy before boarding is always:

```text
Liberado após o embarque
```

After `in_progress`, the exact destination already projected to the accepted offer is
shown. If that projection is still settling, the card displays a loading fallback
instead of inventing an address.

## Persistence and restoration

The card is mounted in `src/app/(driver)/_layout.jsx`, above the driver stack. The
existing `listenToMyOffer` Firestore listener restores it from an accepted offer after:

- opening Waze or Google Maps and returning;
- moving DriveLocal to the background;
- navigating to another driver screen;
- a JavaScript/process restart;
- a cached Firestore snapshot while the network reconnects.

The layout keeps the existing `/active-ride` navigation and GPS restoration behavior.
No new automatic lifecycle action is introduced.

## Visibility lifecycle

```text
assigned             -> visible
driver_arrived       -> visible
in_progress          -> visible
awaiting_payment     -> visible
payment_marked_sent  -> visible
disputed             -> supported by the card model
completed            -> hidden
cancelled            -> hidden
```

The existing offer listener clears its layout state when no active accepted projection
remains. Completion and cancellation therefore remove the card without a client write.

## Privacy

The component reads only fields already allowed in the accepted driver's offer:

- `acceptedPassengerPublic.firstName`;
- approved public passenger photo path;
- vehicle type;
- exact pickup after acceptance;
- exact destination after boarding;
- estimated fare.

It does not read or log:

- passenger phone or email;
- CPF;
- Pix key or payload;
- raw passenger profile;
- coordinates in the card model;
- name, address, fare or photo path in traces.

Safe trace family:

```text
[DRIVER_ACTIVE_RIDE] card.rendered
[DRIVER_ACTIVE_RIDE] passenger_photo.load_requested
[DRIVER_ACTIVE_RIDE] passenger_photo.load_succeeded
[DRIVER_ACTIVE_RIDE] passenger_photo.load_failed
```

## No backend or policy change

Block 15 does not change:

- ride lifecycle callables;
- dispatch;
- pricing;
- commission or wallet policy;
- subscription policy;
- Firestore or Storage rules;
- GPS publication frequency;
- Pix settlement.

## Validation

Targeted tests:

```powershell
npm test -- driverActiveRideCard.test.js
npm test -- driverActiveRideCardContract.test.js
```

Full regression checks:

```powershell
npm test
npm --prefix functions test
```

Manual Android verification:

1. Accept a real offer and confirm the card appears above the active screen.
2. Confirm passenger first name/photo, vehicle, pickup and fare use real data.
3. Confirm destination says `Liberado após o embarque` before boarding.
4. Press `Passageiro embarcou` and confirm the real destination replaces the hidden copy.
5. Open Waze, return to DriveLocal and confirm the card remains.
6. Background and reopen the app; confirm the same accepted ride is restored.
7. Test once with the network interrupted and restored.
8. Complete or cancel the ride and confirm the card disappears.
9. Test a small Android screen and enlarged font.

No merge, Firebase deployment or production build is part of this block.
