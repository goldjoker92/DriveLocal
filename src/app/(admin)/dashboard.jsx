// Admin dashboard (route "/dashboard"). Launch command center for business,
// commission integrity, subscriptions, demand peaks and antifraud alerts.
//
// Privacy: the screen receives server-computed aggregates only. It never downloads
// raw ledgers, CPF/CNH/Pix values or precise passenger coordinates.

import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Header from '../../components/Header';
import AppButton from '../../components/AppButton';
import AppCard from '../../components/AppCard';
import AdminStatCard from '../../components/AdminStatCard';
import { colors } from '../../constants/colors';
import { spacing, radius } from '../../constants/spacing';
import { typography, fontFamily } from '../../constants/typography';
import { formatBRL } from '../../utils/format';
import { getAdminBusinessAnalytics } from '../../services/adminService';

const PERIODS = [
  { days: 1, label: 'Hoje' },
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
];

const money = (value) => formatBRL(Number(value || 0));
const number = (value) => Number(value || 0).toLocaleString('pt-BR');
const percent = (value) => `${(Number(value || 0) * 100).toFixed(1).replace('.', ',')}%`;
const hourLabel = (hour) => `${String(Number(hour || 0)).padStart(2, '0')}h–${String((Number(hour || 0) + 1) % 24).padStart(2, '0')}h`;

function SectionTitle({ title, subtitle }) {
  return (
    <View style={{ gap: 2, marginTop: spacing.sm }}>
      <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>{title}</Text>
      {subtitle ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

function MetricRow({ label, value, strong = false, hint }) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
        <Text style={[{ fontFamily, color: colors.textMuted, flex: 1 }, typography.small]}>{label}</Text>
        <Text
          style={[
            { fontFamily, color: strong ? colors.text : colors.textMuted, textAlign: 'right' },
            strong ? typography.bodyBold : typography.small,
          ]}
        >
          {value}
        </Text>
      </View>
      {hint ? (
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>{hint}</Text>
      ) : null}
    </View>
  );
}

function VehicleFinanceCard({ label, data }) {
  return (
    <AppCard style={{ width: '48%', padding: spacing.md }}>
      <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{label}</Text>
      <MetricRow label="Solicitações" value={number(data?.requests)} />
      <MetricRow label="Concluídas" value={number(data?.completed)} />
      <MetricRow label="Sem motorista" value={number(data?.noDriverAvailable)} />
      <MetricRow label="Comissão capturada" value={money(data?.commissionCapturedCentavos)} strong />
      <MetricRow label="Em disputa" value={money(data?.commissionDisputedCentavos)} />
    </AppCard>
  );
}

function PeakList({ rows, valueLabel, valueKey }) {
  const visible = (rows || []).filter((row) => Number(row?.[valueKey] || 0) > 0).slice(0, 5);
  if (visible.length === 0) {
    return (
      <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
        Ainda não há dados suficientes para este período.
      </Text>
    );
  }
  return visible.map((row, index) => (
    <MetricRow
      key={`${row.hour}-${index}-${valueKey}`}
      label={`${index + 1}. ${hourLabel(row.hour)}`}
      value={valueLabel(row)}
      strong={index === 0}
    />
  ));
}

export default function Dashboard() {
  const router = useRouter();
  const [rangeDays, setRangeDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getAdminBusinessAnalytics(rangeDays);
      setData(result);
      console.log('[ADMIN_ANALYTICS] loaded', {
        rangeDays,
        generatedAtMs: result?.generatedAtMs,
        truncated: result?.truncated,
      });
    } catch (e) {
      console.log('[ADMIN_ANALYTICS] load error', {
        rangeDays,
        code: e?.code,
        message: e?.message,
      });
      setError('Não foi possível carregar os indicadores. Puxe para atualizar.');
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => {
    load();
  }, [load]);

  const revenue = data?.revenue || {};
  const rides = data?.rides || {};
  const drivers = data?.drivers || {};
  const alerts = data?.alerts || {};
  const health = Number(alerts.critical || 0) > 0
    ? 'CRÍTICO'
    : Number(alerts.high || 0) > 0
      ? 'ATENÇÃO'
      : 'OK';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        <Header title="Painel DriveLocal" subtitle="Horizonte / CE" onBack={() => router.back()} />

        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {PERIODS.map((period) => {
            const selected = period.days === rangeDays;
            return (
              <Pressable
                key={period.days}
                onPress={() => setRangeDays(period.days)}
                style={{
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.card,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                }}
              >
                <Text
                  style={[
                    { fontFamily, color: selected ? colors.onPrimary : colors.textMuted },
                    typography.small,
                  ]}
                >
                  {period.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.danger }, typography.small]}>{error}</Text>
          </AppCard>
        ) : null}

        <SectionTitle
          title="Receita confirmada"
          subtitle="Comissões capturadas + assinaturas realmente pagas. Recargas não são receita."
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md }}>
          <AdminStatCard
            style={{ width: '48%' }}
            label="Receita DriveLocal"
            value={data ? money(revenue.confirmedRevenueCentavos) : '…'}
            hint={`Período: ${rangeDays} dia${rangeDays > 1 ? 's' : ''}`}
          />
          <AdminStatCard
            style={{ width: '48%' }}
            label="Comissões capturadas"
            value={data ? money(revenue.commissionRevenueCentavos) : '…'}
            hint={`Taxa de captura: ${data ? percent(revenue.captureRate) : '…'}`}
          />
          <AdminStatCard
            style={{ width: '48%' }}
            label="Assinaturas recebidas"
            value={data ? money(revenue.subscriptionRevenueCentavos) : '…'}
          />
          <AdminStatCard
            style={{ width: '48%' }}
            label="Valor em risco"
            value={data ? money(revenue.amountAtRiskCentavos) : '…'}
            hint={`${number(alerts.open)} alerta(s) aberto(s)`}
          />
        </View>

        <AppCard>
          <MetricRow label="Comissão esperada" value={money(revenue.commissionExpectedCentavos)} />
          <MetricRow label="Comissão ainda retida" value={money(revenue.commissionHeldCentavos)} />
          <MetricRow label="Comissão em disputa" value={money(revenue.commissionDisputedCentavos)} />
          <MetricRow label="Retenções liberadas" value={money(revenue.commissionReleasedCentavos)} />
          <MetricRow label="Saúde financeira" value={health} strong />
        </AppCard>

        <SectionTitle title="Moto x carro" subtitle="Demanda, conclusão e receita por tipo de veículo." />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <VehicleFinanceCard label="🏍️ Moto" data={rides.byVehicle?.moto} />
          <VehicleFinanceCard label="🚗 Carro" data={rides.byVehicle?.car} />
        </View>

        <SectionTitle title="Assinaturas em curso" subtitle="Separação exata entre planos pagos e períodos gratuitos." />
        <AppCard>
          <MetricRow
            label="Moto — pagas ativas"
            value={number(drivers.activeSubscriptions?.moto)}
            hint={`MRR teórico: ${money(drivers.theoreticalMrrCentavos?.moto)}`}
          />
          <MetricRow
            label="Carro — pagas ativas"
            value={number(drivers.activeSubscriptions?.car)}
            hint={`MRR teórico: ${money(drivers.theoreticalMrrCentavos?.car)}`}
          />
          <MetricRow
            label="Total pagas ativas"
            value={number(drivers.activeSubscriptions?.total)}
            hint={`MRR teórico total: ${money(drivers.theoreticalMrrCentavos?.total)}`}
            strong
          />
          <MetricRow label="Moto — gratuitas ativas" value={number(drivers.freeSubscriptions?.moto)} />
          <MetricRow label="Carro — gratuitas ativas" value={number(drivers.freeSubscriptions?.car)} />
          <MetricRow label="Expiram em até 7 dias" value={number(drivers.expiringWithin7Days?.total)} />
          <MetricRow label="Assinaturas expiradas" value={number(drivers.expiredSubscriptions?.total)} />
        </AppCard>

        <SectionTitle title="Motoristas e carteiras" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md }}>
          <AdminStatCard style={{ width: '48%' }} label="Motoristas aprovados" value={data ? number(drivers.approved) : '…'} />
          <AdminStatCard style={{ width: '48%' }} label="Online agora" value={data ? number(drivers.online) : '…'} />
          <AdminStatCard style={{ width: '48%' }} label="Pendentes" value={data ? number(drivers.pendingReview) : '…'} />
          <AdminStatCard style={{ width: '48%' }} label="Suspensos/bloqueados" value={data ? number(drivers.suspended) : '…'} />
          <AdminStatCard
            style={{ width: '48%' }}
            label="Carteiras com ≤ R$ 3"
            value={data ? number(drivers.lowWallet?.total) : '…'}
            hint={`Moto ${number(drivers.lowWallet?.moto)} · Carro ${number(drivers.lowWallet?.car)}`}
          />
          <AdminStatCard
            style={{ width: '48%' }}
            label="Comissões retidas"
            value={data ? money(drivers.walletHeldCentavos) : '…'}
          />
        </View>

        <SectionTitle
          title="Picos de corridas"
          subtitle="Horário local de Horizonte. Inclui pedidos não atendidos, não apenas corridas concluídas."
        />
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Mais solicitações</Text>
          <PeakList
            rows={rides.peakHours}
            valueKey="requests"
            valueLabel={(row) => `${number(row.requests)} pedido(s)`}
          />
        </AppCard>
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Maior receita de comissão</Text>
          <PeakList
            rows={rides.peakRevenueHours}
            valueKey="commissionCapturedCentavos"
            valueLabel={(row) => money(row.commissionCapturedCentavos)}
          />
        </AppCard>
        <AppCard>
          <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>Falta de motoristas</Text>
          <PeakList
            rows={rides.peakUnservedHours}
            valueKey="noDriverAvailable"
            valueLabel={(row) => `${number(row.noDriverAvailable)} não atendida(s)`}
          />
        </AppCard>

        <SectionTitle title="Dias mais ativos" subtitle="Ranking do período por quantidade de pedidos." />
        <AppCard>
          {(rides.peakDays || []).filter((day) => Number(day.requests || 0) > 0).map((day, index) => (
            <MetricRow
              key={day.dayKey}
              label={`${index + 1}. ${day.label}`}
              value={`${number(day.requests)} pedidos · ${money(day.commissionCapturedCentavos)}`}
              strong={index === 0}
              hint={`${number(day.completed)} concluída(s) · ${number(day.noDriverAvailable)} sem motorista`}
            />
          ))}
          {(rides.peakDays || []).every((day) => Number(day.requests || 0) === 0) ? (
            <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
              Ainda não há dados suficientes para este período.
            </Text>
          ) : null}
        </AppCard>

        <SectionTitle title="Funil operacional" subtitle="Onde a demanda está sendo perdida." />
        <AppCard>
          <MetricRow label="Solicitações" value={number(rides.total?.requests)} strong />
          <MetricRow label="Atribuídas" value={number(rides.total?.assigned)} />
          <MetricRow label="Iniciadas" value={number(rides.total?.started)} />
          <MetricRow label="Concluídas" value={number(rides.total?.completed)} />
          <MetricRow label="Sem motorista" value={number(rides.total?.noDriverAvailable)} />
          <MetricRow label="Canceladas" value={number(rides.total?.cancelled)} />
          <MetricRow label="Em disputa" value={number(rides.total?.disputed)} />
        </AppCard>

        <SectionTitle title="Alertas antifraude" subtitle="Nenhum alerta altera saldo automaticamente." />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md }}>
          <AdminStatCard style={{ width: '48%' }} label="Críticos" value={data ? number(alerts.critical) : '…'} />
          <AdminStatCard style={{ width: '48%' }} label="Alta prioridade" value={data ? number(alerts.high) : '…'} />
          <AdminStatCard style={{ width: '48%' }} label="Casos abertos" value={data ? number(alerts.open) : '…'} />
          <AdminStatCard style={{ width: '48%' }} label="Montante em risco" value={data ? money(alerts.amountAtRiskCentavos) : '…'} />
        </View>

        {data?.truncated && Object.values(data.truncated).some(Boolean) ? (
          <AppCard>
            <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
              A consulta atingiu o limite de segurança. Os totais exibidos são parciais; aumente a agregação antes de usar como fechamento contábil.
            </Text>
          </AppCard>
        ) : null}

        <SectionTitle title="Operações administrativas" />
        <AppButton title="Motoristas pendentes" onPress={() => router.push('/drivers-pending')} />
        <AppButton title="Disputas de corrida" variant="secondary" onPress={() => router.push('/ride-disputes')} />
        <AppButton title="Ajuste de saldo" variant="secondary" onPress={() => router.push('/wallet-adjust')} />
        <AppButton title="Recargas pendentes" variant="secondary" onPress={() => router.push('/topups-pending')} />
        <AppButton title="Corridas" variant="secondary" onPress={() => router.push('/rides')} />
        <AppButton title="Carteiras" variant="secondary" onPress={() => router.push('/wallets')} />
        <AppButton title="Relatórios" variant="secondary" onPress={() => router.push('/reports')} />
        <AppButton title="Painel resumido" variant="ghost" onPress={() => router.push('/admin-home')} />
      </ScrollView>
    </SafeAreaView>
  );
}
