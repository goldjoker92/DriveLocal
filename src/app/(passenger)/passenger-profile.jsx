// Passenger account data (route "/passenger-profile").
// V1 is read-only: profile mutation needs its own validated Firestore/backend flow.

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
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
import { goBackOrReplace } from '../../utils/navigation';

function DataRow({ label, value }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{label}</Text>
      <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
        {value || 'Não informado'}
      </Text>
    </View>
  );
}

export default function PassengerProfile() {
  const router = useRouter();
  const [passenger, setPassenger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      router.replace('/');
      return;
    }

    const startedAt = Date.now();
    logRideClientEvent('ride.passenger_profile.load_started', {
      route: '/passenger-profile',
      action: 'getPassenger',
    });

    getPassenger(uid)
      .then((profile) => {
        setPassenger(profile);
        logRideClientEvent('ride.passenger_profile.load_succeeded', {
          route: '/passenger-profile',
          status: profile ? 'profile_found' : 'profile_missing',
          durationMs: Date.now() - startedAt,
        });
      })
      .catch((loadError) => {
        setError('Não foi possível carregar seus dados agora.');
        logRideClientEvent('ride.passenger_profile.load_failed', {
          route: '/passenger-profile',
          durationMs: Date.now() - startedAt,
          error: loadError,
        }, 'error');
      })
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Meus dados"
          subtitle="Informações cadastradas na sua conta"
          onBack={() => goBackOrReplace(router, '/passenger-home')}
        />

        <AppCard>
          {loading ? (
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.body]}>
              Carregando seus dados…
            </Text>
          ) : (
            <>
              <DataRow label="Nome" value={passenger?.fullName} />
              <DataRow label="E-mail" value={passenger?.email || auth.currentUser?.email} />
              <DataRow label="WhatsApp" value={passenger?.whatsApp} />
              <DataRow label="Cidade de atendimento" value="Horizonte / CE" />
            </>
          )}
        </AppCard>

        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          Para corrigir ou excluir dados pessoais, use o centro de privacidade. Alterações de cadastro serão adicionadas em um fluxo dedicado e seguro.
        </Text>

        <AppButton
          title="PRIVACIDADE E CONTA"
          variant="ghost"
          haptic="selection"
          onPress={() => {
            logRideClientEvent('ride.passenger_profile.privacy_selected', {
              route: '/privacy-center',
              action: 'router.push',
            });
            router.push('/privacy-center');
          }}
        />

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
