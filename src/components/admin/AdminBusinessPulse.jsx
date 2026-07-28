// Positive business pulse for the solo operator dashboard.
//
// The operator can compare rolling 7, 30, 45 and 90-day windows. Real captured
// revenue and operational traction stay separate from estimated accounting profit.
// No raw ride, driver or payment record is read by this component.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors } from '../../constants/colors';
import { radius, spacing } from '../../constants/spacing';
import { fontFamily, typography } from '../../constants/typography';
import { getAdminBusinessAnalytics } from '../../services/adminService';
import { formatBRL } from '../../utils/format';

const PULSE_PERIODS = Object.freeze([
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 45, label: '45 dias' },
  { days: 90, label: '90 dias' },
]);

const money = (value) => formatBRL(Number(value || 0));
const number = (value) => Number(value || 0).toLocaleString('pt-BR');
const percentage = (value) => `${(Number(value || 0) * 100).toFixed(1).replace('.', ',')}%`;

function tracePulse(event, details = {}, level = 'log') {
  const method = console[level] || console.log;
  method(`[ADMIN_POSITIVE_PULSE] ${event}`, {
    scope: 'admin_positive_pulse',
    event,
    atMs: Date.now(),
    ...details,
  });
}

function PeriodSelector({ selectedDays, onSelect, disabled }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {PULSE_PERIODS.map((period) => {
        const selected = period.days === selectedDays;
        return (
          <Pressable
            key={period.days}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onSelect(period.days)}
            style={({ pressed }) => ({
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: selected ? colors.success : colors.border,
              backgroundColor: selected ? colors.successBg : colors.card,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              opacity: disabled ? 0.55 : pressed ? 0.68 : 1,
            })}
          >
            <Text style={[
              { fontFamily, color: selected ? colors.success : colors.textMuted },
              typography.small,
            ]}>
              {period.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PulseMetric({ icon, label, value, hint, emphasized = false }) {
  return (
    <View
      style={{
        width: '48%',
        padding: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: emphasized ? colors.success : colors.border,
        backgroundColor: emphasized ? colors.successBg : colors.card,
        gap: spacing.xs,
      }}
    >
      <Text style={{ fontSize: 18 }}>{icon}</Text>
      <Text
        style={[{ fontFamily, color: colors.text }, typography.h2]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[{ fontFamily, color: emphasized ? colors.success : colors.textMuted }, typography.small]}>
        {label}
      </Text>
      {hint ? (
        <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>{hint}</Text>
      ) : null}
    </View>
  );
}

function SignalRow({ icon, title, detail }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.successBg,
          borderWidth: 1,
          borderColor: colors.success,
        }}
      >
        <Text style={{ fontSize: 14 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[{ fontFamily, color: colors.text }, typography.bodyBold]}>{title}</Text>
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.caption]}>{detail}</Text>
      </View>
    </View>
  );
}

export default function AdminBusinessPulse() {
  const [selectedDays, setSelectedDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setData(null);
    tracePulse('load.started', { rangeDays: selectedDays });
    try {
      const result = await getAdminBusinessAnalytics(selectedDays);
      setData(result);
      tracePulse('load.succeeded', {
        rangeDays: selectedDays,
        generatedAtMs: result?.generatedAtMs,
        confirmedRevenueCentavos: result?.revenue?.confirmedRevenueCentavos,
        commissionRevenueCentavos: result?.revenue?.commissionRevenueCentavos,
        completedRides: result?.rides?.total?.completed,
        truncated: result?.truncated,
      });
    } catch (loadError) {
      tracePulse('load.failed', {
        rangeDays: selectedDays,
        reason: loadError?.code || loadError?.name || 'unknown',
      }, 'warn');
      setError('Não foi possível atualizar o pulso positivo agora.');
    } finally {
      setLoading(false);
    }
  }, [selectedDays]);

  useEffect(() => {
    load();
  }, [load]);

  const revenue = data?.revenue || {};
  const rides = data?.rides?.total || {};
  const drivers = data?.drivers || {};
  const alerts = data?.alerts || {};

  const requests = Number(rides.requests || 0);
  const completed = Number(rides.completed || 0);
  const confirmedRevenue = Number(revenue.confirmedRevenueCentavos || 0);
  const commissionRevenue = Number(revenue.commissionRevenueCentavos || 0);
  const subscriptionRevenue = Number(revenue.subscriptionRevenueCentavos || 0);
  const averageCommission = completed > 0 ? Math.round(commissionRevenue / completed) : 0;
  const averageDailyRevenue = confirmedRevenue > 0
    ? Math.round(confirmedRevenue / selectedDays)
    : 0;
  const monthlyGrossProjection = confirmedRevenue > 0
    ? Math.round((confirmedRevenue / selectedDays) * 30)
    : null;
  const activeSubscriptions = Number(drivers.activeSubscriptions?.total || 0);
  const theoreticalMrr = Number(drivers.theoreticalMrrCentavos?.total || 0);
  const onlineDrivers = Number(drivers.online || 0);
  const captureRate = Number(revenue.captureRate || 0);
  const expectedCommission = Number(revenue.commissionExpectedCentavos || 0);
  const amountAtRisk = Number(alerts.amountAtRiskCentavos || revenue.amountAtRiskCentavos || 0);
  const truncated = Boolean(data?.truncated && Object.values(data.truncated).some(Boolean));
  const periodText = `últimos ${selectedDays} dias`;

  useEffect(() => {
    if (!data || monthlyGrossProjection == null) return;
    tracePulse('projection.calculated', {
      basisWindowDays: selectedDays,
      averageDailyRevenueCentavos: averageDailyRevenue,
      confirmedRevenueCentavos: confirmedRevenue,
      projectedGross30DaysCentavos: monthlyGrossProjection,
      accountingProfit: false,
    });
  }, [averageDailyRevenue, confirmedRevenue, data, monthlyGrossProjection, selectedDays]);

  const positiveSignals = useMemo(() => {
    const signals = [];
    if (confirmedRevenue > 0) {
      signals.push({
        icon: '💚',
        title: 'Receita real entrou na DriveLocal',
        detail: `${money(confirmedRevenue)} confirmados nos ${periodText}.`,
      });
    }
    if (completed > 0) {
      signals.push({
        icon: '🏁',
        title: 'Corridas estão chegando ao fim',
        detail: `${number(completed)} ${completed === 1 ? 'concluída' : 'concluídas'} de ${number(requests)} ${requests === 1 ? 'solicitação' : 'solicitações'}.`,
      });
    }
    if (expectedCommission > 0 && captureRate >= 0.95) {
      signals.push({
        icon: '🛡️',
        title: 'Captura de comissão saudável',
        detail: `${percentage(captureRate)} da comissão esperada foi capturada.`,
      });
    }
    if (onlineDrivers > 0) {
      signals.push({
        icon: '🟢',
        title: 'Há oferta ativa na cidade',
        detail: `${number(onlineDrivers)} motorista${onlineDrivers !== 1 ? 's' : ''} online no retrato mais recente.`,
      });
    }
    if (activeSubscriptions > 0) {
      signals.push({
        icon: '🔁',
        title: 'A base recorrente começou',
        detail: `${number(activeSubscriptions)} assinatura${activeSubscriptions !== 1 ? 's pagas ativas' : ' paga ativa'} · MRR teórico ${money(theoreticalMrr)}.`,
      });
    }
    if (confirmedRevenue > 0 && amountAtRisk === 0) {
      signals.push({
        icon: '✅',
        title: 'Receita sem valor financeiro sinalizado em risco',
        detail: 'Nenhum montante em risco foi agregado nesta leitura.',
      });
    }
    return signals.slice(0, 4);
  }, [
    activeSubscriptions,
    amountAtRisk,
    captureRate,
    completed,
    confirmedRevenue,
    expectedCommission,
    onlineDrivers,
    periodText,
    requests,
    theoreticalMrr,
  ]);

  const headline = confirmedRevenue > 0
    ? `A DriveLocal gerou ${money(confirmedRevenue)} nos ${periodText}`
    : completed > 0
      ? 'A operação está rodando, ainda sem receita confirmada'
      : requests > 0
        ? 'A demanda apareceu; agora falta convertê-la em corridas concluídas'
        : 'O pulso positivo está pronto para acompanhar o lançamento';

  const message = confirmedRevenue > 0
    ? `${money(commissionRevenue)} vieram de comissão e ${money(subscriptionRevenue)} de assinaturas pagas.`
    : completed > 0
      ? 'Isso pode ser normal durante a promoção de comissão zero. As corridas concluídas continuam sendo um sinal real de validação.'
      : 'Assim que houver solicitações, corridas, comissão ou assinaturas, os sinais positivos aparecerão aqui automaticamente.';

  function changePeriod(days) {
    if (days === selectedDays || loading) return;
    tracePulse('period.changed', { fromDays: selectedDays, toDays: days });
    setSelectedDays(days);
  }

  return (
    <View
      style={{
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.success,
        backgroundColor: colors.background,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text style={[{ fontFamily, color: colors.success }, typography.caption]}>
            O QUE ESTÁ FUNCIONANDO · {selectedDays} DIAS
          </Text>
          <Text style={[{ fontFamily, color: colors.text }, typography.h3]}>{headline}</Text>
          <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>{message}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Atualizar pulso positivo"
          disabled={loading}
          onPress={load}
          style={({ pressed }) => ({
            borderRadius: radius.full,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.sm,
            backgroundColor: colors.successBg,
            opacity: loading ? 0.5 : pressed ? 0.65 : 1,
          })}
        >
          <Text style={[{ fontFamily, color: colors.success }, typography.small]}>
            {loading ? '…' : '↻'}
          </Text>
        </Pressable>
      </View>

      <PeriodSelector selectedDays={selectedDays} onSelect={changePeriod} disabled={loading} />

      {error ? (
        <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningBg }}>
          <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>{error}</Text>
        </View>
      ) : null}

      {truncated ? (
        <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningBg }}>
          <Text style={[{ fontFamily, color: colors.warning }, typography.small]}>
            A consulta atingiu o limite de segurança. Os números desta janela podem ser parciais.
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md }}>
        <PulseMetric
          icon="💰"
          label={`Receita confirmada · ${selectedDays}d`}
          value={data ? money(confirmedRevenue) : loading ? '…' : '—'}
          hint="Comissão + assinaturas pagas"
          emphasized={confirmedRevenue > 0}
        />
        <PulseMetric
          icon="🪙"
          label={`Comissão capturada · ${selectedDays}d`}
          value={data ? money(commissionRevenue) : loading ? '…' : '—'}
          hint="Valor efetivamente capturado"
          emphasized={commissionRevenue > 0}
        />
        <PulseMetric
          icon="🏁"
          label="Média por corrida concluída"
          value={data && completed > 0 ? money(averageCommission) : loading ? '…' : '—'}
          hint="Comissão média, sem assinaturas"
        />
        <PulseMetric
          icon="🚀"
          label="Projeção bruta · 30 dias"
          value={data && monthlyGrossProjection != null ? money(monthlyGrossProjection) : loading ? '…' : '—'}
          hint={data && confirmedRevenue > 0
            ? `Média diária ${money(averageDailyRevenue)} × 30`
            : `Baseada na média dos ${selectedDays} dias`}
          emphasized={monthlyGrossProjection != null}
        />
      </View>

      {positiveSignals.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          {positiveSignals.map((signal) => (
            <SignalRow key={signal.title} {...signal} />
          ))}
        </View>
      ) : !loading ? (
        <Text style={[{ fontFamily, color: colors.textMuted }, typography.small]}>
          Ainda não há sinal positivo mensurável nesta janela. Isso não é uma falha: é a linha de base antes das primeiras corridas reais.
        </Text>
      ) : null}

      <Text style={[{ fontFamily, color: colors.textFaint }, typography.caption]}>
        Janela móvel de {selectedDays} dias. A projeção usa a média diária da janela e representa receita bruta estimada, não lucro líquido: custos, impostos, marketing e retiradas não estão descontados.
      </Text>
    </View>
  );
}
