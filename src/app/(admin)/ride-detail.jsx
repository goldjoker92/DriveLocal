// Admin ride detail (route "/ride-detail"). Shows lifecycle and financial state
// needed for support/antifraud without rendering precise coordinates, Pix payload,
// private driver documents or passenger contact data.

import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppCard from '../../components/AppCard';
import AppBadge from '../../components/AppBadge';
import AppButton from '../../components/AppButton';
import AdminTableRow from '../../components/AdminTableRow';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { formatBRL } from '../../utils/format';
import { getRideById } from '../../services/adminService';

function money(value) {
  return formatBRL(Number(value || 0));
}

function formatDateTime(epochMs) {
  if (!Number(epochMs || 0)) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Fortaleza',
  }).format(new Date(Number(epochMs)));
}

function statusTone(status) {
  if (status === 'completed') return 'success';
  if (status === 'disputed') return 'danger';
  if (status === 'cancelled' || status === 'no_driver_available') return 'warning';
  return 'neutral';
}

export default function RideDetail() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams();
  const [ride, setRide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!rideId) {
      setError('Corrida não informada.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await getRideById(String(rideId));
      setRide(result);
      if (!result) setError('Corrida não encontrada.');
      console.log('[ADMIN_RIDE_DETAIL] loaded', {
        rideId: String(rideId),
        status: result?.status,
        settlement: result?.commissionSettlementStatus,
      });
    } catch (e) {
      console.log('[ADMIN_RIDE_DETAIL] load error', {
        rideId: String(rideId),
        code: e?.code,
        message: e?.message,
      });
      setError('Não foi possível carregar a corrida.');
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    load();
  }, [load]);

  const policy = ride?.commissionPolicySnapshot || {};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        <Header title="Detalhe da corrida" subtitle={rideId ? String(rideId) : '—'} onBack={() => router.back()} />

        {error ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
          </AppCard>
        ) : null}

        {ride ? (
          <>
            <AppCard>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>
                    {ride.vehicleType === 'moto' ? '🏍️ Moto' : '🚗 Carro'}
                  </Text>
                  <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
                    Área: {ride.serviceAreaId || '—'}
                  </Text>
                </View>
                <AppBadge label={ride.status || '—'} tone={statusTone(ride.status)} />
              </View>
            </AppCard>

            <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>FINANCEIRO</Text>
            <AppCard>
              <AdminTableRow label="Valor estimado" value={money(ride.estimatedFareCentavos)} />
              <AdminTableRow label="Valor final" value={money(ride.finalFareCentavos || ride.estimatedFareCentavos)} />
              <AdminTableRow label="Comissão estimada" value={money(ride.estimatedCommissionCentavos)} />
              <AdminTableRow label="Retenção original" value={money(policy.holdAmountCentavos ?? ride.commissionOriginalHoldCentavos ?? ride.commissionHoldCentavos)} />
              <AdminTableRow label="Comissão capturada" value={money(ride.commissionCapturedCentavos)} />
              <AdminTableRow label="Retenção liberada" value={money(ride.holdReleasedCentavos)} />
              <AdminTableRow label="Estado financeiro" value={ride.commissionSettlementStatus || '—'} />
              <AdminTableRow label="Política" value={policy.policyVersion || 'legado'} />
              <AdminTableRow label="Gratuita ao aceitar" value={policy.commissionFreeAtAcceptance === true ? 'Sim' : 'Não'} />
            </AppCard>

            <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>CRONOLOGIA</Text>
            <AppCard>
              <AdminTableRow label="Solicitada" value={formatDateTime(ride.createdAtMs)} />
              <AdminTableRow label="Aceita" value={formatDateTime(ride.acceptedAtMs)} />
              <AdminTableRow label="Motorista chegou" value={formatDateTime(ride.driverArrivedAtMs)} />
              <AdminTableRow label="Iniciada" value={formatDateTime(ride.startedAtMs)} />
              <AdminTableRow label="Aguardando Pix" value={formatDateTime(ride.awaitingPaymentAtMs)} />
              <AdminTableRow label="Pagamento declarado" value={formatDateTime(ride.passengerMarkedPaidAtMs)} />
              <AdminTableRow label="Concluída" value={formatDateTime(ride.completedAtMs)} />
              <AdminTableRow label="Cancelada" value={formatDateTime(ride.cancelledAtMs)} />
              <AdminTableRow label="Em disputa" value={formatDateTime(ride.disputedAtMs)} />
            </AppCard>

            <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>ANOMALIAS E DECISÕES</Text>
            <AppCard>
              <AdminTableRow label="Motivo de cancelamento" value={ride.cancelReasonCode || '—'} />
              <AdminTableRow label="Motivo da disputa" value={ride.disputeReasonCode || '—'} />
              <AdminTableRow label="Resolução" value={ride.disputeResolution?.outcome || '—'} />
              <AdminTableRow label="Motivo admin" value={ride.disputeResolution?.reasonCode || '—'} />
            </AppCard>

            {ride.acceptedDriverId ? (
              <AppButton
                title="Abrir motorista"
                variant="secondary"
                onPress={() => router.push({
                  pathname: '/(admin)/driver-detail',
                  params: { driverId: ride.acceptedDriverId },
                })}
              />
            ) : null}
            {ride.status === 'disputed' ? (
              <AppButton title="Abrir fila de disputas" onPress={() => router.push('/ride-disputes')} />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
