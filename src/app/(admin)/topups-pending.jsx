// Pending wallet top-ups (route "/topups-pending"). Step 1 frontend only.
// TODO(backend): list Pix top-up requests awaiting admin confirmation.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AdminTableRow from '../../components/AdminTableRow';
import AppBadge from '../../components/AppBadge';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { formatBRL } from '../../utils/format';

// Simple mock list of pending top-ups (integer cents).
const MOCK_TOPUPS = [
  { id: 'tp1', driverName: 'Ana Pereira', amountCents: 5000 },
  { id: 'tp2', driverName: 'Pedro Alves', amountCents: 2000 },
];

export default function TopupsPending() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Recargas pendentes" onBack={() => router.back()} />
        <AppCard>
          {MOCK_TOPUPS.map((t) => (
            <AdminTableRow
              key={t.id}
              label={`${t.driverName} — ${formatBRL(t.amountCents)}`}
              right={<AppBadge label="Pendente" tone="warning" />}
            />
          ))}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
