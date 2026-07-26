# Block 16 — Rebuilt driver active-ride screen

## Objective

The driver must understand the current ride state and the next safe action without
scrolling through a long operational form. The accepted offer remains the only UI data
source and the existing secure callable/service methods remain responsible for every
lifecycle transition.

The screen hierarchy is:

```text
permanent active-ride card from block 15
screen header
current step and GPS state
live-location recovery when needed
Waze / Google Maps navigation
DEV simulation tools when enabled
Pix or completion feedback
secondary cancellation / payment issue actions
fixed primary action above the Android navigation bar
```

## Four operational stages

```text
1 assigned             A caminho do embarque
2 driver_arrived       Aguardando o passageiro
3 in_progress          Em direção ao destino
4 awaiting_payment     Aguardando o Pix
```

`payment_marked_sent`, `disputed` and `completed` remain in stage four with specific
copy. Unknown states display a neutral updating state rather than guessing.

## Fixed primary action

The primary action is rendered after the `ScrollView`, inside the bottom safe area. It
therefore remains visible on small Android screens and does not require scrolling.

```text
assigned             -> CHEGUEI AO LOCAL
                       markDriverArrived

driver_arrived       -> PASSAGEIRO EMBARCOU
                       startRide

in_progress          -> FINALIZAR CORRIDA
                       finishRide

awaiting_payment     -> PAGAMENTO RECEBIDO
payment_marked_sent  -> PAGAMENTO RECEBIDO
                       confirmDriverPixReceived
```

Only one primary lifecycle action is rendered. The old inline action buttons are not
kept in the scrollable content.

The action is disabled while another operation is running or when the secured projection
has not yet supplied the required pickup, destination or Pix payload. Missing data uses a
loading message; it is never replaced by invented information.

Terminal and support states have no primary action:

```text
completed
cancelled
disputed
```

A payment dispute remains visible for support and reconciliation.

## Navigation

The navigation target follows the lifecycle:

```text
assigned / driver_arrived -> exact pickup
in_progress               -> exact destination
payment states            -> no navigation card
```

Both Waze and Google Maps remain available.

Vehicle modes continue to come from the existing map helpers:

```text
Moto
Google Maps -> two-wheeler
Waze        -> motorcycle

Carro
Google Maps -> driving
Waze        -> private
```

The navigation buttons stay disabled until the accepted offer contains a known vehicle
type. The screen does not silently assume a car.

Returning from Waze or Google Maps does not create a new ride context. The route-group
layout from block 15 restores the exact accepted offer through
`drivers/{uid}.activeRideId`, while this screen listens to that exact `rideId`.

## GPS representation

The step card distinguishes four GPS states:

```text
active     -> GPS ATIVO
checking   -> GPS VERIFICANDO
attention  -> GPS REQUER ATENÇÃO
stopped    -> GPS ENCERRADO
```

GPS is intentionally stopped after the ride reaches payment or a terminal state. This is
not displayed as an error. If tracking fails during an active driving stage, the existing
permission recovery action remains available in the scrollable content.

## Secondary actions

Secondary or exceptional actions remain scrollable and visually subordinate:

```text
Cancelar corrida
Problema no pagamento
Ativar localização da corrida
DEV simulation controls
```

They never replace the fixed primary action.

## Existing behavior preserved

Block 16 does not change:

- accepted-offer Firestore projection;
- dispatch or offer acceptance;
- ride lifecycle callable implementations;
- pricing, commission or wallet policy;
- Pix amount or payload creation;
- live-location publication frequency;
- Firestore or Storage rules;
- block 15 active-ride restoration.

## Safe traces

The fixed action adds one client trace before invoking the existing secure action:

```text
driver.active_ride.primary_action_pressed
```

The trace contains only ride ID, lifecycle status and action key. It does not add names,
addresses, coordinates, CPF, phone, email or Pix payload.

## Automated validation

Targeted tests:

```powershell
npm test -- driverActiveRideScreen.test.js
npm test -- driverActiveRideScreenContract.test.js
```

Full regression:

```powershell
npm test
npm --prefix functions test
```

## Manual Android validation

1. Accept a ride and confirm the block 15 card remains above the rebuilt screen.
2. Confirm stage 1 and the fixed `CHEGUEI AO LOCAL` action.
3. Scroll to the end and confirm the primary action never moves with the content.
4. Open Waze and Google Maps; return and confirm the same ride and stage remain.
5. Confirm a moto opens the motorcycle/two-wheeler modes.
6. Confirm a car opens the private/driving modes.
7. Mark arrival and confirm the action becomes `PASSAGEIRO EMBARCOU`.
8. Start the ride and confirm navigation changes from pickup to destination.
9. Finish the ride and confirm the action becomes `PAGAMENTO RECEBIDO`.
10. Confirm the GPS badge becomes `GPS ENCERRADO` during payment.
11. Confirm the Pix only after checking the driver's bank account.
12. Test cancellation, payment dispute, offline/reconnect and process restart.
13. Test a small Android screen, gesture navigation, three-button navigation and enlarged
    font.

No merge, Firebase deployment or production build is part of this block.
