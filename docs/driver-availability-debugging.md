# Driver availability and GPS debugging

This document describes the server-owned driver work session, the expected log
sequence and the safest way to diagnose a missing ride offer without exposing a
full UID, location or session identifier.

## Core invariant

A driver may receive a new offer only when all of these values agree:

```text
server driver.availabilityStatus = online
server driver.availabilitySessionId = local availabilitySessionId
server driver.locationAvailabilitySessionId = availabilitySessionId
server availabilityUpdatedAt is less than 7 minutes old
server locationUpdatedAt is usable for dispatch
no activeRideId
ride eligibility is valid
```

The phone never writes `availabilityStatus` directly. It asks
`setDriverAvailabilitySecure` to open or close the work session, then every GPS
point carries the returned `availabilitySessionId`.

## Safe identifiers in logs

Client logs shorten identifiers to this form:

```text
abc123…9xyz
```

Do not paste complete UIDs, complete session IDs, Pix keys, phone numbers, CPF,
coordinates or signed Firebase Storage URLs into tickets or chat messages.

## Normal start-work sequence

Expected client sequence after **Começar a trabalhar**:

```text
[DRIVER_AVAILABILITY] work_session.start_requested
[DRIVER_AVAILABILITY] work_session.start_succeeded
[DRIVER_AVAILABILITY] cockpit.work_session_opened
[DRIVER_LOCATION] session_start.started
[DRIVER_LOCATION] native_task.started
[DRIVER_LOCATION] publish.succeeded       reason=forced
[DRIVER_LOCATION] session_start.succeeded
[DRIVER_AVAILABILITY] cockpit.available
```

Expected backend event:

```text
driver.work_session_started
```

The cockpit must remain red if the first session-bound point is not published.
A partial start is rolled back and produces:

```text
[DRIVER_LOCATION] session_start.failed
```

The `rollback` field explains whether the previous valid session was restored or
all local tracking was stopped.

## Idle driver heartbeat

The Android foreground service asks for a time-driven sample every 60 seconds,
even when the vehicle has not moved. Firestore does not receive every sample.
The adaptive policy normally logs throttling, then publishes one heartbeat at
approximately four minutes:

```text
[DRIVER_LOCATION] publish.throttled        reason=unchanged
[DRIVER_LOCATION] publish.succeeded        reason=heartbeat policyMode=online_idle
```

The seven-minute server lease is a safety timeout, not a button timeout. A
healthy idle driver stays available automatically because the four-minute
heartbeat renews the lease.

## Normal stop-work sequence

Expected sequence after **Parar de trabalhar**:

```text
[DRIVER_LOCATION] tracking_stop.started
[DRIVER_LOCATION] tracking_stop.succeeded
[DRIVER_AVAILABILITY] work_session.stop_requested
[DRIVER_AVAILABILITY] work_session.stop_succeeded
[DRIVER_AVAILABILITY] cockpit.unavailable
```

The local session is erased before the server call. Any Android point already in
the queue must log `publish.rejected` with `reason=stale_local_session` and must
not reach Firestore.

## Remote revocation

Block, suspension, financial review or an expired lease may close the session
without a cockpit button press. Expected event:

```text
[DRIVER_AVAILABILITY] layout.remote_session_revoked
```

or, while the cockpit is visible:

```text
[DRIVER_AVAILABILITY] cockpit.remote_session_revoked
```

The `reason` is one of:

```text
remote_offline
session_mismatch
lease_expired
```

A remote revocation stops normal online tracking and returns the driver to the
red state. An already assigned ride is excluded from this cleanup and keeps its
separate `activeRideLocations/{rideId}` tracking channel.

## Offer-session filtering

A merely offered ride belongs to the exact work session that created it. An old
notification or snapshot is ignored with:

```text
ride.driver_offer.stale_session_ignored
```

The server repeats the same validation during acceptance, so a stale client can
never win the ride.

Accepted rides are different: the acceptance transaction stores
`acceptedAvailabilitySessionId` on the ride. If AsyncStorage was cleared, active
ride tracking recovers that value and logs:

```text
[DRIVER_LOCATION] active_ride.session_recovered
```

## Active ride GPS modes

```text
assigned / driver_arrived: 15-second heartbeat or 25 metres
in_progress:               10-second heartbeat or 20 metres
```

The passenger-facing ride point is the critical write. If moderation revokes the
normal work session during a ride, the driver-profile heartbeat may be skipped,
but `activeRideLocations/{rideId}` continues until the ride becomes terminal.

## High-value error events

```text
[DRIVER_LOCATION] background_task.failed
[DRIVER_LOCATION] publish.rejected
[DRIVER_LOCATION] session_start.failed
[DRIVER_LOCATION] session_start.rollback_failed
[DRIVER_AVAILABILITY] foreground_heartbeat.failed
[DRIVER_AVAILABILITY] layout.reconciliation_failed
[AUTH_TRACKING_CLEANUP] account change blocked by active ride
ride.driver_offer.listener_failed
```

Always read these fields together:

```text
event
reason
result
mode
availabilitySessionId (shortened)
rideId (shortened)
atMs
```

## Manual regression test

1. Log in as an approved driver. Confirm the initial red state.
2. Press **Começar a trabalhar**. Confirm the exact normal sequence above.
3. Leave the phone still, app backgrounded and screen off for at least 12 minutes.
4. Confirm heartbeat publications around minutes 4 and 8 and confirm the driver
   still receives a new passenger request.
5. Press **Parar de trabalhar** and confirm no later point is accepted.
6. Go online again, create an offer, go offline and online again, then open the old
   notification. Confirm the old offer is ignored.
7. Accept a new ride, clear/restart the JavaScript process and reopen the same
   driver account. Confirm active ride tracking is recovered.
8. During an assigned ride, verify `assigned`; after pickup verify
   `driver_arrived`; after start verify `in_progress` in the logs.
9. End/cancel the ride and confirm normal work resumes only when the server work
   session is still valid.

## Required automated checks before merge

```powershell
npm test
npm --prefix functions test
```

Do not merge or deploy while either suite is red. Lint is intentionally outside
this feature unless the repository CI explicitly makes it blocking.
