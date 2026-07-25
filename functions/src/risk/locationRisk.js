// @ts-check
// Driver GPS anomaly detection. The trigger compares only consecutive current
// points — DriveLocal still does not retain a route history. Coordinates are never
// copied into risk events or logs; only aggregate distance/speed is recorded.

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { createLoggerContext, logInfo, logWarning } = require('../logging/logger');
const { bestEffortRiskSignal } = require('./riskEngine');
const riskC = require('./constants');

const REGION = 'southamerica-east1';
const MAX_PLAUSIBLE_SPEED_KPH = 180;
const MAX_REPORTED_SPEED_MPS = 70;
const MIN_EVALUATION_SECONDS = 2;

function validPoint(value) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function haversineMeters(a, b) {
  const earthRadius = 6371000;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function analyzeLocationChange(before = {}, after = {}) {
  const from = validPoint(before.location);
  const to = validPoint(after.location);
  const beforeMs = Number(before.locationUpdatedAtMs || 0);
  const afterMs = Number(after.locationUpdatedAtMs || 0);
  if (!from || !to || beforeMs <= 0 || afterMs <= beforeMs) return null;

  const seconds = (afterMs - beforeMs) / 1000;
  if (seconds < MIN_EVALUATION_SECONDS) return null;
  const distanceMeters = haversineMeters(from, to);
  const calculatedSpeedKph = (distanceMeters / seconds) * 3.6;
  const reportedSpeedMps = Number(after.locationSpeedMps);
  const impossible = calculatedSpeedKph > MAX_PLAUSIBLE_SPEED_KPH
    || (Number.isFinite(reportedSpeedMps) && reportedSpeedMps > MAX_REPORTED_SPEED_MPS);

  return {
    impossible,
    distanceMeters: Math.round(distanceMeters),
    calculatedSpeedKph: Math.round(calculatedSpeedKph),
    reportedSpeedKph: Number.isFinite(reportedSpeedMps)
      ? Math.round(reportedSpeedMps * 3.6)
      : null,
    seconds,
    eventKey: `location_${afterMs}`,
  };
}

const driverLocationRiskTrigger = onDocumentUpdated(
  { document: 'drivers/{driverId}', region: REGION, retry: false },
  async (event) => {
    const driverId = event.params.driverId;
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const analysis = analyzeLocationChange(before, after);
    if (!analysis?.impossible) return null;

    const context = createLoggerContext({ functionName: 'driverLocationRiskTrigger', actorType: 'system' });
    try {
      await bestEffortRiskSignal({
        db: event.data.after.ref.firestore,
        clock: { now: () => Date.now() },
        context,
        actorType: riskC.ACTOR_TYPE.DRIVER,
        actorId: driverId,
        reasonCode: riskC.REASON.IMPOSSIBLE_GPS_SPEED,
        severity: riskC.SEVERITY.HIGH,
        recommendedAction: riskC.ACTION.REQUIRE_REVIEW,
        sourceType: 'driver_location',
        sourceId: driverId,
        eventKey: analysis.eventKey,
        metadata: {
          distanceMeters: analysis.distanceMeters,
          speedKph: Math.max(
            analysis.calculatedSpeedKph,
            Number(analysis.reportedSpeedKph || 0)
          ),
          result: 'impossible_speed',
        },
      });
      logInfo(context, 'risk.location_impossible_speed', {
        operation: 'location_risk',
        result: 'review_required',
        distanceMeters: analysis.distanceMeters,
        speedKph: analysis.calculatedSpeedKph,
      });
    } catch (error) {
      logWarning(context, 'risk.location_scan_failed', {
        operation: 'location_risk',
        internalMessage: error?.message,
      });
    }
    return null;
  }
);

module.exports = {
  MAX_PLAUSIBLE_SPEED_KPH,
  MAX_REPORTED_SPEED_MPS,
  MIN_EVALUATION_SECONDS,
  validPoint,
  haversineMeters,
  analyzeLocationChange,
  driverLocationRiskTrigger,
};
