// Passenger account data (route "/passenger-profile").
// V1 remains read-only for profile data and centralizes privacy plus safe sign-out.

import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { logoutUser } from '../../services/authService';
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
  const [signingOut, setSigningOut] = useState(false);
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
      .then((profileData) => {
        setPassenger(profileData);
        logRideClientEvent('ride.passenger_profile.load_succeeded', {
          route: '/passenger-profile',
          status: profileData ? 'profile_found' : 'profile_missing',
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

  async function confirmLogout() {
    if (signingOut) return;
    setError('');

    const uid = auth.currentUser?.uid;
    if (!uid) {
      router.replace('/');
      return;
    }

    let currentProfile = passenger;
    try {
      currentProfile = await getPassenger(uid);
      setPassenger(currentProfile);
    } catch (profileError) {
      setError('Não foi possível verificar sua corrida ativa. Tente novamente.');
      logRideClientEvent('ride.passenger_profile.logout_guard_failed', {
        route: '/passenger-profile',
        action: 'getPassenger',
        error: profileError,
      }, 'warning');
      return;
    }

    logRideClientEvent('ride.passenger_profile.logout_confirmation_opened', {
      route: '/',
      action: 'logoutUser',
      status: currentProfile?.activeRideId ? 'active_ride_present' : 'ready',
    });

    if (currentProfile?.activeRideId) {
      Alert.alert(
        'Corrida em andamento',
        'Finalize ou cancele a corrida antes de sair da conta.'
      );
      return;
    }

    Alert.alert(
      'Sair da conta?',
      'Você precisará informar seu e-mail e sua senha para entrar novamente.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sair', style: 'destructive', onPress: performLogout },
      ]
    );
  }

  async function performLogout() {
    if (signingOut) return;
    setSigningOut(true);
    const startedAt = Date.now();

    logRideClientEvent('ride.passenger_profile.logout_started', {
      route: '/',
      action: 'logoutUser',
    });

    try {
      await logoutUser();
      logRideClientEvent('ride.passenger_profile.logout_succeeded', {
        route: '/',
        action: 'router.replace',
        durationMs: Date.now() - startedAt,
      });
      router.replace('/');
    } catch (logoutError) {
      setError(logoutError?.message || 'Não foi possível sair da conta agora.');
      logRideClientEvent('ride.passenger_profile.logout_failed', {
        route: '/passenger-profile',
        action: 'logoutUser',
        durationMs: Date.now() - startedAt,
        error: logoutError,
      }, 'error');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 }}>
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

        <AppButton
          title={signingOut ? 'SAINDO…' : 'SAIR DA CONTA'}
          variant="danger"
          haptic="warning"
          disabled={signingOut || loading}
          onPress={confirmLogout}
        />

        {passenger?.activeRideId ? (
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Para proteger sua corrida, a troca de conta fica bloqueada enquanto ela estiver ativa.
          </Text>
        ) : null}

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
