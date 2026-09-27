// In-memory bridge from the existing global guard to the cockpit. Diagnostics
// are account-bound and expire; neither a previous user nor an old success can
// turn the current driver's status green.
let latest = null;
const listeners = new Set();
export function publishDriverDeviceHealth(uid, diagnostic, sessionId = null) {
  latest = uid && diagnostic ? { uid, diagnostic, sessionId, atMs: Date.now() } : null;
  listeners.forEach((listener) => listener(latest));
}
export function getDriverDeviceHealth() { return latest; }
export function subscribeDriverDeviceHealth(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
