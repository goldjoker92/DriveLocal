# Horizonte Pilot Operations Runbook

Minimal ops for the controlled Horizonte-CE pilot. Not an analytics platform.

## Expected deployed Functions (region southamerica-east1)
health; approve/reject/block/unblock/suspend/reactivateDriverSecure; createDriverPixPayment; getDriverPaymentStatus; reprocessDriverPayment; mercadoPagoWebhook; getRideQuoteSecure; createRideFromQuoteSecure; createRideRequestSecure (temporary compatibility); acceptDriverOfferSecure; markDriverArrived/startRide/finishRide/markPassengerPixSent/confirmDriverPixReceived/cancelRide/reportRidePaymentIssue/resolveRideDisputeSecure; syncNotificationTokenSecure; processRideNotificationEvent; adjustDriverWalletSecure.
Verify: `npm run verify:firebase:dev`.

## Daily pilot checklist
- Backend health check (health function) responds.
- Disputed-ride queue reviewed (admin `ride-disputes`).
- Suspended-driver queue reviewed.
- Failed FCM events (notificationEvents status `failed`/`partially_failed`) checked.
- Mercado Pago webhook errors and historical paid-plan review queue checked.
- Wallet inconsistencies checked (no negative balances; holds reconcile).
- Firebase quota/budget within limits.

## Release order for the new commercial rule

1. Review the changed Firestore rules and enable Firestore TTL on `rideQuotes.expiresAt`: unused quotes expire after three minutes; consumed quotes remain for 24 hours to recover a lost confirmation response. Verify the shared founder counter against approved drivers.
2. After access to the selected environment is authorized, run the read-only audit:
   `node scripts/release/audit-legacy-paid-plans.js --project-id=PROJECT_ID`.
   Exit code 2 lists opaque payment and driver IDs requiring provider verification or a documented human decision. Check manual Pix receipts and bank statements too: old admin activations may have no payment record. Refund or record `legacyResolutionReviewedAtMs` on the relevant payment/driver document with an audit trail before clearing the gate. Do not reset the driver's commission clock.
3. After validation and deployment authorization, deploy the new Functions and Firestore rules first. The backend exposes the quote callables, rejects old plan charges and still accepts legacy passenger requests while `requirePassengerQuote` is absent or false. Verify these behaviors before publishing the mobile build.
4. Publish the prepared `1.0.14` AAB (Android versionCode `19`) and confirm it is available on Google Play. Verify that updated passengers can quote and confirm a ride, and updated drivers open their existing accounts.
5. Once passengers can obtain the updated app, require a server quote for **every** newly created ride: run `node functions/scripts/set-required-passenger-quote.js --project PROJECT_ID --enforce true` in the authorized environment (production also requires `CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION`). Old passenger builds then receive a Play update message. Use `--enforce false` to roll back this switch if needed.
6. Only after Google Play offers build `19`, raise the mandatory minimum driver build to `19` with the existing build-policy script. This branch leaves both production switches unchanged.
7. Test older builds: no new plan Pix charge is created; the driver sees the Play update message. An old passenger build cannot create a ride once the quote requirement is enabled. Confirm the driver's original 60-day date survives the update.

## Safe log searches (Cloud Logging)
- By `traceId` (one per operation chain).
- By `operation` (e.g. `resolve_dispute`, `wallet.admin_adjustment`, `ride.create.started`).
- Categories: SERVICE_AREA, GEOFENCE, CONFIG, DEPLOY, SECURITY, RELEASE, RIDE, NOTIF, FCM, PIX, WALLET, ADMIN.
- Never rely on / expose coordinates, addresses, polylines, secrets, tokens, Pix, CPF.

## Monitoring (configure before production — MANUAL VALUE REQUIRED)
- Firebase budget + quota alerts; error/log alerts; FCM failure alert; webhook failure alert.

## Incident severity
- SEV1: money incorrectness / security exposure → stop affected flow, page rollback owner.
- SEV2: dispatch/notifications degraded → investigate, no data edits.
- SEV3: cosmetic/non-blocking → backlog.
Rollback owner + support escalation contacts: MANUAL VALUE REQUIRED. See `rollback-plan.md`.
