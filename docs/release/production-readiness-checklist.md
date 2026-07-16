# Production Readiness Checklist

Statuses: READY / VERIFIED IN DEV / MANUAL VALUE REQUIRED / POLICY REVIEW REQUIRED / LEGAL REVIEW REQUIRED / BLOCKED / NOT RUN.

## Release gates
### GATE 1 — Ready for DEV physical test
- DEV backend deployed: Rules+indexes VERIFIED IN DEV; **Functions NOT RUN** (secret presence MANUAL).
- Horizonte DEV seed verified: NOT RUN.
- EAS dev build installed: NOT RUN (build queued remotely, untouched).
- Passenger/driver accounts: MANUAL VALUE REQUIRED.
- Physical Android notification tests / ride E2E / Pix / wallet settlement / cancellation+dispute / admin smoke: NOT RUN.
**Gate status: BLOCKED (functions deploy + seed + physical tests pending).**

### GATE 2 — Ready for store internal/closed test
- DEV physical test passed: NOT RUN.
- Production config decided: MANUAL VALUE REQUIRED.
- Package/version confirmed: package `com.drivelocal.app` READY; versionCode strategy READY (see google-play-readiness).
- Privacy policy URL / support contact: MANUAL VALUE REQUIRED.
- Account deletion: prepared (see account-deletion-plan) — LEGAL REVIEW REQUIRED.
- Data Safety draft: prepared (see data-safety-inventory) — LEGAL REVIEW REQUIRED.
- Listing assets / test accounts: MANUAL VALUE REQUIRED.
- Play payment/policy review: POLICY REVIEW REQUIRED.
**Gate status: BLOCKED.**

### GATE 3 — Ready for production
- Real PROD Firebase project: **MANUAL VALUE REQUIRED** (do not invent an id; do not reuse `drivelocal-dev`).
- PROD secrets (`ROUTING_PROVIDER_API_KEY`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`): MANUAL VALUE REQUIRED.
- PROD backend deploy / PROD Horizonte seed / production AAB: NOT RUN.
- Play testing satisfied / review approval / rollback+monitoring active: NOT RUN.
**Gate status: BLOCKED.**

## Production Firebase preparation (prepared, not deployed)
- Distinct production Firebase project (separate from `drivelocal-dev`): MANUAL VALUE REQUIRED.
- Production Android Firebase app (package `com.drivelocal.app`, new `google-services.json`): MANUAL VALUE REQUIRED.
- `.firebaserc` `prod` alias: add ONLY after the real project exists.
- Cloud Functions region: `southamerica-east1` (confirm in prod).
- PROD Rules/indexes deploy: `CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION npm run deploy:firebase:prod` — NOT RUN.
- PROD service-area seed: `CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION npm run seed:service-area:prod` — NOT RUN.
- Production Secret Manager checklist / admin bootstrap / least-privilege IAM review / budget + quota alerts / error+log monitoring / Firestore backup+export plan / rollback (see rollback-plan) / post-deploy verification / incident contacts: MANUAL VALUE REQUIRED.

## Payments
- Mercado Pago = subscription + wallet recharge only. Ride payment = direct passenger→driver Pix. **Never** move ride payment to Mercado Pago. Google Play Billing NOT implemented. Classification: PLAY PAYMENTS POLICY REVIEW REQUIRED BEFORE PRODUCTION.
