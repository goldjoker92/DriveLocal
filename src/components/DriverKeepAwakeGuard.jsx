// Keeps the display awake only while an operational driver is actively using
// DriveLocal. Background tracking remains the responsibility of the Android
// foreground location service; this guard never changes driver availability.

import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from 'expo-keep-awake';

const DRIVER_KEEP_AWAKE_TAG = 'drivelocal-driver-operational';

function trace(event, details = {}, level = 'log') {
  const logger = level === 'warn' ? console.warn : console.log;
  logger('[DRIVER_SCREEN_AWAKE]', {
    scope: 'driver_screen_awake',
    event,
    ...details,
    atMs: Date.now(),
  });
}

export function deriveDriverKeepAwakeState({
  availabilityStatus,
  activeRideId,
  appState,
}) {
  const hasActiveRide = Boolean(activeRideId);

  if (appState !== 'active') {
    return {
      enabled: false,
      reason: 'app_not_foreground',
      hasActiveRide,
    };
  }

  if (hasActiveRide) {
    return {
      enabled: true,
      reason: 'active_ride',
      hasActiveRide: true,
    };
  }

  if (availabilityStatus === 'online') {
    return {
      enabled: true,
      reason: 'driver_online',
      hasActiveRide: false,
    };
  }

  return {
    enabled: false,
    reason: 'driver_offline',
    hasActiveRide: false,
  };
}

export default function DriverKeepAwakeGuard({
  availabilityStatus,
  activeRideId,
}) {
  // AppState can briefly be null while React Native initializes. The driver
  // layout is visible at that point, so treating it as active avoids a startup
  // window where an already-online driver could still hit the system timeout.
  const [appState, setAppState] = useState(() => AppState.currentState || 'active');
  const keepAwake = deriveDriverKeepAwakeState({
    availabilityStatus,
    activeRideId,
    appState,
  });
  const keepAwakeReasonRef = useRef(keepAwake.reason);
  keepAwakeReasonRef.current = keepAwake.reason;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    trace('eligibility.changed', {
      enabled: keepAwake.enabled,
      reason: keepAwake.reason,
      appState,
      availabilityStatus: availabilityStatus || 'unknown',
      hasActiveRide: keepAwake.hasActiveRide,
    });
  }, [
    activeRideId,
    appState,
    availabilityStatus,
    keepAwake.enabled,
    keepAwake.hasActiveRide,
    keepAwake.reason,
  ]);

  useEffect(() => {
    if (!keepAwake.enabled) return undefined;

    let disposed = false;
    const activationReason = keepAwakeReasonRef.current;

    trace('activation.requested', {
      reason: activationReason,
      result: 'pending',
    });

    activateKeepAwakeAsync(DRIVER_KEEP_AWAKE_TAG)
      .then(async () => {
        if (disposed) {
          // If foreground/status changed while native activation was pending,
          // release the same tag again so no screen lock can leak.
          await deactivateKeepAwake(DRIVER_KEEP_AWAKE_TAG).catch(() => undefined);
          return;
        }
        trace('activation.succeeded', {
          reason: activationReason,
          result: 'screen_timeout_blocked',
        });
      })
      .catch((error) => {
        trace('activation.failed', {
          reason: error?.code || error?.message || 'unknown',
          result: 'system_timeout_unchanged',
        }, 'warn');
      });

    return () => {
      disposed = true;
      deactivateKeepAwake(DRIVER_KEEP_AWAKE_TAG)
        .then(() => {
          trace('deactivation.succeeded', {
            reason: 'eligibility_lost_or_guard_unmounted',
            result: 'system_timeout_restored',
          });
        })
        .catch((error) => {
          trace('deactivation.failed', {
            reason: error?.code || error?.message || 'unknown',
            result: 'native_release_failed',
          }, 'warn');
        });
    };
  }, [keepAwake.enabled]);

  return null;
}
