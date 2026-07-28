// Passenger home (route "/passenger-home").
// Compact passenger dashboard: greeting, active-ride recovery, ride request,
// account/history access, support/legal information and safe sign-out.

import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { PUBLIC_POLICY_LINKS } from '../../config/publicPolicyLinks';
import { getPassenger } from '../../services/passengerService';
import { logoutUser } from '../../services/authService';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { getPassengerFirstName } from '../../utils/passengerDashboardPolicy';

function DashboardRow({ label, onPress, last = false, destructive = false }) {
  function handlePress() {
    Haptics.selectionAsync().catch(() => undefined);
    onPress();
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handlePress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingVertical: spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        opacity: pressed ? 0.68 : 1,
      })}
    >
      <Text
        style={[
          { fontFamily, color: destructive ? colors.danger : colors.text },
          typography.body,
        ]}
      >
        {label}
      </Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[{ fontFamily, color: colors.textFaint }, typography.bodyBold]}
      >
        ›
      </Text>
    </Pressable>
  );
}

function DashboardSection({ title, children }) {
  return (
    <AppCard style={{ gap: 0 }}>
      <Text
        style={[
          { fontFamily, color: colors.textMuted, marginBottom: spacing.xs },
          typography.small,
        ]}
      >
        {title}
      </Text>
      {children}
    </AppCard>
  );
}

export default function PassengerHome() {
  const router = useRouter();
  const [passenger, setPassenger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      router.replace('/passenger-register');
      return;
    }

    const startedAt = Date.now();
    logRideClientEvent('ride.passenger_home.load_started', {
      route: '/passenger-home',
      action: 'getPassenger',
    });

    getPassenger(uid)
      .then((profile) => {
        setPassenger(profile);
        logRideClientEvent('ride.passenger_home.loaded', {
          route: '/passenger-home',
          rideId: profile?.activeRideId || null,
          status: profile?.activeRideId ? 'active_ride_present' : 'ready',
          durationMs: Date.now() - startedAt,
        });
      })
      .catch((loadError) => {
        logRideClientEvent('ride.passenger_home.load_failed', {
          route: '/passenger-home',
          durationMs: Date.now() - startedAt,
          error: loadError,
        }, 'error');
        setError('Não foi possível carregar sua conta. Tente novamente.');
      })
      .finally(() => setLoading(false));
  }, [router]);

  function navigate(route, action) {
    setError('');
    logRideClientEvent('ride.passenger_home.menu_selected', {
      route,
      action,
    });
    router.push(route);
  }

  function openRideRequest() {
    logRideClientEvent('ride.passenger_home.request_selected', {
      route: '/request-ride',
      action: 'router.push',
    });
    router.push('/request-ride');
  }

  function resumeActiveRide() {
    if (!passenger?.activeRideId) return;
    logRideClientEvent('ride.passenger_home.resume_selected', {
      route: '/searching',
      action: 'router.push',
      rideId: passenger.activeRideId,
    });
    router.push({ pathname: '/searching', params: { rideId: passenger.activeRideId } });
  }

  async function openPolicyLink(url, label, action) {
    setError('');
    const startedAt = Date.now();
    logRideClientEvent('ride.passenger_home.policy_link_started', {
      route: 'external_https',
      action,
    });

    if (!url) {
      const message = `${label} ainda não está disponível.`;
      setError(message);
      logRideClientEvent('ride.passenger_home.policy_link_failed', {
        route: 'external_https',
        action,
        status: 'not_configured',
        durationMs: Date.now() - startedAt,
      }, 'warning');
      return;
    }

    try {
      await Linking.openURL(url);
      logRideClientEvent('ride.passenger_home.policy_link_opened', {
        route: 'external_https',
        action,
        durationMs: Date.now() - startedAt,
      });
    } catch (linkError) {
      setError(`Não foi possível abrir ${label.toLowerCase()} agora.`);
      logRideClientEvent('ride.passenger_home.policy_link_failed', {
        route: 'external_https',
        action,
        durationMs: Date.now() - startedAt,
        error: linkError,
      }, 'error');
    }
  }

  function confirmLogout() {
    setError('');
    logRideClientEvent('ride.passenger_home.logout_confirmation_opened', {
      route: '/',
      action: 'logoutUser',
      status: passenger?.activeRideId ? 'active_ride_present' : 'ready',
    });
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
    logRideClientEvent('ride.passenger_home.logout_started', {
      route: '/',
      action: 'logoutUser',
    });

    try {
      await logoutUser();
      logRideClientEvent('ride.passenger_home.logout_succeeded', {
        route: '/',
        action: 'router.replace',
        durationMs: Date.now() - startedAt,
      });
      router.replace('/');
    } catch (logoutError) {
      setError(logoutError?.message || 'Não foi possível sair da conta agora.');
      logRideClientEvent('ride.passenger_home.logout_failed', {
        route: '/passenger-home',
        action: 'logoutUser',
        durationMs: Date.now() - startedAt,
        error: logoutError,
      }, 'error');
    } finally {
      setSigningOut(false);
    }
  }

  const firstName = getPassengerFirstName(passenger, auth.currentUser);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title={`Olá, ${firstName} 👋`}
          subtitle="Pronto para sua próxima corrida?"
        />

        {passenger?.activeRideId ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
              Você tem uma corrida em andamento
            </Text>
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Continue acompanhando a busca, o motorista ou o pagamento.
            </Text>
            <AppButton
              title="ACOMPANHAR CORRIDA"
              variant="secondary"
              haptic="medium"
              pressScale
              onPress={resumeActiveRide}
            />
          </AppCard>
        ) : null}

        <AppButton
          title={loading ? 'CARREGANDO CONTA…' : 'PEDIR CORRIDA'}
          haptic="medium"
          pressScale
          disabled={loading || signingOut}
          onPress={openRideRequest}
        />

        <DashboardSection title="MINHA CONTA">
          <DashboardRow
            label="Meus dados"
            onPress={() => navigate('/passenger-profile', 'open_profile')}
          />
          <DashboardRow
            label="Histórico de corridas"
            last
            onPress={() => navigate('/passenger-history', 'open_history')}
          />
        </DashboardSection>

        <DashboardSection title="AJUDA E INFORMAÇÕES">
          <DashboardRow
            label="Central de suporte"
            onPress={() => navigate('/support-center', 'open_support')}
          />
          <DashboardRow
            label="Política de Privacidade"
            onPress={() => openPolicyLink(
              PUBLIC_POLICY_LINKS.privacyPolicyUrl,
              'Política de Privacidade',
              'open_privacy_policy'
            )}
          />
          <DashboardRow
            label="Termos de Uso"
            onPress={() => openPolicyLink(
              PUBLIC_POLICY_LINKS.termsOfUseUrl,
              'Termos de Uso',
              'open_terms_of_use'
            )}
          />
          <DashboardRow
            label="Excluir conta e dados"
            destructive
            last
            onPress={() => {
              logRideClientEvent('ride.passenger_home.menu_selected', {
                route: '/privacy-center',
                action: 'open_account_deletion',
              });
              router.push('/privacy-center');
            }}
          />
        </DashboardSection>

        <AppButton
          title={signingOut ? 'SAINDO…' : 'SAIR DA CONTA'}
          variant="danger"
          haptic="warning"
          pressScale
          disabled={signingOut}
          onPress={confirmLogout}
        />

        {error ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
