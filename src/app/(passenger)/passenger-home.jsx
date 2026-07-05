// Passenger home (route "/passenger-home"). Iteration 3A.
// Real signed-in passenger (passengers/{uid}); no mock rides. Entry point to the
// ride-request form. Ride history/status is a later iteration.

import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import MapPlaceholder from '../../components/MapPlaceholder';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { auth } from '../../config/firebase';
import { getPassenger } from '../../services/passengerService';

export default function PassengerHome() {
  const router = useRouter();
  const [passenger, setPassenger] = useState(null);

  useEffect(() => {
    const uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) {
      router.replace('/passenger-register');
      return;
    }
    getPassenger(uid)
      .then((p) => setPassenger(p))
      .catch((e) => console.log('[PASSENGER_HOME] load error', e.message));
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header
          title="Passageiro"
          subtitle={passenger && passenger.fullName ? passenger.fullName : 'Horizonte / CE'}
          onBack={() => router.back()}
        />

        <MapPlaceholder label="Sua localização (placeholder)" />

        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          Pagamento direto por Pix ao motorista.
        </Text>

        <AppButton title="Pedir corrida" onPress={() => router.push('/request-ride')} />
      </ScrollView>
    </SafeAreaView>
  );
}
