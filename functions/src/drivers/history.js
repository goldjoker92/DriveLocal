'use strict';

// Authenticated, paginated driver history. The callable reads private ride records
// with Admin SDK privileges, then returns a deliberately closed projection: no raw
// coordinates, passenger uid, phone, payment payload, Pix key, hold amount or exact
// internal commission money crosses the trust boundary.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier } = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const C = require('../rides/constants');

const DRIVER_RIDE_HISTORY_VERSION = 'driver-ride-history-v1';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 20;
const SAFE_COMMISSION_BPS = new Set([0, 1200, 1500]);
const SAFE_RIDE_STATUSES = new Set(Object.values(C.RIDE_STATUS));

function positiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function historyPageSize(value) {
  const requested = positiveInteger(value) || DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

function safeShortText(value, fallback, maxLength = 72) {
  const text = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : '';
  return (text || fallback).slice(0, maxLength);
}

function safeFirstName(ride = {}) {
  const projected = ride.acceptedPassengerPublic?.firstName;
  const clean = safeShortText(projected, 'Passageiro', 40);
  return clean.includes('@') ? 'Passageiro' : clean.split(' ')[0] || 'Passageiro';
}

function safeCommissionBps(ride = {}) {
  const candidates = [
    ride.commercialPolicySnapshot?.commissionBpsAtAcceptance,
    ride.commissionPolicySnapshot?.commissionDisplayBps,
    ride.commissionDisplayBps,
  ];
  for (const value of candidates) {
    const bps = Number(value);
    if (SAFE_COMMISSION_BPS.has(bps)) return bps;
  }
  if (ride.commissionPolicySnapshot?.commissionFreeAtAcceptance === true) return 0;
  return null;
}

function safeFare(ride = {}) {
  const candidates = [
    ['final', ride.finalFareCentavos],
    ['final', ride.paymentAmountCentavos],
    ['estimated', ride.estimatedFareCentavos],
  ];
  for (const [kind, value] of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount >= 0) {
      return { fareCentavos: Math.floor(amount), fareKind: kind };
    }
  }
  return { fareCentavos: null, fareKind: 'unavailable' };
}

function pixHistoryStatus(ride = {}) {
  if (ride.status === C.RIDE_STATUS.COMPLETED) return 'received';
  if (ride.status === C.RIDE_STATUS.DISPUTED) return 'disputed';
  if (ride.status === C.RIDE_STATUS.PAYMENT_MARKED_SENT) return 'sent_by_passenger';
  if (ride.status === C.RIDE_STATUS.AWAITING_PAYMENT) return 'awaiting_payment';
  if (ride.status === C.RIDE_STATUS.CANCELLED) return 'not_applicable';
  return 'not_started';
}

function historyTimestampMs(ride = {}) {
  const candidates = [
    ride.completedAtMs,
    ride.cancelledAtMs,
    ride.passengerMarkedPaidAtMs,
    ride.awaitingPaymentAtMs,
    ride.startedAtMs,
    ride.driverArrivedAtMs,
    ride.acceptedAtMs,
    ride.createdAtMs,
  ];
  for (const value of candidates) {
    const timestamp = positiveInteger(value);
    if (timestamp > 0) return timestamp;
  }
  return null;
}

function safeDriverRideHistoryItem(rideId, ride = {}) {
  const fare = safeFare(ride);
  const rideStatus = SAFE_RIDE_STATUSES.has(ride.status)
    ? ride.status
    : 'unknown';
  return Object.freeze({
    rideId,
    acceptedAtMs: positiveInteger(ride.acceptedAtMs) || null,
    historyAtMs: historyTimestampMs(ride),
    passengerFirstName: safeFirstName(ride),
    pickupLabel: safeShortText(ride.pickup?.label, 'Local de partida'),
    destinationLabel: safeShortText(ride.destination?.label, 'Destino'),
    vehicleType: ride.vehicleType === 'moto' ? 'moto' : ride.vehicleType === 'car' ? 'car' : null,
    fareCentavos: fare.fareCentavos,
    fareKind: fare.fareKind,
    commissionBps: safeCommissionBps(ride),
    rideStatus,
    pixStatus: pixHistoryStatus(ride),
    completedAtMs: positiveInteger(ride.completedAtMs) || null,
    cancelledAtMs: positiveInteger(ride.cancelledAtMs) || null,
  });
}

async function getDriverRideHistory({ db, request, context }) {
  const driverId = request?.auth?.uid;
  if (!driverId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'driver history read without authentication',
    });
  }

  const payload = assertShape(request?.data || {}, {
    required: [],
    optional: ['limit', 'beforeAcceptedAtMs', 'beforeRideId'],
  });
  const limit = historyPageSize(payload.limit);
  const beforeAcceptedAtMs = payload.beforeAcceptedAtMs == null
    ? null
    : positiveInteger(payload.beforeAcceptedAtMs);
  const beforeRideId = payload.beforeRideId == null
    ? null
    : validateIdentifier(payload.beforeRideId, 'beforeRideId');
  if ((beforeAcceptedAtMs && !beforeRideId) || (!beforeAcceptedAtMs && beforeRideId)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'history cursor must include acceptedAtMs and rideId together',
      safeMetadata: { field: 'cursor' },
    });
  }

  let query = db.collection(C.RIDE_REQUESTS)
    .where('acceptedDriverId', '==', driverId)
    .orderBy('acceptedAtMs', 'desc')
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc');
  if (beforeAcceptedAtMs && beforeRideId) {
    query = query.startAfter(beforeAcceptedAtMs, beforeRideId);
  }
  const snapshot = await query.limit(limit + 1).get();
  const docs = snapshot.docs || [];
  const hasMore = docs.length > limit;
  const visible = hasMore ? docs.slice(0, limit) : docs;
  const items = visible.map((doc) => safeDriverRideHistoryItem(doc.id, doc.data() || {}));
  const last = items[items.length - 1] || null;
  const nextCursor = hasMore && last?.acceptedAtMs
    ? { beforeAcceptedAtMs: last.acceptedAtMs, beforeRideId: last.rideId }
    : null;

  logInfo(context, 'driver.history.read', {
    operation: 'get_driver_ride_history',
    result: 'succeeded',
    itemCount: items.length,
    hasMore,
    historyVersion: DRIVER_RIDE_HISTORY_VERSION,
  });

  return {
    version: DRIVER_RIDE_HISTORY_VERSION,
    items,
    nextCursor,
    hasMore,
  };
}

module.exports = {
  DRIVER_RIDE_HISTORY_VERSION,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  historyPageSize,
  safeShortText,
  safeFirstName,
  safeCommissionBps,
  safeFare,
  pixHistoryStatus,
  historyTimestampMs,
  safeDriverRideHistoryItem,
  getDriverRideHistory,
};
