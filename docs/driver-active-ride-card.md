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

A missing fare or vehicle type is also rendered as a neutral loading/generic state. The
card never turns absent data into `R$ 0,00` or assumes that an unknown vehicle is a car.

## Persistence and restoration

The card is mounted in `src/app/(driver)/_layout.jsx`, above the driver stack. One
`listenToMyOffer` Firestore listener changes mode according to the authoritative driver
state:

```text
activeRideId absent  -> listen for current targeted offers
activeRideId present -> listen only for that exact accepted ride
```

This restores the card after:

- opening Waze or Google Maps and returning;
- moving DriveLocal to the background;
- navigating to another driver screen;
- a JavaScript/process restart;
- a cached Firestore snapshot while the network reconnects.

The existing `drivers/{uid}.activeRideId` is the restoration pointer. A Pix dispute is
non-terminal and remains recoverable. A completed or cancelled offer is rejected by the
card model before GPS status or navigation can be restored from stale cache.

The layout keeps the existing `/active-ride` navigation and GPS restoration behavior.
No new automatic lifecycle action is introduced.

## Visibility lifecycle

```text
assigned             -> visible
driver_arrived       -> visible
in_progress          -> visible
awaiting_payment     -> visible
payment_marked_sent  -> visible
disputed             -> visible and recoverable
completed            -> hidden
cancelled            -> hidden
```

Completion and cancellation remove the card without a client write. The render wrapper
uses the same pure visibility model, so no empty permanent-card space remains after a
terminal snapshot.

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
[DRIVER_ACTIVE_RIDE] restore_listener.started
[DRIVER_ACTIVE_RIDE] restore_listener.succeeded
[DRIVER_ACTIVE_RIDE] restore_listener.failed
[DRIVER_ACTIVE_RIDE] card.rendered
[DRIVER_ACTIVE_RIDE] passenger_photo.load_requested
[DRIVER_ACTIVE_RIDE] passenger_photo.load_succeeded
[DRIVER_ACTIVE_RIDE] passenger_photo.load_failed
```

## Android layout

The global card owns the top safe-area inset. On `/active-ride`, the driver stack removes
the duplicate top inset so the screen begins directly below the card. Other screens keep
their existing safe-area behavior.

## No backend or policy change

Block 15 does not change:

- ride lifecycle callables;
- dispatch;
- pricing;
- commission or wallet policy;
- commission policy;
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
8. Put a payment into dispute, restart, and confirm the card remains recoverable.
9. Complete or cancel the ride and confirm the card disappears without a blank header.
10. Test a small Android screen and enlarged font.

No merge, Firebase deployment or production build is part of this block.
