// Subscription plans (route "/subscription-plans"). Step 1 frontend only.
// MVP 0.1 does NOT auto-charge subscriptions; new drivers get a free window.
// TODO(backend): real plans + activation gated by admin/feature flag.

import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import SubscriptionReminderBanner from '../../components/SubscriptionReminderBanner';
import DriverPixPaymentSheet from '../../components/DriverPixPaymentSheet';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { SUBSCRIPTION_DEFAULT_FREE_DAYS } from '../../constants/subscriptionRules';
import { requestSubscriptionPix } from '../../services/paymentsService';

export default function SubscriptionPlans() {
  const router = useRouter();

  const [payment, setPayment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onPaySubscription() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Amount and eligibility are decided server-side; the client sends none.
      const result = await requestSubscriptionPix();
      setPayment(result);
    } catch (e) {
      setError((e && e.message) || 'Não foi possível gerar o Pix. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Assinatura" onBack={() => router.back()} />
        <SubscriptionReminderBanner daysLeft={SUBSCRIPTION_DEFAULT_FREE_DAYS} />
        <AppCard>
          <AdminTableRow label="Plano mensal" value="R$ 0,00 (grátis no MVP)" />
          <AdminTableRow label="Período grátis" value={`${SUBSCRIPTION_DEFAULT_FREE_DAYS} dias`} />
        </AppCard>

        {payment ? (
          <DriverPixPaymentSheet payment={payment} onClose={() => setPayment(null)} />
        ) : (
          <>
            <AppButton title={busy ? 'Gerando…' : 'Pagar assinatura (Pix)'} onPress={onPaySubscription} />
            {error ? (
              <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
            ) : null}
          </>
        )}

        <AppButton title="Voltar ao painel" onPress={() => router.replace('/driver-home')} />
      </ScrollView>
    </SafeAreaView>
  );
}
