// Pending drivers (route "/drivers-pending"). Step 1 frontend only.
// TODO(backend): query drivers where approved == false in this serviceArea.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import DriverStatusBadge from '../../components/DriverStatusBadge';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockDrivers } from '../../mock/mockDrivers';

export default function DriversPending() {
  const router = useRouter();
  const pending = mockDrivers.filter((d) => !d.approved);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Motoristas pendentes" onBack={() => router.back()} />
        <AppCard>
          {pending.length === 0 ? (
            <AdminTableRow label="Nenhum motorista pendente" />
          ) : (
            pending.map((d) => (
              <AdminTableRow key={d.id} label={d.name} right={<DriverStatusBadge status="pending" />} />
            ))
          )}
        </AppCard>
        {/* Mock detail link: opens the driver detail screen. */}
        <AppButton title="Abrir detalhe do motorista" onPress={() => router.push('/driver-detail')} />
      </ScrollView>
    </SafeAreaView>
  );
}
