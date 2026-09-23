# Driver cockpit v2

## Objective

The driver home screen is a compact operational cockpit instead of a stack of
independent technical cards. It presents only real driver data and keeps the
existing server-authoritative availability/GPS flow unchanged.

## Visual hierarchy

1. Compact profile card
   - approved status;
   - public display name, or first name fallback;
   - founder badge and number when applicable;
   - approved driver photo or initial;
   - vehicle type, brand, model, color and plate;
   - online/offline badge.
2. Availability card
   - current availability;
   - GPS work status;
   - `Começar a trabalhar` or `Parar de trabalhar`;
   - eligibility reason when work cannot start.
3. Real mini dashboard
   - rides and full Pix fare received today;
   - rides and full Pix fare received this week;
   - commission percentage only (`0%`, `12%`, `15%`);
   - wallet available balance and safe wallet status;
   - approval-based commission-free period;
   - total completed rides.

## No mock values

The examples from the product specification are not hardcoded. The cockpit never
contains fixed values such as `3 corridas`, `R$ 42,80`, `14 corridas` or
`R$ 186,40`.

A legacy profile without the new aggregate displays real zero values and explains
that daily/weekly totals begin updating after the next completed ride.

## Real completion aggregation

`driverCockpitStatsTrigger` listens to the first transition of a private ride to
`completed`.

It stores this server-owned map in `drivers/{uid}`:

```text
cockpitStats.version
cockpitStats.timeZone = America/Fortaleza
cockpitStats.dayKey
cockpitStats.weekKey
cockpitStats.todayRideCount
cockpitStats.todayReceivedCentavos
cockpitStats.weekRideCount
cockpitStats.weekReceivedCentavos
cockpitStats.lastCompletedAtMs
```

`received` means the full ride fare the passenger paid directly to the driver by
Pix. It is not fare minus DriveLocal commission.

The ride receives a private marker:

```text
cockpitStatsAppliedVersion = driver-cockpit-stats-v1
```

This prevents duplicate increments when Firestore retries an event.

## Time and delayed events

Day and week boundaries use `America/Fortaleza`. Weeks begin on Monday.

Firestore events are at-least-once and may arrive late. Aggregation rules are:

```text
newer period -> start new visible counters
same period  -> add count and fare
older period -> never roll visible day/week backwards
```

A delayed ride from yesterday may still add to the current week when both dates
share the same week. A ride from an older week does not alter the visible current
week.

## Availability invariants retained

The refactor does not weaken GPS/session safety:

- an active ride redirects to `/active-ride`;
- online becomes green only after the initial session-bound point is published;
- cached Firestore snapshots cannot stop GPS;
- a server-confirmed expired/revoked session stops local tracking;
- a reload never silently restores a ghost driver;
- pressing stop invalidates local tracking before the remote session is closed.

## Commercial presentation

The cockpit consumes the centralized commercial policy from blocks 11 and 12.

Allowed commission copy:

```text
0%
12%
15%
```

The cockpit does not show exact DriveLocal commission centavos.

Every approved driver sees 0% for 60 days after approval, then 12% Moto or
15% Carro. The permanent founder badge is independent of the rate.

## Wallet presentation

The cockpit shows the available balance and a closed status label:

```text
not_required_during_commission_free_period -> nenhuma recarga necessária
required / blocked                        -> recarga necessária
other                                     -> disponível para comissões
```

The screen does not infer wallet requirements from balance alone.

## Safe traces

Client events:

```text
[DRIVER_COCKPIT] summary.rendered
[DRIVER_COCKPIT] profile_photo.load_requested
[DRIVER_COCKPIT] profile_photo.load_succeeded
[DRIVER_COCKPIT] profile_photo.load_failed
```

The summary trace may contain status, policy mode, period keys and ride counts. It
does not contain display name, full name, plate or wallet amounts.

Server events:

```text
driver.cockpit_stats.started
driver.cockpit_stats.completed
driver.cockpit_stats.duplicate_ignored
driver.cockpit_stats.driver_missing
driver.cockpit_stats.failed
```

## Manual verification

1. Open an approved founder profile:
   - photo/name/vehicle are in one compact card;
   - founder number is visible;
   - commission shows `0%`;
2. Open an approved driver 101+ inside the 60-day window:
   - commission also shows `0%` regardless of ride count.
3. Open a post-window moto driver:
   - commission shows `12%`;
4. Open a post-window car driver:
   - commission shows `15%`.
5. Start work:
   - permission disclosure remains available;
   - button shows activation state;
   - green state appears only after GPS publication.
6. Stop work:
   - local tracking stops first;
   - cockpit becomes offline.
7. Complete a ride:
   - daily and weekly ride counts increment once;
   - received amount adds the full Pix fare;
   - a trigger replay does not increment twice.
8. Test near 00:00 Fortaleza and Monday boundary.
9. Test a small Android screen and enlarged font:
   - commercial metrics wrap instead of clipping.
10. Confirm the driver cannot write `cockpitStats` directly through Firestore rules.

## Deferred blocks

- permanent active-ride card: block 15;
- fixed active-ride actions: block 16;
- compact timed offer: block 17;
- real detailed wallet: block 18;
- last-three-rides history: block 20.

## Deployment rule

This block adds one Gen 2 Firestore trigger. No production Functions deployment,
merge or Android production build is performed without explicit approval. Run
both Jest suites before validation.
