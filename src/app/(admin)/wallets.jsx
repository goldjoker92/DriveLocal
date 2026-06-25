// Driver wallets (route "/wallets"). Step 1 frontend only — mock balances.
// TODO(backend): list driver balances + low-balance flags from Firestore.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockDrivers } from '../../mock/mockDrivers';
import { formatBRL } from '../../utils/format';

export default function Wallets() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Carteiras" onBack={() => router.back()} />
        <AppCard>
          {mockDrivers.map((d) => (
            <AdminTableRow key={d.id} label={d.name} value={formatBRL(d.balanceCents)} />
          ))}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
