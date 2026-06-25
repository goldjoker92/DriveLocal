// Admin dashboard (route "/dashboard"). Step 1 frontend only — mock metrics.
// TODO(backend): real aggregates from Firestore for the active serviceArea.

import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppButton from '../../components/AppButton';
import AdminStatCard from '../../components/AdminStatCard';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockDrivers } from '../../mock/mockDrivers';
import { mockRides } from '../../mock/mockRides';

export default function Dashboard() {
  const router = useRouter();
  const approved = mockDrivers.filter((d) => d.approved).length;
  const pending = mockDrivers.filter((d) => !d.approved).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Painel" subtitle="Horizonte / CE" onBack={() => router.back()} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <AdminStatCard label="Aprovados" value={String(approved)} />
          <AdminStatCard label="Pendentes" value={String(pending)} />
          <AdminStatCard label="Corridas" value={String(mockRides.length)} />
        </View>
        <AppButton title="Motoristas pendentes" onPress={() => router.push('/drivers-pending')} />
        <AppButton title="Recargas pendentes" variant="secondary" onPress={() => router.push('/topups-pending')} />
        <AppButton title="Corridas" variant="secondary" onPress={() => router.push('/rides')} />
        <AppButton title="Carteiras" variant="secondary" onPress={() => router.push('/wallets')} />
        <AppButton title="Relatórios" variant="secondary" onPress={() => router.push('/reports')} />
        <AppButton title="Painel resumido" variant="ghost" onPress={() => router.push('/admin-home')} />
      </ScrollView>
    </SafeAreaView>
  );
}
