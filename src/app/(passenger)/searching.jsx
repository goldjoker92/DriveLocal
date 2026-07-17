// Searching for a driver (route "/searching"). Reflects the passenger's real
// server-owned ride status. Cancellation calls the secure backend before leaving.

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
import { listenToRide, cancelRide } from '../../services/ridesService';

const STATUS_LABEL = {
  searching: 'Procurando motorista…',
  assigned: 'Motorista a caminho!',
  no_driver_available: 'Nenhum motorista disponível no momento.',
  dispatch_failed: 'Não foi possível procurar motoristas. Tente novamente.',
  cancelled: 'Corrida cancelada.',
};

export default function Searching() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const [status, setStatus] = useState('searching');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!rideId) return undefined;
    return listenToRide(
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
  }, [rideId, router]);

  async function handleCancel() {
    if (!rideId || busy) return;
    setBusy(true);
    setError('');
    try {
      await cancelRide(rideId, 'passageiro_cancelou_busca');
      router.replace('/passenger-home');
    } catch (e) {
      setError(e?.message || 'Não foi possível cancelar a corrida.');
    } finally {
      setBusy(false);
    }
  }

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
        {searching ? (
          <AppButton title={busy ? 'Cancelando…' : 'Cancelar corrida'} variant="ghost" onPress={handleCancel} disabled={busy} />
        ) : (
          <AppButton title="Voltar ao início" variant="ghost" onPress={() => router.replace('/passenger-home')} />
        )}
        {error ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
