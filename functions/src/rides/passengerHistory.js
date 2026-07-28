'use strict';

// Authenticated, paginated passenger history. The Admin SDK reads private ride
// records, then returns a deliberately closed passenger view: no raw coordinates,
// driver uid, phone, email, Pix payload/key, commission hold or wallet data.

const admin = require('firebase-admin');
const { AppError, ERROR_CODES } = require('../errors/appError');
const { assertShape, validateIdentifier } = require('../validation/validators');
const { logInfo } = require('../logging/logger');
const C = require('./constants');

const PASSENGER_RIDE_HISTORY_VERSION = 'passenger-ride-history-v1';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 20;
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

function safeDriverFirstName(ride = {}) {
  const name = safeShortText(ride.acceptedDriverPublic?.name, '', 40);
  if (!name || name.includes('@')) return 'Motorista não atribuído';
  return name.split(' ')[0] || 'Motorista não atribuído';
}

function safeVehicleLabel(ride = {}) {
  const driver = ride.acceptedDriverPublic || {};
  const vehicleType = driver.vehicleType || ride.vehicleType;
  const typeLabel = vehicleType === 'moto' ? 'Moto' : vehicleType === 'car' ? 'Carro' : 'Veículo';
  const details = [driver.vehicleMake, driver.vehicleModel, driver.vehicleColor]
    .map((value) => safeShortText(value, '', 32))
    .filter(Boolean)
    .join(' • ');
  const plate = safeShortText(driver.vehiclePlate, '', 12).toUpperCase();
  return [typeLabel, details, plate].filter(Boolean).join(' • ');
}

function safeAmount(ride = {}) {
  const candidates = [
    ['final', ride.finalFareCentavos],
    ['final', ride.paymentAmountCentavos],
    ['estimated', ride.estimatedFareCentavos],
  ];
  for (const [kind, value] of candidates) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount >= 0) {
      return { amountCentavos: Math.floor(amount), amountKind: kind };
    }
  }
  return { amountCentavos: null, amountKind: 'unavailable' };
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

function safePassengerRideHistoryItem(rideId, ride = {}) {
  const amount = safeAmount(ride);
  const rideStatus = SAFE_RIDE_STATUSES.has(ride.status) ? ride.status : 'unknown';
  const vehicleType = ride.acceptedDriverPublic?.vehicleType || ride.vehicleType;
  return Object.freeze({
    rideId,
    createdAtMs: positiveInteger(ride.createdAtMs) || null,
    historyAtMs: historyTimestampMs(ride),
    driverFirstName: safeDriverFirstName(ride),
    vehicleType: vehicleType === 'moto' ? 'moto' : vehicleType === 'car' ? 'car' : null,
    vehicleLabel: safeVehicleLabel(ride),
    pickupLabel: safeShortText(ride.pickup?.label, 'Local de partida'),
    destinationLabel: safeShortText(ride.destination?.label, 'Destino'),
    amountCentavos: amount.amountCentavos,
    amountKind: amount.amountKind,
    rideStatus,
    pixStatus: pixHistoryStatus(ride),
  });
}

async function getPassengerRideHistory({ db, request, context }) {
  const passengerId = request?.auth?.uid;
  if (!passengerId) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      internalMessage: 'passenger history read without authentication',
    });
  }

  const payload = assertShape(request?.data || {}, {
    required: [],
    optional: ['limit', 'beforeCreatedAtMs', 'beforeRideId'],
  });
  const limit = historyPageSize(payload.limit);
  const beforeCreatedAtMs = payload.beforeCreatedAtMs == null
    ? null
    : positiveInteger(payload.beforeCreatedAtMs);
  const beforeRideId = payload.beforeRideId == null
    ? null
    : validateIdentifier(payload.beforeRideId, 'beforeRideId');
  if ((beforeCreatedAtMs && !beforeRideId) || (!beforeCreatedAtMs && beforeRideId)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, {
      internalMessage: 'passenger history cursor must include createdAtMs and rideId together',
      safeMetadata: { field: 'cursor' },
    });
  }

  let query = db.collection(C.RIDE_REQUESTS)
    .where('passengerId', '==', passengerId)
    .orderBy('createdAtMs', 'desc')
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc');
  if (beforeCreatedAtMs && beforeRideId) {
    query = query.startAfter(beforeCreatedAtMs, beforeRideId);
  }

  const snapshot = await query.limit(limit + 1).get();
  const docs = snapshot.docs || [];
  const hasMore = docs.length > limit;
  const visible = hasMore ? docs.slice(0, limit) : docs;
  const items = visible.map((doc) => safePassengerRideHistoryItem(doc.id, doc.data() || {}));
  const last = items[items.length - 1] || null;
  const nextCursor = hasMore && last?.createdAtMs
    ? { beforeCreatedAtMs: last.createdAtMs, beforeRideId: last.rideId }
    : null;

  logInfo(context, 'passenger.history.read', {
    operation: 'get_passenger_ride_history',
    result: 'succeeded',
    itemCount: items.length,
    hasMore,
    historyVersion: PASSENGER_RIDE_HISTORY_VERSION,
  });

  return {
    version: PASSENGER_RIDE_HISTORY_VERSION,
    items,
    nextCursor,
    hasMore,
  };
}

module.exports = {
  PASSENGER_RIDE_HISTORY_VERSION,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  historyPageSize,
  safeShortText,
  safeDriverFirstName,
  safeVehicleLabel,
  safeAmount,
  pixHistoryStatus,
  historyTimestampMs,
  safePassengerRideHistoryItem,
  getPassengerRideHistory,
};