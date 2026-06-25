// Subscription plans (route "/subscription-plans"). Step 1 frontend only.
// MVP 0.1 does NOT auto-charge subscriptions; new drivers get a free window.
// TODO(backend): real plans + activation gated by admin/feature flag.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import SubscriptionReminderBanner from '../../components/SubscriptionReminderBanner';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { SUBSCRIPTION_DEFAULT_FREE_DAYS } from '../../constants/subscriptionRules';

export default function SubscriptionPlans() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Assinatura" onBack={() => router.back()} />
        <SubscriptionReminderBanner daysLeft={SUBSCRIPTION_DEFAULT_FREE_DAYS} />
        <AppCard>
          <AdminTableRow label="Plano mensal" value="R$ 0,00 (grátis no MVP)" />
          <AdminTableRow label="Período grátis" value={`${SUBSCRIPTION_DEFAULT_FREE_DAYS} dias`} />
        </AppCard>
        <AppButton title="Voltar ao painel" onPress={() => router.replace('/driver-home')} />
      </ScrollView>
    </SafeAreaView>
  );
}
