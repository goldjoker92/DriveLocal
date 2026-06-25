// Driver wallet (route "/wallet"). Step 1 frontend only — mock balance/history.
// TODO(backend): real balance, top-ups (Pix), and commission transactions.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import WalletCard from '../../components/WalletCard';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockDrivers } from '../../mock/mockDrivers';
import { formatBRL } from '../../utils/format';

// Simple mock transaction history (integer cents; negative = charge).
const MOCK_TX = [
  { id: 't1', label: 'Recarga Pix', amountCents: 5000 },
  { id: 't2', label: 'Comissão corrida r3', amountCents: -225 },
];

export default function Wallet() {
  const router = useRouter();
  const driver = mockDrivers[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Carteira" onBack={() => router.back()} />
        <WalletCard balanceCents={driver.balanceCents} isFounderActive={driver.isFounder} />
        <AppButton title="Adicionar saldo (Pix)" onPress={() => {}} />
        <AppCard>
          {MOCK_TX.map((tx) => (
            <AdminTableRow key={tx.id} label={tx.label} value={formatBRL(tx.amountCents)} />
          ))}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
