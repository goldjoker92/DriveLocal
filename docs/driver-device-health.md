# Driver GPS and notification health

This document describes the Android driver-device readiness gate, safe logs and
manual regression checks. It intentionally contains no token, full identifier,
coordinate, address or passenger information.

## Availability invariant

A new server work session may be opened only after all blocking device checks
pass:

```text
Android physical device (except the explicit DEV simulator bypass)
location services enabled
foreground location granted
precise location enabled
background location granted
notification permission granted
native FCM token synchronized with the backend
```

The order is strict:

```text
Começar a trabalhar
→ explicit location disclosure when needed
→ [DRIVER_DEVICE] repair.requested
→ location permission repair
→ notification permission/token registration
→ [DRIVER_DEVICE] availability_preflight.completed
→ [DRIVER_AVAILABILITY] work_session.device_ready
→ setDriverAvailabilitySecure(online)
→ native GPS task + first session-bound point
→ green cockpit
```

When the preflight fails, `setDriverAvailabilitySecure(online)` is never called.
The UI receives `DRIVER_DEVICE_NOT_READY` plus one safe PT-BR message.

## Silent healthy state

No device-health card is rendered when all checks are healthy. On operational
driver routes the guard checks:

```text
on route entry
when the application returns to foreground
every 30 seconds while the route remains mounted
```

The guard is mounted once in the root layout and covers:

```text
driver home
ride offer
active ride
```

## Blocking issues

```text
services_disabled
foreground_required
foreground_precise_required
background_required
notifications_permission_required
notifications_settings_required
native_task_missing
location_unconfirmed
location_stale
```

A normal online work session without a ride is stopped local-first, then the
server session is closed best-effort. If the server call cannot complete, the
seven-minute lease remains the final safety timeout.

## Active-ride protection

An accepted active ride is never stopped by this global health guard.

```text
session.rideId present
→ display the blocking alert
→ log active_ride_preserved
→ do not call stopDriverOnlineTracking
→ do not call stopDriverWorkSession
```

The active-ride screen remains responsible for restoring and managing its own
higher-frequency GPS channel.

## Temporary notification failures

A notification permission denial is blocking. A temporary token synchronization
failure while the driver is already online is a warning because an immediate
automatic stop during a transient network failure would create unnecessary
session churn.

Before opening a new session, registration is strict and the same sync failure is
blocking.

## Safe local notification receipt

AsyncStorage stores only:

```text
status
atMs
role
appVersion
canAskAgain
reasonCode
```

It never stores:

```text
FCM token
installation token payload
email
phone
CPF
coordinates
address
```

The FCM token is used only in memory for the authenticated
`syncNotificationTokenSecure` call.

## Expected logs

Healthy preflight:

```text
[DRIVER_NOTIFICATIONS] registration.requested
[DRIVER_NOTIFICATIONS] registration.succeeded
[DRIVER_DEVICE] repair.completed
[DRIVER_DEVICE] availability_preflight.completed
[DRIVER_AVAILABILITY] work_session.device_ready
```

Routine guard check:

```text
[DRIVER_DEVICE] diagnostic.started
[DRIVER_DEVICE] diagnostic.completed
```

Native task repair:

```text
[DRIVER_DEVICE] tracking_repair.started
[DRIVER_LOCATION] foreground_heartbeat.native_task_repaired
[DRIVER_DEVICE] tracking_repair.completed
```

Automatic suspension without an active ride:

```text
[DRIVER_DEVICE] availability_suspension.started
[DRIVER_LOCATION] tracking_stop.succeeded
[DRIVER_AVAILABILITY] work_session.stop_succeeded
[DRIVER_DEVICE] availability_suspension.succeeded
```

Active ride preserved:

```text
[DRIVER_DEVICE] active_ride_preserved
```

No log may include a raw FCM token, full UID, location, address, CPF, phone, email
or Pix key.

## Manual Android regression test

1. Install the DEV APK on a physical Android device.
2. Sign in as an approved driver while GPS and notifications are enabled.
3. Open the driver cockpit. Confirm no health alert is visible.
4. Press **Começar a trabalhar** and confirm the healthy preflight sequence.
5. Turn notifications off in Android settings and return to DriveLocal.
6. Confirm the blocking notification card appears and the no-ride work session is
   stopped.
7. Press **ABRIR CONFIGURAÇÕES**, enable notifications and return. Confirm the card
   disappears after registration succeeds.
8. Disable precise location. Confirm the app asks for Android settings and does
   not open a new work session.
9. Start work again, then force-stop the location foreground service without an
   active ride. Confirm the guard attempts a repair before suspension.
10. Accept a test ride, then revoke notification permission. Confirm the alert is
    visible but the ride and active GPS session are preserved.
11. Restore permissions, complete/cancel the test ride and confirm normal online
    tracking can resume.

## Automated checks

```powershell
npm test
npm --prefix functions test
```

No Firebase deployment is required for this client-only device-health block.
