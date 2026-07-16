# BLOCK 11 + 12 — Admin Operations Manual Smoke

**Status: NOT RUN** — requires a Development/Production build, the `drivelocal-dev`
Firebase project, deployed Cloud Functions, and a provisioned admin account
(`admins/{uid}`). No production credentials; no deploy performed in this block.

Firestore Rules emulator tests are **NOT RUN** (JDK 21 unavailable). Physical
Android notification testing is out of scope for this block (BLOCK 09+10 status
unchanged).

## Preconditions
- Deployed BLOCK 11+12 callables on `drivelocal-dev`.
- One admin uid provisioned in `admins/{uid}` (server-side only).
- At least one approved driver and one driver with an active ride.
- One ride in `disputed` status with a retained commission hold.

## Checklist (mark PASS/FAIL only after real execution)
1. Unauthorized access — non-admin account cannot call any admin callable
   (permission-denied); admin screens show an unauthorized state.
2. Pending drivers — dashboard count matches; pending list loads (bounded).
3. Driver approval — approve a pending driver via the callable; founder number
   assigned within the first 100 per city; audit record created.
4. Founder assignment — approve past #100 in a city; #101 is non-founder; moto+car
   share the counter.
5. Driver rejection — reject with a mandatory reason; status `rejected`.
6. Suspension without active ride — suspend an approved driver; becomes
   `suspended`, availability cleared, no new offers received.
7. Suspension with active ride — attempt to suspend a driver on an active ride;
   rejected with the PT-BR conflict message; ride + hold untouched.
8. Reactivation — reactivate the suspended driver; back to `approved`, NOT online,
   wallet unchanged.
9. Dispute search — search a disputed ride by id; masked identities + safe
   payment/hold summary shown.
10. Dispute `confirm_driver_payment` — commission captured once, unused hold
    released, ride completed; re-run is a no-op.
11. Dispute `release_driver_hold` — full hold released once, ride cancelled.
12. Dispute `retain_for_manual_review` — hold unchanged, ride stays disputed.
13. Conflicting resolution — a second, different outcome on a resolved ride is
    rejected.
14. Wallet credit — available + balance increase; held unchanged.
15. Wallet debit — available + balance decrease.
16. Wallet insufficient debit — rejected; balances unchanged.
17. Wallet correction / reversal — new compensating ledger entry; original entry
    unchanged; reversal cannot be applied twice.
18. Duplicate idempotency — re-submitting the same adjustment applies it once.
19. Confirmation UI — every financial/destructive action asks for confirmation.
20. Audit verification — each sensitive action produced an `auditLogs` record with
    no CPF/Pix/token/coordinates.
