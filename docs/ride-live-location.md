# Ride live location — flow, failures, fallbacks and debugging

Field incident 2026-09-27: passengers cancelled 8–9 minutes after acceptance
(`driver_delayed`, `driver_not_moving`) and confirmed they never saw the driver
approach on the map. This document is the reference for how the passenger map
stays alive, car and moto alike, and how to prove it in production.

## Flow

```text
driver phone ──(native task, every 5 s)──► activeRideLocations/{rideId}  ──► passenger map
     │                                     ▲
     └──► drivers/{id}.location ──(rideLocationMirrorTrigger)──┘  server relay
                                           ▲
                    monitorRideLiveLocationTask (every minute): relay, alerts, rideTrackingHealth
```

1. **Acceptance.** `acceptOffer` seeds the ride point with the driver's last
   profile point. The active-ride screen calls `attachActiveRideTracking`.
2. **Driver app (build 24+).** `driverLocationTracking.js`:
   - ride sampling is time-driven (`distanceInterval: 0`): a stopped car still
     publishes; `driverLocationPolicy` bounds writes to one every 8–15 s;
   - a failed first fix **keeps the ride session** (`active_ride.start_degraded`)
     instead of falling back to the online session, which never writes the ride
     point;
   - stage changes reuse the running service (`active_ride.stage_changed`);
     a service is never stopped while the app is in background
     (`native_task.restart_deferred`), because Android 12+ may refuse the restart;
   - `superviseActiveRideTracking` repairs every 10 s on the active-ride screen and
     every 60 s from the driver layout: restarts a stopped service in foreground,
     republishes a point older than 20 s (`active_ride.point_repaired`).
3. **Server (every installed build).** `functions/src/rides/liveLocationGuard.js`
   relays the accepted driver's session-bound profile point when it is newer than
   the ride point (true server time, exactly the nine rule-enforced keys), and
   records each ride in `rideTrackingHealth/{rideId}`.
4. **Passenger app (build 24+).** `RideTrackingMap.jsx` + the pure rules in
   `utils/rideLiveLocationPresentation.js`; the shared listeners in
   `passengerRideLiveListeners.js` re-attach after a terminal Firestore error
   (2 s, 5 s, 10 s, then 30 s).

## Failure scenarios

| Situation | Driver side | Server | Passenger sees |
|---|---|---|---|
| First GPS fix fails at acceptance | ride session kept, supervisor retries | relays any newer profile point | car appears with the first fix; the driver card says "Reconectando" |
| Driver stopped (light, not left yet) | time-driven sample every 5 s | — | fresh point |
| Android killed the service (Waze, battery) | restarted on next foreground / pulse | driver alert after 45 s | honest caption, reassurance after 60 s |
| Driver phone offline | points resume with network | alert + reassurance | "Sem sinal do motorista há X min. A corrida continua confirmada." + message button |
| Passenger phone offline | — | — | "Sem conexão no seu celular…" (never blames the driver) |
| Driver waiting at pickup | — | no alert by design | "Motorista no local de embarque." |
| During the ride, driver phone silent | supervisor | relay, incident recorded | passenger's own blue dot, distance from the passenger |
| Passenger phone clock behind the server | — | — | still fresh (5 min tolerance) |

## Logs and traces

- Driver console (`[DRIVER_LOCATION]`): `active_ride.start_degraded`,
  `native_task.restart_deferred`, `active_ride.stage_changed`,
  `active_ride.native_task_repaired`, `active_ride.point_repaired`,
  `active_ride.supervisor_blocked`.
- Driver production: one sanitized non-fatal report per ride and state,
  `driver.ride_tracking.degraded`, through `reportClientErrorSecure`
  (no coordinates, shortened ride reference).
- Passenger (development builds): `ride.map.tracking_state_changed` now carries
  `presentation` and `passengerOffline`; `ride.location.listener_retry_scheduled`.
- Server: `ride.live_point.mirrored|relayed|stale|recovered`,
  `ride.live_point_monitor.completed`.

## Measure in production

```bash
node scripts/release/ride-tracking-health.js --project drivelocal-prod --hours 24
firebase functions:log --only monitorRideLiveLocationTask --project drivelocal-prod
```

"Incidents par build" compares build 24 with older builds.

## Release (build 24, 1.0.19)

1. Merge, build the production AAB, publish to 100 %.
2. When Google Play offers 1.0.19 to everyone, send the driver WhatsApp notice.
3. A few hours later, raise the minimum driver build to 24. Passengers are not
   blocked: the server relay already protects older passenger builds.
