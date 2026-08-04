#!/usr/bin/env node
'use strict';

// Destructive-but-self-cleaning PROD smoke test for the closed-test gate.
// Exercises deployed Auth, Places, Routes, dispatch, offer acceptance, map-state,
// ride lifecycle, Pix, wallet settlement and notification delivery pipeline.

const crypto = require('crypto');
const admin = require('firebase-admin');
const { loadFirebaseBuildConfig } = require('../../scripts/build/firebaseBuildConfig');
const { readServiceAccount } = require('../../scripts/release/googleServiceAccountAuth');
const C = require('../src/rides/constants');
const { buildMulticastMessage } = require('../src/notifications/processEvent');

const PROJECT_ID = 'drivelocal-prod';
const REGION = 'southamerica-east1';
const PACKAGE_NAME = 'com.drivelocal.app';
const SERVICE_AREA_ID = 'HORIZONTE_CE_BR';
const CONFIRMATION = 'DRIVELOCAL_PRODUCTION';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function boolEnv(name) {
  return ['1', 'true', 'yes'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function numberEnv(name, fallback, min, max) {
  const raw = String(process.env[name] || '').trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function firstSha1(value) {
  const raw = String(value || '').split(/[\s,;]+/).find(Boolean) || '';
  const normalized = raw.replace(/:/g, '').trim().toUpperCase();
  if (!/^[A-F0-9]{40}$/.test(normalized)) {
    throw new Error('ANDROID_APP_SIGNING_SHA1S contains no valid SHA-1');
  }
  return normalized;
}

function config() {
  if (process.env.CONFIRM_PRODUCTION_RIDE_E2E !== CONFIRMATION) {
    throw new Error(`set CONFIRM_PRODUCTION_RIDE_E2E=${CONFIRMATION}`);
  }
  const emailTemplate = required('PROD_RIDE_E2E_EMAIL_TEMPLATE');
  if (!emailTemplate.includes('{{RUN_ID}}')) {
    throw new Error('PROD_RIDE_E2E_EMAIL_TEMPLATE must contain {{RUN_ID}}');
  }
  const password = required('PROD_RIDE_E2E_PASSWORD');
  if (password.length < 12) throw new Error('PROD_RIDE_E2E_PASSWORD must be 12+ characters');

  return {
    emailTemplate,
    password,
    androidSha1: firstSha1(required('ANDROID_APP_SIGNING_SHA1S')),
    notificationSourceUid: String(process.env.PROD_RIDE_E2E_NOTIFICATION_SOURCE_UID || '').trim(),
    requireRealNotifications: boolEnv('PROD_RIDE_E2E_REQUIRE_REAL_NOTIFICATIONS'),
    notificationTimeoutMs: numberEnv(
      'PROD_RIDE_E2E_NOTIFICATION_TIMEOUT_MS', 120_000, 15_000, 300_000
    ),
    placeQuery: String(process.env.PROD_RIDE_E2E_PLACE_QUERY || 'Prefeitura de Horizonte').trim(),
    preferredVehicleType: String(process.env.PROD_RIDE_E2E_VEHICLE_TYPE || '').trim(),
    pickup: {
      lat: numberEnv('PROD_RIDE_E2E_PICKUP_LAT', -4.0933, -90, 90),
      lng: numberEnv('PROD_RIDE_E2E_PICKUP_LNG', -38.47145, -180, 180),
      label: 'Embarque teste E2E',
    },
    destination: {
      lat: numberEnv('PROD_RIDE_E2E_DESTINATION_LAT', -4.0980, -90, 90),
      lng: numberEnv('PROD_RIDE_E2E_DESTINATION_LNG', -38.4630, -180, 180),
      label: 'Destino teste E2E',
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runId() {
  return `ride-e2e-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function jsonResponse(response, label) {
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch (_error) { body = { raw: text.slice(0, 200) }; }
  }
  if (!response.ok || body.error) {
    const reason = body?.error?.message || body?.error?.status || `HTTP_${response.status}`;
    throw new Error(`${label}: ${String(reason).slice(0, 180)}`);
  }
  return body;
}

async function withTimeout(url, options, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function signUp({ apiKey, email, password, sha1 }) {
  const response = await withTimeout(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-android-package': PACKAGE_NAME,
        'x-android-cert': sha1,
      },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  return jsonResponse(response, 'Auth signup');
}

async function callCallable(projectId, name, idToken, data) {
  const response = await withTimeout(
    `https://${REGION}-${projectId}.cloudfunctions.net/${name}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    }
  );
  const body = await jsonResponse(response, name);
  return body.result ?? body.data;
}

async function waitDoc(ref, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const snap = await ref.get();
    last = snap.exists ? snap.data() : null;
    if (last && (!predicate || predicate(last))) return last;
    await sleep(1_500);
  }
  throw new Error(`${label} timed out; last status=${last?.status || 'missing'}`);
}

function eventId(rideId, eventType, suffix) {
  return `${rideId}_${eventType}_${suffix}`;
}

function notificationSpecs(rideId, passengerUid, driverUid) {
  return [
    [C.NOTIFICATION_EVENT.OFFER_CREATED, driverUid, driverUid, 'driver', '/ride-request', C.NOTIFICATION_CHANNELS.RIDE_OFFERS],
    [C.NOTIFICATION_EVENT.RIDE_ASSIGNED, 'passenger', passengerUid, 'passenger', '/driver-accepted', C.NOTIFICATION_CHANNELS.RIDE_STATUS],
    [C.NOTIFICATION_EVENT.RIDE_ARRIVED, 'passenger', passengerUid, 'passenger', '/driver-accepted', C.NOTIFICATION_CHANNELS.DRIVER_ARRIVAL],
    [C.NOTIFICATION_EVENT.RIDE_STARTED, 'passenger', passengerUid, 'passenger', '/driver-accepted', C.NOTIFICATION_CHANNELS.RIDE_STATUS],
    [C.NOTIFICATION_EVENT.RIDE_AWAITING_PAYMENT, 'passenger', passengerUid, 'passenger', '/pix-payment', C.NOTIFICATION_CHANNELS.RIDE_STATUS],
    [C.NOTIFICATION_EVENT.RIDE_PAYMENT_MARKED_SENT, 'driver', driverUid, 'driver', '/active-ride', C.NOTIFICATION_CHANNELS.RIDE_STATUS],
    [C.NOTIFICATION_EVENT.RIDE_COMPLETED, 'passenger', passengerUid, 'passenger', '/pix-payment', C.NOTIFICATION_CHANNELS.RIDE_STATUS],
    [C.NOTIFICATION_EVENT.RIDE_COMPLETED, 'driver', driverUid, 'driver', '/active-ride', C.NOTIFICATION_CHANNELS.RIDE_STATUS],
  ].map(([eventType, suffix, recipientUid, recipientRole, route, channelId]) => ({
    eventType, suffix, recipientUid, recipientRole, route, channelId,
  }));
}

function assertNotificationContract(spec) {
  const message = buildMulticastMessage({
    notificationId: `contract_${spec.eventType}`,
    eventType: spec.eventType,
    rideId: 'contract-ride',
    recipientUid: 'contract-user',
    recipientRole: spec.recipientRole,
    route: spec.route,
  }, ['contract-token']);

  assert(message.android?.notification?.channelId === spec.channelId,
    `${spec.eventType}: wrong Android channel`);
  assert(message.data?.route === spec.route, `${spec.eventType}: wrong route`);
  assert(message.data?.recipientRole === spec.recipientRole,
    `${spec.eventType}: wrong recipient role`);
  assert(Object.values(message.data || {}).every((v) => typeof v === 'string'),
    `${spec.eventType}: FCM data must be strings only`);
  if (spec.eventType === C.NOTIFICATION_EVENT.RIDE_ARRIVED) {
    assert(message.android.notification.sound === C.NOTIFICATION_SOUNDS.DRIVER_ARRIVAL,
      'arrival notification custom sound missing');
    assert(message.android.notification.priority === 'max',
      'arrival notification max priority missing');
  }
}

async function verifyNotification(db, rideId, spec, hasRealToken, timeoutMs) {
  assertNotificationContract(spec);
  const data = await waitDoc(
    db.collection(C.NOTIFICATION_EVENTS).doc(eventId(rideId, spec.eventType, spec.suffix)),
    (d) => ['sent', 'partially_failed', 'failed'].includes(d.status),
    timeoutMs,
    `notification ${spec.eventType}/${spec.recipientRole}`
  );
  assert(data.rideId === rideId, `${spec.eventType}: rideId mismatch`);
  assert(data.recipientUid === spec.recipientUid, `${spec.eventType}: recipient mismatch`);
  assert(data.recipientRole === spec.recipientRole, `${spec.eventType}: role mismatch`);
  assert(data.route === spec.route, `${spec.eventType}: route mismatch`);
  assert(Number(data.attemptCount || 0) >= 1, `${spec.eventType}: trigger not executed`);

  if (hasRealToken) {
    assert(['sent', 'partially_failed'].includes(data.status) && Number(data.successCount || 0) >= 1,
      `${spec.eventType}: FCM did not accept delivery (status=${data.status})`);
  } else {
    assert(data.status === 'failed' && data.failureReason === 'no_active_tokens',
      `${spec.eventType}: expected terminal no_active_tokens proof`);
  }
  console.log(`[PROD_RIDE_E2E] notification=${spec.eventType}/${spec.recipientRole} status=${data.status} OK`);
}

async function activeAndroidToken(db, sourceUid) {
  if (!sourceUid) return null;
  const snap = await db.collection(C.NOTIFICATION_TOKENS).where('uid', '==', sourceUid).limit(20).get();
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (d.active === true && d.platform === 'android' && typeof d.token === 'string' && d.token.length > 20) {
      return d.token;
    }
  }
  return null;
}

async function isolatedVehicleType(db, preferred) {
  const candidates = preferred ? [preferred] : ['car', 'moto'];
  if (candidates.some((value) => !C.VEHICLE_TYPES.includes(value))) {
    throw new Error('PROD_RIDE_E2E_VEHICLE_TYPE must be car or moto');
  }
  for (const vehicleType of candidates) {
    const snap = await db.collection(C.DRIVERS)
      .where('serviceAreaId', '==', SERVICE_AREA_ID)
      .where('vehicleType', '==', vehicleType)
      .where('availabilityStatus', '==', 'online')
      .limit(1)
      .get();
    if (snap.empty) return vehicleType;
  }
  throw new Error('no isolated vehicle lane: real PROD drivers are online; refusing to send test offers');
}

async function assertOnlyTestDriverOnline(db, vehicleType, driverUid) {
  const snap = await db.collection(C.DRIVERS)
    .where('serviceAreaId', '==', SERVICE_AREA_ID)
    .where('vehicleType', '==', vehicleType)
    .where('availabilityStatus', '==', 'online')
    .limit(3)
    .get();
  assert(snap.size === 1 && snap.docs[0].id === driverUid,
    'another PROD driver is online; refusing dispatch to avoid a real test offer');
}

async function deleteRefs(refs) {
  const errors = [];
  const seen = new Set();
  for (const ref of refs) {
    if (!ref || seen.has(ref.path)) continue;
    seen.add(ref.path);
    try { await ref.delete(); } catch (error) { errors.push(`${ref.path}:${error.message}`); }
  }
  if (errors.length) throw new Error(`cleanup delete failures: ${errors.join(' | ')}`);
}

async function cleanup({ db, auth, passengerUid, driverUid, rideId, offerId, specs, keys, tokenRefs }) {
  const refs = [];
  if (rideId) {
    refs.push(
      db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(rideId),
      db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_hold`),
      db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_capture`),
      db.collection(C.WALLET_TRANSACTIONS).doc(`${rideId}_release`),
      db.collection(C.RIDE_REQUESTS).doc(rideId)
    );
  }
  if (offerId) refs.push(db.collection(C.DRIVER_OFFERS).doc(offerId));
  for (const spec of specs || []) {
    refs.push(db.collection(C.NOTIFICATION_EVENTS).doc(eventId(rideId, spec.eventType, spec.suffix)));
  }
  for (const key of keys || []) refs.push(db.collection('idempotencyOperations').doc(key));
  refs.push(...(tokenRefs || []));

  if (rideId) {
    const [audits, offers, events] = await Promise.all([
      db.collection('auditLogs').where('targetId', '==', rideId).limit(100).get(),
      db.collection(C.DRIVER_OFFERS).where('rideId', '==', rideId).limit(100).get(),
      db.collection(C.NOTIFICATION_EVENTS).where('rideId', '==', rideId).limit(100).get(),
    ]);
    refs.push(
      ...audits.docs.map((doc) => doc.ref),
      ...offers.docs.map((doc) => doc.ref),
      ...events.docs.map((doc) => doc.ref)
    );
  }
  if (passengerUid) refs.push(db.collection(C.PASSENGERS).doc(passengerUid));
  if (driverUid) {
    refs.push(
      db.collection(C.PRIVATE_DRIVER_DATA).doc(driverUid),
      db.collection(C.DRIVERS).doc(driverUid)
    );
  }
  await deleteRefs(refs);
  if (passengerUid) await auth.deleteUser(passengerUid).catch(() => {});
  if (driverUid) await auth.deleteUser(driverUid).catch(() => {});
}

async function main() {
  const cfg = config();
  const build = loadFirebaseBuildConfig({
    env: { ...process.env, APP_ENV: 'prod', EAS_BUILD: '1' },
    packageName: PACKAGE_NAME,
  });
  if (build.firebaseProjectId !== PROJECT_ID) {
    throw new Error(`refusing project ${build.firebaseProjectId}; expected ${PROJECT_ID}`);
  }

  const serviceAccount = readServiceAccount(PROJECT_ID);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: PROJECT_ID });
  const db = admin.firestore();
  const auth = admin.auth();

  const id = runId();
  const passengerEmail = cfg.emailTemplate.replace('{{RUN_ID}}', `${id}-passenger`);
  const driverEmail = cfg.emailTemplate.replace('{{RUN_ID}}', `${id}-driver`);
  let passengerUid = null;
  let passengerToken = null;
  let driverUid = null;
  let driverToken = null;
  let rideId = null;
  let offerId = null;
  let vehicleType = null;
  let specs = [];
  const keys = [];
  const tokenRefs = [];
  let failure = null;

  console.log(`[PROD_RIDE_E2E] project=${PROJECT_ID} run=${id} started`);

  try {
    const [passengerAuth, driverAuth] = await Promise.all([
      signUp({ apiKey: build.firebaseConfig.apiKey, email: passengerEmail, password: cfg.password, sha1: cfg.androidSha1 }),
      signUp({ apiKey: build.firebaseConfig.apiKey, email: driverEmail, password: cfg.password, sha1: cfg.androidSha1 }),
    ]);
    passengerUid = passengerAuth.localId;
    passengerToken = passengerAuth.idToken;
    driverUid = driverAuth.localId;
    driverToken = driverAuth.idToken;
    assert(passengerUid && passengerToken && driverUid && driverToken, 'Auth response incomplete');
    console.log('[PROD_RIDE_E2E] stage=auth OK');

    vehicleType = await isolatedVehicleType(db, cfg.preferredVehicleType);
    const now = Date.now();
    const sessionId = `${id}-availability`;
    await Promise.all([
      db.collection(C.PASSENGERS).doc(passengerUid).set({
        uid: passengerUid,
        email: passengerEmail,
        fullName: 'Closed Test E2E Passenger',
        whatsApp: '00000000000',
        role: 'passenger',
        serviceAreaId: SERVICE_AREA_ID,
        activeRideId: null,
        createdAtMs: now,
        updatedAtMs: now,
      }),
      db.collection(C.DRIVERS).doc(driverUid).set({
        uid: driverUid,
        email: driverEmail,
        fullName: 'Closed Test E2E Driver',
        role: 'driver',
        serviceAreaId: SERVICE_AREA_ID,
        verificationStatus: 'approved',
        profileStatus: 'complete',
        vehicleStatus: 'complete',
        documentsStatus: 'approved',
        selfieStatus: 'approved',
        duplicateCheckStatus: 'clear',
        vehicleType,
        vehicleMake: 'DriveLocal',
        vehicleModel: 'E2E',
        vehicleColor: 'Branco',
        vehiclePlate: 'E2E0A00',
        isBlocked: false,
        financialReviewRequired: false,
        approvedAtMs: now - 90 * 24 * 60 * 60 * 1000,
        founderEligible: false,
        freeRideCountUsed: 5,
        subscriptionActive: true,
        subscriptionStatus: 'active',
        subscriptionExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
        availabilityStatus: 'online',
        availabilitySessionId: sessionId,
        locationAvailabilitySessionId: sessionId,
        availabilityUpdatedAtMs: now,
        location: { lat: cfg.pickup.lat, lng: cfg.pickup.lng },
        locationUpdatedAtMs: now,
        locationAccuracyMeters: 5,
        activeRideId: null,
        walletBalanceCentavos: 100000,
        walletAvailableCentavos: 100000,
        walletHeldCentavos: 0,
        completedRideCount: 0,
        createdAtMs: now,
        updatedAtMs: now,
      }),
      db.collection(C.PRIVATE_DRIVER_DATA).doc(driverUid).set({
        uid: driverUid,
        pixKey: driverEmail,
        pixKeyType: 'email',
        pixOwnerName: 'DriveLocal E2E',
        createdAtMs: now,
        updatedAtMs: now,
      }),
    ]);
    await assertOnlyTestDriverOnline(db, vehicleType, driverUid);
    console.log(`[PROD_RIDE_E2E] stage=profiles_driver_eligibility vehicle=${vehicleType} OK`);

    const realToken = await activeAndroidToken(db, cfg.notificationSourceUid);
    if (cfg.requireRealNotifications && !realToken) {
      throw new Error('required active Android FCM token not found for notification source uid');
    }
    if (realToken) {
      for (const [uid, role] of [[passengerUid, 'passenger'], [driverUid, 'driver']]) {
        const ref = db.collection(C.NOTIFICATION_TOKENS).doc(`${uid}_prodRideE2e`);
        tokenRefs.push(ref);
        await ref.set({
          uid,
          token: realToken,
          installationId: 'prodRideE2e',
          platform: 'android',
          appVersion: 'prod-ride-e2e',
          role,
          active: true,
          lastSeenAtMs: now,
        });
      }
    }
    console.log(`[PROD_RIDE_E2E] stage=notification_token mode=${realToken ? 'REAL_FCM' : 'TRIGGER_ONLY'} OK`);

    const places = await callCallable(PROJECT_ID, 'searchPlaceSuggestionsSecure', passengerToken, {
      query: cfg.placeQuery,
      serviceAreaId: SERVICE_AREA_ID,
      sessionToken: `${id}-places`,
      limit: 3,
    });
    assert(places?.version === 'places-autocomplete-v1', 'Places version mismatch');
    assert(Array.isArray(places.items) && places.items.length > 0, 'Places returned no suggestions');
    console.log(`[PROD_RIDE_E2E] stage=places suggestions=${places.items.length} OK`);

    await assertOnlyTestDriverOnline(db, vehicleType, driverUid);
    const createKey = `${id}-create`;
    keys.push(createKey);
    const created = await callCallable(PROJECT_ID, 'createRideRequestSecure', passengerToken, {
      vehicleType,
      pickup: cfg.pickup,
      destination: cfg.destination,
      idempotencyKey: createKey,
    });
    rideId = created?.rideId;
    assert(rideId, 'rideId missing');
    assert(created.status === C.RIDE_STATUS.SEARCHING, `dispatch status=${created.status}`);
    assert(Number(created.routeDistanceMeters) > 0, 'route distance missing');
    assert(Number(created.routeDurationSeconds) > 0, 'route duration missing');
    assert(Number(created.estimatedFareCentavos) > 0, 'fare missing');
    offerId = `${rideId}_${driverUid}`;
    specs = notificationSpecs(rideId, passengerUid, driverUid);
    console.log('[PROD_RIDE_E2E] stage=routes_quote_dispatch OK');

    const offer = await waitDoc(
      db.collection(C.DRIVER_OFFERS).doc(offerId),
      (d) => d.status === C.OFFER_STATUS.OFFERED,
      30_000,
      'driver offer'
    );
    assert(offer.driverId === driverUid, 'offer targeted wrong driver');

    const acceptKey = `${id}-accept`;
    keys.push(acceptKey);
    const accepted = await callCallable(PROJECT_ID, 'acceptDriverOfferSecure', driverToken, {
      offerId,
      idempotencyKey: acceptKey,
    });
    assert(accepted?.status === C.RIDE_STATUS.ASSIGNED, `accept status=${accepted?.status}`);

    const tracking = await waitDoc(
      db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(rideId),
      (d) => d.driverId === driverUid,
      20_000,
      'active map location'
    );
    assert(Number.isFinite(Number(tracking.location?.lat)), 'map latitude missing');
    assert(Number.isFinite(Number(tracking.location?.lng)), 'map longitude missing');
    console.log('[PROD_RIDE_E2E] stage=offer_accept_map_backend OK');

    const lifecycle = async (name, token, expected) => {
      const key = `${id}-${name}`.slice(0, 190);
      keys.push(key);
      const result = await callCallable(PROJECT_ID, name, token, { rideId, idempotencyKey: key });
      assert(result?.status === expected, `${name} status=${result?.status}; expected=${expected}`);
      return waitDoc(
        db.collection(C.RIDE_REQUESTS).doc(rideId),
        (d) => d.status === expected,
        20_000,
        `${name} ride status`
      );
    };

    await lifecycle('markDriverArrivedSecure', driverToken, C.RIDE_STATUS.DRIVER_ARRIVED);
    await lifecycle('startRideSecure', driverToken, C.RIDE_STATUS.IN_PROGRESS);
    const awaiting = await lifecycle('finishRideSecure', driverToken, C.RIDE_STATUS.AWAITING_PAYMENT);
    assert(typeof awaiting.paymentPixPayload === 'string' && awaiting.paymentPixPayload.length > 30,
      'Pix payload missing');
    assert(!(await db.collection(C.ACTIVE_RIDE_LOCATIONS).doc(rideId).get()).exists,
      'map location not cleared after finish');
    await lifecycle('markPassengerPixSentSecure', passengerToken, C.RIDE_STATUS.PAYMENT_MARKED_SENT);
    await lifecycle('confirmDriverPixReceivedSecure', driverToken, C.RIDE_STATUS.COMPLETED);
    console.log('[PROD_RIDE_E2E] stage=arrival_start_pix_complete OK');

    const [rideSnap, passengerSnap, driverSnap] = await Promise.all([
      db.collection(C.RIDE_REQUESTS).doc(rideId).get(),
      db.collection(C.PASSENGERS).doc(passengerUid).get(),
      db.collection(C.DRIVERS).doc(driverUid).get(),
    ]);
    const finalRide = rideSnap.data() || {};
    const finalPassenger = passengerSnap.data() || {};
    const finalDriver = driverSnap.data() || {};
    assert(finalRide.status === C.RIDE_STATUS.COMPLETED, 'final ride not completed');
    assert(finalPassenger.activeRideId == null, 'passenger activeRideId not cleared');
    assert(finalDriver.activeRideId == null, 'driver activeRideId not cleared');
    assert(Number(finalDriver.walletHeldCentavos || 0) === 0, 'wallet hold not settled');
    assert(Number(finalDriver.completedRideCount || 0) === 1, 'completedRideCount wrong');
    assert(Number(finalRide.commissionCapturedCentavos || 0) > 0, 'commission not captured');
    console.log('[PROD_RIDE_E2E] stage=wallet_profiles_final_invariants OK');

    const projectedOffer = await waitDoc(
      db.collection(C.DRIVER_OFFERS).doc(offerId),
      (d) => Boolean(
        d.driverOfferReceivedStatsAppliedVersion
        && d.driverOfferAcceptedStatsAppliedVersion
        && d.acceptedPassengerPublic?.firstName
      ),
      90_000,
      'offer background projections'
    );
    assert(projectedOffer.acceptedPassengerPublic.firstName === 'Closed',
      'accepted passenger public identity projection mismatch');
    await waitDoc(
      db.collection(C.RIDE_REQUESTS).doc(rideId),
      (d) => Boolean(d.driverRideTerminalStatsAppliedVersion && d.cockpitStatsAppliedVersion),
      90_000,
      'terminal background projections'
    );
    console.log('[PROD_RIDE_E2E] stage=background_triggers performance+cockpit+identity OK');

    for (const spec of specs) {
      await verifyNotification(db, rideId, spec, Boolean(realToken), cfg.notificationTimeoutMs);
    }
    console.log('[PROD_RIDE_E2E] stage=notifications event+trigger+payload OK');
    console.log('[PROD_RIDE_E2E] ✅ ALL PROD E2E CHECKS PASSED');
  } catch (error) {
    failure = error;
    console.error(`[PROD_RIDE_E2E] FAILED ${String(error?.message || error).slice(0, 240)}`);
  } finally {
    try {
      await cleanup({
        db, auth, passengerUid, driverUid, rideId, offerId, specs, keys, tokenRefs,
      });
      console.log('[PROD_RIDE_E2E] cleanup OK');
    } catch (cleanupError) {
      console.error(`[PROD_RIDE_E2E] CLEANUP_FAILED ${cleanupError.message}`);
      if (!failure) failure = cleanupError;
    }
  }

  if (failure) throw failure;
}

main().catch(() => { process.exitCode = 1; });
