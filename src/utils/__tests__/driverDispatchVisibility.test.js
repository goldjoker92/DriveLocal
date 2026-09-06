// Driver dispatch visibility.
//
// Production incident 2026-09-05: three moto drivers were availabilityStatus
// "online" with a session dispatch had already given up on, so every moto
// request answered "no driver" while their own app still showed "disponível".
// They waited, received nothing, and stopped coming back.
//
// Two rules come out of that and are pinned here:
//   1. the client windows must never be shorter than the server's, or the app
//      ends a shift the backend still considers live;
//   2. when the driver is not being offered rides, the app must SAY so.

const {
  driverDispatchVisibility,
  remoteWorkSessionDispatchable,
  remoteWorkSessionRecoverable,
  WORK_SESSION_DISPATCH_LEASE_MS,
  WORK_SESSION_ABANDONED_MAX_AGE_MS,
  DISPATCH_VISIBILITY_WARNING_MS,
} = require('../driverWorkSession');
const { visibilityCopy } = require('../../components/DriverDispatchVisibilityBanner');

const NOW = 1_760_000_000_000;
const MIN = 60 * 1000;

const online = (ageMs) => ({
  availabilityStatus: 'online',
  availabilityUpdatedAtMs: NOW - ageMs,
});

describe('client windows mirror the server', () => {
  it('matches functions/src/rides/constants.js', () => {
    // AVAILABILITY_SESSION_MAX_AGE_MS and WORK_SESSION_ABANDONED_MAX_AGE_MS.
    // A shorter client window is the bug this file exists to prevent.
    expect(WORK_SESSION_DISPATCH_LEASE_MS).toBe(20 * MIN);
    expect(WORK_SESSION_ABANDONED_MAX_AGE_MS).toBe(45 * MIN);
    expect(DISPATCH_VISIBILITY_WARNING_MS).toBeLessThan(WORK_SESSION_DISPATCH_LEASE_MS);
  });

  it('keeps a session recoverable well past the dispatch lease', () => {
    // A tunnel, a covered parking or a short doze must not end a shift.
    expect(remoteWorkSessionDispatchable(online(25 * MIN), NOW)).toBe(false);
    expect(remoteWorkSessionRecoverable(online(25 * MIN), NOW)).toBe(true);
    expect(remoteWorkSessionRecoverable(online(50 * MIN), NOW)).toBe(false);
  });
});

describe('driverDispatchVisibility', () => {
  it('stays silent while the driver is comfortably visible', () => {
    expect(driverDispatchVisibility(online(30 * 1000), { nowMs: NOW }))
      .toMatchObject({ state: 'healthy', visible: false });
    expect(driverDispatchVisibility(online(2 * MIN), { nowMs: NOW }))
      .toMatchObject({ state: 'healthy', visible: false });
  });

  it('warns early, while recovery is still free', () => {
    const result = driverDispatchVisibility(online(5 * MIN), { nowMs: NOW });
    expect(result.state).toBe('delayed');
    expect(result.visible).toBe(true);
    // Still dispatchable: the warning is preventive, not an outage.
    expect(remoteWorkSessionDispatchable(online(5 * MIN), NOW)).toBe(true);
  });

  it('states plainly that the driver is no longer receiving rides', () => {
    const result = driverDispatchVisibility(online(25 * MIN), { nowMs: NOW });
    expect(result.state).toBe('invisible');
    expect(result.visible).toBe(true);
    expect(remoteWorkSessionDispatchable(online(25 * MIN), NOW)).toBe(false);
  });

  it('treats an online driver with no session timestamp as invisible', () => {
    // Exactly the 2026-09-05 shape: online flag, nothing dispatch can use.
    const result = driverDispatchVisibility(
      { availabilityStatus: 'online' },
      { nowMs: NOW }
    );
    expect(result.state).toBe('invisible');
    expect(result.visible).toBe(true);
  });

  it('says nothing to a driver who is not claiming to be available', () => {
    expect(driverDispatchVisibility(
      { availabilityStatus: 'offline', availabilityUpdatedAtMs: NOW - 60 * MIN },
      { nowMs: NOW }
    )).toMatchObject({ state: 'healthy', visible: false });

    expect(driverDispatchVisibility(null, { nowMs: NOW }))
      .toMatchObject({ state: 'healthy', visible: false });
  });

  it('never covers an accepted ride', () => {
    // The active-ride screen owns the driver's attention; a visibility warning
    // there would compete with navigation and the Pix confirmation.
    expect(driverDispatchVisibility(online(30 * MIN), {
      nowMs: NOW,
      hasActiveRide: true,
    })).toMatchObject({ state: 'healthy', visible: false });
  });

  it('prefers the explicit status argument over the stored one', () => {
    // The layout derives the screen status from a server-confirmed snapshot;
    // the banner must follow that decision, not a cached document field.
    expect(driverDispatchVisibility(online(30 * MIN), {
      nowMs: NOW,
      availabilityStatus: 'offline',
    })).toMatchObject({ visible: false });
  });

  it('does not raise a false alarm on a phone clock ahead of the server', () => {
    const future = { availabilityStatus: 'online', availabilityUpdatedAtMs: NOW + 5 * MIN };
    const result = driverDispatchVisibility(future, { nowMs: NOW });
    expect(result.ageMs).toBe(0);
    expect(result.visible).toBe(false);
  });

  it('reads a Firestore Timestamp as well as epoch milliseconds', () => {
    const asTimestamp = {
      availabilityStatus: 'online',
      availabilityUpdatedAt: { toMillis: () => NOW - 25 * MIN },
    };
    expect(driverDispatchVisibility(asTimestamp, { nowMs: NOW }).state).toBe('invisible');
  });
});

describe('banner copy', () => {
  it('is explicit about consequences, and offers an action', () => {
    const invisible = visibilityCopy('invisible');
    const delayed = visibilityCopy('delayed');

    // The driver must understand he is losing rides, not read a vague warning.
    expect(invisible.title).toMatch(/não está recebendo corridas/i);
    expect(invisible.tone).toBe('danger');
    expect(delayed.tone).toBe('warning');

    [invisible, delayed].forEach((copy) => {
      expect(copy.action.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    });
  });
});
