// Legacy route kept for old admin links. Real payment reviews are consolidated in
// the secured admin alert inbox; this screen never displays or mutates fake wallet data.

import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';

export default function TopupsPending() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Recargas pendentes" onBack={() => router.back()} />

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            Revisões financeiras centralizadas
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Pagamentos que exigem análise aparecem na caixa de alertas administrativos. Esta rota não confirma recargas e não altera carteiras.
          </Text>
          <AppButton
            title="ABRIR ALERTAS"
            onPress={() => router.replace('/admin-alerts')}
          />
          <AppButton
            title="VOLTAR AO DASHBOARD"
            variant="ghost"
            onPress={() => router.replace('/dashboard')}
          />
        </AppCard>
      </ScrollView>
    </SafeAreaView>
  );
}
