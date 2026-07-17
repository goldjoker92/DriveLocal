// Active driver ride screen (route "/active-ride"). Uses the driver's secured
// winning offer and attaches the background location service to this ride.

import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { openGoogleMapsToPoint, openWazeToPoint } from '../../utils/maps';
import {
  attachActiveRideTracking,
  detachActiveRideTracking,
} from '../../services/driverLocationTracking';
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
      detachActiveRideTracking(rideId).finally(() => {
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

  async function act(key, fn) {
    if (!rideId || busy) return;
    setBusy(key);
    setError('');
    try {
      const res = await fn(rideId);
      if (res?.status) setStatus(res.status);
      if (res && ['awaiting_payment', 'completed', 'cancelled', 'disputed'].includes(res.status)) {
        await detachActiveRideTracking(rideId);
      }
      if (res && ['completed', 'cancelled', 'disputed'].includes(res.status)) {
        router.replace('/driver-home');
      }
    } catch (e) {
      setError(e?.message || 'Não foi possível concluir. Tente novamente.');
    } finally {
      setBusy('');
    }
  }

  async function openNav(point, which) {
    if (!point) return;
    setError('');
    try {
      if (which === 'waze') await openWazeToPoint(point, offer?.vehicleType);
      else await openGoogleMapsToPoint(point, offer?.vehicleType);
    } catch (_e) {
      setError(which === 'waze'
        ? 'Não foi possível abrir o Waze. Tente o Google Maps.'
        : 'Não foi possível abrir o Google Maps. Tente o Waze.');
    }
  }

  const pickup = offer?.exactPickup;
  const destination = offer?.exactDestination;
  const trackingActive = trackingStatus === 'active';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Corrida ativa" onBack={() => router.back()} />

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

        {(status === 'assigned' || status === 'driver_arrived') && pickup ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Ir buscar o passageiro</Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{pickup.label || 'Local de embarque'}</Text>
            <View style={{ gap: spacing.sm }}>
              <AppButton title="Abrir no Waze" onPress={() => openNav(pickup, 'waze')} />
              <AppButton title="Abrir no Google Maps" onPress={() => openNav(pickup, 'gmaps')} />
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
                  <AppButton title="Abrir no Waze" onPress={() => openNav(destination, 'waze')} />
                  <AppButton title="Abrir no Google Maps" onPress={() => openNav(destination, 'gmaps')} />
                </View>
              </>
            ) : (
              <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>Carregando destino…</Text>
            )}
            <AppButton title={busy === 'finish' ? 'Enviando…' : 'Finalizar corrida'} onPress={() => act('finish', finishRide)} disabled={!!busy || !destination} />
          </AppCard>
        ) : null}

        {status === 'awaiting_payment' || status === 'payment_marked_sent' ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Pagamento</Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Confirme somente depois de verificar o Pix na sua conta.
            </Text>
            <AppButton title={busy === 'confirm' ? 'Enviando…' : 'Pagamento recebido'} onPress={() => act('confirm', confirmDriverPixReceived)} disabled={!!busy} />
            <AppButton title="Problema no pagamento" variant="ghost" onPress={() => act('issue', (id) => reportPaymentIssue(id, 'motorista_reportou'))} disabled={!!busy} />
          </AppCard>
        ) : null}

        {status === 'assigned' || status === 'driver_arrived' ? (
          <AppButton title="Cancelar corrida" variant="ghost" onPress={() => act('cancel', (id) => cancelRide(id, 'motorista_cancelou'))} disabled={!!busy} />
        ) : null}

        {error ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
