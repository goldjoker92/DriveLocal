# BLOCK 09+10 — Android notification physical smoke test

**Status: NOT RUN** — requires the `expo-notifications` client package (not yet
installed) and a Development/Production build on a real Android device, plus
`ROUTING_PROVIDER_API_KEY` configured in Secret Manager on `drivelocal-dev`.
Unit tests do not simulate Android foreground/background/killed states.

## Preconditions
- Install and configure `expo-notifications` (approval pending).
- Real Google account + Firebase Auth sign-in on the device.
- Android channels created before token retrieval: `drivelocal-ride-offers`,
  `drivelocal-ride-status`.
- Driver approved, online, with verified Pix in `privateDriverData`.

## Checklist
1. Token sync — sign in, confirm `syncNotificationTokenSecure` stored a real
   native Android token (active); sign out disables it.
2. Foreground — trigger a targeted offer; one notification is presented, no
   auto-navigation, no duplicate local fallback.
3. Background — tap the offer notification; app opens the correct `/ride-request`
   after access validation; Firestore reloads.
4. Killed / cold start — kill the app, trigger a ride-status notification, tap it;
   the app waits for auth + router readiness, routes once, reloads Firestore.
5. Lifecycle notifications — arrived / started / awaiting_payment /
   payment_marked_sent / completed / cancelled / disputed each deliver once to the
   correct recipient.
6. Invalid token — uninstall/reinstall to invalidate a token; confirm the
   `processRideNotificationEvent` trigger disables it (active=false).
7. Payloads — inspect delivered data: strings only (notificationId, eventType,
   rideId, offerId, recipientRole, route, traceId); no coordinates/address/Pix/PII.
8. Direct Pix — passenger sees amount + Pix copia-e-cola, copies it, pays a real
   driver Pix; driver confirms receipt → completion captures commission once.
9. Navigation — after start, driver opens Waze and Google Maps to the exact
   destination; if one app is missing, a PT-BR error shows and the other works.
