# BLOCK 13 — Horizonte DEV Deployment, Production & Google Play Readiness

**Branch:** `feature/dev-deploy-pilot-readiness`
**Scope:** Horizonte authoritative service area (official IBGE boundary), local
backend geofence, DEV/PROD separation, DEV Firebase deployment, seed preparation,
production + EAS + Google Play readiness. No production deploy. No push/merge. No
new EAS build.

## Horizonte / IBGE verification

- Canonical identity (`functions/src/config/serviceAreaIdentity.js`): serviceAreaId
  `HORIZONTE_CE_BR`, municipalityCode `2305233`, Horizonte/CE/BR,
  America/Fortaleza, BRL, pt-BR, boundaryVersion `2024.1`.
- Municipality code **2305233 verified** against the official IBGE malhas
  municipais API (returned `codarea: "2305233"` for Horizonte). Status: **READY**.

## Geometry source / version / checksum

- Source: **IBGE** Malhas Municipais (API v3 `malhas/municipios`, GeoJSON,
  SIRGAS 2000 / EPSG:4674). Imported ONCE by
  `scripts/geodata/import-horizonte-ibge.js`; never called at runtime.
- Artifact: `backend/firebase/config/service-areas/HORIZONTE_CE_BR.geojson`
  (Polygon, 84 coordinates, [lng,lat], closed ring, bbox
  `[-38.5704,-4.1452,-38.3725,-4.0414]`, checksum `c338d8886c8b…`,
  boundaryVersion `2024.1`). Only Horizonte geometry + safe metadata committed —
  no ZIP/SHP/DBF/Brazil/Ceará datasets. Status: **READY**.

## Legal boundary vs operational coverage

- `municipalityBoundary` = official IBGE geometry (immutable versioned reference).
- `operationalServicePolygon` = DriveLocal coverage; V1 decision: **operational
  polygon === municipality boundary** (`coverageMode: full_municipality`). A
  narrower polygon can be introduced later via config (`operationalPolygonVersion`)
  and must never exceed the municipality boundary.

## Local backend geofence

- `functions/src/geo/geo.js` `pointInServiceArea` — ray-casting Polygon/
  MultiPolygon, holes, [lng,lat]; fails closed on non-finite/empty.
- `functions/src/rides/createRideRequest.js` validates coordinate presence/type/
  range (lat −90..90, lng −180..180) before geofencing; `serviceAreaId` is
  server-owned (client fields rejected). Both pickup AND destination must be
  inside; Google Routes is called ONLY after both pass. Route polyline is NOT the
  authority (documented). Ride now persists `serviceAreaId`, `boundaryVersion`,
  `operationalPolygonVersion`. Status: **READY** (unit-verified;
  live path NOT RUN — see smoke doc).

## Business-flow service-area integration

Passenger (server resolves area, client cannot override, endpoints geofenced,
versions persisted); Driver (server-controlled serviceAreaId; suspension/approval
unchanged); Availability (blocked when suspended/ineligible via
`evaluateRideEligibility`); Dispatch (bounded query filters `serviceAreaId` +
`vehicleType` + online — no cross-city, no global pending reads, first-wins
preserved); Pricing (per area+vehicle, moto 12% / car 15%, minimums, driver net,
commission-free preserved, no dynamic pricing); Founders (first 100 approved per
`serviceAreaId`, moto+car combined, per-city counter, never reset). No literal
`if (city === "Horizonte")` branching — all data-driven. Pacajus NOT activated.

## DEV / PROD separation

- `.firebaserc`: `default` + `dev` → `drivelocal-dev`. **No `prod` alias** (no real
  production project exists). `firebase.json` now references
  `firestore.indexes`.
- Scripts (root `package.json`): `validate:env:dev|prod`, `validate:service-area`,
  `seed:service-area:dev|prod`, `deploy:firebase:dev|prod`, `verify:firebase:dev|prod`,
  `geodata:import:horizonte`. DEV uses literal `--project drivelocal-dev`. PROD
  mutation scripts fail closed unless `CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION`.
- Environment validator (`functions/scripts/validate-config.js`, non-mutating):
  rejects missing/unexpected project, wrong Horizonte code, missing/invalid
  artifact; prints safe summary + required secret NAMES only (never values).
  Forbidden projects (vigiapp-c7108, recapplus, requiredata-fd2a1, scinder-data)
  are unmapped → rejected. Status: **READY**.

## DEV deployment result

- `firebase deploy --only firestore:rules,firestore:indexes --project drivelocal-dev`
  → rules compiled and released; both composite indexes accepted. Status:
  **VERIFIED IN DEV**.
- **Functions DEV deploy: MANUAL / NOT RUN.** Reason: the functions bind Secret
  Manager secrets (`ROUTING_PROVIDER_API_KEY`, `MERCADO_PAGO_ACCESS_TOKEN`,
  `MERCADO_PAGO_WEBHOOK_SECRET`); their presence in `drivelocal-dev` could not be
  verified safely (`gcloud` unavailable in this environment; `firebase
  functions:secrets:access` would reveal values). Fail-closed: do NOT deploy
  functions until secret presence is confirmed out-of-band, then run
  `npm run deploy:firebase:dev`.

## DEV seed result

- Seed tool `functions/scripts/seed-service-area.js` (idempotent, `--project`
  gated, artifact-validated, merge-only, preserves counters/pricing/drivers/
  rides/wallets/audit). Config builder unit-tested. **DEV seed: NOT RUN** — needs
  Application Default Credentials (not available here) and the deployed backend.
  Safe action: authenticate ADC for `drivelocal-dev`, then
  `npm run seed:service-area:dev`.

## Firestore indexes

Added only for real queries (`backend/firebase/indexes/firestore.indexes.json`):
- `drivers` (`verificationStatus ASC`, `createdAt DESC`) — admin pending list / counts.
- `rideRequests` (`status ASC`, `updatedAt DESC`) — admin disputes list / counts.
Accepted in DEV. No speculative indexes.

## EAS / current-build status

Existing queued/remote EAS **development** build left untouched — no build,
prebuild, or native change performed. It contains only the commit/config
submitted when it started. `eas.json` profiles reviewed; a `preview` (internal)
profile was added (DEV backend, APK, internal distribution). `production` profile
targets an App Bundle + future prod Firebase (`APP_ENV=prod`). Package
`com.drivelocal.app` unchanged. See `docs/release/*`.

## Production preparation

Prepared, NOT deployed — see `docs/release/production-readiness-checklist.md`.
Real production Firebase project id, PROD secrets, PROD admin bootstrap, budget/
quota alerts, backup/rollback owners are **MANUAL VALUE REQUIRED**.

## Google Play readiness

Prepared, NOT submitted — see `docs/release/google-play-readiness.md`,
`data-safety-inventory.md`, `account-deletion-plan.md`. Listing assets, URLs,
test accounts are **MANUAL VALUE REQUIRED**; payments classification is **PLAY
PAYMENTS POLICY REVIEW REQUIRED**; privacy/data legal items **LEGAL REVIEW
REQUIRED**.

## Test results

- Functions: **115 passed / 13 skipped** (+12 in `serviceAreaGeo.test.js`:
  geometry load/validate, lng/lat order, checksum tamper, interior inside,
  Pacajus/Fortaleza outside, malformed rejected, deterministic edge, multi-city
  data-driven identity, seed builder idempotent + preserves fields). Root: 45/45.
  `expo install --check`: up to date. `expo-doctor`: 21/21. `git diff --check`: clean.
- Firestore Rules emulator: **NOT RUN** (JDK 21 unavailable) — but rules
  **compiled + deployed** in DEV, which validates syntax.

## Manual tests still NOT RUN

Physical Android smoke, full ride E2E, admin manual smoke, Functions DEV deploy,
DEV seed, Google Play submission, production Firebase deploy, production seed.
See release gates in `production-readiness-checklist.md`.
