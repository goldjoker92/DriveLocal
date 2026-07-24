// Active driver ride screen (route "/active-ride"). Uses the driver's secured
// winning offer and attaches the background location service to this ride.
// Payment feedback stays on-screen: success closes after 5 seconds; failures remain.

import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import PixPaymentSummary from '../../components/PixPaymentSummary';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../../config/runtimeEnvironment';
import { formatBRL } from '../../utils/format';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { openGoogleMapsRoute, openGoogleMapsToPoint, openWazeToPoint } from '../../utils/maps';
import {
  attachActiveRideTracking,
  detachActiveRideTracking,
  restoreRealDriverTrackingAfterSimulation,
} from '../../services/driverLocationTracking';
import {
  getDevRideSimulationState,
  getDevSimulatedCurrentPoint,
  pauseDevRideSimulation,
  resumeDevRideSimulation,
  startDevRideSimulation,
  stopDevRideSimulation,
  subscribeDevRideSimulation,
} from '../../services/devRideSimulation';
import {
  listenToMyOffer,
  markDriverArrived,
  startRide,
  finishRide,
  confirmDriverPixReceived,
  cancelRide,
  reportPaymentIssue,
} from '../../services/ridesService';

const TRACKED_STATUSES = new Set(['assigned', 'driver_arrived', 'in_progress']);
const PAYMENT_STATUSES = new Set(['awaiting_payment', 'payment_marked_sent', 'completed', 'disputed']);
const ROBOT_NAVIGATION_STATUSES = new Set(['running', 'paused', 'completed']);
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

function trackingErrorLabel(status) {
  const labels = {
    services_disabled: 'Ative o GPS do telefone para compartilhar sua posição.',
    foreground_required: 'Autorize a localização precisa para continuar.',
    background_required: 'Autorize “Permitir o tempo todo” para manter a posição durante a corrida.',
    foreground_denied: 'A localização precisa foi recusada.',
    background_denied: 'A localização em segundo plano foi recusada.',
  };
  return labels[status] || 'Não foi possível iniciar a localização ao vivo.';
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

export default function ActiveRide() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const eventType = typeof params.eventType === 'string' ? params.eventType : null;

  const [offer, setOffer] = useState(null);
  const [status, setStatus] = useState(() => statusFromEvent(eventType));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [trackingStatus, setTrackingStatus] = useState('checking');
  const [devSimulation, setDevSimulation] = useState({ status: 'idle' });

  const paymentAmount = offer?.paymentAmountCentavos;
  const paymentPayload = offer?.paymentPixPayload;

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !rideId) return undefined;
    return listenToMyOffer(
      uid,
      (nextOffer) => {
        if (!nextOffer) return;
        setOffer(nextOffer);
        if (nextOffer.driverRideStatus) setStatus(nextOffer.driverRideStatus);
        else if (nextOffer.exactDestination) setStatus((current) => current === 'assigned' ? 'in_progress' : current);
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
      hasPayload: !!paymentPayload,
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
      if (!next?.rideId || next.rideId === rideId) setDevSimulation(next || { status: 'idle' });
    });
    const unsubscribe = subscribeDevRideSimulation((next) => {
      if (!next?.rideId || next.rideId === rideId) setDevSimulation(next || { status: 'idle' });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [rideId]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !rideId || !offer?.vehicleType) return undefined;
    let active = true;

    if (TRACKED_STATUSES.has(status)) {
      attachActiveRideTracking({
        driverId: uid,
        vehicleType: offer.vehicleType,
        rideId,
        requestPermissions: false,
      }).then((result) => {
        if (!active) return;
        setTrackingStatus(result.status === 'active' ? 'active' : result.status);
      }).catch(() => {
        if (active) setTrackingStatus('error');
      });
    } else {
      const stopTracking = async () => {
        if (DEV_RIDE_SIMULATOR_ENABLED) {
          await stopDevRideSimulation({ restoreRealTracking: false });
        }
        await detachActiveRideTracking(rideId);
        if (DEV_RIDE_SIMULATOR_ENABLED) {
          await restoreRealDriverTrackingAfterSimulation();
        }
      };
      stopTracking().finally(() => {
        if (active) setTrackingStatus('stopped');
      });
    }

    return () => {
      active = false;
    };
  }, [rideId, offer?.vehicleType, status]);

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
        rideId,
        requestPermissions: true,
      });
      setTrackingStatus(result.status === 'active' ? 'active' : result.status);
    } catch (_error) {
      setTrackingStatus('error');
    }
  }

  async function cleanupTrackingAfterRide() {
    if (!rideId) return;
    if (DEV_RIDE_SIMULATOR_ENABLED) {
      await stopDevRideSimulation({ restoreRealTracking: false });
    }
    await detachActiveRideTracking(rideId);
    if (DEV_RIDE_SIMULATOR_ENABLED) {
      await restoreRealDriverTrackingAfterSimulation();
    }
  }

  async function act(key, fn) {
    if (!rideId || busy) return;
    setBusy(key);
    setError('');
    try {
      const res = await fn(rideId);
      if (res?.status) setStatus(res.status);
      if (res && ['awaiting_payment', 'completed', 'cancelled', 'disputed'].includes(res.status)) {
        await cleanupTrackingAfterRide();
      }
      // Success and payment failure remain visible. Only cancellation leaves now.
      if (res?.status === 'cancelled') {
        router.replace('/driver-home');
      }
    } catch (e) {
      const message = e?.message || 'Não foi possível concluir. Tente novamente.';
      setError(message);
      logRideClientEvent('pix.driver.ui_action_failed', {
        rideId,
        action: key,
        status,
        amountCentavos: paymentAmount,
        error: e,
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
        setError(trackingErrorLabel(result.status));
      }
    } catch (_error) {
      setError('Não foi possível restaurar o GPS real.');
    } finally {
      setBusy('');
    }
  }

  async function openNav(point, which, targetKind) {
    if (!point) return;
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
        await openWazeToPoint(point, offer?.vehicleType);
      } else if (simulatedOrigin) {
        await openGoogleMapsRoute({
          origin: simulatedOrigin,
          destination: point,
          vehicleType: offer?.vehicleType,
        });
      } else {
        await openGoogleMapsToPoint(point, offer?.vehicleType);
      }
    } catch (_e) {
      setError(which === 'waze'
        ? 'Não foi possível abrir o Waze. Tente o Google Maps.'
        : 'Não foi possível abrir o Google Maps. Tente o Waze.');
    }
  }

  const pickup = offer?.exactPickup;
  const destination = offer?.exactDestination;
  const trackingActive = trackingStatus === 'active';
  const simulationRunning = devSimulation?.status === 'running';
  const simulationPaused = devSimulation?.status === 'paused';
  const paymentOpen = status === 'awaiting_payment' || status === 'payment_marked_sent';
  const paymentFailed = status === 'disputed';
  const paymentCompleted = status === 'completed';
  const headerTitle = PAYMENT_STATUSES.has(status) ? 'Pagamento Pix' : 'Corrida ativa';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title={headerTitle} onBack={() => router.back()} />

        {!rideId ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>Corrida inválida.</Text> : null}

        {TRACKED_STATUSES.has(status) ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Localização ao vivo</Text>
            <Text style={[{ fontFamily, color: trackingActive ? colors.success : colors.warning }, typography.small]}>
              {trackingActive
                ? 'Ativa — o passageiro pode acompanhar seu deslocamento.'
                : trackingStatus === 'checking'
                  ? 'Verificando o GPS…'
                  : trackingErrorLabel(trackingStatus)}
            </Text>
            {!trackingActive && trackingStatus !== 'checking' ? (
              <AppButton title="Ativar localização da corrida" onPress={enableRideTracking} />
            ) : null}
          </AppCard>
        ) : null}

        {DEV_RIDE_SIMULATOR_ENABLED && TRACKED_STATUSES.has(status) ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>🧪 Simulação DEV — dois telefones</Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Somente o deslocamento é simulado. Aceitar, chegar, iniciar, finalizar e confirmar o Pix continuam manuais e usam o fluxo real.
            </Text>
            <Text style={[{ fontFamily, color: simulationRunning ? colors.warning : colors.textMuted }, typography.small]}>
              {simulationStatusLabel(devSimulation)}
            </Text>
            {Number.isFinite(devSimulation?.stepCount) && devSimulation.stepCount > 0 ? (
              <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
                Passo {devSimulation.stepIndex || 0}/{devSimulation.stepCount}
              </Text>
            ) : null}
            {devSimulation?.traceId ? (
              <Text selectable style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
                Trace: {devSimulation.traceId}
              </Text>
            ) : null}
            {devSimulation?.errorCode ? (
              <Text selectable style={[{ fontFamily, color: colors.danger }, typography.caption]}>
                Código: {devSimulation.errorCode}
              </Text>
            ) : null}

            {(status === 'assigned' || status === 'driver_arrived') && pickup ? (
              <AppButton
                title={busy === 'simulation' ? 'Iniciando…' : 'Simular trajeto até o passageiro'}
                onPress={() => startSimulation(pickup, 'to_pickup')}
                disabled={!!busy}
              />
            ) : null}
            {status === 'in_progress' && destination ? (
              <AppButton
                title={busy === 'simulation' ? 'Iniciando…' : 'Simular trajeto até o destino'}
                onPress={() => startSimulation(destination, 'to_destination')}
                disabled={!!busy}
              />
            ) : null}
            {simulationRunning ? (
              <AppButton title="Pausar deslocamento" variant="ghost" onPress={pauseDevRideSimulation} disabled={!!busy} />
            ) : null}
            {simulationPaused ? (
              <AppButton title="Continuar deslocamento" variant="ghost" onPress={resumeDevRideSimulation} disabled={!!busy} />
            ) : null}
            {devSimulation?.status && devSimulation.status !== 'idle' ? (
              <AppButton
                title={busy === 'restore-gps' ? 'Restaurando…' : 'Encerrar simulação e restaurar GPS real'}
                variant="ghost"
                onPress={restoreRealGps}
                disabled={!!busy}
              />
            ) : null}
          </AppCard>
        ) : null}

        {(status === 'assigned' || status === 'driver_arrived') && pickup ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Ir buscar o passageiro</Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{pickup.label || 'Local de embarque'}</Text>
            <View style={{ gap: spacing.sm }}>
              <AppButton title="Abrir no Waze" onPress={() => openNav(pickup, 'waze', 'pickup')} />
              <AppButton title="Abrir no Google Maps" onPress={() => openNav(pickup, 'gmaps', 'pickup')} />
            </View>
          </AppCard>
        ) : null}

        {status === 'assigned' ? (
          <AppButton title={busy === 'arrive' ? 'Enviando…' : 'Cheguei ao local'} onPress={() => act('arrive', markDriverArrived)} disabled={!!busy || !pickup} />
        ) : null}
        {status === 'driver_arrived' ? (
          <AppButton title={busy === 'start' ? 'Enviando…' : 'Passageiro embarcou'} onPress={() => act('start', startRide)} disabled={!!busy} />
        ) : null}

        {status === 'in_progress' ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Levar ao destino</Text>
            {destination ? (
              <>
                <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{destination.label || 'Destino da corrida'}</Text>
                <View style={{ gap: spacing.sm }}>
                  <AppButton title="Abrir no Waze" onPress={() => openNav(destination, 'waze', 'destination')} />
                  <AppButton title="Abrir no Google Maps" onPress={() => openNav(destination, 'gmaps', 'destination')} />
                </View>
              </>
            ) : (
              <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>Carregando destino…</Text>
            )}
            <AppButton title={busy === 'finish' ? 'Enviando…' : 'Finalizar corrida'} onPress={() => act('finish', finishRide)} disabled={!!busy || !destination} />
          </AppCard>
        ) : null}

        {paymentCompleted ? (
          <AppCard>
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                alignSelf: 'center',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.success,
              }}
            >
              <Text style={{ fontFamily, color: '#FFFFFF', fontSize: 52, lineHeight: 58 }}>✓</Text>
            </View>
            <Text style={[{ fontFamily, color: colors.success, textAlign: 'center' }, typography.h3]}>
              Pagamento confirmado
            </Text>
            <Text style={[{ fontFamily, color: colors.text, textAlign: 'center' }, typography.bodyBold]}>
              {paymentAmount != null ? formatBRL(paymentAmount) : 'Valor registrado'}
            </Text>
            <Text style={[{ fontFamily, color: colors.textMuted, textAlign: 'center' }, typography.small]}>
              Passageiro e motorista receberam a confirmação. Esta tela fechará em 5 segundos.
            </Text>
          </AppCard>
        ) : null}

        {paymentOpen || paymentFailed ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Pagamento</Text>
            <PixPaymentSummary
              amountCentavos={paymentAmount}
              payload={paymentPayload}
              instruction="Mostre este QR Code ao passageiro. Ele também pode usar o Pix copia e cola no próprio telefone."
            />

            {status === 'payment_marked_sent' ? (
              <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
                O passageiro informou que pagou. Verifique sua conta antes de confirmar.
              </Text>
            ) : null}

            {paymentFailed ? (
              <>
                <Text style={[{ fontFamily, color: colors.danger }, typography.bodyBold]}>
                  Pagamento não confirmado
                </Text>
                <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                  A tela permanece aberta e o valor continua registrado para conferência e suporte.
                </Text>
              </>
            ) : (
              <>
                <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                  Confirme somente depois de verificar o Pix na sua conta.
                </Text>
                <AppButton
                  title={busy === 'confirm' ? 'Enviando…' : 'Pagamento recebido'}
                  onPress={() => act('confirm', confirmDriverPixReceived)}
                  disabled={!!busy || !paymentPayload}
                />
                <AppButton
                  title="Problema no pagamento"
                  variant="ghost"
                  onPress={() => act('issue', (id) => reportPaymentIssue(id, 'motorista_reportou'))}
                  disabled={!!busy}
                />
              </>
            )}
          </AppCard>
        ) : null}

        {status === 'assigned' || status === 'driver_arrived' ? (
          <AppButton title="Cancelar corrida" variant="ghost" onPress={() => act('cancel', (id) => cancelRide(id, 'motorista_cancelou'))} disabled={!!busy} />
        ) : null}

        {error ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
            {PAYMENT_STATUSES.has(status) ? (
              <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
                Nenhum dado de pagamento foi apagado. Confira o valor e tente novamente.
              </Text>
            ) : null}
          </AppCard>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}