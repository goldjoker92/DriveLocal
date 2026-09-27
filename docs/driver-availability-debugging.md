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
server availabilityUpdatedAt is at most 20 minutes old
server locationUpdatedAt is at most 7 minutes old; GPS is bound to this session
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
approximately 2.5–3 minutes:

```text
[DRIVER_LOCATION] publish.throttled        reason=unchanged
[DRIVER_LOCATION] publish.succeeded        reason=heartbeat policyMode=online_idle
```

A seven-minute GPS deadline excludes new offers; the twenty-minute heartbeat
lease and forty-five-minute abandonment window are separate. Heartbeats cannot
refresh a GPS timestamp or bind an old position to a new session. A healthy idle
driver publishes a position roughly every 2.5–3 minutes without touching a button.

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
4. Confirm heartbeat publications roughly every 2.5–3 minutes and confirm the driver
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

## Availability truth (build 22)

The cockpit, profile badge and global banner use the same `driverDispatchVisibility`
result. Its core eligibility is imported directly from the pure backend
`functions/src/drivers/dispatchReadiness.js` policy. The mobile UI additionally
requires acknowledged profile/config snapshots, its own matching local session,
and a recent device diagnostic. Cached data is useful for display, never for a
green availability claim.

- 0–3 minutes: normal readiness, assuming all other gates pass.
- After 3 minutes: warning and recovery action; no promise that rides are arriving.
- GPS older than 7 minutes: excluded from new offers even with a fresh heartbeat.
- Session heartbeat older than 20 minutes: excluded but still recoverable.
- After 45 minutes without heartbeat: idle session can be closed transactionally.
- An accepted ride bypasses this cleanup and keeps its own tracking.

The monitor checks up to 100 online profiles per minute with a persistent cursor.
It records one incident and one personal notification (60-second TTL, 15-minute
cooldown), without waiting for passenger demand. It re-reads the exact session
inside a transaction. FCM processing drops alerts for recovered/replaced/stopped
sessions and active rides. A disconnected phone cannot be notified immediately.

Never interpret the raw `online` string as the number of drivers who can receive
a ride.

### Trace one interruption

| Event | Meaning / useful fields |
| --- | --- |
| `visibility.changed` | Mobile state/reason, `atMs`; emitted only when the visible state changes. |
| `recovery.started` | Explicit verification began; keep its `traceId`. |
| `recovery.succeeded` | Same trace: `ready` after fresh GPS + server read + device check, or `active_ride` when ride tracking takes priority. |
| `recovery.failed` | Same trace, stable `reason` code and `durationMs`; no raw error message. |
| `recovery.ui_timeout` | UI waited 20 seconds. The native/server attempt may still be pending; another tap joins that attempt. |
| `driver.availability.interrupted` | Committed server interruption: `driverIdHash`, `sessionIdHash`, `reason`, `notified`, `traceId`. |
| `driver.availability.recovered` | Server sees usable availability again. |
| `driver.availability.closed` | Server closed the exact idle session after abandonment or mandatory-update enforcement. |
| `driver.availability_monitor.completed` | Per-run scanned/interrupted/recovered/closed/notified/failed counts. |
| `driver.availability_monitor.failed` / `ride.dispatch.session_cleanup_failed` | Failure code and hashed driver correlation. |

Transition logs are written **after** the Firestore transaction commits, not
inside its retried callback. Stable healthy profiles do not generate one event
per minute. Server identifiers are one-way SHA-256 prefixes; client recovery logs
contain no account/session ID, address, GPS coordinates, phone or Pix key.

For a complaint, first identify the UI `state/reason`, then check the committed
server transition and the monitor summary. If readiness is healthy, continue to
the existing ride trace: proximity/wave selection, offer creation, FCM result,
accept/refuse/expire. FCM acceptance is not proof that a human saw the notification.

Detailed scenario and UX review: `docs/release/driver-availability-pr-87-review.md`.
