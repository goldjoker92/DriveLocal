// Driver verification status (route "/verification-status"). Step 1 frontend only.
// TODO(backend): reflect the real approval status set by an admin.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';

export default function VerificationStatus() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Status da verificação" onBack={() => router.back()} />
        <AppCard>
          <DriverStatusBadge status="pending" />
          {/* Approval is manual by an admin; the founder counter is only
              incremented when an admin approves the driver. */}
        </AppCard>
        <AppButton title="Ir para o painel do motorista" onPress={() => router.replace('/driver-home')} />
      </ScrollView>
    </SafeAreaView>
  );
}
