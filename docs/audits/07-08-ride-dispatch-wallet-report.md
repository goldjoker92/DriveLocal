# BLOCK 07 + 08 — Ride Request, Dispatch and Wallet Hold (consolidated)

**Branch:** `feature/ride-dispatch-wallet`
**Flow:** passenger request → backend route + price validation → targeted driver
offers → first transactional acceptance wins → estimated commission held in the
driver wallet.
**Excluded (later blocks):** ride completion, FCM notifications, payment
settlement / capture, multi-wave dispatch, Cloud Tasks.

## Routing provider (fail closed)

The project owner selected **Google Routes API (Compute Routes)**. Adapter:
`functions/src/routing/googleRoutes.js` — the only module that talks to the
provider. Mapping `car → DRIVE`, `moto → TWO_WHEELER`; field mask
`routes.distanceMeters,routes.duration`; 10-second timeout; **fails closed** on
any error/timeout/empty route (retryable provider error) and **never** falls back
to straight-line distance. The API key is the Secret Manager parameter
**`ROUTING_PROVIDER_API_KEY`**, bound only to `createRideRequestSecure`; its value
is never read, logged, or shipped to the app.

## Functions (2 callables)

- `createRideRequestSecure` — authenticated passenger; `passengerId` from auth;
  requires `vehicleType`/`pickup`/`destination`/`idempotencyKey`; rejects any
  client fare/commission/distance/duration/serviceAreaId (unknown fields fail the
  shape check); rejects a passenger with an existing non-final ride; idempotent
  (one ride per key; no duplicate offers). Loads active `cityPublicConfig`,
  geofences both endpoints against the configured polygon, measures the route,
  prices it, writes `rideRequests/{rideId}`, then dispatches.
- `acceptDriverOfferSecure` — authenticated driver; `driverId` from auth;
  transactional first-wins acceptance + commission wallet hold.

Per the final scope, there are **no callable read wrappers**:
`getPassengerRideStatus` / `getDriverActiveOffer` were **not** created. Reads use
secured Firestore listeners — passenger → own `rideRequests/{rideId}`; driver →
`driverOffers where driverId == uid` (BLOCK 04 Rules already secure both).

Internal services (not exported): `calculateServerRideQuote`,
`queryCandidateDrivers` + `selectEligibleDrivers`, `createTargetedOffers`, and the
inline `placeCommissionHold` logic.

## Geofence & pricing authority

Service-area config is loaded from Firestore (`cityPublicConfig/{serviceAreaId}`);
pickup and destination are tested against the real GeoJSON polygon/multipolygon
(ray casting, `functions/src/geo/geo.js`) — no hardcoded rectangle, no
minimum-driver or operating-hours gate. Pricing is backend-authoritative
(`functions/src/pricing/pricing.js`, mirroring BLOCK 01 D3), integer centavos,
`pricingConfigVersion = horizonte-1.1.0`; dynamic pricing disabled. The ride
stores `routeDistanceMeters`, `routeDurationSeconds`, `estimatedFareCentavos`,
`estimatedCommissionCentavos`, and the pricing version. Client distance/duration
/fare are never trusted (verified by git grep).

## Dispatch model (single bounded wave)

`selectEligibleDrivers` reuses the authoritative BLOCK 03 evaluator
(`evaluateRideEligibility`) plus dispatch filters: same serviceAreaId, correct
vehicleType, approved, not blocked, `availabilityStatus == online`, no active
ride, recent location, within the configured radius. The candidate query is
**bounded** (`serviceAreaId + vehicleType + online`, hard cap `MAX_CANDIDATES = 25`
configurable) — never an unlimited collection read. Deterministic offers
`driverOffers/{rideId}_{driverId}` (15 s TTL) carry only a **safe coarsened
pickup preview**. Deterministic outcomes: offers created → ride stays
`searching`; zero candidates → `no_driver_available` (`NO_ELIGIBLE_DRIVERS`);
offer batch failure → `dispatch_failed` (`OFFER_BATCH_FAILED`). No global
pending-ride reads.

## Acceptance transaction (first-wins)

One Firestore transaction reads offer + ride + driver + wallet + hold doc, then
validates ownership, offer liveness/expiry, `ride.status == searching`, driver
online/not-busy/eligible, and the wallet gate. It atomically sets the ride to
`assigned` (+`acceptedDriverId`/`acceptedAt`), sets the driver `activeRideId`,
marks the offer `accepted`, and places the hold. A second driver committing
against an already-assigned ride gets a stable **`RIDE_ALREADY_ACCEPTED`**. After
commit, sibling offers are closed best-effort — a cleanup failure is logged
(`ride.offer_cleanup_failed`) and never reverses the accepted ride. An audit
record is written for the acceptance.

## Commission & wallet hold

During `commissionFreeUntil`: estimated commission and hold are **0**, wallet may
be R$0, no minimum. Afterwards the driver must be subscription-eligible AND keep
`walletAvailableCentavos > 300` AND cover `estimatedCommissionCentavos`. At
acceptance: `walletAvailableCentavos -= hold`, `walletHeldCentavos += hold`;
`walletBalanceCentavos` is **not** reduced (capture is BLOCK 09+10). A single
deterministic append-only `walletTransactions/{rideId}_hold`
(`type = commission_hold`, `status = held`) is created once — never twice.

## App integration (minimal, no redesign)

- `src/config/firebase.js` already exposes `functions`; `src/services/ridesService.js`
  provides `requestRide`, `acceptOffer`, `listenToRide`, `listenToMyOffer`.
- Passenger `confirm-price.jsx` calls `createRideRequestSecure` with real
  coordinates and navigates to `searching`; `searching.jsx` listens to the own
  ride and shows searching/assigned/no-driver in PT-BR (no fake success state).
- Driver `ride-request.jsx` listens to the own targeted offer, accepts via the
  secure callable, shows PT-BR errors, and after acceptance offers **Abrir no
  Waze** / **Abrir no Google Maps** navigation to the pickup (destination nav is
  BLOCK 09+10). The client never writes ride/offer/wallet/driver financial fields.

## Structured logs

`ride.create.started`, `ride.route.completed`, `ride.quote.created`,
`ride.dispatch.started`, `ride.dispatch.no_candidates`,
`ride.dispatch.offers_created`, `ride.accept.started`, `ride.accept.won`,
`wallet.hold.created`, `wallet.hold.duplicate_ignored`,
`ride.offer_cleanup_failed`. Exact coordinates, route payloads, PII, and secrets
are never logged (logger redaction + field discipline). App-facing errors use
stable PT-BR messages; internal causes stay server-side.

## Validation

- Functions tests: **79 PASS, 13 skipped** (10 new critical ride tests; skipped =
  emulator-gated).
- Root tests: **45/45 PASS**.
- Expo Doctor: **21/21 PASS**.
- `git diff --check`: **PASS**.
- Firestore Rules emulator: **NOT RUN — JDK 21 required**.
- fakeFirestore and the fake routing provider are test-only (git grep); runtime
  callables use the Firebase Admin SDK; runtime never reads client
  fare/commission/distance/duration/wallet fields (git grep).

### Critical tests (`functions/src/__tests__/rideDispatch.test.js`)

1. Unauthenticated ride creation rejected.
2. Pickup/destination outside Horizonte rejected.
3. Client fare/distance ignored; server quote used (+ routing failure writes no
   incomplete ride).
4. Only eligible matching drivers receive targeted offers.
5. No eligible driver → controlled `no_driver_available`.
6. Concurrent acceptance → exactly one winner.
7. Expired or foreign offer rejected.
8. Commission-free driver accepts with wallet R$0 and hold R$0.
9. Post-promotion driver requires eligibility, wallet > R$3 and enough balance.
10. Duplicate acceptance → exactly one wallet hold and one assignment.

## Not done (by instruction)

Ride completion, FCM, payment settlement/capture, multi-wave dispatch, deploy,
push, merge. No production credentials; a real Google Routes sandbox smoke test
is pending after `ROUTING_PROVIDER_API_KEY` is configured in Secret Manager.
