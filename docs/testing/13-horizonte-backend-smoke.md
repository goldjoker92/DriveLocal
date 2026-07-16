# BLOCK 13 — Horizonte Backend Smoke

Statuses: READY / VERIFIED IN DEV / MANUAL VALUE REQUIRED / NOT RUN.

## Automated (VERIFIED IN DEV / local)
- Boundary artifact loads + validates (Polygon, closed ring, checksum, versions) — VERIFIED (unit).
- Interior Horizonte point inside; Pacajus & Fortaleza outside; malformed coords rejected — VERIFIED (unit).
- Env validator rejects unexpected/forbidden projects — VERIFIED (`npm run validate:service-area`).
- Firestore Rules compiled + deployed to `drivelocal-dev`; indexes accepted — VERIFIED IN DEV.

## Requires deployed Functions + credentials (NOT RUN)
1. Functions DEV deploy — MANUAL: confirm secret names exist in `drivelocal-dev`, then `npm run deploy:firebase:dev`; verify all secure callables + `processRideNotificationEvent` in `southamerica-east1` via `npm run verify:firebase:dev`.
2. DEV seed — MANUAL: authenticate ADC, `npm run seed:service-area:dev`; confirm `cityPublicConfig/HORIZONTE_CE_BR` has `active:true`, boundary, versions; counters/pricing untouched.
3. Ride request inside Horizonte succeeds; pickup or destination outside is rejected with the PT-BR out-of-area message — NOT RUN.
4. Dispatch targets only same-serviceArea eligible drivers — NOT RUN.
5. Founder counter increments per approved driver (Horizonte counter) — NOT RUN.

## Safe verification commands
- `npm run validate:env:dev`
- `npm run verify:firebase:dev` (function list; no payloads)
- Firebase console: Firestore rules version, index build state.

Never print coordinates, addresses, route polylines, secrets, tokens, or Pix data during smoke.
