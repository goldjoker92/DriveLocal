# Horizonte Pilot Operations Runbook

Minimal ops for the controlled Horizonte-CE pilot. Not an analytics platform.

## Expected deployed Functions (region southamerica-east1)
health; approve/reject/block/unblock/suspend/reactivateDriverSecure; activateSubscriptionSecure; createDriverPixPayment; getDriverPaymentStatus; reprocessDriverPayment; mercadoPagoWebhook; createRideRequestSecure; acceptDriverOfferSecure; markDriverArrived/startRide/finishRide/markPassengerPixSent/confirmDriverPixReceived/cancelRide/reportRidePaymentIssue/resolveRideDisputeSecure; syncNotificationTokenSecure; processRideNotificationEvent; adjustDriverWalletSecure.
Verify: `npm run verify:firebase:dev`.

## Daily pilot checklist
- Backend health check (health function) responds.
- Disputed-ride queue reviewed (admin `ride-disputes`).
- Suspended-driver queue reviewed.
- Failed FCM events (notificationEvents status `failed`/`partially_failed`) checked.
- Mercado Pago webhook errors checked (subscription/recharge only).
- Wallet inconsistencies checked (no negative balances; holds reconcile).
- Firebase quota/budget within limits.

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
