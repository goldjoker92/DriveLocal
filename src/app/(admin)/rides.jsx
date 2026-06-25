// Rides list (route "/rides"). Step 1 frontend only — mock rides.
// TODO(backend): query rides for the active serviceArea with filters.

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

export default function Rides() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Corridas" onBack={() => router.back()} />
        <AppCard>
          {mockRides.map((r) => (
            <AdminTableRow
              key={r.id}
              label={`${r.passengerName} — ${r.status}`}
              value={formatBRL(r.fareCents)}
            />
          ))}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
