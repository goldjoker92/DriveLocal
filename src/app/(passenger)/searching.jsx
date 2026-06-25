// Searching for a driver (route "/searching"). Step 1 frontend only.
// TODO(backend): listen to the ride document; navigate when a driver accepts.

import { ScrollView, ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';

export default function Searching() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Procurando motorista" subtitle="Aguarde um momento…" onBack={() => router.back()} />
        <AppCard>
          <View style={{ alignItems: 'center', paddingVertical: spacing.lg, gap: spacing.md }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        </AppCard>
        {/* Dev shortcut: simulate a driver accepting the ride. */}
        <AppButton title="Simular motorista aceitou" onPress={() => router.replace('/driver-accepted')} />
        <AppButton title="Cancelar" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
