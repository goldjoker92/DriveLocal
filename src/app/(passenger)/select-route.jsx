// Select route (route "/select-route"). Step 1 frontend only — mock inputs.
// Passenger picks pickup + destination. TODO(backend): use real geocoding and
// the active serviceArea polygon to validate both points are inside the area.

import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import MapPlaceholder from '../../components/MapPlaceholder';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';

export default function SelectRoute() {
  const router = useRouter();
  const [pickup, setPickup] = useState('Centro, Horizonte');
  const [destination, setDestination] = useState('Bairro Aurora, Horizonte');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Para onde vamos?" onBack={() => router.back()} />
        <MapPlaceholder label="Mapa da rota (placeholder)" />
        <AppCard>
          <AppInput label="Origem" value={pickup} onChangeText={setPickup} placeholder="Endereço de partida" />
          <AppInput label="Destino" value={destination} onChangeText={setDestination} placeholder="Endereço de destino" />
          <AppButton title="Ver preço" onPress={() => router.push('/confirm-price')} />
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
