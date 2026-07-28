import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { auth } from '../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../config/runtimeEnvironment';
import { colors } from '../constants/colors';
import {
  formatWaitDuration,
  noShowRemainingMs,
} from '../constants/rideCancellation';
import { radius, spacing } from '../constants/spacing';
import { fontFamily, typography } from '../constants/typography';
import { stopDevRideSimulation } from '../services/devRideSimulation';
import { detachActiveRideTracking } from '../services/driverLocationTracking';
import {
  cancelRide,
  listenToMyOffer,
  reportPassengerNotFound,
} from '../services/ridesService';
import { driverArrivalConfirmationCopy } from '../utils/driverArrivalNotification';
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

function confirmDevRideReset() {
  return new Promise((resolve) => {
    Alert.alert(
      'Recomeçar o teste?',
      'Esta ação existe somente no modo DEV. A corrida atual será cancelada, o rastreamento será limpo e o motorista voltará ao início para criar um novo teste.',
      [
        { text: 'Continuar nesta corrida', style: 'cancel', onPress: () => resolve(false) },
        { text: 'RECOMEÇAR', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export default function DriverPassengerWaitGuard({ route }) {
  const router = useRouter();
  const relevantRoute = isActiveRideRoute(route);
  const [authenticatedUid, setAuthenticatedUid] = useState(auth.currentUser?.uid || null);
  const [offer, setOffer] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => auth.onAuthStateChanged((user) => {
    setAuthenticatedUid(user?.uid || null);
    if (!user) {
      setOffer(null);
      setDetailsOpen(false);
    }
  }), []);

  useEffect(() => {
    if (!relevantRoute || !authenticatedUid) {
      setOffer(null);
      setDetailsOpen(false);
      return undefined;
    }

    // driverOffers is the driver's private safe projection. Do not read the full
    // ride document here: Firestore intentionally keeps its destination private.
    return listenToMyOffer(
      authenticatedUid,
      (nextOffer) => {
        const waitingOffer = nextOffer?.driverRideStatus === 'driver_arrived' ? nextOffer : null;
        setOffer(waitingOffer);
        if (!waitingOffer) {
          setError('');
          setDetailsOpen(false);
        }
      },
      (listenerError) => {
        traceWait('offer_listener.failed', {
          reason: listenerError?.code || listenerError?.name || 'unknown',
        }, 'warn');
      },
    );
  }, [authenticatedUid, relevantRoute]);

  const activeRideId = offer?.rideId || null;
  const driverArrivedAtMs = Number(offer?.driverArrivedAtMs || 0);
  const serverEligibleAtMs = Number(offer?.passengerNoShowEligibleAtMs || 0);

  useEffect(() => {
    if (!driverArrivedAtMs) return undefined;
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [driverArrivedAtMs]);

  if (!relevantRoute || !offer || !driverArrivedAtMs) return null;

  const remainingMs = serverEligibleAtMs > 0
    ? Math.max(0, serverEligibleAtMs - nowMs)
    : noShowRemainingMs(driverArrivedAtMs, nowMs);
  const noShowAvailable = remainingMs === 0;
  const elapsedMs = Math.max(0, nowMs - driverArrivedAtMs);
  const arrivalCopy = driverArrivalConfirmationCopy(offer);

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
      setDetailsOpen(false);
      traceWait('passenger_no_show.succeeded', {
        rideId: activeRideId,
        resultStatus: result?.status || 'cancelled',
        waitElapsedMs: elapsedMs,
      });
    } catch (requestError) {
      const serverRemainingMs = Number(requestError?.details?.metadata?.remainingMs);
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

  async function handleDevRideReset() {
    if (!DEV_RIDE_SIMULATOR_ENABLED || !activeRideId || busy) return;
    const confirmed = await confirmDevRideReset();
    if (!confirmed) return;

    setBusy(true);
    setError('');
    traceWait('dev_test_reset.requested', {
      rideId: activeRideId,
      rideStatus: offer?.driverRideStatus || 'driver_arrived',
      waitElapsedMs: elapsedMs,
    });

    try {
      const result = await cancelRide(activeRideId, 'driver_other', 'driver');
      await stopDevRideSimulation({ restoreRealTracking: false }).catch(() => undefined);
      await detachActiveRideTracking(activeRideId).catch(() => undefined);

      setDetailsOpen(false);
      traceWait('dev_test_reset.succeeded', {
        rideId: activeRideId,
        resultStatus: result?.status || 'cancelled',
      });
      router.replace('/driver-home');
    } catch (resetError) {
      setError('Não foi possível reiniciar o teste. Verifique a conexão e tente novamente.');
      traceWait('dev_test_reset.failed', {
        rideId: activeRideId,
        reason: resetError?.code || resetError?.name || 'unknown',
      }, 'warn');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View
        accessibilityRole="alert"
        style={[styles.container, DEV_RIDE_SIMULATOR_ENABLED && styles.devContainer]}
      >
        <View style={styles.summaryRow}>
          <View style={styles.summaryCopy}>
            <Text style={[
              styles.eyebrow,
              DEV_RIDE_SIMULATOR_ENABLED && styles.devEyebrow,
            ]}>
              {DEV_RIDE_SIMULATOR_ENABLED ? '🧪 MODO DE TESTE' : 'PASSAGEIRO AVISADO'}
            </Text>
            <Text style={styles.title}>
              Chegada registrada · {formatWaitDuration(elapsedMs)}
            </Text>
            <Text style={styles.waiting}>
              {noShowAvailable
                ? 'Você já pode registrar que o passageiro não apareceu.'
                : `Ausência disponível em ${formatWaitDuration(remainingMs)}`}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ver detalhes da espera"
            onPress={() => setDetailsOpen(true)}
            style={({ pressed }) => [styles.detailsButton, pressed && styles.pressed]}
          >
            <Text style={styles.detailsButtonText}>DETALHES</Text>
          </Pressable>
        </View>

        {noShowAvailable ? (
          <AppButton
            title={busy ? 'REGISTRANDO…' : 'PASSAGEIRO NÃO APARECEU'}
            variant="secondary"
            onPress={handlePassengerNotFound}
            disabled={busy || !noShowAvailable}
            style={styles.compactAction}
          />
        ) : null}

        {DEV_RIDE_SIMULATOR_ENABLED ? (
          <AppButton
            title={busy ? 'REINICIANDO…' : 'RECOMEÇAR O TESTE'}
            variant="danger"
            haptic="warning"
            onPress={handleDevRideReset}
            disabled={busy}
            style={styles.compactAction}
          />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={detailsOpen}
        onRequestClose={() => !busy && setDetailsOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Aguardando passageiro</Text>
            <Text style={styles.modalSubtitle}>
              A corrida continua disponível na tela principal enquanto você aguarda.
            </Text>

            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.confirmationBox}>
                <Text style={styles.confirmationEyebrow}>PASSAGEIRO AVISADO</Text>
                <Text style={styles.confirmationTitle}>{arrivalCopy.title}</Text>
                <Text style={styles.confirmationMessage}>{arrivalCopy.message}</Text>
                <Text style={styles.confirmationNote}>{arrivalCopy.deliveryNote}</Text>
                <Text style={styles.confirmationNote}>{arrivalCopy.offlineNote}</Text>
              </View>

              <View style={styles.waitDetails}>
                <Text style={styles.waitDetailsTitle}>Tempo no local</Text>
                <Text style={styles.timer}>{formatWaitDuration(elapsedMs)}</Text>
                <Text style={styles.message}>
                  Permaneça no ponto indicado até o passageiro embarcar.
                </Text>
                {!noShowAvailable ? (
                  <Text style={styles.waiting}>
                    “Passageiro não apareceu” em {formatWaitDuration(remainingMs)}
                  </Text>
                ) : null}
              </View>

              <AppButton
                title={busy ? 'REGISTRANDO…' : 'PASSAGEIRO NÃO APARECEU'}
                variant="secondary"
                onPress={handlePassengerNotFound}
                disabled={busy || !noShowAvailable}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>

            <AppButton
              title="FECHAR"
              variant="ghost"
              onPress={() => setDetailsOpen(false)}
              disabled={busy}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningBg,
    gap: spacing.sm,
  },
  devContainer: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    ...typography.caption,
    fontFamily,
    color: colors.warning,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  devEyebrow: {
    color: colors.primary,
  },
  title: {
    ...typography.bodyBold,
    fontFamily,
    color: colors.text,
  },
  waiting: {
    ...typography.caption,
    fontFamily,
    color: colors.warning,
  },
  detailsButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailsButtonText: {
    ...typography.caption,
    fontFamily,
    color: colors.primary,
    fontWeight: '800',
  },
  compactAction: {
    minHeight: 42,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.76,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(15, 27, 45, 0.58)',
  },
  modalCard: {
    maxHeight: '88%',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  modalTitle: {
    ...typography.h3,
    fontFamily,
    color: colors.text,
  },
  modalSubtitle: {
    ...typography.small,
    fontFamily,
    color: colors.textMuted,
  },
  modalContent: {
    gap: spacing.md,
  },
  confirmationBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: colors.successBg,
    gap: spacing.xs,
  },
  confirmationEyebrow: {
    ...typography.caption,
    fontFamily,
    color: colors.success,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  confirmationTitle: {
    ...typography.bodyBold,
    fontFamily,
    color: colors.text,
  },
  confirmationMessage: {
    ...typography.small,
    fontFamily,
    color: colors.text,
  },
  confirmationNote: {
    ...typography.caption,
    fontFamily,
    color: colors.textMuted,
    lineHeight: 17,
  },
  waitDetails: {
    gap: spacing.xs,
  },
  waitDetailsTitle: {
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
  error: {
    ...typography.caption,
    fontFamily,
    color: colors.danger,
  },
});