// Finish ride (route "/finish-ride"). Step 1 driver flow.
// Driver confirms the Pix payment was received, then finalizes.
//
// PricingV1 wallet settlement is wired here but GUARDED: DriveLocal commission is
// debited from the driver wallet only at completion, via services/walletCommission
// (debitCommissionFromWallet), and only when a REAL ride document exists (a real
// driver uid + a real rideId + pricing fields on the ride doc). The current Step 1
// flow uses mockRides and has no real ride doc, so the debit safely SKIPS with a
// clear log — it never fabricates a debit.
//
// TODO(ride-flow): when real ride creation/dispatch is wired, pass the real rideId
// to this screen (route param) and persist ridePriceCentavos + vehicleType +
// distanceKm + driverId on the ride doc so the settlement below can run. See
// confirm-price.jsx priceSnapshot for the exact fields.

import { useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { mockRides } from '../../mock/mockRides';
import { formatBRL } from '../../utils/format';
import { auth } from '../../config/firebase';
import { debitCommissionFromWallet } from '../../services/walletCommission';

export default function FinishRide() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const ride = mockRides[0];
  const [paid, setPaid] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // Settle wallet commission (idempotent, transactional) then leave the screen.
  // GUARD: only runs against a real ride document; never fakes a debit in the
  // mock flow.
  async function finalizeRide() {
    setFinalizing(true);
    const uid = auth.currentUser && auth.currentUser.uid;
    const rideId = typeof params.rideId === 'string' ? params.rideId : null;

    if (!uid || !rideId) {
      // Mock Step 1 flow: no real ride doc to settle. Do NOT fake a debit.
      console.log('[WalletCommission] skipped — no real ride doc (mock flow), TODO(ride-flow)');
    } else {
      try {
        // Commission is 0 during the free/founder window or for 0% tiers; the
        // helper computes it, guards double-charge via ride.commissionSettled,
        // and increments the non-founder free-ride counter atomically.
        const res = await debitCommissionFromWallet(uid, rideId);
        if (res && res.settled) {
          console.log('[WalletCommission] debit success feeCentavos=', res.platformFeeCentavos);
        } else {
          console.log('[WalletCommission] skipped reason=', res && (res.skipped || 'unknown'));
        }
      } catch (e) {
        console.log('[WalletCommission] settlement error', e.code || e.message);
      }
    }

    setFinalizing(false);
    router.replace('/driver-home');
  }

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
          onPress={finalizeRide}
          disabled={!paid || finalizing}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
