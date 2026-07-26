// Global connectivity banner and safe ride-route restoration.
// It never starts driver availability and never replays a callable automatically.

import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'expo-router';

import { auth } from '../config/firebase';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography, fontFamily } from '../constants/typography';
import {
  clearRideRecoveryHint,
  getNetworkRecoveryState,
  loadRideRecoveryHint,
  probeConnectivity,
  subscribeNetworkRecovery,
} from '../services/networkRecoveryService';
import {
  NETWORK_STATUS,
  rideRecoveryRoute,
  shouldRestoreFromRoute,
} from '../services/networkRecoveryPolicy';

const RECOVERED_VISIBLE_MS = 4500;

function trace(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[NETWORK_RECOVERY_UI] ${event}`, {
    scope: 'network_recovery_ui',
    event,
    atMs: Date.now(),
    ...details,
  });
}

export default function NetworkRecoveryGuard({ route }) {
  const router = useRouter();
  const [network, setNetwork] = useState(getNetworkRecoveryState());
  const [showRecovered, setShowRecovered] = useState(false);
  const appStateRef = useRef(AppState.currentState);
  const restoreInFlightRef = useRef(false);
  const restoredHintRef = useRef(null);
  const authenticatedUidRef = useRef(null);

  async function restoreRideIfNeeded(trigger) {
    const user = auth.currentUser;
    if (!user || restoreInFlightRef.current || !shouldRestoreFromRoute(route)) return;
    restoreInFlightRef.current = true;
    try {
      const hint = await loadRideRecoveryHint(user.uid);
      const destination = rideRecoveryRoute(hint);
      if (!hint || !destination) return;
      const restoreKey = `${hint.role}:${hint.rideId}:${hint.recordedAtMs}`;
      if (restoredHintRef.current === restoreKey) return;
      restoredHintRef.current = restoreKey;
      trace('ride_route.restored', {
        trigger,
        role: hint.role,
        status: hint.status,
        destination: destination.pathname,
      });
      router.replace(destination);
    } catch (error) {
      trace('ride_route.restore_failed', {
        trigger,
        reason: error?.code || error?.name || 'unknown',
      }, 'warn');
    } finally {
      restoreInFlightRef.current = false;
    }
  }

  async function checkConnection(trigger, force = false) {
    trace('probe.requested', { trigger, force });
    const result = await probeConnectivity({ force });
    if (result.status === NETWORK_STATUS.ONLINE) {
      await restoreRideIfNeeded(trigger);
    }
  }

  useEffect(() => subscribeNetworkRecovery(setNetwork), []);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      const previousUid = authenticatedUidRef.current;
      if (user?.uid) {
        authenticatedUidRef.current = user.uid;
        restoredHintRef.current = null;
        restoreRideIfNeeded('auth_restored');
        checkConnection('auth_restored');
      } else if (previousUid) {
        authenticatedUidRef.current = null;
        restoredHintRef.current = null;
        // Clear only after a real authenticated -> signed-out transition. Firebase
        // initially emits null while persistence is loading on some devices.
        clearRideRecoveryHint({ uid: previousUid }).catch(() => undefined);
      }
    });
  }, [route]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const becameActive = appStateRef.current !== 'active' && nextState === 'active';
      appStateRef.current = nextState;
      if (becameActive) {
        checkConnection('app_foreground', true);
        restoreRideIfNeeded('app_foreground');
      }
    });
    return () => subscription.remove();
  }, [route]);

  useEffect(() => {
    if (!(network.lastRecoveredAtMs > 0)) return undefined;
    setShowRecovered(true);
    const timeout = setTimeout(() => setShowRecovered(false), RECOVERED_VISIBLE_MS);
    restoreRideIfNeeded('connection_recovered');
    return () => clearTimeout(timeout);
  }, [network.lastRecoveredAtMs, route]);

  const offline = network.status === NETWORK_STATUS.OFFLINE;
  const reconnecting = network.status === NETWORK_STATUS.RECONNECTING;
  const recovered = network.status === NETWORK_STATUS.ONLINE && showRecovered;
  if (!offline && !reconnecting && !recovered) return null;

  const backgroundColor = offline ? colors.danger : reconnecting ? colors.warning : colors.success;
  const label = offline
    ? 'Sem conexão. Nenhuma ação incerta será repetida automaticamente.'
    : reconnecting
      ? 'Reconectando e conferindo o estado no servidor…'
      : 'Conexão restaurada. Corrida e pagamentos estão sendo atualizados.';

  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
      }}
    >
      <Text style={[{ fontFamily, color: colors.onPrimary, flex: 1 }, typography.small]}>
        {label}
      </Text>
      {offline ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tentar reconectar agora"
          onPress={() => checkConnection('manual_retry', true)}
          style={({ pressed }) => ({
            opacity: pressed ? 0.65 : 1,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
          })}
        >
          <Text style={[{ fontFamily, color: colors.onPrimary }, typography.small]}>
            TENTAR
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
