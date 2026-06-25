// Finish ride (route "/finish-ride"). Step 1 frontend only.
// Driver confirms the Pix payment was received, then finalizes.
// TODO(backend): confirm payment + write rideEvents + settle commission.

import { useState } from 'react';
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

export default function FinishRide() {
  const router = useRouter();
  const ride = mockRides[0];
  const [paid, setPaid] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Finalizar corrida" subtitle="Confirme o pagamento" onBack={() => router.back()} />
        <AppCard>
          <AdminTableRow label="Passageiro" value={ride.passengerName} />
          <AdminTableRow label="Valor" value={formatBRL(ride.fareCents)} />
          <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
          <AdminTableRow label="Status" value={paid ? 'Recebido' : 'Pendente'} />
        </AppCard>
        <AppButton title="Confirmar pagamento recebido" onPress={() => setPaid(true)} />
        <AppButton
          title="Finalizar corrida"
          onPress={() => router.replace('/driver-home')}
          disabled={!paid}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
