// Passenger home (route "/passenger-home").
// This authenticated dashboard keeps active-ride recovery server-driven, opens the
// dedicated ride form and refreshes the three most recent secure history projections.

import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import PassengerActiveRideDashboardCard from '../../components/PassengerActiveRideDashboardCard';
import PassengerRideHistoryRow from '../../components/PassengerRideHistoryRow';
import PassengerRideRequestCta from '../../components/PassengerRideRequestCta';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { PUBLIC_POLICY_LINKS } from '../../config/publicPolicyLinks';
import { listenToPassenger } from '../../services/passengerService';
import { loadPassengerRideHistoryPage } from '../../services/passengerRideHistoryService';
import { listenToRide, listenToRideLocation } from '../../services/ridesService';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { getPassengerFirstName } from '../../utils/passengerDashboardPolicy';
import { normalizePassengerHistoryPage } from '../../utils/passengerRideHistory';

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
  const [recentHistory, setRecentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
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

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const startedAt = Date.now();
      setHistoryLoading(true);

      loadPassengerRideHistoryPage({ limit: 3 })
        .then((snapshot) => {
          if (!active) return;
          const page = normalizePassengerHistoryPage(snapshot);
          setRecentHistory(page.items.slice(0, 3));
          setHistoryError('');
          logRideClientEvent('ride.passenger_home.recent_history_received', {
            route: '/passenger-home',
            action: 'loadPassengerRideHistoryPage',
            status: 'ready',
            durationMs: Date.now() - startedAt,
          });
        })
        .catch((historyLoadError) => {
          if (!active) return;
          setHistoryError('Não foi possível carregar suas últimas corridas.');
          logRideClientEvent('ride.passenger_home.recent_history_failed', {
            route: '/passenger-home',
            action: 'loadPassengerRideHistoryPage',
            error: historyLoadError,
            durationMs: Date.now() - startedAt,
          }, 'warning');
        })
        .finally(() => {
          if (active) setHistoryLoading(false);
        });

      return () => {
        active = false;
      };
    }, [activeRideId])
  );

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
            disabled={!passenger}
            onPress={openRideRequest}
          />
        )}

        <AppCard style={styles.historyCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.historyEyebrow}>ÚLTIMAS CORRIDAS</Text>
              <Text style={styles.historyTitle}>Suas 3 corridas mais recentes</Text>
            </View>
          </View>

          {historyLoading ? (
            <Text style={styles.mutedText}>Carregando histórico real…</Text>
          ) : historyError ? (
            <View style={styles.inlineError}>
              <Text style={styles.errorText}>{historyError}</Text>
              <AppButton
                title="ABRIR HISTÓRICO"
                variant="ghost"
                onPress={() => navigate('/passenger-ride-history', 'open_history_after_error')}
              />
            </View>
          ) : recentHistory.length > 0 ? (
            <View style={styles.historyList}>
              {recentHistory.map((item) => (
                <PassengerRideHistoryRow
                  key={item.rideId}
                  item={item}
                  compact
                  onPress={() => navigate('/passenger-ride-history', 'open_recent_ride')}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.mutedText}>
              Suas solicitações aparecerão aqui depois da primeira corrida.
            </Text>
          )}

          <AppButton
            title="VER HISTÓRICO COMPLETO"
            variant="ghost"
            haptic="selection"
            onPress={() => navigate('/passenger-ride-history', 'open_full_history')}
          />
        </AppCard>

        <DashboardSection title="MINHA CONTA">
          <DashboardRow
            label="Meus dados"
            last
            onPress={() => navigate('/passenger-profile', 'open_profile')}
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
  historyCard: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  historyEyebrow: {
    fontFamily,
    color: colors.primary,
    ...typography.caption,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  historyTitle: {
    fontFamily,
    color: colors.text,
    ...typography.h3,
  },
  historyList: {
    gap: spacing.sm,
  },
  inlineError: {
    gap: spacing.sm,
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
