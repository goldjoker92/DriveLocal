import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { DEV_RIDE_SIMULATOR_ENABLED } from '../config/runtimeEnvironment';
import {
  DRIVER_LOCATION_TASK,
  getDriverTrackingSession,
  refreshDriverOnlineHeartbeat,
  requestDriverTrackingPermissions,
} from './driverLocationTracking';
import {
  getPushNotificationDiagnosticState,
  registerForPushNotifications,
} from './notificationsService';

// These keys are owned by driverLocationTracking.js. They are duplicated here
// intentionally as read-only diagnostic contracts so the hot GPS path stays
// isolated from UI health checks.
const LAST_PUBLISH_KEY = '@drivelocal/driver-location-last-publish-v2';
const LAST_STATUS_KEY = '@drivelocal/driver-location-last-status-v1';

const LOCATION_WARNING_AGE_MS = 5 * 60 * 1000;
const LOCATION_BLOCKING_AGE_MS = 7 * 60 * 1000;

const COPY = Object.freeze({
  diagnostic_failed: {
    title: 'Verificação do aparelho indisponível',
    message: 'Não foi possível verificar o GPS e as notificações agora. Tente novamente.',
    action: 'retry',
    actionLabel: 'VERIFICAR NOVAMENTE',
  },
  services_disabled: {
    title: 'GPS desativado',
    message: 'Ative a localização do telefone para receber corridas e compartilhar seu deslocamento.',
    action: 'settings',
    actionLabel: 'ABRIR CONFIGURAÇÕES',
  },
  foreground_required: {
    title: 'Localização necessária',
    message: 'Autorize a localização precisa para o DriveLocal encontrar corridas próximas.',
    action: 'repair',
    actionLabel: 'ATIVAR',
  },
  foreground_precise_required: {
    title: 'Localização precisa desativada',
    message: 'Ative a localização precisa nas configurações do Android.',
    action: 'settings',
    actionLabel: 'ABRIR CONFIGURAÇÕES',
  },
  background_required: {
    title: 'Localização em segundo plano necessária',
    message: 'Selecione “Permitir o tempo todo” para continuar recebendo corridas com o app em segundo plano.',
    action: 'repair',
    actionLabel: 'ATIVAR',
  },
  notifications_permission_required: {
    title: 'Notificações desativadas',
    message: 'Ative as notificações para não perder novas corridas e atualizações importantes.',
    action: 'repair',
    actionLabel: 'ATIVAR',
  },
  notifications_settings_required: {
    title: 'Notificações bloqueadas',
    message: 'Ative as notificações do DriveLocal nas configurações do Android.',
    action: 'settings',
    actionLabel: 'ABRIR CONFIGURAÇÕES',
  },
  notification_registration_required: {
    title: 'Notificações ainda não conectadas',
    message: 'Conecte este aparelho ao serviço de notificações antes de começar a trabalhar.',
    action: 'repair',
    actionLabel: 'CONECTAR',
  },
  notification_registration_warning: {
    title: 'Verificando notificações',
    message: 'A conexão das notificações precisa ser renovada. As corridas abertas continuam visíveis no app.',
    action: 'repair',
    actionLabel: 'VERIFICAR',
  },
  tracking_session_missing: {
    title: 'Sessão de localização interrompida',
    message: 'Sua sessão local de trabalho não foi encontrada. Fique indisponível e ative novamente.',
    action: 'retry',
    actionLabel: 'VERIFICAR NOVAMENTE',
  },
  native_task_missing: {
    title: 'Rastreamento em segundo plano interrompido',
    message: 'O serviço de localização do motorista parou e precisa ser reiniciado.',
    action: 'repair',
    actionLabel: 'REINICIAR',
  },
  location_unconfirmed: {
    title: 'Posição ainda não confirmada',
    message: 'O DriveLocal ainda não confirmou uma posição válida deste aparelho.',
    action: 'repair',
    actionLabel: 'VERIFICAR',
  },
  location_delayed: {
    title: 'Posição demorando para atualizar',
    message: 'Sua última posição está mais antiga que o esperado. Verifique a conexão e o GPS.',
    action: 'repair',
    actionLabel: 'ATUALIZAR',
  },
  location_stale: {
    title: 'Localização desatualizada',
    message: 'Sua posição deixou de ser atualizada. A disponibilidade precisa ser reiniciada com segurança.',
    action: 'repair',
    actionLabel: 'CORRIGIR',
  },
  tracking_runtime_warning: {
    title: 'Localização com instabilidade',
    message: 'O Android informou uma falha recente no rastreamento. DriveLocal tentará reparar automaticamente.',
    action: 'repair',
    actionLabel: 'VERIFICAR',
  },
  unsupported: {
    title: 'Aparelho não compatível',
    message: 'O modo motorista exige o aplicativo Android instalado em um aparelho físico.',
    action: 'retry',
    actionLabel: 'VERIFICAR NOVAMENTE',
  },
});

function traceDeviceDiagnostic(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[DRIVER_DEVICE] ${event}`, {
    scope: 'driver_device',
    event,
    atMs: Date.now(),
    ...details,
  });
}

async function readSafeJson(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function issue(code, severity, overrides = {}) {
  const copy = COPY[code] || COPY.diagnostic_failed;
  return Object.freeze({
    code,
    severity,
    title: copy.title,
    message: copy.message,
    action: copy.action,
    actionLabel: copy.actionLabel,
    ...overrides,
  });
}

function androidAccuracy(permission) {
  return String(permission?.android?.accuracy || '').toLowerCase();
}

async function collectLocationRuntimeState(nowMs = Date.now()) {
  if (Platform.OS !== 'android') {
    return {
      status: 'unsupported',
      canAskAgain: false,
      precise: false,
      sessionPresent: false,
      trackingPaused: false,
      activeRide: false,
      nativeTaskStarted: false,
      lastPublishAtMs: 0,
      lastPublishAgeMs: null,
      lastRuntimeStatus: null,
    };
  }

  try {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    const foreground = await Location.getForegroundPermissionsAsync();
    const background = await Location.getBackgroundPermissionsAsync();
    const session = await getDriverTrackingSession();
    const shouldRunNativeTask = Boolean(session && session.trackingPaused !== true);
    const nativeTaskStarted = shouldRunNativeTask
      ? await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)
      : false;
    const lastPublish = await readSafeJson(LAST_PUBLISH_KEY);
    const lastStatus = await readSafeJson(LAST_STATUS_KEY);
    const lastPublishAtMs = Number(lastPublish?.atMs || 0) || 0;
    const lastPublishAgeMs = lastPublishAtMs > 0
      ? Math.max(0, Number(nowMs) - lastPublishAtMs)
      : null;
    const foregroundGranted = foreground?.status === 'granted';
    const backgroundGranted = background?.status === 'granted';
    const accuracy = androidAccuracy(foreground);
    const precise = !accuracy || accuracy === 'fine' || accuracy === 'full';

    let status = 'granted';
    let canAskAgain = true;
    if (!servicesEnabled) {
      status = 'services_disabled';
      canAskAgain = false;
    } else if (!foregroundGranted) {
      status = 'foreground_required';
      canAskAgain = foreground?.canAskAgain !== false;
    } else if (!precise) {
      status = 'foreground_precise_required';
      canAskAgain = false;
    } else if (!backgroundGranted) {
      status = 'background_required';
      canAskAgain = background?.canAskAgain !== false;
    }

    return {
      status,
      canAskAgain,
      precise,
      sessionPresent: Boolean(session),
      trackingPaused: session?.trackingPaused === true,
      activeRide: Boolean(session?.rideId),
      nativeTaskStarted,
      lastPublishAtMs,
      lastPublishAgeMs,
      lastRuntimeStatus: lastStatus?.status || null,
      lastRuntimeStatusAtMs: Number(lastStatus?.atMs || 0) || 0,
    };
  } catch (error) {
    return {
      status: 'diagnostic_failed',
      canAskAgain: null,
      precise: false,
      sessionPresent: false,
      trackingPaused: false,
      activeRide: false,
      nativeTaskStarted: false,
      lastPublishAtMs: 0,
      lastPublishAgeMs: null,
      lastRuntimeStatus: null,
      reasonCode: String(error?.code || error?.name || 'unknown').slice(0, 80),
    };
  }
}

/**
 * Pure priority policy. It is exported so unit tests can prove that a green
 * cockpit is impossible while a blocking requirement is missing.
 */
export function deriveDriverDeviceDiagnostic({
  location,
  notifications,
  expectTrackingActive = false,
  strictNotificationRegistration = false,
  allowDevSimulation = false,
} = {}) {
  if (allowDevSimulation) {
    return Object.freeze({
      healthy: true,
      blocking: false,
      readyForAvailability: true,
      issues: [],
      primaryIssue: null,
      expectTrackingActive: false,
      activeRide: false,
      devSimulationBypass: true,
    });
  }

  const issues = [];
  const locationStatus = location?.status || 'diagnostic_failed';

  if (locationStatus === 'diagnostic_failed') {
    issues.push(issue('diagnostic_failed', 'warning'));
  } else if (locationStatus === 'unsupported') {
    issues.push(issue('unsupported', 'blocking'));
  } else if (locationStatus !== 'granted') {
    const action = location?.canAskAgain === false ? 'settings' : undefined;
    issues.push(issue(locationStatus, 'blocking', action ? {
      action,
      actionLabel: 'ABRIR CONFIGURAÇÕES',
    } : {}));
  }

  const notificationStatus = notifications?.status || 'diagnostic_failed';
  if (notificationStatus === 'permission_required') {
    issues.push(issue(
      notifications?.canAskAgain === false
        ? 'notifications_settings_required'
        : 'notifications_permission_required',
      'blocking',
    ));
  } else if (notificationStatus === 'unsupported' || notificationStatus === 'device_unsupported') {
    issues.push(issue('unsupported', 'blocking'));
  } else if (notificationStatus === 'diagnostic_failed') {
    issues.push(issue('diagnostic_failed', 'warning'));
  } else if (['registration_required', 'token_missing', 'sync_failed', 'disabled'].includes(notificationStatus)) {
    issues.push(issue(
      strictNotificationRegistration
        ? 'notification_registration_required'
        : 'notification_registration_warning',
      strictNotificationRegistration ? 'blocking' : 'warning',
      { notificationStatus },
    ));
  } else if (notificationStatus === 'registration_stale') {
    issues.push(issue('notification_registration_warning', 'warning', { notificationStatus }));
  }

  if (expectTrackingActive) {
    if (!location?.sessionPresent) {
      issues.push(issue('tracking_session_missing', 'blocking'));
    } else if (!location?.trackingPaused && !location?.nativeTaskStarted) {
      issues.push(issue('native_task_missing', 'blocking'));
    } else if (!location?.trackingPaused) {
      if (!(Number(location?.lastPublishAtMs || 0) > 0)) {
        issues.push(issue('location_unconfirmed', 'blocking'));
      } else if (Number(location?.lastPublishAgeMs) > LOCATION_BLOCKING_AGE_MS) {
        issues.push(issue('location_stale', 'blocking', {
          ageMs: Number(location.lastPublishAgeMs),
        }));
      } else if (Number(location?.lastPublishAgeMs) > LOCATION_WARNING_AGE_MS) {
        issues.push(issue('location_delayed', 'warning', {
          ageMs: Number(location.lastPublishAgeMs),
        }));
      }
    }

    if (
      ['task_error', 'publish_error', 'session_start_failed'].includes(location?.lastRuntimeStatus)
      && !issues.some((candidate) => candidate.code === 'native_task_missing')
    ) {
      issues.push(issue('tracking_runtime_warning', 'warning', {
        runtimeStatus: location.lastRuntimeStatus,
      }));
    }
  }

  const deduplicated = issues.filter(
    (candidate, index, all) => all.findIndex((item) => item.code === candidate.code) === index,
  );
  const primaryIssue = deduplicated.find((candidate) => candidate.severity === 'blocking')
    || deduplicated[0]
    || null;
  const blocking = deduplicated.some((candidate) => candidate.severity === 'blocking');

  return Object.freeze({
    healthy: deduplicated.length === 0,
    blocking,
    readyForAvailability: !blocking,
    issues: deduplicated,
    primaryIssue,
    expectTrackingActive,
    activeRide: location?.activeRide === true,
    devSimulationBypass: false,
  });
}

export async function getDriverDeviceDiagnostic({
  expectTrackingActive,
  strictNotificationRegistration = false,
  nowMs = Date.now(),
} = {}) {
  const allowDevSimulation = DEV_RIDE_SIMULATOR_ENABLED
    && Platform.OS === 'android'
    && !Device.isDevice;

  if (allowDevSimulation) {
    return deriveDriverDeviceDiagnostic({ allowDevSimulation: true });
  }

  const [location, notifications] = await Promise.all([
    collectLocationRuntimeState(nowMs),
    getPushNotificationDiagnosticState({ nowMs }),
  ]);
  const inferredTrackingExpectation = typeof expectTrackingActive === 'boolean'
    ? expectTrackingActive
    : Boolean(location.sessionPresent && !location.trackingPaused);

  return deriveDriverDeviceDiagnostic({
    location,
    notifications,
    expectTrackingActive: inferredTrackingExpectation,
    strictNotificationRegistration,
  });
}

/**
 * User-initiated repair. Permission prompts happen only from an explicit action
 * such as “Começar a trabalhar” or the diagnostic alert button.
 */
export async function repairDriverDeviceReadiness({
  expectTrackingActive,
  strictNotificationRegistration = false,
  role = 'driver',
} = {}) {
  const startedAt = Date.now();
  traceDeviceDiagnostic('repair.requested', {
    expectTrackingActive: expectTrackingActive === true,
    strictNotificationRegistration,
  });

  await requestDriverTrackingPermissions().catch(() => undefined);
  await registerForPushNotifications(role);

  if (expectTrackingActive) {
    await refreshDriverOnlineHeartbeat().catch(() => undefined);
  }

  const diagnostic = await getDriverDeviceDiagnostic({
    expectTrackingActive,
    strictNotificationRegistration,
  });
  traceDeviceDiagnostic('repair.completed', {
    healthy: diagnostic.healthy,
    blocking: diagnostic.blocking,
    issueCode: diagnostic.primaryIssue?.code || null,
    durationMs: Date.now() - startedAt,
  }, diagnostic.blocking ? 'warn' : 'log');
  return diagnostic;
}

/**
 * Strict preflight used immediately before opening a server work session.
 */
export async function prepareDriverDeviceForAvailability() {
  const diagnostic = await repairDriverDeviceReadiness({
    expectTrackingActive: false,
    strictNotificationRegistration: true,
    role: 'driver',
  });

  traceDeviceDiagnostic('availability_preflight.completed', {
    readyForAvailability: diagnostic.readyForAvailability,
    issueCode: diagnostic.primaryIssue?.code || null,
    devSimulationBypass: diagnostic.devSimulationBypass,
  }, diagnostic.readyForAvailability ? 'log' : 'warn');

  return diagnostic;
}

export const DRIVER_DEVICE_DIAGNOSTIC_POLICY = Object.freeze({
  locationWarningAgeMs: LOCATION_WARNING_AGE_MS,
  locationBlockingAgeMs: LOCATION_BLOCKING_AGE_MS,
});
