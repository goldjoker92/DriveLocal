// Active driver ride screen (route "/active-ride"). The secured accepted-offer
// projection is the only UI data source. High-frequency GPS and lifecycle actions
// remain delegated to the existing services; this screen owns hierarchy and feedback.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import DriverActiveRideNavigationCard from '../../components/DriverActiveRideNavigationCard';
import DriverActiveRidePrimaryFooter from '../../components/DriverActiveRidePrimaryFooter';
import DriverActiveRideStageCard from '../../components/DriverActiveRideStageCard';
import PixPaymentSummary from '../../components/PixPaymentSummary';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../../config/runtimeEnvironment';
import { formatBRL } from '../../utils/format';
import { logRideClientEvent } from '../../utils/clientRideLog';
import {
  deriveDriverActiveRideNavigation,
  deriveDriverActiveRidePrimaryAction,
  deriveDriverActiveRideStage,
  driverActiveRideNavigationMode,
} from '../../utils/driverActiveRideScreen';
import {
  openGoogleMapsRoute,
  openGoogleMapsToPoint,
  openWazeToPoint,
} from '../../utils/maps';
import {
  attachActiveRideTracking,
  detachActiveRideTracking,
  restoreRealDriverTrackingAfterSimulation,
  superviseActiveRideTracking,
} from '../../services/driverLocationTracking';
import { driverRideTrackingPresentation } from '../../utils/rideLiveLocationPresentation';
import {
  getDevRideSimulationState,
  getDevSimulatedCurrentPoint,
  pauseDevRideSimulation,
  resumeDevRideSimulation,
  startDevRideSimulation,
  stopDevRideSimulation,
  subscribeDevRideSimulation,
} from '../../services/devRideSimulation';
import { getRobotDriverState } from '../../services/robotDriverEngine';
import {
  cancelRide,
  confirmDriverPixReceived,
  finishRide,
  listenToMyOffer,
  markDriverArrived,
  reportPaymentIssue,
  startRide,
} from '../../services/ridesService';

const TRACKED_STATUSES = new Set(['assigned', 'driver_arrived', 'in_progress']);
// While this screen is open, the ride point is checked every 10 s and repaired
// if it stopped (driverLocationTracking.superviseActiveRideTracking).
const RIDE_TRACKING_SUPERVISE_INTERVAL_MS = 10_000;
const PAYMENT_STATUSES = new Set([
  'awaiting_payment',
  'payment_marked_sent',
  'completed',
  'disputed',
]);
const ROBOT_NAVIGATION_STATUSES = new Set(['running', 'paused', 'completed']);
const DEV_SIMULATION_OVERRIDE_STATUSES = new Set([
  'running',
  'paused',
  'completed',
  'interrupted',
  'error',
]);
const SUCCESS_VISIBLE_MS = 5000;

function statusFromEvent(eventType) {
  const map = {
    ride_payment_marked_sent: 'payment_marked_sent',
    ride_completed: 'completed',
    ride_cancelled: 'cancelled',
    ride_disputed: 'disputed',
  };
  return map[eventType] || 'assigned';
}

function confirmNavigationWithoutLiveLocation() {
  return new Promise((resolve) => {
    Alert.alert(
      'Localização ao vivo ainda não está ativa',
      'O passageiro não verá você se aproximar no mapa. Ative a localização antes de abrir a navegação.',
      [
        { text: 'Ativar agora', onPress: () => resolve('enable') },
        { text: 'Abrir mesmo assim', style: 'cancel', onPress: () => resolve('open') },
      ],
      { cancelable: true, onDismiss: () => resolve('open') }
    );
  });
}

function simulationStatusLabel(simulation) {
  const labels = {
    idle: 'GPS real ativo. Nenhuma simulação iniciada.',
    running: 'Trajeto simulado em andamento.',
    paused: 'Trajeto simulado pausado.',
    completed: 'Trajeto simulado concluído. Continue usando os botões normais da corrida.',
    interrupted: 'A simulação foi interrompida por uma reinicialização do aplicativo.',
    stopped: 'Simulação encerrada e GPS real restaurado.',
    error: 'A simulação encontrou um erro. Use o código abaixo para depurar.',
  };
  return labels[simulation?.status] || labels.idle;
}

function simulationErrorLabel(errorCode) {
  const labels = {
    DEV_SIMULATION_SESSION_MISMATCH: 'Abra a corrida ativa e confirme que o GPS está ativo antes de simular.',
    DEV_SIMULATION_OVERRIDE_MISSING: 'A sessão de simulação expirou. Inicie o trajeto novamente.',
    DEV_SIMULATION_LOCATION_REJECTED: 'A posição simulada foi recusada. Verifique autenticação e regras Firestore.',
    DEV_SIMULATION_PROCESS_RESTARTED: 'O processo foi reiniciado. Inicie novamente o trajeto desejado.',
  };
  return labels[errorCode] || 'Não foi possível executar a simulação DEV.';
}

function confirmRideTrackingDisclosure() {
  return new Promise((resolve) => {
    Alert.alert(
      'Localização da corrida',
      'Durante esta corrida, sua posição será mostrada somente ao passageiro desta viagem, inclusive quando Waze ou Google Maps estiver aberto. O compartilhamento termina quando a corrida é finalizada ou cancelada.',
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Ativar', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

function confirmRobotWazeOpen() {
  return new Promise((resolve) => {
    Alert.alert(
      'Modo Robot Driver',
      'O Waze usará a localização real deste telefone. Para visualizar o trajeto a partir da posição simulada, use o Google Maps.',
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Abrir Waze', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

function cleanupStageForStatus(status) {
  return ['completed', 'cancelled', 'disputed'].includes(status) ? 'terminal' : 'payment';
}

export default function ActiveRide() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const eventType = typeof params.eventType === 'string' ? params.eventType : null;

  const cleanupDoneRef = useRef(new Set());
  const cleanupInFlightRef = useRef(new Map());
  const [offer, setOffer] = useState(null);
  const [status, setStatus] = useState(() => statusFromEvent(eventType));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [trackingStatus, setTrackingStatus] = useState('checking');
  const [devSimulation, setDevSimulation] = useState({ status: 'idle' });

  const paymentAmount = offer?.paymentAmountCentavos;
  const paymentPayload = offer?.paymentPixPayload;

  useEffect(() => {
    cleanupDoneRef.current = new Set();
    cleanupInFlightRef.current = new Map();
  }, [rideId]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !rideId) return undefined;

    return listenToMyOffer(
      uid,
      (nextOffer) => {
        if (!nextOffer) return;
        setOffer(nextOffer);
        if (nextOffer.driverRideStatus) {
          setStatus(nextOffer.driverRideStatus);
        } else if (nextOffer.exactDestination) {
          setStatus((current) => current === 'assigned' ? 'in_progress' : current);
        }
      },
      () => setError('Não foi possível carregar a corrida.'),
      rideId
    );
  }, [rideId]);

  useEffect(() => {
    if (!rideId || !PAYMENT_STATUSES.has(status)) return;
    logRideClientEvent('pix.driver.screen_status_changed', {
      rideId,
      status,
      amountCentavos: paymentAmount,
      hasPayload: Boolean(paymentPayload),
    });
  }, [rideId, status, paymentAmount, paymentPayload]);

  useEffect(() => {
    if (!rideId || status !== 'completed') return undefined;

    logRideClientEvent('pix.driver.success_feedback_started', {
      rideId,
      visibleForMs: SUCCESS_VISIBLE_MS,
    });

    const timeout = setTimeout(() => {
      logRideClientEvent('pix.driver.success_feedback_finished', { rideId });
      router.replace('/driver-home');
    }, SUCCESS_VISIBLE_MS);

    return () => clearTimeout(timeout);
  }, [rideId, status, router]);

  useEffect(() => {
    if (!DEV_RIDE_SIMULATOR_ENABLED || !rideId) return undefined;
    let active = true;

    getDevRideSimulationState().then((next) => {
      if (!active) return;
      if (!next?.rideId || next.rideId === rideId) {
        setDevSimulation(next || { status: 'idle' });
      }
    });

    const unsubscribe = subscribeDevRideSimulation((next) => {
      if (!next?.rideId || next.rideId === rideId) {
        setDevSimulation(next || { status: 'idle' });
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [rideId]);

  async function cleanupTrackingAfterRide(stage = cleanupStageForStatus(status)) {
    if (!rideId) return;
    const cleanupKey = `${rideId}:${stage}`;
    if (cleanupDoneRef.current.has(cleanupKey)) return;

    const existing = cleanupInFlightRef.current.get(cleanupKey);
    if (existing) return existing;

    const operation = (async () => {
      const robotActive = DEV_RIDE_SIMULATOR_ENABLED && getRobotDriverState().enabled;
      const localDevSimulationActive = DEV_RIDE_SIMULATOR_ENABLED
        && (!devSimulation?.rideId || devSimulation.rideId === rideId)
        && DEV_SIMULATION_OVERRIDE_STATUSES.has(devSimulation?.status);

      console.log('[DRIVER_LOCATION] active_ride.cleanup_started', {
        scope: 'driver_location',
        event: 'active_ride.cleanup_started',
        rideId,
        stage,
        robotActive,
        localDevSimulationActive,
        atMs: Date.now(),
      });

      if (localDevSimulationActive) {
        await stopDevRideSimulation({ restoreRealTracking: false });
      }

      await detachActiveRideTracking(rideId);

      // Robot Driver owns its synthetic waiting position and must not be replaced
      // by the phone's real GPS after every ride. Local DEV simulation does restore it.
      if (localDevSimulationActive && !robotActive) {
        await restoreRealDriverTrackingAfterSimulation();
      }

      cleanupDoneRef.current.add(cleanupKey);
      console.log('[DRIVER_LOCATION] active_ride.cleanup_succeeded', {
        scope: 'driver_location',
        event: 'active_ride.cleanup_succeeded',
        rideId,
        stage,
        robotActive,
        restoredRealGps: localDevSimulationActive && !robotActive,
        atMs: Date.now(),
      });
    })().finally(() => {
      cleanupInFlightRef.current.delete(cleanupKey);
    });

    cleanupInFlightRef.current.set(cleanupKey, operation);
    return operation;
  }

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !rideId || !offer?.vehicleType) return undefined;
    let active = true;

    if (TRACKED_STATUSES.has(status)) {
      attachActiveRideTracking({
        driverId: uid,
        vehicleType: offer.vehicleType,
        availabilitySessionId: offer.availabilitySessionId || null,
        rideId,
        rideStatus: status,
        requestPermissions: false,
      }).then((result) => {
        if (!active) return;
        setTrackingStatus(result.status === 'active' ? 'active' : result.status);
      }).catch(() => {
        if (active) setTrackingStatus('error');
      });
    } else {
      cleanupTrackingAfterRide(cleanupStageForStatus(status)).finally(() => {
        if (active) setTrackingStatus('stopped');
      });
    }

    return () => {
      active = false;
    };
  }, [rideId, offer?.vehicleType, offer?.availabilitySessionId, status]);

  // Ride live-location supervision. The attach above runs once per stage; this
  // keeps repairing without any driver action: a failed first GPS fix, a native
  // service stopped by Android, a point that stopped flowing. It also runs as
  // soon as the driver comes back from Waze / Google Maps.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !rideId || !offer?.vehicleType || !TRACKED_STATUSES.has(status)) return undefined;
    let active = true;

    async function supervise(trigger) {
      if (DEV_RIDE_SIMULATOR_ENABLED && getRobotDriverState().enabled) return;
      const result = await superviseActiveRideTracking({ reason: trigger });
      if (!active || !result?.status) return;
      if (result.status === 'no_ride_session') {
        // The local ride session disappeared (cleanup, storage reset): rebuild it
        // from the confirmed ride, without asking anything to the driver.
        const reattached = await attachActiveRideTracking({
          driverId: uid,
          vehicleType: offer.vehicleType,
          availabilitySessionId: offer.availabilitySessionId || null,
          rideId,
          rideStatus: status,
          requestPermissions: false,
        }).catch(() => ({ status: 'error' }));
        if (active) setTrackingStatus(reattached.status);
        return;
      }
      setTrackingStatus(result.status);
    }

    const timer = setInterval(() => { supervise('screen_interval'); }, RIDE_TRACKING_SUPERVISE_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') supervise('app_foreground');
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [rideId, offer?.vehicleType, offer?.availabilitySessionId, status]);

  // "Tentar agora": same repair as the automatic loop, on demand.
  async function retryRideTracking() {
    setTrackingStatus('checking');
    const result = await superviseActiveRideTracking({ reason: 'driver_retry' })
      .catch(() => ({ status: 'error' }));
    setTrackingStatus(result?.status || 'error');
  }

  async function enableRideTracking() {
    const uid = auth.currentUser?.uid;
    if (!uid || !rideId || !offer?.vehicleType) return;

    const consented = await confirmRideTrackingDisclosure();
    if (!consented) return;

    setTrackingStatus('checking');
    try {
      const result = await attachActiveRideTracking({
        driverId: uid,
        vehicleType: offer.vehicleType,
        availabilitySessionId: offer.availabilitySessionId || null,
        rideId,
        rideStatus: status,
        requestPermissions: true,
      });
      setTrackingStatus(result.status === 'active' ? 'active' : result.status);
    } catch (_error) {
      setTrackingStatus('error');
    }
  }

  async function act(key, fn) {
    if (!rideId || busy) return;
    setBusy(key);
    setError('');

    try {
      const result = await fn(rideId);
      if (result?.status) setStatus(result.status);

      if (
        result
        && ['awaiting_payment', 'completed', 'cancelled', 'disputed'].includes(result.status)
      ) {
        await cleanupTrackingAfterRide(cleanupStageForStatus(result.status));
      }

      // Success and payment failure remain visible. Only cancellation exits now.
      if (result?.status === 'cancelled') {
        router.replace('/driver-home');
      }
    } catch (actionError) {
      const message = actionError?.message || 'Não foi possível concluir. Tente novamente.';
      setError(message);
      logRideClientEvent('pix.driver.ui_action_failed', {
        rideId,
        action: key,
        status,
        amountCentavos: paymentAmount,
        error: actionError,
      }, 'error');
    } finally {
      setBusy('');
    }
  }

  async function startSimulation(target, mode) {
    const uid = auth.currentUser?.uid;
    if (!DEV_RIDE_SIMULATOR_ENABLED || !uid || !rideId || !offer?.vehicleType || busy) return;

    setBusy('simulation');
    setError('');
    try {
      const result = await startDevRideSimulation({
        driverId: uid,
        vehicleType: offer.vehicleType,
        rideId,
        target,
        mode,
      });
      setDevSimulation(result);
      if (result?.status === 'error') setError(simulationErrorLabel(result.errorCode));
    } catch (_error) {
      setError('Não foi possível iniciar o trajeto simulado.');
    } finally {
      setBusy('');
    }
  }

  async function restoreRealGps() {
    if (!DEV_RIDE_SIMULATOR_ENABLED || busy) return;

    setBusy('restore-gps');
    setError('');
    try {
      const result = await stopDevRideSimulation({ restoreRealTracking: true });
      setDevSimulation(result);
      if (result?.status && result.status !== 'stopped' && result.status !== 'active') {
        setError(driverRideTrackingPresentation(result.status).message);
      }
    } catch (_error) {
      setError('Não foi possível restaurar o GPS real.');
    } finally {
      setBusy('');
    }
  }

  async function openNav(point, which, targetKind) {
    if (!point) return;
    if (!offer?.vehicleType) {
      setError('Aguarde o tipo do veículo antes de abrir a navegação.');
      return;
    }

    // Leaving for Waze / Google Maps while the passenger cannot see the car is
    // exactly how the 2026-09-27 cancellations started. Warn, never block.
    if (TRACKED_STATUSES.has(status) && trackingStatus !== 'active' && !DEV_RIDE_SIMULATOR_ENABLED) {
      const choice = await confirmNavigationWithoutLiveLocation();
      logRideClientEvent('navigation.driver_live_location_warning', {
        rideId,
        rideStatus: status,
        trackingStatus,
        choice,
      });
      if (choice === 'enable') {
        const presentation = driverRideTrackingPresentation(trackingStatus);
        if (presentation.actionKind === 'enable') await enableRideTracking();
        else await retryRideTracking();
        return;
      }
    }

    setError('');
    const simulatedOrigin = DEV_RIDE_SIMULATOR_ENABLED
      ? getDevSimulatedCurrentPoint(rideId)
      : null;
    const robotNavigationActive = DEV_RIDE_SIMULATOR_ENABLED
      && (Boolean(simulatedOrigin) || ROBOT_NAVIGATION_STATUSES.has(devSimulation?.status))
      && (!devSimulation?.rideId || devSimulation.rideId === rideId);
    const provider = which === 'waze' ? 'waze' : 'google_maps';
    const originMode = which === 'waze'
      ? 'device_gps'
      : simulatedOrigin
        ? 'simulated_robot'
        : robotNavigationActive
          ? 'fallback_device_gps'
          : 'device_gps';

    try {
      if (which === 'waze' && robotNavigationActive) {
        const confirmed = await confirmRobotWazeOpen();
        if (!confirmed) {
          logRideClientEvent('navigation.driver_open_cancelled', {
            rideId,
            rideStatus: status,
            provider,
            targetKind,
            destination: point,
            destinationLabel: point.label || null,
            originMode,
            simulatedOrigin,
          });
          return;
        }
      }

      logRideClientEvent('navigation.driver_open', {
        rideId,
        rideStatus: status,
        provider,
        targetKind,
        destination: point,
        destinationLabel: point.label || null,
        originMode,
        simulatedOrigin,
      });

      if (which === 'waze') {
        await openWazeToPoint(point, offer.vehicleType);
      } else if (simulatedOrigin) {
        await openGoogleMapsRoute({
          origin: simulatedOrigin,
          destination: point,
          vehicleType: offer.vehicleType,
        });
      } else {
        await openGoogleMapsToPoint(point, offer.vehicleType);
      }
    } catch (_error) {
      setError(which === 'waze'
        ? 'Não foi possível abrir o Waze. Tente o Google Maps.'
        : 'Não foi possível abrir o Google Maps. Tente o Waze.');
    }
  }

  const pickup = offer?.exactPickup;
  const destination = offer?.exactDestination;
  const trackingActive = trackingStatus === 'active';
  const trackingPresentation = driverRideTrackingPresentation(trackingStatus);
  const simulationRunning = devSimulation?.status === 'running';
  const simulationPaused = devSimulation?.status === 'paused';
  const paymentOpen = status === 'awaiting_payment' || status === 'payment_marked_sent';
  const paymentFailed = status === 'disputed';
  const paymentCompleted = status === 'completed';
  const headerTitle = PAYMENT_STATUSES.has(status) ? 'Pagamento Pix' : 'Corrida ativa';

  const stage = useMemo(() => deriveDriverActiveRideStage(status), [status]);
  const navigation = useMemo(
    () => deriveDriverActiveRideNavigation({ status, pickup, destination }),
    [status, pickup, destination]
  );
  const navigationMode = useMemo(
    () => driverActiveRideNavigationMode(offer?.vehicleType),
    [offer?.vehicleType]
  );
  const primaryAction = useMemo(
    () => deriveDriverActiveRidePrimaryAction({
      status,
      busy,
      hasPickup: Boolean(pickup),
      hasDestination: Boolean(destination),
      hasPaymentPayload: Boolean(paymentPayload),
    }),
    [status, busy, pickup, destination, paymentPayload]
  );

  const trackingState = !TRACKED_STATUSES.has(status)
    ? 'stopped'
    : trackingActive
      ? 'active'
      : trackingStatus === 'checking'
        ? 'checking'
        : 'attention';

  async function runPrimaryAction() {
    if (!primaryAction || primaryAction.disabled) return;

    logRideClientEvent('driver.active_ride.primary_action_pressed', {
      rideId,
      status,
      action: primaryAction.key,
    });

    const actions = {
      arrive: () => act('arrive', markDriverArrived),
      start: () => act('start', startRide),
      finish: () => act('finish', finishRide),
      confirm: () => act('confirm', confirmDriverPixReceived),
    };

    const handler = actions[primaryAction.key];
    if (handler) await handler();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Header title={headerTitle} onBack={() => router.back()} />

        {!rideId ? (
          <Text style={styles.invalidRide}>Corrida inválida.</Text>
        ) : null}

        {rideId ? (
          <DriverActiveRideStageCard stage={stage} trackingState={trackingState} />
        ) : null}

        {TRACKED_STATUSES.has(status) ? (
          <AppCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Localização ao vivo</Text>
            <Text
              style={[
                styles.sectionCopy,
                trackingPresentation.tone === 'active'
                  ? styles.successText
                  : trackingPresentation.tone === 'action' ? styles.dangerText : styles.warningText,
              ]}
            >
              {trackingPresentation.message}
            </Text>
            {trackingPresentation.actionKind ? (
              <AppButton
                title={trackingPresentation.actionTitle}
                variant={trackingPresentation.actionKind === 'retry' ? 'ghost' : undefined}
                onPress={trackingPresentation.actionKind === 'retry' ? retryRideTracking : enableRideTracking}
                disabled={Boolean(busy)}
              />
            ) : null}
          </AppCard>
        ) : null}

        <DriverActiveRideNavigationCard
          navigation={navigation}
          modeLabel={navigationMode.label}
          onOpenWaze={() => openNav(navigation?.point, 'waze', navigation?.kind)}
          onOpenGoogleMaps={() => openNav(navigation?.point, 'gmaps', navigation?.kind)}
          disabled={Boolean(busy) || !offer?.vehicleType}
        />

        {DEV_RIDE_SIMULATOR_ENABLED && TRACKED_STATUSES.has(status) ? (
          <AppCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>🧪 Simulação DEV — dois telefones</Text>
            <Text style={styles.sectionCopy}>
              Somente o deslocamento é simulado. Aceitar, chegar, iniciar, finalizar e confirmar o Pix continuam manuais e usam o fluxo real.
            </Text>
            <Text style={[styles.sectionCopy, simulationRunning ? styles.warningText : null]}>
              {simulationStatusLabel(devSimulation)}
            </Text>

            {Number.isFinite(devSimulation?.stepCount) && devSimulation.stepCount > 0 ? (
              <Text style={styles.caption}>
                Passo {devSimulation.stepIndex || 0}/{devSimulation.stepCount}
              </Text>
            ) : null}
            {devSimulation?.traceId ? (
              <Text selectable style={styles.caption}>Trace: {devSimulation.traceId}</Text>
            ) : null}
            {devSimulation?.errorCode ? (
              <Text selectable style={styles.errorCaption}>Código: {devSimulation.errorCode}</Text>
            ) : null}

            {(status === 'assigned' || status === 'driver_arrived') && pickup ? (
              <AppButton
                title={busy === 'simulation' ? 'Iniciando…' : 'Simular trajeto até o passageiro'}
                onPress={() => startSimulation(pickup, 'to_pickup')}
                disabled={Boolean(busy)}
              />
            ) : null}
            {status === 'in_progress' && destination ? (
              <AppButton
                title={busy === 'simulation' ? 'Iniciando…' : 'Simular trajeto até o destino'}
                onPress={() => startSimulation(destination, 'to_destination')}
                disabled={Boolean(busy)}
              />
            ) : null}
            {simulationRunning ? (
              <AppButton
                title="Pausar deslocamento"
                variant="ghost"
                onPress={pauseDevRideSimulation}
                disabled={Boolean(busy)}
              />
            ) : null}
            {simulationPaused ? (
              <AppButton
                title="Continuar deslocamento"
                variant="ghost"
                onPress={resumeDevRideSimulation}
                disabled={Boolean(busy)}
              />
            ) : null}
            {devSimulation?.status && devSimulation.status !== 'idle' ? (
              <AppButton
                title={busy === 'restore-gps' ? 'Restaurando…' : 'Encerrar simulação e restaurar GPS real'}
                variant="ghost"
                onPress={restoreRealGps}
                disabled={Boolean(busy)}
              />
            ) : null}
          </AppCard>
        ) : null}

        {paymentCompleted ? (
          <AppCard style={styles.sectionCard}>
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            <Text style={styles.successTitle}>Pagamento confirmado</Text>
            <Text style={styles.successAmount}>
              {paymentAmount != null ? formatBRL(paymentAmount) : 'Valor registrado'}
            </Text>
            <Text style={styles.successCopy}>
              Passageiro e motorista receberam a confirmação. Esta tela fechará em 5 segundos.
            </Text>
          </AppCard>
        ) : null}

        {paymentOpen || paymentFailed ? (
          <AppCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Pagamento</Text>
            <PixPaymentSummary
              amountCentavos={paymentAmount}
              payload={paymentPayload}
              instruction="Mostre este QR Code ao passageiro. Ele também pode usar o Pix copia e cola no próprio telefone."
            />

            {status === 'payment_marked_sent' ? (
              <Text style={[styles.sectionCopy, styles.warningText]}>
                O passageiro informou que pagou. Verifique sua conta antes de confirmar.
              </Text>
            ) : null}

            {paymentFailed ? (
              <>
                <Text style={styles.paymentFailureTitle}>Pagamento não confirmado</Text>
                <Text style={styles.sectionCopy}>
                  A tela permanece aberta e o valor continua registrado para conferência e suporte.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.sectionCopy}>
                  Confirme somente depois de verificar o Pix na sua conta.
                </Text>
                <AppButton
                  title="Problema no pagamento"
                  variant="ghost"
                  onPress={() => act('issue', (id) => reportPaymentIssue(id, 'motorista_reportou'))}
                  disabled={Boolean(busy)}
                />
              </>
            )}
          </AppCard>
        ) : null}

        {status === 'assigned' || status === 'driver_arrived' ? (
          <AppButton
            title="Cancelar corrida"
            variant="ghost"
            onPress={() => act('cancel', (id) => cancelRide(id, 'motorista_cancelou'))}
            disabled={Boolean(busy)}
          />
        ) : null}

        {error ? (
          <AppCard style={styles.sectionCard}>
            <Text style={styles.errorText}>{error}</Text>
            {PAYMENT_STATUSES.has(status) ? (
              <Text style={styles.caption}>
                Nenhum dado de pagamento foi apagado. Confira o valor e tente novamente.
              </Text>
            ) : null}
          </AppCard>
        ) : null}
      </ScrollView>

      <DriverActiveRidePrimaryFooter
        action={primaryAction}
        onPress={runPrimaryAction}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  invalidRide: {
    fontFamily,
    color: colors.danger,
    ...typography.small,
  },
  sectionCard: { gap: spacing.md },
  sectionTitle: {
    fontFamily,
    color: colors.text,
    ...typography.bodyBold,
  },
  sectionCopy: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
    lineHeight: 19,
  },
  caption: {
    fontFamily,
    color: colors.textFaint,
    ...typography.caption,
  },
  errorCaption: {
    fontFamily,
    color: colors.danger,
    ...typography.caption,
  },
  successText: { color: colors.success },
  warningText: { color: colors.warning },
  dangerText: { color: colors.danger },
  errorText: {
    fontFamily,
    color: colors.danger,
    ...typography.small,
  },
  paymentFailureTitle: {
    fontFamily,
    color: colors.danger,
    ...typography.bodyBold,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
  },
  successIconText: {
    fontFamily,
    color: colors.white,
    fontSize: 52,
    lineHeight: 58,
  },
  successTitle: {
    fontFamily,
    color: colors.success,
    textAlign: 'center',
    ...typography.h3,
  },
  successAmount: {
    fontFamily,
    color: colors.text,
    textAlign: 'center',
    ...typography.bodyBold,
  },
  successCopy: {
    fontFamily,
    color: colors.textMuted,
    textAlign: 'center',
    ...typography.small,
  },
});
