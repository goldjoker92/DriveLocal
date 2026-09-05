// Pure decision for the Android background-reliability tip.
//
// Android OEMs (Xiaomi, Samsung, Motorola…) kill the location foreground service
// when the app is not exempted from battery optimization. The driver then keeps
// seeing "disponível" while the server stops dispatching him. We cannot read that
// exemption without a native module, so instead of guessing we react to the
// symptom: every time the app has to repair its own native task, or the server
// revoked its work session, we count one incident.
//
// The tip is shown only after a real incident, and never nags: dismissing it
// silences it until a NEW incident happens, or for a full week.

export const BACKGROUND_TIP_DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const BACKGROUND_INCIDENT_REASONS = Object.freeze({
  NATIVE_TASK_REPAIRED: 'native_task_repaired',
  WORK_SESSION_REVOKED: 'work_session_revoked',
});

export function emptyBackgroundReliabilityState() {
  return { incidentCount: 0, lastIncidentAtMs: 0, dismissedAtMs: 0 };
}

// Tolerates a missing/corrupted stored payload: an unreadable state must never
// break the cockpit, it only means "no incident known yet".
export function normalizeBackgroundReliabilityState(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const positiveInt = (input) => {
    const n = Number(input);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  return {
    incidentCount: positiveInt(raw.incidentCount),
    lastIncidentAtMs: positiveInt(raw.lastIncidentAtMs),
    dismissedAtMs: positiveInt(raw.dismissedAtMs),
  };
}

export function recordBackgroundIncident(state, nowMs) {
  const current = normalizeBackgroundReliabilityState(state);
  const at = Number(nowMs) > 0 ? Math.floor(Number(nowMs)) : 0;
  return {
    ...current,
    incidentCount: current.incidentCount + 1,
    lastIncidentAtMs: at,
  };
}

export function dismissBackgroundTip(state, nowMs) {
  const current = normalizeBackgroundReliabilityState(state);
  const at = Number(nowMs) > 0 ? Math.floor(Number(nowMs)) : 0;
  return { ...current, dismissedAtMs: at };
}

/**
 * @param {object} state stored reliability state
 * @param {number} nowMs authoritative current time
 * @returns {{show:boolean, reason:string}}
 */
export function shouldShowBackgroundTip(state, nowMs) {
  const current = normalizeBackgroundReliabilityState(state);
  const at = Number(nowMs) > 0 ? Math.floor(Number(nowMs)) : 0;

  if (current.incidentCount === 0) return { show: false, reason: 'no_incident' };
  if (current.dismissedAtMs === 0) return { show: true, reason: 'first_incident' };
  if (current.lastIncidentAtMs > current.dismissedAtMs) {
    return { show: true, reason: 'incident_after_dismiss' };
  }
  if (at - current.dismissedAtMs >= BACKGROUND_TIP_DISMISS_WINDOW_MS) {
    return { show: true, reason: 'dismiss_window_elapsed' };
  }
  return { show: false, reason: 'dismissed' };
}
