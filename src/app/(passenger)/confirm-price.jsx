// Confirm price (route "/confirm-price"). Step 1 frontend only — mock price.
// TODO(backend): compute the real fare from the serviceArea pricing + distance.

import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockRides } from '../../mock/mockRides';
import { formatBRL, formatDistanceKm } from '../../utils/format';
import { VEHICLE_LABELS_PT_BR } from '../../constants/vehicleTypes';

export default function ConfirmPrice() {
  const router = useRouter();
  const ride = mockRides[0]; // mock estimate for this route

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Confirmar corrida" onBack={() => router.back()} />
        <AppCard>
          <AdminTableRow label="Origem" value={ride.pickup.address} />
          <AdminTableRow label="Destino" value={ride.destination.address} />
          <AdminTableRow label="Veículo" value={VEHICLE_LABELS_PT_BR[ride.vehicleType]} />
          <AdminTableRow label="Distância" value={formatDistanceKm(ride.distanceMeters)} />
          <AdminTableRow label="Preço" value={formatBRL(ride.fareCents)} />
          <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
        </AppCard>
        <AppButton title="Pedir corrida" onPress={() => router.push('/searching')} />
      </ScrollView>
    </SafeAreaView>
  );
}
