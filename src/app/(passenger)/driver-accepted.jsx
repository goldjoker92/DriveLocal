// Passenger assigned-ride screen (route "/driver-accepted"). Uses the
// passenger's secured ride listener only; no mock driver, route or fare data.

import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
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
import { formatBRL } from '../../utils/format';
import { listenToRide, cancelRide } from '../../services/ridesService';

const STATUS_LABELS = {
  assigned: 'Motorista a caminho do embarque',
  driver_arrived: 'Motorista chegou ao embarque',
  in_progress: 'Corrida em andamento',
  awaiting_payment: 'Corrida finalizada — pagamento disponível',
  payment_marked_sent: 'Pagamento informado — aguardando confirmação',
  disputed: 'Pagamento em análise',
};

export default function DriverAccepted() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const [ride, setRide] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!rideId) return undefined;
    return listenToRide(
      rideId,
      (nextRide) => {
        if (!nextRide) return;
        setRide(nextRide);
        if (nextRide.status === 'completed') {
          router.replace({ pathname: '/ride-completed', params: { rideId } });
        } else if (nextRide.status === 'cancelled') {
          router.replace('/passenger-home');
        }
      },
      () => setError('Não foi possível carregar a corrida.')
    );
  }, [rideId, router]);

  async function handleCancel() {
    if (!rideId || busy) return;
    setBusy(true);
    setError('');
    try {
      await cancelRide(rideId, 'passageiro_cancelou');
      router.replace('/passenger-home');
    } catch (e) {
      setError(e?.message || 'Não foi possível cancelar a corrida.');
    } finally {
      setBusy(false);
    }
  }

  const driver = ride?.acceptedDriverPublic || {};
  const canCancel = ride && ['assigned', 'driver_arrived'].includes(ride.status);
  const canPay = ride && ['awaiting_payment', 'payment_marked_sent'].includes(ride.status);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Sua corrida" onBack={() => router.back()} />

        {!rideId ? (
          <AppCard><Text style={[{ fontFamily, color: colors.danger }, typography.small]}>Corrida inválida.</Text></AppCard>
        ) : null}

        {ride ? (
          <>
            <AppCard>
              <AdminTableRow label="Status" value={STATUS_LABELS[ride.status] || 'Atualizando corrida…'} />
              <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
                O MVP não exibe rastreamento ao vivo. O status é atualizado pelo backend.
              </Text>
            </AppCard>

            <AppCard>
              <AdminTableRow label="Motorista" value={driver.name || 'Motorista DriveLocal'} />
              <AdminTableRow label="Veículo" value={VEHICLE_LABELS_PT_BR[driver.vehicleType || ride.vehicleType] || '—'} />
              <AdminTableRow label="Modelo" value={[driver.vehicleMake, driver.vehicleModel, driver.vehicleColor].filter(Boolean).join(' ') || '—'} />
              <AdminTableRow label="Placa" value={driver.vehiclePlate || '—'} />
              <AdminTableRow label="Origem" value={ride.pickup?.label || '—'} />
              <AdminTableRow label="Destino" value={ride.destination?.label || '—'} />
              <AdminTableRow label="Preço" value={formatBRL(ride.finalFareCentavos ?? ride.estimatedFareCentavos)} />
            </AppCard>

            {canPay ? (
              <AppButton
                title="Abrir pagamento Pix"
                onPress={() => router.push({ pathname: '/pix-payment', params: { rideId } })}
              />
            ) : null}
            {canCancel ? (
              <AppButton title={busy ? 'Cancelando…' : 'Cancelar corrida'} variant="ghost" onPress={handleCancel} disabled={busy} />
            ) : null}
          </>
        ) : rideId ? (
          <AppCard><Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>Carregando corrida…</Text></AppCard>
        ) : null}

        {error ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
