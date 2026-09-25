// Passenger dispatch screen (route "/searching").
//
// Shows the server-authoritative quote immediately, then follows the passenger's
// secured ride document in real time. Assignment, payment and completion route
// changes are driven only by backend status — never by timers or mock data.

import { useEffect, useRef, useState } from 'react';
import { ScrollView, ActivityIndicator, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { formatBRL, formatDistanceKm, formatDurationMinutes } from '../../utils/format';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { listenToRide, cancelRide } from '../../services/ridesService';
import { networkErrorMessage } from '../../services/networkRecoveryService';

const STATUS_LABEL = {
  searching: 'Procurando um motorista próximo…',
  assigned: 'Motorista encontrado!',
  driver_arrived: 'Seu motorista chegou.',
  in_progress: 'Corrida em andamento.',
  awaiting_payment: 'Corrida finalizada. Abra o pagamento Pix.',
  payment_marked_sent: 'Pagamento informado. Aguardando confirmação.',
  disputed: 'Pagamento em análise. Abra o acompanhamento Pix.',
  no_driver_available: 'Nenhum motorista disponível no momento.',
  dispatch_failed: 'Não foi possível procurar motoristas. Tente novamente.',
  cancelled: 'Corrida cancelada.',
  completed: 'Corrida concluída.',
};

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function numberParam(value) {
  const raw = firstParam(value);
  if (raw == null || raw === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function hasNumericValue(value) {
  return value != null && value !== '' && Number.isFinite(Number(value));
}

export default function Searching() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof firstParam(params.rideId) === 'string' ? firstParam(params.rideId) : null;

  // Route params provide an instant quote while the first Firestore snapshot is
  // loading. The ref keeps this seed stable and avoids listener churn on renders.
  const initialRideRef = useRef(null);
  if (!initialRideRef.current) {
    initialRideRef.current = {
      rideId,
      status: typeof firstParam(params.status) === 'string' ? firstParam(params.status) : 'searching',
      vehicleType:
        typeof firstParam(params.vehicleType) === 'string' ? firstParam(params.vehicleType) : null,
      estimatedFareCentavos: numberParam(params.estimatedFareCentavos),
      routeDistanceMeters: numberParam(params.routeDistanceMeters),
      routeDurationSeconds: numberParam(params.routeDurationSeconds),
    };
  }

  const [ride, setRide] = useState(initialRideRef.current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!rideId) return undefined;

    logRideClientEvent('ride.searching.screen_opened', {
      rideId,
      status: initialRideRef.current?.status,
      ride: initialRideRef.current,
    });

    return listenToRide(
      rideId,
      (nextRide) => {
        if (!nextRide) return;
        setRide(nextRide);
        setError('');

        logRideClientEvent('ride.searching.status_processed', {
          rideId,
          status: nextRide.status,
          ride: nextRide,
        });

        if (['assigned', 'driver_arrived', 'in_progress'].includes(nextRide.status)) {
          router.replace({ pathname: '/driver-accepted', params: { rideId } });
        } else if (['awaiting_payment', 'payment_marked_sent', 'disputed'].includes(nextRide.status)) {
          router.replace({ pathname: '/pix-payment', params: { rideId } });
        } else if (nextRide.status === 'completed') {
          router.replace({ pathname: '/ride-completed', params: { rideId } });
        } else if (nextRide.status === 'cancelled') {
          router.replace('/passenger-home');
        }
      },
      (listenerError) => {
        logRideClientEvent('ride.searching.listener_failed', { rideId, error: listenerError }, 'error');
        setError(networkErrorMessage(
          listenerError,
          'Não foi possível acompanhar a busca. Recarregue a tela.'
        ));
      }
    );
  }, [rideId, router]);

  async function handleCancel() {
    if (!rideId || busy) return;
    setBusy(true);
    setError('');

    try {
      await cancelRide(rideId, 'passageiro_cancelou_busca');
      router.replace('/passenger-home');
    } catch (cancelError) {
      if (cancelError?.code !== 'CANCELLATION_SELECTION_DISMISSED') {
        setError(networkErrorMessage(cancelError, 'Não foi possível cancelar a corrida.'));
      }
    } finally {
      setBusy(false);
    }
  }

  function retryRide() {
    logRideClientEvent('ride.searching.retry_selected', {
      rideId,
      status: ride?.status,
      ride,
    });
    router.replace('/request-ride');
  }

  const status = ride?.status || 'searching';
  const searching = status === 'searching';
  const canRetry = ['no_driver_available', 'dispatch_failed'].includes(status);
  const label = STATUS_LABEL[status] || 'Atualizando sua corrida…';
  const vehicleLabel = VEHICLE_LABELS_PT_BR[ride?.vehicleType] || '—';
  const fareAvailable = hasNumericValue(ride?.estimatedFareCentavos);
  const distanceAvailable = hasNumericValue(ride?.routeDistanceMeters);
  const durationAvailable = hasNumericValue(ride?.routeDurationSeconds);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        {/* No generic back action while a request is active. Cancellation is an
            explicit backend transition and prevents an orphaned search. */}
        <Header title="Procurando motorista" subtitle="Motoristas locais em Horizonte" />

        <AppCard>
          <View style={{ alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.md }}>
            {searching ? <ActivityIndicator size="large" color={colors.primary} /> : null}
            <Text style={[{ fontFamily, color: colors.text, textAlign: 'center' }, typography.bodyBold]}>
              {label}
            </Text>
            {searching ? (
              <Text style={[{ fontFamily, color: colors.textMuted, textAlign: 'center' }, typography.small]}>
                Enviamos a solicitação aos motoristas elegíveis próximos do embarque.
              </Text>
            ) : null}
          </View>
        </AppCard>

        {rideId ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>Resumo da corrida</Text>
            <AdminTableRow
              label="Preço da corrida"
              value={fareAvailable ? formatBRL(ride.estimatedFareCentavos) : 'Calculando…'}
            />
            <AdminTableRow label="Veículo" value={vehicleLabel} />
            <AdminTableRow
              label="Distância estimada"
              value={distanceAvailable ? formatDistanceKm(ride.routeDistanceMeters) : '—'}
            />
            <AdminTableRow
              label="Duração estimada"
              value={durationAvailable ? formatDurationMinutes(ride.routeDurationSeconds) : '—'}
            />
            <AdminTableRow label="Origem" value={ride?.pickup?.label || 'Endereço confirmado'} />
            <AdminTableRow label="Destino" value={ride?.destination?.label || 'Destino confirmado'} />
            <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
            <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
              O valor foi calculado pelo servidor com a rota e as regras DriveLocal vigentes.
            </Text>
          </AppCard>
        ) : (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>
              Nenhuma corrida foi informada. Volte ao início e tente novamente.
            </Text>
          </AppCard>
        )}

        {searching ? (
          <AppButton
            title={busy ? 'Cancelando…' : 'Cancelar corrida'}
            variant="ghost"
            onPress={handleCancel}
            disabled={busy || !rideId}
          />
        ) : canRetry ? (
          <AppButton title="Tentar novamente" onPress={retryRide} />
        ) : null}

        {error ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
