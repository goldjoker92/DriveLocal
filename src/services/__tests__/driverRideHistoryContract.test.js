const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('real driver history and performance contract', () => {
  it('exports an authenticated paginated history callable with a closed projection', () => {
    const index = source('functions/src/index.js');
    const callables = source('functions/src/drivers/callables.js');
    const history = source('functions/src/drivers/history.js');

    expect(index).toContain('exports.getDriverRideHistorySecure');
    expect(callables).toContain("bind('getDriverRideHistorySecure', getDriverRideHistory)");
    expect(history).toContain("where('acceptedDriverId', '==', driverId)");
    expect(history).toContain("orderBy('acceptedAtMs', 'desc')");
    expect(history).toContain('limit(limit + 1)');
    expect(history).toContain('acceptedPassengerPublic?.firstName');
    expect(history).not.toContain('passengerId,');
    expect(history).not.toContain('paymentPixPayload:');
    expect(history).not.toContain('commissionCapturedCentavos:');
  });

  it('declares the composite Firestore index required by the history cursor', () => {
    const indexes = source('backend/firebase/indexes/firestore.indexes.json');

    expect(indexes).toContain('"fieldPath": "acceptedDriverId"');
    expect(indexes).toContain('"fieldPath": "acceptedAtMs", "order": "DESCENDING"');
    expect(indexes).toContain('"fieldPath": "__name__", "order": "DESCENDING"');
  });

  it('keeps performance statistics server-owned, idempotent and fair', () => {
    const index = source('functions/src/index.js');
    const triggers = source('functions/src/drivers/performanceStatsTriggers.js');
    const policy = source('functions/src/drivers/performanceStats.js');

    expect(index).toContain('exports.driverOfferReceivedStatsTrigger');
    expect(index).toContain('exports.driverOfferAcceptedStatsTrigger');
    expect(index).toContain('exports.driverTerminalRideStatsTrigger');
    expect(triggers).toContain('driverOfferReceivedStatsAppliedVersion');
    expect(triggers).toContain('driverOfferAcceptedStatsAppliedVersion');
    expect(triggers).toContain('driverRideTerminalStatsAppliedVersion');
    expect(triggers).toContain('receivedRecovered');
    expect(triggers).toContain('driverPerformanceStats: stats');
    expect(triggers).toContain("ride.cancelledBy === 'passenger'");
    expect(triggers).toContain("ride.cancelReasonCode === 'passenger_no_show'");
    expect(triggers).toContain("return 'excluded_cancelled'");
    expect(policy).toContain('excludedCancellationCount');
  });

  it('loads three recent rides in the cockpit and all pages through the secure service', () => {
    const dashboard = source('src/components/DriverCockpitDashboardCard.jsx');
    const screen = source('src/app/(driver)/ride-history.jsx');
    const service = source('src/services/driverRideHistoryService.js');

    expect(dashboard).toContain('loadDriverRideHistoryPage({ limit: 3 })');
    expect(dashboard).toContain('ÚLTIMAS 3 CORRIDAS');
    expect(dashboard).toContain('VER TODAS');
    expect(dashboard).toContain("router.push('/ride-history')");
    expect(dashboard).toContain('summary.excludedCancellationCount');
    expect(screen).toContain('loadDriverRideHistoryPage({ limit: 20 })');
    expect(screen).toContain('CARREGAR MAIS CORRIDAS');
    expect(screen).toContain('PARTIDA');
    expect(screen).toContain('DESTINO');
    expect(screen).toContain('Comissão');
    expect(screen).toContain('Pix');
    expect(service).toContain("httpsCallable(functions, 'getDriverRideHistorySecure')");
    expect(service).not.toContain("collection(db, 'rideRequests'");
    expect(screen).not.toContain("collection(db, 'rideRequests'");
  });

  it('shows real Firestore rates without fabricating zero before tracking starts', () => {
    const summary = source('src/utils/driverCockpitSummary.js');
    const dashboard = source('src/components/DriverCockpitDashboardCard.jsx');
    const historyModel = source('src/utils/driverRideHistory.js');

    expect(summary).toContain('driver?.driverPerformanceStats');
    expect(summary).toContain('acceptanceRateBps: ratioBps');
    expect(summary).toContain('completionRateBps: ratioBps');
    expect(dashboard).toContain('taxa de conclusão');
    expect(dashboard).toContain('taxa de aceitação');
    expect(dashboard).toContain('as taxas aparecerão após novas ofertas e corridas finalizadas');
    expect(historyModel).toContain("if (value == null || value === '') return '—'");
  });
});
