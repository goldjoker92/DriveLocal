// Passenger active-ride screen (route "/driver-accepted").
// The layout evolves with the server-authoritative ride status: approaching,
// arrived, in progress and payment. No client-side status is invented.

import { useEffect, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import RideTrackingMap from '../../components/RideTrackingMap';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { formatBRL } from '../../utils/format';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { listenToRide, listenToRideLocation, cancelRide } from '../../services/ridesService';

const MAP_STATUSES = new Set(['assigned', 'driver_arrived', 'in_progress']);

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

function resolveDriverPhoto(driver) {
  return driver.photoUrl
    || driver.profilePhotoUrl
    || driver.driverPhotoUrl
    || driver.selfieUrl
    || null;
}

function DriverIdentityCard({ driver, ride }) {
  const photoUrl = resolveDriverPhoto(driver);
  const vehicleType = driver.vehicleType || ride.vehicleType;
  const model = [driver.vehicleMake, driver.vehicleModel, driver.vehicleColor].filter(Boolean).join(' ');

  return (
    <AppCard>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        {photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            resizeMode="cover"
            style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: colors.card }}
            onError={() => logRideClientEvent('ride.passenger.driver_photo_failed', { rideId: ride.rideId, hasPhotoUrl: true }, 'error')}
          />
        ) : (
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 38,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 34 }}>👤</Text>
          </View>
        )}

        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>
            {driver.name || 'Motorista DriveLocal'}
          </Text>
          <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
            Motorista verificado ✓
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            {VEHICLE_LABELS_PT_BR[vehicleType] || 'Veículo'}{model ? ` • ${model}` : ''}
          </Text>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            Placa {driver.vehiclePlate || '—'}
          </Text>
        </View>
      </View>
    </AppCard>
  );
}

export default function DriverAccepted() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const [ride, setRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!rideId) return undefined;
    return listenToRide(
      rideId,
      (nextRide) => {
        if (!nextRide) return;
        setRide(nextRide);
        logRideClientEvent('ride.passenger.phase_changed', {
          rideId,
          status: nextRide.status,
          hasDriverPublic: !!nextRide.acceptedDriverPublic,
        });

        if (nextRide.status === 'completed') {
          router.replace({ pathname: '/ride-completed', params: { rideId } });
        } else if (nextRide.status === 'cancelled') {
          router.replace('/passenger-home');
        } else if (nextRide.status === 'awaiting_payment' || nextRide.status === 'payment_marked_sent') {
          router.replace({ pathname: '/pix-payment', params: { rideId } });
        }
      },
      (listenerError) => {
        setError('Não foi possível carregar a corrida.');
        logRideClientEvent('ride.passenger.listener_failed', { rideId, error: listenerError }, 'error');
      }
    );
  }, [rideId, router]);

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

  async function handleCancel() {
    if (!rideId || busy) return;
    setBusy(true);
    setError('');
    try {
      await cancelRide(rideId, 'passageiro_cancelou');
      router.replace('/passenger-home');
    } catch (e) {
      setError(e?.message || 'Não foi possível cancelar a corrida.');
      logRideClientEvent('ride.passenger.cancel_failed', { rideId, error: e }, 'error');
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
        <Header title={ride?.status === 'in_progress' ? 'Corrida em andamento' : 'Sua corrida'} onBack={() => router.back()} />

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

            <DriverIdentityCard driver={driver} ride={ride} />

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
                  showEta={ride.status === 'assigned'}
                />
              </AppCard>
            ) : null}

            <AppCard>
              <AdminTableRow label="Origem" value={ride.pickup?.label || '—'} />
              <AdminTableRow label="Destino" value={ride.destination?.label || '—'} />
              <AdminTableRow label="Preço estimado" value={formatBRL(ride.finalFareCentavos ?? ride.estimatedFareCentavos)} />
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
              <AppButton title={busy ? 'Cancelando…' : 'Cancelar corrida'} variant="ghost" onPress={handleCancel} disabled={busy} />
            ) : null}
          </>
        ) : rideId ? (
          <AppCard><Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Carregando corrida…</Text></AppCard>
        ) : null}

        {error ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
          </AppCard>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
