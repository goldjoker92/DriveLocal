// Driver home / operational cockpit.
// The admin decision remains the source of truth. Going online also starts the
// Android foreground/background location service used by dispatch and rides.

import { useEffect, useState } from 'react';
import { Alert, View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppBadge from '../../components/AppBadge';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import WalletCard from '../../components/WalletCard';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { FOUNDER_LABEL_PT_BR } from '../../constants/founderOfferRules';
import { WALLET_FALLBACK_LOW_THRESHOLD_CENTS } from '../../constants/walletRules';
import {
  driverPhotoStatus,
  hasApprovedDriverPhoto,
  rejectionReasonLabel,
} from '../../constants/driverPhoto';
import { auth } from '../../config/firebase';
import { DEV_RIDE_SIMULATOR_ENABLED } from '../../config/runtimeEnvironment';
import { getDriver, setDriverAvailability } from '../../services/driverService';
import { isFounderCommissionFreeActive } from '../../services/founderService';
import {
  getDriverTrackingPermissionState,
  restoreDriverOnlineTracking,
  startDriverOnlineTracking,
  stopDriverOnlineTracking,
} from '../../services/driverLocationTracking';
import { getRobotDriverState, stopRobotDriver } from '../../services/robotDriverEngine';
import {
  AVAILABILITY,
  formatDateBR,
  isFounderDriver,
  founderNumberLabel,
  commissionFreeUntilMs,
  subscriptionFreeUntilMs,
  benefitWarning,
  rideBlockReasonLabel,
  deriveEligibility,
  subscriptionDisplay,
  commissionDisplay,
} from '../../utils/driverCockpit';
import { logDriverPhotoEvent } from '../../utils/driverPhotoLog';

function SectionTitle({ children }) {
  return (
    <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{children}</Text>
  );
}

function Line({ children, tone = 'muted' }) {
  const color =
    tone === 'text' ? colors.text
    : tone === 'success' ? colors.success
    : tone === 'warning' ? colors.warning
    : colors.textMuted;
  return <Text style={[{ fontFamily, color }, typography.small]}>{children}</Text>;
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
  };
  return labels[status] || 'Não foi possível iniciar a localização do motorista.';
}

function robotSimulationActive() {
  return DEV_RIDE_SIMULATOR_ENABLED && getRobotDriverState().enabled;
}

function photoBadge(status, activePublicPhoto) {
  if (status === 'pending') return { label: 'Nova foto em análise', tone: 'warning' };
  if (status === 'rejected') return { label: 'Nova foto recusada', tone: 'danger' };
  if (activePublicPhoto) return { label: 'Foto aprovada', tone: 'success' };
  return { label: 'Foto necessária', tone: 'neutral' };
}

export default function DriverHome() {
  const router = useRouter();
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

        // Old builds wrote "available", but secure dispatch accepts only "online".
        if (data?.availabilityStatus === 'available') {
          await setDriverAvailability(uid, AVAILABILITY.OFFLINE).catch(() => undefined);
          if (active) {
            setDriver((current) => current ? { ...current, availabilityStatus: AVAILABILITY.OFFLINE } : current);
            setAvailability(AVAILABILITY.OFFLINE);
            setTrackingActive(false);
          }
          return;
        }

        const online = data?.availabilityStatus === AVAILABILITY.ONLINE;
        setAvailability(online ? AVAILABILITY.ONLINE : AVAILABILITY.OFFLINE);

        if (online) {
          if (robotSimulationActive()) {
            console.log('[ROBOT_DRIVER] online_restore.native_tracking_skipped', {
              reason: 'robot_simulation_active',
              driverId: uid,
              atMs: Date.now(),
            });
            if (active) setTrackingActive(true);
          } else {
            const restored = await restoreDriverOnlineTracking({
              driverId: uid,
              vehicleType: data?.vehicleType,
            });
            if (active) setTrackingActive(restored.status === 'active');
          }
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar seu cadastro.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const nowMs = Date.now();
  const { width } = useWindowDimensions();
  const stackAvailabilityButtons = width < 360;
  const uid = auth.currentUser?.uid;
  const displayName = driver && (driver.displayName || driver.fullName || driver.email);
  const founderActive = isFounderCommissionFreeActive(driver);
  const eligibility = deriveEligibility(driver);
  const subscription = subscriptionDisplay(driver, nowMs);
  const commission = commissionDisplay(driver, nowMs);
  const isAvailable = availability === AVAILABILITY.ONLINE;
  const photoStatus = driverPhotoStatus(driver);
  const activePublicPhoto = hasApprovedDriverPhoto(driver);
  const photo = photoBadge(photoStatus, activePublicPhoto);

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

    setSavingAvailability(true);
    try {
      const robotActive = robotSimulationActive();
      if (robotActive) {
        console.log('[ROBOT_DRIVER] go_online.native_tracking_skipped', {
          reason: 'robot_simulation_active',
          driverId: uid,
          atMs: Date.now(),
        });
      } else {
        const permission = await getDriverTrackingPermissionState();
        if (permission.status !== 'granted') {
          const consented = await confirmTrackingDisclosure();
          if (!consented) {
            setAvailabilityError('A localização em segundo plano é necessária para receber corridas.');
            return;
          }
        }

        const tracking = await startDriverOnlineTracking({
          driverId: uid,
          vehicleType: driver?.vehicleType,
          requestPermissions: permission.status !== 'granted',
        });
        if (tracking.status !== 'active') {
          setAvailabilityError(trackingErrorLabel(tracking.status));
          return;
        }
      }

      await setDriverAvailability(uid, AVAILABILITY.ONLINE);
      setAvailability(AVAILABILITY.ONLINE);
      setTrackingActive(true);
      setDriver((current) => current ? { ...current, availabilityStatus: AVAILABILITY.ONLINE } : current);
    } catch (_error) {
      if (!robotSimulationActive()) {
        await stopDriverOnlineTracking().catch(() => undefined);
      }
      setTrackingActive(false);
      setAvailability(AVAILABILITY.OFFLINE);
      setAvailabilityError('Não foi possível ativar sua disponibilidade e localização.');
    } finally {
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
    setSavingAvailability(true);
    try {
      await setDriverAvailability(uid, AVAILABILITY.OFFLINE);
      if (robotSimulationActive()) {
        await stopRobotDriver();
      } else {
        await stopDriverOnlineTracking();
      }
      setAvailability(AVAILABILITY.OFFLINE);
      setTrackingActive(false);
      setDriver((current) => current ? { ...current, availabilityStatus: AVAILABILITY.OFFLINE } : current);
    } catch (_error) {
      setAvailabilityError('Não foi possível ficar indisponível. Tente novamente.');
    } finally {
      setSavingAvailability(false);
    }
  }

  const commissionWarn = benefitWarning('Sua comissão gratuita', commissionFreeUntilMs(driver), nowMs);
  const subscriptionWarn = benefitWarning('Sua assinatura gratuita', subscriptionFreeUntilMs(driver), nowMs);

  const founderLabel = (() => {
    const num = founderNumberLabel(driver);
    return num ? `${FOUNDER_LABEL_PT_BR} ${num}` : FOUNDER_LABEL_PT_BR;
  })();

  const balanceCents = Number(driver?.walletBalanceCentavos ?? driver?.balanceCents ?? 0);
  const walletBlocked =
    balanceCents <= WALLET_FALLBACK_LOW_THRESHOLD_CENTS &&
    (driver && (driver.walletStatus === 'required' || driver.walletStatus === 'blocked'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Motorista"
          subtitle={loading ? 'Carregando…' : displayName}
          onBack={() => router.back()}
          right={<DriverStatusBadge status={isAvailable ? 'online' : 'offline'} />}
        />

        {loading ? (
          <AppCard><AdminTableRow label="Carregando…" /></AppCard>
        ) : error ? (
          <AppCard><Line tone="warning">{error}</Line></AppCard>
        ) : !driver ? (
          <AppCard><AdminTableRow label="Cadastro não encontrado" /></AppCard>
        ) : (
          <>
            <AppCard>
              <SectionTitle>STATUS</SectionTitle>
              <AppBadge label="Motorista aprovado" tone="success" />
              {driver.approvalNumber ? (
                <AdminTableRow label="Número de aprovação" value={`#${driver.approvalNumber}`} />
              ) : null}
            </AppCard>

            <AppCard>
              <SectionTitle>FOTO DO MOTORISTA</SectionTitle>
              <AppBadge label={photo.label} tone={photo.tone} />
              {activePublicPhoto ? (
                <Line tone="success">Sua foto aprovada continua visível aos passageiros.</Line>
              ) : (
                <Line>Envie uma foto clara para o passageiro reconhecer você.</Line>
              )}
              {photoStatus === 'pending' ? (
                <Line tone="warning">
                  A nova candidata está em análise. A foto aprovada anterior, se existir, permanece ativa.
                </Line>
              ) : null}
              {photoStatus === 'rejected' ? (
                <Line tone="warning">
                  {driver.driverPhotoRejectionReason
                    || rejectionReasonLabel(driver.driverPhotoRejectionCode)}
                </Line>
              ) : null}
              <AppButton
                title={activePublicPhoto ? 'Ver ou trocar minha foto' : 'Enviar minha foto'}
                variant="secondary"
                onPress={openDriverPhoto}
              />
            </AppCard>

            <AppCard>
              <SectionTitle>BENEFÍCIOS</SectionTitle>
              {isFounderDriver(driver) ? <AppBadge label={founderLabel} tone="success" /> : null}
              {commission.mode === 'free' ? (
                <Line tone="success">{`Comissão 0% até ${formatDateBR(commission.dateMs)}`}</Line>
              ) : null}
              {subscription.mode === 'free' ? (
                <Line tone="success">{`Assinatura grátis até ${formatDateBR(subscription.dateMs)}`}</Line>
              ) : null}
              {commissionWarn ? <Line tone="warning">{commissionWarn}</Line> : null}
              {subscriptionWarn ? <Line tone="warning">{subscriptionWarn}</Line> : null}
              {!isFounderDriver(driver) && commission.mode !== 'free' && subscription.mode !== 'free' ? (
                <Line>Nenhum benefício ativo no momento.</Line>
              ) : null}
            </AppCard>

            <AppCard>
              <SectionTitle>DISPONIBILIDADE E GPS</SectionTitle>
              <Line>
                Quando disponível, sua posição é usada para encontrar corridas. Durante a corrida,
                somente o passageiro daquela corrida vê seu deslocamento ao vivo.
              </Line>
              <View style={{ flexDirection: stackAvailabilityButtons ? 'column' : 'row', gap: spacing.sm }}>
                <AppButton
                  title="Disponível"
                  variant={isAvailable ? 'primary' : 'secondary'}
                  onPress={goAvailable}
                  disabled={savingAvailability}
                  style={stackAvailabilityButtons ? undefined : { flex: 1 }}
                />
                <AppButton
                  title="Indisponível"
                  variant={!isAvailable ? 'primary' : 'secondary'}
                  onPress={goOffline}
                  disabled={savingAvailability}
                  style={stackAvailabilityButtons ? undefined : { flex: 1 }}
                />
              </View>
              {isAvailable ? (
                <Line tone={trackingActive ? 'success' : 'warning'}>
                  {trackingActive
                    ? (robotSimulationActive() ? 'Localização simulada ativa.' : 'Localização de trabalho ativa.')
                    : 'Verificando localização de trabalho…'}
                </Line>
              ) : null}
              {!eligibility.eligible ? (
                <View style={{ backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs }}>
                  <Text style={[{ fontFamily, color: colors.warning }, typography.bodyBold]}>
                    Você ainda não pode ficar disponível.
                  </Text>
                  <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
                    {rideBlockReasonLabel(eligibility.reasonCode)}
                  </Text>
                </View>
              ) : null}
              {availabilityError ? <Line tone="warning">{availabilityError}</Line> : null}
            </AppCard>

            <AppCard>
              <SectionTitle>ASSINATURA</SectionTitle>
              {subscription.mode === 'free' ? (
                <Line tone="success">{`Assinatura grátis até ${formatDateBR(subscription.dateMs)}`}</Line>
              ) : subscription.mode === 'active' ? (
                <>
                  <Line tone="text">Assinatura ativa.</Line>
                  {subscription.dateMs ? <Line>{`Válida até ${formatDateBR(subscription.dateMs)}`}</Line> : null}
                </>
              ) : (
                <>
                  <Line tone="text">Para receber corridas, ative sua assinatura.</Line>
                  <Line>Após ativar sua assinatura, você terá 0% de comissão por 60 dias.</Line>
                  <AppButton title="Ativar assinatura — em breve" variant="secondary" disabled />
                </>
              )}
            </AppCard>

            <AppCard>
              <SectionTitle>COMISSÃO</SectionTitle>
              {commission.mode === 'free' ? (
                <>
                  <Line tone="success">{`Comissão 0% até ${formatDateBR(commission.dateMs)}`}</Line>
                  <Line>Você recebe 100% do valor das corridas durante este período.</Line>
                </>
              ) : (
                <>
                  <Line tone="text">Comissão padrão: 15% por corrida concluída.</Line>
                  <Line>A taxa será descontada do seu Saldo DriveLocal quando as comissões forem ativadas.</Line>
                </>
              )}
            </AppCard>

            <AppCard>
              <SectionTitle>SALDO DRIVELOCAL</SectionTitle>
              <WalletCard balanceCents={balanceCents} isFounderActive={founderActive} />
              <Line>Será usado para pagar taxas da plataforma quando as comissões forem ativadas.</Line>
              {walletBlocked ? <Line tone="warning">Recarregue seu saldo para receber corridas.</Line> : null}
              <AppButton title="Ver carteira" variant="ghost" onPress={() => router.push('/wallet')} />
            </AppCard>

            <AppCard>
              <SectionTitle>CORRIDAS</SectionTitle>
              <Line>Quando você estiver disponível, novas ofertas aparecerão automaticamente.</Line>
            </AppCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
