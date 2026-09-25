// ============================================================
// Driver auth entry (route "/driver-auth"). Iteration 1D.
// Reached from the landing "Sou motorista?" CTA. A clean fork:
//   - Entrar como motorista   -> email login (redirect by role/status)
//   - Criar cadastro de motorista -> email register (creates drivers/{uid})
// Reuses the existing auth services/screens. roleIntent=driver is passed so a
// future Google login can create the correct role. No Firebase init here.
// ============================================================

import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';

export default function DriverAuth() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Motorista DriveLocal" subtitle="Entre ou crie seu cadastro" onBack={() => router.back()} />

        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>
            Dirija na sua cidade, com menos comissão.
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Todos os motoristas aprovados têm 0% de comissão por 60 dias a partir da aprovação.
            Depois, 12% na Moto ou 15% no Carro, apenas nas corridas pagas.
          </Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
            Os 100 primeiros aprovados recebem o badge permanente Motorista Fundador.
          </Text>
        </AppCard>

        {/* Existing driver: log in and get routed by verificationStatus. */}
        <AppButton
          title="Entrar como motorista"
          onPress={() => router.push({ pathname: '/email-login', params: { roleIntent: 'driver' } })}
        />

        {/* New driver: create the account (creates drivers/{uid} in "draft"). */}
        <AppButton
          title="Criar cadastro de motorista"
          variant="secondary"
          onPress={() => router.push({ pathname: '/email-register', params: { roleIntent: 'driver' } })}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
