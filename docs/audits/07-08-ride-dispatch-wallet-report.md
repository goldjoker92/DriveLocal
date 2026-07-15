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

## Location UX finalization & exact-pickup closure

### Real address-provider status
- **GPS + geocoding: REAL and used** — `expo-location` provides current position,
  reverse geocode (`getCurrentLocationWithAddress`), and forward geocode of a full
  typed address (`resolveAddressToCoords` → `Location.geocodeAsync`). No invented
  coordinates: a query that resolves to nothing yields "not found" and the ride
  cannot be requested.
- **Typeahead autocomplete SUGGESTIONS: NOT configured → feature stopped, not
  faked.** Live suggestion lists require a Places provider that is not present.
  **ADDRESS_SEARCH_PROVIDER_CONFIGURATION_REQUIRED** — provider/API to enable:
  **Google Places Autocomplete (Places API New)**. **Key handling (important):**
  a Places key must **not** be read directly from mobile `src/` via Firebase
  Secret Manager (Secret Manager values are backend-only and must never reach the
  client). Future autocomplete must use **either** (a) a secured **backend
  callable** that reads the key from Secret Manager and returns only sanitized
  suggestions, **or** (b) a dedicated **Android-restricted client key** (package
  + SHA-restricted) used directly by the app. The value is never
  requested/printed/committed. No local/fake suggestions were committed.
- **Interactive map marker: NOT available** — `react-native-maps` is not installed,
  so map selection is **not implemented and not offered** (no map button, no
  placeholder map, no promise of map adjustment). Manual map adjustment is
  deferred until the map library is added.

### Pickup / destination options
Editable pickup and destination address fields. Pickup: **"Usar minha
localização"** (real GPS + reverse-geocoded label, or the safe label "Minha
localização atual") and **"Buscar"** (real forward geocode). Destination:
**"Buscar"** (real forward geocode). A resolved point continues **without** a
mandatory map step. Both selected locations are shown on the confirm screen with
an **"Editar locais"** action.

### GPS permission fallback
Permission denied / lookup error does not crash and does not re-prompt in a loop;
address search stays available; PT-BR notice (no map promise): _"Não foi possível
acessar sua localização. Busque e selecione um endereço para continuar."_

### Map-confirmation behavior
Not required for valid GPS/geocoded coordinates — the passenger continues
directly. No map-selection button is shown and no map adjustment is promised while
`react-native-maps` is absent; map-based selection is deferred until that real
feature exists.

### Idempotency-key reuse
The passenger confirm screen holds one idempotency key per request **attempt** in
a ref (`requestRide({ idempotencyKeyRef })`); a timeout/connection retry reuses
the same key so a retried request never creates a second ride.

### Exact-pickup privacy
Before acceptance, `driverOffers` carry only a coarsened `pickupPreview` (never
used for navigation); candidates never receive exact pickup, destination, or the
passenger rideRequest. Inside the successful first-wins transaction, the winning
offer alone is updated with `status = accepted`, `acceptedAt`, and `exactPickup`
(authoritative ride pickup). Losing/expired/failed offers never receive
`exactPickup`; destination stays withheld (BLOCK 09+10); no passenger PII is
copied; exact coordinates never appear in logs/audit (event
`ride.accept.exact_pickup_revealed` carries only rideId/offerId). `exactPickup`
persists on the winner's secured offer, so it is recovered after an app restart
via the driver's offer listener.

### Waze / Google Maps
After acceptance (and after restart recovery), the driver sees **Abrir no Waze**
and **Abrir no Google Maps**, both using `exactPickup` via encoded deep links
(`src/utils/maps.js`) — never the coarsened preview, no embedded turn-by-turn, no
Waze key, `ROUTING_PROVIDER_API_KEY` stays backend-only. If one app fails to open,
a PT-BR error is shown and the other option remains. Destination navigation is
BLOCK 09+10.

### Tests (increment)
`functions/src/__tests__/rideDispatch.test.js` — E1 winner receives `exactPickup`
only after a successful acceptance; E2 losing/expired/failed offers never receive
`exactPickup`; E3 a free-text address without resolved coordinates cannot request
a ride. Test 4 (no map confirmation for valid coordinates) is an **Android
physical smoke test** — the project has no RN UI-render test tooling, so adding a
UI framework was avoided per instruction.

### Android smoke-test checklist (post Secret Manager config)
Request a ride via GPS and via typed-address search (no map step); confirm the
searching→assigned transition; on the winning driver, open Waze and Google Maps to
the exact pickup; kill and reopen the driver app and confirm the accepted offer +
both buttons are recovered.

## Not done (by instruction)

Ride completion, FCM, payment settlement/capture, multi-wave dispatch, typeahead
autocomplete (provider not configured), interactive map marker (`react-native-maps`
not installed), deploy, push, merge. No production credentials; real Google Routes
and (future) Places sandbox smoke tests are pending Secret Manager configuration
and deployment to `drivelocal-dev`.
