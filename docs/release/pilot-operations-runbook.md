# Horizonte Pilot Operations Runbook

Minimal ops for the controlled Horizonte-CE pilot. Not an analytics platform.

## Expected deployed Functions (region southamerica-east1)
health; approve/reject/block/unblock/suspend/reactivateDriverSecure; createDriverPixPayment; getDriverPaymentStatus; reprocessDriverPayment; mercadoPagoWebhook; getRideQuoteSecure; createRideFromQuoteSecure; createRideRequestSecure (temporary compatibility); acceptDriverOfferSecure; markDriverArrived/startRide/finishRide/markPassengerPixSent/confirmDriverPixReceived/cancelRide/reportRidePaymentIssue/resolveRideDisputeSecure; syncNotificationTokenSecure; sendDriverBroadcastSecure; sendPassengerBroadcastSecure; processRideNotificationEvent; adjustDriverWalletSecure.
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

Before merging or deploying, require green app/Functions tests, `npm run lint`,
`npx expo-doctor`, the configured `npm run release:check`, and a two-phone
Android ride/Pix/update smoke test. A source-only test pass is not a release pass.

1. Review the changed Firestore rules and enable Firestore TTL on `rideQuotes.expiresAt`: unused quotes expire after three minutes; consumed quotes remain for 24 hours to recover a lost confirmation response. Verify the shared founder counter against approved drivers.
2. After access to the selected environment is authorized, run the read-only audit:
   `node scripts/release/audit-legacy-paid-plans.js --project-id=PROJECT_ID`.
   Exit code 2 lists opaque payment and driver IDs requiring provider verification or a documented human decision. Check manual Pix receipts and bank statements too: old admin activations may have no payment record. Refund or record `legacyResolutionReviewedAtMs` on the relevant payment/driver document with an audit trail before clearing the gate. Do not reset the driver's commission clock.
3. After validation and deployment authorization, deploy the new Functions and Firestore rules first (`firebase deploy --only functions,firestore:rules --project drivelocal-prod` from the reviewed commit). This branch changes Firestore rules, but not indexes or Storage rules relative to its imported baseline. Check the PR diff and current production configuration before running the command. The backend exposes the quote callables, rejects old plan charges and still accepts legacy passenger requests while `requirePassengerQuote` is absent or false. Verify these behaviors before publishing the mobile build.
4. Before building, verify that versionCode `21` is strictly greater than every Android build already uploaded to Play Console. If not, raise the versionCode in `app.json` and update the build number below before building. Publish the prepared `1.0.16` AAB (Android versionCode `21` when available) and confirm it is available on Google Play. Verify that updated passengers can quote and confirm a ride, and updated drivers open their existing accounts.
5. Once Play offers the updated app, an admin can open **Comunicação → Avisar passageiros** and send the separate passenger push campaign inviting them to update to see the price before confirmation. Check the proposed Portuguese text and Play availability before confirming. The campaign creates only passenger events; it does not publish a driver announcement or notify drivers. Delivery depends on the device's push permission and a valid token, so the recipient count is an enqueue count, not a delivery guarantee. Do not send this announcement before Play offers the new version.
6. Require a server quote for **every** newly created ride: run `CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION node functions/scripts/set-required-passenger-quote.js --project drivelocal-prod --enforce true` in the authorized environment. On their next ride request, old passenger builds then display server text in Portuguese explaining that the new version shows the fare before confirmation, how to update through Google Play, and that their account is kept. An already installed old build cannot acquire a new update button remotely; test that the existing error label displays the full message. Use `--enforce false` to roll back this switch if needed.
7. Only after Google Play offers the new build, raise the mandatory minimum driver build to that exact published versionCode (normally `21`): `CONFIRM_PRODUCTION_DEPLOY=DRIVELOCAL_PRODUCTION node functions/scripts/set-minimum-driver-build.js --project drivelocal-prod --build 21 --enforce true`. If Play required a versionCode above `21`, use the actual published number. This branch leaves both production switches unchanged.
8. Test older builds: no new plan Pix charge is created; the driver sees the Play update message. An old passenger build can receive the separate push before asking for a ride if notifications are enabled. It displays the server update instructions on a ride request and cannot create a ride once the quote requirement is enabled. Confirm the driver's original 60-day date survives the update.

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
