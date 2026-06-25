// Driver onboarding (route "/onboarding"). Step 1 frontend only.
// Highlights the Founder offer. TODO(backend): create the driver profile.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import FounderOfferBadge from '../../components/FounderOfferBadge';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import {
  FOUNDER_OFFER_HEADLINE_PT_BR,
  FOUNDER_DEFAULT_COMMISSION_FREE_DAYS,
} from '../../constants/founderOfferRules';

export default function Onboarding() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Seja motorista" subtitle="DriveLocal em Horizonte/CE" />
        <AppCard>
          <FounderOfferBadge />
          <AdminTableRow label="Oferta" value={FOUNDER_OFFER_HEADLINE_PT_BR} />
          <AdminTableRow label="Comissão grátis" value={`${FOUNDER_DEFAULT_COMMISSION_FREE_DAYS} dias`} />
          <AdminTableRow label="Pix" value="100% do valor da corrida" />
        </AppCard>
        <AppButton title="Começar cadastro" onPress={() => router.push('/profile')} />
      </ScrollView>
    </SafeAreaView>
  );
}
