import { useCallback, useEffect, useRef, useState } from 'react';
import { useSegments } from 'expo-router';
import {
  AppState,
  Linking,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { auth } from '../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../config/runtimeEnvironment';
import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';
import {
  getDriverDeviceDiagnostic,
  repairDriverDeviceReadiness,
} from '../services/driverDeviceDiagnostics';
import { stopDriverWorkSession } from '../services/driverAvailabilityService';
import {
  getDriverTrackingSession,
  refreshDriverOnlineHeartbeat,
  stopDriverOnlineTracking,
} from '../services/driverLocationTracking';
import { getRobotDriverState } from '../services/robotDriverEngine';
import AppButton from './AppButton';
import { publishDriverDeviceHealth } from '../services/driverDeviceHealthStore';

const CHECK_INTERVAL_MS = 30_000;
const AUTO_SUSPEND_CODES = new Set([
  'services_disabled',
  'foreground_required',
  'foreground_precise_required',
  'background_required',
  'notifications_permission_required',
  'notifications_settings_required',
]);

function isDriverOperationalRoute(route) {
  const path = String(route || '').toLowerCase();
  return path.includes('driver-home')
    || path.includes('active-ride')
    || path.includes('ride-request')
    || path.includes('(driver)');
}

function traceGuard(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[DRIVER_DEVICE] ${event}`, {
    scope: 'driver_device_guard',
    event,
    atMs: Date.now(),
    ...details,
  });
}

function robotSimulationCoversTrackingSession(session) {
  if (!DEV_RIDE_SIMULATOR_ENABLED || !session || !auth.currentUser) return null;

  const robot = getRobotDriverState();
  if (!robot?.enabled || robot.driverId !== auth.currentUser.uid) return null;
  if (
    !robot.availabilitySessionId
    || robot.availabilitySessionId !== session.availabilitySessionId
  ) return null;
  if (['idle', 'failed', 'stopped'].includes(robot.phase)) return null;

  const sessionRideId = session.rideId || null;
  const robotRideId = robot.rideId || null;
  if (sessionRideId ? robotRideId !== sessionRideId : robotRideId !== null) return null;

  return robot;
}

function applyRobotSimulationTrackingSource(snapshot, session) {
  if (snapshot?.primaryIssue?.code !== 'native_task_missing') {
    return { snapshot, robot: null };
  }

  const robot = robotSimulationCoversTrackingSession(session);
  if (!robot) return { snapshot, robot: null };

  const issues = Array.isArray(snapshot.issues)
    ? snapshot.issues.filter((candidate) => candidate.code !== 'native_task_missing')
    : [];
  const primaryIssue = issues.find((candidate) => candidate.severity === 'blocking')
    || issues[0]
    || null;
  const blocking = issues.some((candidate) => candidate.severity === 'blocking');

  return {
    snapshot: Object.freeze({
      ...snapshot,
      healthy: issues.length === 0,
      blocking,
      readyForAvailability: !blocking,
      issues,
      primaryIssue,
      devSimulationBypass: true,
      trackingSource: 'robot_simulation',
    }),
    robot,
  };
}

export default function DriverDeviceHealthGuard({ route }) {
  const segments = useSegments();
  // Pathnames omit route groups: keep diagnostics alive on wallet/profile too.
  const relevantRoute = segments.includes('(driver)') || isDriverOperationalRoute(route);
  const [authenticated, setAuthenticated] = useState(Boolean(auth.currentUser));
  const [diagnostic, setDiagnostic] = useState(null);
  const [checking, setChecking] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const checkInFlight = useRef(false);
  const suspensionInFlight = useRef(false);
  const mounted = useRef(true);

  const runDiagnostic = useCallback(async ({ allowTrackingRepair = true } = {}) => {
    if (!relevantRoute || !auth.currentUser || checkInFlight.current) return null;
    checkInFlight.current = true;
    if (mounted.current) setChecking(true);

    try {
      traceGuard('diagnostic.started', { route: String(route || '') });
      let snapshot = await getDriverDeviceDiagnostic();
      let session = await getDriverTrackingSession();
      let robotResolution = applyRobotSimulationTrackingSource(snapshot, session);
      snapshot = robotResolution.snapshot;

      if (robotResolution.robot) {
        traceGuard('robot_tracking.accepted', {
          result: 'native_task_bypass',
          trackingSource: 'robot_simulation',
          activeRide: Boolean(session?.rideId),
          phase: robotResolution.robot.phase,
        });
      }

      // The normal online foreground heartbeat can safely repair a missing native
      // task. Active-ride tracking is owned by the active-ride screen and must not
      // be detached or replaced from this global guard. DEV Robot Driver sessions
      // are resolved above, before this repair can restart real GPS by mistake.
      if (
        allowTrackingRepair
        && snapshot.primaryIssue?.code === 'native_task_missing'
        && !snapshot.activeRide
      ) {
        traceGuard('tracking_repair.started', {
          issueCode: snapshot.primaryIssue.code,
        });
        await refreshDriverOnlineHeartbeat().catch(() => undefined);
        snapshot = await getDriverDeviceDiagnostic();
        session = await getDriverTrackingSession();
        robotResolution = applyRobotSimulationTrackingSource(snapshot, session);
        snapshot = robotResolution.snapshot;
        traceGuard('tracking_repair.completed', {
          issueCode: snapshot.primaryIssue?.code || null,
          blocking: snapshot.blocking,
        }, snapshot.blocking ? 'warn' : 'log');
      }

      if (mounted.current) setDiagnostic(snapshot);
      publishDriverDeviceHealth(auth.currentUser?.uid, snapshot, session?.availabilitySessionId);
      traceGuard('diagnostic.completed', {
        healthy: snapshot.healthy,
        blocking: snapshot.blocking,
        issueCode: snapshot.primaryIssue?.code || null,
        activeRide: snapshot.activeRide,
        trackingSource: snapshot.trackingSource || 'native',
      }, snapshot.blocking ? 'warn' : 'log');

      const shouldSuspend = Boolean(
        snapshot.blocking
        && session
        && !session.rideId
        && AUTO_SUSPEND_CODES.has(snapshot.primaryIssue?.code)
      );

      if (shouldSuspend && !suspensionInFlight.current) {
        suspensionInFlight.current = true;
        const issueCode = snapshot.primaryIssue?.code || 'unknown';
        const sessionId = session.availabilitySessionId || null;
        traceGuard('availability_suspension.started', {
          issueCode,
          result: 'confirming_server_stop',
        }, 'warn');

        // A ride may have been accepted since the diagnostic. The server checks
        // activeRideId transactionally before we stop the idle native task.
        try {
          await stopDriverWorkSession(sessionId);
          const current = await getDriverTrackingSession();
          if (current?.availabilitySessionId === sessionId && !current.rideId) {
            await stopDriverOnlineTracking();
          }
          traceGuard('availability_suspension.succeeded', {
            issueCode,
            result: 'offline',
          }, 'warn');
        } catch (error) {
          traceGuard('availability_suspension.remote_pending', {
            issueCode,
            reason: error?.code || error?.name || 'unknown',
            result: 'session_preserved_until_confirmed',
          }, 'warn');
        } finally {
          suspensionInFlight.current = false;
        }
      } else if (snapshot.blocking && snapshot.activeRide) {
        // Never stop an accepted ride because a permission or notification was
        // changed. The alert remains visible and the active-ride screen owns GPS.
        traceGuard('active_ride_preserved', {
          issueCode: snapshot.primaryIssue?.code || 'unknown',
          result: 'alert_only',
        }, 'warn');
      }

      return snapshot;
    } catch (error) {
      publishDriverDeviceHealth(auth.currentUser?.uid, null);
      traceGuard('diagnostic.failed', {
        reason: error?.code || error?.name || 'unknown',
      }, 'warn');
      if (mounted.current) {
        setDiagnostic({
          healthy: false,
          blocking: false,
          readyForAvailability: true,
          activeRide: false,
          expectTrackingActive: false,
          primaryIssue: {
            code: 'diagnostic_failed',
            severity: 'warning',
            title: 'Verificação do aparelho indisponível',
            message: 'Não foi possível verificar o GPS e as notificações agora.',
            action: 'retry',
            actionLabel: 'VERIFICAR NOVAMENTE',
          },
        });
      }
      return null;
    } finally {
      checkInFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }, [relevantRoute, route]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (!mounted.current) return;
      setAuthenticated(Boolean(user));
      if (!user) setDiagnostic(null);
    });

    return () => {
      mounted.current = false;
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!relevantRoute || !authenticated) {
      setDiagnostic(null);
      return undefined;
    }

    void runDiagnostic();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runDiagnostic();
    });
    const interval = setInterval(() => {
      void runDiagnostic();
    }, CHECK_INTERVAL_MS);

    return () => {
      appStateSubscription.remove();
      clearInterval(interval);
    };
  }, [authenticated, relevantRoute, runDiagnostic]);

  async function handleAction() {
    const currentIssue = diagnostic?.primaryIssue;
    if (!currentIssue || repairing) return;

    traceGuard('repair_action.pressed', {
      issueCode: currentIssue.code,
      action: currentIssue.action,
    });

    if (currentIssue.action === 'settings') {
      try {
        await Linking.openSettings();
        traceGuard('settings.opened', { issueCode: currentIssue.code });
      } catch (error) {
        traceGuard('settings.open_failed', {
          issueCode: currentIssue.code,
          reason: error?.code || error?.name || 'unknown',
        }, 'warn');
      }
      return;
    }

    setRepairing(true);
    try {
      const repaired = await repairDriverDeviceReadiness({
        expectTrackingActive: diagnostic?.expectTrackingActive === true,
        strictNotificationRegistration: diagnostic?.expectTrackingActive !== true,
        role: 'driver',
      });
      if (mounted.current) setDiagnostic(repaired);
      await runDiagnostic({ allowTrackingRepair: true });
    } finally {
      if (mounted.current) setRepairing(false);
    }
  }

  const currentIssue = diagnostic?.primaryIssue;
  if (!relevantRoute || !authenticated || !currentIssue) return null;

  const blocking = currentIssue.severity === 'blocking';
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        blocking ? styles.blockingContainer : styles.warningContainer,
      ]}
    >
      <View style={styles.copy}>
        <Text
          style={[
            styles.title,
            blocking ? styles.blockingText : styles.warningText,
          ]}
        >
          {currentIssue.title}
        </Text>
        <Text style={styles.message}>{currentIssue.message}</Text>
        {checking && !repairing ? (
          <Text style={styles.checking}>Verificando novamente…</Text>
        ) : null}
      </View>
      <AppButton
        title={repairing ? 'CORRIGINDO…' : currentIssue.actionLabel}
        variant="secondary"
        onPress={handleAction}
        disabled={repairing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  blockingContainer: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.danger,
  },
  warningContainer: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
  },
  copy: {
    gap: spacing.xs,
  },
  title: {
    ...typography.bodyBold,
    fontFamily,
  },
  blockingText: {
    color: colors.danger,
  },
  warningText: {
    color: colors.warning,
  },
  message: {
    ...typography.small,
    fontFamily,
    color: colors.text,
  },
  checking: {
    ...typography.caption,
    fontFamily,
    color: colors.textMuted,
  },
});
