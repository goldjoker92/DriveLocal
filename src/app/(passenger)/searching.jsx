// Searching for a driver (route "/searching"). Listens to the passenger's own
// ride document (secured by BLOCK 04 Rules) and reflects the real backend status.
// No fake "driver accepted" simulation — the transition is driven by the ride's
// server-owned status.

import { useEffect, useState } from 'react';
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
import { listenToRide } from '../../services/ridesService';

// PT-BR status labels for the passenger.
const STATUS_LABEL = {
  searching: 'Procurando motorista…',
  assigned: 'Motorista a caminho!',
  no_driver_available: 'Nenhum motorista disponível no momento.',
  dispatch_failed: 'Não foi possível procurar motoristas. Tente novamente.',
};

export default function Searching() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const [status, setStatus] = useState('searching');

  useEffect(() => {
    if (!rideId) return undefined;
    const unsubscribe = listenToRide(
      rideId,
      (ride) => {
        if (!ride) return;
        setStatus(ride.status);
        if (ride.status === 'assigned') {
          router.replace({ pathname: '/driver-accepted', params: { rideId } });
        }
      },
      () => setStatus('dispatch_failed')
    );
    return unsubscribe;
  }, [rideId, router]);

  const searching = status === 'searching';
  const label = STATUS_LABEL[status] || STATUS_LABEL.searching;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Procurando motorista" subtitle="Aguarde um momento…" onBack={() => router.back()} />
        <AppCard>
          <View style={{ alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.md }}>
            {searching ? <ActivityIndicator size="large" color={colors.primary} /> : null}
            <Text style={[{ fontFamily, color: colors.text, textAlign: 'center' }, typography.bodyBold]}>
              {label}
            </Text>
          </View>
        </AppCard>
        {!rideId ? <AdminTableRow label="Nenhuma corrida ativa." /> : null}
        <AppButton title="Cancelar" variant="ghost" onPress={() => router.replace('/passenger-home')} />
      </ScrollView>
    </SafeAreaView>
  );
}
