// The Android background-reliability tip must appear when the driver really lost
// his background service, and must never nag afterwards.

const fs = require('fs');
const path = require('path');

const {
  BACKGROUND_TIP_DISMISS_WINDOW_MS,
  dismissBackgroundTip,
  emptyBackgroundReliabilityState,
  normalizeBackgroundReliabilityState,
  recordBackgroundIncident,
  shouldShowBackgroundTip,
} = require('../src/utils/driverBackgroundReliability');

const T0 = 1_800_000_000_000;

describe('driver background reliability tip', () => {
  it('stays silent for a driver who never lost the service', () => {
    expect(shouldShowBackgroundTip(emptyBackgroundReliabilityState(), T0)).toEqual({
      show: false,
      reason: 'no_incident',
    });
  });

  it('appears after the first real incident', () => {
    const state = recordBackgroundIncident(emptyBackgroundReliabilityState(), T0);

    expect(state.incidentCount).toBe(1);
    expect(state.lastIncidentAtMs).toBe(T0);
    expect(shouldShowBackgroundTip(state, T0)).toEqual({
      show: true,
      reason: 'first_incident',
    });
  });

  it('stops nagging once dismissed', () => {
    const dismissed = dismissBackgroundTip(
      recordBackgroundIncident(emptyBackgroundReliabilityState(), T0),
      T0 + 1_000
    );

    expect(shouldShowBackgroundTip(dismissed, T0 + 60_000)).toEqual({
      show: false,
      reason: 'dismissed',
    });
  });

  it('comes back when the service dies again after a dismissal', () => {
    const dismissed = dismissBackgroundTip(
      recordBackgroundIncident(emptyBackgroundReliabilityState(), T0),
      T0 + 1_000
    );
    const relapse = recordBackgroundIncident(dismissed, T0 + 2_000);

    expect(relapse.incidentCount).toBe(2);
    expect(shouldShowBackgroundTip(relapse, T0 + 3_000)).toEqual({
      show: true,
      reason: 'incident_after_dismiss',
    });
  });

  it('reminds again one week after a dismissal', () => {
    const dismissed = dismissBackgroundTip(
      recordBackgroundIncident(emptyBackgroundReliabilityState(), T0),
      T0
    );

    expect(shouldShowBackgroundTip(dismissed, T0 + BACKGROUND_TIP_DISMISS_WINDOW_MS - 1).show)
      .toBe(false);
    expect(shouldShowBackgroundTip(dismissed, T0 + BACKGROUND_TIP_DISMISS_WINDOW_MS)).toEqual({
      show: true,
      reason: 'dismiss_window_elapsed',
    });
  });

  it('is wired to the two real signals and rendered in the cockpit', () => {
    const source = (relativePath) => fs.readFileSync(
      path.join(process.cwd(), relativePath),
      'utf8'
    );

    // Android killed the service and we had to restart it ourselves.
    const tracking = source('src/services/driverLocationTracking.js');
    expect(tracking).toContain('BACKGROUND_INCIDENT_REASONS.NATIVE_TASK_REPAIRED');

    // The server closed a work session the driver never stopped himself.
    const layout = source('src/app/(driver)/_layout.jsx');
    expect(layout).toContain('BACKGROUND_INCIDENT_REASONS.WORK_SESSION_REVOKED');

    const cockpit = source('src/app/(driver)/driver-home.jsx');
    expect(cockpit).toContain("import DriverBatteryTipCard from '../../components/DriverBatteryTipCard'");
    expect(cockpit).toContain('<DriverBatteryTipCard />');

    // The guidance opens the app settings screen: no new dependency…
    const card = source('src/components/DriverBatteryTipCard.jsx');
    expect(card).toContain('Linking.openSettings()');

    // …and no sensitive battery permission added to the Android manifest.
    expect(JSON.stringify(JSON.parse(source('app.json'))))
      .not.toContain('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
  });

  it('treats a corrupted stored payload as "no incident" instead of crashing', () => {
    expect(normalizeBackgroundReliabilityState(undefined)).toEqual({
      incidentCount: 0,
      lastIncidentAtMs: 0,
      dismissedAtMs: 0,
    });
    expect(normalizeBackgroundReliabilityState({ incidentCount: 'x', dismissedAtMs: -5 })).toEqual({
      incidentCount: 0,
      lastIncidentAtMs: 0,
      dismissedAtMs: 0,
    });
    expect(shouldShowBackgroundTip('not-an-object', T0).show).toBe(false);
  });
});
