// Driver wallet (route "/wallet"). Step 1 frontend only — mock balance/history.
// TODO(backend): real balance, top-ups (Pix), and commission transactions.

import { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import WalletCard from '../../components/WalletCard';
import AdminTableRow from '../../components/AdminTableRow';
import DriverPixPaymentSheet from '../../components/DriverPixPaymentSheet';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { mockDrivers } from '../../mock/mockDrivers';
import { formatBRL } from '../../utils/format';
import { requestWalletTopupPix } from '../../services/paymentsService';

// Simple mock transaction history (integer cents; negative = charge).
const MOCK_TX = [
  { id: 't1', label: 'Recarga Pix', amountCents: 5000 },
  { id: 't2', label: 'Comissão corrida r3', amountCents: -225 },
];

// Server-approved pilot top-up amounts (integer centavos). The backend rejects
// any other amount — the client only offers these.
const TOPUP_OPTIONS = [1000, 2000, 3000, 5000];

export default function Wallet() {
  const router = useRouter();
  const driver = mockDrivers[0];

  const [payment, setPayment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onTopup(amountCentavos) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestWalletTopupPix(amountCentavos);
      setPayment(result);
    } catch (e) {
      // Stable PT-BR message provided by the backend when available.
      setError((e && e.message) || 'Não foi possível gerar o Pix. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Carteira" onBack={() => router.back()} />
        <WalletCard balanceCents={driver.balanceCents} isFounderActive={driver.isFounder} />

        {payment ? (
          <DriverPixPaymentSheet payment={payment} onClose={() => setPayment(null)} />
        ) : (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
              Adicionar saldo (Pix)
            </Text>
            <View style={{ gap: spacing.sm }}>
              {TOPUP_OPTIONS.map((amount) => (
                <AppButton
                  key={amount}
                  title={busy ? 'Gerando…' : formatBRL(amount)}
                  onPress={() => onTopup(amount)}
                />
              ))}
            </View>
            {error ? (
              <Text style={[{ fontFamily, color: colors.danger || colors.text }, typography.small]}>
                {error}
              </Text>
            ) : null}
          </AppCard>
        )}

        <AppCard>
          {MOCK_TX.map((tx) => (
            <AdminTableRow key={tx.id} label={tx.label} value={formatBRL(tx.amountCents)} />
          ))}
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
