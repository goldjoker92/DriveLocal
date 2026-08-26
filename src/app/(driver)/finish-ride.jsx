// Finish ride (route "/finish-ride"). Step 1 driver flow + PricingV1 settlement.
//
// Driver confirms the Pix payment was received, then finalizes. When a real
// rideId is present (route param, threaded from ride-request -> active-ride):
//   1. completeRideRequest(rideId)     -> status "completed" + completedAt
//   2. debitCommissionFromWallet(...)  -> idempotent, transactional commission
//      debit from the driver wallet (0% during free window / 0% tiers).
//
// Commission is NEVER debited twice: walletCommission guards on the ride's
// commissionSettled flag. If the wallet cannot cover the commission, settlement
// is rejected with WALLET_BALANCE_TOO_LOW, the ride stays unsettled (retriable
// after a recharge), and the driver sees a clear message.
//
// Without a rideId (pure Step 1 mock) the settlement safely SKIPS — no fake debit.

import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { mockRides } from '../../mock/mockRides';
import { formatBRL } from '../../utils/format';
import { auth } from '../../config/firebase';
import { debitCommissionFromWallet } from '../../services/walletCommission';
import { getRideRequest, completeRideRequest } from '../../services/rideRequestService';

export default function FinishRide() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const rideId = typeof params.rideId === 'string' ? params.rideId : null;
  const mockRide = mockRides[0];
  const [realRide, setRealRide] = useState(null);
  const [paid, setPaid] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [settleMsg, setSettleMsg] = useState('');

  // Load the real ride to show its persisted price (falls back to the mock ride).
  useEffect(() => {
    let active = true;
    if (!rideId) return undefined;
    getRideRequest(rideId)
      .then((r) => {
        if (active) setRealRide(r);
      })
      .catch((e) => console.log('[RIDE_REQUEST] load error', e.code || e.message));
    return () => {
      active = false;
    };
  }, [rideId]);

  const valueCentavos =
    realRide && realRide.ridePriceCentavos != null ? realRide.ridePriceCentavos : mockRide.fareCents;
  const passengerName = (realRide && realRide.passengerName) || mockRide.passengerName;

  // Complete the ride, then settle commission (idempotent). GUARD: only runs
  // against a real ride document; never fakes a debit in the mock flow.
  async function finalizeRide() {
    setSettleMsg('');
    setFinalizing(true);
    const uid = auth.currentUser && auth.currentUser.uid;

    if (!uid || !rideId) {
      console.log('[WalletCommission] skipped — no real ride doc (mock flow), TODO(ride-flow)');
      setFinalizing(false);
      router.replace('/driver-home');
      return;
    }

    try {
      await completeRideRequest(rideId);
      const res = await debitCommissionFromWallet(uid, rideId);

      if (res && res.rejected && res.reason === 'WALLET_BALANCE_TOO_LOW') {
        console.log('[WalletCommission] rejected WALLET_BALANCE_TOO_LOW rideId=', rideId);
        setSettleMsg('Saldo insuficiente para a taxa da plataforma. Recarregue seu Saldo DriveLocal e finalize novamente.');
        setFinalizing(false);
        return; // stay on screen so the driver sees the state (ride stays unsettled)
      }

      if (res && res.settled) {
        console.log('[WalletCommission] debit success feeCentavos=', res.platformFeeCentavos);
      } else {
        console.log('[WalletCommission] skipped reason=', res && (res.skipped || 'unknown'));
      }
      setFinalizing(false);
      router.replace('/driver-home');
    } catch (e) {
      console.log('[WalletCommission] settlement error', e.code || e.message);
      setSettleMsg('Não foi possível concluir a corrida. Tente novamente.');
      setFinalizing(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}>
        <Header title="Finalizar corrida" subtitle="Confirme o pagamento" onBack={() => router.back()} />
        <AppCard>
          <AdminTableRow label="Passageiro" value={passengerName} />
          <AdminTableRow label="Valor" value={formatBRL(valueCentavos)} />
          <AdminTableRow label="Pagamento" value="Pix direto ao motorista" />
          <AdminTableRow label="Status" value={paid ? 'Recebido' : 'Pendente'} />
        </AppCard>
        <AppButton title="Confirmar pagamento recebido" onPress={() => setPaid(true)} />
        <AppButton
          title="Finalizar corrida"
          onPress={finalizeRide}
          disabled={!paid || finalizing}
        />
        {settleMsg ? (
          <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{settleMsg}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
