# DriveLocal — Android live driver tracking

> Failure scenarios, fallbacks, logs and the build 24 fixes: see
> [`docs/ride-live-location.md`](../ride-live-location.md).

## Scope

- Driver current presence is published while the driver is online for dispatch.
- After acceptance, one current point is published to `activeRideLocations/{rideId}`.
- The passenger sees the car/moto move on a Google map.
- The foreground service keeps updates running while Waze/Google Maps is open.
- No route history is stored.
- Sharing stops before Pix payment and on cancellation, completion or dispute.

## Privacy and access

- The driver sees an in-app disclosure before background permission is requested.
- The active location is readable only by the ride passenger, accepted driver and admins.
- Other passengers and drivers cannot read it.
- `drivers/{uid}` remains unreadable to passengers.
- Current coordinates are never added to FCM payloads or application logs.

## Android Maps key

Use a key distinct from the backend Google Routes key.

Restrictions:

- API: Maps SDK for Android only
- Android package: `com.drivelocal.app`
- Certificate: SHA-1 of the EAS Android keystore used by the build

Store the value in the EAS `development` environment as
`GOOGLE_MAPS_ANDROID_API_KEY` with `sensitive` visibility. Never commit it.

## Local validation

```powershell
npx expo install react-native-maps
npm test
npm --prefix functions test
npx expo-doctor
npx expo config --type public
git diff --check
git status --short
```

## DEV deployment

```powershell
firebase deploy --only functions,firestore:rules --project drivelocal-dev
```

## Android build

The map library, API key, background permission and foreground-service metadata
are native configuration. A fresh development APK is mandatory.

```powershell
eas build --platform android --profile development --clear-cache
```

## Two-phone smoke

1. Sign in as an approved driver and tap `Disponível`.
2. Confirm the disclosure and grant precise + always-on location.
3. Sign in as passenger on the second phone and request a matching vehicle.
4. Accept the offer on the driver phone.
5. Verify the passenger map displays the correct moto/car and pickup.
6. Open Waze or Google Maps on the driver phone and physically move.
7. Verify the passenger marker continues updating and stale status appears after a GPS/network interruption.
8. Tap `Cheguei ao local`; verify the passenger status and notification.
9. Start the ride; verify the map target changes from pickup to destination.
10. Finish the ride; verify the live location document disappears before Pix payment.
11. Repeat once with cancellation and confirm the map/location document disappears.

## Known MVP boundary

This block provides a moving driver marker and current target. It does not yet
provide Google Places autocomplete, an in-app turn-by-turn navigator, a route
polyline or dynamically recalculated ETA.
