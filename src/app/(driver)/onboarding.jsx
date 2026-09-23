// Driver onboarding (route "/onboarding"). Iteration 1A.
// Highlights the Founder offer and shows the live remaining founder slots,
// read from the Firestore counter. TODO(next): build the profile form.

import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import {
  FOUNDER_OFFER_HEADLINE_PT_BR,
  FOUNDER_DEFAULT_MAX_DRIVERS,
} from '../../constants/founderOfferRules';
import { COMMISSION_FREE_DAYS } from '../../constants/pricingConfig';
import { getApprovedCount } from '../../services/founderService';

export default function Onboarding() {
  const router = useRouter();
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    let active = true;
    getApprovedCount()
      .then((count) => {
        if (active) {
          setRemaining(Math.max(FOUNDER_DEFAULT_MAX_DRIVERS - count, 0));
        }
      })
      .catch(() => {
        if (active) setRemaining(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const remainingLabel =
    remaining === null ? '...' : `${remaining} de ${FOUNDER_DEFAULT_MAX_DRIVERS}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Seja motorista" subtitle="DriveLocal em Horizonte/CE" />
        <AppCard>
          <AdminTableRow label="Oferta" value={FOUNDER_OFFER_HEADLINE_PT_BR} />
          <AdminTableRow label="Comissão 0% para todos os aprovados" value={`${COMMISSION_FREE_DAYS} dias`} />
          <AdminTableRow label="Vagas fundador restantes" value={remainingLabel} />
          <AdminTableRow label="Motorista Fundador" value="Badge permanente apenas para os 100 primeiros aprovados" />
          <AdminTableRow label="Pix" value="100% do valor da corrida" />
        </AppCard>
        <AppButton title="Começar cadastro" onPress={() => router.push('/(driver)/profile')} />
      </ScrollView>
    </SafeAreaView>
  );
}
