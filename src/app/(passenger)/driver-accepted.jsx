// Driver accepted (route "/driver-accepted"). Step 1 frontend only.
// Shows the assigned driver (mock). DriveLocal does NOT show a live moving
// driver marker in MVP 0.1 — only the static assigned-driver info.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import MapPlaceholder from '../../components/MapPlaceholder';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockDrivers } from '../../mock/mockDrivers';
import { mockRides } from '../../mock/mockRides';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';
import { formatBRL } from '../../utils/format';

export default function DriverAccepted() {
  const router = useRouter();
  const driver = mockDrivers[0];
  const ride = mockRides[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Motorista a caminho" onBack={() => router.back()} />
        <MapPlaceholder label="Mapa (sem rastreamento ao vivo no MVP)" />
        <AppCard>
          <AdminTableRow label="Motorista" value={driver.name} />
          <AdminTableRow label="Veículo" value={VEHICLE_LABELS_PT_BR[driver.vehicleType]} />
          <AdminTableRow label="Placa" value={driver.plate} />
          <AdminTableRow label="Origem" value={ride.pickup.address} />
          <AdminTableRow label="Destino" value={ride.destination.address} />
          <AdminTableRow label="Preço" value={formatBRL(ride.fareCents)} />
        </AppCard>
        <AppButton title="Pagar com Pix" onPress={() => router.push('/pix-payment')} />
      </ScrollView>
    </SafeAreaView>
  );
}
