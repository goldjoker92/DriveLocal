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

1. Review the changed Firestore rules and enable Firestore TTL on `rideQuotes.expiresAt` so unused three-minute quotes are removed automatically. Verify the shared founder counter against approved drivers.
2. After access to the selected environment is authorized, run the read-only audit:
   `node scripts/release/audit-legacy-paid-plans.js --project-id=PROJECT_ID`.
   Exit code 2 lists opaque payment and driver IDs requiring provider verification or a documented human decision. Check manual Pix receipts and bank statements too: old admin activations may have no payment record. Refund or record `legacyResolutionReviewedAtMs` on the relevant payment/driver document with an audit trail before clearing the gate. Do not reset the driver's commission clock.
3. Publish the prepared `1.0.14` AAB (Android versionCode `19`) and confirm it is available on Google Play. Verify that an updated driver opens their existing account.
4. Only then raise the mandatory minimum driver build to `19` with the existing build-policy script. The current code intentionally leaves the enforced build minimum unchanged.
5. Test an older build: it cannot create a plan Pix charge; it sees the update message and reaches Google Play. Confirm the 60-day date remains unchanged after updating.

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
