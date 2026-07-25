// Driver route group layout. Keeps one offer listener and one inexpensive
// foreground GPS safety pulse alive across every driver screen.

import { useEffect, useRef } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { auth } from '../../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../../config/runtimeEnvironment';
import { colors } from '../../constants/colors';
import { getDriver } from '../../services/driverService';
import {
  refreshDriverOnlineHeartbeat,
  updateActiveRideTrackingStatus,
} from '../../services/driverLocationTracking';
import { getRobotDriverState } from '../../services/robotDriverEngine';
import { listenToMyOffer } from '../../services/ridesService';

const FOREGROUND_HEARTBEAT_INTERVAL_MS = 60_000;

export default function DriverLayout() {
  const router = useRouter();
  const segments = useSegments();
  const lastOfferId = useRef(null);
  const onRobotScreen = segments.includes('robot-driver');
  const onActiveRideScreen = segments.includes('active-ride');

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
        await refreshDriverOnlineHeartbeat();
      } catch (error) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log(
            '[DRIVER_LOCATION] foreground heartbeat error',
            error?.code || error?.message || 'unknown'
          );
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
