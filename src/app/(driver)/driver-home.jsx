// Driver home (route "/driver-home").
// Placeholder dashboard: status, founder badge, subscription reminder,
// wallet, map stand-in, and incoming ride requests from mock data.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import FounderOfferBadge from '../../components/FounderOfferBadge';
import SubscriptionReminderBanner from '../../components/SubscriptionReminderBanner';
import WalletCard from '../../components/WalletCard';
import MapPlaceholder from '../../components/MapPlaceholder';
import RideRequestCard from '../../components/RideRequestCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockDrivers } from '../../mock/mockDrivers';
import { mockRides } from '../../mock/mockRides';
import { RIDE_SEARCHING } from '../../constants/rideStatuses';

export default function DriverHome() {
  const router = useRouter();
  // For Step 1 we hard-code the signed-in driver (Carlos, a founder).
  const driver = mockDrivers[0];
  const incoming = mockRides.filter((r) => r.status === RIDE_SEARCHING);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Motorista"
          subtitle={driver.name}
          onBack={() => router.back()}
          right={<DriverStatusBadge status="online" />}
        />

        {driver.isFounder ? <FounderOfferBadge /> : null}
        <SubscriptionReminderBanner daysLeft={60} />

        <WalletCard balanceCents={driver.balanceCents} isFounderActive={driver.isFounder} />

        <MapPlaceholder label="Mapa do motorista (placeholder)" />

        {/* Navigation to the driver sub-screens (Step 1 reachability). */}
        <AppButton title="Ver pedido de corrida" onPress={() => router.push('/ride-request')} />
        <AppButton title="Carteira" variant="secondary" onPress={() => router.push('/wallet')} />
        <AppButton title="Assinatura" variant="secondary" onPress={() => router.push('/subscription-plans')} />
        <AppButton title="Cadastro de motorista" variant="ghost" onPress={() => router.push('/onboarding')} />

        {incoming.map((ride) => (
          <RideRequestCard
            key={ride.id}
            ride={ride}
            onAccept={() => {}}
            onDecline={() => {}}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
