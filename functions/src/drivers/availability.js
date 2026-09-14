// @ts-check
// Server-authoritative driver work sessions. A driver being ride-eligible and a
// driver choosing to work now are deliberately separate concepts. The mobile app
// may request online/offline, but only this handler may open or revoke a session.

const crypto = require('crypto');
const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateEnum, validateIdentifier } = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const { evaluateRideEligibility, toMillis } = require('./eligibility');
const {
  MIN_SUPPORTED_DRIVER_BUILD_NUMBER,
  evaluateDriverBuildNumber,
} = require('./appVersion');
const rideC = require('../rides/constants');

const AVAILABILITY_VALUES = Object.freeze(['online', 'offline']);
const WORK_SESSION_MAX_AGE_MS = 7 * 60 * 1000;

function ts() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function buildAvailabilitySessionId(nowMs) {
  return `work_${Number(nowMs).toString(36)}_${crypto.randomBytes(10).toString('hex')}`;
}

function availabilityAgeMs(driver = {}, nowMs = Date.now()) {
  // Server timestamp first; epoch-ms is only a legacy/test fallback.
  const updatedAtMs = toMillis(driver.availabilityUpdatedAt)
    || Number(driver.availabilityUpdatedAtMs || 0);
  return updatedAtMs > 0 ? Math.max(0, Number(nowMs) - updatedAtMs) : Infinity;
}

function hasReusableSession(driver = {}, nowMs = Date.now()) {
  return driver.availabilityStatus === 'online'
    && typeof driver.availabilitySessionId === 'string'
    && driver.availabilitySessionId.length >= 16
    && availabilityAgeMs(driver, nowMs) <= WORK_SESSION_MAX_AGE_MS;
}

function safeAvailabilityView(driverId, driver = {}, extra = {}) {
  return {
    driverId,
    availabilityStatus: driver.availabilityStatus === 'online' ? 'online' : 'offline',
    availabilitySessionId: driver.availabilitySessionId || null,
    availabilityUpdatedAtMs: Number(driver.availabilityUpdatedAtMs || 0) || null,
    activeRideId: driver.activeRideId || null,
    ...extra,
  };
}

async function setDriverAvailability({ db, request, context, clock }) {
  const driverId = request?.auth?.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'availability change without authentication',
    });
  }

  const payload = assertShape(request?.data || {}, {
    required: ['availabilityStatus'],
    optional: ['availabilitySessionId', 'clientBuildNumber', 'clientVersion'],
  });
  const desired = validateEnum(
    payload.availabilityStatus,
    AVAILABILITY_VALUES,
    'availabilityStatus'
  );
  const requestedSessionId = payload.availabilitySessionId == null
    ? null
    : validateIdentifier(payload.availabilitySessionId, 'availabilitySessionId');
  const clientBuild = desired === 'online'
    ? evaluateDriverBuildNumber(payload.clientBuildNumber)
    : { supported: true, buildNumber: null };
  const clientVersion = typeof payload.clientVersion === 'string'
    ? payload.clientVersion.trim().slice(0, 32)
    : null;

  if (desired === 'online' && !clientBuild.supported) {
    throw new AppError(ERROR_CODES.APP_UPDATE_REQUIRED, {
      internalMessage: `driver ${driverId} uses unsupported app build ${String(payload.clientBuildNumber || 'missing')}`,
      safeMetadata: {
        reason: 'app_update_required',
        minimumBuildNumber: MIN_SUPPORTED_DRIVER_BUILD_NUMBER,
      },
    });
  }

  const driverRef = db.collection(rideC.DRIVERS).doc(driverId);
  const nowMs = Number(clock.now());

  const result = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(driverRef);
    if (!snapshot.exists) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
        internalMessage: `driver not found: ${driverId}`,
        safeMetadata: { field: 'driverId' },
      });
    }

    const driver = snapshot.data() || {};

    if (desired === 'online') {
      if (driver.activeRideId) {
        throw new AppError(ERROR_CODES.RIDE_IN_PROGRESS, {
          internalMessage: `driver ${driverId} already has active ride ${driver.activeRideId}`,
          safeMetadata: { reason: 'driver_has_active_ride' },
        });
      }

      const eligibility = evaluateRideEligibility(driver, clock);
      if (!eligibility.canReceiveRides) {
        throw new AppError(ERROR_CODES.DRIVER_NOT_ELIGIBLE, {
          internalMessage: `driver ${driverId} cannot open work session`,
          safeMetadata: {
            reason: driver.verificationStatus !== 'approved'
              ? 'not_approved'
              : driver.isBlocked === true
                ? 'blocked'
                : eligibility.riskRestricted
                  ? 'risk_restricted'
                  : eligibility.requiresSubscription
                    ? 'subscription_required'
                    : 'not_eligible',
          },
        });
      }

      const walletAvailable = Number(driver.walletAvailableCentavos || 0);
      if (!eligibility.commissionFree && !(walletAvailable > rideC.MIN_WALLET_BALANCE_CENTAVOS)) {
        throw new AppError(ERROR_CODES.WALLET_INSUFFICIENT, {
          internalMessage: `driver ${driverId} wallet ${walletAvailable} cannot open work session`,
          safeMetadata: { reason: 'wallet_low' },
        });
      }

      if (hasReusableSession(driver, nowMs)) {
        const versionUpdate = {
          availabilityClientBuildNumber: clientBuild.buildNumber,
          availabilityClientVersion: clientVersion,
          availabilityClientSessionId: driver.availabilitySessionId,
          availabilityClientUpdatedAtMs: nowMs,
          availabilityClientUpdatedAt: ts(),
          updatedAt: ts(),
        };
        tx.set(driverRef, versionUpdate, { merge: true });
        return {
          replay: true,
          after: { ...driver, ...versionUpdate },
        };
      }

      const availabilitySessionId = buildAvailabilitySessionId(nowMs);
      const update = {
        availabilityStatus: 'online',
        availabilitySessionId,
        availabilitySessionStartedAtMs: nowMs,
        availabilitySessionStartedAt: ts(),
        availabilityUpdatedAtMs: nowMs,
        availabilityUpdatedAt: ts(),
        availabilityClientBuildNumber: clientBuild.buildNumber,
        availabilityClientVersion: clientVersion,
        availabilityClientSessionId: availabilitySessionId,
        availabilityClientUpdatedAtMs: nowMs,
        availabilityClientUpdatedAt: ts(),
        // A new work session must publish a new point before dispatch can use it.
        locationAvailabilitySessionId: null,
        updatedAt: ts(),
      };
      tx.set(driverRef, update, { merge: true });
      return {
        replay: false,
        after: { ...driver, ...update, availabilityUpdatedAtMs: nowMs },
      };
    }

    if (driver.activeRideId) {
      throw new AppError(ERROR_CODES.RIDE_IN_PROGRESS, {
        internalMessage: `driver ${driverId} cannot go offline during ride ${driver.activeRideId}`,
        safeMetadata: { reason: 'driver_has_active_ride' },
      });
    }

    if (
      requestedSessionId
      && driver.availabilitySessionId
      && requestedSessionId !== driver.availabilitySessionId
    ) {
      throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, {
        internalMessage: `stale availability session for ${driverId}`,
        safeMetadata: { reason: 'STALE_AVAILABILITY_SESSION' },
      });
    }

    if (driver.availabilityStatus !== 'online' && !driver.availabilitySessionId) {
      return {
        replay: true,
        after: { ...driver, availabilityStatus: 'offline', availabilitySessionId: null },
      };
    }

    const update = {
      availabilityStatus: 'offline',
      availabilitySessionId: null,
      availabilitySessionEndedAtMs: nowMs,
      availabilitySessionEndedAt: ts(),
      availabilityUpdatedAtMs: nowMs,
      availabilityUpdatedAt: ts(),
      locationAvailabilitySessionId: null,
      availabilityClientSessionId: null,
      availabilityClientUpdatedAtMs: nowMs,
      availabilityClientUpdatedAt: ts(),
      updatedAt: ts(),
    };
    tx.set(driverRef, update, { merge: true });
    return {
      replay: false,
      after: { ...driver, ...update, availabilityUpdatedAtMs: nowMs },
    };
  });

  logInfo(context, desired === 'online'
    ? 'driver.work_session_started'
    : 'driver.work_session_stopped', {
    operation: 'set_driver_availability',
    result: result.replay ? 'idempotent_replay' : desired,
  });

  return safeAvailabilityView(driverId, result.after, { replay: result.replay });
}

module.exports = {
  AVAILABILITY_VALUES,
  WORK_SESSION_MAX_AGE_MS,
  availabilityAgeMs,
  hasReusableSession,
  buildAvailabilitySessionId,
  safeAvailabilityView,
  setDriverAvailability,
};
