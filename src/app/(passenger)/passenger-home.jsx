// Passenger dashboard (route "/passenger-home"). The server-owned activeRideId is
// listened to in real time. An active ride always has visual priority; otherwise the
// passenger gets a compact request launcher and recent secure history.

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import PassengerActiveRideDashboardCard from '../../components/PassengerActiveRideDashboardCard';
import PassengerRideHistoryRow from '../../components/PassengerRideHistoryRow';
import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import {
  VEHICLE_TYPES,
  VEHICLE_LABELS_PT_BR,
  VEHICLE_MOTO,
} from '../../constants/vehicleTypes';
import { auth } from '../../config/firebase';
import { listenToPassenger } from '../../services/passengerService';
import { loadPassengerRideHistoryPage } from '../../services/passengerRideHistoryService';
import { listenToRide, listenToRideLocation } from '../../services/ridesService';
import { logRideClientEvent } from '../../utils/clientRideLog';
import { normalizePassengerHistoryPage } from '../../utils/passengerRideHistory';

function passengerFirstName(passenger) {
  const value = typeof passenger?.fullName === 'string'
    ? passenger.fullName.normalize('NFKC').trim()
    : '';
  if (!value || value.includes('@')) return 'Passageiro';
  return value.split(/\s+/)[0] || 'Passageiro';
}

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

function VehiclePicker({ value, onChange }) {
  return (
    <View style={styles.vehicleRow}>
      {VEHICLE_TYPES.map((type) => {
        const selected = value === type;
        return (
          <Pressable
            key={type}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(type)}
            style={[styles.vehicleButton, selected && styles.vehicleButtonSelected]}
          >
            <Text style={styles.vehicleEmoji}>{type === 'moto' ? '🏍' : '🚗'}</Text>
            <Text style={[styles.vehicleText, selected && styles.vehicleTextSelected]}>
              {VEHICLE_LABELS_PT_BR[type]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function PassengerHome() {
  const router = useRouter();
  const [passenger, setPassenger] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [activeRide, setActiveRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [vehicleType, setVehicleType] = useState(VEHICLE_MOTO);
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
        logRideClientEvent('ride.passenger_dashboard.profile_received', {
          rideId: profile.activeRideId || null,
          status: profile.activeRideId ? 'active_ride_present' : 'ready',
          source: metadata?.fromCache ? 'cache' : 'server',
        });
      },
      (loadError) => {
        setProfileLoading(false);
        setError('Não foi possível atualizar sua conta.');
        logRideClientEvent('ride.passenger_dashboard.profile_failed', { error: loadError }, 'error');
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
          logRideClientEvent('ride.passenger_dashboard.active_received', {
            rideId: ride.rideId,
            status: ride.status,
          });
        }
      },
      (rideError) => {
        setError('Não foi possível atualizar sua corrida ativa.');
        logRideClientEvent('ride.passenger_dashboard.active_failed', {
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

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    loadPassengerRideHistoryPage({ limit: 3 })
      .then((snapshot) => {
        if (!active) return;
        const page = normalizePassengerHistoryPage(snapshot);
        setRecentHistory(page.items.slice(0, 3));
        setHistoryError('');
      })
      .catch(() => {
        if (!active) return;
        setHistoryError('Não foi possível carregar suas últimas corridas.');
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [activeRideId]);

  function continueRequest() {
    setError('');
    if (!originText.trim()) {
      setError('Informe o local de partida.');
      return;
    }
    if (!destinationText.trim()) {
      setError('Informe para onde você vai.');
      return;
    }
    router.push({
      pathname: '/request-ride',
      params: {
        originText: originText.trim(),
        destinationText: destinationText.trim(),
        vehicleType,
      },
    });
  }

  function openActiveRide() {
    const target = activeRideRoute(activeRide || { rideId: activeRideId, status: 'searching' });
    if (target) router.push(target);
  }

  const name = passengerFirstName(passenger);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Header title="DriveLocal" subtitle={`${name} · Horizonte / CE`} />

        {activeRideId ? (
          activeRide ? (
            <PassengerActiveRideDashboardCard
              ride={activeRide}
              driverLocation={driverLocation}
              onOpen={openActiveRide}
            />
          ) : (
            <AppCard style={styles.loadingCard}>
              <Text style={styles.eyebrow}>SUA CORRIDA</Text>
              <Text style={styles.sectionTitle}>Carregando o estado mais recente…</Text>
              <Text style={styles.mutedText}>
                A solicitação está protegida no servidor. Não faça outro pedido.
              </Text>
              <AppButton title="ACOMPANHAR CORRIDA" onPress={openActiveRide} />
            </AppCard>
          )
        ) : (
          <AppCard style={styles.requestCard}>
            <View style={styles.heroCopy}>
              <Text style={styles.greeting}>Olá 👋</Text>
              <Text style={styles.heroTitle}>Para onde vamos?</Text>
              <Text style={styles.mutedText}>
                Informe o trajeto agora. O preço será calculado pelo servidor antes da busca.
              </Text>
            </View>

            <AppInput
              label="📍 Local de partida"
              value={originText}
              onChangeText={setOriginText}
              placeholder="Rua, número, bairro ou ponto conhecido"
              autoCapitalize="words"
            />
            <AppInput
              label="🏁 Para onde?"
              value={destinationText}
              onChangeText={setDestinationText}
              placeholder="Destino dentro de Horizonte"
              autoCapitalize="words"
            />
            <VehiclePicker value={vehicleType} onChange={setVehicleType} />
            <AppButton title="CONTINUAR E VER PREÇO" onPress={continueRequest} />
            <Text style={styles.secureNote}>
              Pagamento direto por Pix ao motorista. Embarque e destino devem ficar em Horizonte.
            </Text>
          </AppCard>
        )}

        <AppCard style={styles.historyCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.eyebrow}>ÚLTIMAS 3 CORRIDAS</Text>
              <Text style={styles.sectionTitle}>Seu histórico recente</Text>
            </View>
            <AppButton
              title="VER TODAS"
              variant="ghost"
              onPress={() => router.push('/passenger-ride-history')}
            />
          </View>

          {historyLoading ? (
            <Text style={styles.mutedText}>Carregando histórico real…</Text>
          ) : historyError ? (
            <View style={styles.inlineError}>
              <Text style={styles.errorText}>{historyError}</Text>
              <AppButton
                title="ABRIR HISTÓRICO"
                variant="ghost"
                onPress={() => router.push('/passenger-ride-history')}
              />
            </View>
          ) : recentHistory.length > 0 ? (
            <View style={styles.historyList}>
              {recentHistory.map((item) => (
                <PassengerRideHistoryRow key={item.rideId} item={item} compact />
              ))}
            </View>
          ) : (
            <Text style={styles.mutedText}>Suas solicitações aparecerão aqui depois da primeira corrida.</Text>
          )}
        </AppCard>

        <View style={styles.secondaryActions}>
          <AppButton
            title="AJUDA E SUPORTE"
            variant="secondary"
            onPress={() => router.push({
              pathname: '/support-center',
              params: { source: 'passenger_home' },
            })}
          />
          <AppButton
            title="PRIVACIDADE E CONTA"
            variant="ghost"
            onPress={() => router.push('/privacy-center')}
          />
        </View>

        {profileLoading ? <Text style={styles.mutedText}>Atualizando sua conta…</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, flexGrow: 1 },
  requestCard: { gap: spacing.md },
  loadingCard: { gap: spacing.md, borderWidth: 2, borderColor: colors.primary },
  heroCopy: { gap: 4 },
  greeting: { fontFamily, color: colors.primary, ...typography.bodyBold },
  heroTitle: { fontFamily, color: colors.text, ...typography.h2 },
  mutedText: { fontFamily, color: colors.textMuted, ...typography.small },
  secureNote: { fontFamily, color: colors.textMuted, ...typography.caption, lineHeight: 16 },
  vehicleRow: { flexDirection: 'row', gap: spacing.sm },
  vehicleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  vehicleButtonSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  vehicleEmoji: { fontSize: 20 },
  vehicleText: { fontFamily, color: colors.textMuted, ...typography.bodyBold },
  vehicleTextSelected: { color: colors.primary },
  historyCard: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  sectionHeaderCopy: { flex: 1, gap: 2 },
  eyebrow: { fontFamily, color: colors.primary, ...typography.caption, fontWeight: '800', letterSpacing: 0.8 },
  sectionTitle: { fontFamily, color: colors.text, ...typography.h3 },
  historyList: { gap: spacing.sm },
  inlineError: { gap: spacing.sm },
  errorText: { fontFamily, color: colors.danger, ...typography.small },
  secondaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});