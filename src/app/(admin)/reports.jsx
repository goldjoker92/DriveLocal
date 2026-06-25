// Reports (route "/reports"). Step 1 frontend only — mock totals.
// TODO(backend): real reporting (rides, revenue, commission) per serviceArea.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockRides } from '../../mock/mockRides';
import { formatBRL } from '../../utils/format';

export default function Reports() {
  const router = useRouter();

  // Simple mock aggregates from mock rides.
  const totalRides = mockRides.length;
  const totalFaresCents = mockRides.reduce((sum, r) => sum + r.fareCents, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Relatórios" onBack={() => router.back()} />
        <AppCard>
          <AdminTableRow label="Total de corridas" value={String(totalRides)} />
          <AdminTableRow label="Valor total" value={formatBRL(totalFaresCents)} />
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
