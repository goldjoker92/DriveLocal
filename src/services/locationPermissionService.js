// Role-aware Android location permissions.
//
// Passenger location is foreground-only. Driver location also needs background
// access because dispatch and active-ride tracking must continue after the app is
// minimized. This module never reads, stores or logs coordinates.

import * as Location from 'expo-location';
import { Platform } from 'react-native';

export const LOCATION_ROLE = Object.freeze({
  PASSENGER: 'passenger',
  DRIVER: 'driver',
});

function normalizedRole(role) {
  return role === LOCATION_ROLE.DRIVER ? LOCATION_ROLE.DRIVER : LOCATION_ROLE.PASSENGER;
}

function safeSource(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64);
}

function tracePermission(event, { role, source, stage, status, canAskAgain } = {}, level = 'info') {
  const payload = {
    scope: 'location_permission',
    event,
    role: normalizedRole(role),
    source: safeSource(source),
    stage: stage || null,
    status: status || null,
    canAskAgain: typeof canAskAgain === 'boolean' ? canAskAgain : null,
    atMs: Date.now(),
  };
  const method = console[level] || console.log;
  method(`[LOCATION_PERMISSION] ${event}`, payload);
}

export async function getLocationPermissionState(role) {
  const selectedRole = normalizedRole(role);
  if (Platform.OS !== 'android') {
    return { status: 'unsupported', role: selectedRole };
  }

  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    return { status: 'services_disabled', role: selectedRole };
  }

  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    return {
      status: 'foreground_required',
      role: selectedRole,
      canAskAgain: foreground.canAskAgain,
    };
  }

  if (selectedRole === LOCATION_ROLE.PASSENGER) {
    return { status: 'granted', role: selectedRole };
  }

  const background = await Location.getBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    return {
      status: 'background_required',
      role: selectedRole,
      canAskAgain: background.canAskAgain,
    };
  }

  return { status: 'granted', role: selectedRole };
}

export async function requestLocationPermissions({ role, source = 'unknown' } = {}) {
  const selectedRole = normalizedRole(role);
  const selectedSource = safeSource(source);

  tracePermission('request.started', {
    role: selectedRole,
    source: selectedSource,
    stage: 'preflight',
  });

  try {
    if (Platform.OS !== 'android') {
      const result = { status: 'unsupported', role: selectedRole };
      tracePermission('request.completed', {
        role: selectedRole,
        source: selectedSource,
        stage: 'platform',
        status: result.status,
      }, 'warn');
      return result;
    }

    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      const result = { status: 'services_disabled', role: selectedRole };
      tracePermission('request.completed', {
        role: selectedRole,
        source: selectedSource,
        stage: 'services',
        status: result.status,
      }, 'warn');
      return result;
    }

    let foreground = await Location.getForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      tracePermission('native_prompt.opening', {
        role: selectedRole,
        source: selectedSource,
        stage: 'foreground',
        status: foreground.status,
        canAskAgain: foreground.canAskAgain,
      });
      foreground = await Location.requestForegroundPermissionsAsync();
    }

    if (foreground.status !== 'granted') {
      const result = {
        status: 'foreground_denied',
        role: selectedRole,
        canAskAgain: foreground.canAskAgain,
      };
      tracePermission('request.completed', {
        role: selectedRole,
        source: selectedSource,
        stage: 'foreground',
        status: result.status,
        canAskAgain: result.canAskAgain,
      }, 'warn');
      return result;
    }

    if (selectedRole === LOCATION_ROLE.PASSENGER) {
      const result = { status: 'granted', role: selectedRole };
      tracePermission('request.completed', {
        role: selectedRole,
        source: selectedSource,
        stage: 'foreground',
        status: result.status,
      });
      return result;
    }

    let background = await Location.getBackgroundPermissionsAsync();
    if (background.status !== 'granted') {
      tracePermission('native_prompt.opening', {
        role: selectedRole,
        source: selectedSource,
        stage: 'background',
        status: background.status,
        canAskAgain: background.canAskAgain,
      });
      background = await Location.requestBackgroundPermissionsAsync();
    }

    if (background.status !== 'granted') {
      const result = {
        status: 'background_denied',
        role: selectedRole,
        canAskAgain: background.canAskAgain,
      };
      tracePermission('request.completed', {
        role: selectedRole,
        source: selectedSource,
        stage: 'background',
        status: result.status,
        canAskAgain: result.canAskAgain,
      }, 'warn');
      return result;
    }

    const result = { status: 'granted', role: selectedRole };
    tracePermission('request.completed', {
      role: selectedRole,
      source: selectedSource,
      stage: 'background',
      status: result.status,
    });
    return result;
  } catch (error) {
    tracePermission('request.failed', {
      role: selectedRole,
      source: selectedSource,
      stage: 'native',
      status: error?.code || error?.name || 'unknown',
    }, 'warn');
    return {
      status: 'error',
      role: selectedRole,
      reason: error?.code || error?.name || 'unknown',
    };
  }
}
