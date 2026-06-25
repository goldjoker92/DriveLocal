// Passenger home (route "/passenger-home").
// Placeholder: map stand-in + this passenger's rides from mock data.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import MapPlaceholder from '../../components/MapPlaceholder';
import RideRequestCard from '../../components/RideRequestCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockRides } from '../../mock/mockRides';

export default function PassengerHome() {
  const router = useRouter();
  // For Step 1 we hard-code the signed-in passenger.
  const myRides = mockRides.filter((r) => r.passengerId === 'u_p1');

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Passageiro" subtitle="Maria Souza" onBack={() => router.back()} />

        <MapPlaceholder label="Sua localização (placeholder)" />

        <AppButton title="Pedir corrida" onPress={() => router.push('/select-route')} />

        {myRides.map((ride) => (
          <RideRequestCard key={ride.id} ride={ride} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
