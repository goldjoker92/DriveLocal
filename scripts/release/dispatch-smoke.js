#!/usr/bin/env node
// @ts-check
// NON-MUTATING dispatch smoke test.
//
// Answers one question after a deploy: is continuous search actually behaving
// the way it was designed, on this project, right now? It reads recent rides,
// live driver supply and the deployed configuration, then prints a verdict.
//
// It never writes, never creates a ride, and never touches a driver. Safe to
// run against production at any time, including during an active shift.
//
// Usage:
//   node scripts/release/dispatch-smoke.js --project drivelocal-prod
//   node scripts/release/dispatch-smoke.js --project drivelocal-prod --hours 24
//
// Requires application default credentials with Firestore read access:
//   gcloud auth application-default login

// firebase-admin is a backend dependency and lives in functions/node_modules,
// not at the repository root. Node resolves from the file's own location, so it
// has to be pointed at explicitly rather than assumed to be hoisted.
const path = require('path');
function requireAdminSdk() {
  try {
    return require('firebase-admin');
  } catch (rootError) {
    try {
      return require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'));
    } catch (functionsError) {
      console.error(
        'firebase-admin not found. Install backend dependencies first:\n'
        + '  cd functions && npm install'
      );
      process.exit(1);
    }
  }
}

const admin = requireAdminSdk();
const C = require('../../functions/src/rides/constants');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const findings = [];
function ok(message) { findings.push({ level: 'ok', message }); }
function warn(message) { findings.push({ level: 'warn', message }); }
function fail(message) { findings.push({ level: 'fail', message }); }

const pct = (part, total) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : 'n/a');
const minutes = (ms) => `${(ms / 60000).toFixed(1)} min`;

/**
 * Continuous search must never answer "no driver" instantly again: that was the
 * behaviour that made the app look empty to passengers.
 */
function checkSearchDuration(rides) {
  const closed = rides.filter((r) => r.status === C.RIDE_STATUS.NO_DRIVER_AVAILABLE);
  if (closed.length === 0) {
    ok('no ride closed without a driver in the window');
    return;
  }

  const instant = closed.filter((r) => {
    const created = Number(r.createdAtMs || 0);
    const expires = Number(r.searchExpiresAtMs || 0);
    // A ride whose search window was never set, or which was closed before it
    // could plausibly have elapsed, means the instant refusal came back.
    return created > 0 && (expires <= 0 || expires - created < 60_000);
  });

  if (instant.length > 0) {
    fail(`${instant.length}/${closed.length} rides were closed with a search window under 60s`);
  } else {
    ok(`all ${closed.length} unserved rides ran a full search window`);
  }
}

/**
 * Waves only help if they actually run. A ride that searched for its whole
 * window with a single wave means the sweep is not firing.
 */
function checkWaves(rides) {
  const searched = rides.filter((r) => Number(r.searchExpiresAtMs || 0) > 0);
  if (searched.length === 0) {
    warn('no ride with a search window in this period — nothing to judge');
    return;
  }

  const withWaves = searched.filter((r) => Number(r.lastDispatchWaveAtMs || 0) > 0);
  const reWaved = searched.filter((r) => {
    const created = Number(r.createdAtMs || 0);
    const lastWave = Number(r.lastDispatchWaveAtMs || 0);
    return created > 0 && lastWave - created >= C.DISPATCH_WAVE_INTERVAL_MS;
  });

  if (withWaves.length === 0) {
    fail('no ride carries lastDispatchWaveAtMs — dispatch may be running old code');
  } else if (reWaved.length === 0) {
    warn('no ride was re-waved — dispatchSweepTask may not be running (check Cloud Scheduler)');
  } else {
    ok(`${reWaved.length}/${searched.length} rides received at least one extra wave`);
  }
}

/**
 * Where an unserved ride actually died. With drivers online, "no driver" has two
 * very different causes and they call for opposite answers:
 *
 *   - no offer was ever created  → the SELECTOR rejected everyone (radius,
 *     vehicle type, eligibility, stale session). A code/config problem.
 *   - offers went out and expired → drivers were reached and did not answer.
 *     A human problem: sound not heard, phone in a pocket, deliberate decline.
 *
 * Read from driverOffers, which is the only record of what was really sent.
 */
async function checkOfferReach(db, rides) {
  const unserved = rides.filter((r) => r.status === C.RIDE_STATUS.NO_DRIVER_AVAILABLE);
  if (unserved.length === 0) return;

  let noOffer = 0;
  let offered = 0;
  let declined = 0;
  let expired = 0;
  let totalOffers = 0;

  for (const ride of unserved) {
    const rideId = ride.rideId;
    if (!rideId) continue;
    const snap = await db.collection(C.DRIVER_OFFERS).where('rideId', '==', rideId).get();
    const offers = [];
    snap.forEach((doc) => offers.push(doc.data() || {}));

    totalOffers += offers.length;
    if (offers.length === 0) {
      noOffer += 1;
      continue;
    }
    offered += 1;
    offers.forEach((o) => {
      if (o.declineReason && o.declineReason !== 'expired_server') declined += 1;
      else expired += 1;
    });
  }

  console.log(`  unserved rides: ${unserved.length}`);
  console.log(`    no offer created      ${String(noOffer).padStart(4)}  ${pct(noOffer, unserved.length)}`);
  console.log(`    offers sent           ${String(offered).padStart(4)}  ${pct(offered, unserved.length)}`);
  console.log(`      offers total        ${String(totalOffers).padStart(4)}  (declined ${declined}, expired ${expired})`);
  console.log('');

  if (noOffer === unserved.length && unserved.length > 0) {
    fail(`no offer was created for any unserved ride — the selector rejected every driver`);
  } else if (noOffer > 0) {
    warn(`${noOffer}/${unserved.length} unserved rides never produced a single offer`);
  }

  if (offered > 0 && expired > 0 && declined === 0) {
    warn(`${expired} offers expired with no answer at all — drivers reached but not responding`);
  }
  if (declined > 0) {
    ok(`${declined} offers were explicitly declined — drivers did see them`);
  }
}

/**
 * The 2026-09-05 shape: drivers flagged online whose session dispatch has
 * already given up on. If this is non-zero, supply is being lost silently.
 */
function checkGhostDrivers(drivers, nowMs) {
  const online = drivers.filter((d) => d.availabilityStatus === 'online');
  if (online.length === 0) {
    warn('no driver online right now — supply, not dispatch, is the constraint');
    return;
  }

  const ghosts = online.filter((d) => {
    const ts = Number(d.availabilityUpdatedAtMs || 0);
    return ts > 0 ? nowMs - ts > C.AVAILABILITY_SESSION_MAX_AGE_MS : true;
  });

  const freshest = online.reduce((best, d) => {
    const ts = Number(d.availabilityUpdatedAtMs || 0);
    return ts > best ? ts : best;
  }, 0);

  if (ghosts.length > 0) {
    fail(`${ghosts.length}/${online.length} drivers are "online" but invisible to dispatch (ghost sessions)`);
  } else {
    ok(`all ${online.length} online drivers are dispatchable`);
  }
  if (freshest > 0) {
    ok(`freshest driver session: ${minutes(nowMs - freshest)} old`);
  }
}

/** Configuration actually deployed, not what the repository says. */
function checkConfiguration() {
  if (C.OFFER_TTL_SECONDS < 60) {
    fail(`OFFER_TTL_SECONDS is ${C.OFFER_TTL_SECONDS}s — late FCM delivery will eat the decision time`);
  } else {
    ok(`offer window ${C.OFFER_TTL_SECONDS}s, search window ${C.SEARCH_TTL_SECONDS}s`);
  }
  if (C.LOCATION_MAX_AGE_MS < 10 * 60 * 1000) {
    warn(`location window is only ${minutes(C.LOCATION_MAX_AGE_MS)} — a battery restriction will drop working drivers`);
  } else {
    ok(`location window ${minutes(C.LOCATION_MAX_AGE_MS)}, session lease ${minutes(C.AVAILABILITY_SESSION_MAX_AGE_MS)}`);
  }
}

async function main() {
  const projectId = arg('project');
  const hours = Number(arg('hours', '24'));
  if (!projectId) {
    console.error('missing --project');
    process.exit(1);
  }

  admin.initializeApp({ projectId });
  const db = admin.firestore();
  const nowMs = Date.now();
  const sinceMs = nowMs - hours * 60 * 60 * 1000;

  console.log(`\nDispatch smoke — ${projectId}, last ${hours}h\n`);

  const ridesSnap = await db
    .collection(C.RIDE_REQUESTS)
    .where('createdAtMs', '>=', sinceMs)
    .get();
  const rides = [];
  ridesSnap.forEach((doc) => rides.push(doc.data() || {}));

  const driversSnap = await db
    .collection(C.DRIVERS)
    .where('verificationStatus', '==', 'approved')
    .get();
  const drivers = [];
  driversSnap.forEach((doc) => drivers.push(doc.data() || {}));

  // Funnel first: the numbers everything else has to explain.
  const byStatus = rides.reduce((acc, r) => {
    const key = r.status || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const noDriver = byStatus[C.RIDE_STATUS.NO_DRIVER_AVAILABLE] || 0;
  const completed = byStatus[C.RIDE_STATUS.COMPLETED] || 0;

  console.log(`  rides: ${rides.length}`);
  Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      console.log(`    ${status.padEnd(22)} ${String(count).padStart(4)}  ${pct(count, rides.length)}`);
    });

  ['moto', 'car'].forEach((vehicleType) => {
    const subset = rides.filter((r) => r.vehicleType === vehicleType);
    const done = subset.filter((r) => r.status === C.RIDE_STATUS.COMPLETED).length;
    console.log(`    ${vehicleType.padEnd(22)} ${String(subset.length).padStart(4)}  completed ${pct(done, subset.length)}`);
  });
  console.log('');

  await checkOfferReach(db, rides);

  checkConfiguration();
  checkSearchDuration(rides);
  checkWaves(rides);
  checkGhostDrivers(drivers, nowMs);

  const icon = { ok: '  OK  ', warn: ' WARN ', fail: ' FAIL ' };
  findings.forEach((f) => console.log(`[${icon[f.level]}] ${f.message}`));

  const failed = findings.filter((f) => f.level === 'fail').length;
  console.log(
    `\n${rides.length} rides, ${completed} completed, ${noDriver} without a driver `
    + `(${pct(noDriver, rides.length)}).\n`
  );

  // Non-zero only on a real regression: a quiet night is not a failure.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`dispatch smoke failed: ${error?.message || error}`);
  process.exit(1);
});
