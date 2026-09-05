// Local-only persistence for the Android background-reliability tip. Nothing is
// written to Firestore: this is device advice, not driver data, and it must keep
// working offline. Every function is best effort — a storage failure must never
// block going available or receiving rides.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  dismissBackgroundTip,
  emptyBackgroundReliabilityState,
  normalizeBackgroundReliabilityState,
  recordBackgroundIncident,
  shouldShowBackgroundTip,
} from '../utils/driverBackgroundReliability';

const STATE_KEY = '@drivelocal/driver-background-reliability-v1';
const NS = '[DRIVER_BACKGROUND]';

export async function readBackgroundReliabilityState() {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    return normalizeBackgroundReliabilityState(raw ? JSON.parse(raw) : null);
  } catch (error) {
    console.warn(`${NS} state.read_failed`, {
      reason: error?.code || error?.message || 'unknown',
    });
    return emptyBackgroundReliabilityState();
  }
}

async function writeState(next) {
  try {
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(next));
    return next;
  } catch (error) {
    console.warn(`${NS} state.write_failed`, {
      reason: error?.code || error?.message || 'unknown',
    });
    return next;
  }
}

// Called when the app had to repair its own native task, or when the server
// revoked the work session: both mean Android stopped our background service.
export async function reportBackgroundIncident(reason, nowMs = Date.now()) {
  const next = recordBackgroundIncident(await readBackgroundReliabilityState(), nowMs);
  console.log(`${NS} incident.recorded`, {
    reason,
    incidentCount: next.incidentCount,
    atMs: next.lastIncidentAtMs,
  });
  return writeState(next);
}

export async function dismissBackgroundReliabilityTip(nowMs = Date.now()) {
  const next = dismissBackgroundTip(await readBackgroundReliabilityState(), nowMs);
  console.log(`${NS} tip.dismissed`, { atMs: next.dismissedAtMs });
  return writeState(next);
}

export async function resolveBackgroundTipVisibility(nowMs = Date.now()) {
  const state = await readBackgroundReliabilityState();
  const decision = shouldShowBackgroundTip(state, nowMs);
  console.log(`${NS} tip.resolved`, {
    show: decision.show,
    reason: decision.reason,
    incidentCount: state.incidentCount,
  });
  return { ...decision, state };
}
