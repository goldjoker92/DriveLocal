// Confirm ride (route "/confirm-price"). Real coordinates only.
//
// Coordinates arrive already RESOLVED from select-route (GPS or native geocoder)
// — never invented here. The client sends only coordinates + vehicleType + a
// reused idempotency key; the authoritative fare/distance/duration/serviceArea
// come from the backend (createRideRequestSecure). No client fare is computed
// from address text. Both locations are shown with an edit action before the
// request; map confirmation is NOT required because valid coordinates exist.

import { useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { auth } from '../../config/firebase';
import { requestRide } from '../../services/ridesService';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function ConfirmPrice() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const vehicleType = params.vehicleType === 'car' ? 'car' : 'moto';
  const pickup = { lat: num(params.pickupLat), lng: num(params.pickupLng), label: params.pickupLabel || '' };
  const destination = { lat: num(params.destLat), lng: num(params.destLng), label: params.destLabel || '' };
  const hasCoords = pickup.lat != null && pickup.lng != null && destination.lat != null && destination.lng != null;

  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState('');
  // One idempotency key per request attempt, REUSED across timeout/retry so a
  // retried request never creates a second ride.
  const idempotencyKeyRef = useRef(null);

  async function handleRequest() {
    if (!hasCoords) {
      setRequestError('Endereços inválidos. Volte e selecione os pontos novamente.');
      return;
    }
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setRequestError('Faça login para pedir uma corrida.');
      return;
    }
    setSubmitting(true);
    setRequestError('');
    try {
      const result = await requestRide({
        vehicleType,
        pickup,
        destination,
        idempotencyKeyRef, // reused on retry
      });
      router.push({ pathname: '/searching', params: { rideId: result.rideId } });
    } catch (e) {
      setRequestError((e && e.message) || 'Não foi possível pedir a corrida. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Confirmar corrida" onBack={() => router.back()} />
        <AppCard>
          <AdminTableRow label="Origem" value={pickup.label || '—'} />
          <AdminTableRow label="Destino" value={destination.label || '—'} />
          <AdminTableRow label="Veículo" value={VEHICLE_LABELS_PT_BR[vehicleType]} />
          <AdminTableRow label="Preço" value="Calculado ao pedir (servidor)" />
          <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
        </AppCard>
        <AppButton title="Editar locais" variant="ghost" onPress={() => router.back()} />
        <AppButton
          title={submitting ? 'Enviando…' : 'Pedir corrida'}
          onPress={handleRequest}
          disabled={!hasCoords || submitting}
        />
        {requestError ? <AdminTableRow label={requestError} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
