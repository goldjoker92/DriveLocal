# Driver availability — 1.0.17 / Android 22

This release makes driver status reflect usable GPS, the current work session,
account eligibility, wallet readiness after the free period, and supported build
policy. It does not change fares, commission percentages, the 60-day promotion,
founder badges, dispatch wave radii or offer deadlines.

## What changes

- One pure backend/mobile readiness policy; one shared UI state for the cockpit,
  profile badge and banner. Cached or unconfirmed data displays “Verificando”.
- Warning after 3 minutes; GPS fresh up to 5 minutes, brief fallback up to 7.
  Beyond 7 minutes GPS excludes new offers even when session heartbeat is fresh.
- Recovery forces a usable native point, then reads the server before reporting
  success. Old native callbacks cannot be re-stamped as current GPS positions.
- Short GPS/network failures preserve the work session and automatic retries.
  An explicitly closed session requires the driver to start working again.
- Offers revalidate the driver inside their creation transaction. Acceptance also
  checks location freshness. A stopped/replaced/busy driver is not re-offered a ride.
- Cleanup rechecks the exact session transactionally. Renewals, replacement
  sessions and accepted rides are protected from stale scans.
- `monitorDriverAvailabilityTask` checks 100 online drivers per minute using a
  cursor. It records interruptions without waiting for a passenger request.
- One personal status-channel notification per interruption, 60-second TTL and
  15-minute cooldown. No broadcast. Obsolete alerts are discarded before FCM send.
- Firestore now accepts a GPS-free heartbeat for its current session only. It
  cannot refresh GPS or attach an old point to a new session. Recovery window:
  45 minutes, matching server/client abandonment policy.

## Verification

Automated coverage includes fresh heartbeat/stale GPS, cache, GPS permission loss,
missing/replaced sessions, heartbeat-only recovery, network read failure, delayed
native GPS callbacks, active ride preservation, transaction races, pagination,
notification deduplication/cooldown/expiry and Firestore ownership/session rules.

Required GitHub checks: existing mobile/Functions suites, plus **Driver availability
CI** (Firestore emulator and Android JavaScript export). This export is not an AAB.

## Release order (manual, after approval)

1. Review/merge this PR only after all checks pass. Pull the merged `main`, record
   `git rev-parse HEAD`, and use that same commit for Firebase and the remote AAB.
2. Deploy the rules and Functions together from that commit:

   ```powershell
   firebase deploy --only "functions,firestore:rules" --project drivelocal-prod
   ```

   New Function: `monitorDriverAvailabilityTask`.
   Updated code includes `processRideNotificationEvent`,
   `setDriverAvailabilitySecure`, ride creation/acceptance and dispatch task
   Functions through their shared dependencies. Deploying the complete Functions
   set avoids leaving an old dispatch entry point on a different freshness policy.
   No broadcast is sent by deployment. The scheduled monitor can notify an actually
   interrupted driver once it runs. No legacy Firestore data is deleted.
3. Build the remote AAB **1.0.17 / versionCode 22** from merged GitHub `main`.
   If Play already contains build 22, bump it before building; never reuse a code.
4. Run a two-phone smoke test: driver stays still/backgrounded for 12 minutes;
   passenger request is offered; acceptance, cancellation and payment still work.
   Test airplane mode/GPS off then recovery. The status must not turn green from
   cache or a heartbeat alone. Stop/restart the session and verify stale alerts
   and old offers cannot reopen it. During an accepted ride, cleanup must do nothing.
5. Publish on Google Play and wait for availability. Only then raise the minimum
   driver build to the actual published code using the existing release procedure.

No AAB, merge, deployment, mandatory-build change or broadcast is performed by
preparing this PR. Real Android background delivery and battery management must
still be checked on devices. A reachable session does not guarantee a nearby
driver or acceptance of a specific passenger request.
