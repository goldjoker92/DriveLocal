// Passenger home (route "/passenger-home").
// This is the authenticated dashboard, not the ride form. It keeps active-ride
// recovery server-driven and sends a new request to the dedicated /request-ride flow.

import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import PassengerActiveRideDashboardCard from '../../components/PassengerActiveRideDashboardCard';
import PassengerRideRequestCta from '../../components/PassengerRideRequestCta';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { PUBLIC_POLICY_LINKS } from '../../config/publicPolicyLinks';
import { logoutUser } from '../../services/authService';
import { listenToPassenger } from '../../services/passengerService';
import { listenToRide, listenToRideLocation } from '../../services/ridesService';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { getPassengerFirstName } from '../../utils/passengerDashboardPolicy';

function activeRideRoute(ride) {
  const rideId = ride?.rideId;
  if (!rideId) return null;

  if (ride.status === 'searching' || ride.status === 'no_driver_available' || ride.status === 'dispatch_failed') {
    return { pathname: '/searching', params: { rideId } };
  }
  if (['assigned', 'driver_arrived', 'in_progress'].includes(ride.status)) {
    return { pathname: '/driver-accepted', params: { rideId } };
  }
  if (['awaiting_payment', 'payment_marked_sent', 'disputed'].includes(ride.status)) {
    return { pathname: '/pix-payment', params: { rideId } };
  }
  if (ride.status === 'completed') {
    return { pathname: '/ride-completed', params: { rideId } };
  }
  return { pathname: '/searching', params: { rideId } };
}

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
      style={({ pressed }) => [
        styles.menuRow,
        last && styles.menuRowLast,
        pressed && styles.menuRowPressed,
      ]}
    >
      <Text style={[styles.menuLabel, destructive && styles.menuLabelDanger]}>{label}</Text>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={styles.chevron}
      >
        ›
      </Text>
    </Pressable>
  );
}

function DashboardSection({ title, children }) {
  return (
    <AppCard style={styles.sectionCard}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </AppCard>
  );
}

export default function PassengerHome() {
  const router = useRouter();
  const [passenger, setPassenger] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [activeRide, setActiveRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      router.replace('/passenger-register');
      return undefined;
    }

    const startedAt = Date.now();
    logRideClientEvent('ride.passenger_home.load_started', {
      route: '/passenger-home',
      action: 'listenToPassenger',
    });

    return listenToPassenger(
      uid,
      (profile, metadata) => {
        setProfileLoading(false);
        if (!profile) {
          router.replace('/passenger-register');
          return;
        }

        setPassenger(profile);
        setError('');
        logRideClientEvent('ride.passenger_home.profile_received', {
          route: '/passenger-home',
          rideId: profile.activeRideId || null,
          status: profile.activeRideId ? 'active_ride_present' : 'ready',
          provider: metadata?.fromCache ? 'cache' : 'server',
          durationMs: Date.now() - startedAt,
        });
      },
      (loadError) => {
        setProfileLoading(false);
        setError('Não foi possível atualizar sua conta. Tente novamente.');
        logRideClientEvent('ride.passenger_home.profile_failed', {
          route: '/passenger-home',
          error: loadError,
          durationMs: Date.now() - startedAt,
        }, 'error');
      }
    );
  }, [router]);

  const activeRideId = passenger?.activeRideId || null;

  useEffect(() => {
    setActiveRide(null);
    setDriverLocation(null);
    if (!activeRideId) return undefined;

    return listenToRide(
      activeRideId,
      (ride) => {
        setActiveRide(ride);
        if (ride) {
          logRideClientEvent('ride.passenger_home.active_received', {
            route: '/passenger-home',
            rideId: ride.rideId,
            status: ride.status,
          });
        }
      },
      (rideError) => {
        setError('Não foi possível atualizar sua corrida ativa.');
        logRideClientEvent('ride.passenger_home.active_failed', {
          route: '/passenger-home',
          rideId: activeRideId,
          error: rideError,
        }, 'error');
      }
    );
  }, [activeRideId]);

  useEffect(() => {
    if (!activeRideId) return undefined;
    return listenToRideLocation(
      activeRideId,
      setDriverLocation,
      () => setDriverLocation(null)
    );
  }, [activeRideId]);

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

  function openSupportCenter() {
    setError('');
    logRideClientEvent('ride.passenger_home.menu_selected', {
      route: '/support-center',
      action: 'open_support',
    });
    router.push({
      pathname: '/support-center',
      params: { source: 'passenger_home' },
    });
  }

  function openPrivacyCenter() {
    setError('');
    logRideClientEvent('ride.passenger_home.menu_selected', {
      route: '/privacy-center',
      action: 'open_account_deletion',
    });
    router.push('/privacy-center');
  }

  function openActiveRide() {
    const target = activeRideRoute(activeRide || { rideId: activeRideId, status: 'searching' });
    if (!target) return;

    logRideClientEvent('ride.passenger_home.resume_selected', {
      route: target.pathname,
      action: 'router.push',
      rideId: activeRideId,
      status: activeRide?.status || 'searching',
    });
    router.push(target);
  }

  async function openPolicyLink(url, label, action) {
    setError('');
    const startedAt = Date.now();
    logRideClientEvent('ride.passenger_home.policy_link_started', {
      route: 'external_https',
      action,
    });

    if (!url) {
      setError(`${label} ainda não está disponível.`);
      logRideClientEvent('ride.passenger_home.policy_link_failed', {
        route: 'external_https',
        action,
        status: 'not_configured',
      }, 'warning');
      return;
    }

    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('unsupported_url');
      await Linking.openURL(url);
      logRideClientEvent('ride.passenger_home.policy_link_succeeded', {
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
      status: activeRideId ? 'active_ride_present' : 'ready',
    });

    if (activeRideId) {
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
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Header
          title={`Olá, ${firstName} 👋`}
          subtitle="Pronto para sua próxima corrida?"
        />

        {activeRideId ? (
          activeRide ? (
            <PassengerActiveRideDashboardCard
              ride={activeRide}
              driverLocation={driverLocation}
              onOpen={openActiveRide}
            />
          ) : (
            <AppCard style={styles.activeLoadingCard}>
              <Text style={styles.activeTitle}>Você tem uma corrida em andamento</Text>
              <Text style={styles.mutedText}>Carregando o estado mais recente…</Text>
              <AppButton
                title="ACOMPANHAR CORRIDA"
                variant="secondary"
                haptic="medium"
                onPress={openActiveRide}
              />
            </AppCard>
          )
        ) : (
          <PassengerRideRequestCta
            loading={profileLoading}
            disabled={signingOut || !passenger}
            onPress={openRideRequest}
          />
        )}

        <DashboardSection title="MINHA CONTA">
          <DashboardRow
            label="Meus dados"
            onPress={() => navigate('/passenger-profile', 'open_profile')}
          />
          <DashboardRow
            label="Histórico de corridas"
            last
            onPress={() => navigate('/passenger-ride-history', 'open_history')}
          />
        </DashboardSection>

        <DashboardSection title="AJUDA E INFORMAÇÕES">
          <DashboardRow
            label="Central de suporte"
            onPress={openSupportCenter}
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
            onPress={openPrivacyCenter}
          />
        </DashboardSection>

        <AppButton
          title={signingOut ? 'SAINDO…' : 'SAIR DA CONTA'}
          variant="danger"
          haptic="warning"
          disabled={signingOut}
          onPress={confirmLogout}
        />

        {activeRideId ? (
          <Text style={styles.mutedText}>
            Para proteger sua corrida, a troca de conta fica bloqueada enquanto ela estiver ativa.
          </Text>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    flexGrow: 1,
  },
  activeLoadingCard: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  activeTitle: {
    fontFamily,
    color: colors.text,
    ...typography.bodyBold,
  },
  sectionCard: {
    gap: 0,
    paddingTop: spacing.md,
    paddingBottom: 0,
  },
  sectionLabel: {
    fontFamily,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    ...typography.small,
  },
  menuRow: {
    minHeight: 52,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuRowPressed: {
    opacity: 0.68,
  },
  menuLabel: {
    flex: 1,
    fontFamily,
    color: colors.text,
    ...typography.body,
  },
  menuLabelDanger: {
    color: colors.danger,
  },
  chevron: {
    fontFamily,
    color: colors.textFaint,
    ...typography.bodyBold,
  },
  mutedText: {
    fontFamily,
    color: colors.textMuted,
    ...typography.small,
  },
  errorText: {
    fontFamily,
    color: colors.danger,
    ...typography.small,
  },
});
