# Debugging & Troubleshooting

## Wrong Firebase target prevention
- Every mutation script/CLI uses a literal `--project drivelocal-dev`; never rely on the active CLI project.
- `validate-config.js` rejects unknown/unexpected/forbidden projects (vigiapp-c7108, recapplus, requiredata-fd2a1, scinder-data are unmapped → fail).
- Symptom: "unknown/unexpected project id" → you targeted a non-DriveLocal project. Fix: pass the correct `--project`.

## Environment validation failures
- "APP_ENV contradicts project" → the profile env and project disagree; align `eas.json`/env with the target project.
- "production seed/deploy requires CONFIRM_PRODUCTION_DEPLOY" → intended guard; set the env var only for a real, approved prod release.

## Missing-secret metadata
- `firebase functions:secrets:access` reveals values — DO NOT use it to "check". Verify presence via console/`gcloud secrets list` (names only). If unavailable, mark MANUAL and confirm out-of-band before deploying functions.
- Functions deploy failing on a bound secret ⇒ the secret is absent in that project; create it (never paste the value into code/docs/logs), then redeploy.

## Invalid geometry
- Import/validate errors ("ring not closed", "coordinate out of range", "checksum mismatch", "bounding box outside Ceará window") ⇒ re-run `npm run geodata:import:horizonte` from the official IBGE source. Never hand-edit or fabricate geometry; if IBGE is unreachable, stop the geodata import only and document the blocker.

## Failed geofence
- Ride rejected out-of-area: confirm both pickup AND destination are inside the operational polygon; the route polyline is not the authority. Do not log coordinates — use the ride's `traceId`, `serviceAreaId`, `boundaryVersion`.

## Failed seed
- "unknown project" / "municipalityCode mismatch" / "artifact invalid" ⇒ fix the target or re-import. Seed is merge-only and idempotent; a rerun is safe and never resets counters/pricing.
- ADC missing ⇒ authenticate Application Default Credentials for the target project, then rerun.

## Failed Functions deploy
- Read the first concrete error (secret, API not enabled, build). Fix the smallest cause; retry only the failed step once (`npm run deploy:firebase:dev`). Do not retry in a loop.

## Failed Rules/index deploy
- Rules compile errors print the offending line — fix and redeploy. Index "already exists"/build pending is non-fatal; wait for the build. Rules default-deny, so a failure fails closed.

## Finding a traceId safely
- Each operation chain carries one `traceId`. Search Cloud Logging by `traceId` or `operation`. Safe fields: traceId, operation, environment, projectId, serviceAreaId, municipalityCode, boundaryVersion, operationalPolygonVersion, rideId, lifecycleStep, result, reasonCode, durationMs, adminIdHash, targetUserIdHash, tokenHash, amountCentavos.

## NEVER log
Exact coordinates; full addresses; route polylines; Secret Manager values; API keys; Mercado Pago tokens; Pix keys/payloads; FCM tokens; full CPF; private driver/passenger documents; raw Firestore documents; complete geometry coordinate arrays.

## Rollback & retry rules
See `rollback-plan.md`. Redeploy only the failed component; verify with `verify:firebase:<env>`; record the commit hash and incident.
