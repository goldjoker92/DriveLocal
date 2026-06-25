// Incoming ride request (route "/ride-request"). Step 1 frontend only.
// TODO(backend): listen for assigned ride offers; enforce wallet/commission
// rules before allowing accept.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import RideRequestCard from '../../components/RideRequestCard';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockRides } from '../../mock/mockRides';

export default function RideRequest() {
  const router = useRouter();
  const ride = mockRides[1]; // a ride currently searching for a driver

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Nova corrida" subtitle="Aceite para iniciar" onBack={() => router.back()} />
        <RideRequestCard
          ride={ride}
          onAccept={() => router.replace('/active-ride')}
          onDecline={() => router.replace('/driver-home')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
