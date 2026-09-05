// The 7 min dispatch lease must never end a driver's shift, and the client must
// not undo what the backend deliberately keeps open between 7 and 30 min.

const {
  WORK_SESSION_ABANDONED_MAX_AGE_MS,
  WORK_SESSION_DISPATCH_LEASE_MS,
  remoteWorkSessionDispatchable,
  remoteWorkSessionRecoverable,
  workSessionUpdatedAtMs,
} = require('../src/utils/driverWorkSession');

const T0 = 1_800_000_000_000;
const driverUpdatedAt = (atMs) => ({ availabilityUpdatedAtMs: atMs });

describe('driver work session windows', () => {
  it('mirrors the backend thresholds', () => {
    expect(WORK_SESSION_DISPATCH_LEASE_MS).toBe(7 * 60 * 1000);
    // functions/src/rides/constants.js WORK_SESSION_ABANDONED_MAX_AGE_MS
    expect(WORK_SESSION_ABANDONED_MAX_AGE_MS).toBe(30 * 60 * 1000);
  });

  it('keeps a late-publishing driver recoverable while skipping him for offers', () => {
    const lateBy10Min = driverUpdatedAt(T0 - 10 * 60 * 1000);

    expect(remoteWorkSessionDispatchable(lateBy10Min, T0)).toBe(false);
    expect(remoteWorkSessionRecoverable(lateBy10Min, T0)).toBe(true);
  });

  it('treats a fresh session as both dispatchable and recoverable', () => {
    const fresh = driverUpdatedAt(T0 - 60_000);

    expect(remoteWorkSessionDispatchable(fresh, T0)).toBe(true);
    expect(remoteWorkSessionRecoverable(fresh, T0)).toBe(true);
  });

  it('stops claiming availability once the session is abandoned', () => {
    expect(remoteWorkSessionRecoverable(driverUpdatedAt(T0 - 31 * 60 * 1000), T0)).toBe(false);
    // Exactly at the boundary the session is still honored.
    expect(remoteWorkSessionRecoverable(
      driverUpdatedAt(T0 - WORK_SESSION_ABANDONED_MAX_AGE_MS),
      T0,
    )).toBe(true);
  });

  it('refuses a session with no timestamp at all', () => {
    expect(remoteWorkSessionRecoverable(null, T0)).toBe(false);
    expect(remoteWorkSessionRecoverable({}, T0)).toBe(false);
    expect(remoteWorkSessionDispatchable(undefined, T0)).toBe(false);
  });

  it('does not end a live session when the phone clock runs behind the server', () => {
    expect(remoteWorkSessionRecoverable(driverUpdatedAt(T0 + 120_000), T0)).toBe(true);
  });

  it('reads Firestore Timestamp, {seconds}, epoch ms and the legacy fallback', () => {
    expect(workSessionUpdatedAtMs({ availabilityUpdatedAt: { toMillis: () => T0 } })).toBe(T0);
    expect(workSessionUpdatedAtMs({ availabilityUpdatedAt: { toDate: () => new Date(T0) } }))
      .toBe(T0);
    expect(workSessionUpdatedAtMs({
      availabilityUpdatedAt: { seconds: T0 / 1000, nanoseconds: 0 },
    })).toBe(T0);
    expect(workSessionUpdatedAtMs({ availabilityUpdatedAt: T0 })).toBe(T0);
    expect(workSessionUpdatedAtMs({ availabilityUpdatedAtMs: T0 })).toBe(T0);
    expect(workSessionUpdatedAtMs({})).toBe(0);
  });
});

describe('client reconcilers share one work-session policy', () => {
  const fs = require('fs');
  const path = require('path');
  const source = (relativePath) => fs.readFileSync(
    path.join(process.cwd(), relativePath),
    'utf8',
  );

  // Three reconcilers used to hardcode the 7 min lease and each ended the shift.
  it.each([
    'src/app/_layout.jsx',
    'src/app/(driver)/_layout.jsx',
    'src/app/(driver)/driver-home.jsx',
  ])('%s reconciles through the shared policy, not a local 7 min gate', (file) => {
    const code = source(file);

    expect(code).toMatch(/from '\.\.?\/(\.\.\/)?utils\/driverWorkSession'/);
    expect(code).toContain('remoteWorkSessionRecoverable');
    // No reconciler may reintroduce its own age gate.
    expect(code).not.toMatch(/WORK_SESSION_MAX_AGE_MS\s*=/);
    expect(code).not.toMatch(/7 \* 60 \* 1000/);
  });
});
