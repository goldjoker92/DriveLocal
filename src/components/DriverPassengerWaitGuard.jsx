import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { auth } from '../config/firebase';
import { colors } from '../constants/colors';
import {
  formatWaitDuration,
  noShowRemainingMs,
} from '../constants/rideCancellation';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';
import {
  listenToMyOffer,
  listenToRide,
  reportPassengerNotFound,
} from '../services/ridesService';
import AppButton from './AppButton';

function isActiveRideRoute(route) {
  return String(route || '').toLowerCase().includes('active-ride');
}

function traceWait(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[RIDE_CANCELLATION] ${event}`, {
    scope: 'driver_passenger_wait',
    event,
    atMs: Date.now(),
    ...details,
  });
}

function confirmPassengerNotFound() {
  return new Promise((resolve) => {
    Alert.alert(
      'Passageiro não apareceu?',
      'Confirme somente se você está no local indicado e aguardou o tempo mínimo. A corrida será cancelada sem taxa automática.',
      [
        { text: 'Continuar aguardando', style: 'cancel', onPress: () => resolve(false) },
        { text: 'CONFIRMAR', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export default function DriverPassengerWaitGuard({ route }) {
  const relevantRoute = isActiveRideRoute(route);
  const [authenticatedUid, setAuthenticatedUid] = useState(auth.currentUser?.uid || null);
  const [offer, setOffer] = useState(null);
  const [ride, setRide] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => auth.onAuthStateChanged((user) => {
    setAuthenticatedUid(user?.uid || null);
    if (!user) {
      setOffer(null);
      setRide(null);
    }
  }), []);

  useEffect(() => {
    if (!relevantRoute || !authenticatedUid) {
      setOffer(null);
      setRide(null);
      return undefined;
    }

    return listenToMyOffer(
      authenticatedUid,
      (nextOffer) => {
        setOffer(nextOffer || null);
        if (nextOffer?.driverRideStatus !== 'driver_arrived') setRide(null);
      },
      (listenerError) => {
        traceWait('offer_listener.failed', {
          reason: listenerError?.code || listenerError?.name || 'unknown',
        }, 'warn');
      },
    );
  }, [authenticatedUid, relevantRoute]);

  const activeRideId = offer?.driverRideStatus === 'driver_arrived' ? offer?.rideId : null;

  useEffect(() => {
    if (!relevantRoute || !activeRideId) {
      setRide(null);
      return undefined;
    }
    return listenToRide(
      activeRideId,
      (nextRide) => setRide(nextRide?.status === 'driver_arrived' ? nextRide : null),
      (listenerError) => {
        traceWait('ride_listener.failed', {
          reason: listenerError?.code || listenerError?.name || 'unknown',
        }, 'warn');
      },
    );
  }, [activeRideId, relevantRoute]);

  useEffect(() => {
    if (!ride?.driverArrivedAtMs) return undefined;
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [ride?.driverArrivedAtMs]);

  if (!relevantRoute || !ride || ride.status !== 'driver_arrived') return null;

  const remainingMs = noShowRemainingMs(ride.driverArrivedAtMs, nowMs);
  const noShowAvailable = remainingMs === 0;
  const elapsedMs = Math.max(0, nowMs - Number(ride.driverArrivedAtMs || nowMs));

  async function handlePassengerNotFound() {
    if (!activeRideId || busy || !noShowAvailable) return;
    const confirmed = await confirmPassengerNotFound();
    if (!confirmed) return;

    setBusy(true);
    setError('');
    traceWait('passenger_no_show.requested', {
      rideId: activeRideId,
      waitElapsedMs: elapsedMs,
    });
    try {
      const result = await reportPassengerNotFound(activeRideId);
      traceWait('passenger_no_show.succeeded', {
        rideId: activeRideId,
        resultStatus: result?.status || 'cancelled',
        waitElapsedMs: elapsedMs,
      });
    } catch (requestError) {
      const serverRemainingMs = Number(requestError?.details?.remainingMs);
      setError(Number.isFinite(serverRemainingMs) && serverRemainingMs > 0
        ? `Aguarde mais ${formatWaitDuration(serverRemainingMs)}.`
        : 'Não foi possível registrar o passageiro como ausente. Verifique a corrida e tente novamente.');
      traceWait('passenger_no_show.failed', {
        rideId: activeRideId,
        reason: requestError?.code || requestError?.name || 'unknown',
      }, 'warn');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View accessibilityRole="alert" style={styles.container}>
      <View style={styles.copy}>
        <Text style={styles.title}>Aguardando passageiro</Text>
        <Text style={styles.timer}>{formatWaitDuration(elapsedMs)}</Text>
        <Text style={styles.message}>
          O passageiro foi avisado da sua chegada. Permaneça no ponto indicado.
        </Text>
        {!noShowAvailable ? (
          <Text style={styles.waiting}>
            “Passageiro não apareceu” em {formatWaitDuration(remainingMs)}
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      <AppButton
        title={busy ? 'REGISTRANDO…' : 'PASSAGEIRO NÃO APARECEU'}
        variant="secondary"
        onPress={handlePassengerNotFound}
        disabled={busy || !noShowAvailable}
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
    borderColor: colors.warning,
    backgroundColor: colors.warningBg,
    gap: spacing.sm,
  },
  copy: {
    gap: spacing.xs,
  },
  title: {
    ...typography.bodyBold,
    fontFamily,
    color: colors.text,
  },
  timer: {
    ...typography.h3,
    fontFamily,
    color: colors.warning,
  },
  message: {
    ...typography.small,
    fontFamily,
    color: colors.textMuted,
  },
  waiting: {
    ...typography.caption,
    fontFamily,
    color: colors.warning,
  },
  error: {
    ...typography.caption,
    fontFamily,
    color: colors.danger,
  },
});