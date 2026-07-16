# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Phase active

BLOCK 09+10 complété (branche feature/notifications-ride-lifecycle, commit 5d5045d) :
- cycle de vie course : assigned → driver_arrived → in_progress → awaiting_payment → payment_marked_sent → completed (+ cancelled / disputed)
- 8 callables sécurisées + trigger processRideNotificationEvent (functions/src/rides/lifecycle.js, callables.js)
- confidentialité destination : exactDestination révélée au seul chauffeur gagnant à startRideSecure
- Pix direct passager → chauffeur, BR Code réel CRC16 (functions/src/pix/pixBrCode.js)
- règlement portefeuille transactionnel et idempotent (capture ≤ hold, ≥ 0, gratuit pendant commissionFreeUntil)
- notifications FCM natives Android (Firebase Admin Messaging) + outbox notificationEvents
- client 3 états foreground/background/killed : src/services/notificationsService.js, src/hooks/useRideNotifications.js
- 2 canaux Android : drivelocal-ride-offers (MAX), drivelocal-ride-status (HIGH)
- token natif via getDevicePushTokenAsync (jamais Expo push token)
- docs/audits/09-10-notifications-ride-lifecycle-report.md

Validations : functions 88 pass / 13 skipped, root 45/45, expo-doctor 21/21, expo install --check OK.

Prochaine étape : dev build Android → smoke test notifications réel (foreground/background/killed) sur téléphone. Émulateur Firestore NON exécuté (JDK 21 requis). Aucun deploy / push / merge.
