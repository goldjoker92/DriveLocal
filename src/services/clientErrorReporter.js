import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { httpsCallable } from 'firebase/functions';

import { auth, functions } from '../config/firebase';
import { buildClientErrorPayload, sanitizeClientRoute } from './clientErrorSanitizer';

const DUPLICATE_WINDOW_MS = 30_000;
const RATE_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 5;

let currentRoute = null;
let globalHandlerInstalled = false;
let previousGlobalHandler = null;
const recentFingerprints = new Map();
let reportTimestamps = [];

function appVersion() {
  return String(
    Constants.expoConfig?.version
      || Constants.manifest?.version
      || Constants.manifest2?.extra?.expoClient?.version
      || 'unknown'
  );
}

function appEnvironment() {
  const extra = Constants.expoConfig?.extra
    || Constants.manifest?.extra
    || Constants.manifest2?.extra?.expoClient?.extra
    || {};
  return extra.appEnvironment === 'development' ? 'development' : 'production';
}

function cleanupRateState(nowMs) {
  reportTimestamps = reportTimestamps.filter((timestamp) => nowMs - timestamp < RATE_WINDOW_MS);
  for (const [fingerprint, timestamp] of recentFingerprints.entries()) {
    if (nowMs - timestamp >= DUPLICATE_WINDOW_MS) recentFingerprints.delete(fingerprint);
  }
}

function reportAllowed(fingerprint, nowMs) {
  cleanupRateState(nowMs);
  if (recentFingerprints.has(fingerprint)) {
    return { allowed: false, reason: 'duplicate_window' };
  }
  if (reportTimestamps.length >= MAX_REPORTS_PER_WINDOW) {
    return { allowed: false, reason: 'rate_limited' };
  }
  recentFingerprints.set(fingerprint, nowMs);
  reportTimestamps.push(nowMs);
  return { allowed: true, reason: null };
}

export function setCurrentCrashRoute(route) {
  currentRoute = sanitizeClientRoute(route);
}

export function buildRuntimeCrashContext(context = {}) {
  return {
    ...context,
    route: context.route || currentRoute,
    appVersion: context.appVersion || appVersion(),
    environment: context.environment || appEnvironment(),
    platform: context.platform || Platform.OS || 'unknown',
  };
}

export async function reportClientError(error, context = {}) {
  const nowMs = Date.now();
  const payload = buildClientErrorPayload(error, buildRuntimeCrashContext(context), nowMs);
  const gate = reportAllowed(payload.fingerprint, nowMs);

  if (!gate.allowed) {
    console.warn('[CLIENT_ERROR] report.skipped', {
      fingerprint: payload.fingerprint,
      reason: gate.reason,
      route: payload.route,
      source: payload.source,
    });
    return { sent: false, reason: gate.reason, fingerprint: payload.fingerprint };
  }

  // Never log message, stack, componentStack or raw context locally. The summary
  // is sufficient to correlate with the server report without exposing PII.
  console.error('[CLIENT_ERROR] report.requested', {
    fingerprint: payload.fingerprint,
    errorName: payload.errorName,
    route: payload.route,
    source: payload.source,
    severity: payload.severity,
    isFatal: payload.isFatal,
  });

  if (!auth.currentUser) {
    console.warn('[CLIENT_ERROR] report.not_sent', {
      fingerprint: payload.fingerprint,
      reason: 'unauthenticated',
    });
    return { sent: false, reason: 'unauthenticated', fingerprint: payload.fingerprint };
  }

  try {
    const submitReport = httpsCallable(functions, 'reportClientErrorSecure');
    const response = await submitReport(payload);
    console.info('[CLIENT_ERROR] report.succeeded', {
      fingerprint: payload.fingerprint,
      reportRef: response?.data?.reportRef || null,
    });
    return {
      sent: true,
      fingerprint: payload.fingerprint,
      reportRef: response?.data?.reportRef || null,
    };
  } catch (submitError) {
    // Avoid recursively reporting a failure of the crash reporter itself.
    console.error('[CLIENT_ERROR] report.failed', {
      fingerprint: payload.fingerprint,
      code: submitError?.code || 'unknown',
    });
    return { sent: false, reason: 'submit_failed', fingerprint: payload.fingerprint };
  }
}

export function recordClientNonFatal(error, context = {}) {
  return reportClientError(error, {
    ...context,
    eventName: context.eventName || 'client.non_fatal',
    source: 'non_fatal',
    severity: context.severity || 'warning',
    isFatal: false,
  });
}

export function installGlobalErrorHandler() {
  if (globalHandlerInstalled) return true;

  const errorUtils = globalThis?.ErrorUtils;
  if (!errorUtils || typeof errorUtils.setGlobalHandler !== 'function') {
    console.warn('[CLIENT_ERROR] global_handler.unavailable');
    return false;
  }

  previousGlobalHandler = typeof errorUtils.getGlobalHandler === 'function'
    ? errorUtils.getGlobalHandler()
    : null;

  errorUtils.setGlobalHandler((error, isFatal) => {
    void reportClientError(error, {
      eventName: 'javascript.unhandled',
      source: 'javascript_global',
      severity: isFatal ? 'fatal' : 'error',
      isFatal: isFatal === true,
    });

    // Preserve React Native's own red-box/native fatal handling after scheduling
    // the remote report. Swallowing the original handler would hide real crashes.
    if (typeof previousGlobalHandler === 'function') {
      previousGlobalHandler(error, isFatal);
    }
  });

  globalHandlerInstalled = true;
  console.info('[CLIENT_ERROR] global_handler.installed');
  return true;
}

export function resetClientErrorReporterForTests() {
  currentRoute = null;
  recentFingerprints.clear();
  reportTimestamps = [];
}
