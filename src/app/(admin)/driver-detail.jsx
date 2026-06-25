// Driver detail (route "/driver-detail"). Step 1 frontend only.
// Admin approves or rejects a driver. Approval is what triggers the founder
// counter + free windows (handled server-side later).
// TODO(backend): approveDriver / rejectDriver Cloud Functions.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockDrivers } from '../../mock/mockDrivers';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';

export default function DriverDetail() {
  const router = useRouter();
  // Mock: show the first pending driver.
  const driver = mockDrivers.find((d) => !d.approved) || mockDrivers[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Detalhe do motorista" onBack={() => router.back()} />
        <AppCard>
          <AdminTableRow label="Nome" value={driver.name} />
          <AdminTableRow label="WhatsApp" value={driver.phone} />
          <AdminTableRow label="Veículo" value={VEHICLE_LABELS_PT_BR[driver.vehicleType]} />
          <AdminTableRow label="Placa" value={driver.plate} />
          <AdminTableRow label="Documentos" value="Enviados (placeholder)" />
        </AppCard>
        <AppButton title="Aprovar motorista" onPress={() => router.back()} />
        <AppButton title="Rejeitar" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
