// Driver home / operational cockpit.
// The server remains authoritative for approval, commercial policy and work
// sessions. The UI turns green only after the first session-bound GPS point is
// published successfully.

import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import DriverCockpitProfileCard from '../../components/DriverCockpitProfileCard';
import DriverCockpitDashboardCard from '../../components/DriverCockpitDashboardCard';
import DriverBatteryTipCard from '../../components/DriverBatteryTipCard';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import {
  driverPhotoStatus,
  hasApprovedDriverPhoto,
  rejectionReasonLabel,
} from '../../constants/driverPhoto';
import { auth, db } from '../../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../../config/runtimeEnvironment';
import { getDriver } from '../../services/driverService';
import {
  startDriverWorkSession,
  stopDriverWorkSession,
} from '../../services/driverAvailabilityService';
import {
  getDriverTrackingPermissionState,
  getDriverTrackingSession,
  restoreDriverOnlineTracking,
  startDriverOnlineTracking,
  stopDriverOnlineTracking,
} from '../../services/driverLocationTracking';
import { getRobotDriverState, stopRobotDriver } from '../../services/robotDriverEngine';
import {
  AVAILABILITY,
  benefitWarning,
  commissionDisplay,
  commissionFreeUntilMs,
  deriveEligibility,
  rideBlockReasonLabel,
  subscriptionDisplay,
  subscriptionFreeUntilMs,
} from '../../utils/driverCockpit';
import { deriveDriverCockpitSummary } from '../../utils/driverCockpitSummary';
import { logDriverPhotoEvent } from '../../utils/driverPhotoLog';

const WORK_SESSION_MAX_AGE_MS = 7 * 60 * 1000;
const REMOTE_RECONCILIATION_GRACE_MS = 12_000;

function shortId(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  return text.length <= 12 ? text : `${text.slice(0, 6)}…${text.slice(-4)}`;
}

function Line({ children, tone = 'muted' }) {
  const color = tone === 'text'
    ? colors.text
    : tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : colors.textMuted;
  return <Text style={[styles.line, { color }]}>{children}</Text>;
}

function WorkStatusTitle({ online }) {
  return (
    <Text style={[styles.workTitle, { color: online ? colors.success : colors.danger }]}>
      {online ? '🟢 Você está disponível' : '🔴 Você está indisponível'}
    </Text>
  );
}

function confirmTrackingDisclosure() {
  return new Promise((resolve) => {
    Alert.alert(
      'Localização durante o trabalho',
      'Enquanto você estiver disponível, o DriveLocal usará sua localização para encontrar corridas próximas. Durante uma corrida, sua posição será mostrada somente ao passageiro dessa corrida, inclusive quando o app estiver em segundo plano. O rastreamento para quando você ficar indisponível.',
      [
        { text: 'Agora não', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continuar', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

function trackingErrorLabel(status) {
  const labels = {
    services_disabled: 'Ative o GPS do telefone para ficar disponível.',
    foreground_required: 'Autorize a localização precisa para ficar disponível.',
    background_required: 'Autorize “Permitir o tempo todo” para receber corridas com o app em segundo plano.',
    foreground_denied: 'A localização precisa foi recusada. Ative-a nas configurações do Android.',
    background_denied: 'A localização em segundo plano foi recusada. Ative “Permitir o tempo todo” nas configurações do Android.',
    unsupported: 'O rastreamento do motorista está disponível somente no aplicativo Android.',
    invalid_session: 'Não foi possível iniciar sua sessão de trabalho. Tente novamente.',
    'permission-denied': 'A sessão mudou durante a ativação. Aguarde um instante e tente novamente.',
    DRIVER_INITIAL_LOCATION_NOT_PUBLISHED: 'Não foi possível confirmar sua primeira posição. Verifique a internet e tente novamente.',
  };
  return labels[status] || 'Não foi possível iniciar a localização do motorista.';
}

function robotSimulationActive() {
  return DEV_RIDE_SIMULATOR_ENABLED && getRobotDriverState().enabled;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  return 0;
}

function hasFreshRemoteWorkSession(driver, nowMs = Date.now()) {
  if (!driver?.availabilitySessionId) return false;
  const updatedAtMs = timestampMs(driver.availabilityUpdatedAt)
    || Number(driver.availabilityUpdatedAtMs || 0);
  return updatedAtMs > 0 && nowMs - updatedAtMs <= WORK_SESSION_MAX_AGE_MS;
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

export default function DriverHome() {
  const router = useRouter();
  const activationInProgress = useRef(false);
  const lastCockpitTrace = useRef(null);
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState(AVAILABILITY.OFFLINE);
  const [availabilityError, setAvailabilityError] = useState('');
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [trackingActive, setTrackingActive] = useState(false);

  useEffect(() => {
    let active = true;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLoading(false);
      return undefined;
    }

    getDriver(uid)
      .then(async (data) => {
        if (!active) return;
        setDriver(data);

        // An accepted ride always wins over cockpit restoration. The dedicated
        // screen owns high-frequency tracking and payment actions.
        if (data?.activeRideId) {
          router.replace({ pathname: '/active-ride', params: { rideId: data.activeRideId } });
          return;
        }

        const localBeforeRestore = await getDriverTrackingSession();
        const remoteSessionId = data?.availabilitySessionId || null;
        const online = data?.availabilityStatus === AVAILABILITY.ONLINE;

        if (!online) {
          if (localSessionInTransition(localBeforeRestore)) {
            console.log('[DRIVER_AVAILABILITY] cockpit.initial_reconciliation_deferred', {
              scope: 'driver_availability',
              event: 'cockpit.initial_reconciliation_deferred',
              driverId: shortId(uid),
              localSessionId: shortId(localBeforeRestore?.availabilitySessionId),
              reason: 'local_transition_grace',
              result: 'waiting_for_server',
              atMs: Date.now(),
            });
            return;
          }
          await stopDriverOnlineTracking().catch(() => undefined);
          if (active) {
            setAvailability(AVAILABILITY.OFFLINE);
            setTrackingActive(false);
          }
          return;
        }

        if (!remoteSessionId || !hasFreshRemoteWorkSession(data)) {
          const matchingTransition = Boolean(
            localBeforeRestore?.availabilitySessionId
            && localBeforeRestore.availabilitySessionId === remoteSessionId
            && localSessionInTransition(localBeforeRestore)
          );
          if (matchingTransition) {
            console.log('[DRIVER_AVAILABILITY] cockpit.initial_reconciliation_deferred', {
              scope: 'driver_availability',
              event: 'cockpit.initial_reconciliation_deferred',
              driverId: shortId(uid),
              localSessionId: shortId(localBeforeRestore.availabilitySessionId),
              remoteSessionId: shortId(remoteSessionId),
              reason: 'remote_timestamp_not_settled',
              result: 'waiting_for_server',
              atMs: Date.now(),
            });
            return;
          }
          await stopDriverOnlineTracking().catch(() => undefined);
          await stopDriverWorkSession(remoteSessionId).catch(() => undefined);
          if (active) {
            setAvailability(AVAILABILITY.OFFLINE);
            setTrackingActive(false);
            setDriver((current) => current ? {
              ...current,
              availabilityStatus: AVAILABILITY.OFFLINE,
              availabilitySessionId: null,
            } : current);
          }
          return;
        }

        if (robotSimulationActive()) {
          console.log('[ROBOT_DRIVER] online_restore.native_tracking_skipped', {
            reason: 'robot_simulation_active',
            driverId: shortId(uid),
            atMs: Date.now(),
          });
          if (active) {
            setAvailability(AVAILABILITY.ONLINE);
            setTrackingActive(true);
          }
          return;
        }

        let restored = await restoreDriverOnlineTracking({
          driverId: uid,
          vehicleType: data?.vehicleType,
          availabilitySessionId: remoteSessionId,
        });

        if (restored.status === 'no_session') {
          console.log('[DRIVER_AVAILABILITY] cockpit.online_restore_recovering', {
            scope: 'driver_availability',
            event: 'cockpit.online_restore_recovering',
            driverId: shortId(uid),
            remoteSessionId: shortId(remoteSessionId),
            reason: 'local_session_missing',
            atMs: Date.now(),
          });
          restored = await startDriverOnlineTracking({
            driverId: uid,
            vehicleType: data?.vehicleType,
            availabilitySessionId: remoteSessionId,
            requestPermissions: false,
          });
        }

        if (!active) return;
        if (restored.status === 'active') {
          setAvailability(AVAILABILITY.ONLINE);
          setTrackingActive(true);
        } else {
          await stopDriverOnlineTracking().catch(() => undefined);
          await stopDriverWorkSession(remoteSessionId).catch(() => undefined);
          setAvailability(AVAILABILITY.OFFLINE);
          setTrackingActive(false);
          setDriver((current) => current ? {
            ...current,
            availabilityStatus: AVAILABILITY.OFFLINE,
            availabilitySessionId: null,
          } : current);
        }
      })
      .catch((loadError) => {
        console.warn('[DRIVER_AVAILABILITY] cockpit.initialization_failed', {
          scope: 'driver_availability',
          event: 'cockpit.initialization_failed',
          driverId: shortId(uid),
          reason: loadError?.code || loadError?.message || 'unknown',
          atMs: Date.now(),
        });
        if (active) setError('Não foi possível carregar seu cadastro.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    // Cached snapshots may render but can never revoke GPS. Only a server-confirmed
    // document may close a work session.
    return onSnapshot(
      doc(db, 'drivers', uid),
      { includeMetadataChanges: true },
      async (snapshot) => {
        if (!snapshot.exists()) return;
        const remote = snapshot.data();
        if (!snapshotNeedsServerConfirmation(snapshot.metadata || {})) setDriver(remote);

        if (remote?.activeRideId) return;
        if (availability !== AVAILABILITY.ONLINE) return;
        if (activationInProgress.current) {
          console.log('[DRIVER_AVAILABILITY] cockpit.reconciliation_deferred', {
            scope: 'driver_availability',
            event: 'cockpit.reconciliation_deferred',
            driverId: shortId(uid),
            reason: 'activation_in_progress',
            result: 'waiting_for_transition',
            atMs: Date.now(),
          });
          return;
        }
        if (snapshotNeedsServerConfirmation(snapshot.metadata || {})) {
          console.log('[DRIVER_AVAILABILITY] cockpit.reconciliation_deferred', {
            scope: 'driver_availability',
            event: 'cockpit.reconciliation_deferred',
            driverId: shortId(uid),
            reason: snapshot.metadata?.hasPendingWrites ? 'pending_writes' : 'snapshot_from_cache',
            result: 'waiting_for_server',
            atMs: Date.now(),
          });
          return;
        }

        const localSession = await getDriverTrackingSession();
        if (localSessionInTransition(localSession)) {
          console.log('[DRIVER_AVAILABILITY] cockpit.reconciliation_deferred', {
            scope: 'driver_availability',
            event: 'cockpit.reconciliation_deferred',
            driverId: shortId(uid),
            localSessionId: shortId(localSession?.availabilitySessionId),
            remoteSessionId: shortId(remote?.availabilitySessionId),
            reason: 'local_transition_grace',
            result: 'waiting_for_stable_state',
            atMs: Date.now(),
          });
          return;
        }

        const expectedSessionId = localSession?.availabilitySessionId
          || driver?.availabilitySessionId
          || null;
        const remoteSessionMatches = Boolean(
          remote?.availabilityStatus === AVAILABILITY.ONLINE
          && remote?.availabilitySessionId
          && remote.availabilitySessionId === expectedSessionId
          && hasFreshRemoteWorkSession(remote)
        );
        if (remoteSessionMatches) return;

        console.warn('[DRIVER_AVAILABILITY] cockpit.remote_session_revoked', {
          scope: 'driver_availability',
          event: 'cockpit.remote_session_revoked',
          driverId: shortId(uid),
          expectedSessionId: shortId(expectedSessionId),
          remoteSessionId: shortId(remote?.availabilitySessionId),
          remoteStatus: remote?.availabilityStatus || 'missing',
          reason: remote?.availabilityStatus !== AVAILABILITY.ONLINE
            ? 'remote_offline'
            : remote?.availabilitySessionId !== expectedSessionId
              ? 'session_mismatch'
              : 'lease_expired',
          atMs: Date.now(),
        });
        await stopDriverOnlineTracking().catch(() => undefined);
        setAvailability(AVAILABILITY.OFFLINE);
        setTrackingActive(false);
        setAvailabilityError('Sua sessão de trabalho foi encerrada. Toque em “Começar a trabalhar” quando quiser ficar disponível novamente.');
      },
      (snapshotError) => {
        console.warn('[DRIVER_AVAILABILITY] cockpit.driver_listener_failed', {
          scope: 'driver_availability',
          event: 'cockpit.driver_listener_failed',
          driverId: shortId(uid),
          reason: snapshotError?.code || snapshotError?.message || 'unknown',
          atMs: Date.now(),
        });
      }
    );
  }, [availability, driver?.availabilitySessionId]);

  const nowMs = Date.now();
  const uid = auth.currentUser?.uid;
  const eligibility = deriveEligibility(driver);
  const subscription = subscriptionDisplay(driver, nowMs);
  const commission = commissionDisplay(driver, nowMs);
  const summary = deriveDriverCockpitSummary(driver, nowMs);
  const isAvailable = availability === AVAILABILITY.ONLINE;
  const photoStatus = driverPhotoStatus(driver);
  const activePublicPhoto = hasApprovedDriverPhoto(driver);
  const commissionWarn = benefitWarning('Sua taxa da plataforma zerada', commissionFreeUntilMs(driver), nowMs);
  const subscriptionWarn = benefitWarning('Sua assinatura gratuita', subscriptionFreeUntilMs(driver), nowMs);

  useEffect(() => {
    if (!driver) return;
    const entry = {
      scope: 'driver_cockpit',
      event: 'summary.rendered',
      availability: isAvailable ? 'online' : 'offline',
      trackingActive,
      eligible: eligibility.eligible,
      reasonCode: eligibility.reasonCode,
      vehicleType: driver.vehicleType || null,
      founder: driver.founderEligible === true,
      photoStatus,
      commissionBps: commission.bps,
      subscriptionMode: subscription.mode,
      walletStatus: driver.walletStatus || null,
      statsVersion: summary.statsVersion,
      dayKey: summary.dayKey,
      weekKey: summary.weekKey,
      todayRideCount: summary.todayRideCount,
      weekRideCount: summary.weekRideCount,
      atMs: Date.now(),
    };
    const signature = JSON.stringify(entry);
    if (signature === lastCockpitTrace.current) return;
    lastCockpitTrace.current = signature;
    console.info('[DRIVER_COCKPIT] summary.rendered', entry);
  }, [
    driver,
    isAvailable,
    trackingActive,
    eligibility.eligible,
    eligibility.reasonCode,
    photoStatus,
    commission.bps,
    subscription.mode,
    summary.statsVersion,
    summary.dayKey,
    summary.weekKey,
    summary.todayRideCount,
    summary.weekRideCount,
  ]);

  function openDriverPhoto() {
    logDriverPhotoEvent('cockpit.open_photo', {
      driverId: uid,
      status: photoStatus,
      hasApprovedPhoto: activePublicPhoto,
      action: activePublicPhoto ? 'manage_or_replace' : 'initial',
    });
    router.push({ pathname: '/(driver)/driver-photo', params: { returnTo: 'home' } });
  }

  async function goAvailable() {
    setAvailabilityError('');
    if (driver?.activeRideId) {
      router.push({ pathname: '/active-ride', params: { rideId: driver.activeRideId } });
      return;
    }
    if (!eligibility.eligible) {
      setAvailabilityError(rideBlockReasonLabel(eligibility.reasonCode));
      return;
    }
    if (!uid || savingAvailability) return;

    activationInProgress.current = true;
    setSavingAvailability(true);
    let workSession = null;
    try {
      const robotActive = robotSimulationActive();
      if (!robotActive) {
        const permission = await getDriverTrackingPermissionState();
        if (permission.status !== 'granted') {
          const consented = await confirmTrackingDisclosure();
          if (!consented) {
            setAvailabilityError('A localização em segundo plano é necessária para receber corridas.');
            return;
          }
        }

        workSession = await startDriverWorkSession();
        console.log('[DRIVER_AVAILABILITY] cockpit.work_session_opened', {
          scope: 'driver_availability',
          event: 'cockpit.work_session_opened',
          driverId: shortId(uid),
          availabilitySessionId: shortId(workSession.availabilitySessionId),
          atMs: Date.now(),
        });
        const tracking = await startDriverOnlineTracking({
          driverId: uid,
          vehicleType: driver?.vehicleType,
          availabilitySessionId: workSession.availabilitySessionId,
          requestPermissions: permission.status !== 'granted',
        });
        if (tracking.status !== 'active') {
          await stopDriverWorkSession(workSession.availabilitySessionId).catch(() => undefined);
          workSession = null;
          setAvailabilityError(trackingErrorLabel(tracking.status));
          return;
        }
      } else {
        workSession = await startDriverWorkSession();
        console.log('[ROBOT_DRIVER] go_online.native_tracking_skipped', {
          reason: 'robot_simulation_active',
          driverId: shortId(uid),
          availabilitySessionId: shortId(workSession.availabilitySessionId),
          atMs: Date.now(),
        });
      }

      setAvailability(AVAILABILITY.ONLINE);
      setTrackingActive(true);
      setDriver((current) => current ? {
        ...current,
        availabilityStatus: AVAILABILITY.ONLINE,
        availabilitySessionId: workSession.availabilitySessionId,
        availabilityUpdatedAtMs: workSession.availabilityUpdatedAtMs,
      } : current);
      console.log('[DRIVER_AVAILABILITY] cockpit.available', {
        scope: 'driver_availability',
        event: 'cockpit.available',
        driverId: shortId(uid),
        availabilitySessionId: shortId(workSession.availabilitySessionId),
        result: 'online_and_first_location_published',
        atMs: Date.now(),
      });
    } catch (errorValue) {
      if (!robotSimulationActive()) await stopDriverOnlineTracking().catch(() => undefined);
      if (workSession?.availabilitySessionId) {
        await stopDriverWorkSession(workSession.availabilitySessionId).catch(() => undefined);
      }
      setTrackingActive(false);
      setAvailability(AVAILABILITY.OFFLINE);
      console.warn('[DRIVER_AVAILABILITY] cockpit.activation_failed', {
        scope: 'driver_availability',
        event: 'cockpit.activation_failed',
        driverId: shortId(uid),
        availabilitySessionId: shortId(workSession?.availabilitySessionId),
        reason: errorValue?.code || errorValue?.message || 'unknown',
        result: 'offline',
        atMs: Date.now(),
      });
      setAvailabilityError(
        errorValue?.details?.message
        || trackingErrorLabel(errorValue?.code)
        || errorValue?.message
        || 'Não foi possível ativar sua disponibilidade e localização.'
      );
    } finally {
      activationInProgress.current = false;
      setSavingAvailability(false);
    }
  }

  async function goOffline() {
    setAvailabilityError('');
    if (driver?.activeRideId) {
      setAvailabilityError('Finalize ou cancele a corrida ativa antes de ficar indisponível.');
      return;
    }
    if (!uid || savingAvailability) return;
    activationInProgress.current = true;
    setSavingAvailability(true);
    const sessionId = driver?.availabilitySessionId || null;
    try {
      // Stop locally first so queued GPS events lose their session immediately.
      if (robotSimulationActive()) await stopRobotDriver({ restoreRealTracking: false });
      else await stopDriverOnlineTracking();
      await stopDriverWorkSession(sessionId);
      setAvailability(AVAILABILITY.OFFLINE);
      setTrackingActive(false);
      setDriver((current) => current ? {
        ...current,
        availabilityStatus: AVAILABILITY.OFFLINE,
        availabilitySessionId: null,
      } : current);
      console.log('[DRIVER_AVAILABILITY] cockpit.unavailable', {
        scope: 'driver_availability',
        event: 'cockpit.unavailable',
        driverId: shortId(uid),
        availabilitySessionId: shortId(sessionId),
        reason: 'driver_requested_stop',
        result: 'offline',
        atMs: Date.now(),
      });
    } catch (errorValue) {
      setAvailability(AVAILABILITY.OFFLINE);
      setTrackingActive(false);
      console.warn('[DRIVER_AVAILABILITY] cockpit.deactivation_sync_failed', {
        scope: 'driver_availability',
        event: 'cockpit.deactivation_sync_failed',
        driverId: shortId(uid),
        availabilitySessionId: shortId(sessionId),
        reason: errorValue?.code || errorValue?.message || 'unknown',
        result: 'local_tracking_stopped_remote_pending',
        atMs: Date.now(),
      });
      setAvailabilityError(
        errorValue?.details?.message
        || 'A localização foi interrompida. A indisponibilidade será sincronizada assim que a conexão voltar.'
      );
    } finally {
      activationInProgress.current = false;
      setSavingAvailability(false);
    }
  }

  const photoIssue = !activePublicPhoto || photoStatus === 'pending' || photoStatus === 'rejected';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Header title="Motorista" subtitle="Seu cockpit" onBack={() => router.back()} />

        {loading ? (
          <AppCard><AdminTableRow label="Carregando…" /></AppCard>
        ) : error ? (
          <AppCard><Line tone="warning">{error}</Line></AppCard>
        ) : !driver ? (
          <AppCard><AdminTableRow label="Cadastro não encontrado" /></AppCard>
        ) : (
          <>
            <DriverCockpitProfileCard
              driver={driver}
              online={isAvailable}
              onPhotoPress={openDriverPhoto}
            />

            {/* Renders itself only after Android actually killed our background
                service at least once; silent otherwise. */}
            <DriverBatteryTipCard />

            {photoIssue ? (
              <AppCard style={styles.compactWarningCard}>
                <Text style={styles.warningTitle}>
                  {photoStatus === 'rejected'
                    ? 'Sua nova foto precisa ser corrigida.'
                    : photoStatus === 'pending'
                      ? 'Sua nova foto está em análise.'
                      : 'Adicione uma foto para o passageiro reconhecer você.'}
                </Text>
                {photoStatus === 'rejected' ? (
                  <Line tone="warning">
                    {driver.driverPhotoRejectionReason
                      || rejectionReasonLabel(driver.driverPhotoRejectionCode)}
                  </Line>
                ) : null}
              </AppCard>
            ) : null}

            <AppCard style={styles.availabilityCard}>
              <WorkStatusTitle online={isAvailable} />
              <Line tone="text">
                {isAvailable ? 'Buscando corridas próximas.' : 'Comece quando estiver pronto para receber ofertas.'}
              </Line>
              <Line tone={isAvailable && trackingActive ? 'success' : 'muted'}>
                {isAvailable
                  ? trackingActive
                    ? 'GPS de trabalho ativo.'
                    : 'Verificando GPS de trabalho…'
                  : 'Sua localização fica desligada enquanto você não trabalha.'}
              </Line>

              <AppButton
                title={isAvailable
                  ? savingAvailability ? 'Parando…' : 'Parar de trabalhar'
                  : savingAvailability ? 'Ativando…' : 'Começar a trabalhar'}
                variant={isAvailable ? 'secondary' : 'primary'}
                onPress={isAvailable ? goOffline : goAvailable}
                disabled={savingAvailability || (!isAvailable && !eligibility.eligible)}
              />

              {!eligibility.eligible ? (
                <View style={styles.eligibilityWarning}>
                  <Text style={styles.warningTitle}>Você ainda não pode ficar disponível.</Text>
                  <Text style={styles.warningText}>{rideBlockReasonLabel(eligibility.reasonCode)}</Text>
                </View>
              ) : null}
              {availabilityError ? <Line tone="warning">{availabilityError}</Line> : null}
            </AppCard>

            <DriverCockpitDashboardCard
              summary={summary}
              commission={commission}
              subscription={subscription}
              onWalletPress={() => router.push('/wallet')}
            />

            {commissionWarn || subscriptionWarn ? (
              <AppCard style={styles.compactWarningCard}>
                {commissionWarn ? <Line tone="warning">{commissionWarn}</Line> : null}
                {subscriptionWarn ? <Line tone="warning">{subscriptionWarn}</Line> : null}
              </AppCard>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  line: { fontFamily, ...typography.small },
  workTitle: { fontFamily, ...typography.bodyBold },
  availabilityCard: { gap: spacing.sm },
  compactWarningCard: { gap: spacing.xs },
  eligibilityWarning: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  warningTitle: { fontFamily, color: colors.warning, ...typography.bodyBold },
  warningText: { fontFamily, color: colors.text, ...typography.small },
});