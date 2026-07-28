// Passenger ride history (route "/passenger-history").
// Reads only rides owned by the authenticated passenger and keeps the V1 query
// bounded. Active rides stay on the dashboard recovery card, not in this list.

import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { getPassengerRideHistory } from '../../services/passengerService';
import { logRideClientEvent } from '../../utils/clientRideLog';
import {
  formatCentavosBRL,
  formatPassengerRideDate,
  passengerRideFareCentavos,
  passengerRidePointLabel,
  passengerRideStatusLabel,
  passengerRideVehicleLabel,
  sortPassengerRideHistory,
} from '../../utils/passengerDashboardPolicy';

function RideHistoryCard({ ride }) {
  const fareCentavos = passengerRideFareCentavos(ride);
  return (
    <AppCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            {passengerRideVehicleLabel(ride.vehicleType)} · {passengerRideStatusLabel(ride.status)}
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            {formatPassengerRideDate(ride)}
          </Text>
        </View>
        <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
          {formatCentavosBRL(fareCentavos)}
        </Text>
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          Origem
        </Text>
        <Text style={[{ fontFamily, color: colors.text }, typography.body]}>
          {passengerRidePointLabel(ride.pickup, 'Origem não disponível')}
        </Text>
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          Destino
        </Text>
        <Text style={[{ fontFamily, color: colors.text }, typography.body]}>
          {passengerRidePointLabel(ride.destination, 'Destino não disponível')}
        </Text>
      </View>
    </AppCard>
  );
}

export default function PassengerHistory() {
  const router = useRouter();
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async ({ refresh = false } = {}) => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      router.replace('/');
      return;
    }

    const startedAt = Date.now();
    setError('');
    if (refresh) setRefreshing(true);
    else setLoading(true);

    logRideClientEvent('ride.passenger_history.load_started', {
      route: '/passenger-history',
      action: refresh ? 'refresh' : 'getPassengerRideHistory',
    });

    try {
      const result = await getPassengerRideHistory(uid);
      const sorted = sortPassengerRideHistory(result);
      setRides(sorted);
      logRideClientEvent('ride.passenger_history.load_succeeded', {
        route: '/passenger-history',
        itemCount: sorted.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (loadError) {
      setError('Não foi possível carregar seu histórico agora. Puxe a tela para tentar novamente.');
      logRideClientEvent('ride.passenger_history.load_failed', {
        route: '/passenger-history',
        durationMs: Date.now() - startedAt,
        error: loadError,
      }, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadHistory({ refresh: true })}
          />
        )}
      >
        <Header
          title="Histórico de corridas"
          subtitle="Suas corridas concluídas ou encerradas"
          onBack={() => router.back()}
        />

        {loading ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>
              Carregando seu histórico…
            </Text>
          </AppCard>
        ) : null}

        {!loading && !error && rides.length === 0 ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
              Nenhuma corrida no histórico
            </Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Quando uma corrida for concluída ou encerrada, ela aparecerá aqui.
            </Text>
          </AppCard>
        ) : null}

        {!loading ? rides.map((ride) => (
          <RideHistoryCard key={ride.rideId} ride={ride} />
        )) : null}

        {error ? (
          <>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
            <AppButton
              title="TENTAR NOVAMENTE"
              variant="secondary"
              haptic="light"
              pressScale
              onPress={() => loadHistory()}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
