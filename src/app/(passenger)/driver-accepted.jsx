// Passenger active-ride screen (route "/driver-accepted").
// The server-authoritative acceptedDriverPublic snapshot contains only approved,
// passenger-safe identity fields. Private selfie/document paths never reach here.

import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import RideTrackingMap from '../../components/RideTrackingMap';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { getDriverPhotoDownloadUrl } from '../../services/driverPhotoService';
import { cancelRide } from '../../services/ridesService';
import {
  listenToPassengerRide as listenToRide,
  listenToPassengerRideLocation as listenToRideLocation,
} from '../../services/passengerRideLiveListeners';
import { firstName } from '../../utils/driverPhoto';
import { logDriverPhotoEvent } from '../../utils/driverPhotoLog';
import { formatBRL } from '../../utils/format';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { conversationRoute, messagePhaseOpen } from '../../utils/ride-messages';

const MAP_STATUSES = new Set(['assigned', 'driver_arrived', 'in_progress']);
const ARRIVAL_NOTICE_VISIBLE_MS = 12_000;
// The shared listener now re-subscribes by itself after an error: once a ride
// snapshot arrives again, this message must disappear on its own.
const RIDE_LISTENER_ERROR = 'Não foi possível carregar a corrida.';

const PHASES = {
  assigned: {
    eyebrow: 'MOTORISTA A CAMINHO',
    title: 'Seu motorista está indo até você',
    detail: 'Acompanhe a aproximação e confira o veículo antes de embarcar.',
  },
  driver_arrived: {
    eyebrow: 'MOTORISTA CHEGOU',
    title: 'Seu motorista chegou ao embarque',
    detail: 'Encontre o veículo pela foto, modelo, cor e placa antes de entrar.',
  },
  in_progress: {
    eyebrow: 'CORRIDA EM ANDAMENTO',
    title: 'Você está a caminho do destino',
    detail: 'Acompanhe o trajeto até o local informado na solicitação.',
  },
  awaiting_payment: {
    eyebrow: 'PAGAMENTO',
    title: 'Corrida finalizada',
    detail: 'O pagamento Pix está pronto.',
  },
  payment_marked_sent: {
    eyebrow: 'PAGAMENTO INFORMADO',
    title: 'Aguardando confirmação do motorista',
    detail: 'O motorista precisa conferir o recebimento na própria conta.',
  },
  disputed: {
    eyebrow: 'PAGAMENTO EM ANÁLISE',
    title: 'Há um problema com o pagamento',
    detail: 'O valor e os dados da corrida permanecem registrados para conferência.',
  },
};

function DriverIdentityCard({ driver, ride, photoUrl, onPhotoError }) {
  const vehicleType = driver.vehicleType || ride.vehicleType;
  const model = [driver.vehicleMake, driver.vehicleModel, driver.vehicleColor]
    .filter(Boolean)
    .join(' • ');
  const photoVerified = driver.photoVerified === true && Boolean(photoUrl);

  return (
    <AppCard>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            resizeMode="cover"
            style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.card }}
            onError={onPhotoError}
            accessibilityLabel="Foto verificada do motorista"
          />
        ) : (
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 38 }}>👤</Text>
          </View>
        )}

        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>
            {firstName(driver.name)}
          </Text>
          <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
            Motorista verificado ✓
          </Text>
          {photoVerified ? (
            <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
              Foto verificada ✓
            </Text>
          ) : (
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
              Confira também o veículo e a placa.
            </Text>
          )}
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            {VEHICLE_LABELS_PT_BR[vehicleType] || 'Veículo'}{model ? ` • ${model}` : ''}
          </Text>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            Placa {driver.vehiclePlate || '—'}
          </Text>
        </View>
      </View>

      <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>
        Confira o rosto, o veículo e a placa antes de embarcar.
      </Text>
    </AppCard>
  );
}

function DriverArrivalNotice({ visible, onDismiss }) {
  if (!visible) return null;
  return (
    <AppCard style={{ backgroundColor: colors.accentTint, borderColor: colors.accent }}>
      <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.background,
          }}
        >
          <Text style={{ fontSize: 23 }}>🔔</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[{ fontFamily, color: colors.success }, typography.bodyBold]}>
            Motorista chegou
          </Text>
          <Text style={[{ fontFamily, color: colors.text }, typography.small]}>
            Seu motorista chegou ao local de embarque. Confira a placa antes de entrar.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar aviso de chegada"
          hitSlop={12}
          onPress={onDismiss}
          style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1, padding: 4 })}
        >
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.bodyBold]}>×</Text>
        </Pressable>
      </View>
    </AppCard>
  );
}

export default function DriverAccepted() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const previousStatusRef = useRef(null);
  const [ride, setRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [driverPhotoUrl, setDriverPhotoUrl] = useState(null);
  const [arrivalNoticeVisible, setArrivalNoticeVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!rideId) return undefined;
    return listenToRide(
      rideId,
      (nextRide) => {
        if (!nextRide) return;
        const previousStatus = previousStatusRef.current;
        previousStatusRef.current = nextRide.status || null;
        setRide(nextRide);
        setError((current) => (current === RIDE_LISTENER_ERROR ? '' : current));

        if (previousStatus !== nextRide.status) {
          logRideClientEvent('ride.passenger.phase_changed', {
            rideId,
            status: nextRide.status,
            previousStatus,
            hasDriverPublic: !!nextRide.acceptedDriverPublic,
            hasApprovedDriverPhoto: Boolean(nextRide.acceptedDriverPublic?.photoStoragePath),
          });
        }

        if (nextRide.status === 'driver_arrived' && previousStatus !== 'driver_arrived') {
          setArrivalNoticeVisible(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          logRideClientEvent('ride.passenger.arrival_notice_presented', {
            rideId,
            source: 'ride_snapshot_fallback',
          });
        } else if (nextRide.status !== 'driver_arrived') {
          setArrivalNoticeVisible(false);
        }

        if (nextRide.status === 'completed') {
          router.replace({ pathname: '/ride-completed', params: { rideId } });
        } else if (nextRide.status === 'cancelled') {
          router.replace('/passenger-home');
        } else if (nextRide.status === 'awaiting_payment' || nextRide.status === 'payment_marked_sent') {
          router.replace({ pathname: '/pix-payment', params: { rideId } });
        }
      },
      (listenerError) => {
        setError(RIDE_LISTENER_ERROR);
        logRideClientEvent('ride.passenger.listener_failed', { rideId, error: listenerError }, 'error');
      }
    );
  }, [rideId, router]);

  useEffect(() => {
    if (!arrivalNoticeVisible) return undefined;
    const timeout = setTimeout(() => setArrivalNoticeVisible(false), ARRIVAL_NOTICE_VISIBLE_MS);
    return () => clearTimeout(timeout);
  }, [arrivalNoticeVisible]);

  useEffect(() => {
    if (!rideId) return undefined;
    return listenToRideLocation(
      rideId,
      setDriverLocation,
      (locationError) => {
        setDriverLocation(null);
        logRideClientEvent('ride.passenger.location_listener_failed', { rideId, error: locationError }, 'error');
      }
    );
  }, [rideId]);

  const photoStoragePath = ride?.acceptedDriverPublic?.photoStoragePath;
  const photoVerified = ride?.acceptedDriverPublic?.photoVerified === true;

  useEffect(() => {
    let active = true;
    setDriverPhotoUrl(null);
    if (!rideId || !photoVerified || !photoStoragePath) return undefined;

    const startedAt = Date.now();
    logDriverPhotoEvent('passenger.photo_load_started', {
      status: 'approved',
      hasApprovedPhoto: true,
      action: 'ride_identity_card',
    });

    getDriverPhotoDownloadUrl(photoStoragePath)
      .then((url) => {
        if (!active) return;
        setDriverPhotoUrl(url);
        logDriverPhotoEvent('passenger.photo_load_succeeded', {
          status: 'approved',
          hasApprovedPhoto: true,
          action: 'ride_identity_card',
          durationMs: Date.now() - startedAt,
        });
      })
      .catch((photoError) => {
        if (active) setDriverPhotoUrl(null);
        logDriverPhotoEvent('passenger.photo_load_failed', {
          status: 'approved',
          hasApprovedPhoto: true,
          action: 'ride_identity_card',
          code: photoError?.code,
          message: photoError?.message,
          durationMs: Date.now() - startedAt,
        }, 'warn');
      });

    return () => {
      active = false;
    };
  }, [rideId, photoStoragePath, photoVerified]);

  async function handleCancel() {
    if (!rideId || busy) return;
    setBusy(true);
    setError('');
    try {
      await cancelRide(rideId, 'passageiro_cancelou');
      router.replace('/passenger-home');
    } catch (cancelError) {
      if (cancelError?.code !== 'CANCELLATION_SELECTION_DISMISSED') {
        setError(cancelError?.message || 'Não foi possível cancelar a corrida.');
        logRideClientEvent('ride.passenger.cancel_failed', { rideId, error: cancelError }, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  const driver = ride?.acceptedDriverPublic || {};
  const phase = PHASES[ride?.status] || {
    eyebrow: 'ATUALIZANDO',
    title: 'Atualizando sua corrida',
    detail: 'Aguarde alguns instantes.',
  };
  const canCancel = ride && ['assigned', 'driver_arrived'].includes(ride.status);
  const showMap = ride && MAP_STATUSES.has(ride.status);
  const mapTarget = ride?.status === 'in_progress' ? ride?.destination : ride?.pickup;
  const mapTargetTitle = ride?.status === 'in_progress' ? 'Destino da corrida' : 'Local de embarque';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title={ride?.status === 'in_progress' ? 'Corrida em andamento' : 'Sua corrida'}
          onBack={() => router.back()}
        />

        <DriverArrivalNotice
          visible={arrivalNoticeVisible && ride?.status === 'driver_arrived'}
          onDismiss={() => setArrivalNoticeVisible(false)}
        />

        {!rideId ? (
          <AppCard><Text style={[{ fontFamily, color: colors.danger }, typography.small]}>Corrida inválida.</Text></AppCard>
        ) : null}

        {ride ? (
          <>
            <AppCard>
              <Text style={[{ fontFamily, color: colors.primary }, typography.caption]}>{phase.eyebrow}</Text>
              <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>{phase.title}</Text>
              <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{phase.detail}</Text>
            </AppCard>

            <DriverIdentityCard
              driver={driver}
              ride={ride}
              photoUrl={driverPhotoUrl}
              onPhotoError={() => {
                setDriverPhotoUrl(null);
                logDriverPhotoEvent('passenger.photo_render_failed', {
                  status: 'approved',
                  hasApprovedPhoto: true,
                  action: 'ride_identity_card',
                }, 'warn');
              }}
            />

            {showMap ? (
              <AppCard>
                <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
                  {ride.status === 'in_progress' ? 'Acompanhe sua corrida' : 'Acompanhe seu motorista'}
                </Text>
                <RideTrackingMap
                  rideId={rideId}
                  target={mapTarget}
                  targetTitle={mapTargetTitle}
                  driverLocation={driverLocation}
                  vehicleType={driver.vehicleType || ride.vehicleType}
                  showEta={ride.status === 'assigned' || ride.status === 'in_progress'}
                  etaContext={ride.status === 'in_progress' ? 'destination' : 'pickup'}
                  rideStatus={ride.status}
                  onMessageDriver={messagePhaseOpen(ride.status)
                    ? () => router.push({ pathname: conversationRoute('passenger'), params: { rideId } })
                    : null}
                />
              </AppCard>
            ) : null}

            <AppCard>
              <AdminTableRow label="Origem" value={ride.pickup?.label || '—'} />
              <AdminTableRow label="Destino" value={ride.destination?.label || '—'} />
              <AdminTableRow
                label="Preço da corrida"
                value={formatBRL(ride.finalFareCentavos ?? ride.estimatedFareCentavos)}
              />
            </AppCard>

            {ride.status === 'driver_arrived' ? (
              <AppCard>
                <Text style={[{ fontFamily, color: colors.warning }, typography.bodyBold]}>
                  Confira a placa antes de embarcar
                </Text>
                <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                  Entre somente no veículo mostrado acima. A corrida começa quando o motorista confirmar o embarque.
                </Text>
              </AppCard>
            ) : null}

            {canCancel ? (
              <AppButton
                title={busy ? 'Cancelando…' : 'Cancelar corrida'}
                variant="ghost"
                onPress={handleCancel}
                disabled={busy}
              />
            ) : null}
          </>
        ) : rideId ? (
          <AppCard><Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Carregando corrida…</Text></AppCard>
        ) : null}

        {error ? (
          <AppCard><Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text></AppCard>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
