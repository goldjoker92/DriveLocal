// Ride completed (route "/ride-completed"). Step 1 frontend only.
// TODO(backend): mark ride completed, store rating, update wallet/commission.

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
import { formatBRL } from '../../utils/format';

export default function RideCompleted() {
  const router = useRouter();
  const ride = mockRides[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Corrida finalizada" subtitle="Obrigado por viajar com a DriveLocal!" />
        <AppCard>
          <AdminTableRow label="Origem" value={ride.pickup.address} />
          <AdminTableRow label="Destino" value={ride.destination.address} />
          <AdminTableRow label="Valor pago" value={formatBRL(ride.fareCents)} />
          <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
        </AppCard>
        <AppButton title="Voltar ao início" onPress={() => router.replace('/passenger-home')} />
      </ScrollView>
    </SafeAreaView>
  );
}
