// Completed ride screen (route "/ride-completed"). Displays only the
// passenger's real completed ride document; no mock fare or addresses.

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
import { listenToRide } from '../../services/ridesService';
import { formatBRL } from '../../utils/format';

export default function RideCompleted() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const [ride, setRide] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!rideId) return undefined;
    return listenToRide(
      rideId,
      (nextRide) => nextRide && setRide(nextRide),
      () => setError('Não foi possível carregar a corrida finalizada.')
    );
  }, [rideId]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Corrida finalizada" subtitle="Obrigado por viajar com a DriveLocal!" />
        {ride ? (
          <AppCard>
            <AdminTableRow label="Origem" value={ride.pickup?.label || '—'} />
            <AdminTableRow label="Destino" value={ride.destination?.label || '—'} />
            <AdminTableRow label="Valor pago" value={formatBRL(ride.finalFareCentavos ?? ride.paymentAmountCentavos ?? ride.estimatedFareCentavos)} />
            <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
            <AdminTableRow label="Status" value={ride.status === 'completed' ? 'Concluída' : 'Atualizando…'} />
          </AppCard>
        ) : (
          <AppCard>
            <Text style={[{ fontFamily, color: error ? colors.danger : colors.textMuted }, typography.small]}>
              {error || (rideId ? 'Carregando corrida…' : 'Corrida inválida.')}
            </Text>
          </AppCard>
        )}
        <AppButton title="Voltar ao início" onPress={() => router.replace('/passenger-home')} />
      </ScrollView>
    </SafeAreaView>
  );
}
