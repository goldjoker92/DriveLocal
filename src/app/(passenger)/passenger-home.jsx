// Passenger home (route "/passenger-home").
// Clean passenger entry point: no placeholder map and no duplicate ride form.
// An existing activeRideId is recoverable after restart through /searching, which
// routes to the correct assigned/payment/completed screen from backend status.

import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { getPassenger } from '../../services/passengerService';
import { logRideClientEvent } from '../../utils/clientRideLog';

export default function PassengerHome() {
  const router = useRouter();
  const [passenger, setPassenger] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      router.replace('/passenger-register');
      return;
    }

    getPassenger(uid)
      .then((profile) => {
        setPassenger(profile);
        logRideClientEvent('ride.passenger_home.loaded', {
          rideId: profile?.activeRideId || null,
          status: profile?.activeRideId ? 'active_ride_present' : 'ready',
        });
      })
      .catch((loadError) => {
        logRideClientEvent('ride.passenger_home.load_failed', { error: loadError }, 'error');
        setError('Não foi possível carregar sua conta.');
      });
  }, [router]);

  function openRideRequest() {
    logRideClientEvent('ride.passenger_home.request_selected', { action: 'router.push' });
    router.push('/request-ride');
  }

  function resumeActiveRide() {
    if (!passenger?.activeRideId) return;
    logRideClientEvent('ride.passenger_home.resume_selected', {
      action: 'router.push',
      rideId: passenger.activeRideId,
    });
    router.push({ pathname: '/searching', params: { rideId: passenger.activeRideId } });
  }

  const displayName = passenger?.fullName || 'Passageiro';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        {/* Home is a navigation root, so it deliberately has no GO_BACK action. */}
        <Header title="DriveLocal" subtitle={`${displayName} · Horizonte / CE`} />

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.h2]}>
            Corridas locais em Horizonte
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>
            Informe origem e destino, escolha moto ou carro e veja o preço estimado antes da busca.
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Embarque e destino permanecem dentro de Horizonte. Pagamento direto por Pix ao motorista.
          </Text>
        </AppCard>

        {passenger?.activeRideId ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
              Você tem uma corrida em andamento
            </Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Continue acompanhando a busca, o motorista ou o pagamento.
            </Text>
            <AppButton title="Acompanhar corrida" onPress={resumeActiveRide} />
          </AppCard>
        ) : null}

        <AppButton title="Pedir corrida" onPress={openRideRequest} />

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            Ajuda e suporte
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Abra uma solicitação por categoria e acompanhe o status sem compartilhar dados pessoais.
          </Text>
          <AppButton
            title="ABRIR SUPORTE"
            variant="secondary"
            onPress={() => router.push({
              pathname: '/support-center',
              params: { source: 'passenger_home' },
            })}
          />
        </AppCard>

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            Conta e privacidade
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Consulte seus dados, a política de privacidade e a exclusão da conta.
          </Text>
          <AppButton
            title="PRIVACIDADE E CONTA"
            variant="ghost"
            onPress={() => router.push('/privacy-center')}
          />
        </AppCard>

        {error ? <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}