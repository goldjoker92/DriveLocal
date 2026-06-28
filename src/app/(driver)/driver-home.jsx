// Driver home (route "/driver-home"). Iteration 1A.
// Reads the signed-in driver from Firestore (drivers/{uid}). The ride list is
// still mock placeholder UI (real rides come in a later iteration).

import { useEffect, useState } from 'react';
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
import AppCard from '../../components/AppCard';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockRides } from '../../mock/mockRides';
import { RIDE_SEARCHING } from '../../constants/rideStatuses';
import { auth } from '../../config/firebase';
import { getDriver } from '../../services/driverService';
import { isFounderCommissionFreeActive } from '../../services/founderService';

export default function DriverHome() {
  const router = useRouter();
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const incoming = mockRides.filter((r) => r.status === RIDE_SEARCHING);

  useEffect(() => {
    let active = true;
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      setLoading(false);
      return;
    }
    getDriver(uid)
      .then((data) => {
        if (active) setDriver(data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const founderActive = isFounderCommissionFreeActive(driver);
  const displayName =
    driver && (driver.displayName || driver.fullName || driver.email);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Motorista"
          subtitle={loading ? 'Carregando...' : displayName}
          onBack={() => router.back()}
          right={<DriverStatusBadge status="online" />}
        />

        {loading ? (
          <AppCard>
            <AdminTableRow label="Carregando..." />
          </AppCard>
        ) : !driver ? (
          <AppCard>
            <AdminTableRow label="Cadastro não encontrado" />
          </AppCard>
        ) : (
          <>
            {founderActive ? <FounderOfferBadge /> : null}
            <SubscriptionReminderBanner daysLeft={60} />

            <WalletCard balanceCents={driver.balanceCents || 0} isFounderActive={founderActive} />

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
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
