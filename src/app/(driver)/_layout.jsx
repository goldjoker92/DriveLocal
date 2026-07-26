// Driver route group layout. Keeps one offer listener and one inexpensive
// foreground GPS safety pulse alive across every driver screen.

import { useEffect, useRef } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../../config/runtimeEnvironment';
import { colors } from '../../constants/colors';
import { getDriver } from '../../services/driverService';
import {
  getDriverTrackingSession,
  refreshDriverOnlineHeartbeat,
  stopDriverOnlineTracking,
  updateActiveRideTrackingStatus,
} from '../../services/driverLocationTracking';
import { getRobotDriverState } from '../../services/robotDriverEngine';
import { listenToMyOffer } from '../../services/ridesService';

const FOREGROUND_HEARTBEAT_INTERVAL_MS = 60_000;
const WORK_SESSION_MAX_AGE_MS = 7 * 60 * 1000;
// Firestore may replay a cached pre-transition document immediately after a JS
// reload. Never let that stale snapshot cancel a work session whose local GPS
// transition has only just started.
const REMOTE_RECONCILIATION_GRACE_MS = 12_000;

function shortId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function remoteSessionFresh(driver, nowMs = Date.now()) {
  const serverUpdatedAtMs = timestampMs(driver?.availabilityUpdatedAt)
    || Number(driver?.availabilityUpdatedAtMs || 0);
  return serverUpdatedAtMs > 0 && nowMs - serverUpdatedAtMs <= WORK_SESSION_MAX_AGE_MS;
}

function localSessionInTransition(session, nowMs = Date.now()) {
  const updatedAtMs = Number(session?.updatedAtMs || 0);
  if (!(updatedAtMs > 0)) return false;
  const ageMs = nowMs - updatedAtMs;
  return ageMs >= 0 && ageMs < REMOTE_RECONCILIATION_GRACE_MS;
}

function snapshotNeedsServerConfirmation(metadata = {}) {
  return metadata.fromCache === true || metadata.hasPendingWrites === true;
}

export default function DriverLayout() {
  const router = useRouter();
  const segments = useSegments();
  const lastOfferId = useRef(null);
  const reconciliationBusy = useRef(false);
  const onRobotScreen = segments.includes('robot-driver');
  const onActiveRideScreen = segments.includes('active-ride');

  async function reconcileRemoteDriver(remote, source, metadata = {}) {
    if (reconciliationBusy.current) return;
    const local = await getDriverTrackingSession();
    if (!local || local.rideId || remote?.activeRideId) return;

    const sessionMatches = Boolean(
      remote?.availabilityStatus === 'online'
      && remote?.availabilitySessionId
      && remote.availabilitySessionId === local.availabilitySessionId
      && remoteSessionFresh(remote)
    );
    if (sessionMatches) return;

    // A cache replay is useful for rendering but not authoritative enough to stop
    // an Android foreground service. Wait for a server-confirmed snapshot.
    if (snapshotNeedsServerConfirmation(metadata)) {
      console.log('[DRIVER_AVAILABILITY] layout.reconciliation_deferred', {
        scope: 'driver_availability',
        event: 'layout.reconciliation_deferred',
        source,
        driverId: shortId(local.driverId),
        localSessionId: shortId(local.availabilitySessionId),
        remoteSessionId: shortId(remote?.availabilitySessionId),
        reason: metadata.hasPendingWrites ? 'pending_writes' : 'snapshot_from_cache',
        result: 'waiting_for_server',
        atMs: Date.now(),
      });
      return;
    }

    // Also protect the short interval between writing the local session and the
    // callable/server snapshot reaching every listener after reload or fast refresh.
    if (localSessionInTransition(local)) {
      console.log('[DRIVER_AVAILABILITY] layout.reconciliation_deferred', {
        scope: 'driver_availability',
        event: 'layout.reconciliation_deferred',
        source,
        driverId: shortId(local.driverId),
        localSessionId: shortId(local.availabilitySessionId),
        remoteSessionId: shortId(remote?.availabilitySessionId),
        reason: 'local_transition_grace',
        result: 'waiting_for_stable_state',
        atMs: Date.now(),
      });
      return;
    }

    reconciliationBusy.current = true;
    console.warn('[DRIVER_AVAILABILITY] layout.remote_session_revoked', {
      scope: 'driver_availability',
      event: 'layout.remote_session_revoked',
      source,
      driverId: shortId(local.driverId),
      localSessionId: shortId(local.availabilitySessionId),
      remoteSessionId: shortId(remote?.availabilitySessionId),
      remoteStatus: remote?.availabilityStatus || 'missing',
      reason: remote?.availabilityStatus !== 'online'
        ? 'remote_offline'
        : remote?.availabilitySessionId !== local.availabilitySessionId
          ? 'session_mismatch'
          : 'lease_expired',
      atMs: Date.now(),
    });
    try {
      await stopDriverOnlineTracking();
      if (!onActiveRideScreen) router.replace('/driver-home');
    } finally {
      reconciliationBusy.current = false;
    }
  }

  useEffect(() => {
    let active = true;

    async function pulse() {
      if (!active) return;
      if (DEV_RIDE_SIMULATOR_ENABLED && getRobotDriverState().enabled) {
        console.log('[ROBOT_DRIVER] native_heartbeat.skipped', {
          reason: 'robot_simulation_active',
          atMs: Date.now(),
        });
        return;
      }
      try {
        const result = await refreshDriverOnlineHeartbeat();
        if (typeof __DEV__ !== 'undefined' && __DEV__ && result?.status === 'published') {
          console.log('[DRIVER_AVAILABILITY] foreground_heartbeat.published', {
            scope: 'driver_availability',
            event: 'foreground_heartbeat.published',
            result: result.status,
            atMs: Date.now(),
          });
        }
      } catch (error) {
        console.warn('[DRIVER_AVAILABILITY] foreground_heartbeat.failed', {
          scope: 'driver_availability',
          event: 'foreground_heartbeat.failed',
          reason: error?.code || error?.message || 'unknown',
          atMs: Date.now(),
        });

        // A temporary network error alone does not immediately end work. Re-read
        // the authoritative driver document and stop only when the remote lease or
        // session is genuinely invalid. The transition grace still applies here.
        const uid = auth.currentUser?.uid;
        if (uid) {
          try {
            const remote = await getDriver(uid);
            await reconcileRemoteDriver(remote, 'foreground_heartbeat_error');
          } catch (_readError) {
            // Keep the local foreground service alive; the seven-minute server
            // lease still prevents ghost dispatch while connectivity is uncertain.
          }
        }
      }
    }

    pulse();
    const timer = setInterval(pulse, FOREGROUND_HEARTBEAT_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') pulse();
    });

    return () => {
      active = false;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    return onSnapshot(
      doc(db, 'drivers', uid),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!snapshot.exists()) return;
        reconcileRemoteDriver(
          snapshot.data(),
          'driver_snapshot',
          snapshot.metadata || {}
        ).catch((error) => {
          console.warn('[DRIVER_AVAILABILITY] layout.reconciliation_failed', {
            scope: 'driver_availability',
            event: 'layout.reconciliation_failed',
            driverId: shortId(uid),
            reason: error?.code || error?.message || 'unknown',
            atMs: Date.now(),
          });
        });
      },
      (error) => {
        console.warn('[DRIVER_AVAILABILITY] layout.driver_listener_failed', {
          scope: 'driver_availability',
          event: 'layout.driver_listener_failed',
          driverId: shortId(uid),
          reason: error?.code || error?.message || 'unknown',
          atMs: Date.now(),
        });
      }
    );
  }, [onActiveRideScreen, router]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    return listenToMyOffer(uid, async (offer) => {
      if (!offer?.offerId) return;

      if (offer.status === 'accepted') {
        if (offer.driverRideStatus) {
          await updateActiveRideTrackingStatus(offer.driverRideStatus).catch(() => undefined);
        }

        // Do not steal navigation from tools/screens that intentionally coexist
        // with an active ride. Re-subscribing replays the accepted snapshot.
        if (onRobotScreen || onActiveRideScreen) return;

        try {
          const driver = await getDriver(uid);
          if (driver?.activeRideId && driver.activeRideId === offer.rideId) {
            router.replace({ pathname: '/active-ride', params: { rideId: driver.activeRideId } });
          }
        } catch (_error) {
          // Screen listeners and push notifications remain available.
        }
        return;
      }

      if (offer.status !== 'offered' || Number(offer.expiresAtMs || 0) <= Date.now()) return;

      const trackingSession = await getDriverTrackingSession();
      if (
        !trackingSession?.availabilitySessionId
        || offer.availabilitySessionId !== trackingSession.availabilitySessionId
      ) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log('[RIDE_OFFER] stale work-session offer ignored', {
            offerId: offer.offerId,
            atMs: Date.now(),
          });
        }
        return;
      }

      const alreadyOnOfferScreen = segments.includes('ride-request');
      if (alreadyOnOfferScreen && lastOfferId.current === offer.offerId) return;
      lastOfferId.current = offer.offerId;
      router.push({ pathname: '/ride-request', params: { offerId: offer.offerId } });
    });
  }, [router, segments, onRobotScreen, onActiveRideScreen]);

  return (
    <View style={styles.container}>
      <Stack screenOptions={{ headerShown: false }} />
      {DEV_RIDE_SIMULATOR_ENABLED && !onRobotScreen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ouvrir Robot Driver"
          onPress={() => router.push('/robot-driver')}
          style={styles.robotButton}
        >
          <Text style={styles.robotButtonText}>🤖 ROBOT</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  robotButton: {
    position: 'absolute',
    right: 14,
    bottom: 24,
    minHeight: 44,
    paddingHorizontal: 15,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warning,
    borderWidth: 2,
    borderColor: colors.white,
    elevation: 8,
  },
  robotButtonText: { color: colors.white, fontWeight: '900', fontSize: 12, letterSpacing: 0.4 },
});
